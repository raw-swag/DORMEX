import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { DatabaseService, getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { reconcileAndRunMigrations } from '../src/db/migrate.js';
import { seedDatabase } from '../src/db/seed.js';
import { buildApp } from '../src/app.js';
import { GovernanceService } from '../src/auth/governanceService.js';

describe('DORMEX Phase 2: Stage 2 Authorization & Governance Hierarchy Suite', () => {
  let db: DatabaseService;
  let fastifyApp: any;
  let app: any;
  let govService: GovernanceService;

  beforeEach(async () => {
    resetDatabaseInstance();
    process.env.NODE_ENV = 'test';
    process.env.DORMEX_APP_ENV = 'test';
    db = getDatabaseService(true);
    govService = new GovernanceService(db);

    await runMigrations(db);
    await seedDatabase(db);
    await reconcileAndRunMigrations(db, false);

    fastifyApp = await buildApp(db);
    await fastifyApp.ready();
    app = fastifyApp.server;
  });

  afterEach(async () => {
    if (fastifyApp) {
      await fastifyApp.close();
    }
    await db.close();
    resetDatabaseInstance();
  });

  describe('1. Authoritative Actor Resolution (Database-Backed Security)', () => {
    it('resolves live role, active appointment, and building scope directly from database', async () => {
      // Appoint usr_warden_bvb to bld_bvb
      const apptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Fall 2026 tenure',
      });

      // Login as Prof. Rao (WRD001)
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'WRD001', password: 'password' });
      expect(loginRes.status).toBe(200);
      const token = loginRes.body.token;
      expect(token).toBeTruthy();

      // Check /api/auth/me resolves database-authoritative appointment
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.role).toBe('WARDEN');
      expect(meRes.body.scopeId).toBe('bld_bvb');
    });

    it('rejects stale JWT token immediately if administrative appointment is revoked in database', async () => {
      // 1. Appoint Warden
      const apptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Fall 2026 tenure',
      });

      // 2. Issue JWT token
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'WRD001', password: 'password' });
      const token = loginRes.body.token;

      // Token is currently valid
      const meResBefore = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(meResBefore.status).toBe(200);

      // 3. Revoke Warden appointment in database
      await govService.revokeWarden({
        appointmentId: apptId,
        revokedBy: 'usr_admin',
        reason: 'Administrative revocation',
      });

      // 4. Stale token now fails closed because active appointment is gone from database
      const meResAfter = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      // Either 401 because user_roles was cleaned up or appointments was revoked
      expect([401, 403]).toContain(meResAfter.status);
    });
  });

  describe('2. Downward-Only Hierarchy & Operation Enforcement', () => {
    it('Chief Warden (SUPER_ADMIN) has complete oversight to appoint and revoke Wardens and Deputies', async () => {
      // Appoint Warden via HTTP API as Chief Warden (usr_admin)
      const appointWrdRes = await request(app)
        .post('/api/governance/wardens')
        .set('x-user-id', 'usr_admin')
        .send({
          user_id: 'usr_warden_bvb',
          building_id: 'bld_bvb',
          reason: 'Chief Warden official appointment',
        });
      expect(appointWrdRes.status).toBe(201);
      const wrdApptId = appointWrdRes.body.appointment_id;
      expect(wrdApptId).toBeTruthy();

      // Appoint Deputy via HTTP API as Chief Warden
      const appointDepRes = await request(app)
        .post('/api/governance/deputies')
        .set('x-user-id', 'usr_admin')
        .send({
          user_id: 'usr_office',
          building_id: 'bld_bvb',
          supervisor_warden_appt_id: wrdApptId,
          reason: 'Chief Warden official deputy appointment',
        });
      expect(appointDepRes.status).toBe(201);
      const depApptId = appointDepRes.body.appointment_id;
      expect(depApptId).toBeTruthy();

      // Non-admin (e.g. Student or Hostel Office) attempting to appoint Warden -> 403 Forbidden
      const illegalApptRes = await request(app)
        .post('/api/governance/wardens')
        .set('x-user-id', 'usr_office')
        .send({
          user_id: 'usr_admin_3',
          building_id: 'bld_bvb',
          reason: 'Illegal appointment attempt',
        });
      expect(illegalApptRes.status).toBe(403);
    });

    it('Supervising Warden can revoke subordinate Deputy in their own building, but Deputy cannot revoke Warden', async () => {
      // Setup appointments
      const wrdApptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Fall 2026 tenure',
      });

      const depApptId = await govService.appointDeputy({
        userId: 'usr_office',
        buildingId: 'bld_bvb',
        supervisorWardenApptId: wrdApptId,
        appointedBy: 'usr_admin',
        reason: 'Fall 2026 tenure',
      });

      // 1. Deputy attempts to revoke Warden -> 403 Forbidden
      const depRevokeWrdRes = await request(app)
        .post(`/api/governance/wardens/${wrdApptId}/revoke`)
        .set('x-user-id', 'usr_office')
        .send({ reason: 'Insubordinate attempt' });
      expect(depRevokeWrdRes.status).toBe(403);

      // 2. Supervising Warden revokes Deputy -> 200 OK
      const wrdRevokeDepRes = await request(app)
        .post(`/api/governance/deputies/${depApptId}/revoke`)
        .set('x-user-id', 'usr_warden_bvb')
        .send({ reason: 'Supervising Warden operational reassignment' });
      expect(wrdRevokeDepRes.status).toBe(200);
      expect(wrdRevokeDepRes.body.status).toBe('REVOKED');
    });
  });

  describe('3. Governance Action Workflows & Building Boundaries', () => {
    it('Deputy Warden submits action, Supervising Warden approves, and Chief Warden views with institution-wide scope', async () => {
      const wrdApptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Tenure',
      });

      await govService.appointDeputy({
        userId: 'usr_office',
        buildingId: 'bld_bvb',
        supervisorWardenApptId: wrdApptId,
        appointedBy: 'usr_admin',
        reason: 'Tenure',
      });

      // 1. Deputy submits action for bld_bvb
      const submitRes = await request(app)
        .post('/api/governance/actions')
        .set('x-user-id', 'usr_office')
        .send({
          action_type: 'FACILITY_MAINTENANCE_SCHEDULE',
          building_id: 'bld_bvb',
          reason: 'Emergency water pump inspection',
          details: { pump_id: 'WP_02', vendor: 'Apex Engineering' },
        });
      expect(submitRes.status).toBe(201);
      const actionId = submitRes.body.action_id;
      expect(actionId).toBeTruthy();

      // 2. Warden reviews and approves
      const reviewRes = await request(app)
        .post(`/api/governance/actions/${actionId}/review`)
        .set('x-user-id', 'usr_warden_bvb')
        .send({
          decision: 'APPROVED',
          review_notes: 'Approved for Saturday 10:00 AM',
        });
      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body.status).toBe('APPROVED');

      // 3. Chief Warden (SUPER_ADMIN) has institution-wide visibility
      const chiefListRes = await request(app)
        .get('/api/governance/actions')
        .set('x-user-id', 'usr_admin');
      expect(chiefListRes.status).toBe(200);
      const actionItem = chiefListRes.body.actions.find((a: any) => a.id === actionId);
      expect(actionItem).toBeDefined();
      expect(actionItem.status).toBe('APPROVED');
      expect(actionItem.reviewed_by).toBe('usr_warden_bvb');
    });

    it('rejects Deputy Warden attempting to submit action for a foreign building (Cross-Building Rejection)', async () => {
      const wrdApptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Tenure',
      });

      await govService.appointDeputy({
        userId: 'usr_office',
        buildingId: 'bld_bvb',
        supervisorWardenApptId: wrdApptId,
        appointedBy: 'usr_admin',
        reason: 'Tenure',
      });

      // Deputy belongs to bld_bvb -> attempts to submit for bld_foreign
      const submitRes = await request(app)
        .post('/api/governance/actions')
        .set('x-user-id', 'usr_office')
        .send({
          action_type: 'FACILITY_MAINTENANCE_SCHEDULE',
          building_id: 'bld_foreign',
          reason: 'Unauthorized cross-building action',
        });
      expect(submitRes.status).toBe(403);
      expect(submitRes.body.error).toContain('CROSS_BUILDING_CONFLICT');
    });

    it('rejects Deputy Warden or lower authority attempting to review or override a Warden action', async () => {
      const wrdApptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Tenure',
      });

      await govService.appointDeputy({
        userId: 'usr_office',
        buildingId: 'bld_bvb',
        supervisorWardenApptId: wrdApptId,
        appointedBy: 'usr_admin',
        reason: 'Tenure',
      });

      // Warden submits an action
      const submitRes = await request(app)
        .post('/api/governance/actions')
        .set('x-user-id', 'usr_warden_bvb')
        .send({
          action_type: 'SECURITY_GATE_POLICY',
          building_id: 'bld_bvb',
          reason: 'Curfew adjustment',
        });
      const actionId = submitRes.body.action_id;

      // Deputy attempts to review or override Warden action -> 401/403 Rejected
      const overrideRes = await request(app)
        .post(`/api/governance/actions/${actionId}/review`)
        .set('x-user-id', 'usr_office')
        .send({
          decision: 'REJECTED',
          review_notes: 'Subordinate illegal veto',
        });
      expect([401, 403]).toContain(overrideRes.status);
    });
  });
});
