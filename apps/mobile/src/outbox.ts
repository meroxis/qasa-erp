import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { fromB64, toB64 } from './protocol';
import { UUID_V4, uuidV4 } from './uuid';

/**
 * The outbox: sales, orders, receipts and counts made on the phone, kept until the office has them. Each is written to
 * the phone's storage before it is first sent, encrypted (ChaCha20-Poly1305, with a key kept in the phone's secure
 * storage), so nothing made on the phone is lost when the Wi-Fi drops, the office PC is off or the app is closed.
 *
 * Each change has its own key (a UUID v4) from the moment it is made, and is sent with it every time
 * (x-qasa-idempotency at the office): when an answer is lost on the way and the phone sends the change again, the
 * office makes it once.
 */

export type OutboxKind = 'sale' | 'order' | 'receipt' | 'count' | 'countSession';
export const OUTBOX_KINDS: readonly OutboxKind[] = ['sale', 'order', 'receipt', 'count', 'countSession'];

export interface OutboxSummary {
  /** what it is about: the customer's name, the warehouse… (shown in the outbox list) */
  title: string;
  amount?: number | undefined;
  currency?: 'IQD' | 'USD' | undefined;
  lines?: number | undefined;
}

export interface OutboxItem {
  /** the change's key, sent with it every time (a UUID v4) */
  id: string;
  kind: OutboxKind;
  /** for counts into an open count: which one */
  target?: string | undefined;
  body: unknown;
  summary: OutboxSummary;
  createdAt: string;
  attempts: number;
  /** the office's refusal (its error code): kept and shown, not sent again until the user says so */
  error?: string | undefined;
}

/** Where the outbox lives: a file, and its key in the phone's secure storage (store.ts; a stand-in in tests). */
export interface OutboxStorage {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  remove(): Promise<void>;
  readKey(): Promise<string | null>;
  writeKey(key: string): Promise<void>;
  removeKey(): Promise<void>;
}

const FORMAT = 'qasa-outbox:1:';
const AAD = utf8ToBytes('qasa-outbox/1');

/** JSON with everything outside ASCII escaped: the bytes are then plain ASCII, read back without a UTF-8 decoder. */
const asciiJson = (value: unknown) => JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

function ascii(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 4096) out += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return out;
}

export function sealOutbox(items: OutboxItem[], key: Uint8Array): string {
  const nonce = randomBytes(12);
  const sealed = chacha20poly1305(key, nonce, AAD).encrypt(utf8ToBytes(asciiJson(items)));
  const out = new Uint8Array(12 + sealed.length);
  out.set(nonce);
  out.set(sealed, 12);
  return FORMAT + toB64(out);
}

/** The items in a sealed outbox, or null when it can't be read (another key, altered, not an outbox). */
export function openOutbox(text: string, key: Uint8Array): OutboxItem[] | null {
  if (!text.startsWith(FORMAT)) return null;
  try {
    const bytes = fromB64(text.slice(FORMAT.length));
    const plain = chacha20poly1305(key, bytes.subarray(0, 12), AAD).decrypt(bytes.subarray(12));
    const list = JSON.parse(ascii(plain)) as unknown;
    return Array.isArray(list) ? list.filter(isItem) : null;
  } catch {
    return null;
  }
}

function isItem(v: unknown): v is OutboxItem {
  const o = v as Partial<OutboxItem> | null;
  return !!o && typeof o.id === 'string' && UUID_V4.test(o.id) && OUTBOX_KINDS.includes(o.kind as OutboxKind)
    && typeof o.createdAt === 'string' && typeof o.attempts === 'number' && !!o.summary && typeof o.summary.title === 'string';
}

/** What became of one try. */
export type Outcome = 'sent' | 'wait' | { refused: string };

/**
 * How the office's answer (or its absence) counts: not reachable, busy (429, 5xx) or the same change still being made
 * (409 in_progress) → try again later; any other refusal (4xx) → kept with its reason, not sent again by itself.
 */
export function outcomeOf(error: unknown): Exclude<Outcome, 'sent'> {
  const e = error as { status?: unknown; code?: unknown } | null;
  if (!e || typeof e.status !== 'number') return 'wait';
  if (e.status === 429 || e.status >= 500 || e.status === 0 || (e.status === 409 && e.code === 'in_progress')) return 'wait';
  return { refused: typeof e.code === 'string' && e.code ? e.code.slice(0, 64) : String(e.status) };
}

/** The most items kept (a phone offline for weeks must not fill its storage). */
export const OUTBOX_MAX = 500;

export class Outbox {
  private items: OutboxItem[] = [];
  private key: Uint8Array | null = null;
  private writing: Promise<void> = Promise.resolve();
  private replaying: Promise<{ sent: number; refused: number }> | null = null;

  constructor(private readonly storage: OutboxStorage, private readonly onChange: (items: OutboxItem[]) => void = () => {}) {}

  private async ensureKey(): Promise<Uint8Array> {
    if (this.key) return this.key;
    const stored = await this.storage.readKey();
    if (stored) {
      const k = fromB64(stored);
      if (k.length === 32) return (this.key = k);
    }
    const k = randomBytes(32);
    await this.storage.writeKey(toB64(k));
    return (this.key = k);
  }

  /** Reads the outbox from storage (at start). An outbox that can't be read is left as it is, and a new one starts. */
  async load(): Promise<OutboxItem[]> {
    const key = await this.ensureKey();
    const text = await this.storage.read();
    this.items = (text && openOutbox(text, key)) || [];
    this.onChange(this.list());
    return this.list();
  }

  list(): OutboxItem[] {
    return this.items.map((i) => ({ ...i }));
  }

  /** Waiting to be sent (refused ones aside). */
  waiting(): number {
    return this.items.filter((i) => !i.error).length;
  }

  private save(): Promise<void> {
    const snapshot = this.list();
    this.onChange(snapshot);
    this.writing = this.writing.then(async () => this.storage.write(sealOutbox(snapshot, await this.ensureKey())));
    return this.writing;
  }

  /** A new change, written to storage before anything is sent. */
  async add(kind: OutboxKind, body: unknown, summary: OutboxSummary, target?: string): Promise<OutboxItem> {
    if (this.items.length >= OUTBOX_MAX) throw new Error('outbox_full');
    const item: OutboxItem = { id: uuidV4(), kind, body, summary, createdAt: new Date().toISOString(), attempts: 0, ...(target ? { target } : {}) };
    this.items.push(item);
    await this.save();
    return { ...item };
  }

  async remove(id: string): Promise<void> {
    this.items = this.items.filter((i) => i.id !== id);
    await this.save();
  }

  /** A refused change, to be sent again (after the problem was fixed at the office). */
  async retry(id: string): Promise<void> {
    this.items = this.items.map((i) => (i.id === id ? { ...i, error: undefined } : i));
    await this.save();
  }

  private async tryOne(item: OutboxItem, send: (item: OutboxItem) => Promise<void>): Promise<Outcome> {
    let outcome: Outcome;
    try {
      await send(item);
      outcome = 'sent';
    } catch (error) {
      outcome = outcomeOf(error);
    }
    if (outcome === 'sent') this.items = this.items.filter((i) => i.id !== item.id);
    else {
      this.items = this.items.map((i) => (i.id === item.id ? { ...i, attempts: i.attempts + 1, ...(outcome === 'wait' ? {} : { error: outcome.refused }) } : i));
    }
    await this.save();
    return outcome;
  }

  /** One change now (just made on a screen), with its key: what became of it. */
  async sendOne(id: string, send: (item: OutboxItem) => Promise<void>): Promise<Outcome> {
    const item = this.items.find((i) => i.id === id);
    if (!item) return 'sent';
    return this.tryOne(item, send);
  }

  /**
   * Sends what waits, oldest first, each with its own key; stops at the first that can't go now (the office is away
   * or busy), so the order is kept. One run at a time.
   */
  replay(send: (item: OutboxItem) => Promise<void>): Promise<{ sent: number; refused: number }> {
    if (!this.replaying) {
      this.replaying = (async () => {
        let sent = 0;
        let refused = 0;
        for (const item of this.items.filter((i) => !i.error)) {
          const outcome = await this.tryOne(item, send);
          if (outcome === 'wait') break;
          if (outcome === 'sent') sent++;
          else refused++;
        }
        return { sent, refused };
      })().finally(() => { this.replaying = null; });
    }
    return this.replaying;
  }

  /** Unpairing: the outbox, its file and its key are gone. */
  async wipe(): Promise<void> {
    this.items = [];
    this.key = null;
    await this.writing.catch(() => {});
    await this.storage.remove();
    await this.storage.removeKey();
    this.onChange([]);
  }
}
