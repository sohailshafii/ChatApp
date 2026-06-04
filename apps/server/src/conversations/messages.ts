import type { Message, MessagePage } from '@chatapp/shared';
import { query } from '../db/pool.js';

// §3/§4 message history + the §7 read cursor. (Message creation happens over the
// WebSocket, in a later PR; this is the read side.)

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
