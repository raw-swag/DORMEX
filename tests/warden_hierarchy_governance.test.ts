import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseService, getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { reconcileAndRunMigrations } from '../src/db/migrate.js';
import { seedDatabase } from '../src/db/seed.js';
import { GovernanceService } from '../src/auth/governanceService.js';

describe('DORMEX Phase 2: Stage 1 Institutional Governance Database Foundation Suite', () => {
  let db: DatabaseService;
  let govService: GovernanceService;

  beforeEach(async () => {
    resetDatabaseInstance();
    process.env.NODE_ENV = 'test';
    process.env.DORMEX_APP_ENV = 'test';
    db = getDatabaseService(true);
    govService = new GovernanceService(db);

    // Run migrations and seed clean data
    await runMigrations(db);
    await seedDatabase(db);
  });

  afterEach(async () => {
    await db.close();
    resetDatabaseInstance();
  });

  describe('1. Institutional Singleton & Migration Reconciliation', () => {
    it('initializes institutional_governance singleton with ADM001 as Chief Warden', async () => {
      const res = await reconcileAndRunMigrations(db, false);
      expect(res.applied).toContain('20261108_005_warden_hierarchy');

      const govRes = await db.query(`SELECT * FROM institutional_governance WHERE singleton_id = 1`);
      expect(govRes.rows.length).toBe(1);
      expect(govRes.rows[0].singleton_id).toBe(1);
      expect(govRes.rows[0].chief_warden_user_id).toBe('usr_admin');

      // Verify ADM001 holds SUPER_ADMIN
      const roleCheck = await db.query(`
        SELECT r.name FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = 'usr_admin'
      `);
      expect(roleCheck.rows[0]?.name).toBe('SUPER_ADMIN');

      // Verify usr_super_admin lost operational SUPER_ADMIN
      const saCheck = await db.query(`
        SELECT r.name FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = 'usr_super_admin' AND r.name = 'SUPER_ADMIN'
      `);
      expect(saCheck.rows.length).toBe(0);
    });

    it('rejects duplicate or invalid singleton_id in institutional_governance', async () => {
      await reconcileAndRunMigrations(db, false);

      // Attempt to insert another row with singleton_id = 2 -> CHECK constraint failure
      await expect(
        db.query(`
          INSERT INTO institutional_governance (singleton_id, chief_warden_user_id, updated_by, transition_reason)
          VALUES (2, 'usr_chief', 'usr_admin', 'illegal row')
        `)
      ).rejects.toThrow();

      // Attempt to insert duplicate singleton_id = 1 -> Primary Key violation
      await expect(
        db.query(`
          INSERT INTO institutional_governance (singleton_id, chief_warden_user_id, updated_by, transition_reason)
          VALUES (1, 'usr_chief', 'usr_admin', 'duplicate row')
        `)
      ).rejects.toThrow();
    });

    it('prevents deletion of current Chief Warden from users table (RESTRICT constraint)', async () => {
      await reconcileAndRunMigrations(db, false);

      await expect(
        db.query(`DELETE FROM users WHERE id = 'usr_admin'`)
      ).rejects.toThrow();
    });

    it('atomically transfers Chief Warden authority to a new user', async () => {
      await reconcileAndRunMigrations(db, false);

      await govService.transferChiefWarden({
        newChiefWardenUserId: 'usr_chief',
        transferredBy: 'usr_admin',
        reason: 'Scheduled leadership rotation',
      });

      const govRes = await db.query(`SELECT * FROM institutional_governance WHERE singleton_id = 1`);
      expect(govRes.rows[0].chief_warden_user_id).toBe('usr_chief');

      // Check usr_chief has SUPER_ADMIN
      const newChiefRole = await db.query(`
        SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = 'usr_chief'
      `);
      expect(newChiefRole.rows[0].name).toBe('SUPER_ADMIN');

      // Check prev chief (usr_admin) was demoted to CHIEF_WARDEN
      const prevChiefRole = await db.query(`
        SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = 'usr_admin'
      `);
      expect(prevChiefRole.rows[0].name).toBe('CHIEF_WARDEN');

      // Verify audit event was logged
      const actions = await db.query(`SELECT * FROM governance_actions WHERE action_type = 'TRANSFER_SUPER_ADMIN'`);
      expect(actions.rows.length).toBe(1);
      expect(actions.rows[0].target_user_id).toBe('usr_chief');
    });
  });

  describe('2. Building Lifecycle & Warden Appointments', () => {
    it('sets BVB Block lifecycle_status to ACTIVE in test environment and defaults new buildings to PROPOSED', async () => {
      await reconcileAndRunMigrations(db, false);

      const bvb = await db.query(`SELECT lifecycle_status FROM buildings WHERE code = 'BVB'`);
      expect(bvb.rows[0].lifecycle_status).toBe('ACTIVE');

      // Add a newly proposed building
      await db.query(`
        INSERT INTO buildings (id, code, name, gender_designation)
        VALUES ('bld_new', 'NEW_BLK', 'New Proposed Block', 'COED')
      `);

      const newBld = await db.query(`SELECT lifecycle_status FROM buildings WHERE id = 'bld_new'`);
      expect(newBld.rows[0].lifecycle_status).toBe('PROPOSED');
    });

    it('rejects Warden appointment to a PROPOSED building', async () => {
      await reconcileAndRunMigrations(db, false);

      await db.query(`
        INSERT INTO buildings (id, code, name, gender_designation, lifecycle_status)
        VALUES ('bld_prop', 'PROP', 'Proposed Block', 'COED', 'PROPOSED')
      `);

      await expect(
        govService.appointWarden({
          userId: 'usr_admin_3',
          buildingId: 'bld_prop',
          appointedBy: 'usr_admin',
          reason: 'Attempting invalid appointment to unapproved building',
        })
      ).rejects.toThrow('BUILDING_NOT_ELIGIBLE');
    });

    it('appoints Warden to ACTIVE building, enforces 1 Warden per building, and prevents duplicate active Warden appointments', async () => {
      await reconcileAndRunMigrations(db, false);

      // Appoint usr_warden_bvb to bld_bvb
      const apptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Official appointment for Fall 2026',
      });
      expect(apptId).toBeTruthy();

      // Check DB appointment record
      const appt = await db.query(`SELECT * FROM warden_appointments WHERE id = $1`, [apptId]);
      expect(appt.rows[0].appointment_status).toBe('ACTIVE');
      expect(appt.rows[0].building_id).toBe('bld_bvb');

      // Attempt to appoint second warden to same building -> rejects
      await expect(
        govService.appointWarden({
          userId: 'usr_admin_3',
          buildingId: 'bld_bvb',
          appointedBy: 'usr_admin',
          reason: 'Conflict attempt',
        })
      ).rejects.toThrow('BUILDING_OCCUPIED');

      // Attempt to appoint usr_warden_bvb to another building -> rejects
      await db.query(`
        INSERT INTO buildings (id, code, name, gender_designation, lifecycle_status)
        VALUES ('bld_second', 'SEC', 'Second Block', 'COED', 'ACTIVE')
      `);
      await expect(
        govService.appointWarden({
          userId: 'usr_warden_bvb',
          buildingId: 'bld_second',
          appointedBy: 'usr_admin',
          reason: 'Dual appointment attempt',
        })
      ).rejects.toThrow('ACTIVE_APPOINTMENT_CONFLICT');
    });
  });

  describe('3. Deputy Appointments, 1:1 Cardinality & Cascading Revocation', () => {
    it('appoints Deputy Warden reporting to active Warden in the same building', async () => {
      await reconcileAndRunMigrations(db, false);

      const wardenApptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Official appointment',
      });

      // Appoint usr_office as Deputy under usr_warden_bvb
      const depApptId = await govService.appointDeputy({
        userId: 'usr_office',
        buildingId: 'bld_bvb',
        supervisorWardenApptId: wardenApptId,
        appointedBy: 'usr_admin',
        reason: 'Official deputy appointment',
      });
      expect(depApptId).toBeTruthy();

      const depCheck = await db.query(`SELECT * FROM deputy_appointments WHERE id = $1`, [depApptId]);
      expect(depCheck.rows[0].appointment_status).toBe('ACTIVE');
      expect(depCheck.rows[0].supervisor_warden_appt_id).toBe(wardenApptId);
      expect(depCheck.rows[0].building_id).toBe('bld_bvb');

      // Verify user_role updated
      const roleCheck = await db.query(`
        SELECT r.name, ur.scope_type, ur.scope_id
        FROM user_roles ur JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = 'usr_office'
      `);
      expect(roleCheck.rows[0].name).toBe('DEPUTY_WARDEN');
      expect(roleCheck.rows[0].scope_type).toBe('BUILDING');
      expect(roleCheck.rows[0].scope_id).toBe('bld_bvb');
    });

    it('rejects Deputy appointment if building does not match supervisor building', async () => {
      await reconcileAndRunMigrations(db, false);

      const wardenApptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Official appointment',
      });

      await db.query(`
        INSERT INTO buildings (id, code, name, gender_designation, lifecycle_status)
        VALUES ('bld_other', 'OTH', 'Other Block', 'COED', 'ACTIVE')
      `);

      await expect(
        govService.appointDeputy({
          userId: 'usr_office',
          buildingId: 'bld_other', // Mismatched building
          supervisorWardenApptId: wardenApptId,
          appointedBy: 'usr_admin',
          reason: 'Mismatched building attempt',
        })
      ).rejects.toThrow('BUILDING_MISMATCH');
    });

    it('enforces exactly 1 Deputy per Warden (1:1 cardinality rejection)', async () => {
      await reconcileAndRunMigrations(db, false);

      const wardenApptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Official appointment',
      });

      await govService.appointDeputy({
        userId: 'usr_office',
        buildingId: 'bld_bvb',
        supervisorWardenApptId: wardenApptId,
        appointedBy: 'usr_admin',
        reason: 'First deputy appointment',
      });

      // Attempt to appoint second deputy under same warden -> rejects
      await expect(
        govService.appointDeputy({
          userId: 'usr_office_2',
          buildingId: 'bld_bvb',
          supervisorWardenApptId: wardenApptId,
          appointedBy: 'usr_admin',
          reason: 'Second deputy attempt',
        })
      ).rejects.toThrow('CARDINALITY_VIOLATION');
    });

    it('cascades revocation to active Deputy when supervising Warden is revoked', async () => {
      await reconcileAndRunMigrations(db, false);

      const wardenApptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Official appointment',
      });

      const depApptId = await govService.appointDeputy({
        userId: 'usr_office',
        buildingId: 'bld_bvb',
        supervisorWardenApptId: wardenApptId,
        appointedBy: 'usr_admin',
        reason: 'Official deputy appointment',
      });

      // Revoke warden appointment
      await govService.revokeWarden({
        appointmentId: wardenApptId,
        revokedBy: 'usr_admin',
        reason: 'End of academic tenure',
      });

      // Verify warden appointment is REVOKED
      const wrdAppt = await db.query(`SELECT appointment_status FROM warden_appointments WHERE id = $1`, [wardenApptId]);
      expect(wrdAppt.rows[0].appointment_status).toBe('REVOKED');

      // Verify deputy appointment is cascaded to REVOKED
      const depAppt = await db.query(`SELECT appointment_status, revocation_reason FROM deputy_appointments WHERE id = $1`, [depApptId]);
      expect(depAppt.rows[0].appointment_status).toBe('REVOKED');
      expect(depAppt.rows[0].revocation_reason).toContain('CASCADED_REVOCATION');

      // Verify deputy user_roles was cleaned up
      const depRoles = await db.query(`SELECT * FROM user_roles WHERE user_id = 'usr_office' AND role_id = 'role_deputy_warden'`);
      expect(depRoles.rows.length).toBe(0);
    });
  });

  describe('4. Cross-Role Exclusivity & Audit Ledger Immutability', () => {
    it('prevents an active Warden from being appointed as Deputy', async () => {
      await reconcileAndRunMigrations(db, false);

      const wardenApptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Official appointment',
      });

      // Attempt to appoint usr_warden_bvb as Deputy to themselves
      await expect(
        govService.appointDeputy({
          userId: 'usr_warden_bvb',
          buildingId: 'bld_bvb',
          supervisorWardenApptId: wardenApptId,
          appointedBy: 'usr_admin',
          reason: 'Illegal self-deputy attempt',
        })
      ).rejects.toThrow('CROSS_ROLE_CONFLICT');
    });

    it('prevents an active Deputy from being appointed as Warden without prior revocation', async () => {
      await reconcileAndRunMigrations(db, false);

      const wardenApptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Official appointment',
      });

      await govService.appointDeputy({
        userId: 'usr_office',
        buildingId: 'bld_bvb',
        supervisorWardenApptId: wardenApptId,
        appointedBy: 'usr_admin',
        reason: 'Official deputy appointment',
      });

      await db.query(`
        INSERT INTO buildings (id, code, name, gender_designation, lifecycle_status)
        VALUES ('bld_block2', 'B2', 'Block 2', 'COED', 'ACTIVE')
      `);

      // Attempt to appoint active deputy (usr_office) as Warden of Block 2
      await expect(
        govService.appointWarden({
          userId: 'usr_office',
          buildingId: 'bld_block2',
          appointedBy: 'usr_admin',
          reason: 'Cross-role appointment attempt',
        })
      ).rejects.toThrow('CROSS_ROLE_CONFLICT');
    });

    it('records immutable append-only governance actions and event details', async () => {
      await reconcileAndRunMigrations(db, false);

      const wardenApptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Audit log integrity verification',
      });

      const actions = await db.query(
        `SELECT ga.action_type, ga.actor_id, ga.target_user_id, gae.event_type, gae.details_json
         FROM governance_actions ga
         JOIN governance_action_events gae ON ga.id = gae.action_id
         WHERE ga.action_type = 'APPOINT_WARDEN'`
      );

      expect(actions.rows.length).toBeGreaterThan(0);
      const row = actions.rows[0];
      expect(row.actor_id).toBe('usr_admin');
      expect(row.target_user_id).toBe('usr_warden_bvb');
      expect(row.event_type).toBe('WARDEN_APPOINTED');
      expect(JSON.parse(row.details_json).appointment_id).toBe(wardenApptId);
    });
  });
});
