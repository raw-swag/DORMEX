import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { validatePasswordStrength, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../src/auth/passwordUtils.js';

describe('Stage 6: Password Policy and Restricted Recovery Guard', () => {
  let app: FastifyInstance;
  let db: any;

  beforeAll(async () => {
    resetDatabaseInstance();
    db = getDatabaseService(true);
    app = await buildApp(db);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.close();
  });

  describe('Password Policy Validation', () => {
    it('enforces 8 character minimum', () => {
      expect(validatePasswordStrength('').valid).toBe(false);
      expect(validatePasswordStrength('1234567').valid).toBe(false);
      expect(validatePasswordStrength('12345678').valid).toBe(true);
    });

    it('permits long passphrases up to MAX_PASSWORD_LENGTH (1024 chars)', () => {
      const longPassphrase = 'correct-horse-battery-staple-'.repeat(20); // 580 chars
      expect(validatePasswordStrength(longPassphrase).valid).toBe(true);
      
      const exactMax = 'a'.repeat(MAX_PASSWORD_LENGTH);
      expect(validatePasswordStrength(exactMax).valid).toBe(true);

      const tooLong = 'a'.repeat(MAX_PASSWORD_LENGTH + 1);
      expect(validatePasswordStrength(tooLong).valid).toBe(false);
    });

    it('permits complex characters, unicode, spaces, and punctuation', () => {
      expect(validatePasswordStrength('Institutional Passphrase With Spaces!').valid).toBe(true);
      expect(validatePasswordStrength('Secure#Pass@2026!✨🔐').valid).toBe(true);
      expect(validatePasswordStrength('संस्थान-सुरक्षा-कुंजी-२०२६').valid).toBe(true);
    });
  });

  describe('Restricted MFA Recovery Guard', () => {
    it('restricts recovery session token from accessing standard protected endpoints', async () => {
      // Sign a JWT with is_recovery_session: true
      const recoveryToken = app.jwt.sign({
        sub: 'usr_admin',
        ver: 1,
        role: 'CHIEF_WARDEN',
        college_id: 'ADM001',
        mfa_level: 'NONE',
        is_recovery_session: true,
      });

      // 1. Calling /api/students should be strictly rejected with 403 Forbidden
      const studentsRes = await app.inject({
        method: 'GET',
        url: '/api/students',
        headers: {
          authorization: `Bearer ${recoveryToken}`,
        },
      });
      expect(studentsRes.statusCode).toBe(403);
      const studentsBody = JSON.parse(studentsRes.body);
      expect(studentsBody.message || studentsBody.error).toMatch(/RECOVERY_SESSION_RESTRICTED/);

      // 2. Calling /api/governance/actions should be rejected with 403 Forbidden
      const govRes = await app.inject({
        method: 'GET',
        url: '/api/governance/actions',
        headers: {
          authorization: `Bearer ${recoveryToken}`,
        },
      });
      expect(govRes.statusCode).toBe(403);

      // 3. Calling allowed recovery endpoints: /api/auth/me should succeed
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: `Bearer ${recoveryToken}`,
        },
      });
      expect(meRes.statusCode).toBe(200);

      // 4. Calling /api/auth/mfa/enroll should succeed
      const enrollRes = await app.inject({
        method: 'POST',
        url: '/api/auth/mfa/enroll',
        headers: {
          authorization: `Bearer ${recoveryToken}`,
        },
      });
      expect(enrollRes.statusCode).toBe(200);

      // 5. Calling /api/auth/logout should succeed
      const logoutRes = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          authorization: `Bearer ${recoveryToken}`,
        },
      });
      expect(logoutRes.statusCode).toBe(200);
    });
  });
});
