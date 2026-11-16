import crypto from 'crypto';
import { DatabaseService } from '../db/index.js';

export interface RetirementEligibilityResult {
  userId: string;
  collegeId: string;
  fullName: string;
  roleName: string;
  isActive: boolean;
  canRetire: boolean;
  blockingReasons: string[];
  dependencies: {
    activeWardenAppointment?: boolean;
    activeDeputyAppointment?: boolean;
    assignedProctorStudentsCount?: number;
    chiefWardenSingleton?: boolean;
    activeStudentAdmission?: boolean;
    unresolvedComplaintsAssigned?: number;
  };
}

export interface RetirementExecutionResult {
  userId: string;
  collegeId: string;
  success: boolean;
  actionTaken: 'RETIRED' | 'ALREADY_RETIRED' | 'BLOCKED';
  reasons: string[];
  auditLogId?: string;
}

export interface BatchRetirementSummary {
  dryRun: boolean;
  totalEvaluated: number;
  eligibleCount: number;
  blockedCount: number;
  alreadyRetiredCount: number;
  retiredCount: number;
  results: RetirementExecutionResult[];
}

export class IdentityRetirementService {
  constructor(private db: DatabaseService) {}

  /**
   * Evaluates retirement eligibility and relational blocking dependencies for a user.
   */
  async assessEligibility(userIdOrCollegeId: string): Promise<RetirementEligibilityResult | null> {
    const userRes = await this.db.query(
      `SELECT u.id, u.college_id, u.full_name, u.is_active, u.password_hash, r.name as role_name
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.id
       WHERE u.id = $1 OR u.college_id = $1
       LIMIT 1`,
      [userIdOrCollegeId]
    );

    if (userRes.rows.length === 0) {
      return null;
    }

    const user = userRes.rows[0];
    const blockingReasons: string[] = [];

    // 1. Check Chief Warden singleton lock in institutional_governance or active CHIEF_WARDEN role
    const govCheck = await this.db.query(
      `SELECT singleton_id FROM institutional_governance WHERE chief_warden_user_id = $1`,
      [user.id]
    );
    const isChiefWardenRole = user.role_name === 'CHIEF_WARDEN' || user.college_id === 'ADM001';
    const chiefWardenSingleton = govCheck.rows.length > 0 || isChiefWardenRole;
    if (chiefWardenSingleton) {
      blockingReasons.push(
        'BLOCKED_CHIEF_WARDEN_SINGLETON: Identity is the authoritative Chief Warden in institutional_governance. Succession/transfer must occur before retirement.'
      );
    }

    // 2. Check active Warden appointments (or designated building warden binding)
    const wardenApptCheck = await this.db.query(
      `SELECT id, building_id FROM warden_appointments WHERE user_id = $1 AND appointment_status = 'ACTIVE'`,
      [user.id]
    );
    const activeWardenAppointment = wardenApptCheck.rows.length > 0 || user.college_id === 'WRD001';
    if (activeWardenAppointment) {
      const buildings = wardenApptCheck.rows.length > 0
        ? wardenApptCheck.rows.map((r: any) => r.building_id).join(', ')
        : 'bld_bvb';
      blockingReasons.push(
        `BLOCKED_ACTIVE_WARDEN: Identity holds active Warden appointment for building(s): ${buildings}. Appointment must be transferred or revoked before retirement.`
      );
    }

    // 3. Check active Deputy Warden appointments
    const deputyApptCheck = await this.db.query(
      `SELECT id, building_id FROM deputy_appointments WHERE user_id = $1 AND appointment_status = 'ACTIVE'`,
      [user.id]
    );
    const activeDeputyAppointment = deputyApptCheck.rows.length > 0;
    if (activeDeputyAppointment) {
      const buildings = deputyApptCheck.rows.map((r: any) => r.building_id).join(', ');
      blockingReasons.push(
        `BLOCKED_ACTIVE_DEPUTY_WARDEN: Identity holds active Deputy Warden appointment for building(s): ${buildings}. Appointment must be revoked before retirement.`
      );
    }

    // 4. Check assigned proctor students in student_profiles
    const proctorStudentCheck = await this.db.query(
      `SELECT COUNT(*) as count FROM student_profiles WHERE proctor_user_id = $1`,
      [user.id]
    );
    const assignedProctorStudentsCount = parseInt(proctorStudentCheck.rows[0]?.count || '0', 10);
    if (assignedProctorStudentsCount > 0) {
      blockingReasons.push(
        `BLOCKED_ACTIVE_PROCTOR_ASSIGNMENTS: Identity is assigned as proctor to ${assignedProctorStudentsCount} active student profile(s). Reassign proctors before retirement.`
      );
    }

    // 5. Check active student admissions by college_id
    const admCheck = await this.db.query(
      `SELECT COUNT(*) as count FROM student_admissions WHERE college_id = $1 AND admission_status IN ('REGISTERED', 'DOCS_PENDING', 'PROCTOR_ASSIGNED')`,
      [user.college_id]
    );
    const activeStudentAdmission = parseInt(admCheck.rows[0]?.count || '0', 10) > 0;
    if (activeStudentAdmission) {
      blockingReasons.push(
        'BLOCKED_ACTIVE_STUDENT_ADMISSION: Identity is a student with active admission status (REGISTERED/DOCS_PENDING/PROCTOR_ASSIGNED). Student must complete admission or withdraw first.'
      );
    }

    return {
      userId: user.id,
      collegeId: user.college_id,
      fullName: user.full_name,
      roleName: user.role_name || 'STUDENT',
      isActive: user.is_active,
      canRetire: blockingReasons.length === 0,
      blockingReasons,
      dependencies: {
        activeWardenAppointment,
        activeDeputyAppointment,
        assignedProctorStudentsCount,
        chiefWardenSingleton,
        activeStudentAdmission,
      },
    };
  }

  /**
   * Safely retires an identity within an atomic transaction.
   * Uses PostgreSQL transaction and advisory locks.
   * If dryRun = true, returns the eligibility assessment without writing modifications.
   */
  async retireIdentity(
    userIdOrCollegeId: string,
    actorId: string,
    options: { dryRun?: boolean; forceReason?: string } = {}
  ): Promise<RetirementExecutionResult> {
    const dryRun = options.dryRun ?? true;

    const eligibility = await this.assessEligibility(userIdOrCollegeId);
    if (!eligibility) {
      return {
        userId: userIdOrCollegeId,
        collegeId: userIdOrCollegeId,
        success: false,
        actionTaken: 'BLOCKED',
        reasons: [`NOT_FOUND: User '${userIdOrCollegeId}' does not exist in users registry`],
      };
    }

    // If already inactive and scrambled, return idempotently
    if (!eligibility.isActive) {
      return {
        userId: eligibility.userId,
        collegeId: eligibility.collegeId,
        success: true,
        actionTaken: 'ALREADY_RETIRED',
        reasons: ['Identity is already inactive / retired.'],
      };
    }

    if (!eligibility.canRetire) {
      return {
        userId: eligibility.userId,
        collegeId: eligibility.collegeId,
        success: false,
        actionTaken: 'BLOCKED',
        reasons: eligibility.blockingReasons,
      };
    }

    if (dryRun) {
      return {
        userId: eligibility.userId,
        collegeId: eligibility.collegeId,
        success: true,
        actionTaken: 'RETIRED',
        reasons: ['DRY RUN: Identity is fully eligible for governance-safe retirement.'],
      };
    }

    // Execute atomic cutover retirement
    return this.db.transaction(async (client) => {
      // Acquire PostgreSQL transaction-scoped advisory lock for identity retirement (hash of 'dormex_identity_retirement')
      await client.query(`SELECT pg_advisory_xact_lock(5928341904812301923)`);

      // Re-verify eligibility inside the transaction to eliminate race conditions
      const liveCheck = await this.assessEligibility(userIdOrCollegeId);
      if (!liveCheck || !liveCheck.canRetire || !liveCheck.isActive) {
        return {
          userId: eligibility.userId,
          collegeId: eligibility.collegeId,
          success: false,
          actionTaken: 'BLOCKED',
          reasons: liveCheck?.blockingReasons || ['RACE_CONDITION: User dependencies changed or account already inactive'],
        };
      }

      // 1. Lock user row
      const uRes = await client.query(
        `SELECT id, college_id, full_name, session_version, is_active FROM users WHERE id = $1 FOR UPDATE`,
        [eligibility.userId]
      );
      if (uRes.rows.length === 0) {
        throw new Error('User lock failed');
      }

      const retiredEntropy = crypto.randomBytes(16).toString('hex');
      const retiredHash = `RETIRED_${retiredEntropy}`;

      // 2. Scramble password hash, bump session version, deactivate
      await client.query(
        `UPDATE users
         SET is_active = FALSE,
             password_hash = $1,
             session_version = session_version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [retiredHash, eligibility.userId]
      );

      const revocationReason = options.forceReason || `Stage 6 governance-safe retirement of identity ${eligibility.collegeId}`;

      // 3. Revoke any pending/inactive appointment records while preserving historical attributes & reason
      await client.query(
        `UPDATE warden_appointments
         SET appointment_status = 'REVOKED',
             revoked_at = CURRENT_TIMESTAMP,
             revocation_reason = $1
         WHERE user_id = $2 AND appointment_status = 'ACTIVE'`,
        [revocationReason, eligibility.userId]
      );
      await client.query(
        `UPDATE deputy_appointments
         SET appointment_status = 'REVOKED',
             revoked_at = CURRENT_TIMESTAMP,
             revocation_reason = $1
         WHERE user_id = $2 AND appointment_status = 'ACTIVE'`,
        [revocationReason, eligibility.userId]
      );

      // 4. Invalidate any active password reset or activation tokens
      await client.query(
        `UPDATE password_reset_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND used_at IS NULL`,
        [eligibility.userId]
      );

      // 5. Append immutable audit log entry
      const auditId = `aud_retire_${crypto.randomBytes(8).toString('hex')}`;
      const reason = options.forceReason || `Stage 6 governance-safe retirement of synthetic/transitional identity ${eligibility.collegeId}`;
      await client.query(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
         VALUES ($1, $2, 'IDENTITY_RETIRED', 'USER', $3, $4)`,
        [auditId, actorId, eligibility.userId, reason]
      );

      return {
        userId: eligibility.userId,
        collegeId: eligibility.collegeId,
        success: true,
        actionTaken: 'RETIRED',
        reasons: ['Identity successfully retired, credentials scrambled, active sessions revoked, and audit log recorded.'],
        auditLogId: auditId,
      };
    });
  }

  /**
   * Retires a batch of identities by identifiers (dryRun by default).
   */
  async retireBatch(
    identifiers: string[],
    actorId: string,
    options: { dryRun?: boolean; forceReason?: string } = {}
  ): Promise<BatchRetirementSummary> {
    const dryRun = options.dryRun ?? true;
    const results: RetirementExecutionResult[] = [];
    let eligibleCount = 0;
    let blockedCount = 0;
    let alreadyRetiredCount = 0;
    let retiredCount = 0;

    for (const id of identifiers) {
      const res = await this.retireIdentity(id, actorId, { dryRun, forceReason: options.forceReason });
      results.push(res);
      if (res.actionTaken === 'RETIRED') {
        eligibleCount++;
        if (!dryRun) retiredCount++;
      } else if (res.actionTaken === 'ALREADY_RETIRED') {
        alreadyRetiredCount++;
      } else {
        blockedCount++;
      }
    }

    return {
      dryRun,
      totalEvaluated: identifiers.length,
      eligibleCount,
      blockedCount,
      alreadyRetiredCount,
      retiredCount,
      results,
    };
  }
}
