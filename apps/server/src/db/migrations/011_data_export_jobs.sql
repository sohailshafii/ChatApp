-- 011_data_export_jobs: make data export a durable job (§6 hardening).
--
-- Previously the row was the finished artifact, written fire-and-forget after the
-- 200 — a crash between the response and the INSERT lost the export. Now the
-- request enqueues a `pending` row synchronously and a worker fills it in, so the
-- job survives restarts and retries. token_hash/content/filename/expires_at are
-- populated only when status flips to `ready`; status: pending -> ready | failed.

ALTER TABLE data_exports DROP CONSTRAINT data_exports_pkey;
ALTER TABLE data_exports ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY;

ALTER TABLE data_exports
  ALTER COLUMN token_hash DROP NOT NULL,
  ALTER COLUMN content    DROP NOT NULL,
  ALTER COLUMN filename   DROP NOT NULL,
  ALTER COLUMN expires_at DROP NOT NULL,
  ADD COLUMN status     text NOT NULL DEFAULT 'pending',
  ADD COLUMN attempts   int  NOT NULL DEFAULT 0,
  ADD COLUMN last_error text;

-- Any pre-existing artifact rows are already complete.
UPDATE data_exports SET status = 'ready' WHERE content IS NOT NULL;

-- Download lookup is by token; unique, but many pending rows share a NULL token
-- (Postgres allows multiple NULLs under a UNIQUE constraint).
ALTER TABLE data_exports ADD CONSTRAINT data_exports_token_key UNIQUE (token_hash);

-- The worker's claim scan: oldest pending first.
CREATE INDEX data_exports_pending_idx ON data_exports (created_at) WHERE status = 'pending';
