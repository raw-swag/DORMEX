import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';

describe('Real Institutional Student Journey, Concurrency & Invariant Enforcement Suite', () => {
  let app: any;
  let db: any;

  beforeAll(async () => {
    resetDatabaseInstance();
    db = getDatabaseService(true);
    await runMigrations(db);
    await seedDatabase(db);
    const fastifyApp = await buildApp(db);
    await fastifyApp.ready();
    app = fastifyApp.server;
  }, 30000);

  describe('1. Real Student Identity Lifecycle & Account Isolation', () => {
    it('registers student with real institutional USN and resolves identity through /api/auth/me', async () => {
      // 1. Register student
      const regRes = await request(app)
        .post('/api/institutional-students')
        .set('x-user-id', 'usr_admin')
        .send({
          usn: '1SI25CS088',
          full_name: 'Tanvi Hegde',
          email: 'tanvi.hegde@sit.edu',
          academic_year: 1,
          current_semester: 1,
          gender: 'FEMALE',
        });

      expect(regRes.status).toBe(201);
      expect(regRes.body.usn).toBe('1SI25CS088');

      // 2. Query /api/auth/me using authenticated student user id
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('x-user-id', 'usr_1si25cs088');

      expect(meRes.status).toBe(200);
      expect(meRes.body.collegeId).toBe('1SI25CS088');
      expect(meRes.body.studentUsn).toBe('1SI25CS088');
      expect(meRes.body.role).toBe('STUDENT');

      // 3. Student can view their own record
      const selfRes = await request(app)
        .get('/api/institutional-students/1SI25CS088')
        .set('x-user-id', 'usr_1si25cs088');
      expect(selfRes.status).toBe(200);
      expect(selfRes.body.email).toBe('tanvi.hegde@sit.edu');

      // 4. Student CANNOT view another student's record
      const foreignRes = await request(app)
        .get('/api/institutional-students/1SI25CS001')
        .set('x-user-id', 'usr_1si25cs088');
      expect(foreignRes.status).toBe(403);
      expect(foreignRes.body.error).toContain('FORBIDDEN');
    });

    it('records immutable audit log when administrative staff updates yearwise priority', async () => {
      // Assign priority #3 for 1SI25CS088 in bld_bvb
      const prioRes = await request(app)
        .put('/api/institutional-students/1SI25CS088/year-priority')
        .set('x-user-id', 'usr_admin')
        .send({
          academicYear: 1,
          assignedPriority: 3,
          buildingId: 'bld_bvb',
          semester: 1,
          overrideReason: 'Merit list rank 3 assignment',
        });

      expect(prioRes.status).toBe(200);

      // Verify audit_logs record exists
      const auditRes = await db.query(
        `SELECT * FROM audit_logs WHERE target_id = '1SI25CS088' AND action = 'PRIORITY_ASSIGNED'`
      );
      expect(auditRes.rows.length).toBeGreaterThan(0);
      expect(auditRes.rows[0].reason).toContain('Merit list rank 3 assignment');
    });
  });

  describe('2. Real Student Allocation Journey (Eligibility -> Queue -> Turn -> Confirm)', () => {
    let testCycleId = 'cyc_real_journey_test';
    let testPoolId = 'pool_real_journey_y1';
    let seatA1Id = 'st_rm_bvb_212_A';

    beforeAll(async () => {
      // Ensure building bld_bvb exists and is active
      await db.query(`UPDATE buildings SET is_active = TRUE WHERE id = 'bld_bvb'`);

      // Create test cycle in ACTIVE state
      await db.query(`
        INSERT INTO allocation_cycles (id, name, academic_year, status, turn_duration_seconds)
        VALUES ('${testCycleId}', 'Real Journey Test Cycle', 1, 'ACTIVE', 120)
        ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'
      `);

      // Create allocation pool for Year 1 GENERAL
      await db.query(`
        INSERT INTO allocation_pools (id, cycle_id, name, quota_category, academic_year, is_active)
        VALUES ('${testPoolId}', '${testCycleId}', 'Year 1 General Pool', 'GENERAL', 1, TRUE)
        ON CONFLICT (id) DO NOTHING
      `);

      // Connect existing seeded seat to pool inventory
      await db.query(`
        INSERT INTO pool_inventories (id, pool_id, seat_id)
        VALUES ('pi_real_1', '${testPoolId}', '${seatA1Id}')
        ON CONFLICT (id) DO NOTHING
      `);
    });

    it('executes full student journey: accept terms, join queue, receive turn, confirm seat', async () => {
      const studentProfileId = 'prof_1si25cs088';

      // 1. Mark eligibility as ELIGIBLE
      await db.query(`UPDATE student_profiles SET eligibility_status = 'ELIGIBLE' WHERE id = $1`, [studentProfileId]);
      await db.query(`UPDATE students SET eligibility_status = 'ELIGIBLE' WHERE usn = '1SI25CS088'`);

      // 2. Accept terms
      const pubTerms = await db.query(`SELECT id, version FROM terms_documents WHERE is_published = TRUE LIMIT 1`);
      const termDocId = pubTerms.rows[0]?.id || 'terms_v1';
      const termVer = pubTerms.rows[0]?.version || 1;
      await db.query(`
        INSERT INTO terms_acknowledgements (id, student_id, terms_document_id, terms_version)
        VALUES ('ack_1si25cs088', '${studentProfileId}', '${termDocId}', ${termVer})
        ON CONFLICT (student_id, terms_version) DO NOTHING
      `);

      // 3. Student joins waiting room
      const joinRes = await request(app)
        .post(`/api/allocation-cycles/${testCycleId}/join`)
        .set('x-user-id', 'usr_1si25cs088')
        .send({ studentProfileId });

      expect(joinRes.status).toBe(200);
      expect(joinRes.body.status).toBe('WAITING');
      expect(joinRes.body.priorityNumber).toBe(3); // Picked up yearwise priority #3!

      // 4. Advance pool turn to activate session
      const advanceRes = await request(app)
        .post(`/api/allocation-pools/${testPoolId}/advance`);

      expect(advanceRes.status).toBe(200);
      expect(advanceRes.body.session).not.toBeNull();
      const sessionId = advanceRes.body.session.sessionId;
      expect(advanceRes.body.session.studentId).toBe(studentProfileId);

      // 5. Student confirms seat
      const confirmRes = await request(app)
        .post(`/api/booking-sessions/${sessionId}/confirm-seat`)
        .set('x-user-id', 'usr_1si25cs088')
        .send({
          seatId: seatA1Id,
          idempotencyKey: 'idem_key_journey_1',
        });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.status).toBe('CURRENT');
      expect(confirmRes.body.seatId).toBe(seatA1Id);

      // Verify allocation in database
      const allocCheck = await db.query(`SELECT * FROM allocations WHERE cycle_id = $1 AND seat_id = $2 AND status = 'CURRENT'`, [testCycleId, seatA1Id]);
      expect(allocCheck.rows.length).toBe(1);
      expect(allocCheck.rows[0].student_id).toBe(studentProfileId);

      // 6. Idempotent re-submission returns existing confirmation
      const retryRes = await request(app)
        .post(`/api/booking-sessions/${sessionId}/confirm-seat`)
        .set('x-user-id', 'usr_1si25cs088')
        .send({
          seatId: seatA1Id,
          idempotencyKey: 'idem_key_journey_1',
        });

      expect(retryRes.status).toBe(200);
      expect(retryRes.body.status).toBe('CURRENT');
    });
  });

  describe('3. Conflict, Concurrency & Invariant Security Controls', () => {
    let testCycleId = 'cyc_conflict_suite';
    let testPoolId = 'pool_conflict_y1';
    let seatB1Id = 'st_rm_bvb_212_B';

    beforeAll(async () => {
      // Create second student
      await request(app)
        .post('/api/institutional-students')
        .set('x-user-id', 'usr_admin')
        .send({
          usn: '1SI25CS077',
          full_name: 'Varun Patel',
          email: 'varun.patel@sit.edu',
          academic_year: 1,
          current_semester: 1,
          gender: 'MALE',
        });

      // Create cycle and pool
      await db.query(`
        INSERT INTO allocation_cycles (id, name, academic_year, status, turn_duration_seconds)
        VALUES ('${testCycleId}', 'Conflict Test Cycle', 1, 'ACTIVE', 120)
        ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'
      `);

      await db.query(`
        INSERT INTO allocation_pools (id, cycle_id, name, quota_category, academic_year, is_active)
        VALUES ('${testPoolId}', '${testCycleId}', 'Conflict Pool Y1', 'GENERAL', 1, TRUE)
        ON CONFLICT (id) DO NOTHING
      `);

      await db.query(`
        INSERT INTO pool_inventories (id, pool_id, seat_id)
        VALUES ('pi_conflict_1', '${testPoolId}', '${seatB1Id}')
        ON CONFLICT (id) DO NOTHING
      `);

      // Set eligibility and terms
      await db.query(`UPDATE student_profiles SET eligibility_status = 'ELIGIBLE' WHERE id = 'prof_1si25cs077'`);
      const pubTerms = await db.query(`SELECT id, version FROM terms_documents WHERE is_published = TRUE LIMIT 1`);
      const termDocId = pubTerms.rows[0]?.id || 'terms_v1';
      const termVer = pubTerms.rows[0]?.version || 1;
      await db.query(`
        INSERT INTO terms_acknowledgements (id, student_id, terms_document_id, terms_version)
        VALUES ('ack_1si25cs077', 'prof_1si25cs077', '${termDocId}', ${termVer})
        ON CONFLICT (student_id, terms_version) DO NOTHING
      `);
    });

    it('rejects booking if student account is deactivated while turn is active', async () => {
      // 1. Student joins waiting room
      await request(app)
        .post(`/api/allocation-cycles/${testCycleId}/join`)
        .set('x-user-id', 'usr_1si25cs077')
        .send({ studentProfileId: 'prof_1si25cs077' });

      // 2. Advance pool turn
      const advanceRes = await request(app).post(`/api/allocation-pools/${testPoolId}/advance`);
      const sessionId = advanceRes.body.session.sessionId;

      // 3. Deactivate student account
      await db.query(`UPDATE students SET account_status = 'SUSPENDED' WHERE usn = '1SI25CS077'`);

      // 4. Student attempts to confirm seat
      const confirmRes = await request(app)
        .post(`/api/booking-sessions/${sessionId}/confirm-seat`)
        .set('x-user-id', 'usr_1si25cs077')
        .send({ seatId: seatB1Id });

      expect(confirmRes.status).toBe(400);
      expect(confirmRes.body.error).toContain('ACCOUNT_DEACTIVATED');

      // Restore account
      await db.query(`UPDATE students SET account_status = 'ACTIVE' WHERE usn = '1SI25CS077'`);
    });

    it('rejects booking if building becomes inactive or restricted before confirmation', async () => {
      // 1. Get active session for 1SI25CS077
      const advanceRes = await request(app).post(`/api/allocation-pools/${testPoolId}/advance`);
      const sessionId = advanceRes.body.session.sessionId;

      // 2. Deactivate building
      await db.query(`UPDATE buildings SET is_active = FALSE WHERE id = 'bld_bvb'`);

      // 3. Attempt confirmation
      const confirmRes = await request(app)
        .post(`/api/booking-sessions/${sessionId}/confirm-seat`)
        .set('x-user-id', 'usr_1si25cs077')
        .send({ seatId: seatB1Id });

      expect(confirmRes.status).toBe(400);
      expect(confirmRes.body.error).toContain('BUILDING_INACTIVE');

      // Restore building
      await db.query(`UPDATE buildings SET is_active = TRUE WHERE id = 'bld_bvb'`);
    });

    it('rejects booking if student becomes ineligible via building policy before confirmation', async () => {
      // 1. Add student-specific RESTRICTION policy for 1SI25CS077
      await request(app)
        .post('/api/buildings/bld_bvb/eligibility-policies')
        .set('x-user-id', 'usr_admin')
        .send({
          studentUsn: '1SI25CS077',
          policyType: 'RESTRICTION',
          reason: 'Disciplinary hold pending review',
        });

      // 2. Attempt confirmation
      const advanceRes = await request(app).post(`/api/allocation-pools/${testPoolId}/advance`);
      const sessionId = advanceRes.body.session.sessionId;

      const confirmRes = await request(app)
        .post(`/api/booking-sessions/${sessionId}/confirm-seat`)
        .set('x-user-id', 'usr_1si25cs077')
        .send({ seatId: seatB1Id });

      expect(confirmRes.status).toBe(400);
      expect(confirmRes.body.error).toContain('BUILDING_ELIGIBILITY_RESTRICTED');
      expect(confirmRes.body.error).toContain('Disciplinary hold pending review');

      // Clear the restriction
      await db.query(`DELETE FROM building_eligibility_policies WHERE student_usn = '1SI25CS077'`);
    });

    it('prevents double allocation and enforces relational unique constraint on concurrent claims', async () => {
      // Confirm seat for 1SI25CS077
      const advanceRes = await request(app).post(`/api/allocation-pools/${testPoolId}/advance`);
      const sessionId = advanceRes.body.session.sessionId;

      const confirmRes = await request(app)
        .post(`/api/booking-sessions/${sessionId}/confirm-seat`)
        .set('x-user-id', 'usr_1si25cs077')
        .send({ seatId: seatB1Id });

      expect(confirmRes.status).toBe(200);

      // Now create third student who attempts to claim the same seat
      await request(app)
        .post('/api/institutional-students')
        .set('x-user-id', 'usr_admin')
        .send({
          usn: '1SI25CS055',
          full_name: 'Rahul Joshi',
          email: 'rahul.joshi@sit.edu',
          academic_year: 1,
          current_semester: 1,
          gender: 'MALE',
        });

      await db.query(`UPDATE student_profiles SET eligibility_status = 'ELIGIBLE' WHERE id = 'prof_1si25cs055'`);
      const pubTerms = await db.query(`SELECT id, version FROM terms_documents WHERE is_published = TRUE LIMIT 1`);
      const termDocId = pubTerms.rows[0]?.id || 'terms_v1';
      const termVer = pubTerms.rows[0]?.version || 1;
      await db.query(`
        INSERT INTO terms_acknowledgements (id, student_id, terms_document_id, terms_version)
        VALUES ('ack_1si25cs055', 'prof_1si25cs055', '${termDocId}', ${termVer})
        ON CONFLICT (student_id, terms_version) DO NOTHING
      `);

      await request(app)
        .post(`/api/allocation-cycles/${testCycleId}/join`)
        .set('x-user-id', 'usr_1si25cs055')
        .send({ studentProfileId: 'prof_1si25cs055' });

      const adv3 = await request(app).post(`/api/allocation-pools/${testPoolId}/advance`);
      const sess3Id = adv3.body.session.sessionId;

      // Rahul attempts to reserve seatB1Id which is already claimed by Varun
      const conflictRes = await request(app)
        .post(`/api/booking-sessions/${sess3Id}/confirm-seat`)
        .set('x-user-id', 'usr_1si25cs055')
        .send({ seatId: seatB1Id });

      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.error).toContain('SEAT_UNAVAILABLE');
    });
  });
});
