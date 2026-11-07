import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { testEmailOutbox } from '../src/auth/service.js';
import { seedDatabase } from '../src/db/seed.js';

describe('Phase One & Four: Strict Priority Queue & Turn Enforcement Suite', () => {
  let app: any;
  let db: any;

  beforeAll(async () => {
    resetDatabaseInstance();
    db = getDatabaseService(true);
    const fastifyApp = await buildApp(db);
    await fastifyApp.ready();
    app = fastifyApp.server;
  }, 30000);

  it('Strict Priority 1 -> 2 -> 3 Turn Sequence & Waiting Rejection', async () => {
    // 1. Student A (DEMO-001, Priority 1), Student B (DEMO-002, Priority 2), Student C (DEMO-003, Priority 3) join waiting room
    const joinARes = await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
      .set('x-user-id', 'usr_demo_001')
      .send({ studentProfileId: 'prof_demo_001' });
    expect(joinARes.status).toBe(200);
    expect(joinARes.body.priorityNumber).toBe(1);
    const poolId = joinARes.body.poolId;

    const joinBRes = await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
      .set('x-user-id', 'usr_demo_002')
      .send({ studentProfileId: 'prof_demo_002' });
    expect(joinBRes.status).toBe(200);
    expect(joinBRes.body.priorityNumber).toBe(2);

    const joinCRes = await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
      .set('x-user-id', 'usr_demo_003')
      .send({ studentProfileId: 'prof_demo_003' });
    expect(joinCRes.status).toBe(200);
    expect(joinCRes.body.priorityNumber).toBe(3);

    // 2. Advance pool: Student A receives the ONE active session
    const adv1 = await request(app)
      .post(`/api/allocation-pools/${poolId}/advance`)
      .send();
    expect(adv1.status).toBe(200);
    expect(adv1.body.session).toBeDefined();
    expect(adv1.body.session.studentId).toBe('prof_demo_001');
    const sessionAId = adv1.body.session.sessionId;

    // 3. Advancing again while Student A is active returns Student A's session (Only 1 active session per pool)
    const advRepeat = await request(app)
      .post(`/api/allocation-pools/${poolId}/advance`)
      .send();
    expect(advRepeat.status).toBe(200);
    expect(advRepeat.body.session.studentId).toBe('prof_demo_001');
    expect(advRepeat.body.session.sessionId).toBe(sessionAId);

    // 4. Student B (waiting) attempts direct API seat confirmation using Student A's active session ID -> REJECTED
    const hackAttemptB = await request(app)
      .post(`/api/booking-sessions/${sessionAId}/confirm-seat`)
      .set('x-user-id', 'usr_demo_002')
      .send({ seatId: 'st_rm_bvb_201_B', idempotencyKey: 'hack_b_1' });
    expect(hackAttemptB.status).toBe(403);
    expect(hackAttemptB.body.error).toMatch(/NOT_YOUR_TURN/);

    // 5. Student C (waiting) attempts direct API seat confirmation using Student A's active session ID -> REJECTED
    const hackAttemptC = await request(app)
      .post(`/api/booking-sessions/${sessionAId}/confirm-seat`)
      .set('x-user-id', 'usr_demo_003')
      .send({ seatId: 'st_rm_bvb_201_C', idempotencyKey: 'hack_c_1' });
    expect(hackAttemptC.status).toBe(403);
    expect(hackAttemptC.body.error).toMatch(/NOT_YOUR_TURN/);

    // 6. Student A confirms seat st_rm_bvb_201_A successfully
    const confirmA = await request(app)
      .post(`/api/booking-sessions/${sessionAId}/confirm-seat`)
      .set('x-user-id', 'usr_demo_001')
      .send({ seatId: 'st_rm_bvb_201_A', idempotencyKey: 'confirm_a_1' });
    expect(confirmA.status).toBe(200);
    expect(confirmA.body.status).toBe('CURRENT');
    expect(confirmA.body.seatId).toBe('st_rm_bvb_201_A');

    // 7. Queue automatically advances to Priority 2 (Student B)
    const adv2 = await request(app)
      .post(`/api/allocation-pools/${poolId}/advance`)
      .send();
    expect(adv2.status).toBe(200);
    expect(adv2.body.session).toBeDefined();
    expect(adv2.body.session.studentId).toBe('prof_demo_002');
    const sessionBId = adv2.body.session.sessionId;

    // 8. Student C still cannot confirm while Student B is active
    const hackAttemptC2 = await request(app)
      .post(`/api/booking-sessions/${sessionBId}/confirm-seat`)
      .set('x-user-id', 'usr_demo_003')
      .send({ seatId: 'st_rm_bvb_201_B', idempotencyKey: 'hack_c_2' });
    expect(hackAttemptC2.status).toBe(403);
    expect(hackAttemptC2.body.error).toMatch(/NOT_YOUR_TURN/);

    // 9. Student B cannot select Student A's already allocated seat st_rm_bvb_201_A
    const conflictAttemptB = await request(app)
      .post(`/api/booking-sessions/${sessionBId}/confirm-seat`)
      .set('x-user-id', 'usr_demo_002')
      .send({ seatId: 'st_rm_bvb_201_A', idempotencyKey: 'conflict_b_1' });
    expect(conflictAttemptB.status).toBe(409);
    expect(conflictAttemptB.body.error).toMatch(/SEAT_UNAVAILABLE/);

    // 10. Student B confirms available seat st_rm_bvb_201_B
    const confirmB = await request(app)
      .post(`/api/booking-sessions/${sessionBId}/confirm-seat`)
      .set('x-user-id', 'usr_demo_002')
      .send({ seatId: 'st_rm_bvb_201_B', idempotencyKey: 'confirm_b_1' });
    expect(confirmB.status).toBe(200);
    expect(confirmB.body.status).toBe('CURRENT');
    expect(confirmB.body.seatId).toBe('st_rm_bvb_201_B');

    // 11. Queue advances to Priority 3 (Student C)
    const adv3 = await request(app)
      .post(`/api/allocation-pools/${poolId}/advance`)
      .send();
    expect(adv3.status).toBe(200);
    expect(adv3.body.session).toBeDefined();
    expect(adv3.body.session.studentId).toBe('prof_demo_003');
    const sessionCId = adv3.body.session.sessionId;

    // 12. Student C confirms seat st_rm_bvb_201_C
    const confirmC = await request(app)
      .post(`/api/booking-sessions/${sessionCId}/confirm-seat`)
      .set('x-user-id', 'usr_demo_003')
      .send({ seatId: 'st_rm_bvb_201_C', idempotencyKey: 'confirm_c_1' });
    expect(confirmC.status).toBe(200);
    expect(confirmC.body.status).toBe('CURRENT');
    expect(confirmC.body.seatId).toBe('st_rm_bvb_201_C');

    // 13. Queue is now completely empty
    const advEmpty = await request(app)
      .post(`/api/allocation-pools/${poolId}/advance`)
      .send();
    expect(advEmpty.status).toBe(200);
    expect(advEmpty.body.session).toBeNull();
  });

  it('Turn Expiry behavior: Expired turn automatically advances to next waiting student', async () => {
    // Student DEMO-004 & DEMO-005 join
    const joinARes = await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
      .set('x-user-id', 'usr_demo_004')
      .send({ studentProfileId: 'prof_demo_004' });
    const poolId = joinARes.body.poolId;

    await request(app)
      .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
      .set('x-user-id', 'usr_demo_005')
      .send({ studentProfileId: 'prof_demo_005' });

    // Grant Student DEMO-004 active session
    const adv1 = await request(app)
      .post(`/api/allocation-pools/${poolId}/advance`)
      .send();
    expect(adv1.body.session).toBeDefined();
    expect(adv1.body.session.studentId).toBe('prof_demo_004');
    const sessionAId = adv1.body.session.sessionId;

    // Manually simulate turn expiration by updating expires_at to 10 seconds in the past in DB
    const pastTime = new Date(Date.now() - 10000).toISOString();
    await db.query(`UPDATE booking_sessions SET expires_at = $1 WHERE id = $2`, [pastTime, sessionAId]);

    // Student DEMO-004 tries to confirm expired turn -> REJECTED with TURN_EXPIRED
    const expiredAttempt = await request(app)
      .post(`/api/booking-sessions/${sessionAId}/confirm-seat`)
      .set('x-user-id', 'usr_demo_004')
      .send({ seatId: 'st_rm_bvb_202_A' });
    expect(expiredAttempt.status).toBe(400);
    expect(expiredAttempt.body.error).toMatch(/TURN_EXPIRED/);

    // Queue advances to Student DEMO-005
    const adv2 = await request(app)
      .post(`/api/allocation-pools/${poolId}/advance`)
      .send();
    expect(adv2.status).toBe(200);
    expect(adv2.body.session.studentId).toBe('prof_demo_005');
  });

  it('Password Recovery End-to-End: Token Generation, Expiration, and Consumed Single-Use Enforced', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalHost = process.env.HOST;
    const originalSmtpHost = process.env.SMTP_HOST;
    const originalSmtpUser = process.env.SMTP_USER;
    const originalSimulateFailure = process.env.SIMULATE_SMTP_FAILURE;

    const expectedNeutralMessage =
      "If an eligible institutional account matches the supplied identifier, the password recovery request has been received. Follow the recovery instructions provided through your institution's approved process. For assistance, contact the Hostel Office Desk (OFF001).";

    try {
      // Clear isolated test outbox
      testEmailOutbox.clear();
      process.env.NODE_ENV = 'test';

      // 1. Request password reset for DEMO-001
      const reqRes = await request(app)
        .post('/api/auth/forgot-password')
        .send({ identifier: 'DEMO-001' });
      expect(reqRes.status).toBe(200);
      expect(reqRes.body.success).toBe(true);
      expect(reqRes.body.message).toBe(expectedNeutralMessage);
      expect(reqRes.body.status).toBe('REQUEST_ACCEPTED');

      // CRITICAL: Public HTTP response MUST NOT contain any token, debugToken, or reset URL
      expect(reqRes.body.debugToken).toBeUndefined();
      expect(reqRes.body.token).toBeUndefined();
      expect(reqRes.body.resetUrl).toBeUndefined();
      expect(JSON.stringify(reqRes.body)).not.toMatch(/[a-f0-9]{64}/); // No 32-byte hex token in JSON
      expect(reqRes.body.message).not.toContain('dispatched');
      expect(reqRes.body.message).not.toContain('sent');

      // 2. Automated test internally retrieves the token from the isolated test outbox
      const capturedMessage = testEmailOutbox.getLatestMessage();
      expect(capturedMessage).toBeDefined();
      expect(capturedMessage?.to).toBe('demo.001@college.edu');
      expect(capturedMessage?.token).toBeDefined();
      expect(capturedMessage?.token.length).toBe(64);
      const token = capturedMessage!.token;

      // 3. Request for non-existent user returns identical generic success message (no user enumeration)
      const outboxCountBefore = testEmailOutbox.getMessages().length;
      const reqNonExist = await request(app)
        .post('/api/auth/forgot-password')
        .send({ identifier: 'NON_EXISTENT_USN_999' });
      expect(reqNonExist.status).toBe(200);
      expect(reqNonExist.body.success).toBe(true);
      expect(reqNonExist.body.message).toBe(expectedNeutralMessage);
      expect(reqNonExist.body.status).toBe('REQUEST_ACCEPTED');
      expect(reqNonExist.body.debugToken).toBeUndefined();
      expect(reqNonExist.body.token).toBeUndefined();
      // Exact deep equality between existing and nonexistent responses
      expect(reqNonExist.body).toEqual(reqRes.body);
      // No outbox message created for non-existent user
      expect(testEmailOutbox.getMessages().length).toBe(outboxCountBefore);
      // Internal delivery outcome reflects no account match
      expect(testEmailOutbox.getLastDeliveryOutcome()).toBe('NO_ACCOUNT_MATCH');

      // 4. Reset password with invalid / malformed token -> Rejected
      const invalidTokenAttempt = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'invalid_malformed_token_12345', newPassword: 'SuperSecureNewPassword123!' });
      expect(invalidTokenAttempt.status).toBe(400);
      expect(invalidTokenAttempt.body.error).toMatch(/INVALID_TOKEN/);

      // 5. Reset password with token < 8 chars -> Rejected
      const weakAttempt = await request(app)
        .post('/api/auth/reset-password')
        .send({ token, newPassword: 'short' });
      expect(weakAttempt.status).toBe(400);
      expect(weakAttempt.body.error).toMatch(/WEAK_PASSWORD/);

      // 6. Reset password successfully with captured token
      const successReset = await request(app)
        .post('/api/auth/reset-password')
        .send({ token, newPassword: 'SuperSecureNewPassword123!' });
      expect(successReset.status).toBe(200);
      expect(successReset.body.success).toBe(true);

      // 7. Attempting to reuse the same token is rejected (Consumed Single-Use)
      const reuseAttempt = await request(app)
        .post('/api/auth/reset-password')
        .send({ token, newPassword: 'AnotherPassword456!' });
      expect(reuseAttempt.status).toBe(400);
      expect(reuseAttempt.body.error).toMatch(/TOKEN_REUSED/);

      // 8. Expired token rejection test:
      testEmailOutbox.clear();
      const reqDemo2 = await request(app)
        .post('/api/auth/forgot-password')
        .send({ identifier: 'DEMO-002' });
      expect(reqDemo2.status).toBe(200);
      expect(reqDemo2.body.debugToken).toBeUndefined();
      const tokenDemo2 = testEmailOutbox.getLatestMessage()!.token;

      // Fast-forward expiration in DB
      await db.query(
        `UPDATE password_reset_tokens SET expires_at = $1 WHERE user_id = 'usr_demo_002'`,
        [new Date(Date.now() - 60000).toISOString()]
      );

      const expiredAttempt = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: tokenDemo2, newPassword: 'ExpiredTokenPassword123!' });
      expect(expiredAttempt.status).toBe(400);
      expect(expiredAttempt.body.error).toMatch(/TOKEN_EXPIRED/);

      // 9. Zero Token Exposure Across All Environments:
      const envsToTest = ['production', 'development', 'staging', ''];
      for (const envVal of envsToTest) {
        if (envVal === '') {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = envVal;
        }
        const resp = await request(app)
          .post('/api/auth/forgot-password')
          .send({ identifier: 'DEMO-001' });
        expect(resp.status).toBe(200);
        expect(resp.body.success).toBe(true);
        expect(resp.body.debugToken).toBeUndefined();
        expect(resp.body.token).toBeUndefined();
        expect(resp.body.resetUrl).toBeUndefined();
        expect(JSON.stringify(resp.body)).not.toMatch(/[a-f0-9]{64}/);
        expect(resp.body.status).toBe('REQUEST_ACCEPTED');
        expect(resp.body.message).toBe(expectedNeutralMessage);
      }

      // 10. Comprehensive 5-Combination Matrix (4 existence/config combos + SMTP Failure):
      // Comb 1: Existing account + SMTP missing
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SIMULATE_SMTP_FAILURE;
      process.env.NODE_ENV = 'production';
      const c1Existing = await request(app).post('/api/auth/forgot-password').send({ identifier: 'DEMO-001' });
      expect(testEmailOutbox.getLastDeliveryOutcome()).toBe('OFFICE_ASSISTANCE');

      // Comb 2: Nonexistent account + SMTP missing
      const c2Nonexistent = await request(app).post('/api/auth/forgot-password').send({ identifier: 'NON_EXISTENT_999' });
      expect(testEmailOutbox.getLastDeliveryOutcome()).toBe('NO_ACCOUNT_MATCH');

      expect(c1Existing.status).toBe(200);
      expect(c2Nonexistent.status).toBe(200);
      expect(c1Existing.body).toEqual(c2Nonexistent.body);
      expect(c1Existing.body).toEqual({
        success: true,
        message: expectedNeutralMessage,
        status: 'REQUEST_ACCEPTED',
      });

      // Comb 3: Existing account + SMTP configured (EMAIL_SENT)
      process.env.SMTP_HOST = 'smtp.institution.edu';
      process.env.SMTP_USER = 'auth-mailer@institution.edu';
      delete process.env.SIMULATE_SMTP_FAILURE;
      const c3Existing = await request(app).post('/api/auth/forgot-password').send({ identifier: 'DEMO-001' });
      expect(testEmailOutbox.getLastDeliveryOutcome()).toBe('EMAIL_SENT');

      // Comb 4: Nonexistent account + SMTP configured (NO_ACCOUNT_MATCH)
      const c4Nonexistent = await request(app).post('/api/auth/forgot-password').send({ identifier: 'NON_EXISTENT_999' });
      expect(testEmailOutbox.getLastDeliveryOutcome()).toBe('NO_ACCOUNT_MATCH');

      expect(c3Existing.status).toBe(200);
      expect(c4Nonexistent.status).toBe(200);
      expect(c3Existing.body).toEqual(c4Nonexistent.body);
      expect(c3Existing.body).toEqual(c1Existing.body);

      // Comb 5: SMTP Delivery Failure for existing account (EMAIL_FAILED)
      process.env.SIMULATE_SMTP_FAILURE = 'true';
      const c5Failure = await request(app).post('/api/auth/forgot-password').send({ identifier: 'DEMO-001' });
      expect(testEmailOutbox.getLastDeliveryOutcome()).toBe('EMAIL_FAILED');
      expect(c5Failure.status).toBe(200);
      // Public response remains strictly identical
      expect(c5Failure.body).toEqual(c1Existing.body);
    } finally {
      if (originalEnv !== undefined) {
        process.env.NODE_ENV = originalEnv;
      } else {
        delete process.env.NODE_ENV;
      }
      if (originalHost !== undefined) {
        process.env.HOST = originalHost;
      } else {
        delete process.env.HOST;
      }
      if (originalSmtpHost !== undefined) {
        process.env.SMTP_HOST = originalSmtpHost;
      } else {
        delete process.env.SMTP_HOST;
      }
      if (originalSmtpUser !== undefined) {
        process.env.SMTP_USER = originalSmtpUser;
      } else {
        delete process.env.SMTP_USER;
      }
      if (originalSimulateFailure !== undefined) {
        process.env.SIMULATE_SMTP_FAILURE = originalSimulateFailure;
      } else {
        delete process.env.SIMULATE_SMTP_FAILURE;
      }
      testEmailOutbox.clear();
    }
  });

  describe('Production Seed Isolation Suite (4-Case Verification)', () => {
    const runSeedWithEnv = async (nodeEnv: string, seedDemoData: string) => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalSeedDemo = process.env.SEED_DEMO_DATA;
      const originalJwtSecret = process.env.JWT_SECRET;
      try {
        process.env.NODE_ENV = nodeEnv;
        process.env.SEED_DEMO_DATA = seedDemoData;
        if (nodeEnv === 'production') {
          process.env.JWT_SECRET = 'dormex-test-production-jwt-signing-secret-32-chars-long';
        }
        resetDatabaseInstance();
        const testDb = getDatabaseService(true);
        const fastifyApp = await buildApp(testDb);
        await fastifyApp.ready();
        const demoCountRes = await testDb.query(
          "SELECT COUNT(id) as cnt FROM users WHERE college_id LIKE 'DEMO-%'"
        );
        const buildingCountRes = await testDb.query(
          "SELECT COUNT(id) as cnt FROM buildings WHERE code = 'BVB'"
        );
        const seatCountRes = await testDb.query(
          "SELECT COUNT(id) as cnt FROM seats"
        );
        return {
          demoCount: parseInt(demoCountRes.rows[0].cnt, 10),
          bvbBuildingExists: parseInt(buildingCountRes.rows[0].cnt, 10) > 0,
          hasSeats: parseInt(seatCountRes.rows[0].cnt, 10) > 0,
        };
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        process.env.SEED_DEMO_DATA = originalSeedDemo;
        if (originalJwtSecret !== undefined) {
          process.env.JWT_SECRET = originalJwtSecret;
        } else {
          delete process.env.JWT_SECRET;
        }
      }
    };

    it('Case 1: development + SEED_DEMO_DATA=true -> allowed (30 demo records seeded)', async () => {
      const res = await runSeedWithEnv('development', 'true');
      expect(res.demoCount).toBe(30);
      expect(res.bvbBuildingExists).toBe(true);
      expect(res.hasSeats).toBe(true);
    });

    it('Case 2: test + SEED_DEMO_DATA=true -> allowed (30 demo records seeded)', async () => {
      const res = await runSeedWithEnv('test', 'true');
      expect(res.demoCount).toBe(30);
      expect(res.bvbBuildingExists).toBe(true);
      expect(res.hasSeats).toBe(true);
    });

    it('Case 3: production + SEED_DEMO_DATA=false -> blocked (0 demo records seeded, master inventory preserved)', async () => {
      const res = await runSeedWithEnv('production', 'false');
      expect(res.demoCount).toBe(0);
      expect(res.bvbBuildingExists).toBe(true);
      expect(res.hasSeats).toBe(true);
    });

    it('Case 4: production + SEED_DEMO_DATA=true -> blocked (0 demo records seeded, override rejected)', async () => {
      const res = await runSeedWithEnv('production', 'true');
      expect(res.demoCount).toBe(0);
      expect(res.bvbBuildingExists).toBe(true);
      expect(res.hasSeats).toBe(true);
    });

    it('Case 5: NODE_ENV unset -> blocked (0 demo records seeded, fail-safe)', async () => {
      const res = await runSeedWithEnv('', 'false');
      expect(res.demoCount).toBe(0);
      expect(res.bvbBuildingExists).toBe(true);
      expect(res.hasSeats).toBe(true);
    });

    it('Case 6: unknown NODE_ENV (e.g. staging) -> blocked (0 demo records seeded, fail-safe)', async () => {
      const res = await runSeedWithEnv('staging', 'false');
      expect(res.demoCount).toBe(0);
      expect(res.bvbBuildingExists).toBe(true);
      expect(res.hasSeats).toBe(true);
    });

    it('Case 7: production startup without JWT_SECRET fails safely', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalJwt = process.env.JWT_SECRET;
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.JWT_SECRET;
        resetDatabaseInstance();
        await expect(buildApp()).rejects.toThrow(/FATAL_CONFIG_ERROR/);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalJwt !== undefined) process.env.JWT_SECRET = originalJwt;
      }
    });

    it('Case 8: Re-seeding preserves valid DEMO-029 and DEMO-030 authentication hashes', async () => {
      resetDatabaseInstance();
      const testDb = getDatabaseService(true);
      process.env.NODE_ENV = 'test';
      process.env.SEED_DEMO_DATA = 'true';
      const fastifyApp = await buildApp(testDb);
      await fastifyApp.ready();

      // First login verification with new demo password convention
      const login1 = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'DEMO-029', password: 'password29' },
      });
      expect(login1.statusCode).toBe(200);

      // Re-run seed on the same database
      await seedDatabase(testDb);

      // Second login verification after re-seed
      const login2 = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'DEMO-029', password: 'password29' },
      });
      expect(login2.statusCode).toBe(200);

      const login3 = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'DEMO-030', password: 'password30' },
      });
      expect(login3.statusCode).toBe(200);
      await fastifyApp.close();
    });

    it('authenticates representative student (DEMO-001 -> password1), admin (ADM001 -> admin123), and hostel office (OFF001 -> office123) demo accounts', async () => {
      resetDatabaseInstance();
      const testDb = getDatabaseService(true);
      process.env.NODE_ENV = 'test';
      process.env.SEED_DEMO_DATA = 'true';
      const fastifyApp = await buildApp(testDb);
      await fastifyApp.ready();

      // 1. Student demo accounts: DEMO-001 -> password1, DEMO-002 -> password2, DEMO-029 -> password29
      const student1Login = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'DEMO-001', password: 'password1' },
      });
      expect(student1Login.statusCode).toBe(200);
      const student1Data = student1Login.json();
      expect(student1Data.session.role).toBe('STUDENT');
      expect(student1Data.session.collegeId).toBe('DEMO-001');

      const student2Login = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'DEMO-002', password: 'password2' },
      });
      expect(student2Login.statusCode).toBe(200);

      // Wrong password rejected
      const studentWrongLogin = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'DEMO-001', password: 'wrongpassword' },
      });
      expect(studentWrongLogin.statusCode).toBe(401);

      // 2. Admin demo account: ADM001 -> admin123 (CHIEF_WARDEN role, SYSTEM scope)
      const adminLogin = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'ADM001', password: 'admin123' },
      });
      expect(adminLogin.statusCode).toBe(200);
      const adminData = adminLogin.json();
      expect(adminData.session.role).toBe('CHIEF_WARDEN');
      expect(adminData.session.scopeType).toBe('SYSTEM');
      expect(adminData.session.collegeId).toBe('ADM001');

      // ADM001 is strictly forbidden from SUPER_ADMIN-only force allocation override
      const forceOverrideRes = await fastifyApp.inject({
        method: 'POST',
        url: '/api/admin/allocations/force-override',
        headers: { cookie: adminLogin.cookies.map((c: any) => `${c.name}=${c.value}`).join('; ') },
        payload: {
          cycleId: 'cyc_bvb_pilot_2026',
          studentId: 'prof_demo_001',
          seatId: 'st_rm_bvb_201_A',
          reason: 'Unauthorized demo override attempt',
        },
      });
      expect(forceOverrideRes.statusCode).toBe(403);
      expect(forceOverrideRes.json().error).toContain('FORBIDDEN');

      // Admin wrong password rejected
      const adminWrongLogin = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'ADM001', password: 'wrongpassword' },
      });
      expect(adminWrongLogin.statusCode).toBe(401);

      // 3. Hostel Office demo account: OFF001 -> office123
      const officeLogin = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'OFF001', password: 'office123' },
      });
      expect(officeLogin.statusCode).toBe(200);
      const officeData = officeLogin.json();
      expect(officeData.session.role).toBe('HOSTEL_OFFICE');
      expect(officeData.session.collegeId).toBe('OFF001');

      // Office wrong password rejected
      const officeWrongLogin = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: 'OFF001', password: 'wrongpassword' },
      });
      expect(officeWrongLogin.statusCode).toBe(401);

      await fastifyApp.close();
    });
  });



  describe('Deterministic Priority & Tie-Breaking Suite', () => {
    it('breaks equal waiting room priority ties deterministically using FIFO (joined_at) and college_id', async () => {
      // Join prof_demo_010 and prof_demo_011 to cycle and pool
      const j10 = await request(app)
        .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
        .set('x-user-id', 'usr_demo_010')
        .send({ studentProfileId: 'prof_demo_010' });
      expect(j10.status).toBe(200);

      const j11 = await request(app)
        .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
        .set('x-user-id', 'usr_demo_011')
        .send({ studentProfileId: 'prof_demo_011' });
      expect(j11.status).toBe(200);

      const poolId = j10.body.poolId;

      // Suspend any other waiting entries and sessions in this pool
      await db.query("DELETE FROM booking_sessions WHERE pool_id = $1", [poolId]);
      await db.query("UPDATE waiting_room_entries SET status = 'SKIPPED' WHERE pool_id = $1", [poolId]);

      // Null assigned priorities to test queue tie-breaker on priority_number + FIFO joined_at
      await db.query(
        "UPDATE student_profiles SET assigned_priority = NULL WHERE id IN ('prof_demo_010', 'prof_demo_011')"
      );
      await db.query(
        "UPDATE waiting_room_entries SET status = 'WAITING', priority_number = 50, joined_at = '2026-08-10T10:00:00Z' WHERE student_id = 'prof_demo_010'"
      );
      await db.query(
        "UPDATE waiting_room_entries SET status = 'WAITING', priority_number = 50, joined_at = '2026-08-10T10:05:00Z' WHERE student_id = 'prof_demo_011'"
      );

      // Advance: prof_demo_010 wins due to earlier FIFO (joined_at)
      const adv1 = await request(app)
        .post('/api/allocation-pools/' + poolId + '/advance')
        .send();
      expect(adv1.status).toBe(200);
      expect(adv1.body.session.studentId).toBe('prof_demo_010');

      // Clear 0010 session and confirm entry
      await db.query("DELETE FROM booking_sessions WHERE student_id = 'prof_demo_010'");
      await db.query("UPDATE waiting_room_entries SET status = 'CONFIRMEDC' WHERE student_id = 'prof_demo_010'");

      // Next advance gives turn to prof_demo_011
      const adv2 = await request(app)
        .post('/api/allocation-pools/' + poolId + '/advance')
        .send();
      expect(adv2.status).toBe(200);
      expect(adv2.body.session.studentId).toBe('prof_demo_011');
    });

    it('stable secondary tie-breaker: college_id ASC breaks tie when priority and FIFO timestamp are identical', async () => {
      const j13 = await request(app)
        .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
        .set('x-user-id', 'usr_demo_013')
        .send({ studentProfileId: 'prof_demo_013' });
      expect(j13.status).toBe(200);

      const j14 = await request(app)
        .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
        .set('x-user-id', 'usr_demo_014')
        .send({ studentProfileId: 'prof_demo_014' });
      expect(j14.status).toBe(200);

      const poolId = j13.body.poolId;

      await db.query("DELETE FROM booking_sessions WHERE pool_id = $1", [poolId]);
      await db.query("UPDATE waiting_room_entries SET status = 'SKIPPED' WHERE pool_id = $1", [poolId]);

      // Null assigned priorities, identical priority_number 60, exactly identical joined_at
      await db.query(
        "UPDATE student_profiles SET assigned_priority = NULL WHERE id IN ('prof_demo_013', 'prof_demo_014')"
      );
      await db.query(
        "UPDATE waiting_room_entries SET status = 'WAITING', priority_number = 60, joined_at = '2026-08-10T12:00:00Z' WHERE student_id IN ('prof_demo_013', 'prof_demo_014')"
      );

      // DEMO-013 < DEMO-014 so prof_demo_013 wins deterministically
      const adv = await request(app)
        .post('/api/allocation-pools/' + poolId + '/advance')
        .send();
      expect(adv.status).toBe(200);
      expect(adv.body.session.studentId).toBe('prof_demo_013');
    });

    it('fee payment timestamp cannot displace assigned priority', async () => {
      const j15 = await request(app)
        .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
        .set('x-user-id', 'usr_demo_015')
        .send({ studentProfileId: 'prof_demo_015' });
      expect(j15.status).toBe(200);

      const j16 = await request(app)
        .post('/api/allocation-cycles/cyc_bvb_pilot_2026/join')
        .set('x-user-id', 'usr_demo_016')
        .send({ studentProfileId: 'prof_demo_016' });
      expect(j16.status).toBe(200);

      const poolId = j15.body.poolId;

      await db.query("DELETE FROM booking_sessions WHERE pool_id = $1", [poolId]);
      await db.query("UPDATE waiting_room_entries SET status = 'SKIPPED' WHERE pool_id = $1", [poolId]);

      // Student 15 has assigned_priority 15 (late payment)
      // Student 16 has assigned_priority 16 (early payment)
      await db.query(
        "UPDATE student_profiles SET fee_payment_timestamp = '2026-08-15T00:00:00Z' WHERE id = 'prof_demo_015'"
      );
      await db.query(
        "UPDATE student_profiles SET fee_payment_timestamp = '2026-08-01T00:00:00Z' WHERE id = 'prof_demo_016'"
      );

      await db.query(
        "UPDATE waiting_room_entries SET status = 'WAITING' WHERE student_id = 'prof_demo_015'"
      );
      await db.query(
        "UPDATE waiting_room_entries SET status = 'WAITING' WHERE student_id = 'prof_demo_016'"
      );

      const adv = await request(app)
        .post('/api/allocation-pools/' + poolId + '/advance')
        .send();
      expect(adv.status).toBe(200);
      expect(adv.body.session.studentId).toBe('prof_demo_015');
    });
  });

});
