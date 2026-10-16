import { CLOSE_KICKED, CLOSE_REPLACED, CLOSE_ROOM_CLOSED, type Ping } from "./protocol";

const DEFAULT_RELAY_URL = "wss://mc-relay.learnsvenska.com/ws";
const PING_MS = 25_000; // Cloudflare/nginx drop idle WebSockets (~100 s / 1 h)
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

/** `?relay=` (dev/testing) overrides VITE_RELAY_URL, which overrides the production relay. */
export function relayUrl(): string {
  return new URLSearchParams(location.search).get("relay") ?? import.meta.env.VITE_RELAY_URL ?? DEFAULT_RELAY_URL;
}

/** Per-tab storage (survives a reload, not a new tab) for the host/player tokens and host state. */
export type SessionKey = "host" | "player";

export function loadSession<T>(key: SessionKey): T | null {
  try {
    return JSON.parse(sessionStorage.getItem(`mcgp.mp.${key}`) ?? "null") as T | null;
  } catch {
    return null;
  }
}

export function saveSession(key: SessionKey, value: unknown): void {
  sessionStorage.setItem(`mcgp.mp.${key}`, JSON.stringify(value));
}

export function clearSession(key: SessionKey): void {
  sessionStorage.removeItem(`mcgp.mp.${key}`);
}

export interface ConnectionHandlers<In> {
  /** Called on every (re)connection: send `create`/`join` here. */
  onOpen(): void;
  onMessage(msg: In): void;
  /** Connection lost; a reconnect is scheduled. */
  onDrop(): void;
  /** The relay closed us for good (kicked, replaced by another tab, room closed): no reconnect. */
  onEnd(code: number): void;
}

/**
 * WebSocket with JSON messages, keepalive ping, and automatic reconnect with backoff until close().
 * Messages sent while disconnected are dropped: callers resend their state from onOpen.
 */
export class Connection<In extends { t: string }, Out extends { t: string }> {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private pingTimer = 0;
  private retryTimer = 0;

  constructor(
    private readonly url: string,
    private readonly handlers: ConnectionHandlers<In>,
  ) {
    this.connect();
  }

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: Out | Ping): void {
    if (this.open) this.ws!.send(JSON.stringify(msg));
  }

  /** Intentional close: no reconnect. */
  close(): void {
    this.closed = true;
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.retryTimer);
    this.ws?.close(1000);
    this.ws = null;
  }

  private connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.pingTimer = window.setInterval(() => this.send({ t: "ping" }), PING_MS);
      this.handlers.onOpen();
    };
    ws.onmessage = (e) => {
      let msg: In | Ping;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.t === "ping") this.send({ t: "pong" });
      else if (msg.t !== "pong") this.handlers.onMessage(msg as In);
    };
    ws.onclose = (e) => {
      window.clearInterval(this.pingTimer);
      if (this.closed || this.ws !== ws) return;
      this.ws = null;
      if (e.code === CLOSE_KICKED || e.code === CLOSE_REPLACED || e.code === CLOSE_ROOM_CLOSED) {
        this.closed = true;
        this.handlers.onEnd(e.code);
        return;
      }
      this.handlers.onDrop();
      const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
      this.attempt++;
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
    };
  }
}
