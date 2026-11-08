import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseService, getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { migrateAdm001ToChiefWarden } from '../scripts/migrate-adm001-role.js';

describe('Dedicated ADM001 Role Migration Test Suite (Isolated DB)', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    resetDatabaseInstance();
    db = getDatabaseService(true);
    await runMigrations(db);

    // 1. Setup base roles
    await db.query(`INSERT INTO roles (id, name, description) VALUES
      ('role_student', 'STUDENT', 'Student resident'),
      ('role_chief_warden', 'CHIEF_WARDEN', 'Chief Warden across all hostels'),
      ('role_warden', 'WARDEN', 'Building Warden'),
      ('role_hostel_office', 'HOSTEL_OFFICE', 'Hostel Office Administrator'),
      ('role_super_admin', 'SUPER_ADMIN', 'Super Administrator with system override')
      ON CONFLICT (id) DO NOTHING;`);

    // 2. Setup initial test users: ADM001 with SUPER_ADMIN, SUPERADMIN with SUPER_ADMIN
    await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES
      ('usr_super_admin', 'SUPERADMIN', 'superadmin@college.edu', 'System Super Administrator', 'hash_sa'),
      ('usr_adm001', 'ADM001', 'admin@college.edu', 'Chief Administrator ADM001', 'hash_adm001')
      ON CONFLICT (id) DO NOTHING;`);

    await db.query(`INSERT INTO user_roles (id, user_id, role_id, scope_type, scope_id) VALUES
      ('ur_sa_1', 'usr_super_admin', 'role_super_admin', 'SYSTEM', NULL),
      ('ur_adm001_1', 'usr_adm001', 'role_super_admin', 'SYSTEM', NULL)
      ON CONFLICT (id) DO NOTHING;`);
  });

  afterEach(async () => {
    await db.close();
    resetDatabaseInstance();
  });

  it('successfully migrates ADM001 from SUPER_ADMIN to CHIEF_WARDEN while preserving SUPERADMIN', async () => {
    const result = await migrateAdm001ToChiefWarden(db);
    expect(result.success).toBe(true);
    expect(result.previousRole).toBe('SUPER_ADMIN');
    expect(result.newRole).toBe('CHIEF_WARDEN');

    // Verify ADM001 role in database
    const admRoles = await db.query(
      `SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = 'usr_adm001'`
    );
    expect(admRoles.rows.length).toBe(1);
    expect(admRoles.rows[0].name).toBe('CHIEF_WARDEN');

    // Verify SUPERADMIN is unchanged
    const saRoles = await db.query(
      `SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = 'usr_super_admin'`
    );
    expect(saRoles.rows.length).toBe(1);
    expect(saRoles.rows[0].name).toBe('SUPER_ADMIN');
  });

  it('fails and aborts if ADM001 does not currently hold SUPER_ADMIN', async () => {
    // Demote ADM001 manually beforehand
    await db.query(`DELETE FROM user_roles WHERE user_id = 'usr_adm001'`);
    await db.query(
      `INSERT INTO user_roles (id, user_id, role_id, scope_type) VALUES ('ur_adm001_cw', 'usr_adm001', 'role_chief_warden', 'SYSTEM')`
    );

    await expect(migrateAdm001ToChiefWarden(db)).rejects.toThrowError(
      /PRECONDITION_FAILED: ADM001 is not assigned SUPER_ADMIN role/
    );
  });

  it('fails and aborts if independent SUPERADMIN does not hold SUPER_ADMIN', async () => {
    // Remove SUPERADMIN role
    await db.query(`DELETE FROM user_roles WHERE user_id = 'usr_super_admin'`);

    await expect(migrateAdm001ToChiefWarden(db)).rejects.toThrowError(
      /PRECONDITION_FAILED: Independent SUPERADMIN does not have SUPER_ADMIN role/
    );
  });

  it('fails and aborts if ADM001 user record is missing', async () => {
    await db.query(`DELETE FROM user_roles WHERE user_id = 'usr_adm001'`);
    await db.query(`DELETE FROM users WHERE id = 'usr_adm001'`);

    await expect(migrateAdm001ToChiefWarden(db)).rejects.toThrowError(
      /PRECONDITION_FAILED: ADM001 user not found/
    );
  });
});
