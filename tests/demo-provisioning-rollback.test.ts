import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseService, getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import {
  executeDemoProvisioningRollback,
  CANONICAL_PROTECTED_COLLEGE_IDS,
  isValidBatchId,
} from '../scripts/rollback-demo-provisioning.js';

describe('Demo Provisioning Rollback Test Suite with Strict Batch Isolation (Isolated DB)', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    resetDatabaseInstance();
    db = getDatabaseService(true);
    await runMigrations(db);

    // 1. Setup base roles
    await db.query(`INSERT INTO roles (id, name, description) VALUES
      ('role_student', 'STUDENT', 'Student resident'),
      ('role_chief_warden', 'CHIEF_WARDEN', 'Chief Warden across all hostels'),
      ('role_super_admin', 'SUPER_ADMIN', 'Super Administrator with system override')
      ON CONFLICT (id) DO NOTHING;`);

    // 2. Setup protected pre-existing accounts
    await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES
      ('usr_super_admin', 'SUPERADMIN', 'superadmin@college.edu', 'System Super Administrator', 'hash_sa'),
      ('usr_adm001', 'ADM001', 'admin@college.edu', 'Chief Administrator ADM001', 'hash_adm001'),
      ('usr_demo001', 'DEMO-001', 'student1@college.edu', 'Demo Student 1', 'hash_s1')
      ON CONFLICT (id) DO NOTHING;`);

    await db.query(`INSERT INTO user_roles (id, user_id, role_id, scope_type) VALUES
      ('ur_sa', 'usr_super_admin', 'role_super_admin', 'SYSTEM'),
      ('ur_adm001', 'usr_adm001', 'role_chief_warden', 'SYSTEM'),
      ('ur_demo001', 'usr_demo001', 'role_student', 'SYSTEM')
      ON CONFLICT (id) DO NOTHING;`);

    await db.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category) VALUES
      ('sp_demo001', 'usr_demo001', 'DEMO-001', 'Demo Student 1', 1, 'Computer Science', 'MALE', 'GENERAL')
      ON CONFLICT (id) DO NOTHING;`);

    // 3. Setup batch A provisioned accounts (batch_alpha_01): DEMO-002, DEMO-003
    await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES
      ('usr_demo002', 'DEMO-002', 'student2@college.edu', 'Demo Student 2', 'hash_s2'),
      ('usr_demo003', 'DEMO-003', 'student3@college.edu', 'Demo Student 3', 'hash_s3')
      ON CONFLICT (id) DO NOTHING;`);

    await db.query(`INSERT INTO user_roles (id, user_id, role_id, scope_type) VALUES
      ('ur_demo002', 'usr_demo002', 'role_student', 'SYSTEM'),
      ('ur_demo003', 'usr_demo003', 'role_student', 'SYSTEM')
      ON CONFLICT (id) DO NOTHING;`);

    await db.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category) VALUES
      ('sp_demo002', 'usr_demo002', 'DEMO-002', 'Demo Student 2', 1, 'Computer Science', 'MALE', 'GENERAL'),
      ('sp_demo003', 'usr_demo003', 'DEMO-003', 'Demo Student 3', 1, 'Computer Science', 'FEMALE', 'GENERAL')
      ON CONFLICT (id) DO NOTHING;`);

    // Audit logs linking Batch A users to batch_alpha_01
    await db.query(`INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, correlation_id) VALUES
      ('aud_a_1', 'usr_adm001', 'PROVISION_USER', 'USER', 'usr_demo002', 'batch_alpha_01'),
      ('aud_a_2', 'usr_adm001', 'PROVISION_USER', 'USER', 'usr_demo003', 'batch_alpha_01')
      ON CONFLICT (id) DO NOTHING;`);

    // 4. Setup batch B provisioned accounts (batch_beta_02): DEMO-004, ADM002
    await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES
      ('usr_demo004', 'DEMO-004', 'student4@college.edu', 'Demo Student 4', 'hash_s4'),
      ('usr_adm002', 'ADM002', 'admin2@college.edu', 'Chief Warden 2', 'hash_adm002')
      ON CONFLICT (id) DO NOTHING;`);

    await db.query(`INSERT INTO user_roles (id, user_id, role_id, scope_type) VALUES
      ('ur_demo004', 'usr_demo004', 'role_student', 'SYSTEM'),
      ('ur_adm002', 'usr_adm002', 'role_chief_warden', 'SYSTEM')
      ON CONFLICT (id) DO NOTHING;`);

    await db.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category) VALUES
      ('sp_demo004', 'usr_demo004', 'DEMO-004', 'Demo Student 4', 1, 'Computer Science', 'MALE', 'GENERAL')
      ON CONFLICT (id) DO NOTHING;`);

    // Audit logs linking Batch B users to batch_beta_02
    await db.query(`INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, correlation_id) VALUES
      ('aud_b_1', 'usr_adm001', 'PROVISION_USER', 'USER', 'usr_demo004', 'batch_beta_02'),
      ('aud_b_2', 'usr_adm001', 'PROVISION_USER', 'USER', 'usr_adm002', 'batch_beta_02')
      ON CONFLICT (id) DO NOTHING;`);
  });

  afterEach(async () => {
    await db.close();
    resetDatabaseInstance();
  });

  it('validates batch identifier syntax correctly', () => {
    expect(isValidBatchId('batch_alpha_01')).toBe(true);
    expect(isValidBatchId('batch_20261108_abcdef123')).toBe(true);
    expect(isValidBatchId('')).toBe(false);
    expect(isValidBatchId('short')).toBe(false);
    expect(isValidBatchId('batch; DROP TABLE users;')).toBe(false);
  });

  it('strictly refuses rollback without an explicit batchId or batchUserIds', async () => {
    // @ts-expect-error test runtime omission
    await expect(executeDemoProvisioningRollback(db, {})).rejects.toThrowError(
      /ROLLBACK_REFUSED: Explicit batch identification is required/
    );

    // Verify 0 users were deleted
    const count = await db.query('SELECT COUNT(*)::int as count FROM users');
    expect(count.rows[0].count).toBe(7);
  });

  it('strictly refuses rollback with empty or malformed batch identifiers', async () => {
    await expect(
      executeDemoProvisioningRollback(db, { batchId: '   ' })
    ).rejects.toThrowError(/ROLLBACK_REFUSED: Explicit batch identification is required/);

    await expect(
      executeDemoProvisioningRollback(db, { batchId: 'malformed_batch' })
    ).rejects.toThrowError(/ROLLBACK_REFUSED: Malformed batchId/);

    await expect(
      executeDemoProvisioningRollback(db, { batchUserIds: [''] })
    ).rejects.toThrowError(/ROLLBACK_REFUSED: batchUserIds array contains empty or invalid/);
  });

  it('rolls back Batch A users cleanly without affecting Batch B or pre-existing protected users', async () => {
    const res = await executeDemoProvisioningRollback(db, { batchId: 'batch_alpha_01' });
    expect(res.success).toBe(true);
    expect(res.deletedUsersCount).toBe(2); // DEMO-002, DEMO-003
    expect(res.deletedProfilesCount).toBe(2);

    // Batch A users are deleted
    const batchA = await db.query(`SELECT college_id FROM users WHERE college_id IN ('DEMO-002', 'DEMO-003')`);
    expect(batchA.rows.length).toBe(0);

    // Batch B users are strictly INTACT
    const batchB = await db.query(`SELECT college_id FROM users WHERE college_id IN ('DEMO-004', 'ADM002')`);
    expect(batchB.rows.length).toBe(2);

    // Protected accounts are strictly INTACT
    for (const cid of CANONICAL_PROTECTED_COLLEGE_IDS) {
      const p = await db.query(`SELECT 1 FROM users WHERE college_id = $1`, [cid]);
      expect(p.rows.length).toBe(1);
    }
  });

  it('refuses cross-batch user deletion when caller specifies user IDs not belonging to batchId', async () => {
    // Attempt to delete Batch B user usr_demo004 while claiming batchId is batch_alpha_01
    await expect(
      executeDemoProvisioningRollback(db, {
        batchId: 'batch_alpha_01',
        batchUserIds: ['usr_demo004'],
      })
    ).rejects.toThrowError(/ROLLBACK_REFUSED: Provided user ID 'usr_demo004' does not belong to provisioning batch 'batch_alpha_01'/);

    // Verify no users deleted
    const check = await db.query(`SELECT 1 FROM users WHERE id = 'usr_demo004'`);
    expect(check.rows.length).toBe(1);
  });

  it('refuses rollback if targeting a protected canonical user directly', async () => {
    await expect(
      executeDemoProvisioningRollback(db, {
        batchUserIds: ['usr_adm001'],
      })
    ).rejects.toThrowError(/ROLLBACK_REFUSED: Target user 'ADM001'.*is a protected canonical identity/);
  });

  it('refuses rollback if an account has accumulated dependent complaints or allocations', async () => {
    await db.query(`INSERT INTO buildings (id, code, name, gender_designation) VALUES
      ('bld_test', 'TEST_B', 'Test Building', 'MALE') ON CONFLICT (id) DO NOTHING;`);

    await db.query(`INSERT INTO complaints (id, type, building_id, author_id, title, description) VALUES
      ('comp_test_1', 'PUBLIC', 'bld_test', 'usr_demo002', 'Room dirty', 'Needs sweeping')`);

    await expect(
      executeDemoProvisioningRollback(db, { batchId: 'batch_alpha_01' })
    ).rejects.toThrowError(/ROLLBACK_ABORTED: Cannot roll back demo users because dependent complaint\(s\) exist/);

    const u2 = await db.query(`SELECT 1 FROM users WHERE college_id = 'DEMO-002'`);
    expect(u2.rows.length).toBe(1);
  });
});
