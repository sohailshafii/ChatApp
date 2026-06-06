import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { query, closePool } from '../db/pool.js';
import { sweepExpiredDataExports } from './data-export.js';
import { sweepOldAuditEvents } from './audit.js';
import { startRetentionSweeper } from './retention.js';

const log = { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;

afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  // cascades to data_exports + auth_audit_log
  await query('TRUNCATE accounts RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await closePool();
});

describe('startRetentionSweeper', () => {
  it('runs every task immediately and on each interval, until stopped', async () => {
    vi.useFakeTimers();
    const a = vi.fn().mockResolvedValue(0);
    const b = vi.fn().mockResolvedValue(0);
    const stop = startRetentionSweeper(log, {
      intervalMs: 1000,
      tasks: [
        { name: 'a', sweep: a },
        { name: 'b', sweep: b },
      ],
    });

    await vi.waitFor(() => expect(a).toHaveBeenCalledTimes(1));
    expect(b).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(a).toHaveBeenCalledTimes(2);
  });

  it('isolates a failing task, keeps the rest, and logs only nonzero sweeps', async () => {
    vi.useFakeTimers();
    const boom = vi.fn().mockRejectedValue(new Error('db down'));
    const ok = vi.fn().mockResolvedValue(3);
    const stop = startRetentionSweeper(log, {
      intervalMs: 1000,
      tasks: [
        { name: 'boom', sweep: boom },
        { name: 'ok', sweep: ok },
      ],
    });

    await vi.waitFor(() => expect(ok).toHaveBeenCalledTimes(1));
    expect(log.error).toHaveBeenCalledTimes(1); // boom logged, didn't stop ok
    expect(log.info).toHaveBeenCalledWith(
      { deleted: 3, table: 'ok' },
      'retention sweep',
    );
    stop();
  });
});

describe('retention sweeps (DB)', () => {
  async function anAccount(): Promise<string> {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO accounts (username, email, password_hash, verified)
       VALUES ('retain', 'retain@example.com', 'x', true) RETURNING id`,
    );
    return rows[0]!.id;
  }

  it('sweepExpiredDataExports deletes past-expiry rows, keeps live ones', async () => {
    const acct = await anAccount();
    const ins = (token: string, when: string) =>
      query(
        `INSERT INTO data_exports (token_hash, account_id, content, filename, expires_at)
         VALUES ($1, $2, $3, 'e.json', now() + ($4 || ' hours')::interval)`,
        [token, acct, Buffer.from('archive'), when],
      );
    await ins('dead', '-1'); // expired an hour ago
    await ins('live', '1'); // expires in an hour

    expect(await sweepExpiredDataExports()).toBe(1);
    const { rows } = await query<{ token_hash: string }>(
      'SELECT token_hash FROM data_exports',
    );
    expect(rows).toEqual([{ token_hash: 'live' }]);
  });

  it('sweepOldAuditEvents deletes rows past the retention window', async () => {
    await query(
      `INSERT INTO auth_audit_log (event, created_at)
       VALUES ('login', now() - interval '200 days'), ('login', now())`,
    );
    expect(await sweepOldAuditEvents(180)).toBe(1);
    const { rows } = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM auth_audit_log',
    );
    expect(rows[0]!.n).toBe(1);
  });
});
