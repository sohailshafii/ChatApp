import { describe, expect, it } from 'vitest';
import type { ConversationPeer } from '@chatapp/shared';
import { peerEmoji } from './Avatar';

const human: ConversationPeer = { kind: 'human', id: 'u1', username: 'alice' };
const grik: ConversationPeer = { kind: 'bot', id: 'assistant', name: 'Grik the Lizardman' };
const otherBot: ConversationPeer = { kind: 'bot', id: 'helper', name: 'Helper' };

describe('peerEmoji', () => {
  it('uses a face for humans', () => {
    expect(peerEmoji(human)).toBe('🙂');
  });

  it('uses the lizard for Grik (bot id "assistant")', () => {
    expect(peerEmoji(grik)).toBe('🦎');
  });

  it('falls back to a robot for other bots', () => {
    expect(peerEmoji(otherBot)).toBe('🤖');
  });
});
