import { describe, it, expect, beforeAll } from 'vitest';
import { getDatabaseService, DatabaseService } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import {
  generateTotpSecret,
  computeTotpCode,
  verifyTotpCode,
  generateKeyUri,
  getCurrentTimestep,
  base32Decode,
  base32Encode,
} from '../src/auth/totpService.js';
import {
  encryptAesGcm,
  decryptAesGcm,
  getEncryptionKey,
} from '../src/auth/cryptoUtils.js';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
} from '../src/auth/recoveryCodeService.js';
import { AuthService } from '../src/auth/service.js';

describe('DORMEX Stage 2: TOTP MFA, Cryptographic Protection & Step-up Authorization Suite', () => {
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
  // 1. RFC 6238 TOTP ENGINE & CRYPTOGRAPHIC UTILITIES
  // =========================================================================
  describe('1. RFC 6238 TOTP Engine & Cryptographic Foundation', () => {
    it('generates 20-byte Base32 TOTP secret and parses otpauth:// URI correctly', () => {
      const { rawSecret, base32Secret } = generateTotpSecret();
      expect(rawSecret).toHaveLength(20);
      expect(base32Secret).toHaveLength(32); // 20 bytes in base32 is 32 characters
      const uri = generateKeyUri('1SI25CS001', 'DORMEX', base32Secret);
      expect(uri).toContain('otpauth://totp/DORMEX:1SI25CS001');
      expect(uri).toContain(`secret=${base32Secret}`);
      expect(uri).toContain('issuer=DORMEX');
      expect(uri).toContain('period=30');
      expect(uri).toContain('digits=6');
      expect(uri).toContain('algorithm=SHA1');
    });

    it('generates and verifies 6-digit TOTP codes within allowable drift window', () => {
      const { base32Secret } = generateTotpSecret();
      const currentStep = getCurrentTimestep();
      const codeNow = computeTotpCode(base32Secret, currentStep);
      expect(codeNow).toMatch(/^\d{6}$/);

      // Verify at current step
      const nowMs = currentStep * 30 * 1000 + 5000;
      const verifyNow = verifyTotpCode(base32Secret, codeNow, nowMs, 1);
      expect(verifyNow.valid).toBe(true);
      expect(verifyNow.matchedStep).toBe(currentStep);

      // Verify at drift window -1 (time shifted forward by 30s)
      const futureMs = (currentStep + 1) * 30 * 1000 + 5000;
      const verifyPrev = verifyTotpCode(base32Secret, codeNow, futureMs, 1);
      expect(verifyPrev.valid).toBe(true);
      expect(verifyPrev.matchedStep).toBe(currentStep);

      // Verify at drift window +1 (time shifted back by 30s)
      const pastMs = (currentStep - 1) * 30 * 1000 + 5000;
      const verifyNext = verifyTotpCode(base32Secret, codeNow, pastMs, 1);
      expect(verifyNext.valid).toBe(true);
      expect(verifyNext.matchedStep).toBe(currentStep);

      // Rejects code outside drift window (drift of 3 steps)
      const farMs = (currentStep + 3) * 30 * 1000 + 5000;
      const verifyFar = verifyTotpCode(base32Secret, codeNow, farMs, 1);
      expect(verifyFar.valid).toBe(false);

      // Rejects incorrect code
      const verifyWrong = verifyTotpCode(base32Secret, '999999', nowMs, 1);
      expect(verifyWrong.valid).toBe(false);
    });

    it('encrypts and decrypts secret using AES-256-GCM with key versioning and detects tampering', () => {
      const { base32Secret } = generateTotpSecret();
      const encrypted = encryptAesGcm(base32Secret, 1);
      expect(encrypted.keyVersion).toBe(1);
      expect(encrypted.iv).toHaveLength(24); // 12 bytes = 24 hex
      expect(encrypted.tag).toHaveLength(32); // 16 bytes = 32 hex
      expect(encrypted.ciphertext.length).toBeGreaterThan(0);

      const decrypted = decryptAesGcm(encrypted);
      expect(decrypted.toString('utf8')).toBe(base32Secret);

      // Tampering detection: decrypting tampered tag throws
      const tamperedTag = encrypted.tag.substring(0, 30) + (encrypted.tag[30] === '0' ? '1' : '0') + encrypted.tag[31];
      expect(() => decryptAesGcm({ ...encrypted, tag: tamperedTag })).toThrow();
    });

    it('generates, hashes and verifies single-use recovery codes', async () => {
      const codes = generateRecoveryCodes(8);
      expect(codes).toHaveLength(8);
      for (const code of codes) {
        expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
      }

      const sampleCode = codes[0];
      const hash = await hashRecoveryCode(sampleCode);
      const matchedIdx = await verifyRecoveryCode(sampleCode, [hash]);
      expect(matchedIdx).toBe(0);

      const mismatchedIdx = await verifyRecoveryCode('ABCD-EFGH-IJKL', [hash]);
      expect(mismatchedIdx).toBe(-1);
    });
  });

  // =========================================================================
  // 2. MFA ENROLLMENT & REPLAY PROTECTION INVARIANTS
  // =========================================================================
  describe('2. End-to-End MFA Enrollment & Replay Protection Invariants', () => {
    it('executes full MFA enrollment workflow and records encrypted secret & recovery code hashes', async () => {
      // Create test user
      const userRes = await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash)
         VALUES ('usr_mfa_test_01', 'STF_MFA_01', 'mfa01@college.edu', 'MFA Test User 1', 'hash')
         RETURNING id`
      );
      const userId = userRes.rows[0].id;

      // 1. Initiate enrollment
      const init = await authService.initiateMfaEnrollment(userId);
      expect(init.base32Secret).toBeDefined();
      expect(init.keyUri).toContain('otpauth://totp/');

      // 2. Generate valid TOTP code
      const currentStep = getCurrentTimestep();
      const validCode = computeTotpCode(init.base32Secret, currentStep);

      // 3. Finalize setup
      const finalRes = await authService.finalizeMfaEnrollment(userId, validCode);
      expect(finalRes.success).toBe(true);
      expect(finalRes.recoveryCodes).toHaveLength(8);

      // Verify active row
      const activeRow = await db.query(`SELECT is_enabled, last_verified_step, recovery_code_hashes FROM user_mfa_settings WHERE user_id = $1`, [userId]);
      expect(activeRow.rows[0].is_enabled).toBe(true);
      expect(Number(activeRow.rows[0].last_verified_step)).toBe(currentStep);
      expect(activeRow.rows[0].recovery_code_hashes).toHaveLength(8);
    });

    it('strictly prevents replay of the same TOTP timestep (anti-replay invariant)', async () => {
      // Create user and enroll
      const userRes = await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash)
         VALUES ('usr_mfa_replay_01', 'STF_MFA_REPLAY', 'replay@college.edu', 'Replay User', 'hash')
         RETURNING id`
      );
      const userId = userRes.rows[0].id;
      const init = await authService.initiateMfaEnrollment(userId);
      const currentStep = getCurrentTimestep();
      const validCode = computeTotpCode(init.base32Secret, currentStep);
      await authService.finalizeMfaEnrollment(userId, validCode);

      // Attempt immediate replay of the exact same code / step: should throw or fail
      await expect(authService.verifyTotpForUser(userId, validCode)).rejects.toThrow('TOTP_CODE_ALREADY_USED');
    });

    it('consumes single-use recovery code atomically and rejects reused code', async () => {
      const userRes = await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash)
         VALUES ('usr_mfa_rc_01', 'STF_MFA_RC', 'recovery@college.edu', 'Recovery Code User', 'hash')
         RETURNING id`
      );
      const userId = userRes.rows[0].id;
      const init = await authService.initiateMfaEnrollment(userId);
      const currentStep = getCurrentTimestep();
      const validCode = computeTotpCode(init.base32Secret, currentStep);
      const finalRes = await authService.finalizeMfaEnrollment(userId, validCode);

      const testRecoveryCode = finalRes.recoveryCodes[0];

      // 1. Consume code
      const consumed = await authService.consumeRecoveryCode(userId, testRecoveryCode);
      expect(consumed.success).toBe(true);
      expect(consumed.remainingCodes).toBe(7);

      // 2. Attempt reuse of the exact same recovery code
      const reused = await authService.consumeRecoveryCode(userId, testRecoveryCode);
      expect(reused.success).toBe(false);

      // Verify database reflects 7 remaining hashes
      const row = await db.query(`SELECT recovery_code_hashes FROM user_mfa_settings WHERE user_id = $1`, [userId]);
      expect(row.rows[0].recovery_code_hashes).toHaveLength(7);
    });
  });

  // =========================================================================
  // 3. STEP-UP AUTHENTICATION & PRIVILEGED OPERATION ENFORCEMENT
  // =========================================================================
  describe('3. Step-up Authentication & Mid-Session Elevation Defense', () => {
    it('requires step-up elevation when un-elevated privileged session attempts privileged operation', async () => {
      // 1. Create a Warden user
      const userRes = await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash)
         VALUES ('usr_warden_stepup_01', 'WRD_STEPUP_01', 'wrd_stepup@college.edu', 'Warden Stepup', 'hash')
         RETURNING id`
      );
      const userId = userRes.rows[0].id;
      const wRoleRes = await db.query(`SELECT id FROM roles WHERE name = 'WARDEN'`);
      await db.query(
        `INSERT INTO user_roles (id, user_id, role_id, scope_type, scope_id)
         VALUES ('ur_wrd_stepup', $1, $2, 'BUILDING', 'bld_bvb')`,
        [userId, wRoleRes.rows[0].id]
      );
      await db.query(
        `INSERT INTO warden_appointments (id, user_id, building_id, appointment_status, appointed_by)
         VALUES ('wa_stepup_01', $1, 'bld_bvb', 'ACTIVE', 'usr_admin')`,
        [userId]
      );

      // Enroll MFA for user
      const init = await authService.initiateMfaEnrollment(userId);
      const step = getCurrentTimestep();
      await authService.finalizeMfaEnrollment(userId, computeTotpCode(init.base32Secret, step));

      // Issue un-elevated session token (mfa_level='NONE')
      const unElevatedToken = fastifyApp.jwt.sign({
        sub: userId,
        role: 'WARDEN',
        mfa_level: 'NONE',
      });

      // 2. Un-elevated token CAN access /api/auth/me
      const meRes = await fastifyApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${unElevatedToken}` },
      });
      expect(meRes.statusCode).toBe(200);

      // 3. Un-elevated token CANNOT access privileged action (e.g. /api/room-change-requests)
      const privRes = await fastifyApp.inject({
        method: 'GET',
        url: '/api/room-change-requests',
        headers: {
          authorization: `Bearer ${unElevatedToken}`,
          'x-test-stepup': 'true', // ensures test fixture doesn't auto-elevate
        },
      });
      expect(privRes.statusCode).toBe(403);
      expect(privRes.json().error).toContain('MFA_STEPUP_REQUIRED');

      // 4. Perform step-up elevation via POST /api/auth/mfa/step-up
      const nextStep = getCurrentTimestep() + 1;
      const stepUpCode = computeTotpCode(init.base32Secret, nextStep);

      const stepUpRes = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/mfa/step-up',
        headers: { authorization: `Bearer ${unElevatedToken}` },
        payload: { code: stepUpCode },
      });
      expect(stepUpRes.statusCode).toBe(200);
      expect(stepUpRes.json().success).toBe(true);
      expect(stepUpRes.json().mfaLevel).toBe('TOTP');
      const elevatedToken = stepUpRes.json().token;

      // 5. Elevated token CAN now access privileged action
      const privResAfter = await fastifyApp.inject({
        method: 'GET',
        url: '/api/room-change-requests',
        headers: {
          authorization: `Bearer ${elevatedToken}`,
          'x-test-stepup': 'true',
        },
      });
      expect(privResAfter.statusCode).toBe(200);
    });

    it('enforces MFA challenge flow on privileged login when enrolled', async () => {
      // Create Super Admin with password
      const hash = await authService.hashPasswordArgon2('AdminSecure#2026!');
      const userRes = await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash)
         VALUES ('usr_admin_mfa_login', 'ADM_MFA_01', 'adminmfa@college.edu', 'Admin MFA User', $1)
         RETURNING id`,
        [hash]
      );
      const userId = userRes.rows[0].id;
      const saRoleRes = await db.query(`SELECT id FROM roles WHERE name = 'SUPER_ADMIN'`);
      await db.query(
        `INSERT INTO user_roles (id, user_id, role_id, scope_type)
         VALUES ('ur_sa_mfa_01', $1, $2, 'SYSTEM')`,
        [userId, saRoleRes.rows[0].id]
      );

      // Enroll in MFA
      const init = await authService.initiateMfaEnrollment(userId);
      const step = getCurrentTimestep();
      await authService.finalizeMfaEnrollment(userId, computeTotpCode(init.base32Secret, step));

      // 1. Login with password
      const loginRes = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          identifier: 'ADM_MFA_01',
          password: 'AdminSecure#2026!',
        },
      });
      expect(loginRes.statusCode).toBe(200);
      expect(loginRes.json().mfaRequired).toBe(true);
      expect(loginRes.json().mfaEnrolled).toBe(true);
      const challengeToken = loginRes.json().challengeToken;
      expect(challengeToken).toBeDefined();

      // 2. Complete MFA verification
      const verifyStep = getCurrentTimestep() + 1;
      const verifyCode = computeTotpCode(init.base32Secret, verifyStep);

      const mfaVerifyRes = await fastifyApp.inject({
        method: 'POST',
        url: '/api/auth/mfa/verify',
        payload: {
          challengeToken,
          code: verifyCode,
        },
      });
      expect(mfaVerifyRes.statusCode).toBe(200);
      expect(mfaVerifyRes.json().success).toBe(true);
      expect(mfaVerifyRes.json().session.mfaLevel).toBe('TOTP');
      expect(mfaVerifyRes.json().token).toBeDefined();
    });
  });
});
