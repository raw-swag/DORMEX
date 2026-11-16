import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';
import { IdentityRetirementService } from '../src/auth/identityRetirementService.js';

describe('Stage 6: Identity Retirement Engine Unit & Integration Suite', () => {
  let db: any;
  let service: IdentityRetirementService;

  beforeAll(async () => {
    resetDatabaseInstance();
    db = getDatabaseService(true);
    await runMigrations(db);
    await seedDatabase(db);
    service = new IdentityRetirementService(db);
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  describe('Eligibility and Dependency Gates', () => {
    it('blocks Chief Warden ADM001 from retirement due to singleton governance lock', async () => {
      const eligibility = await service.assessEligibility('ADM001');
      expect(eligibility).not.toBeNull();
      expect(eligibility?.canRetire).toBe(false);
      expect(eligibility?.blockingReasons.some((r) => r.includes('BLOCKED_CHIEF_WARDEN_SINGLETON'))).toBe(true);
    });

    it('blocks WRD001 from retirement due to active building warden appointment', async () => {
      const eligibility = await service.assessEligibility('WRD001');
      expect(eligibility).not.toBeNull();
      expect(eligibility?.canRetire).toBe(false);
      expect(eligibility?.blockingReasons.some((r) => r.includes('BLOCKED_ACTIVE_WARDEN'))).toBe(true);
    });

    it('blocks PRC001 from retirement due to active assigned students', async () => {
      const eligibility = await service.assessEligibility('PRC001');
      expect(eligibility).not.toBeNull();
      expect(eligibility?.canRetire).toBe(false);
      expect(eligibility?.blockingReasons.some((r) => r.includes('BLOCKED_ACTIVE_PROCTOR_ASSIGNMENTS'))).toBe(true);
    });

    it('identifies unencumbered synthetic identity (e.g. ADM003) as eligible in dry-run mode', async () => {
      const eligibility = await service.assessEligibility('ADM003');
      expect(eligibility).not.toBeNull();
      expect(eligibility?.canRetire).toBe(true);
      expect(eligibility?.blockingReasons.length).toBe(0);

      const dryRunResult = await service.retireIdentity('ADM003', 'usr_admin', { dryRun: true });
      expect(dryRunResult.success).toBe(true);
      expect(dryRunResult.actionTaken).toBe('RETIRED');
      expect(dryRunResult.reasons[0]).toMatch(/DRY RUN/);

      // Verify no changes were made to the database in dry-run mode
      const check = await db.query(`SELECT is_active FROM users WHERE college_id = 'ADM003'`);
      expect(check.rows[0]?.is_active).toBe(true);
    });

    it('returns fail-closed BLOCKED result when assessing a nonexistent user', async () => {
      const result = await service.retireIdentity('NONEXISTENT_USER_999', 'usr_admin');
      expect(result.success).toBe(false);
      expect(result.actionTaken).toBe('BLOCKED');
      expect(result.reasons[0]).toMatch(/NOT_FOUND/);
    });
  });

  describe('Transactional Execution & Audit Logging', () => {
    it('safely retires a temporary disposable test identity and verifies audit log', async () => {
      const tempId = 'usr_test_retire_' + Date.now();
      const tempCollegeId = 'TEST_RET_' + Math.floor(Math.random() * 1000);

      // Insert temporary identity
      await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active, session_version)
         VALUES ($1, $2, $3, 'Retirement Test Candidate', 'test_password_hash', TRUE, 1)`,
        [tempId, tempCollegeId, `${tempCollegeId.toLowerCase()}@test.edu`]
      );

      // Execute live retirement
      const executionResult = await service.retireIdentity(tempId, 'usr_admin', {
        dryRun: false,
        forceReason: 'Testing automated Stage 6 retirement execution',
      });

      expect(executionResult.success).toBe(true);
      expect(executionResult.actionTaken).toBe('RETIRED');
      expect(executionResult.auditLogId).toBeDefined();

      // Verify user was deactivated, password scrambled, session_version incremented
      const updatedUser = await db.query(
        `SELECT is_active, password_hash, session_version FROM users WHERE id = $1`,
        [tempId]
      );
      expect(updatedUser.rows[0].is_active).toBe(false);
      expect(updatedUser.rows[0].password_hash).toMatch(/^RETIRED_/);
      expect(updatedUser.rows[0].session_version).toBe(2);

      // Verify immutable audit log record
      const auditLog = await db.query(
        `SELECT * FROM audit_logs WHERE id = $1`,
        [executionResult.auditLogId]
      );
      expect(auditLog.rows.length).toBe(1);
      expect(auditLog.rows[0].action).toBe('IDENTITY_RETIRED');
      expect(auditLog.rows[0].target_type).toBe('USER');
      expect(auditLog.rows[0].target_id).toBe(tempId);

      // Verify idempotency on second retirement attempt
      const idempotentResult = await service.retireIdentity(tempId, 'usr_admin', { dryRun: false });
      expect(idempotentResult.success).toBe(true);
      expect(idempotentResult.actionTaken).toBe('ALREADY_RETIRED');
    });

    it('proves that a retired identity cannot authenticate, reset password, or recover MFA', async () => {
      const retiredUserId = 'usr_test_retired_auth_' + Date.now();
      const retiredCollegeId = 'TEST_RET_AUTH_' + Math.floor(Math.random() * 1000);
      const { hashPasswordAsync, verifyPasswordAsync } = await import('../src/auth/passwordUtils.js');

      // Create and retire user
      await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active, session_version)
         VALUES ($1, $2, $3, 'Retired Auth User', 'temporary_password', TRUE, 1)`,
        [retiredUserId, retiredCollegeId, `${retiredCollegeId.toLowerCase()}@test.edu`]
      );

      const retiredRes = await service.retireIdentity(retiredUserId, 'usr_admin', { dryRun: false });
      expect(retiredRes.success).toBe(true);

      const userRow = (await db.query(`SELECT password_hash, is_active FROM users WHERE id = $1`, [retiredUserId])).rows[0];
      expect(userRow.is_active).toBe(false);
      expect(userRow.password_hash.startsWith('RETIRED_')).toBe(true);

      // 1. Password verification strictly fails closed against RETIRED_ sentinel
      const verifyRes = await verifyPasswordAsync('temporary_password', userRow.password_hash);
      expect(verifyRes.valid).toBe(false);

      const verifySentinelDirect = await verifyPasswordAsync(userRow.password_hash, userRow.password_hash);
      expect(verifySentinelDirect.valid).toBe(false);

      // 2. Password reset requests fail closed for deactivated/retired users
      const { AuthService } = await import('../src/auth/service.js');
      const authService = new AuthService(db);

      const resetReq = await authService.requestPasswordReset(retiredCollegeId);
      // requestPasswordReset returns neutral success contract to avoid user enumeration,
      // but generates NO tokens in password_reset_tokens
      expect(resetReq.status).toBe('REQUEST_ACCEPTED');

      const tokenCheck = await db.query(
        `SELECT * FROM password_reset_tokens WHERE user_id = $1 AND purpose = 'PASSWORD_RESET'`,
        [retiredUserId]
      );
      expect(tokenCheck.rows.length).toBe(0);

      // 3. Activation voucher issuance throws ACCOUNT_INACTIVE
      await expect(authService.issueActivationVoucher(retiredCollegeId, 'usr_admin')).rejects.toThrow(/ACCOUNT_INACTIVE/);
    });

    it('verifies that appointment revocation retains historical records, timestamps, and reason', async () => {
      const candidateWardenId = 'usr_test_wrd_rev_' + Date.now();
      const candidateCollegeId = 'WRD_TEST_' + Math.floor(Math.random() * 1000);

      await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active, session_version)
         VALUES ($1, $2, $3, 'Warden Candidate', 'test_password', TRUE, 1)`,
        [candidateWardenId, candidateCollegeId, `${candidateCollegeId.toLowerCase()}@test.edu`]
      );

      const apptId = `appt_test_${Date.now()}`;
      await db.query(
        `INSERT INTO warden_appointments (id, user_id, building_id, appointed_by, appointment_status, revocation_reason)
         VALUES ($1, $2, 'bld_bvb', 'usr_admin', 'ACTIVE', NULL)`,
        [apptId, candidateWardenId]
      );

      // Directly assess: active appointment should block retirement
      const initialEligibility = await service.assessEligibility(candidateWardenId);
      expect(initialEligibility?.canRetire).toBe(false);
      expect(initialEligibility?.blockingReasons.some((r) => r.includes('BLOCKED_ACTIVE_WARDEN'))).toBe(true);

      // Now revoke appointment via governance service or simulate replacement
      await db.query(
        `UPDATE warden_appointments SET appointment_status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP, revocation_reason = 'Replacement appointed'
         WHERE id = $1`,
        [apptId]
      );

      // Re-assess: now eligible
      const reEligibility = await service.assessEligibility(candidateWardenId);
      expect(reEligibility?.canRetire).toBe(true);

      // Execute retirement
      const retResult = await service.retireIdentity(candidateWardenId, 'usr_admin', { dryRun: false });
      expect(retResult.success).toBe(true);

      // Verify appointment record still exists permanently in DB with historical metadata intact
      const apptRow = (await db.query(`SELECT * FROM warden_appointments WHERE id = $1`, [apptId])).rows[0];
      expect(apptRow).toBeDefined();
      expect(apptRow.user_id).toBe(candidateWardenId);
      expect(apptRow.building_id).toBe('bld_bvb');
      expect(apptRow.appointment_status).toBe('REVOKED');
      expect(apptRow.revocation_reason).toBe('Replacement appointed');
      expect(apptRow.revoked_at).not.toBeNull();
    });
  });
});
