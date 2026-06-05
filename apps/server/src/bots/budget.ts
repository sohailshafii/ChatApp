import { query } from '../db/pool.js';
import { loadConfig } from '../config.js';

// §cost per-user/day bot token budget. Counts input + output tokens a user
// spends on bot replies per UTC day; the orchestrator checks before a reply and
// records after (check-before/record-after, like the auth rate-limiter but
// DB-backed and counted in tokens). Backed by the bot_usage table (migration
// 007). The day key is the UTC date so it's stable regardless of server TZ.

export const DAILY_TOKEN_BUDGET = loadConfig().botDailyTokenBudget;

export async function tokensUsedToday(accountId: string): Promise<number> {
  const { rows } = await query<{ tokens_used: string }>(
    `SELECT tokens_used FROM bot_usage
      WHERE account_id = $1 AND usage_date = (now() AT TIME ZONE 'utc')::date`,
    [accountId],
  );
  return rows[0] ? Number(rows[0].tokens_used) : 0;
}

export async function isOverBudget(accountId: string): Promise<boolean> {
  return (await tokensUsedToday(accountId)) >= DAILY_TOKEN_BUDGET;
}

// Adds tokens to today's counter, creating the row on first use. No-op for a
// non-positive delta (e.g. a provider that reported no usage).
export async function recordUsage(
  accountId: string,
  tokens: number,
): Promise<void> {
  if (tokens <= 0) return;
  await query(
    `INSERT INTO bot_usage (account_id, usage_date, tokens_used)
       VALUES ($1, (now() AT TIME ZONE 'utc')::date, $2)
     ON CONFLICT (account_id, usage_date)
       DO UPDATE SET tokens_used = bot_usage.tokens_used + EXCLUDED.tokens_used`,
    [accountId, tokens],
  );
}
