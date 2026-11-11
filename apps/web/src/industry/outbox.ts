import { ApiError, isNetworkError, newIdempotencyKey, onLinkChange, request, serverReachable, setReachable } from '../api.ts';

/**
 * The outbox of a PC connected to an office server (1.2), as the app window sees it. The list itself is kept by the
 * Windows app, encrypted on this PC (apps/desktop/src/outbox.ts); this sends it again, oldest first, with the same
 * idempotency key, so the office server books each one once:
 *
 * - only what the signed-in person made is sent (in their session, so the books say who did it); an admin sees and
 *   may discard everyone's;
 * - when the server can't be reached, it waits and tries again, sooner first, then every few minutes (BACKOFF_MS);
 * - a refusal that isn't about the link (a rule, stock, a closed shift) stays in the list, marked for a person, and the
 *   others go on; nothing is ever dropped without a person's discard, written to the audit log.
 *
 * In the browser, on the office server PC itself and in the website demo there is no outbox: everything is online, as
 * before 1.2.
 */

export type OutboxKind = 'pos_sale' | 'voucher';
export interface OutboxErrorView { status: number; code: string; details: unknown }
export interface OutboxEntry {
  id: string;
  seq: number;
  kind: OutboxKind;
  path: string;
  body: Record<string, unknown>;
  books: string;
  createdAt: string;
  user: { id: string | null; name: string };
  reference: string | null;
  summary: { total: number; currency: 'IQD' | 'USD'; lines: number; register: string | null };
  state: 'waiting' | 'refused';
  attempts: number;
  lastTriedAt: string | null;
  error: OutboxErrorView | null;
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

type Answer<T> = { ok: true; value: T } | { ok: false; error: string };

/** The Windows app's side (app-preload.ts → qasaDesktop.outbox). */
export interface OutboxBridge {
  status(): Promise<unknown>;
  list(): Promise<unknown>;
  add(entry: unknown): Promise<unknown>;
  result(id: string, outcome: unknown): Promise<unknown>;
  retry(id: string): Promise<unknown>;
  discard(id: string): Promise<unknown>;
  onChange?(listener: (status: unknown) => void): () => void;
}

/** Waits between tries while the server can't be reached: 2 s, 5 s, 10 s, 30 s, 1 min, 2 min, then every 5 min. */
export const BACKOFF_MS = [2_000, 5_000, 10_000, 30_000, 60_000, 120_000, 300_000] as const;
export const backoffDelay = (failures: number): number => BACKOFF_MS[Math.min(Math.max(failures, 1), BACKOFF_MS.length) - 1]!;
/**
 * A till sale or receipt that can be kept on the PC gives up on a server that doesn't answer within this, and is kept
 * (sent later with the same key, so booked once). What can't be kept (a sale on a customer's account) waits for the answer.
 */
export const SALE_TIMEOUT_MS = 12_000;
/** An entry the server keeps failing (500s) on is put before a person after this many tries. */
export const MAX_SERVER_FAILURES = 8;

/**
 * The key a document is sent with, held for every try of that same document until one is confirmed (booked, or kept
 * on this PC). A try whose answer was lost (no answer in time, the link went) may have been booked: the next try with
 * the same key is answered by the server from the first, so it is never booked twice. `of` is what the document asks
 * for; a changed document (another line, amount, customer or payment) is another document with a key of its own.
 * `lost`: a try with this key went out and no answer came, so it may be booked already. `allowExpired`: a till sale
 * the cashier confirmed with stock past its expiry date, sent so every time after (the server compares the body).
 */
export interface HeldKey { key: string; of: string; lost: boolean; allowExpired?: true }

/** A document as text with its keys in order, so the same document always reads the same. */
export function documentText(doc: unknown): string {
  return JSON.stringify(doc, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : v)) ?? '';
}

/** The key for `doc`: the one held while it is the same document, else a new one. */
export function holdKey(held: HeldKey | null, doc: unknown, make: () => string = newIdempotencyKey): HeldKey {
  const of = documentText(doc);
  return held && held.of === of ? held : { key: make(), of, lost: false };
}

/** What a try's outcome means for the entry. */
export type Verdict =
  | { kind: 'sent' }
  /** not reached (or no answer in time): try again later, the same way */
  | { kind: 'offline' }
  /** the session ended: wait for the person to sign in again */
  | { kind: 'signed_out' }
  /** the server had a problem of its own or was busy: try again later, and count it */
  | { kind: 'failed'; error: OutboxErrorView }
  /** the server said no, for a reason a person must look at */
  | { kind: 'refused'; error: OutboxErrorView };

export function verdictOf(error: unknown): Verdict {
  if (isNetworkError(error)) return { kind: 'offline' };
  if (error instanceof ApiError) {
    const view = { status: error.status, code: error.code, details: error.details ?? null };
    if (error.status === 401) return { kind: 'signed_out' };
    if (error.status === 429 || error.status >= 500) return { kind: 'failed', error: view };
    return { kind: 'refused', error: view };
  }
  return { kind: 'failed', error: { status: 0, code: 'internal', details: null } };
}

/** The person the app is signed in as (or, without sign-in, the owner named on this PC). */
export interface Who { id: string | null; name: string; admin: boolean }
export const madeBy = (entry: Pick<OutboxEntry, 'user'>, who: Pick<Who, 'id' | 'name'> | null): boolean =>
  !!who && (entry.user.id !== null || who.id !== null ? entry.user.id === who.id : entry.user.name === who.name);

const asAnswer = <T,>(value: unknown): Answer<T> => {
  const v = value as Answer<T> | null;
  return v && typeof v === 'object' && 'ok' in v ? v : { ok: false, error: 'outbox_unavailable' };
};
const unwrap = <T,>(value: unknown): T => {
  const a = asAnswer<T>(value);
  if (!a.ok) throw new ApiError(0, a.error, null);
  return a.value;
};

export interface OutboxState {
  available: boolean;
  /** the server answered the last request */
  online: boolean;
  /** sending now */
  sending: boolean;
  entries: OutboxEntry[];
  damaged: boolean;
  /** when the next try is (ISO), while something waits */
  nextTry: string | null;
}

export interface OutboxDeps {
  bridge: OutboxBridge;
  /** sends one entry as it was made, with its key and books (the app's own request) */
  send(entry: OutboxEntry): Promise<unknown>;
  /** is the server there? (only asked while nothing of this person's waits) */
  probe(): Promise<boolean>;
  /** the id of the company books the server keeps (GET /api/outbox/books): what is kept is stamped with it */
  books(): Promise<string>;
  who(): Who | null;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Sends what waits, in order, and keeps the window's picture of the list. One per window (outboxClient()).
 */
export class Outbox {
  private state: OutboxState = { available: true, online: serverReachable(), sending: false, entries: [], damaged: false, nextTry: null };
  private listeners = new Set<(s: OutboxState) => void>();
  private failures = 0;
  private timer: unknown = null;
  private running: Promise<void> | null = null;
  /** asked again while a pass was running: one more pass after it (a sale kept meanwhile goes too) */
  private again = false;
  private stopped = false;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly deps: OutboxDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get snapshot(): OutboxState {
    return this.state;
  }

  private booksId: string | null = null;

  /** The books what is kept now is made for: asked once from the server (null while it was never reached). */
  async books(): Promise<string | null> {
    if (this.booksId) return this.booksId;
    try {
      const id = await this.deps.books();
      if (/^[0-9a-f]{32}$/.test(id)) this.booksId = id;
    } catch { /* asked again later */ }
    return this.booksId;
  }

  subscribe(fn: (s: OutboxState) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private set(patch: Partial<OutboxState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** Reads the list again from the Windows app. */
  async refresh(): Promise<OutboxEntry[]> {
    const [list, status] = await Promise.all([this.deps.bridge.list(), this.deps.bridge.status()]);
    const entries = unwrap<OutboxEntry[]>(list);
    const s = status as Partial<OutboxStatus> | null;
    this.set({ entries, damaged: !!s?.damaged, available: s?.available !== false });
    return entries;
  }

  /** The entries the person signed in now may send (theirs, waiting), oldest first. */
  mineWaiting(who = this.deps.who()): OutboxEntry[] {
    return this.state.entries.filter((e) => e.state === 'waiting' && madeBy(e, who)).sort((a, b) => a.seq - b.seq);
  }

  /** Keeps one on this PC (the till's sale, a receipt). Answers it with its reference; throws when the PC can't keep it. */
  async add(entry: NewOutboxEntry): Promise<OutboxEntry> {
    const kept = unwrap<OutboxEntry>(await this.deps.bridge.add(entry));
    await this.refresh().catch(() => {});
    this.kick();
    return kept;
  }

  /** The server answered or was reached: try now (a person pressed Send, the link came back, someone signed in). */
  kick(): void {
    if (this.stopped) return;
    if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
    this.failures = Math.min(this.failures, 1);
    void this.run();
  }

  /** Any request found the server there or not (api.ts): the picture follows, and what waits goes when it is back. */
  linkChanged(up: boolean): void {
    this.set({ online: up });
    if (up) this.kick();
    else if (this.timer === null && !this.running) { this.failures = Math.max(this.failures, 1); this.schedule(); }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.stopped) return;
    if (this.timer !== null) this.clearTimer(this.timer);
    const wait = backoffDelay(this.failures);
    this.set({ nextTry: new Date(this.now() + wait).toISOString() });
    this.timer = this.setTimer(() => { this.timer = null; void this.run(); }, wait);
  }

  /** One pass: everything of this person's that waits, in order, until the link fails. */
  run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.pass();
      } while (this.again && !this.stopped && this.timer === null);
    })().finally(() => { this.running = null; });
    return this.running;
  }

  private async pass(): Promise<void> {
    try {
      await this.refresh();
    } catch {
      return;
    }
    const who = this.deps.who();
    const mine = this.mineWaiting(who);
    if (serverReachable() && !this.booksId) await this.books();
    if (!mine.length) {
      // nothing to send: while the server is away, look now and then, so the till knows when it is back
      if (!serverReachable()) {
        const up = await this.deps.probe().catch(() => false);
        if (up) { this.failures = 0; setReachable(true); this.set({ online: true, nextTry: null }); return; }
        this.failures += 1;
        this.set({ online: false });
        this.schedule();
      } else {
        this.set({ online: true, nextTry: null });
      }
      return;
    }
    this.set({ sending: true });
    try {
      for (const entry of mine) {
        let verdict: Verdict;
        try {
          await this.deps.send(entry);
          verdict = { kind: 'sent' };
        } catch (error) {
          verdict = verdictOf(error);
        }
        if (verdict.kind === 'sent') {
          this.failures = 0;
          await this.deps.bridge.result(entry.id, { kind: 'sent' });
          this.set({ online: true });
          continue;
        }
        if (verdict.kind === 'offline') {
          this.failures += 1;
          this.set({ online: false });
          this.schedule();
          return;
        }
        if (verdict.kind === 'signed_out') return; // sent once they sign in again (kick)
        if (verdict.kind === 'failed') {
          // the server is there but could not do it now: try again later; after many tries it waits for a person
          const tooMany = entry.attempts + 1 >= MAX_SERVER_FAILURES;
          await this.deps.bridge.result(entry.id, tooMany ? { kind: 'refused', error: verdict.error } : { kind: 'failed', error: verdict.error });
          this.failures += 1;
          this.set({ online: true });
          if (!tooMany) { this.schedule(); return; }
          continue;
        }
        // refused for a reason of its own: kept for a person, the next ones go on
        await this.deps.bridge.result(entry.id, { kind: 'refused', error: verdict.error });
        this.set({ online: true });
      }
      this.set({ nextTry: null });
    } finally {
      await this.refresh().catch(() => {});
      this.set({ sending: false });
    }
  }

  /** A person asks for one to go now (a refused one is put back in the line first). */
  async retry(id: string): Promise<void> {
    const entry = this.state.entries.find((e) => e.id === id);
    if (entry?.state === 'refused') unwrap(await this.deps.bridge.retry(id));
    await this.refresh().catch(() => {});
    this.kick();
  }

  /**
   * An admin discards one, after the confirmation: written to the company's audit log on the office server first, so
   * it needs the server; only then is it removed from this PC.
   */
  async discard(id: string, reason: string): Promise<{ booked: string | null }> {
    const entry = this.state.entries.find((e) => e.id === id);
    if (!entry) throw new ApiError(404, 'outbox_missing', null);
    const answer = await request<{ recorded: boolean; booked: string | null }>('POST', '/api/outbox/discarded', discardRecord(entry, reason));
    unwrap(await this.deps.bridge.discard(id));
    await this.refresh().catch(() => {});
    return { booked: answer.booked };
  }
}

/** What the audit log keeps of a discarded entry: what it was, who made it, why it wasn't booked. */
export function discardRecord(entry: OutboxEntry, reason: string): Record<string, unknown> {
  const refusal = entry.error && /^[a-z0-9_]{1,64}$/.test(refusalCode(entry.error)) ? refusalCode(entry.error) : undefined;
  return {
    key: entry.id, kind: entry.kind, ...(entry.reference ? { reference: entry.reference } : {}), total: entry.summary.total,
    currency: entry.summary.currency, lines: entry.summary.lines, madeBy: entry.user.name.slice(0, 100), madeAt: entry.createdAt,
    ...(refusal ? { refusal } : {}), ...(reason.trim() ? { reason: reason.trim().slice(0, 500) } : {})
  };
}

/** The refusal in one word: a validation's first rule ("stock_insufficient"), else the error's own code. */
export function refusalCode(error: OutboxErrorView): string {
  if (error.code === 'validation' && Array.isArray(error.details)) {
    const first = (error.details as { code?: unknown }[])[0]?.code;
    if (typeof first === 'string') return first;
  }
  return error.code;
}

// ——— one per window ———

let client: Outbox | null = null;
let whoNow: () => Who | null = () => null;

/** Who the app is signed in as now (App.tsx keeps it current). */
export function setOutboxUser(fn: () => Who | null): void {
  whoNow = fn;
}

/** The person the app is signed in as, as the outbox and the till's memory know them. */
export function outboxWho(): Who | null {
  return whoNow();
}

/** The key the till's memory is kept under for this person. */
export const whoKey = (who: Pick<Who, 'id' | 'name'> | null): string | null => (who ? (who.id ? `user:${who.id}` : `name:${who.name}`) : null);

/** The window's outbox, on a PC connected to an office server; null everywhere else. */
export function outboxClient(): Outbox | null {
  return client;
}

/** Asks the Windows app whether this PC keeps an outbox, and starts sending it. Once per window. */
export async function startOutbox(): Promise<Outbox | null> {
  if (client) return client;
  const bridge = typeof window !== 'undefined' ? (window as unknown as { qasaDesktop?: { outbox?: OutboxBridge } }).qasaDesktop?.outbox : undefined;
  if (!bridge) return null;
  const status = (await bridge.status().catch(() => null)) as Partial<OutboxStatus> | null;
  if (!status?.available) return null;
  const box = new Outbox({
    bridge,
    send: (entry) => request('POST', entry.path, entry.body, { key: entry.id, books: entry.books, timeoutMs: SALE_TIMEOUT_MS }),
    probe: async () => { try { await request('GET', '/api/health', undefined, { timeoutMs: 5_000 }); return true; } catch { return false; } },
    books: async () => (await request<{ books: string }>('GET', '/api/outbox/books', undefined, { timeoutMs: 8_000 })).books,
    who: () => whoNow()
  });
  client = box;
  void box.books();
  bridge.onChange?.(() => { void box.refresh().catch(() => {}); });
  // the link came back (any answer from the server): send what waits
  onLinkChange((up) => box.linkChanged(up));
  box.kick();
  return box;
}

/** For tests: forget the window's outbox. */
export function resetOutboxForTests(): void {
  client?.stop();
  client = null;
}
