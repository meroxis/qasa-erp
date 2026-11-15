import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { fromB64, toB64 } from './protocol';
import { UUID_V4, uuidV4 } from './uuid';

/**
 * The outbox: sales, orders, receipts and counts made on the phone (1.1: expenses with the photo of their receipt,
 * stock transfers and goods that arrived), kept until the office has them. Each is written to
 * the phone's storage before it is first sent, encrypted (ChaCha20-Poly1305, with a key kept in the phone's secure
 * storage), so nothing made on the phone is lost when the Wi-Fi drops, the office PC is off or the app is closed.
 *
 * Each change has its own key (a UUID v4) from the moment it is made, and is sent with it every time
 * (x-qasa-idempotency at the office): when an answer is lost on the way and the phone sends the change again, the
 * office makes it once.
 */

/** 1.1: an expense (with the photo of its receipt), a stock transfer and goods that arrived against a purchase order. */
export type OutboxKind = 'sale' | 'order' | 'receipt' | 'count' | 'countSession' | 'expense' | 'transfer' | 'arrival';
export const OUTBOX_KINDS: readonly OutboxKind[] = ['sale', 'order', 'receipt', 'count', 'countSession', 'expense', 'transfer', 'arrival'];

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
  /** what the office said with that refusal (its numbers: a line, the days allowed), for the text that explains it */
  errorDetail?: Record<string, string | number> | undefined;
  /**
   * A receipt (1.1: or an expense) that went later, from the waiting list: the office has it, and this says what it made
   * of it — 'posted' (in the books at once) or 'waiting' (it counts once approved). Kept (without its body) to be shown
   * under Waiting to send until the user clears it; never sent again.
   */
  result?: 'posted' | 'waiting' | undefined;
  /** when the office took it (with `result`) */
  sentAt?: string | undefined;
  /**
   * 1.1: a photo (an expense's receipt) kept beside the item in a file of its own, encrypted with the outbox's key and
   * bound to this item: sent with it, and removed when it is sent, removed or wiped
   */
  blob?: boolean | undefined;
}

/** Still to go to the office (not refused, not already sent). */
export const isPending = (i: Pick<OutboxItem, 'error' | 'result'>) => !i.error && !i.result;

/** The office's answer to a receipt: in the books (approved), or not yet (waiting for approval, or a draft to check). */
export const receiptPosted = (answer: unknown) => (answer as { status?: unknown } | null)?.status === 'approved';

/** How many sent receipts' results are kept to show (the oldest go first). */
export const RESULTS_MAX = 20;

/** The kinds whose result is kept when they went later: what the office made of them (posted, or not yet). */
const KEEPS_RESULT: readonly OutboxKind[] = ['receipt', 'expense'];

/** The most items with a photo kept at once (each is a few hundred KB on the phone, encrypted). */
export const PHOTOS_MAX = 10;

/** Where the outbox lives: a file, and its key in the phone's secure storage (store.ts; a stand-in in tests). */
export interface OutboxStorage {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  remove(): Promise<void>;
  readKey(): Promise<string | null>;
  writeKey(key: string): Promise<void>;
  removeKey(): Promise<void>;
  /** 1.1: a photo kept beside an item (its sealed text), by the item's id; storage without them takes no photos */
  readBlob?(id: string): Promise<string | null>;
  writeBlob?(id: string, text: string): Promise<void>;
  removeBlob?(id: string): Promise<void>;
  /** the ids of the photos kept, for the sweep of those whose item is gone */
  listBlobs?(): Promise<string[]>;
  removeBlobs?(): Promise<void>;
}

const FORMAT = 'qasa-outbox:1:';
const AAD = utf8ToBytes('qasa-outbox/1');
const BLOB_FORMAT = 'qasa-outbox-blob:1:';
/** A photo is bound to its item: opened with another item's id (a file swapped on the phone), it reads as nothing. */
const blobAad = (id: string) => utf8ToBytes(`qasa-outbox-blob/1|${id}`);

/** A photo (base64 text) sealed for its item with the outbox's key. */
export function sealBlob(id: string, text: string, key: Uint8Array): string {
  if (!/^[A-Za-z0-9+/=]*$/.test(text)) throw new Error('blob_invalid');
  const nonce = randomBytes(12);
  const sealed = chacha20poly1305(key, nonce, blobAad(id)).encrypt(utf8ToBytes(text));
  const out = new Uint8Array(12 + sealed.length);
  out.set(nonce);
  out.set(sealed, 12);
  return BLOB_FORMAT + toB64(out);
}

/** The photo kept for an item, or null when it can't be read (another key, another item's, altered). */
export function openBlob(id: string, sealed: string, key: Uint8Array): string | null {
  if (!sealed.startsWith(BLOB_FORMAT)) return null;
  try {
    const bytes = fromB64(sealed.slice(BLOB_FORMAT.length));
    return ascii(chacha20poly1305(key, bytes.subarray(0, 12), blobAad(id)).decrypt(bytes.subarray(12)));
  } catch {
    return null;
  }
}

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
export type Outcome = 'sent' | 'wait' | { refused: string; detail?: Record<string, string | number> | undefined };

/** A detail of a refusal, kept to explain it: its plain numbers and words only (a few, short). */
function detailOf(d: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(d).slice(0, 8)) {
    if (k === 'code' || !/^\w{1,32}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 64);
  }
  return out;
}

/**
 * How the office's answer (or its absence) counts: not reachable, busy (429, 5xx) or the same change still being made
 * (409 in_progress) → try again later; any other refusal (4xx) → kept with its reason, not sent again by itself. A
 * validation refusal keeps the code of its first detail and that detail's numbers (1.1), so it can say what was wrong.
 */
export function outcomeOf(error: unknown): Exclude<Outcome, 'sent'> {
  const e = error as { status?: unknown; code?: unknown; details?: unknown } | null;
  if (!e || typeof e.status !== 'number') return 'wait';
  if (e.status === 429 || e.status >= 500 || e.status === 0 || (e.status === 409 && e.code === 'in_progress')) return 'wait';
  const first = e.code === 'validation' && Array.isArray(e.details) ? e.details[0] as Record<string, unknown> | undefined : undefined;
  if (first && typeof first === 'object' && typeof first.code === 'string' && /^[\w.]{1,64}$/.test(first.code)) {
    return { refused: first.code, detail: detailOf(first) };
  }
  return { refused: typeof e.code === 'string' && e.code ? e.code.slice(0, 64) : String(e.status) };
}

/**
 * Sends one change to the office; resolves with the office's answer, throws its refusal (or the link's failure).
 * `blob`: the photo kept for the item (an expense's receipt), read when the sender needs it.
 */
export type Sender = (item: OutboxItem, blob: () => Promise<string | null>) => Promise<unknown>;

export interface ReplayResult { sent: number; refused: number; receipts: OutboxItem[]; expenses: OutboxItem[] }

/** The most items kept (a phone offline for weeks must not fill its storage). */
export const OUTBOX_MAX = 500;

export class Outbox {
  private items: OutboxItem[] = [];
  private key: Uint8Array | null = null;
  private writing: Promise<void> = Promise.resolve();
  private replaying: Promise<ReplayResult> | null = null;

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

  /**
   * Reads the outbox from storage (at start). An outbox that can't be read is left as it is, and a new one starts. A
   * photo whose item is gone (the app stopped between the two writes, or after a send) is removed.
   */
  async load(): Promise<OutboxItem[]> {
    const key = await this.ensureKey();
    const text = await this.storage.read();
    this.items = (text && openOutbox(text, key)) || [];
    this.onChange(this.list());
    if (this.storage.listBlobs && this.storage.removeBlob) {
      const kept = new Set(this.items.filter((i) => i.blob).map((i) => i.id));
      for (const id of await this.storage.listBlobs().catch(() => [] as string[])) if (!kept.has(id)) await this.storage.removeBlob(id).catch(() => {});
    }
    return this.list();
  }

  /** The photo kept for an item (null: none, or it can't be read any more). */
  async blobOf(item: Pick<OutboxItem, 'id' | 'blob'>): Promise<string | null> {
    if (!item.blob || !this.storage.readBlob) return null;
    const sealed = await this.storage.readBlob(item.id);
    return sealed ? openBlob(item.id, sealed, await this.ensureKey()) : null;
  }

  /** Items with a photo kept beside them now. */
  photos(): number {
    return this.items.filter((i) => i.blob).length;
  }

  private async dropBlob(item: OutboxItem | undefined): Promise<void> {
    if (item?.blob && this.storage.removeBlob) await this.storage.removeBlob(item.id).catch(() => {});
  }

  list(): OutboxItem[] {
    return this.items.map((i) => ({ ...i }));
  }

  /** Waiting to be sent (refused ones and sent receipts' results aside). */
  waiting(): number {
    return this.items.filter(isPending).length;
  }

  private save(): Promise<void> {
    const snapshot = this.list();
    this.onChange(snapshot);
    this.writing = this.writing.then(async () => this.storage.write(sealOutbox(snapshot, await this.ensureKey())));
    return this.writing;
  }

  /**
   * A new change, written to storage before anything is sent. `blob` (1.1): a photo kept beside it (base64), written
   * first and encrypted on its own; at most PHOTOS_MAX such items wait at once.
   */
  async add(kind: OutboxKind, body: unknown, summary: OutboxSummary, target?: string, blob?: string): Promise<OutboxItem> {
    if (this.items.length >= OUTBOX_MAX) throw new Error('outbox_full');
    const item: OutboxItem = { id: uuidV4(), kind, body, summary, createdAt: new Date().toISOString(), attempts: 0, ...(target ? { target } : {}) };
    if (blob !== undefined) {
      if (!this.storage.writeBlob || !this.storage.readBlob || !this.storage.removeBlob) throw new Error('outbox_blobs_unsupported');
      if (this.photos() >= PHOTOS_MAX) throw new Error('outbox_photos_full');
      await this.storage.writeBlob(item.id, sealBlob(item.id, blob, await this.ensureKey()));
      item.blob = true;
    }
    this.items.push(item);
    try {
      await this.save();
    } catch (error) {
      // not kept: its photo goes too
      this.items = this.items.filter((i) => i.id !== item.id);
      await this.dropBlob(item);
      throw error;
    }
    return { ...item };
  }

  async remove(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    this.items = this.items.filter((i) => i.id !== id);
    await this.save();
    await this.dropBlob(item);
  }

  /** A refused change, to be sent again (after the problem was fixed at the office). */
  async retry(id: string): Promise<void> {
    this.items = this.items.map((i) => (i.id === id ? { ...i, error: undefined, errorDetail: undefined } : i));
    await this.save();
  }

  /**
   * One try. `keepResult`: a receipt (or an expense) that goes (from the waiting list, with nobody on its screen) stays
   * listed with what the office made of it, posted or waiting for approval; one sent from its own screen is told there.
   * A photo kept with the item goes once the office has the item.
   */
  private async tryOne(item: OutboxItem, send: Sender, keepResult = false): Promise<Outcome> {
    let outcome: Outcome;
    let answer: unknown;
    try {
      answer = await send(item, () => this.blobOf(item));
      outcome = 'sent';
    } catch (error) {
      outcome = outcomeOf(error);
    }
    if (outcome === 'sent' && keepResult && KEEPS_RESULT.includes(item.kind)) {
      const done: OutboxItem = { ...item, body: null, blob: undefined, result: receiptPosted(answer) ? 'posted' : 'waiting', sentAt: new Date().toISOString() };
      this.items = this.items.map((i) => (i.id === item.id ? done : i));
      const results = this.items.filter((i) => i.result);
      if (results.length > RESULTS_MAX) {
        const drop = new Set(results.slice(0, results.length - RESULTS_MAX).map((i) => i.id));
        this.items = this.items.filter((i) => !drop.has(i.id));
      }
    } else if (outcome === 'sent') this.items = this.items.filter((i) => i.id !== item.id);
    else {
      const refusal = outcome === 'wait' ? {} : { error: outcome.refused, ...(outcome.detail && Object.keys(outcome.detail).length ? { errorDetail: outcome.detail } : {}) };
      this.items = this.items.map((i) => (i.id === item.id ? { ...i, attempts: i.attempts + 1, ...refusal } : i));
    }
    await this.save();
    if (outcome === 'sent') await this.dropBlob(item);
    return outcome;
  }

  /** One change now (just made on a screen), with its key: what became of it. */
  async sendOne(id: string, send: Sender): Promise<Outcome> {
    const item = this.items.find((i) => i.id === id);
    if (!item) return 'sent';
    return this.tryOne(item, send);
  }

  /**
   * Sends what waits, oldest first, each with its own key; stops at the first that can't go now (the office is away
   * or busy), so the order is kept. One run at a time. `receipts`: the receipts that went in this run, with what the
   * office made of each (they also stay listed under Waiting to send until cleared).
   */
  replay(send: Sender): Promise<ReplayResult> {
    if (!this.replaying) {
      this.replaying = (async () => {
        let sent = 0;
        let refused = 0;
        const receipts: OutboxItem[] = [];
        const expenses: OutboxItem[] = [];
        for (const item of this.items.filter(isPending)) {
          const outcome = await this.tryOne(item, send, true);
          if (outcome === 'wait') break;
          if (outcome === 'sent') {
            sent++;
            const done = this.items.find((i) => i.id === item.id && i.result);
            if (done) (done.kind === 'expense' ? expenses : receipts).push({ ...done });
          } else refused++;
        }
        return { sent, refused, receipts, expenses };
      })().finally(() => { this.replaying = null; });
    }
    return this.replaying;
  }

  /** Unpairing: the outbox, its file, its photos and its key are gone. */
  async wipe(): Promise<void> {
    this.items = [];
    this.key = null;
    await this.writing.catch(() => {});
    await this.storage.remove();
    await this.storage.removeBlobs?.();
    await this.storage.removeKey();
    this.onChange([]);
  }
}
