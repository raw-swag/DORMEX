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
  });
});
