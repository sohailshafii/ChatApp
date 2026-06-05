import { describe, expect, it } from 'vitest';
import type { Message, ServerWsMessage } from '@chatapp/shared';
import { messageReducer, type DisplayMessage } from './messageReducer';

const CONV = '11111111-1111-1111-1111-111111111111';

function msg(over: Partial<Message> = {}): Message {
  return {
    id: over.id ?? '22222222-2222-2222-2222-222222222222',
    conversationId: over.conversationId ?? CONV,
    senderId: over.senderId ?? 'user-1',
    content: over.content ?? 'hello',
    createdAt: over.createdAt ?? '2026-06-04T12:00:00.000Z',
    clientMessageId: over.clientMessageId ?? null,
  };
}

function frame(state: DisplayMessage[], f: ServerWsMessage, conversationId = CONV) {
  return messageReducer(state, { type: 'frame', conversationId, frame: f });
}

describe('messageReducer', () => {
  it('resets from a history page', () => {
    const state = messageReducer([], { type: 'reset', messages: [msg()] });
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ id: msg().id, status: 'sent' });
  });

  it('prepends older history ahead of existing rows', () => {
    const initial = messageReducer([], { type: 'reset', messages: [msg({ id: 'b' })] });
    const next = messageReducer(initial, { type: 'prepend', messages: [msg({ id: 'a' })] });
    expect(next.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('adds an optimistic pending row, then ack replaces it in place', () => {
    let state = messageReducer([], {
      type: 'pending',
      draft: { clientMessageId: 'c1', senderId: 'me', content: 'hi', createdAt: 't' },
    });
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ id: null, status: 'sending', clientMessageId: 'c1' });

    state = frame(state, {
      type: 'ack',
      clientMessageId: 'c1',
      message: msg({ id: 'srv-1', senderId: 'me', clientMessageId: 'c1' }),
    });
    expect(state).toHaveLength(1); // replaced, not duplicated
    expect(state[0]).toMatchObject({ id: 'srv-1', status: 'sent' });
  });

  it('marks the optimistic row failed on an error frame', () => {
    let state = messageReducer([], {
      type: 'pending',
      draft: { clientMessageId: 'c1', senderId: 'me', content: 'hi', createdAt: 't' },
    });
    state = frame(state, {
      type: 'error',
      code: 'rate_limited',
      message: 'slow down',
      clientMessageId: 'c1',
    });
    expect(state[0]?.status).toBe('failed');
  });

  it('appends an incoming peer message and dedupes by id', () => {
    let state = frame([], { type: 'message', message: msg({ id: 'm1', senderId: 'peer' }) });
    expect(state).toHaveLength(1);
    // same id again (e.g. a duplicate frame) does not double
    state = frame(state, { type: 'message', message: msg({ id: 'm1', senderId: 'peer' }) });
    expect(state).toHaveLength(1);
  });

  it('upgrades status to delivered', () => {
    let state = frame([], { type: 'ack', clientMessageId: 'c', message: msg({ id: 'm1' }) });
    state = frame(state, { type: 'delivered', conversationId: CONV, messageId: 'm1' });
    expect(state[0]?.status).toBe('delivered');
  });

  it('streams a bot reply: start -> chunk -> end', () => {
    let state = frame([], { type: 'bot_start', conversationId: CONV, messageId: 'bot-1' });
    expect(state[0]).toMatchObject({ id: 'bot-1', status: 'streaming', content: '' });

    state = frame(state, { type: 'bot_chunk', conversationId: CONV, messageId: 'bot-1', delta: 'Hel' });
    state = frame(state, { type: 'bot_chunk', conversationId: CONV, messageId: 'bot-1', delta: 'lo' });
    expect(state[0]?.content).toBe('Hello');

    state = frame(state, {
      type: 'bot_end',
      message: msg({ id: 'bot-1', senderId: 'assistant', content: 'Hello' }),
    });
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ id: 'bot-1', senderId: 'assistant', status: 'sent' });
  });

  it('marks a bot stream failed on bot_error', () => {
    let state = frame([], { type: 'bot_start', conversationId: CONV, messageId: 'bot-1' });
    state = frame(state, { type: 'bot_error', conversationId: CONV, messageId: 'bot-1' });
    expect(state[0]?.status).toBe('failed');
  });

  it('ignores frames for a different conversation', () => {
    const other = frame([], { type: 'message', message: msg({ id: 'x', conversationId: 'other' }) });
    expect(other).toHaveLength(0);
  });
});
