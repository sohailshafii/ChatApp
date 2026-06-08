import type { ConversationPeer } from '@chatapp/shared';
import { customAvatar } from '../avatars/registry';

// Avatar for a conversation peer (§2). Resolves an image in priority order:
//   1. an explicit `imageUrl` (future per-user avatar URL),
//   2. a bundled custom image registered for the peer (src/avatars/registry),
//   3. otherwise an emoji derived from the peer — a face for humans, a per-bot
//      glyph for bots (Grik gets a lizard).

const HUMAN_EMOJI = '🙂';
const DEFAULT_BOT_EMOJI = '🤖';
// Per-bot overrides, keyed by the bot's stable id (slug).
const BOT_EMOJI: Record<string, string> = {
  assistant: '🦎', // Grik the Lizardman
};

export function peerEmoji(peer: ConversationPeer): string {
  if (peer.kind === 'bot') return BOT_EMOJI[peer.id] ?? DEFAULT_BOT_EMOJI;
  return HUMAN_EMOJI;
}

export function Avatar({
  peer,
  imageUrl,
}: {
  peer: ConversationPeer;
  imageUrl?: string;
}) {
  // Decorative: the peer's name is always shown as adjacent text, so we don't
  // want screen readers to announce the avatar too.
  const src = imageUrl ?? customAvatar(peer);
  if (src) {
    return <img className="avatar avatar-image" src={src} alt="" aria-hidden="true" />;
  }
  return (
    <span className="avatar avatar-emoji" aria-hidden="true">
      {peerEmoji(peer)}
    </span>
  );
}
