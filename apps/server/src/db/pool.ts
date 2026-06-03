import pg from 'pg';
import { loadConfig } from '../config.js';

// A single shared pg connection pool for the process.
//
// The pool is created lazily on first use: pg does not open a TCP connection
// until a query runs, and `getPool()` itself only constructs the wrapper. This
// keeps DB-free endpoints (e.g. GET /healthz) working even when Postgres is
// unreachable, and avoids a hard DB dependency at module-import time.

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const { databaseUrl } = loadConfig();
    pool = new pg.Pool({ connectionString: databaseUrl });
  }
  return pool;
}

// Thin query helper so call sites don't reach for the pool directly.
export function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: ReadonlyArray<unknown>,
): Promise<pg.QueryResult<R>> {
  return getPool().query<R>(text, params as unknown[] | undefined);
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}
