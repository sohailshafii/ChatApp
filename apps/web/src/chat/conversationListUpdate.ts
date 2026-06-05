import type { ConversationSummary, ServerWsMessage } from '@chatapp/shared';

// Applies a live WebSocket frame to the conversation list (§2/§7): refreshes the
// affected conversation's last-message preview + timestamp, bumps it to the top,
// and increments unread for incoming messages. Pure, so it's unit-testable.
//
// Used while the list is on screen — the user isn't inside any conversation
// then, so an incoming message there is genuinely unread. (Returning to the list
// re-fetches from the server, which is the source of truth for unread counts.)

interface Effect {
  conversationId: string;
  preview: string;
  at: string;
  incoming: boolean; // true => bump unread (peer/bot message, not our own)
}

function effectOf(frame: ServerWsMessage): Effect | null {
  switch (frame.type) {
    case 'message':
      return {
        conversationId: frame.message.conversationId,
        preview: frame.message.content,
        at: frame.message.createdAt,
        incoming: true,
      };
    case 'ack':
      return {
        conversationId: frame.message.conversationId,
        preview: frame.message.content,
        at: frame.message.createdAt,
        incoming: false,
      };
    case 'bot_end':
      return {
        conversationId: frame.message.conversationId,
        preview: frame.message.content,
        at: frame.message.createdAt,
        incoming: true,
      };
    default:
      return null;
  }
}

export function applyFrameToConversations(
  conversations: ConversationSummary[],
  frame: ServerWsMessage,
): ConversationSummary[] {
  const effect = effectOf(frame);
  if (!effect) return conversations;

  const idx = conversations.findIndex((c) => c.id === effect.conversationId);
  if (idx === -1) return conversations; // not in the loaded list; ignore

  const existing = conversations[idx]!;
  const updated: ConversationSummary = {
    ...existing,
    lastMessage: { preview: effect.preview, at: effect.at },
    updatedAt: effect.at,
    unreadCount: effect.incoming ? existing.unreadCount + 1 : existing.unreadCount,
  };

  // Newest activity floats to the top (list is sorted by updatedAt desc).
  const rest = conversations.filter((_, i) => i !== idx);
  return [updated, ...rest];
}
