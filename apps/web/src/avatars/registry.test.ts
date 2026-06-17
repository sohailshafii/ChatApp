import { describe, expect, it } from 'vitest';
import type { ConversationPeer } from '@chatapp/shared';
import { customAvatar } from './registry';

const human: ConversationPeer = { kind: 'human', id: 'u1', username: 'alice' };
const grik: ConversationPeer = { kind: 'bot', id: 'assistant', name: 'Grik the Lizardman' };
const smith: ConversationPeer = { kind: 'bot', id: 'smith', name: 'Smith' };
const bob: ConversationPeer = { kind: 'bot', id: 'bob', name: 'Bob' };
const barbara: ConversationPeer = { kind: 'bot', id: 'barbara', name: 'Barbara' };
const bigMike: ConversationPeer = { kind: 'bot', id: 'big-mike', name: 'Big Mike' };
const otherBot: ConversationPeer = { kind: 'bot', id: 'helper', name: 'Helper' };

describe('customAvatar', () => {
  it('returns a bundled image for registered bots (Grik, Smith, Bob, Barbara, Big Mike)', () => {
    expect(customAvatar(grik)).toBeTruthy();
    expect(customAvatar(smith)).toBeTruthy();
    expect(customAvatar(bob)).toBeTruthy();
    expect(customAvatar(barbara)).toBeTruthy();
    expect(customAvatar(bigMike)).toBeTruthy();
  });

  it('returns undefined for unregistered bots and humans (→ emoji fallback)', () => {
    expect(customAvatar(otherBot)).toBeUndefined();
    expect(customAvatar(human)).toBeUndefined();
  });
});
