import type { FastifyBaseLogger } from 'fastify';
import { query } from '../db/pool.js';
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

// Builds + persists the archive under a fresh token. Returns the raw download
// token (the bearer capability) and the filename.
export async function createExport(
  accountId: string,
): Promise<{ rawToken: string; filename: string }> {
  const archive = await buildExport(accountId);
  const token = generateToken();
  const content = Buffer.from(JSON.stringify(archive, null, 2), 'utf8');
  const filename = `chatapp-export-${new Date().toISOString().slice(0, 10)}.json`;
  const expiresAt = new Date(Date.now() + DATA_EXPORT_TTL_MS);
  await query(
    `INSERT INTO data_exports (token_hash, account_id, content, filename, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [token.hash, accountId, content, filename, expiresAt],
  );
  return { rawToken: token.raw, filename };
}

// Fire-and-forget worker: persist the archive and email the download link.
// Best-effort — logs and swallows errors (the request already returned 200).
export async function generateExport(
  log: FastifyBaseLogger,
  accountId: string,
  email: string,
): Promise<void> {
  try {
    const { rawToken } = await createExport(accountId);
    const { appBaseUrl } = loadConfig();
    const link = `${appBaseUrl}/auth/export/download?token=${encodeURIComponent(rawToken)}`;
    await sendDataExportEmail(log, email, link);
  } catch (err) {
    log.error({ err, accountId }, 'data export generation failed');
  }
}
