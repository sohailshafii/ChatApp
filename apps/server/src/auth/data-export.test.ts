import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { query, closePool } from '../db/pool.js';
import { enqueueExport, processPendingExports } from './data-export.js';

// warn is used by sendDataExportEmail when RESEND_API_KEY is unset (the test env).
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;

let accountId: string;

beforeEach(async () => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO accounts (username, email, password_hash, verified)
     VALUES ('exporter', 'exporter@example.com', 'x', true) RETURNING id`,
  );
  accountId = rows[0]!.id;
});

afterEach(async () => {
  vi.clearAllMocks();
  await query('TRUNCATE accounts RESTART IDENTITY CASCADE'); // cascades to data_exports
});

afterAll(async () => {
  await closePool();
});

describe('data export jobs', () => {
  it('enqueueExport inserts a pending job with no token/content', async () => {
    await enqueueExport(accountId);
    const { rows } = await query<{
      status: string;
      token_hash: string | null;
      content: Buffer | null;
    }>(
      'SELECT status, token_hash, content FROM data_exports WHERE account_id = $1',
      [accountId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', token_hash: null, content: null });
  });

  it('processPendingExports turns a pending job into a ready archive', async () => {
    await enqueueExport(accountId);

    expect(await processPendingExports(log)).toBe(1);

    const { rows } = await query<{
      status: string;
      token_hash: string | null;
      content: Buffer | null;
      expires_at: Date | null;
    }>(
      'SELECT status, token_hash, content, expires_at FROM data_exports WHERE account_id = $1',
      [accountId],
    );
    expect(rows[0]!.status).toBe('ready');
    expect(rows[0]!.token_hash).not.toBeNull();
    expect(rows[0]!.content).not.toBeNull();
    expect(rows[0]!.expires_at).not.toBeNull();

    // Nothing left to process on the next pass.
    expect(await processPendingExports(log)).toBe(0);
  });

  it('processes only up to batchSize per pass', async () => {
    await enqueueExport(accountId);
    await enqueueExport(accountId);
    await enqueueExport(accountId);

    expect(await processPendingExports(log, 2)).toBe(2);
    const { rows } = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM data_exports WHERE status = 'pending' AND account_id = $1",
      [accountId],
    );
    expect(rows[0]!.n).toBe(1); // one still pending
  });
});
