import type { ServerWsMessage } from '@chatapp/shared';
import { bus } from './bus.js';

// Sends a server frame to every live socket of the given accounts (per-user
// fan-out), across all machines via the message bus. Used by bot streaming, where
// the target accounts are resolved once and reused across all of a reply's frames.
export function broadcastToAccounts(
  accountIds: readonly string[],
  frame: ServerWsMessage,
): void {
  bus.publish(accountIds, frame);
}
