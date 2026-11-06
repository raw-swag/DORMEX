import { getDatabaseService } from './index.js';
import { runMigrations } from './schema.js';
import { seedDatabase } from './seed.js';

async function migrate() {
  console.log('--- DORMEX Database Migration Runner ---');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL environment variable is required to run migrations.');
    process.exit(1);
  }

  const db = getDatabaseService();

  try {
    console.log('1. Testing PostgreSQL database connection...');
    const testResult = await db.query('SELECT current_database(), current_user, version();');
    console.log(`Connected to database "${testResult.rows[0].current_database}" as user "${testResult.rows[0].current_user}".`);

    console.log('2. Applying schema migrations...');
    await runMigrations(db);
    console.log('Schema migrations applied successfully.');

    console.log('3. Running database bootstrap initialization...');
    await seedDatabase(db);
    console.log('Bootstrap initialization completed successfully.');

    await db.close();
    console.log('Migration process completed cleanly.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    await db.close().catch(() => {});
    process.exit(1);
  }
}

migrate();
