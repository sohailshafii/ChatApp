import {
  clientWsMessageSchema,
  serverWsMessageSchema,
  type ClientWsMessage,
  type ServerWsMessage,
} from '@chatapp/shared';

// Single per-tab WebSocket to /ws (§3). Same-origin in production; in dev the
// Vite proxy forwards /ws to the backend (cookies + Origin carry through, so the
// server's upgrade auth passes). Reconnects with capped backoff while running.

export type SocketStatus = 'connecting' | 'open' | 'closed';

type FrameListener = (frame: ServerWsMessage) => void;
type StatusListener = (status: SocketStatus) => void;

const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

function socketUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/ws`;
}

export class ChatSocket {
  private ws: WebSocket | null = null;
  private status: SocketStatus = 'closed';
  private running = false;
  private reconnectMs = INITIAL_RECONNECT_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly frameListeners = new Set<FrameListener>();
  private readonly statusListeners = new Set<StatusListener>();

  /** Open the connection and keep it open (reconnecting) until stop(). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.open();
  }

  /** Close and stop reconnecting. */
  stop(): void {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus('closed');
  }

  /** Send a frame; returns false if the socket isn't open. */
  send(frame: ClientWsMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    // Validate locally so a malformed frame fails fast rather than at the server.
    const parsed = clientWsMessageSchema.safeParse(frame);
    if (!parsed.success) return false;
    this.ws.send(JSON.stringify(parsed.data));
    return true;
  }

  subscribe(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private open(): void {
    this.setStatus('connecting');
    const ws = new WebSocket(socketUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectMs = INITIAL_RECONNECT_MS;
      this.setStatus('open');
    };
    ws.onmessage = (event) => {
      let json: unknown;
      try {
        json = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        return;
      }
      const parsed = serverWsMessageSchema.safeParse(json);
      if (!parsed.success) return;
      for (const listener of this.frameListeners) listener(parsed.data);
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      this.ws = null;
      this.setStatus('closed');
      if (this.running) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.reconnectMs;
    this.reconnectMs = Math.min(this.reconnectMs * 2, MAX_RECONNECT_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.running) this.open();
    }, delay);
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}
