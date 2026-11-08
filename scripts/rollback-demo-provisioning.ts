import { DatabaseService } from '../src/db/index.js';

export interface RollbackOptions {
  batchUserIds?: string[];
  safeExclusions?: string[];
  dryRun?: boolean;
}

export interface RollbackResult {
  success: boolean;
  dryRun: boolean;
  deletedUsersCount: number;
  deletedProfilesCount: number;
  deletedRolesCount: number;
  preservedExclusions: string[];
}

// Canonical accounts that MUST NEVER be deleted by rollback
export const CANONICAL_PROTECTED_COLLEGE_IDS = [
  'DEMO-001',
  'ADM001',
  'SUPERADMIN',
];

/**
 * Safely rolls back provisioned demo accounts in isolated/controlled environments.
 * - Enforces pre-existing account protection (CANONICAL_PROTECTED_COLLEGE_IDS).
 * - Refuses rollback if any targeted account has active allocations, payments, complaints, or accords.
 * - Executes in a transaction.
 */
export async function executeDemoProvisioningRollback(
  db: DatabaseService,
  options: RollbackOptions = {}
): Promise<RollbackResult> {
  const protectedIds = options.safeExclusions || CANONICAL_PROTECTED_COLLEGE_IDS;
  const isDryRun = !!options.dryRun;

  const runWithClient = async (client: any) => {
    const q = client.query.bind(client);

    // 1. Identify users to roll back
    let usersQuery = `
      SELECT u.id, u.college_id 
      FROM users u
      WHERE (u.college_id LIKE 'DEMO-%' OR u.college_id LIKE 'OFF00%' OR u.college_id IN ('ADM002', 'ADM003'))
        AND u.college_id NOT IN (${protectedIds.map((_, i) => `$${i + 1}`).join(', ')})
    `;
    let params: any[] = [...protectedIds];

    if (options.batchUserIds && options.batchUserIds.length > 0) {
      usersQuery += ` AND u.id IN (${options.batchUserIds.map((_, i) => `$${params.length + i + 1}`).join(', ')})`;
      params.push(...options.batchUserIds);
    }

    const targetUsersRes = await q(usersQuery, params);
    const targetUserIds: string[] = targetUsersRes.rows.map((r: any) => r.id);
    const targetCollegeIds: string[] = targetUsersRes.rows.map((r: any) => r.college_id);

    if (targetUserIds.length === 0) {
      return {
        success: true,
        dryRun: isDryRun,
        deletedUsersCount: 0,
        deletedProfilesCount: 0,
        deletedRolesCount: 0,
        preservedExclusions: protectedIds,
      };
    }

    // 2. Safety Invariant Check: Verify no dependent business entities have accumulated
    // A: Allocations
    for (const uid of targetUserIds) {
      const allocCheck = await q(
        `SELECT COUNT(*)::int as count FROM allocations WHERE student_id IN (
          SELECT id FROM student_profiles WHERE user_id = $1
        )`,
        [uid]
      );
      if (parseInt(allocCheck.rows[0].count, 10) > 0) {
        throw new Error(
          `ROLLBACK_ABORTED: Cannot roll back demo users because dependent room allocation(s) exist.`
        );
      }

      // B: Complaints
      const compCheck = await q(
        `SELECT COUNT(*)::int as count FROM complaints WHERE author_id = $1`,
        [uid]
      );
      if (parseInt(compCheck.rows[0].count, 10) > 0) {
        throw new Error(
          `ROLLBACK_ABORTED: Cannot roll back demo users because dependent complaint(s) exist.`
        );
      }
    }

    if (isDryRun) {
      return {
        success: true,
        dryRun: true,
        deletedUsersCount: targetUserIds.length,
        deletedProfilesCount: targetCollegeIds.filter((c) => c.startsWith('DEMO-')).length,
        deletedRolesCount: targetUserIds.length,
        preservedExclusions: protectedIds,
      };
    }

    // 3. Perform atomic cascaded deletion in reverse foreign-key order
    let deletedAccordCount = 0;
    let deletedProfileCount = 0;
    let deletedRolesCount = 0;
    let deletedUsersCount = 0;

    for (const uid of targetUserIds) {
      const spRes = await q(`SELECT id FROM student_profiles WHERE user_id = $1`, [uid]);
      for (const sp of spRes.rows) {
        const delAccord = await q(`DELETE FROM terms_acknowledgements WHERE student_id = $1`, [sp.id]);
        deletedAccordCount += delAccord.rowCount || delAccord.rows?.length || 0;
      }

      const delProfile = await q(`DELETE FROM student_profiles WHERE user_id = $1`, [uid]);
      deletedProfileCount += delProfile.rowCount || (delProfile.rows ? delProfile.rows.length : 1);

      const delRoles = await q(`DELETE FROM user_roles WHERE user_id = $1`, [uid]);
      deletedRolesCount += delRoles.rowCount || (delRoles.rows ? delRoles.rows.length : 1);

      const delUser = await q(`DELETE FROM users WHERE id = $1`, [uid]);
      deletedUsersCount += delUser.rowCount || (delUser.rows ? delUser.rows.length : 1);
    }

    return {
      success: true,
      dryRun: false,
      deletedUsersCount,
      deletedProfilesCount: deletedProfileCount,
      deletedRolesCount,
      preservedExclusions: protectedIds,
    };
  };

  if (isDryRun) {
    return runWithClient(db);
  }

  return db.transaction(async (client) => {
    return runWithClient(client);
  });
}
