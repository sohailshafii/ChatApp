import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query, closePool } from '../db/pool.js';
import {
  DAILY_TOKEN_BUDGET,
  isOverBudget,
  recordUsage,
  tokensUsedToday,
} from './budget.js';

let accountId: string;

beforeEach(async () => {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO accounts (username, email, password_hash, verified)
     VALUES ('budgetuser', 'budget@example.com', 'x', true) RETURNING id`,
  );
  accountId = rows[0]!.id;
});

afterEach(async () => {
  await query('TRUNCATE accounts RESTART IDENTITY CASCADE'); // cascades to bot_usage
});

afterAll(async () => {
  await closePool();
});

describe('bot token budget', () => {
  it('starts at zero and is under budget', async () => {
    expect(await tokensUsedToday(accountId)).toBe(0);
    expect(await isOverBudget(accountId)).toBe(false);
  });

  it('recordUsage inserts then accumulates within the day', async () => {
    await recordUsage(accountId, 100);
    expect(await tokensUsedToday(accountId)).toBe(100);
    await recordUsage(accountId, 250);
    expect(await tokensUsedToday(accountId)).toBe(350);
  });

  it('ignores a non-positive delta', async () => {
    await recordUsage(accountId, 0);
    await recordUsage(accountId, -5);
    expect(await tokensUsedToday(accountId)).toBe(0);
  });

  it('is over budget once usage reaches the cap', async () => {
    await recordUsage(accountId, DAILY_TOKEN_BUDGET - 1);
    expect(await isOverBudget(accountId)).toBe(false);
    await recordUsage(accountId, 1);
    expect(await isOverBudget(accountId)).toBe(true);
  });

  it('only counts today (yesterday does not carry over)', async () => {
    await query(
      `INSERT INTO bot_usage (account_id, usage_date, tokens_used)
       VALUES ($1, ((now() AT TIME ZONE 'utc')::date - 1), $2)`,
      [accountId, DAILY_TOKEN_BUDGET * 2],
    );
    expect(await tokensUsedToday(accountId)).toBe(0);
    expect(await isOverBudget(accountId)).toBe(false);
  });
});
