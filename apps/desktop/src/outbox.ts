import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { SecretBox } from './secrets.ts';

/**
 * The outbox of a PC connected to an office server (1.2), kept by the main process (no Electron here, so it can be
 * tested on its own). When the office server can't be reached, the till's sales and the receipt vouchers wait here, on
 * this PC's disk, until the app window sends them again (with the same idempotency key, so the server books each one
 * once). The office server PC itself has no outbox: it keeps its own books.
 *
 * - Encrypted at rest: the whole list is one secret of the desktop app's secret box (secrets.ts, AES-256-GCM under a
 *   key Windows protects for this user), so another Windows user or a copied disk reads nothing.
 * - Power-cut safe: every change writes a new file next to it (written, flushed to the disk, then renamed over the old
 *   one). A cut while writing leaves the last complete list; a newer complete copy not yet renamed is taken at start.
 * - One list per office server (by its pinned certificate): pairing with another server never sends them there.
 * - Never dropped silently: a refusal keeps the entry, marked for a person; only a discard (after the confirmation,
 *   written to the company's audit log first) or a sent answer removes one. A file that can't be read is kept aside.
 */

export const OUTBOX_KINDS = ['pos_sale', 'voucher'] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];
/** Entries kept at most, and the size of one request's body (JSON). */
export const OUTBOX_MAX_ENTRIES = 5000;
export const OUTBOX_MAX_BODY = 256 * 1024;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PATHS: Record<OutboxKind, RegExp> = {
  pos_sale: /^\/api\/pos\/shifts\/[A-Za-z0-9-]{1,64}\/sales$/,
  voucher: /^\/api\/vouchers$/
};
const BOOKS = /^[0-9a-f]{32}$/;

export interface OutboxError { status: number; code: string; details: unknown }

export interface OutboxEntry {
  /** the idempotency key it is sent with, every time */
  id: string;
  /** its place in the line: sent oldest first */
  seq: number;
  kind: OutboxKind;
  path: string;
  body: Record<string, unknown>;
  /** the company books it was made for (x-qasa-books): never sent to other books */
  books: string;
  createdAt: string;
  /** who made it: only they send it (their session), an admin may discard it */
  user: { id: string | null; name: string };
  /** a till's sale: the temporary reference printed on its receipt */
  reference: string | null;
  summary: { total: number; currency: 'IQD' | 'USD'; lines: number; register: string | null };
  /** waiting: sent when the link is back; refused: the server said no, a person decides */
  state: 'waiting' | 'refused';
  attempts: number;
  lastTriedAt: string | null;
  error: OutboxError | null;
}

export interface NewOutboxEntry {
  id: string;
  kind: OutboxKind;
  path: string;
  body: Record<string, unknown>;
  books: string;
  user: { id: string | null; name: string };
  summary: { total: number; currency: 'IQD' | 'USD'; lines: number; register?: string | null };
}

export interface OutboxStatus { available: boolean; waiting: number; refused: number; damaged: boolean }

interface Saved { v: 1; server: string; rev: number; seq: number; counters: Record<string, number>; entries: OutboxEntry[] }

export class OutboxRefusal extends Error {
  constructor(readonly code: 'outbox_invalid' | 'outbox_full' | 'outbox_duplicate' | 'outbox_missing' | 'outbox_unavailable') {
    super(code);
  }
}

/** The register's letters and digits (any script), at most 16: the middle of OFF-<register>-0001. */
export function registerTag(register: string | null | undefined): string {
  const tag = [...String(register ?? '').normalize('NFC').matchAll(/[\p{L}\p{N}]/gu)].map((m) => m[0]).join('').slice(0, 16);
  return tag || 'R';
}

/** The till's date (this PC's own calendar day, as the till showed it). */
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const cleanName = (s: unknown) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100);

/** Writes a file so a power cut leaves either the old one or the new one, whole. */
export function writeDurably(file: string, text: string, deps: { afterWrite?: () => void } = {}): void {
  const tmp = `${file}.next`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    const data = Buffer.from(text, 'utf8');
    let at = 0;
    while (at < data.length) at += writeSync(fd, data, at, data.length - at);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  deps.afterWrite?.();
  renameSync(tmp, file);
  // the folder's entry too, where the system allows it (Windows does not open folders for this)
  try {
    const dir = openSync(join(file, '..'), 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
  } catch { /* not on this system */ }
}

export interface OutboxStore {
  status(): OutboxStatus;
  list(): OutboxEntry[];
  add(entry: NewOutboxEntry, now?: Date): OutboxEntry;
  /** what the server answered: sent (removed), refused (kept for a person), or a failure to try again later */
  result(id: string, outcome: { kind: 'sent' } | { kind: 'refused'; error: OutboxError } | { kind: 'failed'; error?: OutboxError | null }, now?: Date): OutboxEntry | null;
  /** a person asks for a refused one to be sent again */
  retry(id: string): OutboxEntry;
  /** removes one after its discard was written to the audit log */
  discard(id: string): void;
}

/**
 * The outbox for the office server with this certificate fingerprint, in `dir`. `box` encrypts it (secrets.ts); a box
 * that can't protect anything (Windows gave no key) leaves the PC without an outbox, as before 1.2.
 */
export function openOutbox(options: { dir: string; server: string; box: SecretBox; log?: (...args: unknown[]) => void; now?: () => Date }): OutboxStore {
  const log = options.log ?? (() => {});
  const server = String(options.server).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(server)) throw new OutboxRefusal('outbox_unavailable');
  mkdirSync(options.dir, { recursive: true });
  const file = join(options.dir, `outbox-${server.slice(0, 16)}.qob`);
  let damaged = false;

  const read = (path: string): Saved | null => {
    const parsed = JSON.parse(options.box.reveal(readFileSync(path, 'utf8'))) as Saved;
    if (parsed?.v !== 1 || parsed.server !== server || !Array.isArray(parsed.entries) || typeof parsed.counters !== 'object') throw new Error('not an outbox');
    return parsed;
  };

  /** The last complete list: the file, or a newer complete copy a power cut left before it was renamed. */
  function load(): Saved {
    const empty: Saved = { v: 1, server, rev: 0, seq: 0, counters: {}, entries: [] };
    let current: Saved | null = null;
    if (existsSync(file)) {
      try {
        current = read(file);
      } catch (error) {
        // never written over: kept aside for a person, and the PC says so
        const aside = `${file}.damaged-${(options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')}`;
        try { renameSync(file, aside); } catch { /* left where it is; a new list goes beside it */ }
        damaged = true;
        log('the outbox could not be read and was kept aside:', aside, error instanceof Error ? error.message : String(error));
      }
    }
    const next = `${file}.next`;
    if (existsSync(next)) {
      try {
        const copy = read(next);
        if (copy && copy.rev > (current?.rev ?? -1)) {
          renameSync(next, file);
          log('the outbox continues from its last complete write');
          return copy;
        }
      } catch { /* cut while it was written: the list before it stands */ }
      try { unlinkSync(next); } catch { /* removed next time */ }
    }
    return current ?? empty;
  }

  let state = load();

  function save(next: Saved): void {
    next.rev = state.rev + 1;
    writeDurably(file, options.box.protect(JSON.stringify(next)));
    state = next;
  }
  const copy = (): Saved => structuredClone(state);
  const find = (s: Saved, id: string) => s.entries.find((e) => e.id === id);

  return {
    status: () => ({
      available: true,
      waiting: state.entries.filter((e) => e.state === 'waiting').length,
      refused: state.entries.filter((e) => e.state === 'refused').length,
      damaged
    }),
    list: () => structuredClone(state.entries).sort((a, b) => a.seq - b.seq),

    add(input, now = options.now?.() ?? new Date()) {
      const kind = input?.kind;
      if (!(OUTBOX_KINDS as readonly string[]).includes(kind as string)) throw new OutboxRefusal('outbox_invalid');
      const id = String(input.id ?? '').toLowerCase();
      if (!UUID_V4.test(id) || !PATHS[kind].test(String(input.path ?? '')) || !BOOKS.test(String(input.books ?? ''))) throw new OutboxRefusal('outbox_invalid');
      const body = input.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OutboxRefusal('outbox_invalid');
      const s = input.summary;
      if (!s || !isMoney(s.total) || (s.currency !== 'IQD' && s.currency !== 'USD') || !Number.isSafeInteger(s.lines) || s.lines < 0 || s.lines > 1000) throw new OutboxRefusal('outbox_invalid');
      const user = { id: typeof input.user?.id === 'string' ? input.user.id.slice(0, 64) : null, name: cleanName(input.user?.name) };
      if (state.entries.length >= OUTBOX_MAX_ENTRIES) throw new OutboxRefusal('outbox_full');
      if (find(state, id)) throw new OutboxRefusal('outbox_duplicate');
      const next = copy();
      let reference: string | null = null;
      const sent: Record<string, unknown> = structuredClone(body);
      if (kind === 'pos_sale') {
        // the receipt's temporary reference, counted per register on this PC (never reused, also after a restart)
        const tag = registerTag(s.register);
        const n = (next.counters[tag] ?? 0) + 1;
        next.counters[tag] = n;
        reference = `OFF-${tag}-${String(n).padStart(4, '0')}`;
        sent.offline = { reference, soldAt: now.toISOString(), soldOn: localDate(now) };
      }
      if (Buffer.byteLength(JSON.stringify(sent), 'utf8') > OUTBOX_MAX_BODY) throw new OutboxRefusal('outbox_invalid');
      next.seq += 1;
      const entry: OutboxEntry = {
        id, seq: next.seq, kind, path: input.path, body: sent, books: input.books, createdAt: now.toISOString(), user, reference,
        summary: { total: s.total, currency: s.currency, lines: s.lines, register: s.register ? cleanName(s.register) : null },
        state: 'waiting', attempts: 0, lastTriedAt: null, error: null
      };
      next.entries.push(entry);
      save(next);
      return structuredClone(entry);
    },

    result(id, outcome, now = options.now?.() ?? new Date()) {
      const next = copy();
      const entry = find(next, String(id));
      if (!entry) return null;
      if (outcome.kind === 'sent') {
        next.entries = next.entries.filter((e) => e.id !== entry.id);
        save(next);
        return null;
      }
      entry.attempts += 1;
      entry.lastTriedAt = now.toISOString();
      const error = outcome.error ? { status: Number(outcome.error.status) || 0, code: String(outcome.error.code).slice(0, 64), details: outcome.error.details ?? null } : null;
      entry.error = error;
      if (outcome.kind === 'refused') entry.state = 'refused';
      save(next);
      return structuredClone(entry);
    },

    retry(id) {
      const next = copy();
      const entry = find(next, String(id));
      if (!entry) throw new OutboxRefusal('outbox_missing');
      entry.state = 'waiting';
      entry.attempts = 0;
      save(next);
      return structuredClone(entry);
    },

    discard(id) {
      const next = copy();
      if (!find(next, String(id))) throw new OutboxRefusal('outbox_missing');
      next.entries = next.entries.filter((e) => e.id !== String(id));
      save(next);
    }
  };
}
