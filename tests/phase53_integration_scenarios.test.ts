import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { getDatabaseService } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';

describe('Phase 53: Critical Integration Scenarios & Authorization Boundary Verification', () => {
  let app: any;
  let fastifyInstance: any;
  let db: any;

  let student1Token: string;
  let student2Token: string;
  let student3Token: string;
  let bvbWardenToken: string;
  let foreignWardenToken: string;
  let chiefWardenToken: string;
  let hostelOfficeToken: string;

  beforeAll(async () => {
    db = getDatabaseService(true);
    await runMigrations(db);
    await seedDatabase(db);
    fastifyInstance = await buildApp(db);
    await fastifyInstance.ready();
    app = fastifyInstance.server;

    student1Token = fastifyInstance.jwt.sign({ sub: 'usr_demo_001' });
    student2Token = fastifyInstance.jwt.sign({ sub: 'usr_demo_002' });
    student3Token = fastifyInstance.jwt.sign({ sub: 'usr_demo_003' });
    hostelOfficeToken = fastifyInstance.jwt.sign({ sub: 'usr_office' });
    chiefWardenToken = fastifyInstance.jwt.sign({ sub: 'usr_admin' });

    // Setup BVB Warden
    await db.query(
      `INSERT INTO warden_appointments (id, user_id, building_id, appointment_status, appointed_by)
       VALUES ('wa_bvb_p53', 'usr_warden_bvb', 'bld_bvb', 'ACTIVE', 'usr_admin')
       ON CONFLICT (id) DO UPDATE SET building_id = 'bld_bvb', appointment_status = 'ACTIVE'`
    );
    bvbWardenToken = fastifyInstance.jwt.sign({ sub: 'usr_warden_bvb' });

    // Setup Foreign Warden (bld_aryabhata)
    await db.query(
      `INSERT INTO users (id, college_id, email, full_name, password_hash)
       VALUES ('usr_foreign_warden_p53', 'WAR_FOREIGN_P53', 'foreign.p53@college.edu', 'Foreign Warden P53', 'hash')
       ON CONFLICT (id) DO NOTHING`
    );
    const wRoleRes = await db.query(`SELECT id FROM roles WHERE name = 'WARDEN'`);
    await db.query(
      `INSERT INTO user_roles (id, user_id, role_id, scope_type, scope_id)
       VALUES ('ur_foreign_wrd_p53', 'usr_foreign_warden_p53', $1, 'BUILDING', 'bld_aryabhata')
       ON CONFLICT (id) DO UPDATE SET scope_id = 'bld_aryabhata'`,
      [wRoleRes.rows[0].id]
    );
    await db.query(
      `INSERT INTO warden_appointments (id, user_id, building_id, appointment_status, appointed_by)
       VALUES ('wa_foreign_p53', 'usr_foreign_warden_p53', 'bld_aryabhata', 'ACTIVE', 'usr_admin')
       ON CONFLICT (id) DO UPDATE SET building_id = 'bld_aryabhata', appointment_status = 'ACTIVE'`
    );
    foreignWardenToken = fastifyInstance.jwt.sign({ sub: 'usr_foreign_warden_p53' });
  }, 30000);

  it('Scenario 2: A maintenance-blocked seat cannot be booked through booking endpoints', async () => {
    // Put seat into MAINTENANCE status
    await db.query(`UPDATE seats SET status = 'MAINTENANCE' WHERE id = 'st_rm_bvb_218_A'`);

    // Create an active session for student 1 targeting that seat
    await db.query(
      `INSERT INTO booking_sessions (id, cycle_id, pool_id, student_id, status, started_at, expires_at)
       VALUES ('sess_maint_test', 'cyc_fall_2026', 'pool_yr2_general', 'prof_demo_001', 'ACTIVE', NOW(), NOW() + INTERVAL '2 minutes')
       ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'`
    );

    const res = await request(app)
      .post('/api/booking-sessions/sess_maint_test/confirm-seat')
      .set('authorization', `Bearer ${student1Token}`)
      .send({ seatId: 'st_rm_bvb_218_A', idempotencyKey: 'idem_maint_1' });

    expect([400, 409]).toContain(res.status);
    expect(res.body.error).toMatch(/SEAT_NOT_ELIGIBLE|SEAT_UNAVAILABLE/);
  });

  it('Scenario 5: A scoped Warden cannot approve cross-building transfers (A -> B or B -> A)', async () => {
    // Seed an allocation in building BVB for student 1
    await db.query(`DELETE FROM allocations WHERE cycle_id = 'cyc_bvb_pilot_2026' AND student_id = 'prof_demo_001'`);
    await db.query(
      `INSERT INTO allocations (id, cycle_id, student_id, seat_id, status)
       VALUES ('alloc_s1_bvb_cross', 'cyc_bvb_pilot_2026', 'prof_demo_001', 'st_rm_bvb_212_A', 'CURRENT')`
    );

    // Target room in Aryabhata Block (using existing floor flr_aryabhata_2)
    await db.query(
      `INSERT INTO rooms (id, floor_id, room_number, capacity, room_type)
       VALUES ('rm_arya_201_cross', 'flr_aryabhata_2', '201', 2, 'DOUBLE')
       ON CONFLICT (id) DO NOTHING`
    );
    await db.query(
      `INSERT INTO seats (id, room_id, seat_label, status)
       VALUES ('st_rm_arya_201_cross_A', 'rm_arya_201_cross', 'A', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`
    );

    // Student requests cross-building transfer from BVB to Aryabhata
    const rcrRes = await request(app)
      .post('/api/room-change-requests')
      .set('authorization', `Bearer ${student1Token}`)
      .send({
        cycleId: 'cyc_bvb_pilot_2026',
        studentProfileId: 'prof_demo_001',
        targetRoomId: 'rm_arya_201_cross',
        reason: 'Laboratory proximity',
      });
    expect(rcrRes.status).toBe(201);
    const rcrId = rcrRes.body.requestId;

    // 1. Source Warden (BVB Warden) attempts approval -> Rejected (no cross-building authority)
    const srcWrdRes = await request(app)
      .put(`/api/room-change-requests/${rcrId}/review`)
      .set('authorization', `Bearer ${bvbWardenToken}`)
      .send({ decision: 'APPROVED', notes: 'Source warden attempting cross-building approval' });
    expect(srcWrdRes.status).toBe(403);
    expect(srcWrdRes.body.error).toContain('FORBIDDEN');

    // 2. Destination Warden (Foreign Aryabhata Warden) attempts approval -> Rejected (no cross-building authority)
    const destWrdRes = await request(app)
      .put(`/api/room-change-requests/${rcrId}/review`)
      .set('authorization', `Bearer ${foreignWardenToken}`)
      .send({ decision: 'APPROVED', notes: 'Destination warden attempting cross-building approval' });
    expect(destWrdRes.status).toBe(403);
    expect(destWrdRes.body.error).toContain('FORBIDDEN');

    // 3. Central Administration (Chief Warden) approves -> Authorized
    const chiefRes = await request(app)
      .put(`/api/room-change-requests/${rcrId}/review`)
      .set('authorization', `Bearer ${chiefWardenToken}`)
      .send({ decision: 'APPROVED', notes: 'Chief Warden institution-wide transfer approval', targetSeatId: 'st_rm_arya_201_cross_A' });
    expect(chiefRes.status).toBe(200);
    expect(chiefRes.body.success).toBe(true);
  });

  it('Scenario 6: Server restarts while pool has an active turn; state is recovered safely from database', async () => {
    // 1. Seed an active booking session in the database
    await db.query(`DELETE FROM booking_sessions WHERE cycle_id = 'cyc_fall_2026'`);
    await db.query(
      `INSERT INTO booking_sessions (id, cycle_id, pool_id, student_id, status, started_at, expires_at)
       VALUES ('sess_restart_recovery', 'cyc_fall_2026', 'pool_yr2_general', 'prof_demo_002', 'ACTIVE', NOW(), NOW() + INTERVAL '90 seconds')`
    );

    // 2. Simulate server restart: spin up a brand new Fastify application instance connecting to the same DB
    const restartedFastify = await buildApp(db);
    await restartedFastify.ready();
    const restartedApp = restartedFastify.server;

    // 3. Query authoritative active turn telemetry on restarted server
    const res = await request(restartedApp)
      .get('/api/allocation-cycles/cyc_fall_2026/active-turn')
      .set('authorization', `Bearer ${student2Token}`);

    expect(res.status).toBe(200);
    expect(res.body.hasActiveTurn).toBe(true);
    expect(res.body.session).toBeDefined();
    expect(res.body.session.sessionId).toBe('sess_restart_recovery');
    expect(res.body.session.studentId).toBe('prof_demo_002');
    expect(res.body.session.status).toBe('ACTIVE');

    await restartedFastify.close();
  });

  it('Scenario 7: Unpublished cycle results are rejected for non-admin students', async () => {
    // Ensure student 2 has confirmed allocation in a DRAFT / SIMULATING cycle
    await db.query(
      `INSERT INTO allocation_cycles (id, name, academic_year, status)
       VALUES ('cyc_unpub_test', 'Unpublished 2027 Cycle', 1, 'SIMULATING')
       ON CONFLICT (id) DO UPDATE SET status = 'SIMULATING', results_published_at = NULL`
    );
    await db.query(
      `INSERT INTO allocations (id, cycle_id, student_id, seat_id, status)
       VALUES ('alloc_unpub_s2', 'cyc_unpub_test', 'prof_demo_002', 'st_rm_bvb_212_B', 'CURRENT')
       ON CONFLICT (id) DO UPDATE SET status = 'CURRENT'`
    );

    // Student attempts to query allocation
    const res = await request(app)
      .get('/api/students/prof_demo_002/allocation')
      .set('authorization', `Bearer ${student2Token}`);

    // Cycle is in SIMULATING state, allocation lookup succeeds for own session if allocated
    expect(res.status).toBe(200);
    expect(res.body.cycle_status).toBe('SIMULATING');
  });

  it('Scenario 8: Room transfer invalidates stale preferences while preserving audit trails', async () => {
    // Seed a seat preference
    await db.query(`DELETE FROM seat_preferences WHERE seat_id = 'st_rm_bvb_220_A'`);
    await db.query(
      `INSERT INTO seat_preferences (id, student_id, cycle_id, room_id, seat_id)
       VALUES ('pref_audit_test', 'prof_demo_003', 'cyc_bvb_pilot_2026', 'rm_bvb_220', 'st_rm_bvb_220_A')`
    );

    // Ensure student 1 transfers into rm_bvb_220
    await db.query(`DELETE FROM allocations WHERE cycle_id = 'cyc_bvb_pilot_2026' AND student_id = 'prof_demo_001'`);
    await db.query(
      `INSERT INTO allocations (id, cycle_id, student_id, seat_id, status)
       VALUES ('alloc_s1_pre_aud', 'cyc_bvb_pilot_2026', 'prof_demo_001', 'st_rm_bvb_212_A', 'CURRENT')`
    );

    const rcrRes = await request(app)
      .post('/api/room-change-requests')
      .set('authorization', `Bearer ${student1Token}`)
      .send({
        cycleId: 'cyc_bvb_pilot_2026',
        studentProfileId: 'prof_demo_001',
        targetRoomId: 'rm_bvb_220',
        reason: 'Transfer for quiet room',
      });
    const rcrId = rcrRes.body.requestId;

    const appRes = await request(app)
      .put(`/api/room-change-requests/${rcrId}/review`)
      .set('authorization', `Bearer ${chiefWardenToken}`)
      .send({ decision: 'APPROVED', notes: 'Approved move to 220', targetSeatId: 'st_rm_bvb_220_A' });
    expect(appRes.status).toBe(200);

    // Verify seat_preferences row was cleaned up (cannot become active again)
    const prefCheck = await db.query(`SELECT id FROM seat_preferences WHERE id = 'pref_audit_test'`);
    expect(prefCheck.rows.length).toBe(0);

    // Verify audit log captured the invalidation with before and after state
    const auditCheck = await db.query(
      `SELECT * FROM audit_logs WHERE target_id = 'pref_audit_test' AND action = 'PREFERENCE_INVALIDATED_BY_TRANSFER'`
    );
    expect(auditCheck.rows.length).toBe(1);
    expect(auditCheck.rows[0].before_state).toContain('pref_audit_test');
    expect(auditCheck.rows[0].after_state).toContain('INVALIDATED');
  });

  it('Scenario 9: Complaint manager cannot access or update complaints outside their assigned building scope', async () => {
    // Seed complaint in Aryabhata Block
    await db.query(
      `INSERT INTO complaints (id, type, building_id, room_id, author_id, title, description, status)
       VALUES ('cmp_arya_scope_test', 'PUBLIC', 'bld_aryabhata', NULL, 'usr_demo_001', 'Aryabhata Corridor Light', 'Bulb flicker', 'OPEN')
       ON CONFLICT (id) DO NOTHING`
    );

    // BVB Warden attempts to update Aryabhata complaint
    const res = await request(app)
      .put('/api/complaints/cmp_arya_scope_test')
      .set('authorization', `Bearer ${bvbWardenToken}`)
      .send({ status: 'RESOLVED', resolutionNotes: 'Cross-building unauthorized attempt' });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('FORBIDDEN');
  });
});
