import type { ConversationPeer } from '@chatapp/shared';

// Display name for a conversation peer: username for humans, bot name for bots (§2).
export function peerName(peer: ConversationPeer): string {
  return peer.kind === 'human' ? peer.username : peer.name;
}
