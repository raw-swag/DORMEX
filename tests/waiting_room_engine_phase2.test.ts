import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { AllocationEngineService } from '../src/allocation/engine.js';
import { AuthActor } from '../src/auth/policy.js';

describe('DORMEX Phase 2: Waiting Room Engine Redesign (15 Standard + 5 Reserved Model)', () => {
  let db: any;
  let engine: AllocationEngineService;

  const mockAdminActor: AuthActor = {
    id: 'usr_admin',
    college_id: 'ADM001',
    role: 'SUPER_ADMIN',
    scope_type: 'SYSTEM',
    scope_id: null,
    mfa_level: 'TOTP',
  };

  beforeEach(async () => {
    resetDatabaseInstance();
    db = getDatabaseService(true);
    await runMigrations(db);
    engine = new AllocationEngineService(db);
  });

  afterEach(async () => {
    await db.close();
    resetDatabaseInstance();
  });

  describe('1. Dual-Bucket Capacity Architecture & Headroom Enforcement', () => {
    it('initializes allocation cycle with exact 20 max, 15 standard, and 5 reserved capacity', async () => {
      await db.query(`
        INSERT INTO allocation_cycles (id, name, academic_year, status)
        VALUES ('cyc_phase2_defaults', 'Phase 2 Test Cycle', 1, 'ACTIVE')
      `);

      const res = await db.query(`
        SELECT max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity
        FROM allocation_cycles WHERE id = 'cyc_phase2_defaults'
      `);

      expect(Number(res.rows[0].max_admitted_capacity)).toBe(20);
      expect(Number(res.rows[0].standard_admission_capacity)).toBe(15);
      expect(Number(res.rows[0].reserved_priority_capacity)).toBe(5);
    });

    it('blocks turn advancement when total admitted participants reach the 20-candidate capacity limit', async () => {
      const cycleId = 'cyc_cap_limit_test';
      const poolId = 'pool_cap_limit_1';

      // 1. Setup cycle and pool with max 20 capacity
      await db.query(`
        INSERT INTO allocation_cycles (id, name, academic_year, status, max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity, waiting_room_threshold)
        VALUES ('${cycleId}', 'Cap Limit Cycle', 1, 'ACTIVE', 20, 15, 5, 0)
      `);
      await db.query(`
        INSERT INTO allocation_pools (id, cycle_id, name, quota_category, academic_year)
        VALUES ('${poolId}', '${cycleId}', 'Test Pool', 'GENERAL', 1)
      `);

      // 2. Insert 20 already ADMITTED participants across the cycle (reaching capacity cap)
      for (let i = 1; i <= 20; i++) {
        const uId = `usr_admitted_${i}`;
        const spId = `sp_admitted_${i}`;
        await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES ('${uId}', 'COL_${i}', 'u${i}@test.com', 'User ${i}', 'hash')`);
        await db.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category, eligibility_status) VALUES ('${spId}', '${uId}', 'COL_${i}', 'User ${i}', 1, 'CS', 'MALE', 'GENERAL', 'ELIGIBLE')`);
        await db.query(`INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status) VALUES ('wre_adm_${i}', '${cycleId}', '${poolId}', '${spId}', ${i}, 'ADMITTED')`);
      }

      // 3. Insert candidate #21 who is WAITING
      const u21 = 'usr_waiting_21';
      const sp21 = 'sp_waiting_21';
      await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES ('${u21}', 'COL_21', 'u21@test.com', 'User 21', 'hash')`);
      await db.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category, eligibility_status) VALUES ('${sp21}', '${u21}', 'COL_21', 'User 21', 1, 'CS', 'MALE', 'GENERAL', 'ELIGIBLE')`);
      await db.query(`INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status) VALUES ('wre_wait_21', '${cycleId}', '${poolId}', '${sp21}', 21, 'WAITING')`);

      // 4. Attempt to advance pool turn -> must return null because 20 capacity limit is full
      const turnResult = await engine.advancePoolTurn(poolId);
      expect(turnResult).toBeNull();
    });
  });

  describe('2. Rolling Auto-Refill Engine & Capacity Recovery', () => {
    it('atomically admits next waiting candidate when an active participant confirms a seat', async () => {
      const cycleId = 'cyc_rolling_test';
      const poolId = 'pool_rolling_1';
      const bldId = 'bld_roll_1';
      const flrId = 'flr_roll_1';
      const rmId = 'rm_roll_101';
      const seatId = 'st_roll_101_A';

      // Setup building, floor, room, seat
      await db.query(`INSERT INTO buildings (id, code, name, gender_designation, total_floors, is_active) VALUES ('${bldId}', 'RL', 'Rolling Bldg', 'COED', 1, true)`);
      await db.query(`INSERT INTO floors (id, building_id, floor_number, label) VALUES ('${flrId}', '${bldId}', 1, 'Floor 1')`);
      await db.query(`INSERT INTO rooms (id, floor_id, room_number, capacity) VALUES ('${rmId}', '${flrId}', '101', 1)`);
      await db.query(`INSERT INTO seats (id, room_id, seat_label, status) VALUES ('${seatId}', '${rmId}', 'A', 'ACTIVE')`);

      // Setup cycle with max 20, standard 15, reserved 5
      await db.query(`
        INSERT INTO allocation_cycles (id, name, academic_year, status, max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity, waiting_room_threshold)
        VALUES ('${cycleId}', 'Rolling Cycle', 1, 'ACTIVE', 20, 15, 5, 0)
      `);
      await db.query(`
        INSERT INTO allocation_pools (id, cycle_id, name, quota_category, academic_year)
        VALUES ('${poolId}', '${cycleId}', 'Rolling Pool', 'GENERAL', 1)
      `);
      await db.query(`
        INSERT INTO pool_inventories (id, pool_id, seat_id) VALUES ('pi_1', '${poolId}', '${seatId}')
      `);

      // Active candidate #1
      const u1 = 'usr_active_1';
      const sp1 = 'sp_active_1';
      await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES ('${u1}', 'COL_1', 'u1@test.com', 'Active 1', 'hash')`);
      await db.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category, eligibility_status) VALUES ('${sp1}', '${u1}', 'COL_1', 'Active 1', 1, 'CS', 'MALE', 'GENERAL', 'ELIGIBLE')`);
      await db.query(`INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status) VALUES ('wre_act_1', '${cycleId}', '${poolId}', '${sp1}', 1, 'ACTIVE_TURN')`);

      const sessId = 'sess_roll_1';
      const now = new Date();
      const exp = new Date(now.getTime() + 120000);
      await db.query(`
        INSERT INTO booking_sessions (id, cycle_id, pool_id, student_id, status, started_at, expires_at)
        VALUES ('${sessId}', '${cycleId}', '${poolId}', '${sp1}', 'ACTIVE', '${now.toISOString()}', '${exp.toISOString()}')
      `);

      // Waiting candidate #2
      const u2 = 'usr_waiting_2';
      const sp2 = 'sp_waiting_2';
      await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES ('${u2}', 'COL_2', 'u2@test.com', 'Waiting 2', 'hash')`);
      await db.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category, eligibility_status) VALUES ('${sp2}', '${u2}', 'COL_2', 'Waiting 2', 1, 'CS', 'MALE', 'GENERAL', 'ELIGIBLE')`);
      await db.query(`INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status) VALUES ('wre_wait_2', '${cycleId}', '${poolId}', '${sp2}', 2, 'WAITING')`);

      // Actor confirming
      const studentActor: AuthActor = {
        id: u1,
        college_id: 'COL_1',
        role: 'STUDENT',
        scope_type: 'STUDENT',
        scope_id: null,
        student_profile_id: sp1,
        mfa_level: 'NONE',
      };

      // Candidate #1 confirms seat
      const confirmRes = await engine.confirmSeat(sessId, seatId, studentActor);
      expect(confirmRes.status).toBe('CURRENT');

      // Verify that rolling auto-refill immediately admitted waiting candidate #2!
      const w2Res = await db.query(`SELECT status FROM waiting_room_entries WHERE id = 'wre_wait_2'`);
      expect(w2Res.rows[0].status).toBe('ADMITTED');
    });
  });

  describe('3. Active Turn State Reporting & Capacity Telemetry', () => {
    it('reports live waiting, admitted, and confirmed participant counts in getActiveTurn()', async () => {
      const cycleId = 'cyc_telemetry_test';
      const poolId = 'pool_telemetry_1';

      await db.query(`
        INSERT INTO allocation_cycles (id, name, academic_year, status, max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity, waiting_room_threshold)
        VALUES ('${cycleId}', 'Telemetry Cycle', 1, 'ACTIVE', 20, 15, 5, 0)
      `);
      await db.query(`
        INSERT INTO allocation_pools (id, cycle_id, name, quota_category, academic_year)
        VALUES ('${poolId}', '${cycleId}', 'Telemetry Pool', 'GENERAL', 1)
      `);

      // User 1 WAITING, User 2 ADMITTED, User 3 CONFIRMED
      await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES ('u_tel_1', 'C1', 'e1@t.com', 'U1', 'h')`);
      await db.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category) VALUES ('sp_tel_1', 'u_tel_1', 'C1', 'U1', 1, 'CS', 'MALE', 'GENERAL')`);
      await db.query(`INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status) VALUES ('wre_t1', '${cycleId}', '${poolId}', 'sp_tel_1', 1, 'WAITING')`);

      await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES ('u_tel_2', 'C2', 'e2@t.com', 'U2', 'h')`);
      await db.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category) VALUES ('sp_tel_2', 'u_tel_2', 'C2', 'U2', 1, 'CS', 'MALE', 'GENERAL')`);
      await db.query(`INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status) VALUES ('wre_t2', '${cycleId}', '${poolId}', 'sp_tel_2', 2, 'ADMITTED')`);

      await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES ('u_tel_3', 'C3', 'e3@t.com', 'U3', 'h')`);
      await db.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category) VALUES ('sp_tel_3', 'u_tel_3', 'C3', 'U3', 1, 'CS', 'MALE', 'GENERAL')`);
      await db.query(`INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status) VALUES ('wre_t3', '${cycleId}', '${poolId}', 'sp_tel_3', 3, 'CONFIRMED')`);

      const turn = await engine.getActiveTurn(cycleId);
      expect(turn.totalWaiting).toBe(1);
      expect(turn.totalAdmitted).toBe(1);
      expect(turn.totalConfirmed).toBe(1);
    });
  });
});
