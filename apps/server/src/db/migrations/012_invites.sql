-- 012_invites: email-bound signup invitations (invite-only mode).
--
-- When INVITE_ONLY is enabled, POST /auth/signup requires a pending invite
-- whose email matches the submitted address; otherwise it returns
-- `invite_required`. Operators mint invites with `npm run invite -- <email>`,
-- which emails the recipient a link to the signup page. The gate is the email
-- match — email verification (§1) still proves ownership of that address.

CREATE TABLE invites (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- citext so the match is case-insensitive, mirroring accounts.email.
  email               citext NOT NULL UNIQUE,
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Set when the invite is consumed by a successful signup. accepted_account_id
  -- is ON DELETE SET NULL so the invite row outlives the account it created.
  accepted_at         timestamptz,
  accepted_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL
);

-- The signup gate looks up *open* invites by email (unaccepted, unexpired); the
-- partial index serves both the pre-check and the consume UPDATE.
CREATE INDEX invites_open_idx ON invites (email) WHERE accepted_at IS NULL;
