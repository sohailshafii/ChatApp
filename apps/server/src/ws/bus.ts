import { WebSocket } from 'ws';
import type { Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import type { ServerWsMessage } from '@chatapp/shared';
import { loadConfig } from '../config.js';
import { appLog } from '../log.js';
import { getRedis } from '../redis/client.js';
import { hub } from './hub.js';
import { MACHINE_ID } from './presence.js';

// Cross-machine WS fan-out (multi-machine scale-out, Half B bus — docs/multi-machine.md).
//
// The local `hub` only reaches sockets on this process. To deliver a frame to a
// recipient connected to ANOTHER machine, we publish it on a Redis channel; every
// machine subscribes and writes incoming frames to its own local sockets.
//
// Backend by REDIS_URL (like the limiters/presence):
//   - LocalBus (N=1): write straight to local sockets — exactly today's behavior.
//   - RedisBus: write to local sockets immediately (no round trip), AND publish to
//     the bus so other machines deliver to theirs. Each envelope is tagged with the
//     origin machine id; a machine ignores its own published frames on receipt (it
//     already delivered them locally), which also keeps a bot stream to a local user
//     entirely off Redis on the receive side.
//
// Delivery is best-effort (Redis pub/sub is at-most-once): messages are persisted
// before fan-out and clients backfill history on reconnect, so a dropped live frame
// self-heals — no need for streams/consumer groups in v1.

const CHANNEL = 'ws:bus';

type BusEnvelope = {
  o: string; // origin machine id
  a: readonly string[]; // target account ids
  f: ServerWsMessage; // the frame
};

// Write a frame to this machine's local sockets for the given accounts, optionally
// skipping one socket (the originating tab, which is always local to the publisher).
function deliverLocal(
  accountIds: readonly string[],
  frame: ServerWsMessage,
  except?: WebSocket,
): void {
  const payload = JSON.stringify(frame);
  for (const account of accountIds) {
    for (const socket of hub.socketsForAccount(account)) {
      if (socket === except) continue;
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }
}

export interface MessageBus {
  publish(
    accountIds: readonly string[],
    frame: ServerWsMessage,
    except?: WebSocket,
  ): void;
}

class LocalBus implements MessageBus {
  publish(
    accountIds: readonly string[],
    frame: ServerWsMessage,
    except?: WebSocket,
  ): void {
    deliverLocal(accountIds, frame, except);
  }
}

export class RedisBus implements MessageBus {
  constructor(
    private readonly redis: () => Redis | null = getRedis,
    private readonly machineId: string = MACHINE_ID,
  ) {}

  publish(
    accountIds: readonly string[],
    frame: ServerWsMessage,
    except?: WebSocket,
  ): void {
    deliverLocal(accountIds, frame, except);
    const r = this.redis();
    if (!r) return;
    const envelope: BusEnvelope = { o: this.machineId, a: accountIds, f: frame };
    // Fire-and-forget; best-effort (see header).
    r.publish(CHANNEL, JSON.stringify(envelope)).catch((err) =>
      appLog().error({ err }, 'ws bus publish failed'),
    );
  }
}

export const bus: MessageBus = loadConfig().redisConfigured
  ? new RedisBus()
  : new LocalBus();

// Deliver a frame received from the bus to local sockets — unless we published it
// ourselves (already delivered locally in publish()). Exported for tests.
export function deliverFromBus(raw: string, selfMachineId: string): void {
  let env: BusEnvelope;
  try {
    env = JSON.parse(raw) as BusEnvelope;
  } catch (err) {
    appLog().error({ err }, 'ws bus message parse failed');
    return;
  }
  if (env.o === selfMachineId) return; // our own echo
  deliverLocal(env.a, env.f);
}

// Subscribe this machine to the bus so frames from other machines reach our local
// sockets. No-op without Redis. Uses a dedicated connection (ioredis subscriber
// mode is exclusive). Returns a stop fn. Started from index.ts.
export async function startMessageBus(
  log: FastifyBaseLogger,
): Promise<() => void> {
  if (!loadConfig().redisConfigured) return () => {};
  const base = getRedis();
  if (!base) return () => {};
  const sub = base.duplicate();
  sub.on('error', (err: Error) => log.error({ err }, 'ws bus subscriber error'));
  sub.on('message', (_channel, raw) => deliverFromBus(raw, MACHINE_ID));
  await sub.subscribe(CHANNEL);
  log.info('ws bus subscribed');
  return () => {
    void sub.quit();
  };
}
