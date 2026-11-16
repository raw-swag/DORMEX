import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import crypto from 'crypto';
import { PostgresDatabaseService } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { GovernanceService } from '../src/auth/governanceService.js';
import { IdentityRetirementService } from '../src/auth/identityRetirementService.js';
import { DistributedRateLimiter } from '../src/auth/rateLimiter.js';
import { hashPasswordAsync } from '../src/auth/passwordUtils.js';

describe('DORMEX Stage 7: Real PostgreSQL 18 Multi-Connection Concurrency Release Gate Suite', () => {
  // Respect staging database connection string without hardcoding production secrets
  const STAGING_PG_URL = process.env.STAGING_PG_TEST_URL || process.env.ISOLATED_PG_TEST_URL;
  let clientMaster: Client | null = null;
  let db: PostgresDatabaseService | null = null;
  let govService: GovernanceService | null = null;
  let retirementService: IdentityRetirementService | null = null;
  let rateLimiter: DistributedRateLimiter | null = null;
  let isStagingAvailable = false;

  beforeAll(async () => {
    if (!STAGING_PG_URL) {
      console.log('NOTICE: Neither STAGING_PG_TEST_URL nor ISOLATED_PG_TEST_URL is set.');
      console.log('Skipping real multi-connection PostgreSQL 18 concurrency tests in default unconfigured mode.');
      isStagingAvailable = false;
      return;
    }

    try {
      // Safety Pre-Flight: Explicitly forbid production hosts and production database names
      const url = new URL(STAGING_PG_URL);
      const isKnownProdHost = url.hostname.includes('dpg-dbnjeqrl550s73fcr1lg-a') ||
                              url.hostname.includes('oregon-postgres.render.com') && !url.hostname.includes('staging');
      const isProdDbName = url.pathname === '/dormex_db' || url.pathname === '/dormex';
      const isExplicitStagingName = url.pathname.includes('staging') || url.hostname.includes('staging');

      if (isKnownProdHost || isProdDbName || !isExplicitStagingName) {
        // Strict guard against accidental production targeting
        console.error('FATAL SAFETY GUARD: Connection string targets production or non-staging database! Aborting.');
        console.error(`Target Host: ${url.hostname}, Database Name: ${url.pathname}`);
        isStagingAvailable = false;
        return;
      }

      const probeClient = new Client({ connectionString: STAGING_PG_URL, connectionTimeoutMillis: 3000 });
      await probeClient.connect();
      clientMaster = probeClient;

      // Verify PostgreSQL major version
      const verRes = await clientMaster.query('SELECT version();');
      console.log(`Verified Staging PostgreSQL: ${verRes.rows[0].version}`);

      db = new PostgresDatabaseService(STAGING_PG_URL);
      govService = new GovernanceService(db);
      retirementService = new IdentityRetirementService(db);
      rateLimiter = new DistributedRateLimiter(db);

      // Initialize base schema on staging
      await runMigrations(db);
      isStagingAvailable = true;
    } catch (err: any) {
      console.log(`NOTICE: Staging PostgreSQL connection probe failed (${err.message}). Skipping.`);
      isStagingAvailable = false;
    }
  }, 30000);

  afterAll(async () => {
    if (clientMaster) await clientMaster.end().catch(() => {});
    if (db) await db.close().catch(() => {});
  });

  describe('1. Simultaneous Identity Retirement Race Serialization', () => {
    it('serializes simultaneous retirement attempts on separate connections: exactly one executes, second succeeds idempotently', async () => {
      if (!isStagingAvailable || !STAGING_PG_URL) return;

      const tempId = `usr_conc_ret_${Date.now()}`;
      const tempCollegeId = `CONC_RET_${Math.floor(Math.random() * 10000)}`;

      await clientMaster!.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active, session_version)
         VALUES ($1, $2, $3, 'Concurrent Retirement Test', 'dummy_hash', TRUE, 1)`,
        [tempId, tempCollegeId, `${tempCollegeId.toLowerCase()}@test.edu`]
      );

      // Open two distinct physical database connections
      const dbConn1 = new PostgresDatabaseService(STAGING_PG_URL);
      const dbConn2 = new PostgresDatabaseService(STAGING_PG_URL);

      const service1 = new IdentityRetirementService(dbConn1);
      const service2 = new IdentityRetirementService(dbConn2);

      // Fire simultaneous retirement requests across separate connections
      const [r1, r2] = await Promise.all([
        service1.retireIdentity(tempId, 'usr_admin', { dryRun: false }),
        service2.retireIdentity(tempId, 'usr_admin', { dryRun: false }),
      ]);

      await dbConn1.close();
      await dbConn2.close();

      // Both must report success, but actions must be partitioned into RETIRED and ALREADY_RETIRED
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);

      const actions = [r1.actionTaken, r2.actionTaken];
      expect(actions).toContain('RETIRED');
      expect(actions).toContain('ALREADY_RETIRED');

      // Verify user row state
      const userRes = await clientMaster!.query(`SELECT is_active, password_hash, session_version FROM users WHERE id = $1`, [tempId]);
      expect(userRes.rows[0].is_active).toBe(false);
      expect(userRes.rows[0].password_hash).toMatch(/^RETIRED_/);
      expect(userRes.rows[0].session_version).toBe(2);
    });
  });

  describe('2. Identity Retirement versus Governance Transfer Race', () => {
    it('blocks retirement if candidate is atomically promoted to Chief Warden concurrently', async () => {
      if (!isStagingAvailable || !STAGING_PG_URL || !govService || !retirementService) return;

      const candidateId = `usr_cw_cand_${Date.now()}`;
      await clientMaster!.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active, session_version)
         VALUES ($1, 'CW_CAND_01', 'cwcand@college.edu', 'CW Candidate', 'hash', TRUE, 1)`,
        [candidateId]
      );

      // Concurrently attempt Chief Warden transfer AND retirement of candidate
      const pTransfer = govService.transferChiefWarden({
        newChiefWardenUserId: candidateId,
        transferredBy: 'usr_admin',
        reason: 'Concurrent race governance test',
      });

      const pRetire = retirementService.retireIdentity(candidateId, 'usr_admin', { dryRun: false });

      const results = await Promise.allSettled([pTransfer, pRetire]);
      const transferRes = results[0];
      const retireRes = results[1];

      // If transfer succeeded, retirement must fail closed with BLOCKED due to singleton gate
      if (transferRes.status === 'fulfilled') {
        if (retireRes.status === 'fulfilled') {
          // If retire evaluated after transfer, it must be BLOCKED
          expect(retireRes.value.success).toBe(false);
          expect(retireRes.value.actionTaken).toBe('BLOCKED');
        }
      }
    });
  });

  describe('3. Concurrent MFA Recovery-Code Consumption', () => {
    it('enforces single-use consumption across concurrent connections: exactly one succeeds', async () => {
      if (!isStagingAvailable || !clientMaster) return;

      const testUserId = `usr_mfa_rec_${Date.now()}`;
      const recoveryCode = '1111-2222-3333';
      const recoveryHash = await hashPasswordAsync(recoveryCode);

      await clientMaster.query(
        `INSERT INTO users (id, college_id, email, full_name, password_hash, is_active, session_version)
         VALUES ($1, 'REC_USER_01', 'recuser@college.edu', 'Recovery Test User', 'hash', TRUE, 1)`,
        [testUserId]
      );

      await clientMaster.query(
        `INSERT INTO user_mfa_settings (user_id, encrypted_secret, secret_iv, secret_tag, recovery_code_hashes, is_enabled)
         VALUES ($1, 'dummy_sec', 'iv', 'tag', ARRAY[$2], TRUE)`,
        [testUserId, recoveryHash]
      );

      // Two concurrent transactions attempting to consume the same code via array_remove
      const consumeSql = `
        UPDATE user_mfa_settings
        SET recovery_code_hashes = array_remove(recovery_code_hashes, $2),
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND $2 = ANY(recovery_code_hashes)
        RETURNING id;
      `;

      const connA = new Client({ connectionString: STAGING_PG_URL });
      const connB = new Client({ connectionString: STAGING_PG_URL });
      await connA.connect();
      await connB.connect();

      const [resA, resB] = await Promise.all([
        connA.query(consumeSql, [testUserId, recoveryHash]),
        connB.query(consumeSql, [testUserId, recoveryHash]),
      ]);

      await connA.end();
      await connB.end();

      const successCount = (resA.rowCount || 0) + (resB.rowCount || 0);
      expect(successCount).toBe(1); // Exactly one consumption wins atomically!
    });
  });

  describe('4. Distributed Multi-Instance Rate Limiting Concurrency', () => {
    it('atomically increments rate limit attempts across separate database connections', async () => {
      if (!isStagingAvailable || !STAGING_PG_URL || !rateLimiter) return;

      const testIp = `192.168.1.${Math.floor(Math.random() * 250)}`;
      const connCount = 5;

      // Spawn 5 independent database clients firing rate limit increments simultaneously
      const clients = Array.from({ length: connCount }, () => new PostgresDatabaseService(STAGING_PG_URL));

      const tasks = clients.map((c) => {
        const lim = new DistributedRateLimiter(c);
        return lim.checkAndIncrement('login', testIp, { maxAttempts: 10, windowSeconds: 60 });
      });

      const results = await Promise.all(tasks);
      for (const c of clients) await c.close();

      // Every attempt must succeed, and final attempt counter must equal connCount
      const allowedCount = results.filter((r) => r.allowed).length;
      expect(allowedCount).toBe(connCount);

      const maxObservedAttempt = Math.max(...results.map((r) => r.attempts));
      expect(maxObservedAttempt).toBe(connCount);
    });
  });
});
