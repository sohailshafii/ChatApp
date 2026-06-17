import type { ConversationPeer } from '@chatapp/shared';
import grik from './grik2.png';
import smith from './smith.svg';
import bob from './bob.svg';
import barbara from './barbara.svg';
import bigMike from './big-mike.svg';

// Bundled custom avatar images (§2), swappable in code — no server involved.
// To add one: drop an image in src/avatars/, import it here, and map it by peer
// below. Anything not mapped falls back to the emoji (see Avatar / peerEmoji).

// Keyed by the bot's stable id (slug).
const BOT_IMAGES: Record<string, string> = {
  assistant: grik, // Grik the Lizardman
  smith, // Smith — old Londoner in a fedora
  bob, // Bob — old mechanic with a mustache
  barbara, // Barbara — 19th-century grandma with a silver bun and spectacles
  'big-mike': bigMike, // Big Mike — cul-de-sac party host in a ball cap
};

// Specific humans could be mapped by id later (e.g. HUMAN_IMAGES[peer.id]).
export function customAvatar(peer: ConversationPeer): string | undefined {
  if (peer.kind === 'bot') return BOT_IMAGES[peer.id];
  return undefined;
}
