import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, setReachable } from '../api.ts';
import {
  BACKOFF_MS, backoffDelay, discardRecord, madeBy, MAX_SERVER_FAILURES, Outbox, refusalCode, verdictOf,
  type NewOutboxEntry, type OutboxBridge, type OutboxEntry, type Who
} from './outbox.ts';

/** The Windows app's outbox (apps/desktop/src/outbox.ts) as the window sees it, in memory. */
function fakeBridge() {
  const entries: OutboxEntry[] = [];
  let seq = 0;
  const ok = <T,>(value: T) => Promise.resolve({ ok: true, value });
  const bridge: OutboxBridge & { entries: OutboxEntry[]; push(e: Partial<OutboxEntry> & { id: string }): OutboxEntry } = {
    entries,
    push(e) {
      const entry: OutboxEntry = {
        seq: ++seq, kind: 'pos_sale', path: '/api/pos/shifts/s1/sales', body: { n: seq }, books: 'b'.repeat(32), createdAt: new Date(2026, 10, 11, 9, seq).toISOString(),
        user: { id: 'u-mer', name: 'Mer' }, reference: `OFF-C1-000${seq}`, summary: { total: 1000 * seq, currency: 'IQD', lines: 1, register: 'C1' },
        state: 'waiting', attempts: 0, lastTriedAt: null, error: null, ...e
      };
      entries.push(entry);
      return entry;
    },
    status: () => Promise.resolve({ available: true, waiting: entries.filter((e) => e.state === 'waiting').length, refused: entries.filter((e) => e.state === 'refused').length, damaged: false }),
    list: () => ok(structuredClone(entries)),
    add: (raw) => {
      const e = raw as NewOutboxEntry;
      return ok(bridge.push({ id: e.id, kind: e.kind, path: e.path, body: e.body, user: e.user }));
    },
    result: (id, outcome) => {
      const o = outcome as { kind: string; error?: OutboxEntry['error'] };
      const i = entries.findIndex((e) => e.id === id);
      if (i < 0) return ok(null);
      if (o.kind === 'sent') { entries.splice(i, 1); return ok(null); }
      const e = entries[i]!;
      e.attempts += 1;
      e.error = o.error ?? null;
      if (o.kind === 'refused') e.state = 'refused';
      return ok(e);
    },
    retry: (id) => { const e = entries.find((x) => x.id === id)!; e.state = 'waiting'; e.attempts = 0; return ok(e); },
    discard: (id) => { entries.splice(entries.findIndex((e) => e.id === id), 1); return ok(true); }
  };
  return bridge;
}

const MER: Who = { id: 'u-mer', name: 'Mer', admin: false };
const LAS: Who = { id: 'u-las', name: 'Las', admin: false };

function setup(answers: ((e: OutboxEntry) => unknown)[] = [], who: Who | null = MER) {
  const bridge = fakeBridge();
  const sent: string[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let answer = 0;
  const box = new Outbox({
    bridge,
    send: async (e) => {
      sent.push(e.id);
      const a = answers[answer++];
      if (a) return a(e);
      return { ok: true };
    },
    probe: async () => false,
    books: async () => 'b'.repeat(32),
    who: () => who,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {}
  });
  return { bridge, box, sent, timers };
}

const offline = () => { throw new ApiError(0, 'network', null); };
const refuse = (code: string, details: unknown = null, status = 400) => () => { throw new ApiError(status, code, details); };

afterEach(() => { setReachable(true); vi.unstubAllGlobals(); });

describe('sending what waits on a PC', () => {
  it('sends the person\'s own entries, oldest first, each with its key, and removes each one sent', async () => {
    const { bridge, box, sent } = setup();
    const a = bridge.push({ id: 'a' });
    const lasOne = bridge.push({ id: 'las', user: { id: 'u-las', name: 'Las' } });
    const b = bridge.push({ id: 'b' });
    await box.run();
    expect(sent).toEqual([a.id, b.id]);
    // Las's waits for Las to sign in on this PC: never sent in Mer's session
    expect(bridge.entries.map((e) => e.id)).toEqual([lasOne.id]);
    expect(box.snapshot).toMatchObject({ online: true, sending: false });
  });

  it('stops at a lost link, keeps the order, and tries again later: sooner first, then every few minutes', async () => {
    const { bridge, box, sent, timers } = setup([offline, offline, () => ({}), () => ({})]);
    bridge.push({ id: 'a' });
    bridge.push({ id: 'b' });
    await box.run();
    expect(sent).toEqual(['a']); // b is not tried before a
    expect(box.snapshot.online).toBe(false);
    expect(timers.map((t) => t.ms)).toEqual([BACKOFF_MS[0]]);
    timers[0]!.fn();
    await box.run();
    expect(timers.map((t) => t.ms)).toEqual([BACKOFF_MS[0], BACKOFF_MS[1]]);
    timers[1]!.fn();
    await box.run();
    expect(sent).toEqual(['a', 'a', 'a', 'b']);
    expect(bridge.entries).toEqual([]);
    expect(box.snapshot.online).toBe(true);
    // the waits grow and stop growing at five minutes
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map(backoffDelay)).toEqual([2_000, 5_000, 10_000, 30_000, 60_000, 120_000, 300_000, 300_000, 300_000]);
  });

  it('keeps a refusal for a person and goes on with the next; never drops it', async () => {
    const { bridge, box, sent } = setup([refuse('validation', [{ code: 'stock_insufficient', line: 1, available: 0 }]), () => ({})]);
    bridge.push({ id: 'a' });
    bridge.push({ id: 'b' });
    await box.run();
    expect(sent).toEqual(['a', 'b']);
    expect(bridge.entries).toMatchObject([{ id: 'a', state: 'refused', attempts: 1, error: { status: 400, code: 'validation' } }]);
    // a refused one is not sent by itself again …
    await box.run();
    expect(sent).toEqual(['a', 'b']);
    // … only when a person asks (after fixing the cause)
    await box.retry('a');
    await box.run();
    expect(sent).toEqual(['a', 'b', 'a']);
    expect(bridge.entries).toEqual([]);
  });

  it('tries again after a server problem, and puts it before a person after many', async () => {
    const answers = Array.from({ length: MAX_SERVER_FAILURES }, () => refuse('internal', null, 500));
    const { bridge, box, timers } = setup(answers);
    bridge.push({ id: 'a' });
    for (let i = 0; i < MAX_SERVER_FAILURES; i++) await box.run();
    expect(bridge.entries).toMatchObject([{ id: 'a', state: 'refused', attempts: MAX_SERVER_FAILURES }]);
    expect(timers.length).toBe(MAX_SERVER_FAILURES - 1);
  });

  it('waits for the person to sign in again when the session ended, without marking anything', async () => {
    const { bridge, box } = setup([refuse('unauthorized', null, 401)]);
    bridge.push({ id: 'a' });
    await box.run();
    expect(bridge.entries).toMatchObject([{ id: 'a', state: 'waiting', attempts: 0 }]);
  });

  it('sends nothing when nobody is signed in, and the next person only their own', async () => {
    const none = setup([], null);
    none.bridge.push({ id: 'a' });
    await none.box.run();
    expect(none.sent).toEqual([]);
    const las = setup([], LAS);
    las.bridge.push({ id: 'mer' });
    las.bridge.push({ id: 'las', user: { id: 'u-las', name: 'Las' } });
    await las.box.run();
    expect(las.sent).toEqual(['las']);
  });

  it('sends a sale kept while a pass was running in one more pass', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { bridge, box, sent } = setup([async () => { await gate; return {}; }]);
    bridge.push({ id: 'a' });
    const first = box.run();
    await new Promise((r) => setTimeout(r, 0));
    bridge.push({ id: 'b' });
    void box.run();
    release();
    await first;
    expect(sent).toEqual(['a', 'b']);
    expect(bridge.entries).toEqual([]);
  });

  it('reads an answer the way the outbox needs it', () => {
    expect(verdictOf(new ApiError(0, 'network', null))).toEqual({ kind: 'offline' });
    expect(verdictOf(new ApiError(401, 'unauthorized', null))).toEqual({ kind: 'signed_out' });
    expect(verdictOf(new ApiError(503, 'database_timeout', null))).toMatchObject({ kind: 'failed' });
    expect(verdictOf(new ApiError(429, 'too_many_attempts', null))).toMatchObject({ kind: 'failed' });
    expect(verdictOf(new ApiError(409, 'pos_shift_closed', null))).toMatchObject({ kind: 'refused', error: { code: 'pos_shift_closed' } });
    expect(verdictOf(new ApiError(409, 'other_books', null))).toMatchObject({ kind: 'refused' });
    expect(verdictOf(new ApiError(0, 'outbox_write_failed', null))).toMatchObject({ kind: 'refused' });
  });

  it('knows whose an entry is, with or without sign-in', () => {
    expect(madeBy({ user: { id: 'u-mer', name: 'Mer' } }, MER)).toBe(true);
    expect(madeBy({ user: { id: 'u-mer', name: 'Mer' } }, { id: 'u-las', name: 'Mer' })).toBe(false);
    expect(madeBy({ user: { id: null, name: 'Raz' } }, { id: null, name: 'Raz' })).toBe(true);
    expect(madeBy({ user: { id: null, name: 'Raz' } }, null)).toBe(false);
  });
});

describe('discarding one', () => {
  it('writes it to the audit log on the office server first, and only then removes it from the PC', async () => {
    const { bridge, box } = setup();
    bridge.push({ id: 'a', state: 'refused', error: { status: 400, code: 'validation', details: [{ code: 'stock_insufficient' }] } });
    await box.refresh();
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ recorded: true, booked: null }), { status: 200 });
    });
    expect(await box.discard('a', ' Sold from the shelf ')).toEqual({ booked: null });
    expect(calls).toEqual([{ url: '/api/outbox/discarded', body: expect.objectContaining({ key: 'a', kind: 'pos_sale', reference: 'OFF-C1-0001', total: 1000, refusal: 'stock_insufficient', reason: 'Sold from the shelf', madeBy: 'Mer' }) }]);
    expect(bridge.entries).toEqual([]);
  });

  it('keeps it when the server could not write the audit record', async () => {
    const { bridge, box } = setup();
    bridge.push({ id: 'a' });
    await box.refresh();
    vi.stubGlobal('fetch', async () => { throw new TypeError('offline'); });
    await expect(box.discard('a', '')).rejects.toMatchObject({ code: 'network' });
    expect(bridge.entries).toHaveLength(1);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'forbidden', details: null }), { status: 403 }));
    await expect(box.discard('a', '')).rejects.toMatchObject({ status: 403 });
    expect(bridge.entries).toHaveLength(1);
  });

  it('names the refusal in one word and keeps nothing else', () => {
    expect(refusalCode({ status: 400, code: 'validation', details: [{ code: 'stock_insufficient' }, { code: 'x' }] })).toBe('stock_insufficient');
    expect(refusalCode({ status: 409, code: 'pos_shift_closed', details: null })).toBe('pos_shift_closed');
    const entry = fakeBridge().push({ id: 'k', error: { status: 409, code: 'pos_shift_closed', details: null } });
    expect(discardRecord(entry, '')).toEqual({
      key: 'k', kind: 'pos_sale', reference: 'OFF-C1-0001', total: 1000, currency: 'IQD', lines: 1, madeBy: 'Mer', madeAt: entry.createdAt, refusal: 'pos_shift_closed'
    });
  });
});

describe('while the server is away and nothing waits', () => {
  it('looks now and then, and says when it is back', async () => {
    const bridge = fakeBridge();
    let up = false;
    const timers: { fn: () => void; ms: number }[] = [];
    const box = new Outbox({
      bridge, send: async () => ({}), probe: async () => up, books: async () => 'b'.repeat(32), who: () => MER,
      setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {}
    });
    setReachable(false);
    box.linkChanged(false);
    expect(box.snapshot.online).toBe(false);
    expect(timers).toHaveLength(1);
    timers[0]!.fn();
    await box.run();
    expect(box.snapshot.online).toBe(false);
    up = true;
    timers.at(-1)!.fn();
    await box.run();
    expect(box.snapshot.online).toBe(true);
  });
});
