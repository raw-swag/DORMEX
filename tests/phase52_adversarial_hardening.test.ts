import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { getDatabaseService } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';

describe('Phase 52: Adversarial Integration, Authorization & Data Integrity Hardening Suite', () => {
  let app: any;
  let fastifyInstance: any;
  let db: any;

  let student1Token: string;
  let student2Token: string;
  let student3Token: string;
  let foreignWardenToken: string;
  let bvbWardenToken: string;
  let bvbDeputyToken: string;
  let foreignDeputyToken: string;
  let hostelOfficeToken: string;
  let chiefWardenToken: string;

  beforeAll(async () => {
    db = getDatabaseService(true);
    await runMigrations(db);
    await seedDatabase(db);
    fastifyInstance = await buildApp(db);
    await fastifyInstance.ready();
    app = fastifyInstance.server;

    // Tokens
    student1Token = fastifyInstance.jwt.sign({ sub: 'usr_demo_001' });
    student2Token = fastifyInstance.jwt.sign({ sub: 'usr_demo_002' });
    student3Token = fastifyInstance.jwt.sign({ sub: 'usr_demo_003' });
    hostelOfficeToken = fastifyInstance.jwt.sign({ sub: 'usr_office' });
    chiefWardenToken = fastifyInstance.jwt.sign({ sub: 'usr_admin' });

    // BVB Warden (Already seeded as usr_warden_bvb, ensure appointment is active)
    await db.query(
      `INSERT INTO warden_appointments (id, user_id, building_id, appointment_status, appointed_by)
       VALUES ('wa_bvb', 'usr_warden_bvb', 'bld_bvb', 'ACTIVE', 'usr_admin')
       ON CONFLICT (id) DO UPDATE SET building_id = 'bld_bvb', appointment_status = 'ACTIVE'`
    );
    bvbWardenToken = fastifyInstance.jwt.sign({ sub: 'usr_warden_bvb' });

    // Setup Foreign Warden (bld_aryabhata)
    await db.query(
      `INSERT INTO users (id, college_id, email, full_name, password_hash)
       VALUES ('usr_foreign_warden', 'WAR_FOREIGN', 'foreign.warden@college.edu', 'Foreign Warden', 'hash')
       ON CONFLICT (id) DO NOTHING`
    );
    const wRoleRes = await db.query(`SELECT id FROM roles WHERE name = 'WARDEN'`);
    const wRoleId = wRoleRes.rows[0].id;
    await db.query(
      `INSERT INTO user_roles (id, user_id, role_id, scope_type, scope_id)
       VALUES ('ur_foreign_warden', 'usr_foreign_warden', $1, 'BUILDING', 'bld_aryabhata')
       ON CONFLICT (id) DO UPDATE SET scope_id = 'bld_aryabhata'`,
      [wRoleId]
    );
    await db.query(
      `INSERT INTO warden_appointments (id, user_id, building_id, appointment_status, appointed_by)
       VALUES ('wa_foreign', 'usr_foreign_warden', 'bld_aryabhata', 'ACTIVE', 'usr_admin')
       ON CONFLICT (id) DO UPDATE SET building_id = 'bld_aryabhata', appointment_status = 'ACTIVE'`
    );
    foreignWardenToken = fastifyInstance.jwt.sign({ sub: 'usr_foreign_warden' });

    // Setup BVB Deputy
    const dRoleRes = await db.query(`SELECT id FROM roles WHERE name = 'DEPUTY_WARDEN'`);
    const dRoleId = dRoleRes.rows[0].id;
    await db.query(
      `INSERT INTO users (id, college_id, email, full_name, password_hash)
       VALUES ('usr_bvb_deputy', 'DEP_BVB', 'bvb.deputy@college.edu', 'BVB Deputy', 'hash')
       ON CONFLICT (id) DO NOTHING`
    );
    await db.query(
      `INSERT INTO user_roles (id, user_id, role_id, scope_type, scope_id)
       VALUES ('ur_bvb_deputy', 'usr_bvb_deputy', $1, 'BUILDING', 'bld_bvb')
       ON CONFLICT (id) DO UPDATE SET scope_id = 'bld_bvb'`,
      [dRoleId]
    );
    await db.query(
      `INSERT INTO deputy_appointments (id, user_id, building_id, appointment_status, supervisor_warden_appt_id, appointed_by)
       VALUES ('da_bvb', 'usr_bvb_deputy', 'bld_bvb', 'ACTIVE', 'wa_bvb', 'usr_admin')
       ON CONFLICT (id) DO UPDATE SET building_id = 'bld_bvb', appointment_status = 'ACTIVE'`
    );
    bvbDeputyToken = fastifyInstance.jwt.sign({ sub: 'usr_bvb_deputy' });

    // Setup Foreign Deputy
    await db.query(
      `INSERT INTO users (id, college_id, email, full_name, password_hash)
       VALUES ('usr_foreign_deputy', 'DEP_FOREIGN', 'foreign.deputy@college.edu', 'Foreign Deputy', 'hash')
       ON CONFLICT (id) DO NOTHING`
    );
    await db.query(
      `INSERT INTO user_roles (id, user_id, role_id, scope_type, scope_id)
       VALUES ('ur_foreign_deputy', 'usr_foreign_deputy', $1, 'BUILDING', 'bld_aryabhata')
       ON CONFLICT (id) DO UPDATE SET scope_id = 'bld_aryabhata'`,
      [dRoleId]
    );
    await db.query(
      `INSERT INTO deputy_appointments (id, user_id, building_id, appointment_status, supervisor_warden_appt_id, appointed_by)
       VALUES ('da_foreign', 'usr_foreign_deputy', 'bld_aryabhata', 'ACTIVE', 'wa_foreign', 'usr_admin')
       ON CONFLICT (id) DO UPDATE SET building_id = 'bld_aryabhata', appointment_status = 'ACTIVE'`
    );
    foreignDeputyToken = fastifyInstance.jwt.sign({ sub: 'usr_foreign_deputy' });
  }, 30000);

  describe('1. Cross-Building Governance & Authorization Scoping (Scenarios 4, 5, 6)', () => {
    it('revokes Warden appointment in database and immediately rejects privileged actions with stale active session (Scenario 4)', async () => {
      // First, revoke active appointment and role for bvb warden
      await db.query(`UPDATE warden_appointments SET appointment_status = 'REVOKED' WHERE user_id = 'usr_warden_bvb'`);
      await db.query(`DELETE FROM user_roles WHERE user_id = 'usr_warden_bvb' AND role_id IN ('role_warden', 'r_warden')`);

      // Attempt privileged action: update seat status using bvbWardenToken signed earlier
      const res = await request(app)
        .put('/api/seats/st_rm_bvb_212_A/status')
        .set('authorization', `Bearer ${bvbWardenToken}`)
        .send({ status: 'MAINTENANCE' });

      // Actor resolution rejects active role or downgrades to unappointed user
      expect([401, 403]).toContain(res.status);

      // Restore active status and role
      const wRoleRes = await db.query(`SELECT id FROM roles WHERE name = 'WARDEN'`);
      await db.query(
        `INSERT INTO user_roles (id, user_id, role_id, scope_type, scope_id)
         VALUES ('ur_bvb_warden', 'usr_warden_bvb', $1, 'BUILDING', 'bld_bvb')
         ON CONFLICT (id) DO UPDATE SET scope_id = 'bld_bvb'`,
        [wRoleRes.rows[0].id]
      );
      await db.query(`UPDATE warden_appointments SET appointment_status = 'ACTIVE' WHERE user_id = 'usr_warden_bvb'`);
    });

    it('rejects Deputy Warden attempting to review room change or complaint outside assigned building (Scenario 5)', async () => {
      // Create a room change request in BVB block
      await db.query(`DELETE FROM allocations WHERE cycle_id = 'cyc_bvb_pilot_2026' AND student_id = 'prof_demo_001'`);
      await db.query(
        `INSERT INTO allocations (id, cycle_id, student_id, seat_id, status)
         VALUES ('alloc_s1_bvb', 'cyc_bvb_pilot_2026', 'prof_demo_001', 'st_rm_bvb_212_A', 'CURRENT')`
      );

      const rcrRes = await request(app)
        .post('/api/room-change-requests')
        .set('authorization', `Bearer ${student1Token}`)
        .send({
          cycleId: 'cyc_bvb_pilot_2026',
          studentProfileId: 'prof_demo_001',
          targetRoomId: 'rm_bvb_214',
          reason: 'Need quiet room',
        });
      expect(rcrRes.status).toBe(201);
      const rcrId = rcrRes.body.requestId;

      // Foreign Deputy (bld_aryabhata) attempts to review BVB room change request
      const revRes = await request(app)
        .put(`/api/room-change-requests/${rcrId}/review`)
        .set('authorization', `Bearer ${foreignDeputyToken}`)
        .send({ decision: 'APPROVED', notes: 'Cross-building deputy unauthorized review' });

      expect(revRes.status).toBe(403);
      expect(revRes.body.error).toContain('FORBIDDEN');
    });

    it('rejects Hostel Office attempting building lifecycle activation reserved for Chief Warden / Super Admin (Scenario 6)', async () => {
      // Propose building as Hostel Office
      const propRes = await request(app)
        .post('/api/buildings')
        .set('authorization', `Bearer ${hostelOfficeToken}`)
        .send({
          code: 'BLOCK_ZETA',
          name: 'Zeta Postgraduate Block',
          gender_designation: 'COED',
          total_floors: 5,
        });
      expect(propRes.status).toBe(201);
      const buildingId = propRes.body.buildingId;

      // Hostel Office attempts to activate the building
      const actRes = await request(app)
        .put(`/api/buildings/${buildingId}/lifecycle`)
        .set('authorization', `Bearer ${hostelOfficeToken}`)
        .send({ lifecycle_status: 'ACTIVE', review_notes: 'Hostel office attempting activation' });

      expect(actRes.status).toBe(403);
      expect(actRes.body.error).toContain('FORBIDDEN');
    });
  });

  describe('2. Room-Change Integrity & Atomic Transfers (Scenarios 8, 9, 12)', () => {
    it('concurrent reviews cannot approve the same room change request twice (Scenario 8)', async () => {
      // Create request
      await db.query(`DELETE FROM allocations WHERE cycle_id = 'cyc_bvb_pilot_2026' AND student_id = 'prof_demo_001'`);
      await db.query(
        `INSERT INTO allocations (id, cycle_id, student_id, seat_id, status)
         VALUES ('alloc_s1_curr2', 'cyc_bvb_pilot_2026', 'prof_demo_001', 'st_rm_bvb_212_A', 'CURRENT')`
      );

      const rcrRes = await request(app)
        .post('/api/room-change-requests')
        .set('authorization', `Bearer ${student1Token}`)
        .send({
          cycleId: 'cyc_bvb_pilot_2026',
          studentProfileId: 'prof_demo_001',
          targetRoomId: 'rm_bvb_215',
          reason: 'Need ground floor proximity',
        });
      const rcrId = rcrRes.body.requestId;

      // Execute 2 concurrent review approvals
      const [rev1, rev2] = await Promise.all([
        request(app)
          .put(`/api/room-change-requests/${rcrId}/review`)
          .set('authorization', `Bearer ${chiefWardenToken}`)
          .send({ decision: 'APPROVED', notes: 'First reviewer approval' }),
        request(app)
          .put(`/api/room-change-requests/${rcrId}/review`)
          .set('authorization', `Bearer ${chiefWardenToken}`)
          .send({ decision: 'APPROVED', notes: 'Second concurrent reviewer approval' }),
      ]);

      const statuses = [rev1.status, rev2.status];
      expect(statuses).toContain(200);
      expect(statuses).toContain(409); // One must succeed, one must fail with 409 ALREADY_RESOLVED
    });

    it('a failed room transfer rolls back all mutations and does not leave student without allocation (Scenario 9)', async () => {
      // Put student in allocation
      await db.query(`DELETE FROM allocations WHERE cycle_id = 'cyc_bvb_pilot_2026' AND student_id = 'prof_demo_001'`);
      await db.query(
        `INSERT INTO allocations (id, cycle_id, student_id, seat_id, status)
         VALUES ('alloc_s1_orig', 'cyc_bvb_pilot_2026', 'prof_demo_001', 'st_rm_bvb_212_A', 'CURRENT')`
      );

      // Submit request to room with no available seats (or specify occupied target seat)
      const rcrRes = await request(app)
        .post('/api/room-change-requests')
        .set('authorization', `Bearer ${student1Token}`)
        .send({
          cycleId: 'cyc_bvb_pilot_2026',
          studentProfileId: 'prof_demo_001',
          targetRoomId: 'rm_bvb_215',
          reason: 'Transfer request',
        });
      const rcrId = rcrRes.body.requestId;

      // Occupy target seat
      await db.query(`DELETE FROM allocations WHERE seat_id = 'st_rm_bvb_215_A'`);
      await db.query(
        `INSERT INTO allocations (id, cycle_id, student_id, seat_id, status)
         VALUES ('alloc_blocker', 'cyc_bvb_pilot_2026', 'prof_demo_003', 'st_rm_bvb_215_A', 'CURRENT')`
      );

      // Attempt approval specifying occupied seat
      const failRes = await request(app)
        .put(`/api/room-change-requests/${rcrId}/review`)
        .set('authorization', `Bearer ${chiefWardenToken}`)
        .send({ decision: 'APPROVED', notes: 'Should fail due to occupied seat', targetSeatId: 'st_rm_bvb_215_A' });

      expect(failRes.status).toBe(409);
      expect(failRes.body.error).toContain('SEAT_UNAVAILABLE');

      // Verify original allocation remains intact and status is CURRENT
      const origAlloc = await db.query(`SELECT status FROM allocations WHERE id = 'alloc_s1_orig'`);
      expect(origAlloc.rows[0].status).toBe('CURRENT');
    });

    it('invalidates outstanding recommendations and invitations when a seat is claimed via transfer (Scenario 12)', async () => {
      // Seed a pending invite on target seat st_rm_bvb_216_A
      await db.query(`DELETE FROM invites WHERE seat_id = 'st_rm_bvb_216_A'`);
      await db.query(
        `INSERT INTO invites (id, cycle_id, from_student_id, to_student_id, seat_id, invite_code, status, expires_at)
         VALUES ('inv_trans_test', 'cyc_bvb_pilot_2026', 'prof_demo_002', 'prof_demo_003', 'st_rm_bvb_216_A', 'CODE216', 'PENDING', NOW() + INTERVAL '1 hour')`
      );

      // Submit and approve room transfer for student 1 into target seat
      await db.query(`DELETE FROM allocations WHERE cycle_id = 'cyc_bvb_pilot_2026' AND student_id = 'prof_demo_001'`);
      await db.query(
        `INSERT INTO allocations (id, cycle_id, student_id, seat_id, status)
         VALUES ('alloc_s1_pre_trans', 'cyc_bvb_pilot_2026', 'prof_demo_001', 'st_rm_bvb_212_A', 'CURRENT')`
      );

      const rcrRes = await request(app)
        .post('/api/room-change-requests')
        .set('authorization', `Bearer ${student1Token}`)
        .send({
          cycleId: 'cyc_bvb_pilot_2026',
          studentProfileId: 'prof_demo_001',
          targetRoomId: 'rm_bvb_216',
          reason: 'Moving to 216',
        });
      const rcrId = rcrRes.body.requestId;

      const appRes = await request(app)
        .put(`/api/room-change-requests/${rcrId}/review`)
        .set('authorization', `Bearer ${chiefWardenToken}`)
        .send({ decision: 'APPROVED', notes: 'Approved move to 216', targetSeatId: 'st_rm_bvb_216_A' });

      expect(appRes.status).toBe(200);

      // Verify invite status was invalidated
      const invCheck = await db.query(`SELECT status FROM invites WHERE id = 'inv_trans_test'`);
      expect(invCheck.rows[0].status).toBe('INVALIDATED');
    });
  });

  describe('3. Complaint Privacy & Roommate Verification (Scenario 10)', () => {
    it('rejects a student filing a private room complaint for a room they do not occupy (Scenario 10)', async () => {
      // Student 1 has allocation in rm_bvb_216, tries to file private complaint for rm_bvb_201
      const res = await request(app)
        .post('/api/complaints')
        .set('authorization', `Bearer ${student1Token}`)
        .send({
          type: 'PRIVATE',
          building_id: 'bld_bvb',
          room_id: 'rm_bvb_201',
          title: 'Unauthorized Private Complaint',
          description: 'Attempting to inspect or file private complaint for foreign room',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('FORBIDDEN');
    });

    it('forbids student from viewing another student private complaint or foreign allocation (Scenario 10)', async () => {
      // Foreign allocation lookup: Student 1 attempts to lookup Student 2
      const res = await request(app)
        .get('/api/students/prof_demo_002/allocation')
        .set('authorization', `Bearer ${student1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('FORBIDDEN');
    });
  });

  describe('4. Roommate Coordination Invariants (Scenario 11)', () => {
    it('accepting an invite does not reserve or book a seat (Scenario 11)', async () => {
      // Create invite from Student 1 for seat st_rm_bvb_214_B
      await db.query(`DELETE FROM invites WHERE seat_id = 'st_rm_bvb_214_B'`);
      await db.query(`DELETE FROM allocations WHERE seat_id = 'st_rm_bvb_214_B'`);
      await db.query(
        `INSERT INTO invites (id, cycle_id, from_student_id, to_student_id, seat_id, invite_code, status, expires_at)
         VALUES ('inv_coord_test', 'cyc_bvb_pilot_2026', 'prof_demo_001', 'prof_demo_002', 'st_rm_bvb_214_B', 'CODE214B', 'PENDING', NOW() + INTERVAL '1 hour')`
      );

      // Student 2 accepts invite
      const respRes = await request(app)
        .post('/api/invites/respond')
        .set('authorization', `Bearer ${student2Token}`)
        .send({
          inviteCode: 'CODE214B',
          toStudentId: 'prof_demo_002',
          accept: true,
        });

      expect(respRes.status).toBe(200);
      expect(respRes.body.status).toBe('ACCEPTED');

      // Crucial invariant: Seat MUST still be free (no allocation created)
      const seatCheck = await db.query(
        `SELECT a.id FROM seats s
         LEFT JOIN allocations a ON s.id = a.seat_id AND a.status = 'CURRENT'
         WHERE s.id = 'st_rm_bvb_214_B'`
      );
      expect(seatCheck.rows[0].id).toBeNull();
    });
  });

  describe('5. Inventory Resilience & Concurrency (Scenario 15)', () => {
    it('repeated idempotent room & floor provisioning requests do not duplicate seats (Scenario 15)', async () => {
      // First creation
      const r1 = await request(app)
        .post('/api/floors/flr_bvb_2/rooms')
        .set('authorization', `Bearer ${hostelOfficeToken}`)
        .send({ room_number: '299', capacity: 2, room_type: 'DOUBLE' });
      expect(r1.status).toBe(201);

      // Immediate repeated request with same parameters
      const r2 = await request(app)
        .post('/api/floors/flr_bvb_2/rooms')
        .set('authorization', `Bearer ${hostelOfficeToken}`)
        .send({ room_number: '299', capacity: 2, room_type: 'DOUBLE' });
      expect(r2.status).toBe(201);

      // Verify seat count is strictly equal to room capacity (2)
      const seatCount = await db.query(
        `SELECT COUNT(*) as count FROM seats WHERE room_id = 'rm_flr_bvb_2_299'`
      );
      expect(parseInt(seatCount.rows[0].count, 10)).toBe(2);
    });
  });
});
