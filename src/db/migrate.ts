import { getDatabaseService } from './index.js';
import { runMigrations } from './schema.js';
import { seedDatabase } from './seed.js';

interface MigrationRecord {
  id: string;
  name: string;
  applied_at: string;
}

const REGISTERED_MIGRATIONS = [
  { id: '20261103_001_core_schema', name: 'Core institutional relational schema & indexes' },
  { id: '20261104_002_terms_and_accord', name: 'Responsibility accord and terms acknowledgement schema' },
  { id: '20261105_003_password_reset_tokens', name: 'Cryptographic SHA-256 single-use password reset tokens' },
  { id: '20261106_004_production_bootstrap', name: 'Official role definitions, initial published terms, and admin bootstrap' },
];

async function ensureMigrationTable(db: any): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
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

    console.log('\n[2/4] Verifying migration tracking table...');
    await ensureMigrationTable(db);

    const appliedRows = await db.query<MigrationRecord>('SELECT id, name, applied_at FROM schema_migrations ORDER BY applied_at ASC;');
    const appliedIds = new Set(appliedRows.rows.map(r => r.id));
    console.log(`Currently applied migrations: ${appliedRows.rows.length}`);

    console.log('\n[3/4] Applying pending idempotent schema migrations...');
    // Apply DDL statements idempotently (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
    await runMigrations(db);

    for (const m of REGISTERED_MIGRATIONS) {
      if (!appliedIds.has(m.id)) {
        await db.query(
          'INSERT INTO schema_migrations (id, name, applied_at) VALUES ($1, $2, CURRENT_TIMESTAMP)',
          [m.id, m.name]
        );
        console.log(`  + Applied and recorded migration: [${m.id}] ${m.name}`);
      } else {
        console.log(`  - Already recorded: [${m.id}] ${m.name}`);
      }
    }

    console.log('\n[4/4] Executing safe bootstrap initialization...');
    if (isProd) {
      console.log('  * Production mode active:');
      console.log('  * - Synthetic student seeding (DEMO-001..DEMO-030) is STRICTLY BLOCKED.');
      console.log('  * - Mock staff accounts with development passwords are SKIPPED.');
      console.log('  * - Default test payments and allocations are SKIPPED.');
      console.log('  * - Master institutional roles and published Terms & Conditions are validated.');
    }
    await seedDatabase(db);

    // Final integrity verification
    const countCheck = await db.query("SELECT COUNT(*) as count FROM users WHERE college_id LIKE 'DEMO-%';");
    const demoCount = parseInt(countCheck.rows[0]?.count || '0', 10);
    if (isProd && demoCount > 0) {
      throw new Error(`CRITICAL_INTEGRITY_VIOLATION: Found ${demoCount} synthetic DEMO users in production database.`);
    }

    console.log('\n====================================================');
    console.log('       MIGRATION RUN COMPLETED SUCCESSFULLY         ');
    console.log(`       Synthetic demo count in database: ${demoCount}`);
    console.log('====================================================');

    await db.close();
    process.exit(0);
  } catch (err) {
    console.error('\nFATAL: Migration failed with error:', err);
    await db.close().catch(() => {});
    process.exit(1);
  }
}

migrate();
