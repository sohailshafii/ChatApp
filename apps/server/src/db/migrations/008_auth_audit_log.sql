-- 008_auth_audit_log: per-account log of auth events (§6) — login, login
-- failure, password reset, account deletion, push subscription add/remove. Exists
-- from v1 so a user-facing "recent activity" view can be surfaced later.
--
-- account_id is ON DELETE SET NULL (not CASCADE): the log must OUTLIVE the
-- account — account deletion is itself an audited event, and audit logs are kept
-- ~180 days. `event` is plain text (validated by the AuthEvent union in
-- src/auth/audit.ts) so new event types need no migration. Retention pruning is a
-- follow-up.

CREATE TABLE auth_audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  event      text NOT NULL,
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Per-account history, newest first (the deferred "recent activity" view).
CREATE INDEX auth_audit_log_account_idx ON auth_audit_log (account_id, created_at DESC);
