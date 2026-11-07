import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDatabaseService, resetDatabaseInstance, DatabaseService } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { buildApp } from '../src/app.js';
import {
  executeHostedDemoSeed,
  validateHostedDemoSafeguards,
  HostedDemoSeedGuardConfig,
} from '../scripts/seed-hosted-demo.js';

describe('DORMEX Hosted Staging Demo Accounts Seeding & Safeguards Suite', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    resetDatabaseInstance();
    process.env.NODE_ENV = 'test';
    db = getDatabaseService(true);
    await runMigrations(db);
    // Seed system roles if not present
    const roles = [
      ['role_student', 'STUDENT', 'Student resident'],
      ['role_proctor', 'PROCTOR', 'Faculty proctor'],
      ['role_warden', 'WARDEN', 'Building Warden'],
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
  });

  afterEach(async () => {
    await db.close();
    resetDatabaseInstance();
  });

  const validStagingConfig: HostedDemoSeedGuardConfig = {
    appEnv: 'staging',
    enableFlag: 'true',
    expectedDbName: 'dormex_staging',
    expectedDbHost: 'ep-test-staging.ap-southeast-1.aws.neon.tech',
    confirmation: 'CONFIRM_SEED_HOSTED_DEMO',
    databaseUrl: 'postgresql://testuser:testpass@ep-test-staging.ap-southeast-1.aws.neon.tech/dormex_staging?sslmode=require',
  };

  describe('1. Staging-Only Guard & Environmental Verification', () => {
    it('refuses to execute if DORMEX_APP_ENV is not staging (e.g. production or undefined)', () => {
      expect(() =>
        validateHostedDemoSafeguards({
          ...validStagingConfig,
          appEnv: 'production',
        })
      ).toThrowError(/STAGING_GUARD_VIOLATION.*DORMEX_APP_ENV must be explicitly set to 'staging'/);

      expect(() =>
        validateHostedDemoSafeguards({
          ...validStagingConfig,
          appEnv: undefined,
        })
      ).toThrowError(/STAGING_GUARD_VIOLATION.*DORMEX_APP_ENV must be explicitly set to 'staging'/);
    });

    it('refuses to execute if ENABLE_HOSTED_DEMO_SEED is not true', () => {
      expect(() =>
        validateHostedDemoSafeguards({
          ...validStagingConfig,
          enableFlag: 'false',
        })
      ).toThrowError(/STAGING_GUARD_VIOLATION.*ENABLE_HOSTED_DEMO_SEED must be explicitly set to 'true'/);
    });

    it('refuses to execute if EXPECTED_STAGING_DB_NAME is missing', () => {
      expect(() =>
        validateHostedDemoSafeguards({
          ...validStagingConfig,
          expectedDbName: '',
        })
      ).toThrowError(/STAGING_GUARD_VIOLATION.*EXPECTED_STAGING_DB_NAME must be explicitly specified/);
    });

    it('refuses to execute if EXPECTED_STAGING_DB_HOST is missing', () => {
      expect(() =>
        validateHostedDemoSafeguards({
          ...validStagingConfig,
          expectedDbHost: '',
        })
      ).toThrowError(/STAGING_GUARD_VIOLATION.*EXPECTED_STAGING_DB_HOST must be explicitly specified/);
    });

    it('refuses to execute if actual DATABASE_URL hostname does not match EXPECTED_STAGING_DB_HOST', () => {
      expect(() =>
        validateHostedDemoSafeguards({
          ...validStagingConfig,
          databaseUrl: 'postgresql://produser:prodpass@ep-production-primary.aws.neon.tech/dormex_staging',
        })
      ).toThrowError(/STAGING_GUARD_VIOLATION.*DATABASE_URL hostname.*does not match.*EXPECTED_STAGING_DB_HOST/);
    });

    it('refuses to execute if confirmation is not CONFIRM_SEED_HOSTED_DEMO', () => {
      expect(() =>
        validateHostedDemoSafeguards({
          ...validStagingConfig,
          confirmation: 'yes',
        })
      ).toThrowError(/STAGING_GUARD_VIOLATION.*HOSTED_DEMO_CONFIRMATION must equal 'CONFIRM_SEED_HOSTED_DEMO'/);
    });

    it('refuses execution if connected database current_database() does not match EXPECTED_STAGING_DB_NAME', async () => {
      const dbCheck = await db.query('SELECT current_database();');
      const actualDb = dbCheck.rows[0].current_database;

      await expect(
        executeHostedDemoSeed(db, {
          ...validStagingConfig,
          expectedDbName: 'mismatched_database_name',
          databaseUrl: `postgresql://user:pass@ep-test-staging.ap-southeast-1.aws.neon.tech/mismatched_database_name`,
        })
      ).rejects.toThrowError(/STAGING_GUARD_VIOLATION.*Connected database name.*does not match/);
    });
  });

  describe('2. Account Creation, Idempotency & Collision Protection', () => {
    it('seeds all 30 student demo accounts and staff demo accounts atomically', async () => {
      const dbCheck = await db.query('SELECT current_database();');
      const actualDb = dbCheck.rows[0].current_database;

      const result = await executeHostedDemoSeed(db, {
        ...validStagingConfig,
        expectedDbName: actualDb,
        databaseUrl: `postgresql://user:pass@ep-test-staging.ap-southeast-1.aws.neon.tech/${actualDb}`,
      });

      expect(result.success).toBe(true);
      expect(result.seededStaffCount).toBe(2);
      expect(result.seededStudentsCount).toBe(30);

      // Verify users in database
      const userCount = await db.query("SELECT COUNT(*) as count FROM users WHERE college_id LIKE 'DEMO-%'");
      expect(parseInt(userCount.rows[0].count, 10)).toBe(30);

      const adminUser = await db.query("SELECT * FROM users WHERE college_id = 'ADM001'");
      expect(adminUser.rows.length).toBe(1);
      expect(adminUser.rows[0].id).toBe('usr_admin');

      const officeUser = await db.query("SELECT * FROM users WHERE college_id = 'OFF001'");
      expect(officeUser.rows.length).toBe(1);
      expect(officeUser.rows[0].id).toBe('usr_office');
    });

    it('is completely idempotent on repeated runs and does not create duplicate users', async () => {
      const dbCheck = await db.query('SELECT current_database();');
      const actualDb = dbCheck.rows[0].current_database;
      const config = {
        ...validStagingConfig,
        expectedDbName: actualDb,
        databaseUrl: `postgresql://user:pass@ep-test-staging.ap-southeast-1.aws.neon.tech/${actualDb}`,
      };

      // Run 1
      await executeHostedDemoSeed(db, config);
      const count1 = await db.query('SELECT COUNT(*) as count FROM users');

      // Run 2
      await executeHostedDemoSeed(db, config);
      const count2 = await db.query('SELECT COUNT(*) as count FROM users');

      expect(count1.rows[0].count).toBe(count2.rows[0].count);
    });

    it('aborts atomically and rolls back if an account identifier belongs to an unexpected user', async () => {
      const dbCheck = await db.query('SELECT current_database();');
      const actualDb = dbCheck.rows[0].current_database;

      // Insert an unexpected real user taking college_id 'DEMO-005'
      await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash)
         VALUES ('usr_real_institutional_student', 'DEMO-005', 'realstudent@college.edu', 'Real Student', 'hash')`
      );

      const config = {
        ...validStagingConfig,
        expectedDbName: actualDb,
        databaseUrl: `postgresql://user:pass@ep-test-staging.ap-southeast-1.aws.neon.tech/${actualDb}`,
      };

      // Seeding must fail with collision detection
      await expect(executeHostedDemoSeed(db, config)).rejects.toThrowError(
        /ACCOUNT_COLLISION_DETECTED.*is already taken by unexpected user 'usr_real_institutional_student'/
      );

      // Verify that the unexpected user is intact and no partial student users were committed
      const checkReal = await db.query("SELECT * FROM users WHERE id = 'usr_real_institutional_student'");
      expect(checkReal.rows.length).toBe(1);
      expect(checkReal.rows[0].full_name).toBe('Real Student');

      // DEMO-001 through DEMO-004 should be rolled back because transaction aborted at DEMO-005
      const checkDemo1 = await db.query("SELECT * FROM users WHERE college_id = 'DEMO-001'");
      expect(checkDemo1.rows.length).toBe(0);
    });
  });

  describe('3. End-to-End Authentication & Session Verification', () => {
    let fastifyApp: any;

    beforeEach(async () => {
      const dbCheck = await db.query('SELECT current_database();');
      const actualDb = dbCheck.rows[0].current_database;
      await executeHostedDemoSeed(db, {
        ...validStagingConfig,
        expectedDbName: actualDb,
        databaseUrl: `postgresql://user:pass@ep-test-staging.ap-southeast-1.aws.neon.tech/${actualDb}`,
      });

      fastifyApp = await buildApp(db);
      await fastifyApp.ready();
    });

    afterEach(async () => {
      if (fastifyApp) {
        await fastifyApp.close();
      }
    });

    it('authenticates representative student demo accounts (DEMO-001 -> password1, DEMO-029 -> password29, DEMO-030 -> password30) and rejects wrong passwords', async () => {
      // 1. DEMO-001 -> password1
      const s1 = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'DEMO-001', password: 'password1' },
      });
      expect(s1.statusCode).toBe(200);
      const s1Body = s1.json();
      expect(s1Body.session.role).toBe('STUDENT');
      expect(s1Body.session.collegeId).toBe('DEMO-001');

      // 2. DEMO-029 -> password29
      const s29 = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'DEMO-029', password: 'password29' },
      });
      expect(s29.statusCode).toBe(200);
      expect(s29.json().session.collegeId).toBe('DEMO-029');

      // 3. DEMO-030 -> password30
      const s30 = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'DEMO-030', password: 'password30' },
      });
      expect(s30.statusCode).toBe(200);
      expect(s30.json().session.collegeId).toBe('DEMO-030');

      // 4. Rejection of incorrect password
      const wrongPw = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'DEMO-001', password: 'wrong_password' },
      });
      expect(wrongPw.statusCode).toBe(401);
      expect(wrongPw.json().error).toContain('UNAUTHORIZED: Invalid credentials');
    });

    it('authenticates admin demo account (ADM001 -> admin123 as CHIEF_WARDEN, SYSTEM scope) and rejects incorrect password', async () => {
      const adminLogin = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'ADM001', password: 'admin123' },
      });
      expect(adminLogin.statusCode).toBe(200);
      expect(adminLogin.json().session.role).toBe('CHIEF_WARDEN');
      expect(adminLogin.json().session.scopeType).toBe('SYSTEM');
      expect(adminLogin.json().session.collegeId).toBe('ADM001');

      // ADM001 cannot execute SUPER_ADMIN forceful allocation overrides
      const forceOverrideAttempt = await fastifyApp.inject({
        method: 'POST',
        url: '/api/admin/allocations/force-override',
        headers: { cookie: adminLogin.cookies.map((c: any) => `${c.name}=${c.value}`).join('; ') },
        payload: {
          cycleId: 'cyc_bvb_pilot_2026',
          studentId: 'prof_demo_001',
          seatId: 'st_rm_bvb_201_A',
          reason: 'Attempted demo override',
        },
      });
      expect(forceOverrideAttempt.statusCode).toBe(403);
      expect(forceOverrideAttempt.json().error).toContain('FORBIDDEN');

      const wrongLogin = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'ADM001', password: 'wrong' },
      });
      expect(wrongLogin.statusCode).toBe(401);
    });

    it('authenticates hostel office demo account (OFF001 -> office123) and rejects incorrect password', async () => {
      const officeLogin = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'OFF001', password: 'office123' },
      });
      expect(officeLogin.statusCode).toBe(200);
      expect(officeLogin.json().session.role).toBe('HOSTEL_OFFICE');
      expect(officeLogin.json().session.collegeId).toBe('OFF001');

      const wrongLogin = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'OFF001', password: 'wrong' },
      });
      expect(wrongLogin.statusCode).toBe(401);
    });

    it('verifies HttpOnly cookie issuance and session restoration via GET /api/auth/me', async () => {
      const loginRes = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'DEMO-001', password: 'password1' },
      });
      expect(loginRes.statusCode).toBe(200);

      // Verify Set-Cookie header contains HttpOnly token
      const cookieHeader = loginRes.headers['set-cookie'];
      expect(cookieHeader).toBeDefined();
      const tokenCookie = (Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader]).find((c: string) =>
        c.startsWith('token=')
      );
      expect(tokenCookie).toBeDefined();
      expect(tokenCookie).toContain('HttpOnly');

      const rawCookieVal = tokenCookie!.split(';')[0].replace('token=', '');

      // Verify GET /api/auth/me restores the session cleanly
      const meRes = await fastifyApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        cookies: { token: rawCookieVal },
      });
      expect(meRes.statusCode).toBe(200);
      const meBody = meRes.json();
      expect(meBody.userId).toBe('usr_demo_001');
      expect(meBody.collegeId).toBe('DEMO-001');
      expect(meBody.role).toBe('STUDENT');
    });
  });
});
