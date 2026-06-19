import { query } from '../db/pool.js';
import { loadConfig } from '../config.js';

// §cost per-user bot token budget. Counts input + output tokens a user spends on
// bot replies within a fixed time window; the orchestrator checks before a reply
// and records after (check-before/record-after, like the auth rate-limiter but
// DB-backed and counted in tokens). Backed by the bot_usage table (migration
// 013), one counter row per (account, window).
//
// The window is a fixed 5-hour bucket aligned to the epoch (so everyone resets
// on the same wall-clock boundaries, regardless of server TZ), mirroring the
// "soft fixed-window" shape of the rate limiters. This matches how the major LLM
// providers reset usage allowances every few hours rather than once a day.

export const TOKEN_BUDGET = loadConfig().botTokenBudget;

// Window length in seconds (5 hours). The current window's start instant is
// floor(now / WINDOW) * WINDOW, computed in SQL so it shares the DB clock.
const WINDOW_SECONDS = 5 * 60 * 60;
const WINDOW_START_SQL = `to_timestamp(floor(extract(epoch from now()) / ${WINDOW_SECONDS}) * ${WINDOW_SECONDS})`;

export async function tokensUsedInWindow(accountId: string): Promise<number> {
  const { rows } = await query<{ tokens_used: string }>(
    `SELECT tokens_used FROM bot_usage
      WHERE account_id = $1 AND window_start = ${WINDOW_START_SQL}`,
    [accountId],
  );
  return rows[0] ? Number(rows[0].tokens_used) : 0;
}

export async function isOverBudget(accountId: string): Promise<boolean> {
  return (await tokensUsedInWindow(accountId)) >= TOKEN_BUDGET;
}

// Adds tokens to the current window's counter, creating the row on first use.
// No-op for a non-positive delta (e.g. a provider that reported no usage).
export async function recordUsage(
  accountId: string,
  tokens: number,
): Promise<void> {
  if (tokens <= 0) return;
  await query(
    `INSERT INTO bot_usage (account_id, window_start, tokens_used)
       VALUES ($1, ${WINDOW_START_SQL}, $2)
     ON CONFLICT (account_id, window_start)
       DO UPDATE SET tokens_used = bot_usage.tokens_used + EXCLUDED.tokens_used`,
    [accountId, tokens],
  );
}
