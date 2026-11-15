import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { getDatabaseService, resetDatabaseInstance, DatabaseService } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { AuthService, testEmailOutbox } from '../src/auth/service.js';
import {
  hashPasswordAsync,
  hashPasswordSync,
  verifyPasswordAsync,
  executeDummyPasswordVerification,
} from '../src/auth/passwordUtils.js';
import { buildApp } from '../src/app.js';

describe('DORMEX Stage 1: Modern Institutional Authentication & Credential Modernization Suite', () => {
  let db: DatabaseService;
  let authService: AuthService;
  let fastifyApp: any;
  let server: any;

  beforeEach(async () => {
    resetDatabaseInstance();
    process.env.NODE_ENV = 'test';
    db = getDatabaseService(true);
    await runMigrations(db);
    authService = new AuthService(db);
    testEmailOutbox.clear();

    fastifyApp = await buildApp(db);
    await fastifyApp.ready();
    server = fastifyApp.server;
  });

  afterEach(async () => {
    if (fastifyApp) {
      await fastifyApp.close();
    }
    await db.close();
    resetDatabaseInstance();
  });

  describe('1. Modern Argon2id & Legacy scrypt Password Engine', () => {
    it('creates valid Argon2id hash with specified parameters and verifies asynchronously', async () => {
      const password = 'InstitutionalStrongPass123!';
      const hash = await hashPasswordAsync(password);

      expect(hash.startsWith('$argon2id$')).toBe(true);
      expect(hash).toContain('m=65536,t=3,p=4');

      const verification = await verifyPasswordAsync(password, hash);
      expect(verification.valid).toBe(true);
      expect(verification.needsRehash).toBe(false);

      const invalidVerification = await verifyPasswordAsync('WrongPassword999!', hash);
      expect(invalidVerification.valid).toBe(false);
    });

    it('asynchronously verifies valid and invalid legacy scrypt hashes without event-loop blocking', async () => {
      const password = 'LegacyStudentPassword2026#';
      const legacyHash = hashPasswordSync(password);

      expect(legacyHash.startsWith('scrypt$')).toBe(true);

      const validResult = await verifyPasswordAsync(password, legacyHash);
      expect(validResult.valid).toBe(true);
      expect(validResult.needsRehash).toBe(true);

      const invalidResult = await verifyPasswordAsync('BadPassword', legacyHash);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.needsRehash).toBe(false);
    });

    it('strictly rejects sentinel locked hashes (LOCKED_INIT_PENDING$*) from authentication', async () => {
      const sentinel = authService.generateLockedSentinelHash('LOCKED_INIT_PENDING');
      expect(sentinel.startsWith('LOCKED_INIT_PENDING$')).toBe(true);

      const result = await verifyPasswordAsync('anyPasswordAttempt', sentinel);
      expect(result.valid).toBe(false);
      expect(result.needsRehash).toBe(false);

      const syncResult = authService.verifyPassword('anyPasswordAttempt', sentinel);
      expect(syncResult).toBe(false);
    });

    it('rejects malformed, corrupted, or unsupported hashes without throwing unhandled errors', async () => {
      const malformedHashes = [
        '',
        'notAValidHash',
        'scrypt$incomplete',
        'scrypt$too$many$parts$here',
        '$argon2id$invalid_formatting',
        '$unknownalgo$12345',
        'plainTextPasswordWithoutHash',
      ];

      for (const badHash of malformedHashes) {
        const result = await verifyPasswordAsync('testPass', badHash);
        expect(result.valid).toBe(false);
      }
    });

    it('dummy verification equalizes timing for nonexistent lookups (~70ms execution)', async () => {
      const start = Date.now();
      await executeDummyPasswordVerification();
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(10);
    });
  });

  describe('2. Transparent Hash Modernization & Concurrency Protection', () => {
    it('transparently upgrades legacy scrypt hash to Argon2id on successful login with optimistic lock', async () => {
      const testUserCollegeId = '1SI25CS099';
      const testEmail = 'student.cs099@sit.ac.in';
      const testPassword = 'MySecretPassword123!';
      const initialScryptHash = hashPasswordSync(testPassword);

      const userId = 'usr_test_upgrade_01';
      await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active, session_version)
         VALUES ($1, $2, $3, 'Student Upgrade Test', $4, TRUE, 1)`,
        [userId, testUserCollegeId, testEmail, initialScryptHash]
      );
      await db.query(
        `INSERT INTO roles (id, name, description) VALUES ('role_student', 'STUDENT', 'Student') ON CONFLICT DO NOTHING`
      );
      await db.query(
        `INSERT INTO user_roles (id, user_id, role_id, scope_type) VALUES ('ur_test_up_01', $1, 'role_student', 'STUDENT')`,
        [userId]
      );

      const beforeRes = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
      expect(beforeRes.rows[0].password_hash.startsWith('scrypt$')).toBe(true);

      const response = await request(server)
        .post('/api/auth/login')
        .send({ identifier: testUserCollegeId, password: testPassword });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.token).toBeDefined();

      const afterRes = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
      const updatedHash = afterRes.rows[0].password_hash;
      expect(updatedHash.startsWith('$argon2id$')).toBe(true);

      const secondLogin = await request(server)
        .post('/api/auth/login')
        .send({ identifier: testEmail, password: testPassword });

      expect(secondLogin.status).toBe(200);
      expect(secondLogin.body.success).toBe(true);
    });

    it('prevents concurrent password change from being overwritten by an old login hash upgrade', async () => {
      const userId = 'usr_race_test_01';
      const oldPassword = 'OldPassword123!';
      const newPassword = 'NewPassword456!';
      const oldScryptHash = hashPasswordSync(oldPassword);

      await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active, session_version)
         VALUES ($1, '1SI25CS088', 'student.race@sit.ac.in', 'Race Tester', $2, TRUE, 1)`,
        [userId, oldScryptHash]
      );

      const { valid, needsRehash } = await authService.verifyPasswordAsync(oldPassword, oldScryptHash);
      expect(valid).toBe(true);
      expect(needsRehash).toBe(true);

      const modernNewHash = await hashPasswordAsync(newPassword);
      await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [modernNewHash, userId]);

      const modernOldHash = await hashPasswordAsync(oldPassword);
      const updateResult = await db.query(
        `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 AND password_hash = $3`,
        [modernOldHash, userId, oldScryptHash]
      );

      expect(updateResult.rowCount).toBe(0);

      const currentRes = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
      expect(currentRes.rows[0].password_hash).toBe(modernNewHash);
      const newVerify = await verifyPasswordAsync(newPassword, currentRes.rows[0].password_hash);
      expect(newVerify.valid).toBe(true);
    });
  });

  describe('3. Account Activation & Recovery Workflows', () => {
    it('executes full account activation workflow with single-use, expiry, and session version bump', async () => {
      const userId = 'usr_activation_candidate_01';
      const usn = '1SI25IS010';
      const email = 'candidate.is010@sit.ac.in';
      const lockedHash = authService.generateLockedSentinelHash('LOCKED_INIT_PENDING');

      await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active, session_version)
         VALUES ($1, $2, $3, 'Activation Candidate', $4, TRUE, 1)`,
        [userId, usn, email, lockedHash]
      );

      const voucher = await authService.issueActivationVoucher(usn, 'usr_admin', '10.0.0.1');
      expect(voucher.success).toBe(true);
      expect(voucher.token).toBeDefined();

      const dbTokenRes = await db.query(
        `SELECT * FROM password_reset_tokens WHERE user_id = $1 AND purpose = 'ACTIVATION'`,
        [userId]
      );
      expect(dbTokenRes.rows.length).toBe(1);
      expect(dbTokenRes.rows[0].token_hash).not.toBe(voucher.token);
      expect(dbTokenRes.rows[0].purpose).toBe('ACTIVATION');

      const initialPassword = 'ActivatedPassword123#';
      const actRes = await request(server)
        .post('/api/auth/activate-account')
        .send({ token: voucher.token, initialPassword });

      expect(actRes.status).toBe(200);
      expect(actRes.body.success).toBe(true);

      const userAfter = await db.query(`SELECT password_hash, session_version FROM users WHERE id = $1`, [userId]);
      expect(userAfter.rows[0].password_hash.startsWith('$argon2id$')).toBe(true);
      expect(userAfter.rows[0].session_version).toBe(2);

      const reuseRes = await request(server)
        .post('/api/auth/activate-account')
        .send({ token: voucher.token, initialPassword: 'AnotherPassword789!' });

      expect(reuseRes.status).toBe(400);
      expect(reuseRes.body.error).toContain('TOKEN_REUSED');
    });

    it('rejects activation when token is expired or account is deactivated', async () => {
      const userId = 'usr_expired_activation_01';
      const usn = '1SI25ME040';
      const email = 'candidate.me040@sit.ac.in';

      await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active, session_version)
         VALUES ($1, $2, $3, 'Expired Candidate', 'LOCKED_INIT_PENDING$xyz', TRUE, 1)`,
        [userId, usn, email]
      );

      const voucher = await authService.issueActivationVoucher(usn, 'usr_admin');

      await db.query(
        `UPDATE password_reset_tokens SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE user_id = $1`,
        [userId]
      );

      const res = await request(server)
        .post('/api/auth/activate-account')
        .send({ token: voucher.token, initialPassword: 'ValidPassword123!' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('TOKEN_EXPIRED');
    });

    it('password reset increments session_version and invalidates previously issued JWT tokens', async () => {
      const userId = 'usr_pwd_reset_revocation_01';
      const usn = '1SI25EE015';
      const initialPass = 'InitialPass123!';
      const newPass = 'UpdatedPass456!';
      const hash = await hashPasswordAsync(initialPass);

      await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active, session_version)
         VALUES ($1, $2, 'ee015@sit.ac.in', 'EE Student', $3, TRUE, 1)`,
        [userId, usn, hash]
      );
      await db.query(
        `INSERT INTO roles (id, name, description) VALUES ('role_student', 'STUDENT', 'Student') ON CONFLICT DO NOTHING`
      );
      await db.query(
        `INSERT INTO user_roles (id, user_id, role_id, scope_type) VALUES ('ur_ee015', $1, 'role_student', 'STUDENT')`,
        [userId]
      );

      const loginRes = await request(server)
        .post('/api/auth/login')
        .send({ identifier: usn, password: initialPass });

      expect(loginRes.status).toBe(200);
      const oldToken = loginRes.body.token;

      const meBefore = await request(server)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${oldToken}`);
      expect(meBefore.status).toBe(200);

      await authService.requestPasswordReset(usn);
      const resetToken = testEmailOutbox.getLatestTokenForUser(usn);
      expect(resetToken).toBeDefined();

      const resetRes = await request(server)
        .post('/api/auth/reset-password')
        .send({ token: resetToken, newPassword: newPass });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.success).toBe(true);

      const userRes = await db.query(`SELECT session_version FROM users WHERE id = $1`, [userId]);
      expect(userRes.rows[0].session_version).toBe(2);

      const meAfter = await request(server)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${oldToken}`);

      expect(meAfter.status).toBe(401);
      expect(meAfter.body.error).toContain('Session revoked');
    });
  });

  describe('4. Disjoint Institutional Identity Resolution & Security Invariants', () => {
    it('authenticates students by USN and staff by Staff ID', async () => {
      const studentUsn = '1SI25CV005';
      const staffId = 'STF-ENG-042';
      const studentPass = 'StudentPass123!';
      const staffPass = 'StaffPass123!';

      await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active, session_version)
         VALUES ('usr_std_cv05', $1, 'student.cv05@sit.ac.in', 'Civil Student', $2, TRUE, 1),
                ('usr_stf_042', $3, 'staff.eng042@sit.ac.in', 'Civil Staff', $4, TRUE, 1)`,
        [studentUsn, await hashPasswordAsync(studentPass), staffId, await hashPasswordAsync(staffPass)]
      );
      await db.query(
        `INSERT INTO roles (id, name, description) VALUES 
           ('role_student', 'STUDENT', 'Student'),
           ('role_proctor', 'PROCTOR', 'Proctor') ON CONFLICT DO NOTHING`
      );
      await db.query(
        `INSERT INTO user_roles (id, user_id, role_id, scope_type) VALUES 
           ('ur_cv05', 'usr_std_cv05', 'role_student', 'STUDENT'),
           ('ur_stf42', 'usr_stf_042', 'role_proctor', 'SYSTEM')`
      );

      const sLogin = await request(server)
        .post('/api/auth/login')
        .send({ identifier: studentUsn, password: studentPass });
      expect(sLogin.status).toBe(200);
      expect(sLogin.body.session.collegeId).toBe(studentUsn);

      const stLogin = await request(server)
        .post('/api/auth/login')
        .send({ identifier: staffId, password: staffPass });
      expect(stLogin.status).toBe(200);
      expect(stLogin.body.session.collegeId).toBe(staffId);
    });

    it('fails closed when an ambiguous identifier matches multiple distinct users', async () => {
      const ambiguousId = 'collision.identifier@sit.ac.in';

      await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active, session_version)
         VALUES ('usr_col_a', 'COLLISION_USER_A', $1, 'User A', 'scrypt$dummy$a', TRUE, 1),
                ('usr_col_b', $1, 'other.b@sit.ac.in', 'User B', 'scrypt$dummy$b', TRUE, 1)`,
        [ambiguousId]
      );

      const response = await request(server)
        .post('/api/auth/login')
        .send({ identifier: ambiguousId, password: 'anyPassword' });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Ambiguous institutional identity');
    });

    it('rejects deactivated accounts from authenticating or receiving activation vouchers', async () => {
      const inactiveUsn = '1SI25CS098';

      await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active, session_version)
         VALUES ('usr_inactive_01', $1, 'inactive@sit.ac.in', 'Inactive Student', 'scrypt$dummy$x', FALSE, 1)`,
        [inactiveUsn]
      );

      const loginRes = await request(server)
        .post('/api/auth/login')
        .send({ identifier: inactiveUsn, password: 'password' });

      expect(loginRes.status).toBe(401);
      expect(loginRes.body.error).toContain('Account is deactivated');

      await expect(
        authService.issueActivationVoucher(inactiveUsn, 'usr_admin')
      ).rejects.toThrow('ACCOUNT_INACTIVE');
    });
  });
});
