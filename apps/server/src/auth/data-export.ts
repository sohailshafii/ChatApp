import type { FastifyBaseLogger } from 'fastify';
import { query, getPool } from '../db/pool.js';
import { generateToken } from './tokens.js';
import { getBot } from '../bots/registry.js';
import { loadConfig } from '../config.js';
import { sendDataExportEmail } from '../mail/data-export.js';

// §6 data export. The archive (profile + conversation metadata + full message
// content) is generated asynchronously, stored under a hashed download token, and
// delivered via a time-limited emailed link.
export const DATA_EXPORT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

type ProfileRow = {
  username: string;
  email: string;
  verified: boolean;
  created_at: Date;
};
type ConvRow = {
  id: string;
  bot_id: string | null;
  created_at: Date;
  updated_at: Date;
  peer_account_id: string | null;
  peer_username: string | null;
};
type MsgRow = {
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: Date;
};

// Readable peer for the archive — bot by name, human by username, with the same
// "Deleted user" fallback as the live conversation views (§4).
function exportPeer(row: ConvRow): Record<string, string> {
  if (row.bot_id) {
    return { kind: 'bot', id: row.bot_id, name: getBot(row.bot_id)?.name ?? row.bot_id };
  }
  if (row.peer_account_id == null) {
    return { kind: 'human', username: 'Deleted user' };
  }
  return { kind: 'human', id: row.peer_account_id, username: row.peer_username! };
}

// Assembles the caller's full export document.
export async function buildExport(accountId: string): Promise<unknown> {
  const { rows: profileRows } = await query<ProfileRow>(
    'SELECT username, email, verified, created_at FROM accounts WHERE id = $1',
    [accountId],
  );
  const profile = profileRows[0];
  if (!profile) throw new Error(`account ${accountId} not found`);

  const { rows: convRows } = await query<ConvRow>(
    `SELECT c.id, c.bot_id, c.created_at, c.updated_at,
            other.account_id AS peer_account_id, peer.username AS peer_username
       FROM conversations c
       JOIN conversation_participants me
         ON me.conversation_id = c.id AND me.account_id = $1
       LEFT JOIN conversation_participants other
         ON other.conversation_id = c.id AND other.account_id <> $1
       LEFT JOIN accounts peer ON peer.id = other.account_id
      ORDER BY c.created_at, c.id`,
    [accountId],
  );

  const { rows: msgRows } = await query<MsgRow>(
    `SELECT m.conversation_id, m.sender_id, m.content, m.created_at
       FROM messages m
       JOIN conversation_participants me
         ON me.conversation_id = m.conversation_id AND me.account_id = $1
      ORDER BY m.created_at, m.id`,
    [accountId],
  );

  const byConv = new Map<
    string,
    { senderId: string; content: string; createdAt: string }[]
  >();
  for (const m of msgRows) {
    const list = byConv.get(m.conversation_id) ?? [];
    list.push({
      senderId: m.sender_id,
      content: m.content,
      createdAt: m.created_at.toISOString(),
    });
    byConv.set(m.conversation_id, list);
  }

  return {
    exportedAt: new Date().toISOString(),
    profile: {
      username: profile.username,
      email: profile.email,
      verified: profile.verified,
      createdAt: profile.created_at.toISOString(),
    },
    conversations: convRows.map((c) => ({
      id: c.id,
      peer: exportPeer(c),
      createdAt: c.created_at.toISOString(),
      updatedAt: c.updated_at.toISOString(),
      messages: byConv.get(c.id) ?? [],
    })),
  };
}

// A failing export is retried up to this many times, then marked `failed`.
export const MAX_EXPORT_ATTEMPTS = 3;

// Durably enqueues an export job (§6). Synchronous — the row is committed before
// the request returns 200, so a crash can't lose the request. The worker
// (processPendingExports) fills it in.
export async function enqueueExport(accountId: string): Promise<void> {
  await query('INSERT INTO data_exports (account_id) VALUES ($1)', [accountId]);
}

// The export worker: claims up to `batchSize` pending jobs and generates each.
// Multi-machine-safe via FOR UPDATE SKIP LOCKED (one machine in v1). Returns the
// number completed (marked `ready`) this pass.
export async function processPendingExports(
  log: FastifyBaseLogger,
  batchSize = 10,
): Promise<number> {
  let completed = 0;
  for (let i = 0; i < batchSize; i++) {
    const done = await processOnePending(log);
    if (done === 'none') break;
    if (done === 'ready') completed += 1;
  }
  return completed;
}

type JobOutcome = 'none' | 'ready' | 'error';

// Processes a single pending job in its own transaction. The row lock is held
// only while building the archive (a few SELECTs); the email is sent after commit
// so we never hold a transaction across network I/O.
async function processOnePending(log: FastifyBaseLogger): Promise<JobOutcome> {
  const client = await getPool().connect();
  let toEmail: { email: string; rawToken: string } | null = null;
  let outcome: JobOutcome = 'none';
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string; account_id: string }>(
      `SELECT id, account_id FROM data_exports
        WHERE status = 'pending'
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
    );
    const job = rows[0];
    if (!job) {
      await client.query('COMMIT');
      return 'none';
    }
    try {
      const archive = await buildExport(job.account_id);
      const token = generateToken();
      const content = Buffer.from(JSON.stringify(archive, null, 2), 'utf8');
      const filename = `chatapp-export-${new Date().toISOString().slice(0, 10)}.json`;
      const expiresAt = new Date(Date.now() + DATA_EXPORT_TTL_MS);
      await client.query(
        `UPDATE data_exports
            SET token_hash = $2, content = $3, filename = $4, expires_at = $5,
                status = 'ready'
          WHERE id = $1`,
        [job.id, token.hash, content, filename, expiresAt],
      );
      const { rows: er } = await client.query<{ email: string }>(
        'SELECT email FROM accounts WHERE id = $1',
        [job.account_id],
      );
      await client.query('COMMIT');
      outcome = 'ready';
      if (er[0]) toEmail = { email: er[0].email, rawToken: token.raw };
    } catch (err) {
      // Generation failed — retry up to MAX_EXPORT_ATTEMPTS, then give up.
      await client.query(
        `UPDATE data_exports
            SET attempts = attempts + 1,
                last_error = $2,
                status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'pending' END
          WHERE id = $1`,
        [job.id, String(err), MAX_EXPORT_ATTEMPTS],
      );
      await client.query('COMMIT');
      log.error({ err, exportId: job.id }, 'data export generation failed');
      outcome = 'error';
    }
  } catch (txErr) {
    await client.query('ROLLBACK').catch(() => {});
    log.error({ err: txErr }, 'data export job transaction failed');
  } finally {
    client.release();
  }

  if (toEmail) {
    try {
      const { appBaseUrl } = loadConfig();
      // The download endpoint is the server route GET /api/auth/export/download,
      // reached same-origin (prod) or via the dev proxy. The API lives under /api
      // (#75), so the link must carry that prefix.
      const link = `${appBaseUrl}/api/auth/export/download?token=${encodeURIComponent(toEmail.rawToken)}`;
      await sendDataExportEmail(log, toEmail.email, link);
    } catch (err) {
      log.error({ err }, 'data export email failed');
    }
  }
  return outcome;
}

// Deletes finished/dead export rows (§6 retention): a `ready` archive past its
// download window (dead weight + the user's PII), plus `failed` jobs and
// `pending` jobs abandoned for over a day. Returns the number of rows removed.
export async function sweepExpiredDataExports(): Promise<number> {
  const { rowCount } = await query(
    `DELETE FROM data_exports
      WHERE (status = 'ready' AND expires_at <= now())
         OR status = 'failed'
         OR (status = 'pending' AND created_at < now() - interval '1 day')`,
  );
  return rowCount ?? 0;
}
