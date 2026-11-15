import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';

describe('Phase 51: Complete Institutional Workflows & Cross-System Integration Suite', () => {
  let app: any;
  let fastifyInstance: any;
  let db: any;

  let officeToken: string;
  let chiefWardenToken: string;
  let student1Token: string;
  let student2Token: string;

  beforeAll(async () => {
    resetDatabaseInstance();
    db = getDatabaseService(true);
    await runMigrations(db);
    await seedDatabase(db);
    fastifyInstance = await buildApp(db);
    await fastifyInstance.ready();
    app = fastifyInstance.server;

    // Login accounts
    const offRes = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'OFF001', password: 'office123' });
    officeToken = offRes.body.token;

    const cwRes = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'ADM001', password: 'admin123' });
    chiefWardenToken = cwRes.body.token;

    const s1Res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'DEMO-001', password: 'password1' });
    student1Token = s1Res.body.token;

    const s2Res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'DEMO-002', password: 'password2' });
    student2Token = s2Res.body.token;
  }, 30000);

  describe('1. Building Lifecycle & Inventory Preparation (Hostel Office -> Chief Warden Approval)', () => {
    const bldCode = 'NEW_WING';
    let newBldId: string;
    let newFloorId: string;
    let newRoomId: string;

    it('allows Hostel Office to propose a new building (status = PROPOSED, is_active = false)', async () => {
      const res = await request(app)
        .post('/api/buildings')
        .set('authorization', `Bearer ${officeToken}`)
        .send({
          code: bldCode,
          name: 'New Academic Wing',
          gender_designation: 'COED',
          total_floors: 3,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.lifecycle_status).toBe('PROPOSED');
      expect(res.body.is_active).toBe(false);
      newBldId = res.body.buildingId;
    });

    it('forbids ordinary students from creating buildings', async () => {
      const res = await request(app)
        .post('/api/buildings')
        .set('authorization', `Bearer ${student1Token}`)
        .send({
          code: 'STUDENT_BLD',
          name: 'Student Block',
          gender_designation: 'MALE',
        });

      expect(res.status).toBe(403);
    });

    it('allows Hostel Office to add floors to proposed building', async () => {
      const res = await request(app)
        .post(`/api/buildings/${newBldId}/floors`)
        .set('authorization', `Bearer ${officeToken}`)
        .send({
          floor_number: 1,
          label: 'First Floor',
        });

      expect(res.status).toBe(201);
      expect(res.body.floor_number).toBe(1);
      newFloorId = res.body.floorId;
    });

    it('allows Hostel Office to create rooms and automatically synchronizes seat inventory', async () => {
      const res = await request(app)
        .post(`/api/floors/${newFloorId}/rooms`)
        .set('authorization', `Bearer ${officeToken}`)
        .send({
          room_number: '101',
          capacity: 2,
          room_type: 'DOUBLE',
        });

      expect(res.status).toBe(201);
      expect(res.body.room_number).toBe('101');
      expect(res.body.capacity).toBe(2);
      newRoomId = res.body.roomId;

      // Verify seats were created in database matching room capacity
      const seatsRes = await db.query(`SELECT * FROM seats WHERE room_id = $1`, [newRoomId]);
      expect(seatsRes.rows.length).toBe(2);
      expect(seatsRes.rows.map((s: any) => s.seat_label).sort()).toEqual(['A', 'B']);
    });

    it('allows Chief Warden to review and activate proposed building', async () => {
      const res = await request(app)
        .put(`/api/buildings/${newBldId}/lifecycle`)
        .set('authorization', `Bearer ${chiefWardenToken}`)
        .send({
          lifecycle_status: 'ACTIVE',
          review_notes: 'Approved after inspection',
        });

      expect(res.status).toBe(200);
      expect(res.body.lifecycle_status).toBe('ACTIVE');
      expect(res.body.is_active).toBe(true);

      // Verify building is now listed in active buildings
      const bldRes = await request(app).get('/api/buildings');
      expect(bldRes.body.some((b: any) => b.id === newBldId)).toBe(true);
    });

    it('forbids Hostel Office from approving/activating building lifecycle (Chief Warden only)', async () => {
      const res = await request(app)
        .put(`/api/buildings/${newBldId}/lifecycle`)
        .set('authorization', `Bearer ${officeToken}`)
        .send({
          lifecycle_status: 'INACTIVE',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('2. Room Change Review & Atomic Occupancy Transfer', () => {
    let rcrId: string;

    it('submits a room change request from an allocated student', async () => {
      // Ensure student 1 holds a confirmed allocation in room 212
      await db.query(`DELETE FROM allocations WHERE cycle_id = 'cyc_bvb_pilot_2026' AND student_id = 'prof_demo_001'`);
      await db.query(
        `INSERT INTO allocations (id, cycle_id, student_id, seat_id, status)
         VALUES ('alloc_s1_curr', 'cyc_bvb_pilot_2026', 'prof_demo_001', 'st_rm_bvb_212_A', 'CURRENT')`
      );

      const res = await request(app)
        .post('/api/room-change-requests')
        .set('authorization', `Bearer ${student1Token}`)
        .send({
          cycleId: 'cyc_bvb_pilot_2026',
          studentProfileId: 'prof_demo_001',
          targetRoomId: 'rm_bvb_214',
          reason: 'Need quiet room near study wing',
        });

      expect(res.status).toBe(201);
      expect(res.body.requestId).toBeDefined();
      rcrId = res.body.requestId;
    });

    it('allows authorized staff to review and approve room change with atomic seat transfer', async () => {
      const res = await request(app)
        .put(`/api/room-change-requests/${rcrId}/review`)
        .set('authorization', `Bearer ${chiefWardenToken}`)
        .send({
          decision: 'APPROVED',
          notes: 'Medical recommendation acknowledged',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify previous allocation was updated to TRANSFERRED
      const oldAlloc = await db.query(`SELECT status FROM allocations WHERE id = 'alloc_s1_curr'`);
      expect(oldAlloc.rows[0].status).toBe('TRANSFERRED');

      // Verify student holds exactly 1 CURRENT allocation in the new room
      const newAlloc = await db.query(
        `SELECT a.status, s.room_id 
         FROM allocations a 
         JOIN seats s ON a.seat_id = s.id 
         WHERE a.cycle_id = 'cyc_bvb_pilot_2026' AND a.student_id = 'prof_demo_001' AND a.status = 'CURRENT'`
      );
      expect(newAlloc.rows.length).toBe(1);
      expect(newAlloc.rows[0].room_id).toBe('rm_bvb_214');
    });
  });

  describe('3. Complaints, Privacy Scoping & Anonymous Peer Voting', () => {
    let complaintId: string;

    it('submits a public complaint and allows peer students to vote anonymously', async () => {
      const createRes = await request(app)
        .post('/api/complaints')
        .set('authorization', `Bearer ${student1Token}`)
        .send({
          type: 'PUBLIC',
          building_id: 'bld_bvb',
          title: 'Hot Water Supply Issue',
          description: 'Solar water heater on 2nd floor is not functional',
        });

      expect(createRes.status).toBe(201);
      complaintId = createRes.body.complaintId;

      // Student 2 votes on the complaint
      const voteRes = await request(app)
        .post(`/api/complaints/${complaintId}/vote`)
        .set('authorization', `Bearer ${student2Token}`);

      expect(voteRes.status).toBe(200);

      // Duplicate vote is prevented/idempotent
      const dupVoteRes = await request(app)
        .post(`/api/complaints/${complaintId}/vote`)
        .set('authorization', `Bearer ${student2Token}`);

      expect(dupVoteRes.status).toBe(200);

      // List complaints for Student 2: verifies vote count incremented without leaking voter identity
      const listRes = await request(app)
        .get('/api/complaints')
        .set('authorization', `Bearer ${student2Token}`);

      expect(listRes.status).toBe(200);
      const c = listRes.body.find((item: any) => item.id === complaintId);
      expect(c).toBeDefined();
      expect(Number(c.vote_count)).toBe(1);
      expect(c.author_id).toBeUndefined(); // Voter and author identities are sanitized
    });
  });
});
