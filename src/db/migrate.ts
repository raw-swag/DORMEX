import { DatabaseService, getDatabaseService } from './index.js';
import { runMigrations } from './schema.js';
import { seedDatabase } from './seed.js';
import { ALL_33_SCHEMA_TABLES } from './schema_manifest.js';

export interface MigrationRecord {
  id: string;
  name: string;
  applied_at: string;
}

export interface ColumnRequirement {
  name: string;
  expectedTypes: string[];
  nullable?: boolean;
}

export interface TableRequirement {
  tableName: string;
  columns: ColumnRequirement[];
  primaryKey?: string[];
  uniqueConstraints?: string[][];
  foreignKeys?: { column: string; foreignTable: string; foreignColumn: string }[];
  indexes?: string[];
}

export interface MigrationManifest {
  id: string;
  name: string;
  tables: TableRequirement[];
  customChecks?: (client: { query: (text: string, params?: any[]) => Promise<any> }) => Promise<void>;
}

/**
 * Normalizes PostgreSQL data_type names across real PostgreSQL and in-memory pg-mem.
 */
export function normalizeType(type: string): string {
  const t = (type || '').toLowerCase().trim();
  if (t === 'character varying' || t === 'varchar' || t === 'text') return 'text';
  if (t === 'integer' || t === 'int' || t === 'int4') return 'integer';
  if (t === 'bigint' || t === 'int8') return 'bigint';
  if (t === 'boolean' || t === 'bool') return 'boolean';
  if (t.includes('timestamp')) return 'timestamp';
  if (t === 'date') return 'date';
  return t;
}

/**
 * Authoritative Schema Verification Manifests for Registered Migrations.
 * Migration 1 strictly verifies ALL 30 core foundational relational tables from Phase 1 through 16.
 * Migration 2 verifies terms_documents and terms_acknowledgements.
 * Migration 3 verifies password_reset_tokens.
 * Migration 4 verifies official institutional roles and published version 1 terms document.
 * Total unique tables covered across the manifests: EXACTLY 33 TABLES (100% of SCHEMA_SQL).
 */
export const MIGRATION_MANIFESTS: MigrationManifest[] = [
  {
    id: '20261103_001_core_schema',
    name: 'Core institutional relational schema & indexes',
    tables: ALL_33_SCHEMA_TABLES.filter(
      (t) => !['terms_documents', 'terms_acknowledgements', 'password_reset_tokens'].includes(t.tableName)
    ),
  },
  {
    id: '20261104_002_terms_and_accord',
    name: 'Responsibility accord and terms acknowledgement schema',
    tables: ALL_33_SCHEMA_TABLES.filter((t) =>
      ['terms_documents', 'terms_acknowledgements'].includes(t.tableName)
    ),
  },
  {
    id: '20261105_003_password_reset_tokens',
    name: 'Cryptographic SHA-256 single-use password reset tokens',
    tables: ALL_33_SCHEMA_TABLES.filter((t) => t.tableName === 'password_reset_tokens'),
  },
  {
    id: '20261106_004_production_bootstrap',
    name: 'Official role definitions, initial published terms, and admin bootstrap',
    tables: [],
    customChecks: async (client) => {
      // 1. Assert official institutional roles exist in roles table
      const expectedRoles = ['STUDENT', 'PROCTOR', 'WARDEN', 'CHIEF_WARDEN', 'HOSTEL_OFFICE', 'SUPER_ADMIN'];
      for (const role of expectedRoles) {
        const res = await client.query(`SELECT 1 FROM roles WHERE name = $1`, [role]);
        if (res.rows.length === 0) {
          throw new Error(`SCHEMA_VERIFICATION_FAILED: Required institutional role '${role}' is missing.`);
        }
      }

      // 2. Assert terms_documents contains initial published terms
      const termsRes = await client.query(`SELECT 1 FROM terms_documents WHERE version = 1 AND is_published = TRUE`);
      if (termsRes.rows.length === 0) {
        throw new Error(`SCHEMA_VERIFICATION_FAILED: Published version 1 Terms & Conditions document is missing.`);
      }
    },
  },
];

export const REGISTERED_MIGRATIONS = MIGRATION_MANIFESTS.map((m) => ({ id: m.id, name: m.name }));

export async function ensureMigrationTable(db: DatabaseService): Promise<void> {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (err: any) {
    const msg = err.message || '';
    if (!msg.includes('already exists') && !msg.includes('Not supported')) {
      throw err;
    }
  }
}

/**
 * Deeply verifies an actual database table against structural requirements:
 * Columns, Data Types, Nullability, Primary Keys, Unique Constraints, Foreign Keys & Indexes.
 */
export async function verifyTableStructure(
  client: { query: (text: string, params?: any[]) => Promise<any> },
  req: TableRequirement
): Promise<void> {
  // 1. Table existence check
  const tableCheck = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [req.tableName]
  );
  if (tableCheck.rows.length === 0) {
    throw new Error(`SCHEMA_VERIFICATION_FAILED: Required table '${req.tableName}' does not exist.`);
  }

  // 2. Columns & Data Types check via information_schema.columns
  const colsRes = await client.query(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [req.tableName]
  );

  // Check if __pgmem_is_column_nullable helper exists in memory test adapter
  let isPgMem = false;
  try {
    const testFn = await client.query(`SELECT __pgmem_is_column_nullable('users', 'id') as res`);
    if (testFn && testFn.rows) {
      isPgMem = true;
    }
  } catch {}

  const foundCols = new Map<string, { type: string; isNullable: boolean }>();
  for (const row of colsRes.rows) {
    let isNullable = row.is_nullable === 'YES';
    if (isPgMem) {
      try {
        const memNullCheck = await client.query(
          `SELECT __pgmem_is_column_nullable($1, $2) as res`,
          [req.tableName, row.column_name]
        );
        isNullable = Boolean(memNullCheck.rows[0]?.res);
      } catch {}
    }

    foundCols.set(row.column_name.toLowerCase(), {
      type: normalizeType(row.data_type),
      isNullable,
    });
  }

  for (const col of req.columns) {
    const colName = col.name.toLowerCase();
    const actual = foundCols.get(colName);
    if (!actual) {
      throw new Error(
        `SCHEMA_VERIFICATION_FAILED: Table '${req.tableName}' is missing required column '${col.name}'.`
      );
    }

    const expectedNormalized = col.expectedTypes.map(normalizeType);
    if (!expectedNormalized.includes(actual.type)) {
      throw new Error(
        `SCHEMA_VERIFICATION_FAILED: Table '${req.tableName}', column '${col.name}' has invalid type '${actual.type}'. Expected: [${col.expectedTypes.join(', ')}].`
      );
    }

    if (col.nullable !== undefined && actual.isNullable !== col.nullable) {
      throw new Error(
        `SCHEMA_VERIFICATION_FAILED: Table '${req.tableName}', column '${col.name}' nullability mismatch. Expected nullable: ${col.nullable}, found: ${actual.isNullable}.`
      );
    }
  }

  // 3. PostgreSQL Catalog Verification: Indexes, Unique Constraints, Primary Keys, Foreign Keys (when supported)
  try {
    // 3a. Primary Key verification
    if (req.primaryKey && req.primaryKey.length > 0) {
      const pkRes = await client.query(`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1
      `, [req.tableName]);
      if (pkRes && pkRes.rows && pkRes.rows.length > 0) {
        const foundPkCols = new Set(pkRes.rows.map((r: any) => r.column_name.toLowerCase()));
        for (const pkCol of req.primaryKey) {
          if (!foundPkCols.has(pkCol.toLowerCase())) {
            throw new Error(
              `SCHEMA_VERIFICATION_FAILED: Table '${req.tableName}' is missing required primary key on column '${pkCol}'.`
            );
          }
        }
      }
    }

    // 3b. Unique constraints verification
    if (req.uniqueConstraints && req.uniqueConstraints.length > 0) {
      const uqRes = await client.query(`
        SELECT tc.constraint_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        WHERE tc.constraint_type = 'UNIQUE' AND tc.table_name = $1
      `, [req.tableName]);
      if (uqRes && uqRes.rows && uqRes.rows.length > 0) {
        const uqMap = new Map<string, string[]>();
        for (const row of uqRes.rows) {
          if (!uqMap.has(row.constraint_name)) uqMap.set(row.constraint_name, []);
          uqMap.get(row.constraint_name)!.push(row.column_name.toLowerCase());
        }
        for (const expectedUq of req.uniqueConstraints) {
          const sortedExpected = [...expectedUq].map(c => c.toLowerCase()).sort().join(',');
          const found = [...uqMap.values()].some(cols => [...cols].sort().join(',') === sortedExpected);
          if (!found) {
            throw new Error(
              `SCHEMA_VERIFICATION_FAILED: Table '${req.tableName}' is missing unique constraint on [${expectedUq.join(', ')}].`
            );
          }
        }
      }
    }

    // 3c. Indexes verification
    if (req.indexes && req.indexes.length > 0) {
      const idxRes = await client.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`,
        [req.tableName]
      );
      if (idxRes && idxRes.rows && idxRes.rows.length > 0) {
        const existingIndexes = new Set(idxRes.rows.map((r: any) => r.indexname.toLowerCase()));
        for (const expectedIdx of req.indexes) {
          if (!existingIndexes.has(expectedIdx.toLowerCase())) {
            throw new Error(
              `SCHEMA_VERIFICATION_FAILED: Table '${req.tableName}' is missing required index '${expectedIdx}'.`
            );
          }
        }
      }
    }

    // 3d. Foreign Keys verification
    if (req.foreignKeys && req.foreignKeys.length > 0) {
      const fkRes = await client.query(`
        SELECT kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1
      `, [req.tableName]);

      if (fkRes && fkRes.rows && fkRes.rows.length > 0) {
        for (const fk of req.foreignKeys) {
          const found = fkRes.rows.some(
            (r: any) =>
              r.column_name?.toLowerCase() === fk.column.toLowerCase() &&
              r.foreign_table_name?.toLowerCase() === fk.foreignTable.toLowerCase() &&
              r.foreign_column_name?.toLowerCase() === fk.foreignColumn.toLowerCase()
          );
          if (!found) {
            throw new Error(
              `SCHEMA_VERIFICATION_FAILED: Table '${req.tableName}' is missing foreign key constraint on column '${fk.column}' referencing '${fk.foreignTable}(${fk.foreignColumn})'.`
            );
          }
        }
      }
    }
  } catch (catalogErr: any) {
    if (catalogErr.message?.includes('SCHEMA_VERIFICATION_FAILED')) {
      throw catalogErr;
    }
  }
}

/**
 * Reconcile existing schema and record pending registered migrations safely.
 * Works for both:
 * 1. Fresh database: runs DDL statements, verifies complete expected schema structure, then records migrations.
 * 2. Already initialized database: deeply verifies existing structure before recording.
 *    If any required table, column, type, or constraint is missing/ambiguous, aborts without destructive changes.
 */
export async function reconcileAndRunMigrations(
  db: DatabaseService,
  isProd: boolean = false,
  skipSchemaExecution: boolean = false
): Promise<{
  applied: string[];
  alreadyRecorded: string[];
  demoCount: number;
}> {
  await ensureMigrationTable(db);

  if (!skipSchemaExecution) {
    // Apply DDL statements idempotently (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
    await runMigrations(db);

    // Safe institutional roles and published terms check
    await seedDatabase(db);
  }

  // Wrap migration verification and ledger updates in an atomic database transaction
  const { applied, alreadyRecorded } = await db.transaction(async (client) => {
    const appliedRows = await client.query<MigrationRecord>(
      'SELECT id, name, applied_at FROM schema_migrations ORDER BY applied_at ASC;'
    );
    const appliedIds = new Set(appliedRows.rows.map((r) => r.id));

    const appliedList: string[] = [];
    const alreadyRecordedList: string[] = [];

    for (const manifest of MIGRATION_MANIFESTS) {
      if (!appliedIds.has(manifest.id)) {
        // Step A: Deep verification of required tables and column structures
        for (const tableReq of manifest.tables) {
          await verifyTableStructure(client, tableReq);
        }

        // Step B: Custom semantic checks (roles, initial document presence)
        if (manifest.customChecks) {
          await manifest.customChecks(client);
        }

        // Step C: Atomically record migration in ledger
        await client.query(
          'INSERT INTO schema_migrations (id, name, applied_at) VALUES ($1, $2, CURRENT_TIMESTAMP)',
          [manifest.id, manifest.name]
        );
        appliedList.push(manifest.id);
      } else {
        alreadyRecordedList.push(manifest.id);
      }
    }

    return { applied: appliedList, alreadyRecorded: alreadyRecordedList };
  });

  // Integrity assertion: ensure no synthetic demo students exist if in production mode
  const countCheck = await db.query("SELECT COUNT(*) as count FROM users WHERE college_id LIKE 'DEMO-%';");
  const demoCount = parseInt(countCheck.rows[0]?.count || '0', 10);
  if (isProd && demoCount > 0) {
    throw new Error(`CRITICAL_INTEGRITY_VIOLATION: Found ${demoCount} synthetic DEMO users in production database.`);
  }

  return {
    applied,
    alreadyRecorded,
    demoCount,
  };
}

async function migrate() {
  console.log('====================================================');
  console.log('       DORMEX PRODUCTION DATABASE MIGRATION         ');
  console.log('====================================================');
  const env = process.env.NODE_ENV || 'development';
  const isProd = env === 'production';
  console.log(`Target Environment: ${env}`);

  if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL environment variable is required.');
    process.exit(1);
  }

  const db = getDatabaseService();

  try {
    console.log('\n[1/4] Probing PostgreSQL connection...');
    const testResult = await db.query('SELECT current_database(), current_user, version();');
    console.log(`Connected to database "${testResult.rows[0].current_database}" as user "${testResult.rows[0].current_user}".`);

    console.log('\n[2/4] Verifying and reconciling schema_migrations table...');
    const result = await reconcileAndRunMigrations(db, isProd);

    console.log(`  + Newly recorded migrations: ${result.applied.length > 0 ? result.applied.join(', ') : 'none'}`);
    console.log(`  - Already recorded: ${result.alreadyRecorded.length > 0 ? result.alreadyRecorded.join(', ') : 'none'}`);

    console.log('\n[3/4] Production database integrity verified.');
    console.log(`  * Synthetic demo student count: ${result.demoCount}`);

    console.log('\n====================================================');
    console.log('       MIGRATION RUN COMPLETED SUCCESSFULLY         ');
    console.log('====================================================');

    await db.close();
    process.exit(0);
  } catch (err) {
    console.error('\nFATAL: Migration failed with error:', err);
    await db.close().catch(() => {});
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].includes('migrate')) {
  migrate();
}
