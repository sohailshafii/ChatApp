import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query, closePool } from '../db/pool.js';
import { createSession, sweepExpiredSessions } from './sessions.js';

let accountId: string;

beforeEach(async () => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO accounts (username, email, password_hash, verified)
     VALUES ('sweepuser', 'sweep@example.com', 'x', true) RETURNING id`,
  );
  accountId = rows[0]!.id;
});

afterEach(async () => {
  await query('TRUNCATE accounts RESTART IDENTITY CASCADE'); // cascades to sessions
});

afterAll(async () => {
  await closePool();
});

// Ages every existing session for the account to N days ago (createSession only
// returns the raw token, so we age by account rather than by a specific row).
async function ageSessions(days: number): Promise<void> {
  await query(
    `UPDATE sessions SET last_active_at = now() - ($1 || ' days')::interval
      WHERE account_id = $2`,
    [String(days), accountId],
  );
}

describe('sweepExpiredSessions', () => {
  it('deletes sessions past the 30-day window and reports the count', async () => {
    await createSession(accountId);
    await ageSessions(31); // older than the TTL

    const deleted = await sweepExpiredSessions();
    expect(deleted).toBe(1);

    const { rows } = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM sessions WHERE account_id = $1',
      [accountId],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('keeps sessions still within the window', async () => {
    await createSession(accountId); // fresh (last_active_at = now)
    await query(
      `UPDATE sessions SET last_active_at = now() - interval '29 days'
        WHERE account_id = $1`,
      [accountId],
    );

    const deleted = await sweepExpiredSessions();
    expect(deleted).toBe(0);

    const { rows } = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM sessions WHERE account_id = $1',
      [accountId],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('removes only the expired rows in a mixed set', async () => {
    await createSession(accountId); // will be aged to expired
    await ageSessions(40);
    await createSession(accountId); // fresh, stays

    const deleted = await sweepExpiredSessions();
    expect(deleted).toBe(1);

    const { rows } = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM sessions WHERE account_id = $1',
      [accountId],
    );
    expect(rows[0]!.n).toBe(1);
  });
});
