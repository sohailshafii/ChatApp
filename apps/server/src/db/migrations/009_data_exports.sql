-- 009_data_exports: §6 data export. A user-requested export (profile +
-- conversation metadata + full message content) is generated asynchronously and
-- delivered via a time-limited download link emailed to the user.
--
-- We store the generated archive (JSON) keyed by a sha256 hash of the opaque
-- download token; the raw token lives only in the emailed link, so a DB read
-- can't fetch someone's export. account_id is ON DELETE CASCADE so exports go
-- with the account (and contain no PII after deletion). A retention sweep can
-- prune expired rows later (follow-up).

CREATE TABLE data_exports (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  content    bytea NOT NULL,
  filename   text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX data_exports_account_idx ON data_exports (account_id);
