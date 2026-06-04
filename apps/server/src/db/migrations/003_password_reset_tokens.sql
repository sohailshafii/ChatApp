-- 003_password_reset: one-time, time-limited password-reset tokens (§1: 1h expiry).
--
-- Same hashed-token design as 001's email_verification_tokens: only a sha256
-- hash is stored; the raw token lives solely in the emailed link.

CREATE TABLE password_reset_tokens (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_account_id_idx
  ON password_reset_tokens (account_id);
