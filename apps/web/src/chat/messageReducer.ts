import type { BotErrorCode, Message, ServerWsMessage } from '@chatapp/shared';

// Reconciles the conversation's on-screen messages from REST history + live
// WebSocket frames (§3). Pure and framework-free so it can be unit-tested.
//
// Flow: a send appends a `sending` optimistic row keyed by clientMessageId; the
// server `ack` replaces it with the persisted message; `delivered` upgrades the
// status; peer/other-tab messages arrive as `message`; bot replies stream via
// bot_start -> bot_chunk -> bot_end (or bot_error).

export type MessageStatus =
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'streaming';

export interface DisplayMessage {
  key: string; // stable React key (clientMessageId while pending, else id)
  id: string | null; // server id once known
  senderId: string; // '' for an in-flight bot stream until bot_end fills it in
  content: string;
  createdAt: string;
  clientMessageId: string | null;
  status: MessageStatus;
  // Why a bot reply failed, set from bot_error so the UI can branch the copy
  // (e.g. budget vs. transient). Only meaningful when status === 'failed'.
  errorCode?: BotErrorCode;
}

export interface PendingDraft {
  clientMessageId: string;
  senderId: string;
  content: string;
  createdAt: string;
}

export type MessageAction =
  | { type: 'reset'; messages: Message[] } // initial history page
  | { type: 'prepend'; messages: Message[] } // older history page
  | { type: 'pending'; draft: PendingDraft } // optimistic local send
  | { type: 'frame'; conversationId: string; frame: ServerWsMessage };

function fromServer(m: Message, status: MessageStatus = 'sent'): DisplayMessage {
  return {
    key: m.id,
    id: m.id,
    senderId: m.senderId,
    content: m.content,
    createdAt: m.createdAt,
    clientMessageId: m.clientMessageId,
    status,
  };
}

// Insert a server message, or replace a row already representing it (matched by
// server id, or by the pending clientMessageId it confirms).
function upsert(state: DisplayMessage[], msg: DisplayMessage): DisplayMessage[] {
  const idx = state.findIndex(
    (m) =>
      (msg.id !== null && m.id === msg.id) ||
      (msg.clientMessageId !== null &&
        m.id === null &&
        m.clientMessageId === msg.clientMessageId),
  );
  if (idx === -1) return [...state, msg];
  const next = state.slice();
  next[idx] = msg;
  return next;
}

export function messageReducer(
  state: DisplayMessage[],
  action: MessageAction,
): DisplayMessage[] {
  switch (action.type) {
    case 'reset':
      return action.messages.map((m) => fromServer(m));
    case 'prepend':
      return [...action.messages.map((m) => fromServer(m)), ...state];
    case 'pending':
      return [
        ...state,
        {
          key: action.draft.clientMessageId,
          id: null,
          senderId: action.draft.senderId,
          content: action.draft.content,
          createdAt: action.draft.createdAt,
          clientMessageId: action.draft.clientMessageId,
          status: 'sending',
        },
      ];
    case 'frame':
      return applyFrame(state, action.conversationId, action.frame);
  }
}

function applyFrame(
  state: DisplayMessage[],
  conversationId: string,
  frame: ServerWsMessage,
): DisplayMessage[] {
  switch (frame.type) {
    case 'ack':
      if (frame.message.conversationId !== conversationId) return state;
      return upsert(state, fromServer(frame.message, 'sent'));

    case 'message':
      if (frame.message.conversationId !== conversationId) return state;
      return upsert(state, fromServer(frame.message, 'sent'));

    case 'delivered':
      if (frame.conversationId !== conversationId) return state;
      return state.map((m) =>
        m.id === frame.messageId && m.status !== 'failed'
          ? { ...m, status: 'delivered' }
          : m,
      );

    case 'bot_start':
      if (frame.conversationId !== conversationId) return state;
      if (state.some((m) => m.id === frame.messageId)) return state;
      return [
        ...state,
        {
          key: frame.messageId,
          id: frame.messageId,
          senderId: '', // filled in by bot_end; '' renders as peer, not own
          content: '',
          createdAt: new Date().toISOString(),
          clientMessageId: null,
          status: 'streaming',
        },
      ];

    case 'bot_chunk':
      if (frame.conversationId !== conversationId) return state;
      return state.map((m) =>
        m.id === frame.messageId
          ? { ...m, content: m.content + frame.delta }
          : m,
      );

    case 'bot_end':
      if (frame.message.conversationId !== conversationId) return state;
      return upsert(state, fromServer(frame.message, 'sent'));

    case 'bot_error':
      if (frame.conversationId !== conversationId) return state;
      return state.map((m) =>
        m.id === frame.messageId
          ? { ...m, status: 'failed', errorCode: frame.code }
          : m,
      );

    case 'error':
      // A send failed; mark its optimistic row failed.
      if (frame.clientMessageId === null) return state;
      return state.map((m) =>
        m.clientMessageId === frame.clientMessageId && m.id === null
          ? { ...m, status: 'failed' }
          : m,
      );
  }
}
