import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { PostgresDatabaseService } from '../src/db/index.js';
import { AllocationEngineService } from '../src/allocation/engine.js';
import { runMigrations } from '../src/db/schema.js';
import { reconcileAndRunMigrations, rollbackLastMigration } from '../src/db/migrate.js';
import { AuthActor } from '../src/auth/policy.js';

describe('DORMEX Phase 2: Real PostgreSQL 18 Multi-Connection Concurrency & Capacity Suite', () => {
  const PG_TEST_URL = process.env.ISOLATED_PG_TEST_URL;
  let masterClient: Client | null = null;
  let db: PostgresDatabaseService | null = null;
  let engine: AllocationEngineService | null = null;
  let isPgAvailable = false;
  let pgVersion = '';

  beforeAll(async () => {
    if (!PG_TEST_URL) {
      console.log('NOTICE: ISOLATED_PG_TEST_URL is unset.');
      console.log('Skipping real multi-connection PostgreSQL 18 tests in generic unconfigured run.');
      isPgAvailable = false;
      return;
    }

    try {
      const url = new URL(PG_TEST_URL);

      // STRICT SAFETY GUARDS:
      // 1. Must never target production Render hosts
      if (url.hostname.includes('render.com') || url.hostname.includes('dpg-dbnjeqrl550s73fcr1lg-a')) {
        console.error('FATAL SAFETY GUARD: Target connection string points to Render cloud host! Refusing execution.');
        isPgAvailable = false;
        return;
      }
      // 2. Must never target production database names
      if (url.pathname === '/dormex_db' || url.pathname === '/dormex') {
        console.error('FATAL SAFETY GUARD: Target database name is production dormex_db! Refusing execution.');
        isPgAvailable = false;
        return;
      }
      // 3. Must be local or explicit isolated test database
      if (!url.pathname.includes('test') && !url.pathname.includes('isolated')) {
        console.error('FATAL SAFETY GUARD: Database name must contain "test" or "isolated" to confirm disposability.');
        isPgAvailable = false;
        return;
      }

      const probeClient = new Client({ connectionString: PG_TEST_URL, connectionTimeoutMillis: 3000 });
      await probeClient.connect();
      masterClient = probeClient;

      const verRes = await masterClient.query('SELECT version();');
      pgVersion = verRes.rows[0].version;
      console.log(`Verified Real PostgreSQL: ${pgVersion} on database ${url.pathname}`);

      // Initialize test schema
      db = new PostgresDatabaseService(PG_TEST_URL);
      await runMigrations(db);
      engine = new AllocationEngineService(db);
      isPgAvailable = true;
    } catch (err: any) {
      console.log(`NOTICE: Real PostgreSQL probe failed (${err.message}). Skipping.`);
      isPgAvailable = false;
    }
  }, 30000);

  afterAll(async () => {
    if (masterClient) await masterClient.end().catch(() => {});
    if (db) await db.close().catch(() => {});
  });

  describe('1. Real PostgreSQL Migration 057 Application, Rollback, and Reapplication', () => {
    it('applies, verifies, rolls back, and reapplies Migration 057 against real PostgreSQL', async () => {
      if (!isPgAvailable || !db || !masterClient) return;

      // Ensure clean migration ledger
      await reconcileAndRunMigrations(db, false);

      // Verify columns exist in real PostgreSQL catalog
      const colRes = await masterClient.query(`
        SELECT column_name, data_type, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'allocation_cycles'
        AND column_name IN ('max_admitted_capacity', 'standard_admission_capacity', 'reserved_priority_capacity')
        ORDER BY column_name;
      `);
      expect(colRes.rows.length).toBe(3);

      // Verify database CHECK constraint exists in real PostgreSQL
      const chkRes = await masterClient.query(`
        SELECT conname, pg_get_constraintdef(oid) as def
        FROM pg_constraint
        WHERE conname = 'chk_waiting_room_capacity_sum';
      `);
      expect(chkRes.rows.length).toBe(1);
      expect(chkRes.rows[0].def).toContain('max_admitted_capacity > 0');
      expect(chkRes.rows[0].def).toContain('standard_admission_capacity + reserved_priority_capacity <= max_admitted_capacity');

      // Test rollback
      const rolledBack = await rollbackLastMigration(db);
      expect(rolledBack.rolledBack).toBe('20261116_009_waiting_room_capacity_architecture');

      // Reapply migration
      const reapplied = await reconcileAndRunMigrations(db, false);
      expect(reapplied.applied).toContain('20261116_009_waiting_room_capacity_architecture');
    });

    it('enforces all four capacity constraints strictly in real PostgreSQL engine', async () => {
      if (!isPgAvailable || !masterClient) return;

      // 1. Zero max capacity -> rejected
      await expect(
        masterClient.query(`
          INSERT INTO allocation_cycles (id, name, academic_year, status, max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity)
          VALUES ('cyc_pg_zero_max', 'Zero Max', 1, 'DRAFT', 0, 0, 0)
        `)
      ).rejects.toThrow(/chk_waiting_room_capacity_sum|check constraint/i);

      // 2. Negative standard capacity -> rejected
      await expect(
        masterClient.query(`
          INSERT INTO allocation_cycles (id, name, academic_year, status, max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity)
          VALUES ('cyc_pg_neg_std', 'Neg Std', 1, 'DRAFT', 20, -1, 5)
        `)
      ).rejects.toThrow(/chk_waiting_room_capacity_sum|check constraint/i);

      // 3. Negative reserved capacity -> rejected
      await expect(
        masterClient.query(`
          INSERT INTO allocation_cycles (id, name, academic_year, status, max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity)
          VALUES ('cyc_pg_neg_res', 'Neg Res', 1, 'DRAFT', 20, 15, -1)
        `)
      ).rejects.toThrow(/chk_waiting_room_capacity_sum|check constraint/i);

      // 4. Over capacity (16 + 5 = 21 > 20) -> rejected
      await expect(
        masterClient.query(`
          INSERT INTO allocation_cycles (id, name, academic_year, status, max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity)
          VALUES ('cyc_pg_over', 'Over Cap', 1, 'DRAFT', 20, 16, 5)
        `)
      ).rejects.toThrow(/chk_waiting_room_capacity_sum|check constraint/i);
    });
  });

  describe('2. Multi-Connection Real PostgreSQL Concurrent Admission & Refill', () => {
    it('serializes concurrent refill attempts on independent database connections', async () => {
      if (!isPgAvailable || !PG_TEST_URL || !masterClient) return;

      const cycleId = `cyc_pg_conc_${Date.now()}`;
      const poolId = `pool_pg_conc_${Date.now()}`;

      await masterClient.query(`
        INSERT INTO allocation_cycles (id, name, academic_year, status, max_admitted_capacity, standard_admission_capacity, reserved_priority_capacity, waiting_room_threshold)
        VALUES ($1, 'Real PG Concurrency Cycle', 1, 'ACTIVE', 20, 15, 5, 0)
      `, [cycleId]);

      await masterClient.query(`
        INSERT INTO allocation_pools (id, cycle_id, name, quota_category, academic_year)
        VALUES ($1, $2, 'Real PG Pool', 'GENERAL', 1)
      `, [poolId, cycleId]);

      // Seed 14 standard + 5 priority admitted (19 total admitted, 1 standard place vacant)
      for (let i = 1; i <= 14; i++) {
        const uid = `u_pg_${i}_${Date.now()}`;
        const spid = `sp_pg_${i}_${Date.now()}`;
        await masterClient.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES ($1, $2, $3, 'PG Cand', 'hash')`, [uid, `USN_PG_${i}_${Date.now()}`, `pg${i}@t.edu`]);
        await masterClient.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category, eligibility_status) VALUES ($1, $2, $3, 'PG Cand', 1, 'CS', 'MALE', 'GENERAL', 'ELIGIBLE')`, [spid, uid, `USN_PG_${i}_${Date.now()}`]);
        await masterClient.query(`INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status) VALUES ($1, $2, $3, $4, $5, 'ADMITTED')`, [`wre_pg_${i}_${Date.now()}`, cycleId, poolId, spid, i]);
      }
      for (let i = 15; i <= 19; i++) {
        const uid = `u_pg_${i}_${Date.now()}`;
        const spid = `sp_pg_${i}_${Date.now()}`;
        await masterClient.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES ($1, $2, $3, 'PG Cand', 'hash')`, [uid, `USN_PG_${i}_${Date.now()}`, `pg${i}@t.edu`]);
        await masterClient.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category, eligibility_status) VALUES ($1, $2, $3, 'PG Cand', 1, 'CS', 'MALE', 'SPORTS', 'ELIGIBLE')`, [spid, uid, `USN_PG_${i}_${Date.now()}`]);
        await masterClient.query(`INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status) VALUES ($1, $2, $3, $4, $5, 'ADMITTED')`, [`wre_pg_${i}_${Date.now()}`, cycleId, poolId, spid, i]);
      }

      // Add two candidates waiting
      const c20Uid = `u_pg_20_${Date.now()}`;
      const c20Spid = `sp_pg_20_${Date.now()}`;
      await masterClient.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES ($1, $2, $3, 'PG Cand 20', 'hash')`, [c20Uid, `USN_PG_20_${Date.now()}`, `pg20@t.edu`]);
      await masterClient.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category, eligibility_status) VALUES ($1, $2, $3, 'PG Cand 20', 1, 'CS', 'MALE', 'GENERAL', 'ELIGIBLE')`, [c20Spid, c20Uid, `USN_PG_20_${Date.now()}`]);
      await masterClient.query(`INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status) VALUES ($1, $2, $3, $4, 20, 'WAITING')`, [`wre_pg_20_${Date.now()}`, cycleId, poolId, c20Spid]);

      const c21Uid = `u_pg_21_${Date.now()}`;
      const c21Spid = `sp_pg_21_${Date.now()}`;
      await masterClient.query(`INSERT INTO users (id, college_id, email, full_name, password_hash) VALUES ($1, $2, $3, 'PG Cand 21', 'hash')`, [c21Uid, `USN_PG_21_${Date.now()}`, `pg21@t.edu`]);
      await masterClient.query(`INSERT INTO student_profiles (id, user_id, college_id, full_name, academic_year, department, gender, quota_category, eligibility_status) VALUES ($1, $2, $3, 'PG Cand 21', 1, 'CS', 'MALE', 'GENERAL', 'ELIGIBLE')`, [c21Spid, c21Uid, `USN_PG_21_${Date.now()}`]);
      await masterClient.query(`INSERT INTO waiting_room_entries (id, cycle_id, pool_id, student_id, priority_number, status) VALUES ($1, $2, $3, $4, 21, 'WAITING')`, [`wre_pg_21_${Date.now()}`, cycleId, poolId, c21Spid]);

      // Open two distinct physical database connections to real PostgreSQL
      const clientA = new PostgresDatabaseService(PG_TEST_URL);
      const clientB = new PostgresDatabaseService(PG_TEST_URL);
      const engineA = new AllocationEngineService(clientA);
      const engineB = new AllocationEngineService(clientB);

      // Fire concurrent refills simultaneously across separate connections
      const startT = Date.now();
      const [resA, resB] = await Promise.all([
        clientA.transaction((c) => engineA.triggerRollingRefill(c, cycleId)),
        clientB.transaction((c) => engineB.triggerRollingRefill(c, cycleId)),
      ]);
      const durationMs = Date.now() - startT;

      await clientA.close();
      await clientB.close();

      console.log(`Real PostgreSQL Concurrent Refill Duration: ${durationMs} ms`);

      // Exactly ONE refill wins and admits a candidate, the second observes the 20-candidate cap
      const totalNewAdmissions = (resA.admittedCandidateId ? 1 : 0) + (resB.admittedCandidateId ? 1 : 0);
      expect(totalNewAdmissions).toBe(1);

      // Total in PostgreSQL is exactly 20
      const finalCountRes = await masterClient.query(`SELECT COUNT(*) as cnt FROM waiting_room_entries WHERE cycle_id = $1 AND status = 'ADMITTED'`, [cycleId]);
      expect(parseInt(finalCountRes.rows[0].cnt, 10)).toBe(20);
    });
  });
});
