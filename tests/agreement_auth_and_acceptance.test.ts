import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { DEV_USERS } from '../src/client/context/AuthContext.js';

describe('DORMEX Step 5 Agreement Acceptance & Authentication Security Suite', () => {
  let app: FastifyInstance;
  let db: any;
  const originalEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    resetDatabaseInstance();
    db = getDatabaseService(true);
    app = await buildApp(db);
    await app.ready();
  }, 30000);

  afterAll(async () => {
    process.env.NODE_ENV = originalEnv;
    if (app) {
      await app.close();
    }
  });

  // Helper to issue legitimate signed tokens
  const signToken = (payload: { sub: string; role: string; [key: string]: any }, options: any = {}) => {
    return (app as any).jwt.sign(payload, options);
  };

  describe('1. Authentication Tests', () => {
    it('1. Valid signed student credential accepted', async () => {
      const token = signToken({
        sub: 'usr_demo_029',
        role: 'STUDENT',
        college_id: 'DEMO-029',
        student_profile_id: 'prof_demo_029',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: { termsVersion: 1, acknowledged: true },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.termsVersion).toBe(1);
    });

    it('2. Missing credential returns 401 in production mode', async () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/students/prof_demo_029/accept-terms',
          payload: { termsVersion: 1, acknowledged: true },
        });

        expect(res.statusCode).toBe(401);
        expect(res.json().error).toMatch(/UNAUTHORIZED: Missing or unauthenticated credentials/);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    it('3. Malformed credential returns 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: {
          authorization: 'Bearer this.is.a.malformed.jwt.token',
        },
        payload: { termsVersion: 1, acknowledged: true },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/UNAUTHORIZED: Malformed or invalid token/);
    });

    it('4. Expired credential returns 401', async () => {
      // Issue token already expired 10 seconds ago
      const token = (app as any).jwt.sign(
        { sub: 'usr_demo_029', role: 'STUDENT', college_id: 'DEMO-029' },
        { expiresIn: -10 }
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: { termsVersion: 1, acknowledged: true },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/UNAUTHORIZED: Token expired/);
    });

    it('5. Incorrect signature returns 401', async () => {
      // Sign with an illegitimate third-party key
      const Fastify = (await import('fastify')).default;
      const fastifyJwt = (await import('@fastify/jwt')).default;
      const rogueApp = Fastify();
      await rogueApp.register(fastifyJwt, { secret: 'rogue-unauthorized-key' });
      await rogueApp.ready();
      const rogueToken = rogueApp.jwt.sign({ sub: 'usr_demo_029', role: 'STUDENT' });
      await rogueApp.close();

      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: {
          authorization: `Bearer ${rogueToken}`,
        },
        payload: { termsVersion: 1, acknowledged: true },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/UNAUTHORIZED: Invalid signature/);
    });

    it('6. Missing identity claims rejected with 401', async () => {
      const tokenWithoutSub = (app as any).jwt.sign({ foo: 'bar' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: {
          authorization: `Bearer ${tokenWithoutSub}`,
        },
        payload: { termsVersion: 1, acknowledged: true },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/UNAUTHORIZED: Missing mandatory identity claims/);
    });

    it('7. Authenticated student is mapped to their canonical database actor profile', async () => {
      const token = signToken({ sub: 'usr_demo_030', role: 'STUDENT', college_id: 'DEMO-030' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const me = res.json();
      expect(me.userId).toBe('usr_demo_030');
      expect(me.collegeId).toBe('DEMO-030');
      expect(me.profileId).toBe('prof_demo_030');
      expect(me.role).toBe('STUDENT');
    });

    it('8. x-user-id alone cannot authenticate or override student in production', async () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/students/prof_demo_029/accept-terms',
          headers: {
            'x-user-id': 'usr_demo_029', // Not trusted in production without signed credential
          },
          payload: { termsVersion: 1, acknowledged: true },
        });

        expect(res.statusCode).toBe(401);
        expect(res.json().error).toMatch(/UNAUTHORIZED: Missing or unauthenticated credentials/);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    it('9. Default usr_student_1 fallback cannot authenticate unauthenticated request', async () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/students/prof_stu_1/accept-terms',
          // No headers whatsoever
          payload: { termsVersion: 1, acknowledged: true },
        });

        expect(res.statusCode).toBe(401);
        expect(res.json().error).toMatch(/UNAUTHORIZED/);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    it('10. Valid JWT combined with conflicting x-user-id header prioritizes verified JWT subject', async () => {
      // Token belongs to usr_demo_029
      const token = signToken({
        sub: 'usr_demo_029',
        role: 'STUDENT',
        college_id: 'DEMO-029',
        student_profile_id: 'prof_demo_029',
      });

      // Request passes conflicting x-user-id for usr_demo_030
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${token}`,
          'x-user-id': 'usr_demo_030', // Rogue/conflicting header
        },
      });

      expect(res.statusCode).toBe(200);
      const me = res.json();
      // MUST match the cryptographically verified JWT subject (usr_demo_029), NEVER the unverified header
      expect(me.userId).toBe('usr_demo_029');
      expect(me.collegeId).toBe('DEMO-029');
      expect(me.profileId).toBe('prof_demo_029');
    });

    it('11. In development, x-user-id shortcut is strictly disabled (only permitted in NODE_ENV=test)', async () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      try {
        // Development environment strictly rejects x-user-id header without signed credential
        const rejectRes = await app.inject({
          method: 'POST',
          url: '/api/students/prof_demo_029/accept-terms',
          headers: {
            'x-user-id': 'usr_demo_029',
          },
          payload: { termsVersion: 1, acknowledged: true },
        });
        expect(rejectRes.statusCode).toBe(401);
        expect(rejectRes.json().error).toMatch(/UNAUTHORIZED: Missing or unauthenticated credentials/);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    it('12. Missing production JWT secret prevents application startup', async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevSecret = process.env.JWT_SECRET;
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;

      try {
        const { buildApp: testBuildApp } = await import('../src/app.js');
        await expect(testBuildApp(db)).rejects.toThrow(/Production requires an externally supplied JWT_SECRET/);
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevSecret !== undefined) {
          process.env.JWT_SECRET = prevSecret;
        }
      }
    });
  });

  describe('2. Authorization Tests', () => {
    it('1. Student can accept their own agreement', async () => {
      const token = signToken({
        sub: 'usr_demo_030',
        role: 'STUDENT',
        college_id: 'DEMO-030',
        student_profile_id: 'prof_demo_030',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_030/accept-terms',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: { termsVersion: 1, acknowledged: true },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('2. Student cannot accept another student agreement (403)', async () => {
      // Student 30 attempts to accept terms for Student 29
      const token = signToken({
        sub: 'usr_demo_030',
        role: 'STUDENT',
        college_id: 'DEMO-030',
        student_profile_id: 'prof_demo_030',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: { termsVersion: 1, acknowledged: true },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/FORBIDDEN: Cannot accept terms on behalf of another student/);
    });

    it('3. Proctor is rejected from accepting student terms (403)', async () => {
      const token = signToken({ sub: 'usr_proctor_1', role: 'PROCTOR' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: { termsVersion: 1, acknowledged: true },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/FORBIDDEN: Insufficient permissions to accept hostel terms/);
    });

    it('4. Warden is rejected from accepting student terms (403)', async () => {
      const token = signToken({ sub: 'usr_warden_bvb', role: 'WARDEN' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: { termsVersion: 1, acknowledged: true },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/FORBIDDEN: Insufficient permissions to accept hostel terms/);
    });

    it('5. Chief Warden is rejected from accepting student terms (403)', async () => {
      const token = signToken({ sub: 'usr_chief', role: 'CHIEF_WARDEN' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: { termsVersion: 1, acknowledged: true },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/FORBIDDEN: Insufficient permissions to accept hostel terms/);
    });

    it('6. Hostel Office is rejected from accepting student terms (403)', async () => {
      const token = signToken({ sub: 'usr_office', role: 'HOSTEL_OFFICE' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: { termsVersion: 1, acknowledged: true },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/FORBIDDEN: Insufficient permissions to accept hostel terms/);
    });

    it('7. Super Admin is rejected from accepting student terms (403)', async () => {
      const token = signToken({ sub: 'usr_admin', role: 'SUPER_ADMIN' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: { termsVersion: 1, acknowledged: true },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/FORBIDDEN: Insufficient permissions to accept hostel terms/);
    });
  });

  describe('3. Agreement Contract & Validation Tests', () => {
    it('1. Valid acknowledgement succeeds and returns expected state', async () => {
      const token = signToken({ sub: 'usr_demo_029', role: 'STUDENT' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: { authorization: `Bearer ${token}` },
        payload: { termsVersion: 1, acknowledged: true },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().termsVersion).toBe(1);
    });

    it('2. Missing acknowledgement or false flag is rejected (400)', async () => {
      const token = signToken({ sub: 'usr_demo_029', role: 'STUDENT' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: { authorization: `Bearer ${token}` },
        payload: { termsVersion: 1, acknowledged: false },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/ACKNOWLEDGEMENT_REQUIRED/);
    });

    it('3. Invalid agreement version is rejected (400)', async () => {
      const token = signToken({ sub: 'usr_demo_029', role: 'STUDENT' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: { authorization: `Bearer ${token}` },
        payload: { termsVersion: 9999, acknowledged: true },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/INVALID_TERMS/);
    });

    it('4. Malformed body or negative version rejected (400)', async () => {
      const token = signToken({ sub: 'usr_demo_029', role: 'STUDENT' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: { authorization: `Bearer ${token}` },
        payload: { termsVersion: -1, acknowledged: true },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/INVALID_TERMS_VERSION/);
    });

    it('5. Duplicate submission handled safely (idempotent)', async () => {
      const token = signToken({ sub: 'usr_demo_029', role: 'STUDENT' });

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: { authorization: `Bearer ${token}` },
        payload: { termsVersion: 1, acknowledged: true },
      });
      expect(res1.statusCode).toBe(200);

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: { authorization: `Bearer ${token}` },
        payload: { termsVersion: 1, acknowledged: true },
      });
      expect(res2.statusCode).toBe(200);

      // Verify DB has exactly ONE row for student 29 version 1
      const dbCheck = await db.query(
        `SELECT COUNT(*) as count FROM terms_acknowledgements WHERE student_id = 'prof_demo_029' AND terms_version = 1`
      );
      expect(parseInt(dbCheck.rows[0].count, 10)).toBe(1);
    });

    it('6. Correct database record persisted with timestamp and IP address', async () => {
      const row = await db.query(
        `SELECT * FROM terms_acknowledgements WHERE student_id = 'prof_demo_029' AND terms_version = 1`
      );
      expect(row.rows.length).toBe(1);
      const ack = row.rows[0];
      expect(ack.student_id).toBe('prof_demo_029');
      expect(ack.terms_version).toBe(1);
      expect(ack.terms_document_id).toBe('terms_v1');
      expect(ack.accepted_at).toBeDefined();
      expect(ack.ip_address).toBeDefined();
    });
  });

  describe('4. Complete End-to-End Integration Flow', () => {
    it('executes Login -> Credential -> Agreement -> Persistence -> State Verification for two separate students', async () => {
      // 1. Authenticate Student 1 (DEMO-029) via POST /api/auth/login
      const loginRes1 = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          identifier: 'DEMO-029',
          password: 'password', // Verified against dev hash
        },
      });

      expect(loginRes1.statusCode).toBe(200);
      const auth1 = loginRes1.json();
      expect(auth1.token).toBeDefined();
      expect(auth1.session.userId).toBe('usr_demo_029');
      expect(auth1.session.profileId).toBe('prof_demo_029');

      // 2. Student 1 checks terms status before acceptance
      const statusRes1 = await app.inject({
        method: 'GET',
        url: '/api/students/prof_demo_029/terms-status',
        headers: { authorization: `Bearer ${auth1.token}` },
      });
      expect(statusRes1.statusCode).toBe(200);
      expect(statusRes1.json().accepted).toBe(true); // Accepted in previous test step

      // 3. Authenticate Student 2 (DEMO-030) via POST /api/auth/login
      const loginRes2 = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          identifier: 'DEMO-030',
          password: 'password',
        },
      });

      expect(loginRes2.statusCode).toBe(200);
      const auth2 = loginRes2.json();
      expect(auth2.token).toBeDefined();
      expect(auth2.session.userId).toBe('usr_demo_030');
      expect(auth2.session.profileId).toBe('prof_demo_030');

      // 4. Student 2 CANNOT mutate Student 1 agreement
      const crossMutation = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_029/accept-terms',
        headers: { authorization: `Bearer ${auth2.token}` },
        payload: { termsVersion: 1, acknowledged: true },
      });
      expect(crossMutation.statusCode).toBe(403);

      // 5. Student 2 accepts own agreement
      const acceptRes2 = await app.inject({
        method: 'POST',
        url: '/api/students/prof_demo_030/accept-terms',
        headers: { authorization: `Bearer ${auth2.token}` },
        payload: { termsVersion: 1, acknowledged: true },
      });
      expect(acceptRes2.statusCode).toBe(200);

      // 6. Verify distinct DB persistence
      const p1 = await db.query(`SELECT * FROM terms_acknowledgements WHERE student_id = 'prof_demo_029'`);
      const p2 = await db.query(`SELECT * FROM terms_acknowledgements WHERE student_id = 'prof_demo_030'`);
      expect(p1.rows.length).toBe(1);
      expect(p2.rows.length).toBe(1);
      expect(p1.rows[0].id).not.toBe(p2.rows[0].id);
    });
  });
});
