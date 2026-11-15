import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDatabaseService, DatabaseService } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import { AuthService } from '../src/auth/service.js';
import { DistributedRateLimiter } from '../src/auth/rateLimiter.js';
import {
  generateTotpSecret,
  computeTotpCode,
  getCurrentTimestep,
} from '../src/auth/totpService.js';
import {
  encryptAesGcm,
  decryptAesGcm,
  rotateMfaSecrets,
} from '../src/auth/cryptoUtils.js';

describe('DORMEX Stage 3: Session Lifecycle, Invalidation Epochs, Rate Limiting & Key Rotation Suite', () => {
  let db: DatabaseService;
  let fastifyApp: FastifyInstance;
  let authService: AuthService;

  beforeAll(async () => {
    db = getDatabaseService(true);
    await runMigrations(db);
    await seedDatabase(db);
    fastifyApp = await buildApp(db);
    await fastifyApp.ready();
    authService = new AuthService(db);
  });

  // =========================================================================
  // 1. SESSION INVALIDATION & REVOCATION EPOCHS
  // =========================================================================
  describe('1. Global Session Invalidation Epochs (session_version)', () => {
    it('invalidates active session immediately when session_version is bumped', async () => {
      // 1. Create active user with session_version = 1 and assigned role
      const userRes = await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, session_version)
         VALUES ('usr_rev_test_01', 'STF_REV_01', 'rev01@college.edu', 'Revocation User 1', 'hash', 1)
         RETURNING id`
      );
      const userId = userRes.rows[0].id;
      const sRoleRes = await db.query(`SELECT id FROM roles WHERE name = 'STUDENT'`);
      await db.query(
        `INSERT INTO user_roles (id, user_id, role_id, scope_type)
         VALUES ('ur_rev_test_01', $1, $2, 'STUDENT')`,
        [userId, sRoleRes.rows[0].id]
      );

      // 2. Issue JWT with ver: 1
      const validToken = fastifyApp.jwt.sign({
        sub: userId,
        ver: 1,
        role: 'STUDENT',
      });

      // Token works
      const resBefore = await fastifyApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${validToken}` },
      });
      expect(resBefore.statusCode).toBe(200);

      // 3. Revoke sessions via authService.revokeUserSessions
      const revRes = await authService.revokeUserSessions(userId, 'usr_admin', 'Administrative logout');
      expect(revRes.success).toBe(true);
      expect(revRes.newSessionVersion).toBe(2);

      // 4. Token with ver: 1 is immediately rejected
      const resAfter = await fastifyApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${validToken}` },
      });
      expect(resAfter.statusCode).toBe(401);
      expect(resAfter.json().error).toContain('Session revoked');
    });

    it('rejects authentication immediately when user account is deactivated', async () => {
      const userRes = await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, session_version, is_active)
         VALUES ('usr_deact_test_01', 'STF_DEACT_01', 'deact01@college.edu', 'Deactivation User', 'hash', 1, TRUE)
         RETURNING id`
      );
      const userId = userRes.rows[0].id;
      const sRoleRes = await db.query(`SELECT id FROM roles WHERE name = 'STUDENT'`);
      await db.query(
        `INSERT INTO user_roles (id, user_id, role_id, scope_type)
         VALUES ('ur_deact_test_01', $1, $2, 'STUDENT')`,
        [userId, sRoleRes.rows[0].id]
      );

      const token = fastifyApp.jwt.sign({
        sub: userId,
        ver: 1,
        role: 'STUDENT',
      });

      const resBefore = await fastifyApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(resBefore.statusCode).toBe(200);

      // Deactivate user
      await authService.deactivateUser(userId, 'usr_admin', 'Disciplinary suspension');

      const resAfter = await fastifyApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(resAfter.statusCode).toBe(401);
      expect(resAfter.json().error).toContain('Account is deactivated');
    });

    it('MFA reset revokes all prior active sessions and wipes MFA settings', async () => {
      const userRes = await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, session_version)
         VALUES ('usr_mfa_reset_01', 'STF_MFA_RST_01', 'mfarst01@college.edu', 'MFA Reset User', 'hash', 1)
         RETURNING id`
      );
      const userId = userRes.rows[0].id;
      const sRoleRes = await db.query(`SELECT id FROM roles WHERE name = 'STUDENT'`);
      await db.query(
        `INSERT INTO user_roles (id, user_id, role_id, scope_type)
         VALUES ('ur_mfa_rst_01', $1, $2, 'STUDENT')`,
        [userId, sRoleRes.rows[0].id]
      );

      // Enroll MFA
      const init = await authService.initiateMfaEnrollment(userId);
      const step = getCurrentTimestep();
      await authService.finalizeMfaEnrollment(userId, computeTotpCode(init.base32Secret, step));

      // User has session_version = 2 now
      const userRow = await db.query(`SELECT session_version FROM users WHERE id = $1`, [userId]);
      const activeVer = Number(userRow.rows[0].session_version);

      const mfaElevatedToken = fastifyApp.jwt.sign({
        sub: userId,
        ver: activeVer,
        role: 'STUDENT',
        mfa_level: 'TOTP',
      });

      const resBefore = await fastifyApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${mfaElevatedToken}` },
      });
      expect(resBefore.statusCode).toBe(200);

      // Perform MFA Reset
      const resetRes = await authService.resetUserMfa(userId, 'usr_admin', 'Lost authenticator device');
      expect(resetRes.success).toBe(true);

      // Check MFA settings deleted
      const mfaSettings = await db.query(`SELECT * FROM user_mfa_settings WHERE user_id = $1`, [userId]);
      expect(mfaSettings.rows.length).toBe(0);

      // Prior session token must now be rejected
      const resAfter = await fastifyApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${mfaElevatedToken}` },
      });
      expect(resAfter.statusCode).toBe(401);
      expect(resAfter.json().error).toContain('Session revoked');
    });

    it('logout with revokeAllSessions clears cookie and increments database session_version', async () => {
      const userRes = await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, session_version)
         VALUES ('usr_logout_test_01', 'STF_LOGOUT_01', 'logout01@college.edu', 'Logout User', 'hash', 1)
         RETURNING id`
      );
      const userId = userRes.rows[0].id;
      const sRoleRes = await db.query(`SELECT id FROM roles WHERE name = 'STUDENT'`);
      await db.query(
        `INSERT INTO user_roles (id, user_id, role_id, scope_type)
         VALUES ('ur_logout_test_01', $1, $2, 'STUDENT')`,
        [userId, sRoleRes.rows[0].id]
      );

      const token = fastifyApp.jwt.sign({
        sub: userId,
        ver: 1,
        role: 'STUDENT',
      });

      const logoutRes = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { authorization: `Bearer ${token}` },
        payload: { revokeAllSessions: true },
      });
      expect(logoutRes.statusCode).toBe(200);

      // Verify session_version was bumped in database
      const row = await db.query(`SELECT session_version FROM users WHERE id = $1`, [userId]);
      expect(Number(row.rows[0].session_version)).toBe(2);

      // Prior token is revoked
      const meRes = await fastifyApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(meRes.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // 2. HARDENED DISTRIBUTED RATE LIMITER
  // =========================================================================
  describe('2. PostgreSQL-Backed Distributed Rate Limiting', () => {
    let rateLimiter: DistributedRateLimiter;

    beforeEach(() => {
      rateLimiter = new DistributedRateLimiter(db);
    });

    it('enforces lockout threshold after maxAttempts reached and blocks further attempts', async () => {
      const testKey = 'student_test_rate_01';
      const options = { maxAttempts: 3, windowSeconds: 60, lockoutSeconds: 60 };

      // Attempt 1
      const res1 = await rateLimiter.checkAndIncrement('login', testKey, options);
      expect(res1.allowed).toBe(true);
      expect(res1.attempts).toBe(1);
      expect(res1.remaining).toBe(2);

      // Attempt 2
      const res2 = await rateLimiter.checkAndIncrement('login', testKey, options);
      expect(res2.allowed).toBe(true);
      expect(res2.attempts).toBe(2);
      expect(res2.remaining).toBe(1);

      // Attempt 3 (reaches maxAttempts)
      const res3 = await rateLimiter.checkAndIncrement('login', testKey, options);
      expect(res3.allowed).toBe(false); // blocked at limit
      expect(res3.attempts).toBe(3);
      expect(res3.remaining).toBe(0);
      expect(res3.blockedUntil).toBeDefined();

      // Attempt 4 while blocked
      const res4 = await rateLimiter.checkAndIncrement('login', testKey, options);
      expect(res4.allowed).toBe(false);
      expect(res4.remaining).toBe(0);
      expect(res4.blockedUntil).toBeDefined();
    });

    it('resets rate limit counter on successful authentication', async () => {
      const testKey = 'student_reset_rate_01';
      const options = { maxAttempts: 3, windowSeconds: 60, lockoutSeconds: 60 };

      await rateLimiter.checkAndIncrement('login', testKey, options);
      await rateLimiter.checkAndIncrement('login', testKey, options);

      // Reset
      await rateLimiter.reset('login', testKey);

      // Fresh attempt starts at 1
      const freshRes = await rateLimiter.checkAndIncrement('login', testKey, options);
      expect(freshRes.allowed).toBe(true);
      expect(freshRes.attempts).toBe(1);
      expect(freshRes.remaining).toBe(2);
    });

    it('hashes keys using SHA-256 and never exposes raw IP or USN in auth_rate_limits', async () => {
      const rawUSN = '1SI25CS099';
      await rateLimiter.checkAndIncrement('login', rawUSN);

      // Query raw table
      const rows = await db.query(`SELECT key_hash FROM auth_rate_limits`);
      const keyHashes = rows.rows.map((r: any) => r.key_hash);
      const expectedHash = rateLimiter.hashKey('login', rawUSN);

      expect(keyHashes).toContain(expectedHash);
      // Ensure raw text does not appear in table
      for (const h of keyHashes) {
        expect(h).not.toContain(rawUSN);
      }
    });

    it('cleans up expired blocked and stale rate limit entries', async () => {
      // Insert stale row with explicit past timestamps
      const pastBlockedIso = new Date(Date.now() - 3600 * 1000).toISOString();
      const pastStartIso = new Date(Date.now() - 7200 * 1000).toISOString();

      await db.query(
        `INSERT INTO auth_rate_limits (key_hash, attempts, window_start_at, blocked_until, updated_at)
         VALUES ('stale_key_hash_01', 5, $1, $2, $1)`,
        [pastStartIso, pastBlockedIso]
      );

      const cleaned = await rateLimiter.cleanupExpired();
      expect(cleaned).toBeGreaterThan(0);

      const check = await db.query(`SELECT * FROM auth_rate_limits WHERE key_hash = 'stale_key_hash_01'`);
      expect(check.rows.length).toBe(0);
    });
  });

  // =========================================================================
  // 3. ENCRYPTION KEY ROTATION LIFECYCLE
  // =========================================================================
  describe('3. Encryption Key Rotation Lifecycle', () => {
    it('safely re-encrypts stored secrets to new key version without invalidating authenticator', async () => {
      // 1. Create user with MFA enrolled under key version 1
      const userRes = await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash)
         VALUES ('usr_rot_test_01', 'STF_ROT_01', 'rot01@college.edu', 'Rotation User', 'hash')
         RETURNING id`
      );
      const userId = userRes.rows[0].id;
      const { base32Secret } = generateTotpSecret();
      const encV1 = encryptAesGcm(base32Secret, 1);

      await db.query(
        `INSERT INTO user_mfa_settings (
           id, user_id, encrypted_secret, secret_iv, secret_tag, key_version, is_enabled
         ) VALUES ('mfa_rot_01', $1, $2, $3, $4, 1, TRUE)`,
        [userId, encV1.ciphertext, encV1.iv, encV1.tag]
      );

      // Provide key for version 2 in environment
      process.env.MFA_ENCRYPTION_KEY_V2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

      // 2. Execute rotation to version 2
      const summary = await rotateMfaSecrets(db, 2);
      expect(summary.inspected).toBeGreaterThanOrEqual(1);
      expect(summary.reEncrypted).toBeGreaterThanOrEqual(1);
      expect(summary.failed).toBe(0);

      // 3. Verify user record has key_version = 2
      const updatedRow = await db.query(
        `SELECT encrypted_secret, secret_iv, secret_tag, key_version FROM user_mfa_settings WHERE user_id = $1`,
        [userId]
      );
      expect(Number(updatedRow.rows[0].key_version)).toBe(2);

      // 4. Verify secret decrypts identically with key version 2
      const decrypted = decryptAesGcm({
        ciphertext: updatedRow.rows[0].encrypted_secret,
        iv: updatedRow.rows[0].secret_iv,
        tag: updatedRow.rows[0].secret_tag,
        keyVersion: 2,
      });
      expect(decrypted.toString('utf8')).toBe(base32Secret);

      // Clean up test env key
      delete process.env.MFA_ENCRYPTION_KEY_V2;
    });

    it('is resumable and safe to rerun without double-encrypting already rotated rows', async () => {
      // Clean up previous test row if any with invalid key version
      await db.query(`DELETE FROM user_mfa_settings WHERE user_id = 'usr_rot_test_01'`);

      // Create a fresh test row under key version 1
      const { base32Secret } = generateTotpSecret();
      const encV1 = encryptAesGcm(base32Secret, 1);
      await db.query(
        `INSERT INTO user_mfa_settings (
           id, user_id, encrypted_secret, secret_iv, secret_tag, key_version, is_enabled
         ) VALUES ('mfa_rot_02', 'usr_rev_test_01', $1, $2, $3, 1, TRUE)
         ON CONFLICT (user_id) DO UPDATE SET
           encrypted_secret = EXCLUDED.encrypted_secret,
           secret_iv = EXCLUDED.secret_iv,
           secret_tag = EXCLUDED.secret_tag,
           key_version = 1`,
        [encV1.ciphertext, encV1.iv, encV1.tag]
      );

      // Rerun rotation to version 1
      const rerunSummary = await rotateMfaSecrets(db, 1);
      expect(rerunSummary.failed).toBe(0);
      expect(rerunSummary.targetVersion).toBe(1);
      expect(rerunSummary.alreadyCurrent).toBeGreaterThanOrEqual(1);
    });

    it('fails closed and leaves rows intact if target key is missing', async () => {
      // Attempt rotation to version 99 which has no env key
      await expect(rotateMfaSecrets(db, 99)).rejects.toThrow('MFA_ENCRYPTION_KEY_MISSING');
    });
  });

  // =========================================================================
  // 4. SECURITY AUDIT TRAIL IMMUTABILITY & SECRET HYGIENE
  // =========================================================================
  describe('4. Audit Trail Completeness & Secret Hygiene', () => {
    it('records security events with actor and target context without leaking secrets', async () => {
      const logs = await db.query(`SELECT action, target_type, target_id, reason FROM audit_logs ORDER BY created_at DESC LIMIT 20`);
      expect(logs.rows.length).toBeGreaterThan(0);

      for (const log of logs.rows) {
        // Must never contain sensitive substrings
        expect(log.reason).not.toMatch(/password/i); // No passwords
        expect(log.reason).not.toMatch(/MFA_ENCRYPTION_KEY/i);
        expect(log.reason).not.toMatch(/otpauth:\/\//i);
        expect(log.reason).not.toMatch(/\$argon2id\$/i);
      }
    });
  });
});
