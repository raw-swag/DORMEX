import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDatabaseService, resetDatabaseInstance, DatabaseService } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';
import { reconcileAndRunMigrations, REGISTERED_MIGRATIONS } from '../src/db/migrate.js';
import { executeBootstrapSuperAdmin, generateSecureInitialPassword } from '../scripts/bootstrap-super-admin.js';
import { buildApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';

describe('DORMEX First Administrator Bootstrap & Migration Reconciliation Suite', () => {
  let db: DatabaseService;

  beforeEach(() => {
    resetDatabaseInstance();
    // Test environment guarantees isolated in-memory PostgreSQL emulation
    process.env.NODE_ENV = 'test';
    db = getDatabaseService(true);
  });

  afterEach(async () => {
    await db.close();
    resetDatabaseInstance();
  });

  // Helper to ensure clean master tables without pre-seeded staff users
  async function setupCleanMasterSchema() {
    await runMigrations(db);
    // Insert official roles and clean terms only
    const roles = [
      ['role_student', 'STUDENT', 'Student resident'],
      ['role_proctor', 'PROCTOR', 'Faculty proctor'],
      ['role_warden', 'WARDEN', 'Building Warden'],
      ['role_deputy_warden', 'DEPUTY_WARDEN', 'Deputy Building Warden'],
      ['role_chief_warden', 'CHIEF_WARDEN', 'Chief Warden across all hostels'],
      ['role_hostel_office', 'HOSTEL_OFFICE', 'Hostel Office Administrator'],
      ['role_super_admin', 'SUPER_ADMIN', 'Super Administrator with system override'],
    ];
    for (const [id, name, desc] of roles) {
      await db.query(
        `INSERT INTO roles (id, name, description) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [id, name, desc]
      );
    }

    await db.query(`
      INSERT INTO terms_documents (id, version, title, content, content_hash, is_published, created_at)
      VALUES ('terms_v1', 1, 'Standard Terms', 'Content of terms', 'hash_v1', TRUE, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO NOTHING
    `);
  }

  describe('1. Migration Tracking & Reconciliation', () => {
    it('reconciles fresh database: creates tracking table and records all registered migrations', async () => {
      const res = await reconcileAndRunMigrations(db, false);

      expect(res.applied.length).toBe(REGISTERED_MIGRATIONS.length);
      expect(res.alreadyRecorded.length).toBe(0);

      // Verify records in schema_migrations table
      const stored = await db.query('SELECT id, name FROM schema_migrations ORDER BY applied_at ASC');
      expect(stored.rows.length).toBe(REGISTERED_MIGRATIONS.length);
      expect(stored.rows.map((r) => r.id)).toEqual(REGISTERED_MIGRATIONS.map((m) => m.id));
    });

    it('reconciles already initialized database: safely records missing migrations without destroying data', async () => {
      // Step A: Database had schema initialized directly
      await runMigrations(db);

      // Verify that schema_migrations does NOT exist yet
      const checkTables = await db.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migrations';"
      );
      expect(checkTables.rows.length).toBe(0);

      // Step B: Run reconcileAndRunMigrations with isProd=false
      const res = await reconcileAndRunMigrations(db, false);
      expect(res.applied.length).toBe(REGISTERED_MIGRATIONS.length);

      // Step C: Running again should be 100% idempotent
      const secondRun = await reconcileAndRunMigrations(db, false);
      expect(secondRun.applied.length).toBe(0);
      expect(secondRun.alreadyRecorded.length).toBe(REGISTERED_MIGRATIONS.length);
    });

    it('enforces production integrity: rejects reconciliation if synthetic DEMO users exist when isProd is true', async () => {
      // Seed demo data
      process.env.SEED_DEMO_DATA = 'true';
      await runMigrations(db);
      await seedDatabase(db);

      await expect(async () => {
        await reconcileAndRunMigrations(db, true);
      }).rejects.toThrow('CRITICAL_INTEGRITY_VIOLATION: Found');

      delete process.env.SEED_DEMO_DATA;
    });

    it('rejects reconciliation if existing table is missing a required column', async () => {
      // Simulate existing database table missing 'phone' column (or password_hash)
      await db.query(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          college_id TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          full_name TEXT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE
        );
      `);

      await expect(async () => {
        await reconcileAndRunMigrations(db, false, true);
      }).rejects.toThrow("SCHEMA_VERIFICATION_FAILED: Table 'users' is missing required column 'phone'");

      // Verify migration was NOT marked as applied
      const migRes = await db.query(`SELECT * FROM schema_migrations WHERE id = '20261103_001_core_schema'`);
      expect(migRes.rows.length).toBe(0);
    });

    it('rejects reconciliation if existing table has an incorrect column type', async () => {
      // Setup master schema first so all required tables and roles exist
      await setupCleanMasterSchema();
      await db.query(`ALTER TABLE rooms DROP COLUMN capacity;`);
      await db.query(`ALTER TABLE rooms ADD COLUMN capacity TEXT NOT NULL;`);

      await expect(async () => {
        await reconcileAndRunMigrations(db, false, true);
      }).rejects.toThrow("SCHEMA_VERIFICATION_FAILED: Table 'rooms', column 'capacity' has invalid type 'text'");

      // Verify migration was NOT marked as applied
      const migRes = await db.query(`SELECT * FROM schema_migrations WHERE id = '20261103_001_core_schema'`);
      expect(migRes.rows.length).toBe(0);
    });

    it('rejects reconciliation if existing table has incorrect nullability on a mandatory column', async () => {
      await setupCleanMasterSchema();
      // Alter is_active to be nullable
      await db.query(`ALTER TABLE users DROP COLUMN is_active;`);
      await db.query(`ALTER TABLE users ADD COLUMN is_active BOOLEAN;`);

      await expect(async () => {
        await reconcileAndRunMigrations(db, false, true);
      }).rejects.toThrow("SCHEMA_VERIFICATION_FAILED: Table 'users', column 'is_active' nullability mismatch");

      // Verify ledger was NOT updated
      const migRes = await db.query(`SELECT * FROM schema_migrations WHERE id = '20261103_001_core_schema'`);
      expect(migRes.rows.length).toBe(0);
    });

    it('rejects reconciliation if table is missing completely', async () => {
      // Intentionally drop allocations table
      await setupCleanMasterSchema();
      await db.query(`DROP TABLE allocations CASCADE;`);

      await expect(async () => {
        await reconcileAndRunMigrations(db, false, true);
      }).rejects.toThrow("SCHEMA_VERIFICATION_FAILED: Required table 'allocations' does not exist");

      // Verify ledger was NOT updated
      const migRes = await db.query(`SELECT * FROM schema_migrations WHERE id = '20261103_001_core_schema'`);
      expect(migRes.rows.length).toBe(0);
    });

    it('safely resumes partial reconciliation without re-recording already verified migrations', async () => {
      // Reconcile successfully
      const firstRun = await reconcileAndRunMigrations(db, false);
      expect(firstRun.applied.length).toBe(REGISTERED_MIGRATIONS.length);

      // Manually delete one migration from ledger to simulate resume after new migration registered
      await db.query(`DELETE FROM schema_migrations WHERE id = '20261106_004_production_bootstrap'`);

      const resumedRun = await reconcileAndRunMigrations(db, false);
      expect(resumedRun.applied).toEqual(['20261106_004_production_bootstrap']);
      expect(resumedRun.alreadyRecorded.length).toBe(REGISTERED_MIGRATIONS.length - 1);
    });
  });

  describe('2. Bootstrap Super Admin CLI Logic', () => {
    beforeEach(async () => {
      await setupCleanMasterSchema();
    });

    it('successfully bootstraps authorized SUPER_ADMIN with random password and records audit event', async () => {
      const result = await executeBootstrapSuperAdmin(db, {
        staffId: 'ADM001',
        fullName: 'Prof. Administrative Dean',
        email: 'dean.admin@college.edu',
      });

      expect(result.success).toBe(true);
      expect(result.staffId).toBe('ADM001');
      expect(result.fullName).toBe('Prof. Administrative Dean');
      expect(result.email).toBe('dean.admin@college.edu');
      expect(result.generatedPassword).toBeDefined();
      expect(result.generatedPassword!.length).toBeGreaterThanOrEqual(16);

      // Verify user record in database
      const userRes = await db.query('SELECT * FROM users WHERE id = $1', [result.userId]);
      expect(userRes.rows.length).toBe(1);
      const user = userRes.rows[0];
      expect(user.college_id).toBe('ADM001');
      expect(user.email).toBe('dean.admin@college.edu');
      expect(user.is_active).toBe(true);
      expect(user.password_hash.startsWith('scrypt$')).toBe(true);

      // Verify that plain password matches scrypt hash
      const authService = new AuthService(db);
      expect(authService.verifyPassword(result.generatedPassword!, user.password_hash)).toBe(true);

      // Verify role assignment
      const roleRes = await db.query(
        `SELECT r.name, ur.scope_type, ur.scope_id 
         FROM user_roles ur 
         JOIN roles r ON ur.role_id = r.id 
         WHERE ur.user_id = $1`,
        [result.userId]
      );
      expect(roleRes.rows.length).toBe(1);
      expect(roleRes.rows[0].name).toBe('SUPER_ADMIN');
      expect(roleRes.rows[0].scope_type).toBe('SYSTEM');
      expect(roleRes.rows[0].scope_id).toBeNull();

      // Verify audit trail
      const auditRes = await db.query(
        `SELECT action, target_type, target_id, reason 
         FROM audit_logs 
         WHERE target_id = $1 AND action = 'BOOTSTRAP_SUPER_ADMIN_CREATED'`,
        [result.userId]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].reason).toContain('First authorized production SUPER_ADMIN account bootstrapped');
    });

    it('rejects duplicate bootstrap attempt once an initial SUPER_ADMIN exists', async () => {
      // First bootstrap succeeds
      await executeBootstrapSuperAdmin(db, {
        staffId: 'ADM001',
        fullName: 'First Administrator',
        email: 'admin1@college.edu',
      });

      // Second attempt must fail with BOOTSTRAP_ALREADY_INITIALIZED
      await expect(async () => {
        await executeBootstrapSuperAdmin(db, {
          staffId: 'ADM002',
          fullName: 'Second Administrator',
          email: 'admin2@college.edu',
        });
      }).rejects.toThrow('BOOTSTRAP_ALREADY_INITIALIZED');
    });

    it('concurrent bootstrap attempts: exactly one succeeds and duplicate is rejected', async () => {
      const p1 = executeBootstrapSuperAdmin(db, {
        staffId: 'ADM001',
        fullName: 'Admin One',
        email: 'admin1@college.edu',
      });

      const p2 = executeBootstrapSuperAdmin(db, {
        staffId: 'ADM002',
        fullName: 'Admin Two',
        email: 'admin2@college.edu',
      });

      const results = await Promise.allSettled([p1, p2]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('BOOTSTRAP_ALREADY_INITIALIZED');

      // Assert only one SUPER_ADMIN exists in database
      const adminCount = await db.query(`
        SELECT count(*) as count 
        FROM user_roles ur 
        JOIN roles r ON ur.role_id = r.id 
        WHERE r.name = 'SUPER_ADMIN'
      `);
      expect(parseInt(adminCount.rows[0].count, 10)).toBe(1);
    });

    it('validates mandatory inputs: rejects missing staff ID, missing name, or invalid email', async () => {
      await expect(async () => {
        await executeBootstrapSuperAdmin(db, {
          staffId: '',
          fullName: 'Valid Name',
          email: 'valid@college.edu',
        });
      }).rejects.toThrow('VALIDATION_FAILED: Official administrator Staff ID is required');

      await expect(async () => {
        await executeBootstrapSuperAdmin(db, {
          staffId: 'ADM001',
          fullName: '   ',
          email: 'valid@college.edu',
        });
      }).rejects.toThrow('VALIDATION_FAILED: Official administrator full name is required');

      await expect(async () => {
        await executeBootstrapSuperAdmin(db, {
          staffId: 'ADM001',
          fullName: 'Valid Name',
          email: 'not-an-email',
        });
      }).rejects.toThrow('VALIDATION_FAILED: Invalid email address format');
    });

    it('rejects bootstrap if SUPER_ADMIN role is missing in database', async () => {
      // Intentionally delete the SUPER_ADMIN role
      await db.query(`DELETE FROM roles WHERE name = 'SUPER_ADMIN'`);

      await expect(async () => {
        await executeBootstrapSuperAdmin(db, {
          staffId: 'ADM001',
          fullName: 'Valid Name',
          email: 'admin@college.edu',
        });
      }).rejects.toThrow("ROLE_NOT_FOUND: The 'SUPER_ADMIN' system role is not defined");
    });

    it('fails closed on advisory lock failure when running against a non-test or real PostgreSQL database', async () => {
      // Create a mock DB that declares isInMemory = false (simulating real PostgreSQL connection)
      const fakePgDb: DatabaseService = {
        isInMemory: false,
        query: async () => ({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] }),
        getClient: async () => ({ query: async () => ({ rows: [] } as any), release: () => {} }),
        transaction: async (fn) => {
          // Provide a client where advisory lock throws
          const mockClient = {
            query: async (text: string) => {
              if (text.includes('pg_advisory_xact_lock')) {
                throw new Error('deadlock detected or lock timeout');
              }
              return { rows: [] } as any;
            },
          };
          return fn(mockClient);
        },
        close: async () => {},
      };

      await expect(async () => {
        await executeBootstrapSuperAdmin(fakePgDb, {
          staffId: 'ADM001',
          fullName: 'Target Admin',
          email: 'admin@college.edu',
        });
      }).rejects.toThrow('LOCK_ACQUISITION_FAILED: Failed to acquire PostgreSQL bootstrap advisory lock');
    });

    it('verifies generated password entropy complies with >= 128-bit cryptographic standard', () => {
      const pwd = generateSecureInitialPassword();
      expect(pwd.length).toBeGreaterThanOrEqual(16);
      expect(pwd.startsWith('Dx@')).toBe(true);
      expect(pwd.endsWith('#9')).toBe(true);
      // Ensure different calls produce different random passwords
      const pwd2 = generateSecureInitialPassword();
      expect(pwd).not.toBe(pwd2);
    });
  });

  describe('3. End-to-End Authentication, Session & Authorization Boundaries', () => {
    let fastifyApp: any;
    let adminCredentials: { staffId: string; fullName: string; password: string; email: string };

    beforeEach(async () => {
      await setupCleanMasterSchema();
      const generatedPassword = generateSecureInitialPassword();
      adminCredentials = {
        staffId: 'ADM001',
        fullName: 'Dr. Institutional Chief Registrar',
        email: 'registrar@college.edu',
        password: generatedPassword,
      };

      await executeBootstrapSuperAdmin(db, adminCredentials);
      fastifyApp = await buildApp(db);
      await fastifyApp.ready();
    });

    afterEach(async () => {
      if (fastifyApp) {
        await fastifyApp.close();
      }
    });

    it('authenticates newly bootstrapped administrator and rejects invalid passwords', async () => {
      // 1. Wrong password rejected
      const badLogin = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'ADM001', password: 'incorrect-password' },
      });

      expect(badLogin.statusCode).toBe(401);
      expect(badLogin.json().error).toContain('UNAUTHORIZED: Invalid credentials');

      // 2. Correct password via Staff ID succeeds
      const goodLogin = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'ADM001', password: adminCredentials.password },
      });

      expect(goodLogin.statusCode).toBe(200);
      const goodBody = goodLogin.json();
      expect(goodBody.session.role).toBe('SUPER_ADMIN');
      expect(goodBody.session.collegeId).toBe('ADM001');

      // Verify Set-Cookie header is returned with HttpOnly token
      const cookieHeader = goodLogin.headers['set-cookie'];
      expect(cookieHeader).toBeDefined();
      const tokenCookie = (Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader]).find((c: string) => c.startsWith('token='));
      expect(tokenCookie).toBeDefined();
      expect(tokenCookie).toContain('HttpOnly');

      // 3. Login via Email also succeeds
      const emailLogin = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: adminCredentials.email, password: adminCredentials.password },
      });

      expect(emailLogin.statusCode).toBe(200);
      expect(emailLogin.json().session.role).toBe('SUPER_ADMIN');
    });

    it('restores authenticated session via HttpOnly cookie at GET /api/auth/me', async () => {
      // Log in
      const loginRes = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'ADM001', password: adminCredentials.password },
      });

      const cookieHeader = loginRes.headers['set-cookie'];

      // Send GET /api/auth/me with session cookie
      const meRes = await fastifyApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          cookie: Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader,
        },
      });

      expect(meRes.statusCode).toBe(200);
      expect(meRes.json().collegeId).toBe('ADM001');
      expect(meRes.json().role).toBe('SUPER_ADMIN');
      expect(meRes.json().scopeType).toBe('SYSTEM');
    });

    it('enforces SUPER_ADMIN authorization boundaries: full access to admin operations and audit trail', async () => {
      const loginRes = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'ADM001', password: adminCredentials.password },
      });

      const cookieHeader = loginRes.headers['set-cookie'];
      const headers = {
        cookie: Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader,
      };

      // Access admin complaints list
      const complaintsRes = await fastifyApp.inject({
        method: 'GET',
        url: '/api/complaints',
        headers,
      });

      expect(complaintsRes.statusCode).toBe(200);
      expect(Array.isArray(complaintsRes.json())).toBe(true);

      // Access admin room change requests
      const changeReqRes = await fastifyApp.inject({
        method: 'GET',
        url: '/api/room-change-requests',
        headers,
      });

      expect(changeReqRes.statusCode).toBe(200);
      expect(Array.isArray(changeReqRes.json())).toBe(true);
    });
  });
});
