import { DatabaseService } from '../src/db/index.js';
import crypto from 'crypto';

export interface MigrationResult {
  success: boolean;
  message: string;
  previousRole?: string;
  newRole?: string;
}

/**
 * Executes the dedicated ADM001 role migration atomically.
 * Preconditions:
 * 1. SUPERADMIN user exists and holds SUPER_ADMIN role.
 * 2. ADM001 user exists and holds SUPER_ADMIN role.
 * 3. CHIEF_WARDEN role exists in roles table.
 *
 * Postconditions:
 * 1. ADM001 holds CHIEF_WARDEN role (scope_type = 'SYSTEM').
 * 2. ADM001 no longer holds SUPER_ADMIN role.
 * 3. SUPERADMIN user is unchanged and retains SUPER_ADMIN role.
 */
export async function migrateAdm001ToChiefWarden(
  db: DatabaseService,
  client?: any
): Promise<MigrationResult> {
  const q = client ? client.query.bind(client) : db.query.bind(db);

  // 1. Resolve role IDs
  const superAdminRoleRes = await q(`SELECT id FROM roles WHERE name = 'SUPER_ADMIN'`);
  if (superAdminRoleRes.rows.length === 0) {
    throw new Error('PRECONDITION_FAILED: SUPER_ADMIN role not found in roles table.');
  }
  const superAdminRoleId = superAdminRoleRes.rows[0].id;

  const chiefWardenRoleRes = await q(`SELECT id FROM roles WHERE name = 'CHIEF_WARDEN'`);
  if (chiefWardenRoleRes.rows.length === 0) {
    throw new Error('PRECONDITION_FAILED: CHIEF_WARDEN role not found in roles table.');
  }
  const chiefWardenRoleId = chiefWardenRoleRes.rows[0].id;

  // 2. Verify independent SUPERADMIN identity
  const superAdminUserRes = await q(`SELECT id FROM users WHERE college_id = 'SUPERADMIN'`);
  if (superAdminUserRes.rows.length === 0) {
    throw new Error('PRECONDITION_FAILED: Independent SUPERADMIN user not found.');
  }
  const superAdminUserId = superAdminUserRes.rows[0].id;

  const superAdminCheck = await q(
    `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
    [superAdminUserId, superAdminRoleId]
  );
  if (superAdminCheck.rows.length === 0) {
    throw new Error('PRECONDITION_FAILED: Independent SUPERADMIN does not have SUPER_ADMIN role.');
  }

  // 3. Verify ADM001 identity and current role
  const adm001UserRes = await q(`SELECT id FROM users WHERE college_id = 'ADM001'`);
  if (adm001UserRes.rows.length === 0) {
    throw new Error('PRECONDITION_FAILED: ADM001 user not found.');
  }
  const adm001UserId = adm001UserRes.rows[0].id;

  const adm001CurrentRole = await q(
    `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
    [adm001UserId, superAdminRoleId]
  );
  if (adm001CurrentRole.rows.length === 0) {
    throw new Error(
      'PRECONDITION_FAILED: ADM001 is not assigned SUPER_ADMIN role. Aborting to avoid inconsistent state.'
    );
  }

  // 4. Remove SUPER_ADMIN role assignment from ADM001
  await q(
    `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`,
    [adm001UserId, superAdminRoleId]
  );

  // 5. Add CHIEF_WARDEN role assignment if not already present
  const existingChiefRole = await q(
    `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
    [adm001UserId, chiefWardenRoleId]
  );

  if (existingChiefRole.rows.length === 0) {
    const newRoleId = `ur_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await q(
      `INSERT INTO user_roles (id, user_id, role_id, scope_type, scope_id, created_at)
       VALUES ($1, $2, $3, 'SYSTEM', NULL, NOW())`,
      [newRoleId, adm001UserId, chiefWardenRoleId]
    );
  }

  // 6. Postcondition assertion
  const verifySuperAdminRemoved = await q(
    `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
    [adm001UserId, superAdminRoleId]
  );
  if (verifySuperAdminRemoved.rows.length > 0) {
    throw new Error('POSTCONDITION_FAILED: ADM001 still retains SUPER_ADMIN role.');
  }

  const verifyChiefWardenAssigned = await q(
    `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
    [adm001UserId, chiefWardenRoleId]
  );
  if (verifyChiefWardenAssigned.rows.length === 0) {
    throw new Error('POSTCONDITION_FAILED: ADM001 was not assigned CHIEF_WARDEN role.');
  }

  // Confirm SUPERADMIN still has SUPER_ADMIN
  const verifySuperAdminIntact = await q(
    `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2`,
    [superAdminUserId, superAdminRoleId]
  );
  if (verifySuperAdminIntact.rows.length === 0) {
    throw new Error('POSTCONDITION_FAILED: Independent SUPERADMIN lost SUPER_ADMIN role.');
  }

  return {
    success: true,
    message: 'ADM001 role successfully migrated from SUPER_ADMIN to CHIEF_WARDEN.',
    previousRole: 'SUPER_ADMIN',
    newRole: 'CHIEF_WARDEN',
  };
}
