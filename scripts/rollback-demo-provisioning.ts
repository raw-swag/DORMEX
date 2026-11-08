import { DatabaseService } from '../src/db/index.js';

export interface RollbackOptions {
  batchId?: string;
  batchUserIds?: string[];
  safeExclusions?: string[];
  dryRun?: boolean;
}

export interface RollbackResult {
  success: boolean;
  dryRun: boolean;
  batchId?: string;
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
 * Validates whether a provided batch identifier is syntactically and semantically valid.
 * Supported format: batch_<alphanumeric> or batch_<timestamp>_<uuid>
 */
export function isValidBatchId(batchId: string): boolean {
  if (!batchId || typeof batchId !== 'string') return false;
  const trimmed = batchId.trim();
  return /^batch_[a-zA-Z0-9_\-]+$/.test(trimmed) && trimmed.length >= 8;
}

/**
 * Safely rolls back provisioned demo accounts in isolated/controlled environments.
 * - STRICT BATCH ISOLATION: Refuses execution unless an explicit, valid batchId or validated batchUserIds is provided.
 * - NEVER falls back to deleting all demo accounts.
 * - Enforces pre-existing account protection (CANONICAL_PROTECTED_COLLEGE_IDS).
 * - Refuses rollback if any targeted account has active allocations, payments, complaints, or accords.
 * - Executes transactionally.
 */
export async function executeDemoProvisioningRollback(
  db: DatabaseService,
  options: RollbackOptions
): Promise<RollbackResult> {
  const protectedIds = options.safeExclusions || CANONICAL_PROTECTED_COLLEGE_IDS;
  const isDryRun = !!options.dryRun;

  // 1. Strict Batch Validation
  const hasBatchId = typeof options.batchId === 'string' && options.batchId.trim().length > 0;
  const hasBatchUserIds = Array.isArray(options.batchUserIds) && options.batchUserIds.length > 0;

  if (!hasBatchId && !hasBatchUserIds) {
    throw new Error(
      'ROLLBACK_REFUSED: Explicit batch identification is required. Rollback cannot execute without a valid batchId or batchUserIds to prevent accidental mass deletion.'
    );
  }

  if (hasBatchId && !isValidBatchId(options.batchId!)) {
    throw new Error(
      `ROLLBACK_REFUSED: Malformed batchId '${options.batchId}'. Expected format: 'batch_<identifier>' (minimum 8 characters).`
    );
  }

  if (hasBatchUserIds && options.batchUserIds!.some((id) => !id || typeof id !== 'string' || id.trim().length === 0)) {
    throw new Error('ROLLBACK_REFUSED: batchUserIds array contains empty or invalid user identifiers.');
  }

  const runWithClient = async (client: any) => {
    const q = client.query.bind(client);

    let targetUserIds: string[] = [];
    let targetCollegeIds: string[] = [];

    // Path A: Batch ID lookup via persistent audit trail
    if (hasBatchId) {
      const cleanBatchId = options.batchId!.trim();

      const auditRes = await q(
        `SELECT DISTINCT target_id FROM audit_logs WHERE correlation_id = $1 AND target_type = 'USER'`,
        [cleanBatchId]
      );

      const auditedUserIds: string[] = auditRes.rows.map((r: any) => r.target_id);

      if (hasBatchUserIds) {
        if (auditedUserIds.length > 0) {
          const auditedSet = new Set(auditedUserIds);
          for (const uid of options.batchUserIds!) {
            if (!auditedSet.has(uid)) {
              throw new Error(
                `ROLLBACK_REFUSED: Provided user ID '${uid}' does not belong to provisioning batch '${cleanBatchId}'. Cross-batch deletion rejected.`
              );
            }
          }
        }
        targetUserIds = [...options.batchUserIds!];
      } else {
        targetUserIds = auditedUserIds;
      }

      if (targetUserIds.length === 0) {
        throw new Error(
          `ROLLBACK_REFUSED: No user records found matching batch identifier '${cleanBatchId}'. Rollback aborted without writes.`
        );
      }
    } else {
      // Path B: Direct validated batchUserIds
      targetUserIds = [...new Set(options.batchUserIds!.map((id) => id.trim()))];
    }

    // 2. Fetch user records and enforce protected exclusions
    const resolvedUsers: { id: string; college_id: string }[] = [];
    for (const uid of targetUserIds) {
      const uRes = await q(`SELECT u.id, u.college_id FROM users u WHERE u.id = $1`, [uid]);
      if (uRes.rows.length > 0) {
        const u = uRes.rows[0];
        if (protectedIds.includes(u.college_id)) {
          throw new Error(
            `ROLLBACK_REFUSED: Target user '${u.college_id}' (${u.id}) is a protected canonical identity and cannot be deleted.`
          );
        }
        resolvedUsers.push(u);
        targetCollegeIds.push(u.college_id);
      }
    }

    if (resolvedUsers.length === 0) {
      return {
        success: true,
        dryRun: isDryRun,
        batchId: options.batchId,
        deletedUsersCount: 0,
        deletedProfilesCount: 0,
        deletedRolesCount: 0,
        preservedExclusions: protectedIds,
      };
    }

    const resolvedUserIds: string[] = resolvedUsers.map((u) => u.id);

    // 3. Safety Invariant Check: Verify no dependent business entities have accumulated
    for (const uid of resolvedUserIds) {
      // Allocations
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

      // Complaints
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
        batchId: options.batchId,
        deletedUsersCount: resolvedUserIds.length,
        deletedProfilesCount: targetCollegeIds.filter((c) => c.startsWith('DEMO-')).length,
        deletedRolesCount: resolvedUserIds.length,
        preservedExclusions: protectedIds,
      };
    }

    // 4. Perform atomic cascaded deletion in reverse foreign-key order
    let deletedProfileCount = 0;
    let deletedRolesCount = 0;
    let deletedUsersCount = 0;

    for (const uid of resolvedUserIds) {
      const spRes = await q(`SELECT id FROM student_profiles WHERE user_id = $1`, [uid]);
      for (const sp of spRes.rows) {
        await q(`DELETE FROM terms_acknowledgements WHERE student_id = $1`, [sp.id]);
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
      batchId: options.batchId,
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
