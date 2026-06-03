-- 001_accounts: account records and email-verification tokens.
-- See REQUIREMENTS.md §1 (Accounts & Identity).

-- citext gives case-insensitive uniqueness while preserving the original
-- casing for display (§1: "stored lowercased; original casing preserved").
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      citext NOT NULL UNIQUE,
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  verified      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- Defense-in-depth mirror of the wire validation in @chatapp/shared.
  CONSTRAINT accounts_username_format
    CHECK (username ~ '^[a-zA-Z0-9_-]{3,30}$')
);

-- One-time, time-limited email verification tokens (§1: 24h expiry).
-- We store only a hash of the opaque token; the raw token lives only in the
-- emailed link, so a DB read cannot be used to verify an account.
CREATE TABLE email_verification_tokens (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_verification_tokens_account_id_idx
  ON email_verification_tokens (account_id);
