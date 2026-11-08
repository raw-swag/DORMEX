import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { DatabaseService, getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { reconcileAndRunMigrations } from '../src/db/migrate.js';
import { seedDatabase } from '../src/db/seed.js';
import { buildApp } from '../src/app.js';
import { GovernanceService } from '../src/auth/governanceService.js';

describe('DORMEX Phase 2: Stage 3 Security Hardening & Integration Suite', () => {
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

  describe('1. Exhaustive Role-Based Authorization Bypass Testing', () => {
    it('rejects STUDENT identity attempting to access admin or governance endpoints', async () => {
      // 1. Student attempting to list governance actions -> 401 Unauthorized (can() view fails)
      const listRes = await request(app)
        .get('/api/governance/actions')
        .set('x-user-id', 'usr_student_1');
      expect([401, 403]).toContain(listRes.status);

      // 2. Student attempting to appoint Warden -> 403 Forbidden
      const apptRes = await request(app)
        .post('/api/governance/wardens')
        .set('x-user-id', 'usr_student_1')
        .send({
          user_id: 'usr_warden_bvb',
          building_id: 'bld_bvb',
          reason: 'Illegal student appointment',
        });
      expect(apptRes.status).toBe(403);

      // 3. Student attempting to submit governance action -> 401 Unauthorized
      const submitRes = await request(app)
        .post('/api/governance/actions')
        .set('x-user-id', 'usr_student_1')
        .send({
          action_type: 'FACILITY_OVERRIDE',
          building_id: 'bld_bvb',
          reason: 'Student bypass attempt',
        });
      expect([401, 403]).toContain(submitRes.status);
    });

    it('rejects HOSTEL_OFFICE identity attempting to appoint Wardens or review Warden actions', async () => {
      // 1. Hostel Office can view actions
      const viewRes = await request(app)
        .get('/api/governance/actions')
        .set('x-user-id', 'usr_office');
      expect(viewRes.status).toBe(200);

      // 2. Hostel Office attempting to appoint Warden -> 403 Forbidden
      const apptRes = await request(app)
        .post('/api/governance/wardens')
        .set('x-user-id', 'usr_office')
        .send({
          user_id: 'usr_admin_3',
          building_id: 'bld_bvb',
          reason: 'Hostel office privilege escalation attempt',
        });
      expect(apptRes.status).toBe(403);

      // 3. Hostel Office attempting to review governance action -> 401/403 Forbidden
      const reviewRes = await request(app)
        .post('/api/governance/actions/act_test_001/review')
        .set('x-user-id', 'usr_office')
        .send({
          decision: 'APPROVED',
          review_notes: 'Hostel office illegal approval',
        });
      expect([401, 403]).toContain(reviewRes.status);
    });

    it('rejects DEPUTY_WARDEN identity attempting to appoint or revoke Wardens or review actions', async () => {
      const wrdApptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Tenure',
      });

      const depApptId = await govService.appointDeputy({
        userId: 'usr_office',
        buildingId: 'bld_bvb',
        supervisorWardenApptId: wrdApptId,
        appointedBy: 'usr_admin',
        reason: 'Deputy tenure',
      });

      // 1. Deputy attempting to appoint Warden -> 403 Forbidden
      const apptRes = await request(app)
        .post('/api/governance/wardens')
        .set('x-user-id', 'usr_office')
        .send({
          user_id: 'usr_admin_3',
          building_id: 'bld_bvb',
          reason: 'Deputy appointing warden',
        });
      expect(apptRes.status).toBe(403);

      // 2. Deputy attempting to revoke supervising Warden -> 403 Forbidden
      const revokeRes = await request(app)
        .post(`/api/governance/wardens/${wrdApptId}/revoke`)
        .set('x-user-id', 'usr_office')
        .send({ reason: 'Deputy insubordination' });
      expect(revokeRes.status).toBe(403);

      // 3. Deputy attempting to review actions -> 401/403 Forbidden
      const reviewRes = await request(app)
        .post('/api/governance/actions/act_fake/review')
        .set('x-user-id', 'usr_office')
        .send({
          decision: 'APPROVED',
          review_notes: 'Deputy review attempt',
        });
      expect([401, 403]).toContain(reviewRes.status);
    });
  });

  describe('2. Workflow & Replay Integrity', () => {
    it('forbids re-reviewing or replaying already reviewed governance actions', async () => {
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
        reason: 'Deputy tenure',
      });

      // Deputy submits action
      const submitRes = await request(app)
        .post('/api/governance/actions')
        .set('x-user-id', 'usr_office')
        .send({
          action_type: 'STUDY_HALL_EXTENDED_HOURS',
          building_id: 'bld_bvb',
          reason: 'Exam week extended hours',
        });
      expect(submitRes.status).toBe(201);
      const actionId = submitRes.body.action_id;

      // First review succeeds
      const firstReview = await request(app)
        .post(`/api/governance/actions/${actionId}/review`)
        .set('x-user-id', 'usr_warden_bvb')
        .send({
          decision: 'APPROVED',
          review_notes: 'Approved through 2 AM',
        });
      expect(firstReview.status).toBe(200);

      // Second review attempt on same action must fail with 400 Bad Request
      const secondReview = await request(app)
        .post(`/api/governance/actions/${actionId}/review`)
        .set('x-user-id', 'usr_warden_bvb')
        .send({
          decision: 'REJECTED',
          review_notes: 'Conflicting second review',
        });
      expect(secondReview.status).toBe(400);
      expect(secondReview.body.error).toContain('ACTION_ALREADY_REVIEWED');
    });
  });

  describe('3. Audit Ledger Immutability & Event Tracing', () => {
    it('verifies every transition creates corresponding event records in governance_action_events', async () => {
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
        reason: 'Deputy tenure',
      });

      const submitRes = await request(app)
        .post('/api/governance/actions')
        .set('x-user-id', 'usr_office')
        .send({
          action_type: 'WATER_COOLER_REPAIR',
          building_id: 'bld_bvb',
          reason: 'Compressor check',
          details: { cooler_location: 'Floor 2 East' },
        });
      const actionId = submitRes.body.action_id;

      await request(app)
        .post(`/api/governance/actions/${actionId}/review`)
        .set('x-user-id', 'usr_warden_bvb')
        .send({
          decision: 'APPROVED',
          review_notes: 'Approved with priority vendor',
        });

      // Verify event history in database
      const events = await db.query(
        `SELECT event_type, details_json FROM governance_action_events
         WHERE action_id = $1 ORDER BY created_at ASC`,
        [actionId]
      );
      expect(events.rows.length).toBe(2);
      expect(events.rows[0].event_type).toBe('ACTION_SUBMITTED');
      expect(JSON.parse(events.rows[0].details_json).cooler_location).toBe('Floor 2 East');
      expect(events.rows[1].event_type).toBe('ACTION_APPROVED');
      expect(JSON.parse(events.rows[1].details_json).reviewer_id).toBe('usr_warden_bvb');
    });
  });

  describe('4. Regression Safety for Student & Device Management', () => {
    it('ensures existing student waiting room and device slot operations remain unaffected', async () => {
      // 1. Device slots probe still functions for SUPER_ADMIN
      const deviceRes = await request(app)
        .get('/api/admin/devices/slots')
        .set('x-user-id', 'usr_admin');
      expect(deviceRes.status).toBe(200);
      expect(Array.isArray(deviceRes.body.slots)).toBe(true);

      // 2. Student waiting room join works intact
      const joinRes = await request(app)
        .post('/api/allocation-cycles/cyc_fall_2026/join')
        .set('x-user-id', 'usr_student_1')
        .send({ studentProfileId: 'prof_stu_1' });
      expect(joinRes.status).toBe(200);
      expect(joinRes.body.status).toBe('WAITING');
    });
  });
});
