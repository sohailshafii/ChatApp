import pg from 'pg';
import { TEST_DB_NAME, testDbUrl, adminDbUrl } from './test-db.js';

// Vitest globalSetup: provision + migrate the dedicated test database once per
// run (in the main process). Test workers receive DATABASE_URL via the `env`
// option in vitest.config.ts, so buildApp()/getPool() connect to this DB.
export async function setup(): Promise<void> {
  const admin = new pg.Client({ connectionString: adminDbUrl() });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      'Cannot reach Postgres for the integration test database. ' +
        'Start it first with `npm run db:up`.\n' +
        String(err),
    );
  }

  try {
    const { rowCount } = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [TEST_DB_NAME],
    );
    // TEST_DB_NAME is a fixed constant, so interpolation here is safe (identifiers
    // can't be parameterized in CREATE DATABASE).
    if (rowCount === 0) {
      await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
    }
  } finally {
    await admin.end();
  }

  // Apply migrations against the test DB. migrate() reads DATABASE_URL via config,
  // so point it at the test DB before importing the DB modules.
  process.env.DATABASE_URL = testDbUrl();
  const { migrate } = await import('../db/migrate.js');
  const { closePool } = await import('../db/pool.js');
  await migrate();
  await closePool();
}
