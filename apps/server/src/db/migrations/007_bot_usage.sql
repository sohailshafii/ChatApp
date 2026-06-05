-- 007_bot_usage: §cost per-user/day bot token budget. One counter row per
-- (account, UTC day); the orchestrator checks it before a bot reply and adds the
-- model's token usage after. Old rows are harmless history (a future sweep can
-- prune them alongside the session sweeper).

CREATE TABLE bot_usage (
  account_id  uuid   NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  usage_date  date   NOT NULL,
  tokens_used bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, usage_date)
);
