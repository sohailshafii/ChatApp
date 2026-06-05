import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { query, closePool } from '../db/pool.js';
import { recordAuthEvent } from './audit.js';

const log = { error: vi.fn() } as unknown as FastifyBaseLogger;

let accountId: string;

beforeEach(async () => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO accounts (username, email, password_hash, verified)
     VALUES ('audituser', 'audit@example.com', 'x', true) RETURNING id`,
  );
  accountId = rows[0]!.id;
});

afterEach(async () => {
  vi.clearAllMocks();
  await query('TRUNCATE accounts RESTART IDENTITY CASCADE'); // cascades to auth_audit_log
});

afterAll(async () => {
  await closePool();
});

describe('recordAuthEvent', () => {
  it('inserts a row with the event, account, and ip', async () => {
    await recordAuthEvent(log, 'login', { accountId, ip: '203.0.113.7' });
    const { rows } = await query<{ event: string; account_id: string; ip: string }>(
      'SELECT event, account_id, host(ip) AS ip FROM auth_audit_log',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: 'login',
      account_id: accountId,
      ip: '203.0.113.7',
    });
  });

  it('accepts a null account (unknown-identifier failure)', async () => {
    await recordAuthEvent(log, 'login_failure', { ip: '203.0.113.8' });
    const { rows } = await query<{ account_id: string | null }>(
      'SELECT account_id FROM auth_audit_log',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.account_id).toBeNull();
  });

  it('outlives the account (ON DELETE SET NULL)', async () => {
    await recordAuthEvent(log, 'login', { accountId });
    await query('DELETE FROM accounts WHERE id = $1', [accountId]);
    const { rows } = await query<{ event: string; account_id: string | null }>(
      'SELECT event, account_id FROM auth_audit_log',
    );
    expect(rows).toHaveLength(1); // row survives the account deletion
    expect(rows[0]!.event).toBe('login');
    expect(rows[0]!.account_id).toBeNull();
  });

  it('never throws on a bad insert (best-effort)', async () => {
    // 'x'.repeat won't break it; force an error with a too-long inet instead.
    await expect(
      recordAuthEvent(log, 'login', { accountId, ip: 'not-an-ip' }),
    ).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledOnce();
  });
});
