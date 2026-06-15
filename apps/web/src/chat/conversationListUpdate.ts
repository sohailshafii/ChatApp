import type { ConversationSummary, ServerWsMessage } from '@chatapp/shared';

// Applies a live WebSocket frame to the conversation list (§2/§7): refreshes the
// affected conversation's last-message preview + timestamp, bumps it to the top,
// and increments unread for incoming messages. Pure, so it's unit-testable.
//
// This bumps unread for any incoming message. The caller (ConversationSidebar)
// is responsible for not leaving a badge on the conversation that's currently
// open in the two-pane layout — it clears the active row after applying. The
// server remains the source of truth for unread counts (a refetch reconciles).

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

// True when the frame would update the list but names a conversation we haven't
// loaded — e.g. one started on another tab/device, a first incoming message, or
// a hidden conversation the server just un-hid on new activity. The caller can't
// synthesize a summary (peer, etc.) from a message frame, so it should refetch
// `GET /conversations` to pull the missing row. (Frames with no list effect, or
// for a known conversation, return false — those go through applyFrame instead.)
export function frameTargetsUnknownConversation(
  conversations: ConversationSummary[],
  frame: ServerWsMessage,
): boolean {
  const effect = effectOf(frame);
  if (!effect) return false;
  return !conversations.some((c) => c.id === effect.conversationId);
}

export function applyFrameToConversations(
  conversations: ConversationSummary[],
  frame: ServerWsMessage,
): ConversationSummary[] {
  const effect = effectOf(frame);
  if (!effect) return conversations;

  const idx = conversations.findIndex((c) => c.id === effect.conversationId);
  if (idx === -1) return conversations; // not in the loaded list; caller refetches

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
