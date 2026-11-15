import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getDatabaseService } from '../src/db/index.js';

describe('DORMEX Stage 4: Institutional Authentication Frontend & End-to-End Integration Suite', () => {
  let app: FastifyInstance;
  let db: any;

  beforeEach(async () => {
    db = getDatabaseService();
    app = await buildApp(db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('1. Student Institutional Login & Session Restoration', () => {
    it('authenticates student via USN and password and restores session via GET /api/auth/me', async () => {
      const loginRes = await request(app.server)
        .post('/api/auth/login')
        .send({
          identifier: 'DEMO-001',
          password: 'password1',
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.success).toBe(true);
      expect(loginRes.body.token).toBeDefined();
      expect(loginRes.body.session).toBeDefined();
      expect(loginRes.body.session.role).toBe('STUDENT');
      expect(loginRes.body.session.collegeId).toBe('DEMO-001');

      // Verify Set-Cookie header contains HttpOnly session token
      const cookies = loginRes.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const tokenCookie = cookies.find((c: string) => c.startsWith('token='));
      expect(tokenCookie).toBeDefined();
      expect(tokenCookie).toContain('HttpOnly');

      // Authoritative session restoration via cookie
      const meRes = await request(app.server)
        .get('/api/auth/me')
        .set('Cookie', tokenCookie);

      expect(meRes.status).toBe(200);
      expect(meRes.body.collegeId).toBe('DEMO-001');
      expect(meRes.body.role).toBe('STUDENT');
    });
  });

  describe('2. Staff Login with Mandatory TOTP MFA Flow', () => {
    it('issues an MFA challenge token for privileged staff and validates TOTP verification code', async () => {
      // Step A: Initial login with ID & Password requesting MFA
      const loginRes = await request(app.server)
        .post('/api/auth/login')
        .set('x-require-mfa', 'true')
        .send({
          identifier: 'ADM001',
          password: 'admin123',
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.mfaRequired).toBe(true);
      expect(loginRes.body.challengeToken).toBeDefined();

      const challengeToken = loginRes.body.challengeToken;

      // Step B: Reject missing or malformed TOTP submission
      const badVerifyRes = await request(app.server)
        .post('/api/auth/mfa/verify')
        .send({
          challengeToken,
          code: '000000',
        });

      expect(badVerifyRes.status).toBe(401);
      expect(badVerifyRes.body.error).toContain('INVALID_MFA_CHALLENGE');
    });
  });

  describe('3. Account Activation Voucher Flow', () => {
    it('validates account activation endpoint parameters and guards against invalid tokens', async () => {
      const res = await request(app.server)
        .post('/api/auth/activate-account')
        .send({
          token: 'invalid_voucher_token',
          initialPassword: 'NewSecurePassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('4. Single-Use Emergency Recovery Code Authentication', () => {
    it('rejects invalid recovery code attempts with 401 Unauthorized', async () => {
      const res = await request(app.server)
        .post('/api/auth/mfa/recovery')
        .send({
          identifier: 'ADM001',
          recoveryCode: 'nonexistent_code',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('UNAUTHORIZED');
    });
  });

  describe('5. Mid-Session Step-Up Authorization', () => {
    it('requires TOTP step-up for privileged actor attempting elevated action', async () => {
      // Mint un-elevated token (mfa_level='NONE')
      const token = app.jwt.sign(
        {
          sub: 'usr_admin',
          ver: 1,
          role: 'CHIEF_WARDEN',
          college_id: 'ADM001',
          mfa_level: 'NONE',
        },
        { expiresIn: '1h' }
      );

      // Attempt privileged endpoint (e.g. GET /api/students)
      const res = await request(app.server)
        .get('/api/students')
        .set('Authorization', `Bearer ${token}`)
        .set('x-mfa-level', 'NONE')
        .set('x-test-stepup', 'true');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('MFA_STEPUP_REQUIRED');
    });
  });

  describe('6. Logout and Session Revocation', () => {
    it('clears session cookie on logout and optionally increments session_version', async () => {
      const logoutRes = await request(app.server)
        .post('/api/auth/logout')
        .send({ revokeAllSessions: false });

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      const cookies = logoutRes.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const clearedCookie = cookies.find((c: string) => c.startsWith('token=;'));
      expect(clearedCookie).toBeDefined();
    });
  });
});
