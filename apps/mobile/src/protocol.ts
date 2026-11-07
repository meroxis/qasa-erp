/**
 * Qasa phone link, version 1: how the Qasa phone app and the office PC talk, encrypted and authenticated end to end,
 * without TLS certificates (phones can't pin a self-signed certificate in a WebView or fetch, and the office has no
 * public name). The same file runs on both sides: here (Node, the office) and in apps/mobile (React Native), copied
 * there by apps/mobile/scripts/sync-protocol.mjs — keep it free of Node and React Native imports.
 *
 * Keys: X25519 for agreement, HKDF-SHA256 for keys, ChaCha20-Poly1305 for every message (all from @noble, audited,
 * pure JS). The office has a static key S; its public half reaches the phone only through the QR code on the office's
 * screen. Each phone has its own static key P, made on the phone and never sent anywhere but here.
 *
 * Handshake (phone → office, office → phone):
 *   1. phone: 0x01 | E (its new ephemeral public key) | AEAD(k1, n=0, {p: P, t: now, n: name, i?: pairing id,
 *      x?: proof}, aad = E), where k1 = HKDF(DH(E, S), salt = H(name of the protocol | S)) — only the real office
 *      (holding S's secret) can read it. On first pairing, proof = HMAC(pairing secret from the QR, E | P | S).
 *   2. office: 0x02 | F (its ephemeral public key) | AEAD(k_down, n=0, {ok, d: device id, c: company}, aad = F).
 *      The session keys come from DH(E,S) | DH(P,S) | DH(E,F) | DH(P,F): the office is proven by S, the phone by P
 *      (nobody without P's secret can read message 2 or send a valid message after it), and F/E give forward secrecy.
 *   Refusals: 0x03 | code (plain text, no secrets).
 * Messages after that: AEAD with the direction's key and a counter as nonce (12 bytes, big-endian in the last 8);
 * the receiver expects exactly the next counter, so a replayed, dropped or reordered message ends the session.
 * The office treats the phone as proven (and spends a pairing secret) only on its first valid message.
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export const PROTOCOL = 'QasaPhone1';
/** How far the phone's clock may be from the office's (handshake freshness). */
export const MAX_SKEW_MS = 5 * 60_000;
/** The largest message either side accepts (a picture is about 400 KB as base64). */
export const MAX_MESSAGE = 1024 * 1024;

export type RefusalCode =
  | 'bad_message' | 'stale' | 'unknown_device' | 'pairing_invalid' | 'plan_limit' | 'phone_limit' | 'too_many' | 'busy';

export class ProtocolError extends Error {
  constructor(readonly code: RefusalCode | 'refused' | 'out_of_order' | 'tampered') {
    super(code);
  }
}

export interface KeyPair { secretKey: Uint8Array; publicKey: Uint8Array }

export function generateKeyPair(): KeyPair {
  const secretKey = randomBytes(32);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export const publicKeyOf = (secretKey: Uint8Array): Uint8Array => x25519.getPublicKey(secretKey);

// ——— bytes and text, without Buffer (React Native has none) ———

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += ALPHABET[n & 63]!;
  }
  return out;
}

export function fromB64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (!/^[A-Za-z0-9_-]*$/.test(clean) || clean.length % 4 === 1) throw new ProtocolError('bad_message');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (ALPHABET.indexOf(clean[i]!) << 18) | (ALPHABET.indexOf(clean[i + 1]!) << 12)
      | ((i + 2 < clean.length ? ALPHABET.indexOf(clean[i + 2]!) : 0) << 6) | (i + 3 < clean.length ? ALPHABET.indexOf(clean[i + 3]!) : 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out;
}

/** UTF-8 to text (written out: TextDecoder isn't in every React Native engine). Bad sequences become U+FFFD. */
function utf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]!;
    let cp = 0xfffd;
    let n = 1;
    if (b < 0x80) cp = b;
    else if (b >= 0xc2 && b < 0xe0 && i + 1 < bytes.length) { cp = ((b & 0x1f) << 6) | (bytes[i + 1]! & 0x3f); n = 2; }
    else if (b >= 0xe0 && b < 0xf0 && i + 2 < bytes.length) { cp = ((b & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f); n = 3; }
    else if (b >= 0xf0 && b < 0xf5 && i + 3 < bytes.length) {
      cp = ((b & 0x07) << 18) | ((bytes[i + 1]! & 0x3f) << 12) | ((bytes[i + 2]! & 0x3f) << 6) | (bytes[i + 3]! & 0x3f);
      n = 4;
    }
    out += String.fromCodePoint(cp > 0x10ffff ? 0xfffd : cp);
    i += n;
  }
  return out;
}

const json = (value: unknown) => utf8ToBytes(JSON.stringify(value));

function parseJson(bytes: Uint8Array): Record<string, unknown> {
  try {
    const value = JSON.parse(utf8(bytes)) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch {
    throw new ProtocolError('bad_message');
  }
}

/** Constant-time comparison. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function nonce(counter: number): Uint8Array {
  const n = new Uint8Array(12);
  let c = counter;
  for (let i = 11; i >= 4; i--) {
    n[i] = c & 255;
    c = Math.floor(c / 256);
  }
  return n;
}

const salt1 = (serverPub: Uint8Array) => sha256(concatBytes(utf8ToBytes(PROTOCOL), serverPub));
const firstKey = (dh: Uint8Array, serverPub: Uint8Array) => hkdf(sha256, dh, salt1(serverPub), utf8ToBytes(`${PROTOCOL}/k1`), 32);

export function pairingProof(secret: Uint8Array, ephemeral: Uint8Array, phonePub: Uint8Array, serverPub: Uint8Array): Uint8Array {
  return hmac(sha256, secret, concatBytes(ephemeral, phonePub, serverPub));
}

function sessionKeys(parts: Uint8Array[], serverPub: Uint8Array, e: Uint8Array, p: Uint8Array, f: Uint8Array): { up: Uint8Array; down: Uint8Array } {
  const salt = sha256(concatBytes(utf8ToBytes(PROTOCOL), serverPub, e, p, f));
  const okm = hkdf(sha256, concatBytes(...parts), salt, utf8ToBytes(`${PROTOCOL}/keys`), 64);
  return { up: okm.slice(0, 32), down: okm.slice(32, 64) };
}

/** One direction of an established session: a key and the next counter. */
export class Session {
  private sendCounter = 0;
  private receiveCounter = 0;

  constructor(private readonly sendKey: Uint8Array, private readonly receiveKey: Uint8Array, sendFrom = 0, receiveFrom = 0) {
    this.sendCounter = sendFrom;
    this.receiveCounter = receiveFrom;
  }

  seal(message: unknown): Uint8Array {
    const out = chacha20poly1305(this.sendKey, nonce(this.sendCounter)).encrypt(json(message));
    this.sendCounter++;
    return out;
  }

  /** Throws (and the caller ends the session) on a replayed, reordered, altered or oversized message. */
  open(data: Uint8Array): Record<string, unknown> {
    if (data.length > MAX_MESSAGE + 16) throw new ProtocolError('bad_message');
    let plain: Uint8Array;
    try {
      plain = chacha20poly1305(this.receiveKey, nonce(this.receiveCounter)).decrypt(data);
    } catch {
      throw new ProtocolError('tampered');
    }
    this.receiveCounter++;
    return parseJson(plain);
  }
}

// ——— the phone's side ———

export interface PhoneHello {
  serverPublicKey: Uint8Array;
  phone: KeyPair;
  name: string;
  /** first pairing: from the QR code */
  pairing?: { id: string; secret: Uint8Array } | undefined;
  now?: number | undefined;
}

export interface PhoneHandshake {
  message1: Uint8Array;
  /** Reads the office's answer: the session, or a ProtocolError with the office's refusal code. */
  finish(message2: Uint8Array): { session: Session; deviceId: string; company: string };
}

export function phoneHandshake(hello: PhoneHello): PhoneHandshake {
  const e = generateKeyPair();
  const S = hello.serverPublicKey;
  const k1 = firstKey(x25519.getSharedSecret(e.secretKey, S), S);
  const body: Record<string, unknown> = { p: toB64(hello.phone.publicKey), t: hello.now ?? Date.now(), n: hello.name.slice(0, 80) };
  if (hello.pairing) {
    body.i = hello.pairing.id;
    body.x = toB64(pairingProof(hello.pairing.secret, e.publicKey, hello.phone.publicKey, S));
  }
  const message1 = concatBytes(new Uint8Array([1]), e.publicKey, chacha20poly1305(k1, nonce(0), e.publicKey).encrypt(json(body)));
  return {
    message1,
    finish(message2) {
      if (message2[0] === 3) throw new ProtocolError(refusal(message2));
      if (message2[0] !== 2 || message2.length < 1 + 32 + 16) throw new ProtocolError('bad_message');
      const f = message2.slice(1, 33);
      const keys = sessionKeys([
        x25519.getSharedSecret(e.secretKey, S), x25519.getSharedSecret(hello.phone.secretKey, S),
        x25519.getSharedSecret(e.secretKey, f), x25519.getSharedSecret(hello.phone.secretKey, f)
      ], S, e.publicKey, hello.phone.publicKey, f);
      let reply: Record<string, unknown>;
      try {
        reply = parseJson(chacha20poly1305(keys.down, nonce(0), f).decrypt(message2.slice(33)));
      } catch {
        throw new ProtocolError('tampered');
      }
      if (reply.ok !== true || typeof reply.d !== 'string') throw new ProtocolError('bad_message');
      // the office's message 2 used counter 0 downwards
      return { session: new Session(keys.up, keys.down, 0, 1), deviceId: reply.d, company: typeof reply.c === 'string' ? reply.c : '' };
    }
  };
}

function refusal(message: Uint8Array): RefusalCode | 'refused' {
  const code = utf8(message.slice(1, 40));
  const known: RefusalCode[] = ['bad_message', 'stale', 'unknown_device', 'pairing_invalid', 'plan_limit', 'phone_limit', 'too_many', 'busy'];
  return (known as string[]).includes(code) ? (code as RefusalCode) : 'refused';
}

export const refusalMessage = (code: RefusalCode): Uint8Array => concatBytes(new Uint8Array([3]), utf8ToBytes(code));

// ——— the office's side ———

export interface PhoneClaim {
  phonePublicKey: Uint8Array;
  name: string;
  /** set on first pairing (already checked against the pairing secret) */
  pairingId: string | null;
}

export interface OfficeAnswer {
  claim: PhoneClaim;
  /** the reply to send, and the session — once the device id is known */
  accept(deviceId: string, company: string): { message2: Uint8Array; session: Session };
}

/**
 * Reads message 1. `pairingSecret(id)` gives a pending pairing's secret (null if unknown or expired). Throws
 * ProtocolError with the code to refuse with. Whether a known phone is still allowed is the caller's to check.
 */
export function officeHandshake(message1: Uint8Array, server: KeyPair, pairingSecret: (id: string) => Uint8Array | null, now = Date.now()): OfficeAnswer {
  if (message1.length < 1 + 32 + 16 || message1.length > 4096 || message1[0] !== 1) throw new ProtocolError('bad_message');
  const e = message1.slice(1, 33);
  const S = server.publicKey;
  let body: Record<string, unknown>;
  try {
    body = parseJson(chacha20poly1305(firstKey(x25519.getSharedSecret(server.secretKey, e), S), nonce(0), e).decrypt(message1.slice(33)));
  } catch {
    throw new ProtocolError('bad_message');
  }
  if (typeof body.p !== 'string' || typeof body.t !== 'number' || typeof body.n !== 'string') throw new ProtocolError('bad_message');
  if (Math.abs(now - body.t) > MAX_SKEW_MS) throw new ProtocolError('stale');
  const P = fromB64(body.p);
  if (P.length !== 32) throw new ProtocolError('bad_message');
  let pairingId: string | null = null;
  if (body.i !== undefined) {
    if (typeof body.i !== 'string' || typeof body.x !== 'string') throw new ProtocolError('bad_message');
    const secret = pairingSecret(body.i);
    if (!secret || !sameBytes(fromB64(body.x), pairingProof(secret, e, P, S))) throw new ProtocolError('pairing_invalid');
    pairingId = body.i;
  }
  return {
    claim: { phonePublicKey: P, name: body.n.slice(0, 80), pairingId },
    accept(deviceId, company) {
      const f = generateKeyPair();
      const keys = sessionKeys([
        x25519.getSharedSecret(server.secretKey, e), x25519.getSharedSecret(server.secretKey, P),
        x25519.getSharedSecret(f.secretKey, e), x25519.getSharedSecret(f.secretKey, P)
      ], S, e, P, f.publicKey);
      const message2 = concatBytes(new Uint8Array([2]), f.publicKey, chacha20poly1305(keys.down, nonce(0), f.publicKey).encrypt(json({ ok: true, d: deviceId, c: company })));
      return { message2, session: new Session(keys.down, keys.up, 1, 0) };
    }
  };
}

// ——— the QR code on the office's screen ———

export interface PairingCode {
  /** office addresses on the LAN and the phone port */
  addresses: string[];
  port: number;
  /** Qasa Relay office id, when the office is reachable over the internet */
  relay: string | null;
  serverPublicKey: Uint8Array;
  pairingId: string;
  pairingSecret: Uint8Array;
  company: string;
}

export const QR_PREFIX = 'qasa-phone:1:';

export function encodePairingCode(c: PairingCode): string {
  return QR_PREFIX + toB64(json({ a: c.addresses, p: c.port, r: c.relay, k: toB64(c.serverPublicKey), i: c.pairingId, s: toB64(c.pairingSecret), c: c.company }));
}

export function decodePairingCode(text: string): PairingCode | null {
  if (!text.startsWith(QR_PREFIX)) return null;
  try {
    const v = parseJson(fromB64(text.slice(QR_PREFIX.length)));
    if (!Array.isArray(v.a) || typeof v.p !== 'number' || typeof v.k !== 'string' || typeof v.i !== 'string' || typeof v.s !== 'string') return null;
    const key = fromB64(v.k);
    if (key.length !== 32) return null;
    return {
      addresses: v.a.filter((x): x is string => typeof x === 'string').slice(0, 8),
      port: v.p,
      relay: typeof v.r === 'string' ? v.r : null,
      serverPublicKey: key,
      pairingId: v.i,
      pairingSecret: fromB64(v.s),
      company: typeof v.c === 'string' ? v.c : ''
    };
  } catch {
    return null;
  }
}
