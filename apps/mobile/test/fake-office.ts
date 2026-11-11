import type { OfficeInfo, SocketLike } from '../src/link';
import { generateKeyPair, officeHandshake, refusalMessage, toB64, type RefusalCode, type Session } from '../src/protocol';

/**
 * An office PC for the app's tests: answers the handshake like pro/src/phone/phone.ts, then the app's requests
 * ({ id, m, p, b, k }), and can go away (drop()) and come back (up = true).
 */
export function fakeOffice(options: {
  refuse?: RefusalCode;
  reply?: (m: Record<string, unknown>) => { s: number; b: unknown } | null;
} = {}) {
  const key = generateKeyPair();
  const secret = new Uint8Array(32).fill(9);
  const sockets: FakeSocket[] = [];
  /** every message the office read, in order */
  const seen: Record<string, unknown>[] = [];
  const state = { up: true };
  class FakeSocket implements SocketLike {
    binaryType = 'blob';
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private session: Session | null = null;
    open = true;
    constructor(readonly url: string) {
      sockets.push(this);
      setTimeout(() => (state.up ? this.onopen?.() : this.onerror?.()), 0);
    }
    send(data: Uint8Array) {
      if (!this.open) return;
      const deliver = (bytes: Uint8Array) => setTimeout(() => this.open && this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }), 0);
      if (!this.session) {
        if (options.refuse) return deliver(refusalMessage(options.refuse));
        const answer = officeHandshake(data, key, (id) => (id === 'pair-1' ? secret : null));
        const accepted = answer.accept('device-7', 'Meroxis');
        this.session = accepted.session;
        return deliver(accepted.message2);
      }
      const m = this.session.open(data);
      seen.push(m);
      const r = m.m === 'hello' ? { s: 200, b: { ok: true } } : options.reply ? options.reply(m) : { s: 200, b: { echo: m.p } };
      // null: the office took it but the answer never arrives (the connection is lost on the way back)
      if (r) deliver(this.session.seal({ id: m.id, ...r }));
    }
    close() {
      if (!this.open) return;
      this.open = false;
      setTimeout(() => this.onclose?.(), 0);
    }
  }
  const office: OfficeInfo = { serverKey: toB64(key.publicKey), addresses: ['10.0.0.9'], port: 47421, relay: null, deviceId: 'device-7', company: 'Meroxis' };
  return {
    office, secret, sockets, seen, state,
    socket: (url: string): SocketLike => new FakeSocket(url),
    /** the office PC goes away: every open connection drops */
    drop() {
      state.up = false;
      for (const s of sockets) s.close();
    }
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out');
    await sleep(5);
  }
}
