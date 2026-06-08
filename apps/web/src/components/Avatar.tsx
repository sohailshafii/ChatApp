import type { ConversationPeer } from '@chatapp/shared';

// Avatar for a conversation peer (§2). Defaults to an emoji derived from the
// peer — a face for humans, a per-bot glyph for bots (Grik gets a lizard). The
// optional `imageUrl` is the hook for custom images: once a peer carries an
// avatar URL, pass it here and it renders instead of the emoji.

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
  if (imageUrl) {
    return <img className="avatar avatar-image" src={imageUrl} alt="" aria-hidden="true" />;
  }
  return (
    <span className="avatar avatar-emoji" aria-hidden="true">
      {peerEmoji(peer)}
    </span>
  );
}
