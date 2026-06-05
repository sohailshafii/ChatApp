import { describe, expect, it } from 'vitest';
import type { ConversationSummary, Message, ServerWsMessage } from '@chatapp/shared';
import {
  applyFrameToConversations,
  frameTargetsUnknownConversation,
} from './conversationListUpdate';

function conv(over: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: over.id ?? 'c1',
    peer: over.peer ?? { kind: 'human', id: 'u1', username: 'alice' },
    lastMessage: over.lastMessage ?? null,
    unreadCount: over.unreadCount ?? 0,
    updatedAt: over.updatedAt ?? '2026-06-01T00:00:00.000Z',
  };
}

function message(over: Partial<Message> = {}): Message {
  return {
    id: over.id ?? 'm1',
    conversationId: over.conversationId ?? 'c1',
    senderId: over.senderId ?? 'u1',
    content: over.content ?? 'hello',
    createdAt: over.createdAt ?? '2026-06-05T12:00:00.000Z',
    clientMessageId: over.clientMessageId ?? null,
  };
}

describe('applyFrameToConversations', () => {
  it('updates preview/timestamp and bumps unread for an incoming message', () => {
    const list = [conv({ id: 'a' }), conv({ id: 'c1', unreadCount: 2 })];
    const frame: ServerWsMessage = { type: 'message', message: message({ content: 'hi there' }) };
    const next = applyFrameToConversations(list, frame);

    expect(next[0]?.id).toBe('c1'); // bumped to top
    expect(next[0]?.lastMessage).toEqual({ preview: 'hi there', at: message().createdAt });
    expect(next[0]?.updatedAt).toBe(message().createdAt);
    expect(next[0]?.unreadCount).toBe(3);
  });

  it('does not bump unread for our own acked message', () => {
    const list = [conv({ id: 'c1', unreadCount: 0 })];
    const frame: ServerWsMessage = {
      type: 'ack',
      clientMessageId: 'x',
      message: message({ content: 'sent' }),
    };
    const next = applyFrameToConversations(list, frame);
    expect(next[0]?.unreadCount).toBe(0);
    expect(next[0]?.lastMessage?.preview).toBe('sent');
  });

  it('bumps unread for a finished bot reply', () => {
    const list = [conv({ id: 'c1', unreadCount: 0 })];
    const frame: ServerWsMessage = {
      type: 'bot_end',
      message: message({ senderId: 'assistant', content: 'the answer' }),
    };
    const next = applyFrameToConversations(list, frame);
    expect(next[0]?.unreadCount).toBe(1);
    expect(next[0]?.lastMessage?.preview).toBe('the answer');
  });

  it('ignores frames for a conversation not in the list', () => {
    const list = [conv({ id: 'c1' })];
    const frame: ServerWsMessage = { type: 'message', message: message({ conversationId: 'other' }) };
    expect(applyFrameToConversations(list, frame)).toBe(list);
  });

  it('ignores non-message frames (delivered, bot_chunk, error)', () => {
    const list = [conv({ id: 'c1' })];
    expect(
      applyFrameToConversations(list, { type: 'delivered', conversationId: 'c1', messageId: 'm1' }),
    ).toBe(list);
    expect(
      applyFrameToConversations(list, { type: 'bot_chunk', conversationId: 'c1', messageId: 'm1', delta: 'x' }),
    ).toBe(list);
  });
});

describe('frameTargetsUnknownConversation', () => {
  it('is true for an effect frame whose conversation is not loaded', () => {
    const list = [conv({ id: 'c1' })];
    const frame: ServerWsMessage = { type: 'message', message: message({ conversationId: 'new' }) };
    expect(frameTargetsUnknownConversation(list, frame)).toBe(true);
  });

  it('is false when the conversation is already loaded', () => {
    const list = [conv({ id: 'c1' })];
    const frame: ServerWsMessage = { type: 'message', message: message({ conversationId: 'c1' }) };
    expect(frameTargetsUnknownConversation(list, frame)).toBe(false);
  });

  it('is true for our own ack in an unknown conversation (e.g. started on another tab)', () => {
    const list = [conv({ id: 'c1' })];
    const frame: ServerWsMessage = {
      type: 'ack',
      clientMessageId: 'x',
      message: message({ conversationId: 'new' }),
    };
    expect(frameTargetsUnknownConversation(list, frame)).toBe(true);
  });

  it('is false for frames with no list effect, even if the id is unknown', () => {
    const list = [conv({ id: 'c1' })];
    expect(
      frameTargetsUnknownConversation(list, {
        type: 'bot_chunk',
        conversationId: 'new',
        messageId: 'm1',
        delta: 'x',
      }),
    ).toBe(false);
  });
});
