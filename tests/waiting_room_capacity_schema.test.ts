import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { reconcileAndRunMigrations } from '../src/db/migrate.js';

describe('DORMEX Phase 1: Allocation Cycle Waiting Room Capacity Schema & Architecture Suite', () => {
  beforeEach(() => {
    resetDatabaseInstance();
  });

  afterEach(async () => {
    const db = getDatabaseService(true);
    await db.close();
    resetDatabaseInstance();
  });

  describe('1. Schema Definition & Default Capacity Constraints', () => {
    it('initializes allocation_cycles with default 20 max, 15 standard, and 5 reserved capacities', async () => {
      const db = getDatabaseService(true);
      await runMigrations(db);

      // Insert cycle without specifying capacity fields -> verifies NOT NULL defaults
      await db.query(`
        INSERT INTO allocation_cycles (id, name, academic_year, status)
        VALUES ('cyc_test_defaults', 'Test Defaults Cycle', 1, 'DRAFT')
      `);

      const res = await db.query(`
        SELECT id, max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity, waiting_room_threshold
        FROM allocation_cycles
        WHERE id = 'cyc_test_defaults'
      `);

      expect(res.rows.length).toBe(1);
      const row = res.rows[0];
      expect(Number(row.max_admitted_capacity)).toBe(20);
      expect(Number(row.standard_admission_capacity)).toBe(15);
      expect(Number(row.reserved_priority_capacity)).toBe(5);
      // Legacy threshold is preserved for backward-compatibility
      expect(Number(row.waiting_room_threshold)).toBe(45);
    });

    it('permits valid custom capacity configurations where standard + reserved <= max', async () => {
      const db = getDatabaseService(true);
      await runMigrations(db);

      // Custom configuration: 30 max, 22 standard, 8 reserved (22 + 8 <= 30)
      await db.query(`
        INSERT INTO allocation_cycles (
          id, name, academic_year, status,
          max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity
        )
        VALUES ('cyc_test_custom_valid', 'Custom Valid Cycle', 2, 'DRAFT', 30, 22, 8)
      `);

      const res = await db.query(`
        SELECT max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity
        FROM allocation_cycles
        WHERE id = 'cyc_test_custom_valid'
      `);

      expect(res.rows.length).toBe(1);
      expect(Number(res.rows[0].max_admitted_capacity)).toBe(30);
      expect(Number(res.rows[0].standard_admission_capacity)).toBe(22);
      expect(Number(res.rows[0].reserved_priority_capacity)).toBe(8);
    });

    it('rejects invalid capacity configurations where standard + reserved exceeds max capacity', async () => {
      const db = getDatabaseService(true);
      await runMigrations(db);

      // Contradictory configuration: 20 max, 18 standard, 5 reserved (18 + 5 = 23 > 20) -> must fail CHECK constraint
      let rejected = false;
      try {
        await db.query(`
          INSERT INTO allocation_cycles (
            id, name, academic_year, status,
            max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity
          )
          VALUES ('cyc_test_invalid_sum', 'Invalid Sum Cycle', 2, 'DRAFT', 20, 18, 5)
        `);
      } catch (err: any) {
        rejected = true;
        expect(err.message.toLowerCase()).toContain('check');
      }

      expect(rejected).toBe(true);
    });

    it('rejects zero or negative maximum capacity values', async () => {
      const db = getDatabaseService(true);
      await runMigrations(db);

      let rejectedZero = false;
      try {
        await db.query(`
          INSERT INTO allocation_cycles (
            id, name, academic_year, status,
            max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity
          )
          VALUES ('cyc_test_zero_max', 'Zero Max Cycle', 2, 'DRAFT', 0, 0, 0)
        `);
      } catch (err: any) {
        rejectedZero = true;
        expect(err.message.toLowerCase()).toContain('check');
      }
      expect(rejectedZero).toBe(true);

      let rejectedNegative = false;
      try {
        await db.query(`
          INSERT INTO allocation_cycles (
            id, name, academic_year, status,
            max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity
          )
          VALUES ('cyc_test_neg_max', 'Negative Max Cycle', 2, 'DRAFT', -5, 0, 0)
        `);
      } catch (err: any) {
        rejectedNegative = true;
        expect(err.message.toLowerCase()).toContain('check');
      }
      expect(rejectedNegative).toBe(true);
    });

    it('rejects negative standard or reserved admission capacity values', async () => {
      const db = getDatabaseService(true);
      await runMigrations(db);

      let rejectedNegStd = false;
      try {
        await db.query(`
          INSERT INTO allocation_cycles (
            id, name, academic_year, status,
            max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity
          )
          VALUES ('cyc_test_neg_std', 'Negative Standard Cycle', 2, 'DRAFT', 20, -1, 5)
        `);
      } catch (err: any) {
        rejectedNegStd = true;
        expect(err.message.toLowerCase()).toContain('check');
      }
      expect(rejectedNegStd).toBe(true);

      let rejectedNegRes = false;
      try {
        await db.query(`
          INSERT INTO allocation_cycles (
            id, name, academic_year, status,
            max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity
          )
          VALUES ('cyc_test_neg_res', 'Negative Reserved Cycle', 2, 'DRAFT', 20, 15, -2)
        `);
      } catch (err: any) {
        rejectedNegRes = true;
        expect(err.message.toLowerCase()).toContain('check');
      }
      expect(rejectedNegRes).toBe(true);
    });
  });

  describe('2. Migration 057 Reconciler & Idempotency', () => {
    it('applies migration 057 and registers manifest idempotently', async () => {
      const db = getDatabaseService(true);

      // Execute migration framework
      const result = await reconcileAndRunMigrations(db, false, false);
      expect(result.applied).toBeDefined();

      // Verify migration record was recorded in schema_migrations
      const migRows = await db.query(`
        SELECT id, name FROM schema_migrations WHERE id = '20261116_009_waiting_room_capacity_architecture'
      `);
      expect(migRows.rows.length).toBe(1);
      expect(migRows.rows[0].name).toContain('15 standard + 5 reserved');

      // Re-running reconciler is completely idempotent
      const rerun = await reconcileAndRunMigrations(db, false, false);
      expect(rerun.alreadyRecorded).toContain('20261116_009_waiting_room_capacity_architecture');
    });
  });

  describe('3. Existing Allocation Cycles & User Compatibility', () => {
    it('preserves existing users table contract without conflicting account status columns', async () => {
      const db = getDatabaseService(true);
      await runMigrations(db);

      // Verify users table structure: authoritative is_active and session_version
      const userRes = await db.query(`
        INSERT INTO users (id, college_id, email, full_name, password_hash, is_active, session_version)
        VALUES ('usr_phase1_test', 'COLL_P1', 'p1@univ.edu', 'Phase 1 User', 'hash123', true, 1)
        RETURNING is_active, session_version
      `);

      expect(userRes.rows[0].is_active).toBe(true);
      expect(Number(userRes.rows[0].session_version)).toBe(1);
    });
  });
});
