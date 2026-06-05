import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@chatapp/shared';
import { documentTitle, unreadReducer, unreadTotal, type UnreadMap } from './unread';

function conv(id: string, unreadCount: number): ConversationSummary {
  return {
    id,
    peer: { kind: 'human', id: `u-${id}`, username: id },
    lastMessage: null,
    unreadCount,
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

describe('unreadReducer', () => {
  it('seeds from conversations, keeping only non-zero counts', () => {
    const state = unreadReducer({}, { type: 'seed', conversations: [conv('a', 2), conv('b', 0), conv('c', 1)] });
    expect(state).toEqual({ a: 2, c: 1 });
  });

  it('increments an incoming message', () => {
    expect(unreadReducer({ a: 1 }, { type: 'incoming', conversationId: 'a' })).toEqual({ a: 2 });
    expect(unreadReducer({}, { type: 'incoming', conversationId: 'b' })).toEqual({ b: 1 });
  });

  it('clears a conversation on read', () => {
    expect(unreadReducer({ a: 3, b: 1 }, { type: 'read', conversationId: 'a' })).toEqual({ b: 1 });
  });

  it('read is a no-op (same reference) for an absent conversation', () => {
    const state: UnreadMap = { a: 1 };
    expect(unreadReducer(state, { type: 'read', conversationId: 'zzz' })).toBe(state);
  });

  it('resets to empty', () => {
    expect(unreadReducer({ a: 1, b: 2 }, { type: 'reset' })).toEqual({});
  });
});

describe('unreadTotal', () => {
  it('sums counts', () => {
    expect(unreadTotal({})).toBe(0);
    expect(unreadTotal({ a: 2, b: 3 })).toBe(5);
  });
});

describe('documentTitle', () => {
  it('prefixes the count when there is unread', () => {
    expect(documentTitle(0)).toBe('ChatApp');
    expect(documentTitle(3)).toBe('(3) ChatApp');
  });
});
