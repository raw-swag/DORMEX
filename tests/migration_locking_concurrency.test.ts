import { describe, it, expect } from 'vitest';
import { getDatabaseService } from '../src/db/index.js';
import { runMigrations } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';
import { withMigrationLock, DORMEX_MIGRATION_LOCK_ID, reconcileAndRunMigrations } from '../src/db/migrate.js';

describe('DORMEX Migration Serialization & Advisory Locking Concurrency Suite', () => {
  it('defines a valid 64-bit integer constant for PostgreSQL advisory lock', () => {
    expect(DORMEX_MIGRATION_LOCK_ID).toBe('4922243409568615753');
    const b = BigInt(DORMEX_MIGRATION_LOCK_ID);
    expect(b > 0n).toBe(true);
    // Verify exact hexadecimal representation matches ASCII 'DORMEXMI'
    expect(b.toString(16)).toBe('444f524d45584d49');
    expect(Buffer.from(b.toString(16), 'hex').toString('ascii')).toBe('DORMEXMI');
    // Verify fits within signed 64-bit range
    expect(b <= 9223372036854775807n).toBe(true);
  });

  it('serializes multiple concurrent startup executions via withMigrationLock without conflict', async () => {
    const db = getDatabaseService(true);

    let concurrentPeak = 0;
    let currentlyRunning = 0;
    const executionLogs: string[] = [];

    // Simulate 4 concurrent workers attempting to execute migrations simultaneously
    const tasks = Array.from({ length: 4 }).map(async (_, index) => {
      return withMigrationLock(db, async () => {
        currentlyRunning += 1;
        if (currentlyRunning > concurrentPeak) {
          concurrentPeak = currentlyRunning;
        }
        executionLogs.push(`worker_${index}_start`);

        await runMigrations(db);
        await seedDatabase(db);

        // Small simulated work window
        await new Promise((r) => setTimeout(r, 20));

        executionLogs.push(`worker_${index}_end`);
        currentlyRunning -= 1;
        return `worker_${index}_success`;
      });
    });

    const results = await Promise.all(tasks);

    expect(results).toHaveLength(4);
    for (const res of results) {
      expect(res).toContain('_success');
    }

    // Verify database state is intact and clean
    const rolesRes = await db.query('SELECT count(*) as count FROM roles');
    expect(parseInt(rolesRes.rows[0].count, 10)).toBeGreaterThanOrEqual(7);

    const slotsRes = await db.query('SELECT count(*) as count FROM device_registration_slots');
    expect(parseInt(slotsRes.rows[0].count, 10)).toBe(3);
  });

  it('safely releases the advisory lock when a migration operation encounters an error', async () => {
    const db = getDatabaseService(true);

    // 1. A failed run throws inside withMigrationLock
    await expect(
      withMigrationLock(db, async () => {
        throw new Error('SIMULATED_MIGRATION_FAILURE');
      })
    ).rejects.toThrow('SIMULATED_MIGRATION_FAILURE');

    // 2. Subsequent run immediately acquires the lock and succeeds without hanging
    const nextResult = await withMigrationLock(db, async () => {
      const res = await db.query('SELECT 1 as alive');
      return res.rows[0].alive;
    });

    expect(nextResult).toBe(1);
  });

  it('destroys the connection and does not return it to pool if unlock query fails', async () => {
    let releasedWithDestroy = false;
    const mockClient = {
      query: async (text: string) => {
        if (text.includes('pg_advisory_lock')) return { rows: [] };
        if (text.includes('pg_advisory_unlock')) throw new Error('SIMULATED_UNLOCK_QUERY_FAILURE');
        return { rows: [] };
      },
      release: (destroy?: boolean) => {
        if (destroy) releasedWithDestroy = true;
      },
    };

    const mockDb: any = {
      getClient: async () => mockClient,
    };

    await expect(
      withMigrationLock(mockDb, async () => {
        return 'success_work';
      })
    ).rejects.toThrow('SIMULATED_UNLOCK_QUERY_FAILURE');

    expect(releasedWithDestroy).toBe(true);
  });

  it('executes reconcileAndRunMigrations idempotently and records ledger accurately', async () => {
    const db = getDatabaseService(true);

    // First execution applies and records migrations
    const res1 = await reconcileAndRunMigrations(db, false);
    expect(res1.applied.length + res1.alreadyRecorded.length).toBeGreaterThan(0);

    // Immediate second execution detects all manifests already recorded and applies 0 new ones
    const res2 = await reconcileAndRunMigrations(db, false);
    expect(res2.applied).toHaveLength(0);
    expect(res2.alreadyRecorded.length).toBeGreaterThan(0);
  });
});
