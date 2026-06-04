import type { ConversationPeer, ConversationSummary } from '@chatapp/shared';
import { query } from '../db/pool.js';
import { getBot } from '../bots/registry.js';

// §2 conversation summaries, shared by the list and single-conversation routes.
// A summary carries the peer, the last-message preview, the caller's unread count
// (peer messages newer than the caller's last-seen cursor, §7), and the activity
// timestamp. The list is ordered by updatedAt desc.

const PREVIEW_MAX = 200; // code points — keeps list payloads bounded

type SummaryRow = {
  id: string;
  bot_id: string | null;
  updated_at: Date;
  peer_account_id: string | null;
  peer_username: string | null;
  last_content: string | null;
  last_at: Date | null;
  unread_count: number;
};

// $1 = caller account id; $2 = conversation id (only when filterById).
function summarySql(filterById: boolean): string {
  return `
    SELECT c.id, c.bot_id, c.updated_at,
           other.account_id AS peer_account_id,
           peer.username    AS peer_username,
           lm.content       AS last_content,
           lm.created_at    AS last_at,
           COALESCE(uc.unread, 0)::int AS unread_count
      FROM conversations c
      JOIN conversation_participants me
        ON me.conversation_id = c.id AND me.account_id = $1
      LEFT JOIN conversation_participants other
        ON other.conversation_id = c.id AND other.account_id <> $1
      LEFT JOIN accounts peer ON peer.id = other.account_id
      LEFT JOIN LATERAL (
        SELECT content, created_at FROM messages m
         WHERE m.conversation_id = c.id
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT 1
      ) lm ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS unread FROM messages m
         WHERE m.conversation_id = c.id
           AND m.sender_id <> $1::text
           AND (me.last_read_message_id IS NULL
                OR (m.created_at, m.id) > (
                  SELECT lr.created_at, lr.id
                    FROM messages lr WHERE lr.id = me.last_read_message_id
                ))
      ) uc ON true
     ${filterById ? 'WHERE c.id = $2' : ''}
     ORDER BY c.updated_at DESC
  `;
}

export async function listConversations(
  accountId: string,
): Promise<ConversationSummary[]> {
  const { rows } = await query<SummaryRow>(summarySql(false), [accountId]);
  return rows.map(mapSummary);
}

export async function getConversationSummary(
  accountId: string,
  conversationId: string,
): Promise<ConversationSummary | null> {
  const { rows } = await query<SummaryRow>(summarySql(true), [
    accountId,
    conversationId,
  ]);
  return rows[0] ? mapSummary(rows[0]) : null;
}

function mapSummary(row: SummaryRow): ConversationSummary {
  return {
    id: row.id,
    peer: resolvePeer(row),
    lastMessage:
      row.last_at && row.last_content !== null
        ? { preview: preview(row.last_content), at: row.last_at.toISOString() }
        : null,
    unreadCount: row.unread_count,
    updatedAt: row.updated_at.toISOString(),
  };
}

function preview(content: string): string {
  const codePoints = [...content];
  return codePoints.length <= PREVIEW_MAX
    ? content
    : codePoints.slice(0, PREVIEW_MAX).join('');
}

function resolvePeer(row: SummaryRow): ConversationPeer {
  if (row.bot_id) {
    const bot = getBot(row.bot_id);
    return { kind: 'bot', id: row.bot_id, name: bot?.name ?? row.bot_id };
  }
  // Human-human: the non-self participant is guaranteed present (1-on-1).
  return {
    kind: 'human',
    id: row.peer_account_id!,
    username: row.peer_username!,
  };
}
