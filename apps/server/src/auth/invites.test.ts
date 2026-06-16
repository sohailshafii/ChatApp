import { afterEach, describe, expect, it } from 'vitest';
import { query, getPool, closePool } from '../db/pool.js';
import {
  createInvite,
  hasPendingInvite,
  consumeInvite,
  sweepExpiredInvites,
} from './invites.js';

// DB integration for the invite primitives (invite-only signup, §1). Uses the
// dedicated chatapp_test database (global-setup); tables are truncated between
// tests. accepted_account_id FKs accounts(id), so consume tests insert a real
// account first.

afterEach(async () => {
  await query('TRUNCATE invites, accounts RESTART IDENTITY CASCADE');
  await closePool();
});

async function insertAccount(username: string): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO accounts (username, email, password_hash)
     VALUES ($1, $2, 'x') RETURNING id`,
    [username, `${username}@accounts.example.com`],
  );
  return rows[0]!.id;
}

async function consumeInTxn(email: string, accountId: string): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const claimed = await consumeInvite(client, email, accountId);
    await client.query('COMMIT');
    return claimed;
  } finally {
    client.release();
  }
}

describe('createInvite', () => {
  it('inserts an open invite with the requested expiry', async () => {
    const before = Date.now();
    const { email, expiresAt } = await createInvite('alice@example.com', 7);
    expect(email).toBe('alice@example.com');
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBeGreaterThan(before + sevenDays - 60_000);
    expect(expiresAt.getTime()).toBeLessThan(before + sevenDays + 60_000);

    expect(await hasPendingInvite('alice@example.com')).toBe(true);
  });

  it('matches case-insensitively (citext)', async () => {
    await createInvite('Alice@Example.com');
    expect(await hasPendingInvite('alice@example.com')).toBe(true);
  });

  it('is idempotent per email and re-opens a used invite (ON CONFLICT)', async () => {
    const accountId = await insertAccount('bob');
    await createInvite('bob@example.com');
    expect(await consumeInTxn('bob@example.com', accountId)).toBe(true);
    expect(await hasPendingInvite('bob@example.com')).toBe(false);

    // Re-inviting clears the acceptance and refreshes expiry → open again.
    await createInvite('bob@example.com');
    expect(await hasPendingInvite('bob@example.com')).toBe(true);

    // Still exactly one row for the email.
    const { rowCount } = await query('SELECT 1 FROM invites WHERE email = $1', [
      'bob@example.com',
    ]);
    expect(rowCount).toBe(1);
  });
});

describe('hasPendingInvite', () => {
  it('is false for an unknown email', async () => {
    expect(await hasPendingInvite('nobody@example.com')).toBe(false);
  });

  it('is false once expired', async () => {
    await createInvite('late@example.com');
    await query(
      `UPDATE invites SET expires_at = now() - interval '1 hour' WHERE email = $1`,
      ['late@example.com'],
    );
    expect(await hasPendingInvite('late@example.com')).toBe(false);
  });
});

describe('consumeInvite', () => {
  it('claims an open invite exactly once', async () => {
    const accountId = await insertAccount('carol');
    await createInvite('carol@example.com');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      expect(await consumeInvite(client, 'carol@example.com', accountId)).toBe(
        true,
      );
      // A second claim finds nothing open.
      expect(await consumeInvite(client, 'carol@example.com', accountId)).toBe(
        false,
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('does not claim an expired invite', async () => {
    const accountId = await insertAccount('dan');
    await createInvite('dan@example.com');
    await query(
      `UPDATE invites SET expires_at = now() - interval '1 hour' WHERE email = $1`,
      ['dan@example.com'],
    );
    expect(await consumeInTxn('dan@example.com', accountId)).toBe(false);
  });
});

describe('sweepExpiredInvites', () => {
  it('deletes expired-unaccepted invites, keeps open ones', async () => {
    await createInvite('open@example.com');
    await createInvite('expired@example.com');
    await query(
      `UPDATE invites SET expires_at = now() - interval '1 day' WHERE email = $1`,
      ['expired@example.com'],
    );

    const deleted = await sweepExpiredInvites();
    expect(deleted).toBe(1);
    expect(await hasPendingInvite('open@example.com')).toBe(true);
    const { rowCount } = await query('SELECT 1 FROM invites WHERE email = $1', [
      'expired@example.com',
    ]);
    expect(rowCount).toBe(0);
  });
});
