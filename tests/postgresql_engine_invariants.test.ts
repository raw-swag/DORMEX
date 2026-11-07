import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDatabaseService, resetDatabaseInstance } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';

describe('DORMEX Phase 5: PostgreSQL Database Engine Invariants & Transactions Suite', () => {
  beforeEach(() => {
    resetDatabaseInstance();
  });

  afterEach(async () => {
    const db = getDatabaseService(true);
    await db.close();
    resetDatabaseInstance();
  });

  describe('1. Relational Integrity, Constraints & Cascades', () => {
    it('initializes in-memory PostgreSQL engine and executes all migrations idempotently', async () => {
      const db = getDatabaseService(true);
      await runMigrations(db);
      // Run second time to verify idempotency
      await expect(runMigrations(db)).resolves.not.toThrow();

      const tableRes = await db.query(`
        SELECT count(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      expect(parseInt(tableRes.rows[0].count, 10)).toBeGreaterThanOrEqual(30);
    });

    it('enforces foreign key cascading when a building is deleted', async () => {
      const db = getDatabaseService(true);
      await runMigrations(db);

      const bldId = 'bld_cascade_test';
      await db.query(`
        INSERT INTO buildings (id, code, name, gender_designation, total_floors)
        VALUES ($1, 'CASC', 'Cascade Building', 'COED', 3)
      `, [bldId]);

      const flrId = 'flr_cascade_test';
      await db.query(`
        INSERT INTO floors (id, building_id, floor_number, label)
        VALUES ($1, $2, 1, 'Floor 1')
      `, [flrId, bldId]);

      // Delete parent building
      await db.query('DELETE FROM buildings WHERE id = $1', [bldId]);

      // Assert floor was deleted via ON DELETE CASCADE
      const checkFloor = await db.query('SELECT * FROM floors WHERE id = $1', [flrId]);
      expect(checkFloor.rows.length).toBe(0);
    });

    it('rolls back atomic transactions completely when an error occurs', async () => {
      const db = getDatabaseService(true);
      await runMigrations(db);

      const testUserId = 'usr_rollback_test';
      
      await expect(
        db.transaction(async (client) => {
          await client.query(`
            INSERT INTO users (id, college_id, email, full_name, password_hash)
            VALUES ($1, 'TEST-ROLLBACK', 'rollback@dormex.edu', 'Rollback User', 'hashed')
          `, [testUserId]);

          // Force an intentional failure inside the transaction
          throw new Error('INTENTIONAL_TRANSACTION_FAILURE');
        })
      ).rejects.toThrow('INTENTIONAL_TRANSACTION_FAILURE');

      // Verify the user was NOT committed to the database
      const userRes = await db.query('SELECT * FROM users WHERE id = $1', [testUserId]);
      expect(userRes.rows.length).toBe(0);
    });

    it('enforces partial unique index preventing duplicate active allocations for a seat', async () => {
      const db = getDatabaseService(true);
      await runMigrations(db);

      const bldId = 'bld_seat_test';
      await db.query(`INSERT INTO buildings (id, code, name, gender_designation) VALUES ($1, 'SEAT', 'Seat Test Block', 'MALE')`, [bldId]);
      const flrId = 'flr_seat_test';
      await db.query(`INSERT INTO floors (id, building_id, floor_number, label) VALUES ($1, $2, 1, 'Ground')`, [flrId, bldId]);
      const roomId = 'rm_seat_test';
      await db.query(`INSERT INTO rooms (id, floor_id, room_number, room_type, capacity) VALUES ($1, $2, '101', 'SINGLE', 1)`, [roomId, flrId]);
      const seatId = 'st_seat_test';
      await db.query(`INSERT INTO seats (id, room_id, seat_label, status) VALUES ($1, $2, 'A', 'ACTIVE')`, [seatId, roomId]);

      const cycleId = 'cyc_seat_test';
      await db.query(`INSERT INTO allocation_cycles (id, name, academic_year, status) VALUES ($1, 'Test Cycle', 2026, 'READY')`, [cycleId]);

      const u1 = 'usr_alloc_1';
      const u2 = 'usr_alloc_2';
      await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES ($1, 'STU1', 'stu1@dormex.edu', 'Student One', 'hash')`, [u1]);
      await db.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES ($1, 'STU2', 'stu2@dormex.edu', 'Student Two', 'hash')`, [u2]);

      const p1 = 'prof_alloc_1';
      const p2 = 'prof_alloc_2';
      await db.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category) VALUES ($1, $2, 'STU1', 'Student One', 1, 'CS', 'MALE', 'GENERAL')`, [p1, u1]);
      await db.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category) VALUES ($1, $2, 'STU2', 'Student Two', 1, 'CS', 'MALE', 'GENERAL')`, [p2, u2]);

      // First student confirms seat
      await db.query(`
        INSERT INTO allocations (id, cycle_id, student_id, seat_id, status)
        VALUES ('alloc_1', $1, $2, $3, 'CURRENT')
      `, [cycleId, p1, seatId]);

      // Second student attempts to allocate the exact same seat in the same cycle -> partial index must reject
      await expect(
        db.query(`
          INSERT INTO allocations (id, cycle_id, student_id, seat_id, status)
          VALUES ('alloc_2', $1, $2, $3, 'CURRENT')
        `, [cycleId, p2, seatId])
      ).rejects.toThrow();
    });
  });
});
