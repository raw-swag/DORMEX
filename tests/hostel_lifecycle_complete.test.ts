import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';
import { AllocationEngineService } from '../src/allocation/engine.js';
import { PreferencesService } from '../src/preferences/service.js';

describe('Hostel Lifecycle & Waiting Room Architecture Integration Suite', () => {
  let app: any;
  let fastifyInstance: any;
  let db: any;
  let engine: AllocationEngineService;
  let preferences: PreferencesService;

  beforeAll(async () => {
    resetDatabaseInstance();
    db = getDatabaseService(true);
    await runMigrations(db);
    await seedDatabase(db);
    fastifyInstance = await buildApp(db);
    await fastifyInstance.ready();
    app = fastifyInstance.server;
    engine = new AllocationEngineService(db);
    preferences = new PreferencesService(db);
  }, 30000);

  describe('1. Late Penalty Calculation Formula & Bounds', () => {
    it('applies 0 penalty turns within the 6-minute (360s) grace period', () => {
      const scheduled = new Date('2026-11-15T10:00:00Z');
      
      // Exactly on time (0s)
      expect(engine.calculateLatePenalty(scheduled, new Date('2026-11-15T10:00:00Z'))).toBe(0);
      
      // 3 minutes late (180s <= 360s)
      expect(engine.calculateLatePenalty(scheduled, new Date('2026-11-15T10:03:00Z'))).toBe(0);

      // Exactly at grace boundary (360s)
      expect(engine.calculateLatePenalty(scheduled, new Date('2026-11-15T10:06:00Z'))).toBe(0);
    });

    it('calculates 1 turn penalty for lateness just beyond grace period up to 1 turn duration (120s)', () => {
      const scheduled = new Date('2026-11-15T10:00:00Z');
      
      // 6 min 1 sec late (361s -> 1 turn)
      expect(engine.calculateLatePenalty(scheduled, new Date('2026-11-15T10:06:01Z'))).toBe(1);

      // 8 min late (480s -> 360s + 120s = 1 turn)
      expect(engine.calculateLatePenalty(scheduled, new Date('2026-11-15T10:08:00Z'))).toBe(1);
    });

    it('scales linearly up to maximum 10 penalty turns (20 minutes beyond grace = 26 minutes total)', () => {
      const scheduled = new Date('2026-11-15T10:00:00Z');
      
      // 10 minutes late (600s: 360 grace + 240 over grace = 2 turns)
      expect(engine.calculateLatePenalty(scheduled, new Date('2026-11-15T10:10:00Z'))).toBe(2);

      // 20 minutes late (1200s: 360 grace + 840 over grace = 7 turns)
      expect(engine.calculateLatePenalty(scheduled, new Date('2026-11-15T10:20:00Z'))).toBe(7);

      // 26 minutes late (1560s: 360 grace + 1200 over grace = 10 turns)
      expect(engine.calculateLatePenalty(scheduled, new Date('2026-11-15T10:26:00Z'))).toBe(10);
    });

    it('strictly caps penalty at 10 turns for extreme lateness (> 26 minutes / hours later)', () => {
      const scheduled = new Date('2026-11-15T10:00:00Z');

      // 45 minutes late
      expect(engine.calculateLatePenalty(scheduled, new Date('2026-11-15T10:45:00Z'))).toBe(10);

      // 2 hours late
      expect(engine.calculateLatePenalty(scheduled, new Date('2026-11-15T12:00:00Z'))).toBe(10);
    });
  });

  describe('2. Waiting Room Participant Threshold Gate', () => {
    const cycleId = 'cyc_threshold_test';
    const poolId = 'pool_threshold_test';

    beforeAll(async () => {
      // Create isolated test cycle with waiting_room_threshold = 3
      await db.query(
        `INSERT INTO allocation_cycles (id, name, academic_year, status, turn_duration_seconds, waiting_room_threshold)
         VALUES ($1, 'Threshold Test Cycle', 2, 'ACTIVE', 120, 3)
         ON CONFLICT (id) DO UPDATE SET waiting_room_threshold = 3, status = 'ACTIVE'`,
        [cycleId]
      );

      // Create isolated pool
      await db.query(
        `INSERT INTO allocation_pools (id, cycle_id, name, quota_category, academic_year, is_active)
         VALUES ($1, $2, 'Pool Threshold Test', 'GENERAL', 2, TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [poolId, cycleId]
      );
    });

    it('holds queue when participant count is below configured threshold (threshold = 3, count = 1)', async () => {
      // Clean up previous entries for this cycle
      await db.query('DELETE FROM booking_sessions WHERE cycle_id = $1', [cycleId]);
      await db.query('DELETE FROM waiting_room_entries WHERE cycle_id = $1', [cycleId]);

      // Seed student 1 into waiting room
      await db.query(
        `INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
         VALUES ('wre_t1', $1, $2, 'prof_demo_001', 1, 'WAITING')`,
        [cycleId, poolId]
      );

      // Advance turn: should return null because count (1) < threshold (3)
      const session = await engine.advancePoolTurn(poolId);
      expect(session).toBeNull();
    });

    it('holds queue when participant count is still below threshold (count = 2 < 3)', async () => {
      // Seed student 2 into waiting room
      await db.query(
        `INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
         VALUES ('wre_t2', $1, $2, 'prof_demo_002', 2, 'WAITING')`,
        [cycleId, poolId]
      );

      // Advance turn: still null
      const session = await engine.advancePoolTurn(poolId);
      expect(session).toBeNull();
    });

    it('triggers and schedules the first active turn once threshold is satisfied (count = 3 >= 3)', async () => {
      // Seed student 3 into waiting room
      await db.query(
        `INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
         VALUES ('wre_t3', $1, $2, 'prof_demo_003', 3, 'WAITING')`,
        [cycleId, poolId]
      );

      // Advance turn: now satisfied! Returns active booking session for highest priority student
      const session = await engine.advancePoolTurn(poolId);
      expect(session).not.toBeNull();
      expect(session?.studentId).toBe('prof_demo_001');
      expect(session?.status).toBe('ACTIVE');
      expect(session?.remainingSeconds).toBeGreaterThan(0);
    });
  });

  describe('3. Single-Hop Roommate Recommendation Invites & Response API', () => {
    let student1Token: string;
    let student2Token: string;
    let inviteCode: string;

    beforeAll(async () => {
      // Log in student 1 (DEMO-001)
      const res1 = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'DEMO-001', password: 'password1' });
      student1Token = res1.body.token;

      // Log in student 2 (DEMO-002)
      const res2 = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'DEMO-002', password: 'password2' });
      student2Token = res2.body.token;
    });

    it('creates a recommendation invite via POST /api/invites', async () => {
      const createRes = await request(app)
        .post('/api/invites')
        .set('authorization', `Bearer ${student1Token}`)
        .send({
          cycleId: 'cyc_bvb_pilot_2026',
          seatId: 'st_rm_bvb_212_B',
          fromStudentId: 'prof_demo_001',
        });

      expect(createRes.status).toBe(201);
      const data = createRes.body;
      expect(data.inviteCode).toMatch(/^INV-[A-Z0-9]+$/);
      expect(data.expiresAt).toBeDefined();
      inviteCode = data.inviteCode;
    });

    it('rejects invite response with missing mandatory fields via POST /api/invites/respond', async () => {
      const res = await request(app)
        .post('/api/invites/respond')
        .set('authorization', `Bearer ${student2Token}`)
        .send({
          inviteCode: '',
          toStudentId: 'prof_demo_002',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('MANDATORY_FIELDS');
    });

    it('rejects invite response when attempting to respond on behalf of a different student', async () => {
      const res = await request(app)
        .post('/api/invites/respond')
        .set('authorization', `Bearer ${student2Token}`)
        .send({
          inviteCode,
          toStudentId: 'prof_demo_003', // student 2 attempting to accept for student 3
          accept: true,
        });

      expect(res.status).toBe(403);
    });

    it('successfully accepts invitation via POST /api/invites/respond', async () => {
      const res = await request(app)
        .post('/api/invites/respond')
        .set('authorization', `Bearer ${student2Token}`)
        .send({
          inviteCode,
          toStudentId: 'prof_demo_002',
          accept: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACCEPTED');
    });

    it('rejects invite response if invite has already been responded to (non-pending)', async () => {
      const res = await request(app)
        .post('/api/invites/respond')
        .set('authorization', `Bearer ${student2Token}`)
        .send({
          inviteCode,
          toStudentId: 'prof_demo_002',
          accept: false, // Trying to reject an already accepted invite
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('INVITE_UNAVAILABLE');
    });

    it('is idempotent when re-submitting the same decision on an invite', async () => {
      const res = await request(app)
        .post('/api/invites/respond')
        .set('authorization', `Bearer ${student2Token}`)
        .send({
          inviteCode,
          toStudentId: 'prof_demo_002',
          accept: true, // Same decision (ACCEPTED)
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACCEPTED');
    });
  });

  describe('4. Student Dedicated Allocation Lookup & Privacy Controls', () => {
    let student1Token: string;
    let student2Token: string;
    let adminToken: string;

    beforeAll(async () => {
      // Login tokens
      const res1 = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'DEMO-001', password: 'password1' });
      student1Token = res1.body.token;

      const res2 = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'DEMO-002', password: 'password2' });
      student2Token = res2.body.token;

      const adminRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'ADM001', password: 'admin123' });
      adminToken = adminRes.body.token;

      // Ensure student 1 has a current confirmed allocation
      await db.query(`DELETE FROM allocations WHERE cycle_id = 'cyc_bvb_pilot_2026' AND student_id = 'prof_demo_001'`);
      await db.query(
        `INSERT INTO allocations (id, cycle_id, student_id, seat_id, status)
         VALUES ('alloc_lookup_test_1', 'cyc_bvb_pilot_2026', 'prof_demo_001', 'st_rm_bvb_212_A', 'CURRENT')`
      );
    });

    it('allows a student to look up their own confirmed allocation via GET /api/students/:id/allocation', async () => {
      const res = await request(app)
        .get('/api/students/prof_demo_001/allocation')
        .set('authorization', `Bearer ${student1Token}`);

      expect(res.status).toBe(200);
      const alloc = res.body;
      expect(alloc.allocation_status).toBe('CURRENT');
      expect(alloc.seat_id).toBe('st_rm_bvb_212_A');
      expect(alloc.seat_label).toBe('A');
      expect(alloc.room_number).toBe('212');
      expect(alloc.building_name).toBe('BVB Block');
      expect(alloc.cycle_id).toBe('cyc_bvb_pilot_2026');
    });

    it('forbids a student from looking up another student allocation details (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .get('/api/students/prof_demo_001/allocation')
        .set('authorization', `Bearer ${student2Token}`); // Student 2 trying to inspect Student 1

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('FORBIDDEN');
    });

    it('allows administrative staff (SUPER_ADMIN / CHIEF_WARDEN) to inspect student allocation details', async () => {
      const res = await request(app)
        .get('/api/students/prof_demo_001/allocation')
        .set('authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const alloc = res.body;
      expect(alloc.allocation_status).toBe('CURRENT');
      expect(alloc.allocation_id).toBeDefined();
    });

    it('rejects cross-building allocation lookup for a Warden assigned to another building', async () => {
      // Create a warden user and appointment assigned specifically to a foreign building (e.g. bld_aryabhata)
      const foreignWardenRes = fastifyInstance.jwt.sign({ sub: 'usr_foreign_warden' });
      // Insert warden user and role
      await db.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash)
         VALUES ('usr_foreign_warden', 'WAR_FOREIGN', 'warden.foreign@college.edu', 'Foreign Warden', 'hash')
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

      // Foreign warden tries to inspect BVB allocation (prof_demo_001 is in BVB Block)
      const res = await request(app)
        .get('/api/students/prof_demo_001/allocation')
        .set('authorization', `Bearer ${foreignWardenRes}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('FORBIDDEN');
    });

    it('returns 404 when student has no confirmed allocation', async () => {
      // Remove any allocation for student 3 if present
      await db.query(`DELETE FROM allocations WHERE student_id = 'prof_demo_003'`);

      const res = await request(app)
        .get('/api/students/prof_demo_003/allocation')
        .set('authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('NOT_FOUND');
    });
  });
});
