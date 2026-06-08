import { describe, expect, it } from 'vitest';
import type { ConversationPeer } from '@chatapp/shared';
import { customAvatar } from './registry';

const human: ConversationPeer = { kind: 'human', id: 'u1', username: 'alice' };
const grik: ConversationPeer = { kind: 'bot', id: 'assistant', name: 'Grik the Lizardman' };
const otherBot: ConversationPeer = { kind: 'bot', id: 'helper', name: 'Helper' };

describe('customAvatar', () => {
  it('returns a bundled image for a registered bot (Grik)', () => {
    expect(customAvatar(grik)).toBeTruthy();
  });

  it('returns undefined for unregistered bots and humans (→ emoji fallback)', () => {
    expect(customAvatar(otherBot)).toBeUndefined();
    expect(customAvatar(human)).toBeUndefined();
  });
});
