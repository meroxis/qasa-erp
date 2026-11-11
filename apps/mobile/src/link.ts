import {
  fromB64, phoneHandshake, ProtocolError, toB64, type KeyPair, type RefusalCode, type Session
} from './protocol';

/**
 * The phone's side of the link to the office PC: tries the office's addresses on the Wi-Fi first, then — when the
 * office is reachable over the internet — Qasa Relay (wss://…/v1/phone?office=ID), does the handshake from
 * protocol.ts, then sends requests ({id, m, p, b, k?}) and matches the answers ({id, s, b}). Everything on the wire is
 * encrypted and authenticated end to end with the office's key from the QR code (pinned: no other key is accepted);
 * the WebSocket only carries the bytes (plain ws:// on the Wi-Fi is fine for that reason, and the relay can't read
 * anything).
 *
 * A link that drops (the Wi-Fi went, the office PC slept, the relay restarted) connects again by itself, sooner at
 * first and then less often, and at once when the app comes back to the screen (resume()).
 */

/** Meroxis' relay; a test build can point elsewhere with EXPO_PUBLIC_QASA_RELAY_URL (inlined by Expo at build time). */
export const DEFAULT_RELAY_URL = 'wss://relay.qasaerp.com';

/** The relay to use: the build's own when it is a wss:// address (never plain ws:// over the internet). */
export function relayBase(fromBuild: string | undefined = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_QASA_RELAY_URL : undefined): string {
  const chosen = fromBuild && /^wss:\/\/[a-z0-9.-]+(:\d{1,5})?\/?$/i.test(fromBuild) ? fromBuild : DEFAULT_RELAY_URL;
  return chosen.replace(/\/+$/, '');
}

/** Where to reach an office through the relay ("ABCDE-FGH23" as shown, or without the dash). */
export function relayPhoneUrl(base: string, officeId: string): string {
  return `${base.replace(/\/+$/, '')}/v1/phone?office=${encodeURIComponent(officeId.replace(/-/g, '').toUpperCase())}`;
}

export interface OfficeInfo {
  /** the office's static public key from the QR code (base64url) */
  serverKey: string;
  addresses: string[];
  port: number;
  relay: string | null;
  deviceId: string | null;
  company: string;
}

/** What the link needs from a WebSocket (React Native's, the browser's or a test double). */
export interface SocketLike {
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: Uint8Array): void;
  close(): void;
}

export type LinkState = 'offline' | 'connecting' | 'online' | 'refused';
/** How the phone reaches the office now. */
export type Route = 'lan' | 'relay';

export interface Answer<T = unknown> { s: number; b: T }

export class LinkError extends Error {
  constructor(readonly code: RefusalCode | 'refused' | 'unreachable' | 'timeout' | 'closed' | 'tampered' | 'bad_message' | 'out_of_order') {
    super(code);
  }
}

/** On the Wi-Fi an office answers at once: give up on an address quickly and move on (or to the relay). */
const LAN_TIMEOUT_MS = 2500;
/** Through the relay the office opens a connection for the phone first: allow longer. */
const RELAY_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 20_000;
/**
 * Over the relay a small message this often keeps the link open while the app is in use: the relay sits behind
 * Cloudflare, which closes a connection that has been quiet for 100 s (the phone would then show itself offline).
 */
const KEEPALIVE_MS = 45_000;
/** Waits between tries to connect again, each with a fifth either way at random (phones of one office spread out). */
export const RECONNECT_MS = [1000, 2000, 5000, 10_000, 30_000, 60_000];
/** Refusals that pass by themselves (the office is busy, or this phone tried too often): tried again later. */
const PASSING: readonly string[] = ['too_many', 'busy'];

function bytesOf(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

export class OfficeLink {
  private socket: SocketLike | null = null;
  private session: Session | null = null;
  private nextId = 1;
  private waiting = new Map<number, { resolve(a: Answer): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private connecting: Promise<void> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private tries = 0;
  private paused = false;
  private closed = false;
  state: LinkState = 'offline';
  via: Route | null = null;

  constructor(private readonly options: {
    office: OfficeInfo;
    phone: KeyPair;
    name: string;
    /** first pairing only (from the QR code) */
    pairing?: { id: string; secret: Uint8Array } | undefined;
    socket: (url: string) => SocketLike;
    /** the relay to use when the office is reachable over the internet (default: Meroxis' relay) */
    relayUrl?: string | undefined;
    onState?: ((state: LinkState, detail?: string, via?: Route | null) => void) | undefined;
    /** the office's answer on first pairing: keep the device id and company name */
    onPaired?: ((deviceId: string, company: string) => void) | undefined;
    /** tests: how often the relay link is kept alive */
    keepAliveMs?: number | undefined;
    /** connect again by itself after a drop (default true); tests: the waits between tries */
    reconnect?: boolean | undefined;
    reconnectMs?: readonly number[] | undefined;
  }) {}

  private setState(state: LinkState, detail?: string) {
    this.state = state;
    if (state !== 'online') this.via = null;
    this.options.onState?.(state, detail, this.via);
  }

  /** Connects (once at a time): each LAN address in turn, then the relay. */
  connect(): Promise<void> {
    if (this.state === 'online') return Promise.resolve();
    if (this.closed) return Promise.reject(new LinkError('closed'));
    this.clearRetry();
    if (!this.connecting) {
      this.connecting = this.tryAll().finally(() => { this.connecting = null; });
    }
    return this.connecting;
  }

  /** The places to try, in order: the office's Wi-Fi addresses, then the relay when the office is on it. */
  routes(): { url: string; timeoutMs: number; relay?: true }[] {
    const { addresses, port, relay } = this.options.office;
    const list: { url: string; timeoutMs: number; relay?: true }[] = addresses.map((address) => ({ url: `ws://${address}:${port}/phone`, timeoutMs: LAN_TIMEOUT_MS }));
    if (relay) list.push({ url: relayPhoneUrl(this.options.relayUrl ?? relayBase(), relay), timeoutMs: RELAY_TIMEOUT_MS, relay: true });
    return list;
  }

  private async tryAll(): Promise<void> {
    this.setState('connecting');
    let last: LinkError = new LinkError('unreachable');
    for (const route of this.routes()) {
      try {
        await this.tryOne(route.url, route.timeoutMs);
        if (route.relay) this.startKeepAlive();
        this.via = route.relay ? 'relay' : 'lan';
        this.tries = 0;
        this.setState('online');
        return;
      } catch (error) {
        last = error instanceof LinkError ? error : new LinkError('unreachable');
        // a refusal from the office itself is final (no point trying the other addresses)
        if (last.code !== 'unreachable' && last.code !== 'timeout') break;
      }
    }
    const passing = last.code === 'unreachable' || last.code === 'timeout' || PASSING.includes(last.code);
    this.setState(passing ? 'offline' : 'refused', last.code);
    if (passing) this.scheduleReconnect();
    throw last;
  }

  private tryOne(url: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = this.options.socket(url);
      socket.binaryType = 'arraybuffer';
      const hs = phoneHandshake({
        serverPublicKey: fromB64(this.options.office.serverKey), phone: this.options.phone, name: this.options.name, pairing: this.options.pairing
      });
      const fail = (e: LinkError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket.close(); } catch { /* already closed */ }
        reject(e);
      };
      const timer = setTimeout(() => fail(new LinkError('timeout')), timeoutMs);
      socket.onopen = () => socket.send(hs.message1);
      socket.onerror = () => fail(new LinkError('unreachable'));
      socket.onclose = () => {
        if (!settled) fail(new LinkError('unreachable'));
        else this.dropped(socket);
      };
      socket.onmessage = (e) => {
        const data = bytesOf(e.data);
        if (!data) return;
        if (!settled) {
          try {
            const done = hs.finish(data);
            this.session = done.session;
            this.socket = socket;
            settled = true;
            clearTimeout(timer);
            if (this.options.pairing) {
              this.options.onPaired?.(done.deviceId, done.company);
              this.options.pairing = undefined;
            }
            // the first message proves this phone's key to the office (and spends a pairing code)
            void this.send({ m: 'hello' }).then(() => resolve(), (err: unknown) => reject(err));
          } catch (error) {
            fail(new LinkError(error instanceof ProtocolError ? error.code : 'refused'));
          }
          return;
        }
        this.received(data);
      };
    });
  }

  private received(data: Uint8Array) {
    let message: Record<string, unknown>;
    try {
      message = this.session!.open(data);
    } catch {
      // altered or out of order: the session can't be trusted any more
      this.socket?.close();
      return;
    }
    const id = typeof message.id === 'number' ? message.id : -1;
    const wait = this.waiting.get(id);
    if (!wait) return;
    this.waiting.delete(id);
    clearTimeout(wait.timer);
    wait.resolve({ s: typeof message.s === 'number' ? message.s : 0, b: message.b });
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    const socket = this.socket;
    this.keepAlive = setInterval(() => {
      if (this.socket !== socket) return this.stopKeepAlive();
      void this.send({ m: 'hello' }).catch(() => {});
    }, this.options.keepAliveMs ?? KEEPALIVE_MS);
  }

  private stopKeepAlive() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** The next try to connect, later each time (not while the app is in the background, or after close()). */
  private scheduleReconnect() {
    if (this.closed || this.paused || this.options.reconnect === false || this.retryTimer) return;
    const waits = this.options.reconnectMs ?? RECONNECT_MS;
    const base = waits[Math.min(this.tries, waits.length - 1)] ?? 60_000;
    this.tries += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect().catch(() => {});
    }, Math.round(base * (0.8 + Math.random() * 0.4)));
  }

  private dropped(socket: SocketLike) {
    if (this.socket !== socket) return;
    this.stopKeepAlive();
    this.socket = null;
    this.session = null;
    for (const [, w] of this.waiting) {
      clearTimeout(w.timer);
      w.reject(new LinkError('closed'));
    }
    this.waiting.clear();
    this.setState('offline');
    this.scheduleReconnect();
  }

  private send(body: { m: string; p?: string; b?: unknown; k?: string }): Promise<Answer> {
    if (!this.socket || !this.session) return Promise.reject(new LinkError('closed'));
    const id = this.nextId++;
    const socket = this.socket;
    return new Promise<Answer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new LinkError('timeout'));
        // no answer in 20 s: the connection is gone without saying so (another network, a sleeping PC); start again
        if (this.socket === socket) socket.close();
      }, REQUEST_TIMEOUT_MS);
      this.waiting.set(id, { resolve, reject, timer });
      socket.send(this.session!.seal({ id, ...body }));
    });
  }

  /**
   * One request to the office's API (connecting first if needed). `key`: the change's own key (a UUID v4) when it may
   * be sent again; the office makes it once (x-qasa-idempotency).
   */
  async request<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'count', path?: string, body?: unknown, key?: string): Promise<Answer<T>> {
    await this.connect();
    return (await this.send({ m: method, ...(path ? { p: path } : {}), ...(body !== undefined ? { b: body } : {}), ...(key ? { k: key } : {}) })) as Answer<T>;
  }

  /** The app went to the background: no tries to connect until it is back. */
  pause(): void {
    this.paused = true;
    this.clearRetry();
  }

  /** The app is on the screen again: connect now if the link is down (and start the waits from the shortest). */
  resume(): void {
    this.paused = false;
    this.tries = 0;
    if (this.state !== 'online' && this.state !== 'refused' && !this.closed) void this.connect().catch(() => {});
  }

  /** Unpairing: tells the office (when it can be reached within a few seconds) to forget this phone, then closes. */
  async unpair(timeoutMs = 4000): Promise<boolean> {
    let told = false;
    if (this.state === 'online') {
      told = await Promise.race([
        this.send({ m: 'bye' }).then((a) => a.s === 200, () => false),
        new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs))
      ]);
    }
    this.close();
    return told;
  }

  close(): void {
    this.closed = true;
    this.clearRetry();
    this.stopKeepAlive();
    const s = this.socket;
    this.socket = null;
    this.session = null;
    s?.close();
    this.setState('offline');
  }
}

/** The phone's own key: kept in the phone's secure storage as base64url. */
export const keyToText = (k: KeyPair) => toB64(k.secretKey);
