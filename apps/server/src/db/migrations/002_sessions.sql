-- 002_sessions: opaque server-issued session tokens (§1 login, §7 lifecycle).
--
-- We store only a sha256 hash of the token; the raw token lives solely in the
-- httpOnly session cookie, so a DB read cannot impersonate a session (mirrors
-- the email_verification_tokens design in 001).

CREATE TABLE sessions (
  token_hash     text PRIMARY KEY,
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now()
);

-- Revoke/enumerate all sessions for an account: "log out everywhere" on password
-- reset (§1) and the ON DELETE CASCADE on account deletion.
CREATE INDEX sessions_account_id_idx ON sessions (account_id);

-- The 30-day sliding-expiry sweeper scans by last_active_at (§7).
CREATE INDEX sessions_last_active_at_idx ON sessions (last_active_at);
