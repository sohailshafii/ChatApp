import type { ConversationSummary } from '@chatapp/shared';

// Tracks total unread across conversations for the tab title + favicon (§5,
// states C). Pure and framework-free so it's unit-testable; the provider owns
// the runtime decision of when a message counts (focus + visibility).

export type UnreadMap = Record<string, number>;

export type UnreadEvent =
  | { type: 'seed'; conversations: ConversationSummary[] } // baseline from REST
  | { type: 'incoming'; conversationId: string } // a message we should count
  | { type: 'read'; conversationId: string } // user is viewing it: clear
  | { type: 'reset' }; // logout

export function unreadReducer(state: UnreadMap, event: UnreadEvent): UnreadMap {
  switch (event.type) {
    case 'seed': {
      const next: UnreadMap = {};
      for (const c of event.conversations) {
        if (c.unreadCount > 0) next[c.id] = c.unreadCount;
      }
      return next;
    }
    case 'incoming':
      return { ...state, [event.conversationId]: (state[event.conversationId] ?? 0) + 1 };
    case 'read': {
      if (!(event.conversationId in state)) return state;
      const next = { ...state };
      delete next[event.conversationId];
      return next;
    }
    case 'reset':
      return {};
  }
}

export function unreadTotal(state: UnreadMap): number {
  let total = 0;
  for (const id in state) total += state[id]!;
  return total;
}

// Tab title (§5 state C): "(N) ChatApp" when there's unread, else the base.
export function documentTitle(total: number, base = 'ChatApp'): string {
  return total > 0 ? `(${total}) ${base}` : base;
}
