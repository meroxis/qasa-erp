import {
  fromB64, phoneHandshake, ProtocolError, toB64, type KeyPair, type RefusalCode, type Session
} from './protocol';

/**
 * The phone's side of the link to the office PC: tries the office's addresses on the Wi-Fi, does the handshake from
 * protocol.ts, then sends requests ({id, m, p, b}) and matches the answers ({id, s, b}). Everything on the wire is
 * encrypted; the WebSocket only carries the bytes (plain ws:// is fine for that reason).
 */

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

export interface Answer<T = unknown> { s: number; b: T }

export class LinkError extends Error {
  constructor(readonly code: RefusalCode | 'refused' | 'unreachable' | 'timeout' | 'closed' | 'tampered' | 'bad_message' | 'out_of_order') {
    super(code);
  }
}

const CONNECT_TIMEOUT_MS = 4000;
const REQUEST_TIMEOUT_MS = 20_000;

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
  state: LinkState = 'offline';

  constructor(private readonly options: {
    office: OfficeInfo;
    phone: KeyPair;
    name: string;
    /** first pairing only (from the QR code) */
    pairing?: { id: string; secret: Uint8Array } | undefined;
    socket: (url: string) => SocketLike;
    onState?: ((state: LinkState, detail?: string) => void) | undefined;
    /** the office's answer on first pairing: keep the device id and company name */
    onPaired?: ((deviceId: string, company: string) => void) | undefined;
  }) {}

  private setState(state: LinkState, detail?: string) {
    this.state = state;
    this.options.onState?.(state, detail);
  }

  /** Connects (once at a time): each LAN address in turn. */
  connect(): Promise<void> {
    if (this.state === 'online') return Promise.resolve();
    if (!this.connecting) {
      this.connecting = this.tryAll().finally(() => { this.connecting = null; });
    }
    return this.connecting;
  }

  private async tryAll(): Promise<void> {
    this.setState('connecting');
    let last: LinkError = new LinkError('unreachable');
    for (const address of this.options.office.addresses) {
      try {
        await this.tryOne(`ws://${address}:${this.options.office.port}/phone`);
        this.setState('online');
        return;
      } catch (error) {
        last = error instanceof LinkError ? error : new LinkError('unreachable');
        // a refusal from the office itself is final (no point trying the other addresses)
        if (last.code !== 'unreachable' && last.code !== 'timeout') break;
      }
    }
    this.setState(last.code === 'unreachable' || last.code === 'timeout' ? 'offline' : 'refused', last.code);
    throw last;
  }

  private tryOne(url: string): Promise<void> {
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
      const timer = setTimeout(() => fail(new LinkError('timeout')), CONNECT_TIMEOUT_MS);
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

  private dropped(socket: SocketLike) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.session = null;
    for (const [, w] of this.waiting) {
      clearTimeout(w.timer);
      w.reject(new LinkError('closed'));
    }
    this.waiting.clear();
    this.setState('offline');
  }

  private send(body: { m: string; p?: string; b?: unknown }): Promise<Answer> {
    if (!this.socket || !this.session) return Promise.reject(new LinkError('closed'));
    const id = this.nextId++;
    return new Promise<Answer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new LinkError('timeout'));
      }, REQUEST_TIMEOUT_MS);
      this.waiting.set(id, { resolve, reject, timer });
      this.socket!.send(this.session!.seal({ id, ...body }));
    });
  }

  /** One request to the office's API (connecting first if needed). */
  async request<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'count', path?: string, body?: unknown): Promise<Answer<T>> {
    await this.connect();
    return (await this.send({ m: method, ...(path ? { p: path } : {}), ...(body !== undefined ? { b: body } : {}) })) as Answer<T>;
  }

  close(): void {
    const s = this.socket;
    this.socket = null;
    this.session = null;
    s?.close();
    this.setState('offline');
  }
}

/** The phone's own key: kept in the phone's secure storage as base64url. */
export const keyToText = (k: KeyPair) => toB64(k.secretKey);
