import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getPool, closePool } from './pool.js';

// Minimal forward-only SQL migration runner.
//
// Migrations are plain `.sql` files in ./migrations, applied in filename order
// (zero-padded numeric prefix). Each file runs inside a transaction and is
// recorded in `schema_migrations`; already-applied files are skipped. No
// down-migrations in v1 — rolling back means writing a new forward migration.
//
// Deliberately dependency-free (no node-pg-migrate/Drizzle) to stay lean per
// the repo conventions; revisit if/when we need an ORM or programmatic DDL.

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

async function ensureMigrationsTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(): Promise<Set<string>> {
  const { rows } = await getPool().query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  );
  return new Set(rows.map((r) => r.filename));
}

export async function migrate(): Promise<string[]> {
  await ensureMigrationsTable();
  const applied = await appliedMigrations();

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file],
      );
      await client.query('COMMIT');
      ran.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration failed: ${file}\n${String(err)}`);
    } finally {
      client.release();
    }
  }

  return ran;
}

// Allow `npm run migrate` (tsx src/db/migrate.ts) to run this directly.
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  migrate()
    .then((ran) => {
      if (ran.length === 0) {
        console.log('No pending migrations.');
      } else {
        console.log(`Applied ${ran.length} migration(s):`);
        for (const f of ran) console.log(`  - ${f}`);
      }
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
