import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LinkError, OfficeLink, relayPhoneUrl, type OfficeInfo, type SocketLike } from '../src/link';
import { generateKeyPair, officeHandshake, refusalMessage, toB64, type Session } from '../src/protocol';

/** An office in the test: answers the handshake and then requests, like pro/src/phone/phone.ts. */
function fakeOffice(options: { refuse?: 'pairing_invalid' | 'unknown_device'; reply?: (m: Record<string, unknown>) => { s: number; b: unknown } } = {}) {
  const key = generateKeyPair();
  const secret = new Uint8Array(32).fill(9);
  const sockets: FakeSocket[] = [];
  class FakeSocket implements SocketLike {
    binaryType = 'blob';
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private session: Session | null = null;
    constructor(readonly url: string) {
      sockets.push(this);
      setTimeout(() => this.onopen?.(), 0);
    }
    send(data: Uint8Array) {
      const deliver = (bytes: Uint8Array) => setTimeout(() => this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }), 0);
      if (!this.session) {
        if (options.refuse) return deliver(refusalMessage(options.refuse));
        const answer = officeHandshake(data, key, (id) => (id === 'pair-1' ? secret : null));
        const accepted = answer.accept('device-7', 'Meroxis');
        this.session = accepted.session;
        return deliver(accepted.message2);
      }
      const m = this.session.open(data);
      const r = m.m === 'hello' ? { s: 200, b: { ok: true } } : options.reply?.(m) ?? { s: 200, b: { echo: m.p } };
      deliver(this.session.seal({ id: m.id, ...r }));
    }
    close() {
      setTimeout(() => this.onclose?.(), 0);
    }
  }
  const office: OfficeInfo = { serverKey: toB64(key.publicKey), addresses: ['10.0.0.9'], port: 47421, relay: null, deviceId: null, company: '' };
  return { office, secret, sockets, socket: (url: string) => new FakeSocket(url) };
}

describe('the phone app\'s link to the office', () => {
  it('pairs with the QR code, keeps the device id, and sends requests', async () => {
    const o = fakeOffice();
    let paired: [string, string] | null = null;
    const link = new OfficeLink({
      office: o.office, phone: generateKeyPair(), name: 'Samsung', pairing: { id: 'pair-1', secret: o.secret }, socket: o.socket,
      onPaired: (d, c) => { paired = [d, c]; }
    });
    await link.connect();
    expect(link.state).toBe('online');
    expect(paired).toEqual(['device-7', 'Meroxis']);
    expect(o.sockets[0]!.url).toBe('ws://10.0.0.9:47421/phone');
    expect(await link.request('GET', '/api/items?q=123')).toEqual({ s: 200, b: { echo: '/api/items?q=123' } });
    expect(await link.request('GET', '/api/settings')).toEqual({ s: 200, b: { echo: '/api/settings' } });
  });

  it('reports the office\'s refusal, and an unreachable office', async () => {
    const refusing = fakeOffice({ refuse: 'pairing_invalid' });
    const states: string[] = [];
    const link = new OfficeLink({ office: refusing.office, phone: generateKeyPair(), name: 'x', socket: refusing.socket, onState: (s) => states.push(s) });
    await expect(link.connect()).rejects.toMatchObject({ code: 'pairing_invalid' });
    expect(states.at(-1)).toBe('refused');

    const silent = new OfficeLink({
      office: { ...refusing.office, addresses: ['10.0.0.1'] }, phone: generateKeyPair(), name: 'x',
      socket: () => {
        const s: SocketLike = { binaryType: '', onopen: null, onmessage: null, onclose: null, onerror: null, send() {}, close() {} };
        setTimeout(() => s.onerror?.(), 0);
        return s;
      }
    });
    await expect(silent.connect()).rejects.toBeInstanceOf(LinkError);
    expect(silent.state).toBe('offline');
  });

  it('tries the Wi-Fi first, then Qasa Relay when the office is on it', async () => {
    const o = fakeOffice();
    const unreachable = (url: string): SocketLike => {
      const s: SocketLike & { url: string } = { url, binaryType: '', onopen: null, onmessage: null, onclose: null, onerror: null, send() {}, close() {} };
      setTimeout(() => s.onerror?.(), 0);
      return s;
    };
    const tried: string[] = [];
    const link = new OfficeLink({
      office: { ...o.office, addresses: ['10.0.0.9', '192.168.1.5'], relay: 'ABCDE-FGH23' }, phone: generateKeyPair(), name: 'x',
      pairing: { id: 'pair-1', secret: o.secret }, relayUrl: 'wss://relay.test/',
      // the office isn't on this Wi-Fi: only the relay answers
      socket: (url) => { tried.push(url); return url.startsWith('wss://') ? o.socket(url) : unreachable(url); }
    });
    await link.connect();
    expect(link.state).toBe('online');
    expect(tried).toEqual(['ws://10.0.0.9:47421/phone', 'ws://192.168.1.5:47421/phone', 'wss://relay.test/v1/phone?office=ABCDEFGH23']);
    expect(await link.request('GET', '/api/items')).toEqual({ s: 200, b: { echo: '/api/items' } });
  });

  it('stops at a refusal from the office on the Wi-Fi (no relay try), and needs no relay when the office has none', async () => {
    const refusing = fakeOffice({ refuse: 'unknown_device' });
    const tried: string[] = [];
    const link = new OfficeLink({
      office: { ...refusing.office, relay: 'ABCDE-FGH23' }, phone: generateKeyPair(), name: 'x',
      socket: (url) => { tried.push(url); return refusing.socket(url); }
    });
    await expect(link.connect()).rejects.toMatchObject({ code: 'unknown_device' });
    expect(tried).toEqual(['ws://10.0.0.9:47421/phone']);
    expect(new OfficeLink({ office: refusing.office, phone: generateKeyPair(), name: 'x', socket: refusing.socket }).routes()).toHaveLength(1);
    expect(relayPhoneUrl('wss://relay.qasaerp.com', 'abcde-fgh23')).toBe('wss://relay.qasaerp.com/v1/phone?office=ABCDEFGH23');
  });

  it('keeps a relay link from going quiet (Cloudflare closes one after 100 s), but not a Wi-Fi one', async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (const viaRelay of [true, false]) {
      const o = fakeOffice();
      let sent = 0;
      const link = new OfficeLink({
        office: viaRelay ? { ...o.office, addresses: [], relay: 'ABCDE-FGH23' } : o.office, phone: generateKeyPair(), name: 'x',
        pairing: { id: 'pair-1', secret: o.secret }, relayUrl: 'wss://relay.test', keepAliveMs: 20,
        socket: (url) => {
          const s = o.socket(url);
          const send = s.send.bind(s);
          s.send = (d) => { sent += 1; send(d); };
          return s;
        }
      });
      await link.connect();
      const before = sent;
      await sleep(130);
      if (viaRelay) expect(sent - before).toBeGreaterThanOrEqual(3);
      else expect(sent).toBe(before);
      expect(link.state).toBe('online');
      link.close();
      const after = sent;
      await sleep(60);
      expect(sent).toBe(after);
    }
  });

  it('the app\'s copy of the protocol is the Pro module\'s (when pro/ is here)', () => {
    const source = join(__dirname, '..', '..', '..', 'pro', 'src', 'phone', 'protocol.ts');
    if (!existsSync(source)) return;
    expect(readFileSync(join(__dirname, '..', 'src', 'protocol.ts'), 'utf8')).toBe(readFileSync(source, 'utf8'));
  });
});
