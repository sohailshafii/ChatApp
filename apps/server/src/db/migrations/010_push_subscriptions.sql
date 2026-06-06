-- 010_push_subscriptions: §5 Web Push. One row per browser/device subscription
-- (the JSON of a browser PushSubscription). The dispatcher sends a Web Push to a
-- recipient's subscriptions when a message arrives and they have no live socket.
--
-- endpoint is the PRIMARY KEY: a Push endpoint is globally unique, so registering
-- is idempotent (ON CONFLICT (endpoint) refreshes the keys and reassigns
-- account_id if the same browser switched users). account_id is ON DELETE CASCADE
-- so subscriptions go with the account (completes §6 account-deletion cleanup).

CREATE TABLE push_subscriptions (
  endpoint        text PRIMARY KEY,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  expiration_time bigint,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- "All of an account's subscriptions" — the dispatcher fan-out and cascade.
CREATE INDEX push_subscriptions_account_idx ON push_subscriptions (account_id);
