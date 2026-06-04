import type { StartConversationRequest } from '@chatapp/shared';
import { getPool, query } from '../db/pool.js';
import { getBot } from '../bots/registry.js';

// §2 conversation lifecycle: start-or-get (idempotent per peer) and hide.

// Resolves the request to a conversation id, creating it if needed. Returns null
// when the peer can't be addressed (unknown/unverified user, self, unknown bot) —
// the route maps that to a generic not_found (no enumeration, §2).
export async function startConversation(
  accountId: string,
  request: StartConversationRequest,
): Promise<string | null> {
  if (request.peerKind === 'human') {
    // Only verified users are addressable, and the lookup is exact-username. A
    // miss is indistinguishable from "exists but unverified" (§2).
    const { rows } = await query<{ id: string }>(
      'SELECT id FROM accounts WHERE username = $1 AND verified = true',
      [request.username],
    );
    const peer = rows[0];
    if (!peer || peer.id === accountId) return null;
    return findOrCreateHuman(accountId, peer.id);
  }
  if (!getBot(request.botId)) return null;
  return findOrCreateBot(accountId, request.botId);
}

async function findOrCreateHuman(a: string, b: string): Promise<string> {
  const existing = await query<{ id: string }>(
    `SELECT c.id
       FROM conversations c
       JOIN conversation_participants p1 ON p1.conversation_id = c.id AND p1.account_id = $1
       JOIN conversation_participants p2 ON p2.conversation_id = c.id AND p2.account_id = $2
      WHERE c.bot_id IS NULL
      LIMIT 1`,
    [a, b],
  );
  if (existing.rows[0]) {
    await unhide(existing.rows[0].id, a);
    return existing.rows[0].id;
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO conversations DEFAULT VALUES RETURNING id',
    );
    const id = rows[0]!.id;
    await client.query(
      `INSERT INTO conversation_participants (conversation_id, account_id)
       VALUES ($1, $2), ($1, $3)`,
      [id, a, b],
    );
    await client.query('COMMIT');
    return id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function findOrCreateBot(accountId: string, botId: string): Promise<string> {
  const existing = await query<{ id: string }>(
    `SELECT c.id
       FROM conversations c
       JOIN conversation_participants p ON p.conversation_id = c.id AND p.account_id = $1
      WHERE c.bot_id = $2
      LIMIT 1`,
    [accountId, botId],
  );
  if (existing.rows[0]) {
    await unhide(existing.rows[0].id, accountId);
    return existing.rows[0].id;
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO conversations (bot_id) VALUES ($1) RETURNING id',
      [botId],
    );
    const id = rows[0]!.id;
    await client.query(
      'INSERT INTO conversation_participants (conversation_id, account_id) VALUES ($1, $2)',
      [id, accountId],
    );
    await client.query('COMMIT');
    return id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function unhide(conversationId: string, accountId: string): Promise<void> {
  await query(
    'UPDATE conversation_participants SET hidden = false WHERE conversation_id = $1 AND account_id = $2',
    [conversationId, accountId],
  );
}

// Hides the conversation from the caller's list (§2). Returns false when the
// caller isn't a participant.
export async function hideConversation(
  accountId: string,
  conversationId: string,
): Promise<boolean> {
  const { rowCount } = await query(
    'UPDATE conversation_participants SET hidden = true WHERE conversation_id = $1 AND account_id = $2',
    [conversationId, accountId],
  );
  return (rowCount ?? 0) > 0;
}
