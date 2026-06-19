-- 013_bot_usage_window: switch the §cost bot token budget from a per-UTC-day
-- window to a fixed 5-hour window. The counter row is now keyed by the
-- window's start instant (a timestamptz aligned to 5-hour boundaries from the
-- epoch) instead of a calendar date. The counter is a soft, self-healing budget
-- (it only ever gates the *next* reply), so dropping the old per-day rows just
-- resets the current window once — harmless. Old rows are not migrated.

DROP TABLE bot_usage;

CREATE TABLE bot_usage (
  account_id   uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  tokens_used  bigint      NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, window_start)
);
