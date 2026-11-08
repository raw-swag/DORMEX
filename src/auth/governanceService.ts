import { DatabaseService } from '../db/index.js';

export interface AppointWardenParams {
  userId: string;
  buildingId: string;
  appointedBy: string;
  reason: string;
}

export interface AppointDeputyParams {
  userId: string;
  buildingId: string;
  supervisorWardenApptId: string;
  appointedBy: string;
  reason: string;
}

export interface RevokeAppointmentParams {
  appointmentId: string;
  revokedBy: string;
  reason: string;
}

export interface TransferSuperAdminParams {
  newChiefWardenUserId: string;
  transferredBy: string;
  reason: string;
}

/**
 * Service providing database transactions and locking for Stage 1 Institutional Governance.
 */
export class GovernanceService {
  constructor(private db: DatabaseService) {}

  /**
   * Helper to append an immutable governance action and corresponding event record.
   */
  private async recordAction(
    client: { query: (text: string, params?: any[]) => Promise<any> },
    actionType: string,
    actorId: string,
    targetUserId: string | null,
    buildingId: string | null,
    reason: string,
    eventType: string,
    details: Record<string, any>
  ): Promise<string> {
    const actionId = `act_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    await client.query(
      `INSERT INTO governance_actions (id, action_type, actor_id, target_user_id, building_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actionId, actionType, actorId, targetUserId, buildingId, reason]
    );

    await client.query(
      `INSERT INTO governance_action_events (id, action_id, event_type, details_json)
       VALUES ($1, $2, $3, $4)`,
      [eventId, actionId, eventType, JSON.stringify(details)]
    );

    return actionId;
  }

  /**
   * Appoints a Warden to an active approved building.
   * Locks the candidate user and the building row.
   * Enforces cross-role exclusivity (cannot already be an active Deputy).
   */
  async appointWarden(params: AppointWardenParams): Promise<string> {
    return await this.db.transaction(async (client) => {
      // 1. Lock candidate user
      const userRes = await client.query(`SELECT id, college_id FROM users WHERE id = $1 FOR UPDATE`, [params.userId]);
      if (userRes.rows.length === 0) {
        throw new Error(`CANDIDATE_NOT_FOUND: User '${params.userId}' does not exist.`);
      }

      // 2. Lock building row and verify lifecycle status
      const bldRes = await client.query(
        `SELECT id, code, lifecycle_status, is_active FROM buildings WHERE id = $1 FOR UPDATE`,
        [params.buildingId]
      );
      if (bldRes.rows.length === 0) {
        throw new Error(`BUILDING_NOT_FOUND: Building '${params.buildingId}' does not exist.`);
      }
      const bld = bldRes.rows[0];
      if (bld.lifecycle_status !== 'ACTIVE' && bld.lifecycle_status !== 'APPROVED') {
        throw new Error(
          `BUILDING_NOT_ELIGIBLE: Cannot appoint Warden to building '${params.buildingId}' with status '${bld.lifecycle_status}'. Building must be APPROVED or ACTIVE.`
        );
      }

      // 3. Cross-role exclusivity: candidate must NOT hold an active deputy appointment
      const activeDeputy = await client.query(
        `SELECT id FROM deputy_appointments WHERE user_id = $1 AND appointment_status = 'ACTIVE'`,
        [params.userId]
      );
      if (activeDeputy.rows.length > 0) {
        throw new Error(
          `CROSS_ROLE_CONFLICT: User '${params.userId}' already holds an active Deputy appointment ('${activeDeputy.rows[0].id}'). Cross-role coexistence is forbidden.`
        );
      }

      // 4. Candidate must not already be an active Warden elsewhere
      const existingWarden = await client.query(
        `SELECT id, building_id FROM warden_appointments WHERE user_id = $1 AND appointment_status = 'ACTIVE'`,
        [params.userId]
      );
      if (existingWarden.rows.length > 0) {
        throw new Error(
          `ACTIVE_APPOINTMENT_CONFLICT: User '${params.userId}' is already active Warden for building '${existingWarden.rows[0].building_id}'.`
        );
      }

      // 5. Building must not already have an active Warden
      const buildingWarden = await client.query(
        `SELECT id, user_id FROM warden_appointments WHERE building_id = $1 AND appointment_status = 'ACTIVE'`,
        [params.buildingId]
      );
      if (buildingWarden.rows.length > 0) {
        throw new Error(
          `BUILDING_OCCUPIED: Building '${params.buildingId}' already has an active Warden ('${buildingWarden.rows[0].user_id}').`
        );
      }

      // 6. Create appointment
      const apptId = `appt_wrd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await client.query(
        `INSERT INTO warden_appointments (id, user_id, building_id, appointed_by, appointment_status)
         VALUES ($1, $2, $3, $4, 'ACTIVE')`,
        [apptId, params.userId, params.buildingId, params.appointedBy]
      );

      // 7. Update user_roles to WARDEN scoped to this building
      await client.query(
        `INSERT INTO user_roles (id, user_id, role_id, scope_type, scope_id)
         VALUES ($1, $2, 'role_warden', 'BUILDING', $3)
         ON CONFLICT (id) DO UPDATE
         SET role_id = 'role_warden', scope_type = 'BUILDING', scope_id = EXCLUDED.scope_id`,
        [`ur_${params.userId}`, params.userId, params.buildingId]
      );

      // 8. Record audit ledger
      await this.recordAction(
        client,
        'APPOINT_WARDEN',
        params.appointedBy,
        params.userId,
        params.buildingId,
        params.reason,
        'WARDEN_APPOINTED',
        { appointment_id: apptId, building_id: params.buildingId }
      );

      return apptId;
    });
  }

  /**
   * Appoints a Deputy Warden to report to a supervising Warden in the same building.
   * Locks the supervising Warden appointment and the candidate user.
   */
  async appointDeputy(params: AppointDeputyParams): Promise<string> {
    return await this.db.transaction(async (client) => {
      // 1. Lock candidate user
      const userRes = await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [params.userId]);
      if (userRes.rows.length === 0) {
        throw new Error(`CANDIDATE_NOT_FOUND: User '${params.userId}' does not exist.`);
      }

      // 2. Lock and verify supervisor Warden appointment
      const supRes = await client.query(
        `SELECT id, user_id, building_id, appointment_status
         FROM warden_appointments
         WHERE id = $1 FOR UPDATE`,
        [params.supervisorWardenApptId]
      );
      if (supRes.rows.length === 0) {
        throw new Error(`SUPERVISOR_NOT_FOUND: Warden appointment '${params.supervisorWardenApptId}' does not exist.`);
      }
      const supervisor = supRes.rows[0];
      if (supervisor.appointment_status !== 'ACTIVE') {
        throw new Error(
          `SUPERVISOR_INACTIVE: Supervisor Warden appointment '${params.supervisorWardenApptId}' is not ACTIVE (status: ${supervisor.appointment_status}).`
        );
      }
      if (supervisor.building_id !== params.buildingId) {
        throw new Error(
          `BUILDING_MISMATCH: Supervisor belongs to building '${supervisor.building_id}', but appointment requested building '${params.buildingId}'.`
        );
      }

      // 3. Cross-role exclusivity: candidate cannot already be active Warden
      const activeWarden = await client.query(
        `SELECT id FROM warden_appointments WHERE user_id = $1 AND appointment_status = 'ACTIVE'`,
        [params.userId]
      );
      if (activeWarden.rows.length > 0) {
        throw new Error(
          `CROSS_ROLE_CONFLICT: User '${params.userId}' is already an active Warden ('${activeWarden.rows[0].id}').`
        );
      }

      // 4. Candidate must not already be an active Deputy
      const activeDeputy = await client.query(
        `SELECT id FROM deputy_appointments WHERE user_id = $1 AND appointment_status = 'ACTIVE'`,
        [params.userId]
      );
      if (activeDeputy.rows.length > 0) {
        throw new Error(
          `ACTIVE_APPOINTMENT_CONFLICT: User '${params.userId}' is already an active Deputy Warden ('${activeDeputy.rows[0].id}').`
        );
      }

      // 5. 1:1 Cardinality check: supervisor must not already have an active Deputy
      const existingDeputyForWarden = await client.query(
        `SELECT id, user_id FROM deputy_appointments
         WHERE supervisor_warden_appt_id = $1 AND appointment_status = 'ACTIVE'`,
        [params.supervisorWardenApptId]
      );
      if (existingDeputyForWarden.rows.length > 0) {
        throw new Error(
          `CARDINALITY_VIOLATION: Supervising Warden appointment '${params.supervisorWardenApptId}' already has an active Deputy ('${existingDeputyForWarden.rows[0].user_id}'). Max 1 Deputy per Warden.`
        );
      }

      // 6. Create deputy appointment
      const apptId = `appt_dep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await client.query(
        `INSERT INTO deputy_appointments (id, user_id, building_id, supervisor_warden_appt_id, appointed_by, appointment_status)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
        [apptId, params.userId, params.buildingId, params.supervisorWardenApptId, params.appointedBy]
      );

      // 7. Update user_roles to DEPUTY_WARDEN scoped to this building
      await client.query(
        `INSERT INTO user_roles (id, user_id, role_id, scope_type, scope_id)
         VALUES ($1, $2, 'role_deputy_warden', 'BUILDING', $3)
         ON CONFLICT (id) DO UPDATE
         SET role_id = 'role_deputy_warden', scope_type = 'BUILDING', scope_id = EXCLUDED.scope_id`,
        [`ur_${params.userId}`, params.userId, params.buildingId]
      );

      // 8. Record audit
      await this.recordAction(
        client,
        'APPOINT_DEPUTY',
        params.appointedBy,
        params.userId,
        params.buildingId,
        params.reason,
        'DEPUTY_APPOINTED',
        { appointment_id: apptId, supervisor_warden_appt_id: params.supervisorWardenApptId }
      );

      return apptId;
    });
  }

  /**
   * Revokes a Warden appointment and cascades revocation to any subordinate Deputy appointment.
   */
  async revokeWarden(params: RevokeAppointmentParams): Promise<void> {
    await this.db.transaction(async (client) => {
      // 1. Lock warden appointment
      const wrdRes = await client.query(
        `SELECT id, user_id, building_id, appointment_status FROM warden_appointments WHERE id = $1 FOR UPDATE`,
        [params.appointmentId]
      );
      if (wrdRes.rows.length === 0) {
        throw new Error(`APPOINTMENT_NOT_FOUND: Warden appointment '${params.appointmentId}' does not exist.`);
      }
      const warden = wrdRes.rows[0];
      if (warden.appointment_status !== 'ACTIVE') {
        throw new Error(`APPOINTMENT_ALREADY_INACTIVE: Warden appointment '${params.appointmentId}' is already ${warden.appointment_status}.`);
      }

      // 2. Revoke warden appointment
      await client.query(
        `UPDATE warden_appointments
         SET appointment_status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP, revocation_reason = $1
         WHERE id = $2`,
        [params.reason, params.appointmentId]
      );

      // 3. Remove/revoke user role
      await client.query(`DELETE FROM user_roles WHERE user_id = $1 AND role_id = 'role_warden'`, [warden.user_id]);

      // 4. Cascade revocation to active subordinate Deputy
      const depRes = await client.query(
        `SELECT id, user_id FROM deputy_appointments
         WHERE supervisor_warden_appt_id = $1 AND appointment_status = 'ACTIVE' FOR UPDATE`,
        [params.appointmentId]
      );

      for (const dep of depRes.rows) {
        await client.query(
          `UPDATE deputy_appointments
           SET appointment_status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP,
               revocation_reason = 'CASCADED_REVOCATION: Supervising Warden appointment was revoked'
           WHERE id = $1`,
          [dep.id]
        );
        await client.query(`DELETE FROM user_roles WHERE user_id = $1 AND role_id = 'role_deputy_warden'`, [dep.user_id]);

        await this.recordAction(
          client,
          'REVOKE_DEPUTY',
          params.revokedBy,
          dep.user_id,
          warden.building_id,
          'Cascaded revocation due to supervising Warden revocation',
          'DEPUTY_REVOKED_CASCADED',
          { appointment_id: dep.id, supervisor_warden_appt_id: params.appointmentId }
        );
      }

      // 5. Record Warden revocation action
      await this.recordAction(
        client,
        'REVOKE_WARDEN',
        params.revokedBy,
        warden.user_id,
        warden.building_id,
        params.reason,
        'WARDEN_REVOKED',
        { appointment_id: params.appointmentId, cascaded_deputies: depRes.rows.length }
      );
    });
  }

  /**
   * Revokes a Deputy Warden appointment.
   */
  async revokeDeputy(params: RevokeAppointmentParams): Promise<void> {
    await this.db.transaction(async (client) => {
      const depRes = await client.query(
        `SELECT id, user_id, building_id, appointment_status, supervisor_warden_appt_id
         FROM deputy_appointments WHERE id = $1 FOR UPDATE`,
        [params.appointmentId]
      );
      if (depRes.rows.length === 0) {
        throw new Error(`APPOINTMENT_NOT_FOUND: Deputy appointment '${params.appointmentId}' does not exist.`);
      }
      const dep = depRes.rows[0];
      if (dep.appointment_status !== 'ACTIVE') {
        throw new Error(`APPOINTMENT_ALREADY_INACTIVE: Deputy appointment '${params.appointmentId}' is already ${dep.appointment_status}.`);
      }

      await client.query(
        `UPDATE deputy_appointments
         SET appointment_status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP, revocation_reason = $1
         WHERE id = $2`,
        [params.reason, params.appointmentId]
      );

      await client.query(`DELETE FROM user_roles WHERE user_id = $1 AND role_id = 'role_deputy_warden'`, [dep.user_id]);

      await this.recordAction(
        client,
        'REVOKE_DEPUTY',
        params.revokedBy,
        dep.user_id,
        dep.building_id,
        params.reason,
        'DEPUTY_REVOKED',
        { appointment_id: params.appointmentId }
      );
    });
  }

  /**
   * Atomically transfers Chief Warden (SUPER_ADMIN) authority to a new user.
   */
  async transferChiefWarden(params: TransferSuperAdminParams): Promise<void> {
    await this.db.transaction(async (client) => {
      // 1. Lock singleton row
      const govRes = await client.query(`SELECT singleton_id, chief_warden_user_id FROM institutional_governance WHERE singleton_id = 1 FOR UPDATE`);
      if (govRes.rows.length === 0) {
        throw new Error(`GOVERNANCE_SINGLETON_MISSING: institutional_governance row not found.`);
      }
      const prevChiefId = govRes.rows[0].chief_warden_user_id;

      // 2. Lock candidate new Chief Warden
      const userRes = await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [params.newChiefWardenUserId]);
      if (userRes.rows.length === 0) {
        throw new Error(`CANDIDATE_NOT_FOUND: User '${params.newChiefWardenUserId}' does not exist.`);
      }

      // 3. Update singleton
      await client.query(
        `UPDATE institutional_governance
         SET chief_warden_user_id = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP, transition_reason = $3
         WHERE singleton_id = 1`,
        [params.newChiefWardenUserId, params.transferredBy, params.reason]
      );

      // 4. Update user_roles: demote previous chief to CHIEF_WARDEN, grant new chief SUPER_ADMIN
      await client.query(
        `UPDATE user_roles
         SET role_id = 'role_chief_warden', scope_type = 'SYSTEM', scope_id = NULL
         WHERE user_id = $1 AND role_id = 'role_super_admin'`,
        [prevChiefId]
      );

      await client.query(
        `INSERT INTO user_roles (id, user_id, role_id, scope_type, scope_id)
         VALUES ($1, $2, 'role_super_admin', 'SYSTEM', NULL)
         ON CONFLICT (id) DO UPDATE SET role_id = 'role_super_admin', scope_type = 'SYSTEM', scope_id = NULL`,
        [`ur_${params.newChiefWardenUserId}`, params.newChiefWardenUserId]
      );

      // 5. Record action
      await this.recordAction(
        client,
        'TRANSFER_SUPER_ADMIN',
        params.transferredBy,
        params.newChiefWardenUserId,
        null,
        params.reason,
        'SUPER_ADMIN_TRANSFERRED',
        { previous_chief_warden_id: prevChiefId, new_chief_warden_id: params.newChiefWardenUserId }
      );
    });
  }
}
