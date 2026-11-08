import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { PostgresDatabaseService } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { reconcileAndRunMigrations } from '../src/db/migrate.js';
import { ALL_33_SCHEMA_TABLES } from '../src/db/schema_manifest.js';
import { GovernanceService } from '../src/auth/governanceService.js';

describe('DORMEX Phase 2: Stage 4 Isolated Real PostgreSQL 18 Validation Suite', () => {
  const PG_TEST_URL = process.env.ISOLATED_PG_TEST_URL || 'postgresql://postgres@127.0.0.1:5433/dormex_stage4_isolated';
  let client: Client | null = null;
  let db: PostgresDatabaseService | null = null;
  let govService: GovernanceService | null = null;
  let isPgAvailable = false;

  beforeAll(async () => {
    // Check if isolated local PostgreSQL server is reachable
    try {
      const probeClient = new Client({ connectionString: PG_TEST_URL, connectionTimeoutMillis: 1000 });
      await probeClient.connect();
      isPgAvailable = true;
      client = probeClient;

      // 1. Verify that database is strictly local
      const url = new URL(PG_TEST_URL);
      expect(url.hostname).toBe('127.0.0.1');
      expect(url.port).toBe('5433');
      expect(url.pathname).toBe('/dormex_stage4_isolated');

      // Reset test database schema completely
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

      db = new PostgresDatabaseService(PG_TEST_URL);
      govService = new GovernanceService(db);
    } catch {
      console.log('NOTICE: Isolated PostgreSQL 18 on 127.0.0.1:5433 not active; skipping real-PG suite during generic test runs.');
      isPgAvailable = false;
    }
  }, 30000);

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
    if (db) await db.close().catch(() => {});
  });

  describe('Workstream 2: Complete Migration Sequence on Real PostgreSQL 18', () => {
    it('executes migrations 20261103_001 through 20261108_005 idempotently and atomically', async () => {
      if (!isPgAvailable || !client || !db || !govService) return;
      // Step A: Run migrations and verify schema ledger
      const res = await reconcileAndRunMigrations(db, false);
      expect(res.applied.length).toBe(5);
      expect(res.applied).toEqual([
        '20261103_001_core_schema',
        '20261104_002_terms_and_accord',
        '20261105_003_password_reset_tokens',
        '20261106_004_production_bootstrap',
        '20261108_005_warden_hierarchy',
      ]);

      // Step B: Re-running must be 100% idempotent
      const secondRun = await reconcileAndRunMigrations(db, false);
      expect(secondRun.applied.length).toBe(0);
      expect(secondRun.alreadyRecorded.length).toBe(5);
    });

    it('validates actual PostgreSQL catalog definitions against schema_manifest requirements', async () => {
      if (!isPgAvailable || !client) return;
      // Check tables exist in information_schema
      const tablesRes = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`
      );
      const existingTables = new Set(tablesRes.rows.map((r) => r.table_name));

      for (const req of ALL_33_SCHEMA_TABLES) {
        expect(existingTables.has(req.tableName)).toBe(true);

        // Verify columns
        const colsRes = await client.query(
          `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1`,
          [req.tableName]
        );
        const colMap = new Map(colsRes.rows.map((c) => [c.column_name, c]));

        for (const col of req.columns) {
          expect(colMap.has(col.name)).toBe(true);
          const actualCol = colMap.get(col.name)!;
          if (col.nullable !== undefined) {
            expect(actualCol.is_nullable === 'YES').toBe(col.nullable);
          }
        }
      }
    });

    it('verifies partial unique index on active supervisor deputy cardinality in real PostgreSQL', async () => {
      if (!isPgAvailable || !client) return;
      const idxRes = await client.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'deputy_appointments' AND indexname = 'uq_single_active_deputy_per_warden';
      `);
      expect(idxRes.rows.length).toBe(1);
      expect(idxRes.rows[0].indexdef).toContain('WHERE (appointment_status =');
    });
  });

  describe('Workstream 1: Tamper-Resistant Audit Immutability on Real PostgreSQL 18', () => {
    it('enforces append-only immutability triggers: forbids UPDATE and DELETE on audit_logs and governance_action_events', async () => {
      if (!isPgAvailable || !client) return;
      // 1. Legitimate INSERT into governance_actions and governance_action_events
      const actId = 'act_immutability_test_01';
      const evtId = 'evt_immutability_test_01';

      await client.query(`
        INSERT INTO governance_actions (id, action_type, actor_id, reason, status)
        VALUES ($1, 'TEST_AUDIT', 'usr_admin', 'Testing tamper resistance', 'SUBMITTED');
      `, [actId]);

      await client.query(`
        INSERT INTO governance_action_events (id, action_id, event_type, details_json)
        VALUES ($1, $2, 'ACTION_SUBMITTED', '{"payload": "authentic"}');
      `, [evtId, actId]);

      // 2. Attempt UPDATE on governance_action_events -> Trigger must raise exception
      await expect(
        client.query(`UPDATE governance_action_events SET details_json = '{"tampered": true}' WHERE id = $1`, [evtId])
      ).rejects.toThrow(/TAMPER_PROTECTION_VIOLATION.*Modifications or deletions/);

      // 3. Attempt DELETE on governance_action_events -> Trigger must raise exception
      await expect(
        client.query(`DELETE FROM governance_action_events WHERE id = $1`, [evtId])
      ).rejects.toThrow(/TAMPER_PROTECTION_VIOLATION.*Modifications or deletions/);

      // 4. Verify original event record remains 100% intact
      const verifyEvt = await client.query(`SELECT details_json FROM governance_action_events WHERE id = $1`, [evtId]);
      expect(verifyEvt.rows[0].details_json).toBe('{"payload": "authentic"}');

      // 5. Test audit_logs immutability
      const logId = 'log_immutability_test_01';
      await client.query(`
        INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason)
        VALUES ($1, 'usr_admin', 'SECURITY_CHECK', 'SYSTEM', 'sys_01', 'Initial authentic log');
      `, [logId]);

      // Attempt UPDATE on audit_logs -> Trigger must raise exception
      await expect(
        client.query(`UPDATE audit_logs SET reason = 'tampered' WHERE id = $1`, [logId])
      ).rejects.toThrow(/TAMPER_PROTECTION_VIOLATION.*Modifications or deletions/);

      // Attempt DELETE on audit_logs -> Trigger must raise exception
      await expect(
        client.query(`DELETE FROM audit_logs WHERE id = $1`, [logId])
      ).rejects.toThrow(/TAMPER_PROTECTION_VIOLATION.*Modifications or deletions/);

      // 6. Test TRUNCATE protection on audit_logs and governance_action_events
      await expect(
        client.query(`TRUNCATE TABLE audit_logs`)
      ).rejects.toThrow(/TAMPER_PROTECTION_VIOLATION.*Modifications or deletions/);

      await expect(
        client.query(`TRUNCATE TABLE governance_action_events`)
      ).rejects.toThrow(/TAMPER_PROTECTION_VIOLATION.*Modifications or deletions/);

      // Verify original audit log remains intact
      const verifyLog = await client.query(`SELECT reason FROM audit_logs WHERE id = $1`, [logId]);
      expect(verifyLog.rows[0].reason).toBe('Initial authentic log');
    });
  });

  describe('Workstream 3: Real PostgreSQL Concurrency and Locking', () => {
    it('simultaneous Warden and Deputy appointment attempts for the same user fail closed via SELECT FOR UPDATE candidate lock', async () => {
      if (!isPgAvailable || !client || !govService) return;
      // Ensure bld_bvb is ACTIVE in test environment
      await client.query(`UPDATE buildings SET lifecycle_status = 'ACTIVE' WHERE id = 'bld_bvb'`);

      // Create second building
      await client.query(`
        INSERT INTO buildings (id, code, name, gender_designation, lifecycle_status)
        VALUES ('bld_race_test', 'RACE', 'Race Test Block', 'COED', 'ACTIVE')
        ON CONFLICT (id) DO NOTHING;
      `);

      // Appoint Warden on bld_bvb so supervisor appt exists
      const wrdApptId = await govService.appointWarden({
        userId: 'usr_warden_bvb',
        buildingId: 'bld_bvb',
        appointedBy: 'usr_admin',
        reason: 'Tenure',
      });

      // Target candidate: usr_office
      // Two concurrent transactions:
      // Conn 1: Appoint usr_office as Warden of bld_race_test
      // Conn 2: Appoint usr_office as Deputy of bld_bvb
      const conn1 = new Client({ connectionString: PG_TEST_URL });
      const conn2 = new Client({ connectionString: PG_TEST_URL });
      await conn1.connect();
      await conn2.connect();

      const p1 = govService.appointWarden({
        userId: 'usr_office',
        buildingId: 'bld_race_test',
        appointedBy: 'usr_admin',
        reason: 'Race attempt 1',
      });

      const p2 = govService.appointDeputy({
        userId: 'usr_office',
        buildingId: 'bld_bvb',
        supervisorWardenApptId: wrdApptId,
        appointedBy: 'usr_admin',
        reason: 'Race attempt 2',
      });

      // Exactly one must succeed, the other must fail with CROSS_ROLE_CONFLICT or lock serialization
      const results = await Promise.allSettled([p1, p2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('CROSS_ROLE_CONFLICT');

      // Verify user has exactly 1 active appointment in the database
      const activeWrd = await client.query(`SELECT * FROM warden_appointments WHERE user_id = 'usr_office' AND appointment_status = 'ACTIVE'`);
      const activeDep = await client.query(`SELECT * FROM deputy_appointments WHERE user_id = 'usr_office' AND appointment_status = 'ACTIVE'`);
      expect(activeWrd.rows.length + activeDep.rows.length).toBe(1);

      await conn1.end();
      await conn2.end();
    });

    it('simultaneous reviews of the same governance action fail closed: exactly one succeeds', async () => {
      if (!isPgAvailable || !client || !govService) return;
      // Submit an action
      const actId = 'act_concurrent_review_test';
      await client.query(`
        INSERT INTO governance_actions (id, action_type, actor_id, building_id, reason, status)
        VALUES ($1, 'TEST_REVIEW', 'usr_warden_bvb', 'bld_bvb', 'Concurrent review test', 'SUBMITTED');
      `, [actId]);

      // Actor: usr_admin (Chief Warden) reviewing simultaneously from two client requests
      const actorAdmin = {
        id: 'usr_admin',
        college_id: 'ADM001',
        role: 'SUPER_ADMIN' as const,
        scope_type: 'SYSTEM' as const,
        scope_id: null,
      };

      const p1 = govService.reviewAction({
        actor: actorAdmin,
        actionId: actId,
        decision: 'APPROVED',
        reviewNotes: 'First review win',
      });

      const p2 = govService.reviewAction({
        actor: actorAdmin,
        actionId: actId,
        decision: 'REJECTED',
        reviewNotes: 'Second review collision',
      });

      const results = await Promise.allSettled([p1, p2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('ACTION_ALREADY_REVIEWED');

      // Final status in PostgreSQL is strictly either APPROVED or REJECTED, never inconsistent
      const finalRes = await client.query(`SELECT status, reviewed_by FROM governance_actions WHERE id = $1`, [actId]);
      expect(['APPROVED', 'REJECTED']).toContain(finalRes.rows[0].status);
      expect(finalRes.rows[0].reviewed_by).toBe('usr_admin');
    });

    it('concurrent Deputy appointment versus Warden revocation race fails closed', async () => {
      if (!isPgAvailable || !client || !govService) return;
      // Setup: Appoint an active Warden on bld_race_test (or fresh building)
      await client.query(`
        INSERT INTO buildings (id, code, name, gender_designation, lifecycle_status)
        VALUES ('bld_race_wrd_rev', 'REVTEST', 'Revocation Race Block', 'COED', 'ACTIVE')
        ON CONFLICT (id) DO NOTHING;
      `);

      // Ensure dedicated test identity for race testing so canonical ADM002/ADM003 remain untouched
      await client.query(`
        INSERT INTO users (id, college_id, email, full_name, password_hash)
        VALUES ('usr_race_warden_fixture', 'RACE-WRD-01', 'racewarden@college.edu', 'Race Warden Fixture', 'mockhash')
        ON CONFLICT (id) DO NOTHING;
      `);

      const raceWrdApptId = await govService.appointWarden({
        userId: 'usr_race_warden_fixture',
        buildingId: 'bld_race_wrd_rev',
        appointedBy: 'usr_admin',
        reason: 'Race test warden appointment',
      });

      // Target candidate for Deputy: usr_office_2 (OFF002)
      // Transaction A attempts to revoke the supervisor Warden (which locks warden_appointments row FOR UPDATE)
      // Transaction B concurrently attempts to appoint OFF002 referencing that supervisor (which locks supervisor row FOR UPDATE)
      const pRevoke = govService.revokeWarden({
        appointmentId: raceWrdApptId,
        revokedBy: 'usr_admin',
        reason: 'Concurrent revocation race',
      });

      const pAppointDeputy = govService.appointDeputy({
        userId: 'usr_office_2',
        buildingId: 'bld_race_wrd_rev',
        supervisorWardenApptId: raceWrdApptId,
        appointedBy: 'usr_admin',
        reason: 'Concurrent deputy appointment race',
      });

      const results = await Promise.allSettled([pRevoke, pAppointDeputy]);
      const revokeResult = results[0];
      const appointResult = results[1];

      // Revocation must succeed
      expect(revokeResult.status).toBe('fulfilled');

      // If deputy appointment ran first, it was cascaded or rejected.
      // If deputy appointment ran second, it failed with SUPERVISOR_INACTIVE because the locked supervisor was already REVOKED.
      // Under NO circumstances can OFF002 end up ACTIVE under a REVOKED supervisor!
      const activeDep = await client.query(
        `SELECT * FROM deputy_appointments WHERE user_id = 'usr_office_2' AND appointment_status = 'ACTIVE'`
      );
      expect(activeDep.rows.length).toBe(0);

      // Verify supervisor Warden is REVOKED
      const wrdStatus = await client.query(
        `SELECT appointment_status FROM warden_appointments WHERE id = $1`,
        [raceWrdApptId]
      );
      expect(wrdStatus.rows[0].appointment_status).toBe('REVOKED');
    });
  });
});
