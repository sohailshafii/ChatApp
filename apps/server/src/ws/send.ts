import { WebSocket } from 'ws';
import type { ServerWsMessage } from '@chatapp/shared';
import { hub } from './hub.js';

// Sends a server frame to every live socket of the given accounts (per-user
// fan-out). Used by bot streaming, where the target accounts are resolved once
// and reused across all of a reply's frames.
export function broadcastToAccounts(
  accountIds: readonly string[],
  frame: ServerWsMessage,
): void {
  const payload = JSON.stringify(frame);
  for (const account of accountIds) {
    for (const socket of hub.socketsForAccount(account)) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }
}
