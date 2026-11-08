import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseService, getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { executeDemoProvisioningRollback, CANONICAL_PROTECTED_COLLEGE_IDS } from '../scripts/rollback-demo-provisioning.js';

describe('Demo Provisioning Rollback Test Suite (Isolated DB)', () => {
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

    // 3. Setup newly provisioned accounts (e.g. DEMO-002, DEMO-003, ADM002)
    await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES
      ('usr_demo002', 'DEMO-002', 'student2@college.edu', 'Demo Student 2', 'hash_s2'),
      ('usr_demo003', 'DEMO-003', 'student3@college.edu', 'Demo Student 3', 'hash_s3'),
      ('usr_adm002', 'ADM002', 'admin2@college.edu', 'Chief Warden 2', 'hash_adm002')
      ON CONFLICT (id) DO NOTHING;`);

    await db.query(`INSERT INTO user_roles (id, user_id, role_id, scope_type) VALUES
      ('ur_demo002', 'usr_demo002', 'role_student', 'SYSTEM'),
      ('ur_demo003', 'usr_demo003', 'role_student', 'SYSTEM'),
      ('ur_adm002', 'usr_adm002', 'role_chief_warden', 'SYSTEM')
      ON CONFLICT (id) DO NOTHING;`);

    await db.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category) VALUES
      ('sp_demo002', 'usr_demo002', 'DEMO-002', 'Demo Student 2', 1, 'Computer Science', 'MALE', 'GENERAL'),
      ('sp_demo003', 'usr_demo003', 'DEMO-003', 'Demo Student 3', 1, 'Computer Science', 'FEMALE', 'GENERAL')
      ON CONFLICT (id) DO NOTHING;`);
  });

  afterEach(async () => {
    await db.close();
    resetDatabaseInstance();
  });

  it('safely rolls back newly provisioned accounts while strictly preserving DEMO-001, ADM001, and SUPERADMIN', async () => {
    const res = await executeDemoProvisioningRollback(db);
    expect(res.success).toBe(true);
    expect(res.deletedUsersCount).toBe(3); // DEMO-002, DEMO-003, ADM002
    expect(res.deletedProfilesCount).toBe(2);

    // Verify protected accounts still exist
    for (const cid of CANONICAL_PROTECTED_COLLEGE_IDS) {
      const u = await db.query(`SELECT 1 FROM users WHERE college_id = $1`, [cid]);
      expect(u.rows.length).toBe(1);
    }

    // Verify DEMO-001 student profile still exists
    const sp1 = await db.query(`SELECT 1 FROM student_profiles WHERE college_id = 'DEMO-001'`);
    expect(sp1.rows.length).toBe(1);

    // Verify rolled back accounts are gone
    const rolledBackUsers = await db.query(
      `SELECT college_id FROM users WHERE college_id IN ('DEMO-002', 'DEMO-003', 'ADM002')`
    );
    expect(rolledBackUsers.rows.length).toBe(0);
  });

  it('refuses rollback if an account has accumulated dependent complaints or allocations', async () => {
    // Insert a building first
    await db.query(`INSERT INTO buildings (id, code, name, gender_designation) VALUES
      ('bld_test', 'TEST_B', 'Test Building', 'MALE') ON CONFLICT (id) DO NOTHING;`);

    // Insert a dependent complaint for DEMO-002
    await db.query(`INSERT INTO complaints (id, type, building_id, author_id, title, description) VALUES
      ('comp_test_1', 'PUBLIC', 'bld_test', 'usr_demo002', 'Room dirty', 'Needs sweeping')`);

    await expect(executeDemoProvisioningRollback(db)).rejects.toThrowError(
      /ROLLBACK_ABORTED: Cannot roll back demo users because dependent complaint\(s\) exist/
    );

    // Ensure no deletions took place due to transaction rollback
    const u2 = await db.query(`SELECT 1 FROM users WHERE college_id = 'DEMO-002'`);
    expect(u2.rows.length).toBe(1);
  });
});
