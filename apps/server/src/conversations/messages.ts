import type { Message, MessagePage } from '@chatapp/shared';
import { getPool, query } from '../db/pool.js';

// §3/§4 messaging: history (read side), the §7 read cursor, and message creation
// (used by the WebSocket send path).

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  client_message_id: string | null;
  created_at: Date;
};

export async function isParticipant(
  accountId: string,
  conversationId: string,
): Promise<boolean> {
  const { rowCount } = await query(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND account_id = $2',
    [conversationId, accountId],
  );
  return (rowCount ?? 0) > 0;
}

// One backward history page (§4): the newest `limit` messages older than the
// `before` cursor (a message id), returned oldest-first, plus a cursor for the
// next (older) page or null at the start of history.
export async function getMessagePage(
  conversationId: string,
  before: string | null,
  limit: number,
): Promise<MessagePage> {
  const { rows } = await query<MessageRow>(
    `SELECT id, conversation_id, sender_id, content, client_message_id, created_at
       FROM messages
      WHERE conversation_id = $1
        AND ($2::uuid IS NULL
             OR (created_at, id) <
                (SELECT created_at, id FROM messages WHERE id = $2::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [conversationId, before, limit + 1],
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse(); // oldest-first within the page
  return {
    messages: page.map(toMessage),
    nextBefore: hasMore && page[0] ? page[0].id : null,
  };
}

// Advances the participant's last-seen cursor to `messageId` (§7). Returns false
// when the caller isn't a participant or the message isn't in the conversation.
export async function markRead(
  accountId: string,
  conversationId: string,
  messageId: string,
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE conversation_participants
        SET last_read_message_id = $3
      WHERE conversation_id = $1 AND account_id = $2
        AND EXISTS (
          SELECT 1 FROM messages WHERE id = $3 AND conversation_id = $1
        )`,
    [conversationId, accountId, messageId],
  );
  return (rowCount ?? 0) > 0;
}

// The participants (human account ids) and bot, if any, of a conversation —
// used to authorize a send and to fan a message out. Returns null when the
// conversation doesn't exist.
export async function getConversationParticipants(
  conversationId: string,
): Promise<{ accountIds: string[]; botId: string | null } | null> {
  const { rows } = await query<{ account_ids: string[]; bot_id: string | null }>(
    `SELECT array_agg(cp.account_id::text) AS account_ids, c.bot_id
       FROM conversations c
       JOIN conversation_participants cp ON cp.conversation_id = c.id
      WHERE c.id = $1
      GROUP BY c.bot_id`,
    [conversationId],
  );
  const row = rows[0];
  return row ? { accountIds: row.account_ids, botId: row.bot_id } : null;
}

// Persists a message with a server-assigned timestamp (§3 ordering) and bumps the
// conversation's activity, atomically. Idempotent on (sender_id, clientMessageId):
// a retried send returns the existing message with `deduped: true` rather than
// inserting a duplicate.
export async function createMessage(input: {
  conversationId: string;
  senderId: string;
  content: string;
  clientMessageId: string;
}): Promise<{ message: Message; deduped: boolean }> {
  const client = await getPool().connect();
  let inserted;
  try {
    await client.query('BEGIN');
    inserted = await client.query<MessageRow>(
      `INSERT INTO messages (conversation_id, sender_id, content, client_message_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (sender_id, client_message_id) WHERE client_message_id IS NOT NULL
       DO NOTHING
       RETURNING id, conversation_id, sender_id, content, client_message_id, created_at`,
      [input.conversationId, input.senderId, input.content, input.clientMessageId],
    );
    if (inserted.rows[0]) {
      await client.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [
        input.conversationId,
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (inserted.rows[0]) {
    return { message: toMessage(inserted.rows[0]), deduped: false };
  }

  // Conflict: a retry of an already-persisted send. Return the existing message.
  const { rows } = await query<MessageRow>(
    `SELECT id, conversation_id, sender_id, content, client_message_id, created_at
       FROM messages WHERE sender_id = $1 AND client_message_id = $2`,
    [input.senderId, input.clientMessageId],
  );
  return { message: toMessage(rows[0]!), deduped: true };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    content: row.content,
    createdAt: row.created_at.toISOString(),
    clientMessageId: row.client_message_id,
  };
}
