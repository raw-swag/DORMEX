import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { DatabaseService, getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';
import { DeviceAuthService } from '../src/auth/deviceAuthService.js';

describe('DORMEX Dynamic Demo Accounts Suite (18 Accounts Expansion)', () => {
  let app: FastifyInstance;
  let db: DatabaseService;
  let deviceAuthService: DeviceAuthService;
  let demoSessionToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_BOOTSTRAP_SECRET = 'TestBootstrapSecret123!';
    process.env.JWT_SECRET = 'TestSecretWithMinimum32CharactersRequired!';
    process.env.SEED_DEMO_DATA = 'true';

    resetDatabaseInstance();
    db = getDatabaseService(true);
    await runMigrations(db);
    await seedDatabase(db);

    app = await buildApp(db);
    await app.ready();
    deviceAuthService = (app as any).deviceAuthService;

    // Create an active demo session in slot 1 for test purposes
    await db.query(
      `UPDATE device_registration_slots 
       SET credential_id = 'test_cred_slot_1', public_key = 'fake_pubkey', counter = 0, is_revoked = FALSE, registered_at = NOW()
       WHERE slot_id = 'SLOT_01'`
    );

    // Issue demo session token directly
    const mockSessionToken = 'demo_sess_dynamic_test_token_18';
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    (deviceAuthService as any).activeDemoSessions.set(mockSessionToken, {
      token: mockSessionToken,
      slot_id: 'SLOT_01',
      device_label: 'Authorized Windows Laptop',
      platform: 'WINDOWS',
      user_verified: true,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
    demoSessionToken = mockSessionToken;
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (db) {
      await db.close();
    }
    resetDatabaseInstance();
  });

  it('1. Rejects unauthorized devices with HTTP 403 when requesting /api/demo/accounts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/demo/accounts',
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('FORBIDDEN');
    expect(body.accounts).toBeUndefined();
  });

  it('2. Returns all 18 canonical accounts (10 Students, 5 Hostel Office, 3 Admins) for authorized devices', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/demo/accounts',
      headers: {
        'x-demo-session': demoSessionToken,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.slot_id).toBe('SLOT_01');
    expect(Array.isArray(body.accounts)).toBe(true);
    expect(body.accounts.length).toBe(18);

    const collegeIds = body.accounts.map((a: any) => a.collegeId);
    
    // 10 Students: DEMO-001 through DEMO-010
    for (let i = 1; i <= 10; i++) {
      const pad = String(i).padStart(3, '0');
      expect(collegeIds).toContain(`DEMO-${pad}`);
    }

    // 5 Hostel Office: OFF001 through OFF005
    for (let i = 1; i <= 5; i++) {
      const pad = String(i).padStart(3, '0');
      expect(collegeIds).toContain(`OFF${pad}`);
    }

    // 3 Admins: ADM001 through ADM003
    expect(collegeIds).toContain('ADM001');
    expect(collegeIds).toContain('ADM002');
    expect(collegeIds).toContain('ADM003');

    // Verify portals
    const students = body.accounts.filter((a: any) => a.portal === 'STUDENT');
    expect(students.length).toBe(10);

    const office = body.accounts.filter((a: any) => a.portal === 'HOSTEL_OFFICE');
    expect(office.length).toBe(5);

    const admins = body.accounts.filter((a: any) => a.portal === 'ADMIN');
    expect(admins.length).toBe(3);

    // Verify none have SUPER_ADMIN by default
    const superAdmins = body.accounts.filter((a: any) => a.role === 'SUPER_ADMIN');
    expect(superAdmins.length).toBe(0);
  });

  it('3. Deactivating an account causes it to disappear from the dynamic list', async () => {
    // Deactivate OFF003
    await db.query(`UPDATE users SET is_active = FALSE WHERE college_id = 'OFF003'`);

    const res = await app.inject({
      method: 'GET',
      url: '/api/demo/accounts',
      headers: {
        'x-demo-session': demoSessionToken,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accounts.length).toBe(17);
    const collegeIds = body.accounts.map((a: any) => a.collegeId);
    expect(collegeIds).not.toContain('OFF003');
    expect(collegeIds).toContain('DEMO-001');
    expect(collegeIds).toContain('ADM001');

    // Restore OFF003
    await db.query(`UPDATE users SET is_active = TRUE WHERE college_id = 'OFF003'`);
  });

  it('4. Updating account details dynamically reflects in the response', async () => {
    // Update DEMO-001 name
    await db.query(`UPDATE users SET full_name = 'Aarav Sharma (Senior Lead)' WHERE college_id = 'DEMO-001'`);

    const res = await app.inject({
      method: 'GET',
      url: '/api/demo/accounts',
      headers: {
        'x-demo-session': demoSessionToken,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const studentAcc = body.accounts.find((a: any) => a.collegeId === 'DEMO-001');
    expect(studentAcc.fullName).toBe('Aarav Sharma (Senior Lead)');
    expect(studentAcc.label).toContain('Aarav Sharma (Senior Lead)');

    // Restore DEMO-001 name
    await db.query(`UPDATE users SET full_name = 'Aarav Sharma' WHERE college_id = 'DEMO-001'`);
  });

  it('5. Deactivated accounts cannot authenticate via /api/auth/login', async () => {
    // Deactivate ADM002
    await db.query(`UPDATE users SET is_active = FALSE WHERE college_id = 'ADM002'`);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        identifier: 'ADM002',
        password: 'admin123',
        portal: 'ADMIN',
      },
    });

    expect(loginRes.statusCode).toBe(401);
    const body = JSON.parse(loginRes.body);
    expect(body.error).toContain('Account is deactivated');

    // Restore ADM002
    await db.query(`UPDATE users SET is_active = TRUE WHERE college_id = 'ADM002'`);
  });

  it('6. Representative accounts from all 3 groups authenticate successfully via /api/auth/login', async () => {
    // Student DEMO-005
    const studentLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        identifier: 'DEMO-005',
        password: 'password5',
        portal: 'STUDENT',
      },
    });
    expect(studentLogin.statusCode).toBe(200);
    expect(JSON.parse(studentLogin.body).session.collegeId).toBe('DEMO-005');

    // Admin ADM003
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        identifier: 'ADM003',
        password: 'admin123',
        portal: 'ADMIN',
      },
    });
    expect(adminLogin.statusCode).toBe(200);
    expect(JSON.parse(adminLogin.body).session.collegeId).toBe('ADM003');

    // Hostel Office OFF004
    const officeLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        identifier: 'OFF004',
        password: 'office123',
        portal: 'HOSTEL_OFFICE',
      },
    });
    expect(officeLogin.statusCode).toBe(200);
    expect(JSON.parse(officeLogin.body).session.collegeId).toBe('OFF004');
  });

  it('7. Deleting a canonical account reports DEMO_ACCOUNTS_MISSING with exact missing collegeId', async () => {
    // Temporarily delete DEMO-007 user_roles and student profile and user
    await db.query(`DELETE FROM student_profiles WHERE user_id IN (SELECT id FROM users WHERE college_id = 'DEMO-007')`);
    await db.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE college_id = 'DEMO-007')`);
    await db.query(`DELETE FROM users WHERE college_id = 'DEMO-007'`);

    const res = await app.inject({
      method: 'GET',
      url: '/api/demo/accounts',
      headers: {
        'x-demo-session': demoSessionToken,
      },
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('DEMO_ACCOUNTS_MISSING: Expected 18 demo accounts but missing: DEMO-007');
  });
});
