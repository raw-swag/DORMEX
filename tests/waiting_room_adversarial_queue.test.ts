import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseService, getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { AllocationEngineService } from '../src/allocation/engine.js';
import { runMigrations } from '../src/db/schema.js';
import { AuthActor } from '../src/auth/policy.js';

describe('DORMEX Phase 2: Waiting Room Adversarial Queue & Concurrency Suite', () => {
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

  const setupBaseFixtures = async (cycleId: string, poolId: string) => {
    await db.query(`
      INSERT INTO allocation_cycles (id, name, academic_year, status, max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity, waiting_room_threshold)
      VALUES ('${cycleId}', 'Adversarial Cycle', 1, 'ACTIVE', 20, 15, 5, 0)
    `);

    await db.query(`
      INSERT INTO allocation_pools (id, cycle_id, name, quota_category, academic_year)
      VALUES ('${poolId}', '${cycleId}', 'General Pool', 'GENERAL', 1)
    `);

    await db.query(`
      INSERT INTO buildings (id, code, name, gender_designation, lifecycle_status, is_active)
      VALUES ('bld_adv', 'ADV', 'Adversarial Hall', 'MALE', 'ACTIVE', TRUE)
    `);

    await db.query(`
      INSERT INTO floors (id, building_id, floor_number, label)
      VALUES ('flr_adv_1', 'bld_adv', 1, 'First Floor')
    `);

    await db.query(`
      INSERT INTO rooms (id, floor_id, room_number, capacity, is_blocked)
      VALUES ('rm_adv_101', 'flr_adv_1', '101', 50, FALSE)
    `);
  };

  const createCandidate = async (
    idNum: number,
    quota: string = 'GENERAL',
    assignedPriority?: number
  ) => {
    const userId = `usr_cand_${idNum}`;
    const profileId = `sp_cand_${idNum}`;
    const collegeId = `USN_${idNum}`;

    await db.query(`
      INSERT INTO users (id, college_id, email, full_name, password_hash, is_active)
      VALUES ('${userId}', '${collegeId}', 'cand${idNum}@test.edu', 'Candidate ${idNum}', 'hash', TRUE)
    `);

    await db.query(`
      INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category, eligibility_status, assigned_priority)
      VALUES ('${profileId}', '${userId}', '${collegeId}', 'Candidate ${idNum}', 1, 'CS', 'MALE', '${quota}', 'ELIGIBLE', ${assignedPriority ?? 'NULL'})
    `);

    return { userId, profileId, collegeId };
  };

  const createSeat = async (seatNum: number) => {
    const seatId = `seat_adv_${seatNum}`;
    await db.query(`
      INSERT INTO seats (id, room_id, seat_label, status)
      VALUES ('${seatId}', 'rm_adv_101', 'S-${seatNum}', 'ACTIVE')
    `);
    return seatId;
  };

  describe('1. Capacity Boundary & Dual-Bucket Enforcement', () => {
    it('1 & 3: Standard admissions stop at 15 when 5 reserved places are protected, keeping total under 20', async () => {
      const cycleId = 'cyc_bucket_test';
      const poolId = 'pool_bucket_1';
      await setupBaseFixtures(cycleId, poolId);

      // Create 15 standard candidates already admitted
      for (let i = 1; i <= 15; i++) {
        const { profileId } = await createCandidate(i, 'GENERAL');
        await db.query(`
          INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
          VALUES ('wre_std_${i}', '${cycleId}', '${poolId}', '${profileId}', ${i}, 'ADMITTED')
        `);
      }

      // Add a 16th standard candidate waiting
      const std16 = await createCandidate(16, 'GENERAL');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_std_16', '${cycleId}', '${poolId}', '${std16.profileId}', 16, 'WAITING')
      `);

      // Attempt refill
      await db.transaction(async (client) => {
        const refill = await engine.triggerRollingRefill(client, cycleId);
        // Standard capacity is 15. Active standard count is 15. The 5 remaining slots are reserved for priority!
        // Therefore standard candidate 16 cannot consume protected reserved capacity.
        expect(refill.admittedCandidateId).toBeNull();
      });

      // Now add a Priority candidate (SPORTS quota) waiting
      const prio1 = await createCandidate(101, 'SPORTS');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_prio_1', '${cycleId}', '${poolId}', '${prio1.profileId}', 101, 'WAITING')
      `);

      // Refill attempt now admits the priority candidate into the reserved bucket!
      await db.transaction(async (client) => {
        const refill = await engine.triggerRollingRefill(client, cycleId);
        expect(refill.admittedCandidateId).toBe('wre_prio_1');
        expect(refill.totalAdmitted).toBe(16);
      });
    });

    it('2 & 6: Duplicate admission attempts for the same candidate are rejected/idempotent', async () => {
      const cycleId = 'cyc_dup_test';
      const poolId = 'pool_dup_1';
      await setupBaseFixtures(cycleId, poolId);

      const cand = await createCandidate(1, 'GENERAL');
      const actor: AuthActor = {
        id: cand.userId,
        college_id: cand.collegeId,
        role: 'STUDENT',
        scope_type: 'STUDENT',
        scope_id: null,
        student_profile_id: cand.profileId,
        mfa_level: 'NONE',
      };

      const res1 = await engine.joinWaitingRoom(cycleId, cand.profileId, actor);
      const res2 = await engine.joinWaitingRoom(cycleId, cand.profileId, actor);

      expect(res1.entryId).toBe(res2.entryId);
      const entries = await db.query(`SELECT COUNT(*) as cnt FROM waiting_room_entries WHERE cycle_id = $1 AND student_id = $2`, [cycleId, cand.profileId]);
      expect(parseInt(entries.rows[0].cnt, 10)).toBe(1);
    });
  });

  describe('2. Vacancy Creation & Rolling Refill State Transitions', () => {
    it('4 & 7: Seat confirmation vacates turn and atomically auto-refills next waiting candidate', async () => {
      const cycleId = 'cyc_refill_conf';
      const poolId = 'pool_refill_conf';
      await setupBaseFixtures(cycleId, poolId);

      const seatId = await createSeat(1);

      // Candidate 1 has an active session
      const c1 = await createCandidate(1, 'GENERAL');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_act_c1', '${cycleId}', '${poolId}', '${c1.profileId}', 1, 'ACTIVE_TURN')
      `);
      const sessId = 'sess_conf_test';
      const now = new Date();
      const exp = new Date(now.getTime() + 60000);
      await db.query(`
        INSERT INTO booking_sessions (id, cycle_id, pool_id, student_id, status, started_at, expires_at)
        VALUES ('${sessId}', '${cycleId}', '${poolId}', '${c1.profileId}', 'ACTIVE', '${now.toISOString()}', '${exp.toISOString()}')
      `);

      // Candidate 2 is waiting
      const c2 = await createCandidate(2, 'GENERAL');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_wait_c2', '${cycleId}', '${poolId}', '${c2.profileId}', 2, 'WAITING')
      `);

      const actor: AuthActor = {
        id: c1.userId,
        college_id: c1.collegeId,
        role: 'STUDENT',
        scope_type: 'STUDENT',
        scope_id: null,
        student_profile_id: c1.profileId,
        mfa_level: 'NONE',
      };

      // Confirm seat
      await engine.confirmSeat(sessId, seatId, actor);

      // Verify c1 is confirmed, c2 is automatically admitted!
      const c1Res = await db.query(`SELECT status FROM waiting_room_entries WHERE id = 'wre_act_c1'`);
      const c2Res = await db.query(`SELECT status FROM waiting_room_entries WHERE id = 'wre_wait_c2'`);
      expect(c1Res.rows[0].status).toBe('CONFIRMED');
      expect(c2Res.rows[0].status).toBe('ADMITTED');
    });

    it('8: Expired turn triggers rolling refill', async () => {
      const cycleId = 'cyc_refill_exp';
      const poolId = 'pool_refill_exp';
      await setupBaseFixtures(cycleId, poolId);

      const seatId = await createSeat(2);

      // Candidate 1 has an EXPIRED session (timestamp in the past)
      const c1 = await createCandidate(1, 'GENERAL');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_exp_c1', '${cycleId}', '${poolId}', '${c1.profileId}', 1, 'ACTIVE_TURN')
      `);
      const sessId = 'sess_exp_test';
      const past = new Date(Date.now() - 10000);
      await db.query(`
        INSERT INTO booking_sessions (id, cycle_id, pool_id, student_id, status, started_at, expires_at)
        VALUES ('${sessId}', '${cycleId}', '${poolId}', '${c1.profileId}', 'ACTIVE', '${past.toISOString()}', '${past.toISOString()}')
      `);

      // Candidate 2 is waiting
      const c2 = await createCandidate(2, 'GENERAL');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_wait_c2_exp', '${cycleId}', '${poolId}', '${c2.profileId}', 2, 'WAITING')
      `);

      const actor: AuthActor = {
        id: c1.userId,
        college_id: c1.collegeId,
        role: 'STUDENT',
        scope_type: 'STUDENT',
        scope_id: null,
        student_profile_id: c1.profileId,
        mfa_level: 'NONE',
      };

      // Turn expiration is handled when advancePoolTurn runs on the pool
      const adv = await engine.advancePoolTurn(poolId);

      const c1Res = await db.query(`SELECT status FROM waiting_room_entries WHERE id = 'wre_exp_c1'`);
      const c2Res = await db.query(`SELECT status FROM waiting_room_entries WHERE id = 'wre_wait_c2_exp'`);
      expect(c1Res.rows[0].status).toBe('SKIPPED');
      expect(c2Res.rows[0].status).toBe('ACTIVE_TURN');
    });

    it('Participant voluntary exit / cancellation triggers rolling refill', async () => {
      const cycleId = 'cyc_exit_test';
      const poolId = 'pool_exit_test';
      await setupBaseFixtures(cycleId, poolId);

      const c1 = await createCandidate(1, 'GENERAL');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_exit_c1', '${cycleId}', '${poolId}', '${c1.profileId}', 1, 'ADMITTED')
      `);

      const c2 = await createCandidate(2, 'GENERAL');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_exit_c2', '${cycleId}', '${poolId}', '${c2.profileId}', 2, 'WAITING')
      `);

      const actor: AuthActor = {
        id: c1.userId,
        college_id: c1.collegeId,
        role: 'STUDENT',
        scope_type: 'STUDENT',
        scope_id: null,
        student_profile_id: c1.profileId,
        mfa_level: 'NONE',
      };

      const exitRes = await engine.leaveWaitingRoom(cycleId, c1.profileId, actor);
      expect(exitRes.status).toBe('CANCELLED');
      expect(exitRes.refilledCandidateId).toBe('wre_exit_c2');

      const c2Res = await db.query(`SELECT status FROM waiting_room_entries WHERE id = 'wre_exit_c2'`);
      expect(c2Res.rows[0].status).toBe('ADMITTED');
    });

    it('9: Transaction rollback during refill leaves state consistent and uncorrupted', async () => {
      const cycleId = 'cyc_rollback_test';
      const poolId = 'pool_rollback_test';
      await setupBaseFixtures(cycleId, poolId);

      const c1 = await createCandidate(1, 'GENERAL');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_rb_c1', '${cycleId}', '${poolId}', '${c1.profileId}', 1, 'WAITING')
      `);

      // Execute a transaction that attempts refill and then intentionally throws
      await expect(
        db.transaction(async (client) => {
          await engine.triggerRollingRefill(client, cycleId);
          throw new Error('INTENTIONAL_SIMULATED_CRASH');
        })
      ).rejects.toThrow('INTENTIONAL_SIMULATED_CRASH');

      // Verify that candidate 1 is still WAITING, not ADMITTED
      const c1Res = await db.query(`SELECT status FROM waiting_room_entries WHERE id = 'wre_rb_c1'`);
      expect(c1Res.rows[0].status).toBe('WAITING');
    });

    it('5 & 10: Two concurrent refill attempts targeting the same vacancy admit exactly one candidate', async () => {
      const cycleId = 'cyc_concurrent_refill';
      const poolId = 'pool_concurrent_refill';
      await setupBaseFixtures(cycleId, poolId);

      // Populate 14 standard candidates + 5 priority candidates admitted (total 19 admitted, 1 standard vacancy left to reach 15 standard / 20 max)
      for (let i = 1; i <= 14; i++) {
        const { profileId } = await createCandidate(i, 'GENERAL');
        await db.query(`
          INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
          VALUES ('wre_cr_${i}', '${cycleId}', '${poolId}', '${profileId}', ${i}, 'ADMITTED')
        `);
      }
      for (let i = 15; i <= 19; i++) {
        const { profileId } = await createCandidate(i, 'SPORTS');
        await db.query(`
          INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
          VALUES ('wre_cr_${i}', '${cycleId}', '${poolId}', '${profileId}', ${i}, 'ADMITTED')
        `);
      }

      // Candidate 20 and Candidate 21 waiting
      const c20 = await createCandidate(20, 'GENERAL');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_cr_20', '${cycleId}', '${poolId}', '${c20.profileId}', 20, 'WAITING')
      `);
      const c21 = await createCandidate(21, 'GENERAL');
      await db.query(`
        INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status)
        VALUES ('wre_cr_21', '${cycleId}', '${poolId}', '${c21.profileId}', 21, 'WAITING')
      `);

      // Two simultaneous refill calls on independent transactions
      const refillTask1 = db.transaction((client) => engine.triggerRollingRefill(client, cycleId));
      const refillTask2 = db.transaction((client) => engine.triggerRollingRefill(client, cycleId));

      const [res1, res2] = await Promise.all([refillTask1, refillTask2]);

      // Exactly ONE refill admitted a candidate, the other saw that capacity (20) was reached!
      const admittedCount = (res1.admittedCandidateId ? 1 : 0) + (res2.admittedCandidateId ? 1 : 0);
      expect(admittedCount).toBe(1);

      const totalAdmittedRes = await db.query(
        `SELECT COUNT(*) as cnt FROM waiting_room_entries WHERE cycle_id = $1 AND status = 'ADMITTED'`,
        [cycleId]
      );
      expect(parseInt(totalAdmittedRes.rows[0].cnt, 10)).toBe(20);
    });
  });
});
