import type { ConversationPeer, ConversationSummary } from '@chatapp/shared';
import { query } from '../db/pool.js';
import { getBot } from '../bots/registry.js';

// §2 conversation list. Returns the caller's conversations, most-recent activity
// first. lastMessage/unreadCount are placeholders until messaging + last-seen
// cursors land (P1) — there are no messages yet.

type ConversationRow = {
  id: string;
  bot_id: string | null;
  updated_at: Date;
  // The other (human) participant, when this is a human-human conversation.
  peer_account_id: string | null;
  peer_username: string | null;
};

export async function listConversations(
  accountId: string,
): Promise<ConversationSummary[]> {
  const { rows } = await query<ConversationRow>(
    `SELECT c.id,
            c.bot_id,
            c.updated_at,
            other.account_id AS peer_account_id,
            peer.username    AS peer_username
       FROM conversations c
       JOIN conversation_participants me
         ON me.conversation_id = c.id AND me.account_id = $1
       LEFT JOIN conversation_participants other
         ON other.conversation_id = c.id AND other.account_id <> $1
       LEFT JOIN accounts peer ON peer.id = other.account_id
      ORDER BY c.updated_at DESC`,
    [accountId],
  );
  return rows.map(toSummary);
}

function toSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    peer: resolvePeer(row),
    lastMessage: null,
    unreadCount: 0,
    updatedAt: row.updated_at.toISOString(),
  };
}

function resolvePeer(row: ConversationRow): ConversationPeer {
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
