import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseService, getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { AllocationEngineService } from '../src/allocation/engine.js';
import { runMigrations } from '../src/db/schema.js';
import { AuthActor } from '../src/auth/policy.js';

describe('DORMEX Phase 2: Priority Window Release & Locking Strategy Suite', () => {
  let db: any;
  let engine: AllocationEngineService;

  beforeEach(async () => {
    resetDatabaseInstance();
    db = getDatabaseService(true);
    await runMigrations(db);
    engine = new AllocationEngineService(db);
  });

  afterEach(async () => {
    if (db) await db.close();
    resetDatabaseInstance();
  });

  const setupBaseFixtures = async (
    cycleId: string,
    poolId: string,
    priorityWindowClosesAt: string | null = null
  ) => {
    await db.query(`
      INSERT INTO allocation_cycles (
        id, name, academic_year, status, max_admitted_capacity, standard_admission_capacity,
        reserved_priority_capacity, waiting_room_threshold, priority_window_closes_at
      )
      VALUES (
        '${cycleId}', 'Priority Release Cycle', 1, 'ACTIVE', 20, 15, 5, 0,
        ${priorityWindowClosesAt ? `'${priorityWindowClosesAt}'` : 'NULL'}
      )
    `);

    await db.query(`
      INSERT INTO allocation_pools (id, cycle_id, name, quota_category, academic_year)
      VALUES ('${poolId}', '${cycleId}', 'General Pool', 'GENERAL', 1)
    `);

    await db.query(`
      INSERT INTO buildings (id, code, name, gender_designation, lifecycle_status, is_active)
      VALUES ('bld_rel', 'REL', 'Release Hall', 'MALE', 'ACTIVE', TRUE)
    `);

    await db.query(`
      INSERT INTO floors (id, building_id, floor_number, label)
      VALUES ('flr_rel_1', 'bld_rel', 1, 'First Floor')
    `);

    await db.query(`
      INSERT INTO rooms (id, floor_id, room_number, capacity, is_blocked)
      VALUES ('rm_rel_101', 'flr_rel_1', '101', 50, FALSE)
    `);
  };

  const createCandidate = async (
    idNum: number,
    quota: string = 'GENERAL',
    assignedPriority?: number
  ) => {
    const userId = `usr_rel_${idNum}`;
    const profileId = `sp_rel_${idNum}`;
    const collegeId = `USN_REL_${idNum}`;

    await db.query(`
      INSERT INTO users (id, college_id, email, full_name, password_hash, is_active)
      VALUES ('${userId}', '${collegeId}', 'rel${idNum}@test.edu', 'Release Candidate ${idNum}', 'hash', TRUE)
    `);

    await db.query(`
      INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category, eligibility_status, assigned_priority)
      VALUES ('${profileId}', '${userId}', '${collegeId}', 'Release Candidate ${idNum}', 1, 'CS', 'MALE', '${quota}', 'ELIGIBLE', ${assignedPriority ?? 'NULL'})
    `);

    return { userId, profileId, collegeId };
  };

  const createSeat = async (seatNum: number) => {
    const seatId = `seat_rel_${seatNum}`;
    await db.query(`
      INSERT INTO seats (id, room_id, seat_label, status)
      VALUES ('${seatId}', 'rm_rel_101', 'S-${seatNum}', 'ACTIVE')
    `);
    return seatId;
  };

  describe('1. Priority Window Release Behavior (15+5 Transitions)', () => {
    it('1. Priority window not yet closed: blocks standard candidate 16 when standard capacity (15) is full', async () => {
      const cycleId = 'cyc_rel_open';
      const poolId = 'pool_rel_open';
      const futureWindow = new Date(Date.now() + 3600000).toISOString(); // closes in 1 hour
      await setupBaseFixtures(cycleId, poolId, futureWindow);

      // Seed 15 standard candidates admitted
      for (let i = 1; i <= 15; i++) {
        const { profileId } = await createCandidate(i, 'GENERAL');
        await db.query(`
          INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
          VALUES ('wre_ro_${i}', '${cycleId}', '${poolId}', '${profileId}', ${i}, 'ADMITTED')
        `);
      }

      // Candidate 16 (standard general) waiting
      const std16 = await createCandidate(16, 'GENERAL');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_ro_16', '${cycleId}', '${poolId}', '${std16.profileId}', 16, 'WAITING')
      `);

      // Refill attempt: Window is open, 15 standard slots are full, 5 remaining slots are protected for priority.
      await db.transaction(async (client) => {
        const res = await engine.triggerRollingRefill(client, cycleId);
        expect(res.admittedCandidateId).toBeNull();
      });
    });

    it('2. Priority window closes with all five reserved places occupied: total remains strictly capped at 20', async () => {
      const cycleId = 'cyc_rel_all_occ';
      const poolId = 'pool_rel_all_occ';
      const pastWindow = new Date(Date.now() - 3600000).toISOString(); // closed 1 hour ago
      await setupBaseFixtures(cycleId, poolId, pastWindow);

      // 15 standard + 5 priority admitted = 20 total
      for (let i = 1; i <= 15; i++) {
        const { profileId } = await createCandidate(i, 'GENERAL');
        await db.query(`
          INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
          VALUES ('wre_occ_${i}', '${cycleId}', '${poolId}', '${profileId}', ${i}, 'ADMITTED')
        `);
      }
      for (let i = 16; i <= 20; i++) {
        const { profileId } = await createCandidate(i, 'SPORTS');
        await db.query(`
          INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
          VALUES ('wre_occ_${i}', '${cycleId}', '${poolId}', '${profileId}', ${i}, 'ADMITTED')
        `);
      }

      // Candidate 21 waiting
      const c21 = await createCandidate(21, 'GENERAL');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_occ_21', '${cycleId}', '${poolId}', '${c21.profileId}', 21, 'WAITING')
      `);

      // Refill attempt: Capacity is 20, no admissions allowed
      await db.transaction(async (client) => {
        const res = await engine.triggerRollingRefill(client, cycleId);
        expect(res.admittedCandidateId).toBeNull();
        expect(res.totalAdmitted).toBe(20);
      });
    });

    it('3, 4, 5 & 6: Priority window closes with unused reserved places: general admission consumes released slots up to 20', async () => {
      const cycleId = 'cyc_rel_unused';
      const poolId = 'pool_rel_unused';
      const pastWindow = new Date(Date.now() - 60000).toISOString(); // closed 1 minute ago
      await setupBaseFixtures(cycleId, poolId, pastWindow);

      // 15 standard candidates admitted, 0 priority candidates admitted (all 5 reserved places are unused)
      for (let i = 1; i <= 15; i++) {
        const { profileId } = await createCandidate(i, 'GENERAL');
        await db.query(`
          INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
          VALUES ('wre_un_${i}', '${cycleId}', '${poolId}', '${profileId}', ${i}, 'ADMITTED')
        `);
      }

      // Add Standard Candidates 16 through 20 waiting
      for (let i = 16; i <= 20; i++) {
        const std = await createCandidate(i, 'GENERAL');
        await db.query(`
          INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
          VALUES ('wre_un_${i}', '${cycleId}', '${poolId}', '${std.profileId}', ${i}, 'WAITING')
        `);
      }

      // Because the window has closed, standard candidates 16 through 20 should sequentially fill the 5 released slots!
      for (let i = 16; i <= 20; i++) {
        await db.transaction(async (client) => {
          const res = await engine.triggerRollingRefill(client, cycleId);
          expect(res.admittedCandidateId).toBe(`wre_un_${i}`);
          expect(res.totalAdmitted).toBe(i);
        });
      }

      // 21st candidate must be blocked because max 20 capacity is reached
      const std21 = await createCandidate(21, 'GENERAL');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_un_21', '${cycleId}', '${poolId}', '${std21.profileId}', 21, 'WAITING')
      `);

      await db.transaction(async (client) => {
        const res = await engine.triggerRollingRefill(client, cycleId);
        expect(res.admittedCandidateId).toBeNull();
        expect(res.totalAdmitted).toBe(20);
      });
    });

    it('7. Refill immediately before and after release transition', async () => {
      const cycleId = 'cyc_rel_transition';
      const poolId = 'pool_rel_transition';
      // Future window: 2 seconds from now
      const closesAt = new Date(Date.now() + 2000).toISOString();
      await setupBaseFixtures(cycleId, poolId, closesAt);

      for (let i = 1; i <= 15; i++) {
        const { profileId } = await createCandidate(i, 'GENERAL');
        await db.query(`
          INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
          VALUES ('wre_trans_${i}', '${cycleId}', '${poolId}', '${profileId}', ${i}, 'ADMITTED')
        `);
      }

      const std16 = await createCandidate(16, 'GENERAL');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_trans_16', '${cycleId}', '${poolId}', '${std16.profileId}', 16, 'WAITING')
      `);

      // Before release: blocked
      await db.transaction(async (client) => {
        const resBefore = await engine.triggerRollingRefill(client, cycleId);
        expect(resBefore.admittedCandidateId).toBeNull();
      });

      // Update cycle timestamp to simulate passage of time beyond window close
      const pastTime = new Date(Date.now() - 1000).toISOString();
      await db.query(`UPDATE allocation_cycles SET priority_window_closes_at = '${pastTime}' WHERE id = '${cycleId}'`);

      // Immediately after release: admitted
      await db.transaction(async (client) => {
        const resAfter = await engine.triggerRollingRefill(client, cycleId);
        expect(resAfter.admittedCandidateId).toBe('wre_trans_16');
        expect(resAfter.totalAdmitted).toBe(16);
      });
    });

    it('8. Persistence across restart: configuration and release survive new service instances', async () => {
      const cycleId = 'cyc_rel_persist';
      const poolId = 'pool_rel_persist';
      const pastTime = new Date(Date.now() - 5000).toISOString();
      await setupBaseFixtures(cycleId, poolId, pastTime);

      const std1 = await createCandidate(1, 'GENERAL');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_pers_1', '${cycleId}', '${poolId}', '${std1.profileId}', 1, 'WAITING')
      `);

      // Simulate new backend service instance attaching to the same database
      const newEngine = new AllocationEngineService(db);

      await db.transaction(async (client) => {
        const res = await newEngine.triggerRollingRefill(client, cycleId);
        expect(res.admittedCandidateId).toBe('wre_pers_1');
        expect(res.totalAdmitted).toBe(1);
      });
    });
  });

  describe('2. Unified Locking Order & Competing Race Tests', () => {
    it('Race: joinWaitingRoom() versus triggerRollingRefill() serializes cleanly on cycle lock', async () => {
      const cycleId = 'cyc_race_join_refill';
      const poolId = 'pool_race_join_refill';
      await setupBaseFixtures(cycleId, poolId);

      const cand1 = await createCandidate(1, 'GENERAL');
      const actor1: AuthActor = {
        id: cand1.userId,
        college_id: cand1.collegeId,
        role: 'STUDENT',
        scope_type: 'STUDENT',
        scope_id: null,
        student_profile_id: cand1.profileId,
        mfa_level: 'NONE',
      };

      // Concurrent tasks
      const taskJoin = engine.joinWaitingRoom(cycleId, cand1.profileId, actor1);
      const taskRefill = db.transaction((client) => engine.triggerRollingRefill(client, cycleId));

      const [joinRes, refillRes] = await Promise.all([taskJoin, taskRefill]);

      expect(joinRes.status).toBe('WAITING');
      // Neither deadlocks, mutual exclusion preserved
      expect(refillRes.totalAdmitted).toBeDefined();
    });

    it('Race: confirmSeat() versus leaveWaitingRoom() serializes cleanly without deadlock', async () => {
      const cycleId = 'cyc_race_conf_leave';
      const poolId = 'pool_race_conf_leave';
      await setupBaseFixtures(cycleId, poolId);

      const seat1 = await createSeat(1);
      const c1 = await createCandidate(1, 'GENERAL');
      const c2 = await createCandidate(2, 'GENERAL');

      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_rc_1', '${cycleId}', '${poolId}', '${c1.profileId}', 1, 'ACTIVE_TURN')
      `);
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_rc_2', '${cycleId}', '${poolId}', '${c2.profileId}', 2, 'ADMITTED')
      `);

      const now = new Date();
      const exp = new Date(now.getTime() + 60000);
      await db.query(`
        INSERT INTO booking_sessions (id, cycle_id, pool_id, student_id, status, started_at, expires_at)
        VALUES ('sess_rc_1', '${cycleId}', '${poolId}', '${c1.profileId}', 'ACTIVE', '${now.toISOString()}', '${exp.toISOString()}')
      `);

      const actor1: AuthActor = {
        id: c1.userId,
        college_id: c1.collegeId,
        role: 'STUDENT',
        scope_type: 'STUDENT',
        scope_id: null,
        student_profile_id: c1.profileId,
        mfa_level: 'NONE',
      };

      const actor2: AuthActor = {
        id: c2.userId,
        college_id: c2.collegeId,
        role: 'STUDENT',
        scope_type: 'STUDENT',
        scope_id: null,
        student_profile_id: c2.profileId,
        mfa_level: 'NONE',
      };

      // Both contend on cycle lock through uniform root-to-leaf lock order: allocation_cycles -> booking_sessions / waiting_room_entries
      const taskConfirm = engine.confirmSeat('sess_rc_1', seat1, actor1);
      const taskLeave = engine.leaveWaitingRoom(cycleId, c2.profileId, actor2);

      const [confRes, leaveRes] = await Promise.all([taskConfirm, taskLeave]);

      expect(confRes.status).toBe('CURRENT');
      expect(leaveRes.status).toBe('CANCELLED');
    });
  });
});
