import type { WebSocket } from 'ws';

// In-process registry of live sockets per account, for per-user fan-out (§3).
// A user may have several sockets (tabs/devices). Like the rate limiter, this is
// PER PROCESS: with multiple machines a message only reaches sockets on the same
// machine, so this must move behind a pub/sub (e.g. Redis) before scaling out.

const EMPTY: ReadonlySet<WebSocket> = new Set();

class ConnectionHub {
  private readonly byAccount = new Map<string, Set<WebSocket>>();

  add(accountId: string, socket: WebSocket): void {
    let set = this.byAccount.get(accountId);
    if (!set) {
      set = new Set();
      this.byAccount.set(accountId, set);
    }
    set.add(socket);
  }

  remove(accountId: string, socket: WebSocket): void {
    const set = this.byAccount.get(accountId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.byAccount.delete(accountId);
  }

  socketsForAccount(accountId: string): ReadonlySet<WebSocket> {
    return this.byAccount.get(accountId) ?? EMPTY;
  }

  // Accounts with at least one live socket on this machine — used by the presence
  // heartbeat to refresh their cross-machine presence keys.
  accountIds(): Iterable<string> {
    return this.byAccount.keys();
  }
}

export const hub = new ConnectionHub();
