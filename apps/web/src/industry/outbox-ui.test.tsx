import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { setReachable } from '../api.ts';
import { I18nContext, makeI18n } from '../i18n.ts';
import { DiscardDialog, OutboxPage, visibleEntries } from '../pages/Outbox.tsx';
import { outboxClient, resetOutboxForTests, setOutboxUser, startOutbox, type OutboxBridge, type OutboxEntry, type OutboxState, type Who } from './outbox.ts';
import { OutboxBanner, outboxNotice } from './OutboxBanner.tsx';
import { OUTBOX_TEXT } from '../i18n/outbox.ts';

const entries: OutboxEntry[] = [];
const entry = (over: Partial<OutboxEntry> & { id: string }): OutboxEntry => ({
  seq: entries.length + 1, kind: 'pos_sale', path: '/api/pos/shifts/s1/sales', body: {}, books: 'b'.repeat(32), createdAt: '2026-11-11T09:30:00.000Z',
  user: { id: 'u-mer', name: 'Mer' }, reference: `OFF-Counter1-000${entries.length + 1}`, summary: { total: 5_000, currency: 'IQD', lines: 1, register: 'Counter 1' },
  state: 'waiting', attempts: 0, lastTriedAt: null, error: null, ...over
});
const ok = <T,>(value: T) => Promise.resolve({ ok: true, value });
const bridge: OutboxBridge = {
  status: () => Promise.resolve({ available: true, waiting: 0, refused: 0, damaged: false }),
  list: () => ok(structuredClone(entries)),
  add: () => ok(null),
  result: (id, outcome) => {
    const e = entries.find((x) => x.id === id);
    if (e && (outcome as { kind: string }).kind === 'sent') entries.splice(entries.indexOf(e), 1);
    else if (e) e.attempts += 1;
    return ok(e ?? null);
  },
  retry: () => ok(null),
  discard: () => ok(true)
};

let who: Who | null = { id: 'u-mer', name: 'Mer', admin: true };
const render = (node: ReactNode, lang: 'ar' | 'en' | 'ku' = 'en') =>
  renderToStaticMarkup(<I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}>{node}</I18nContext.Provider>);

beforeEach(async () => {
  entries.splice(0);
  vi.stubGlobal('window', { qasaDesktop: { outbox: bridge }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} });
  // the office server can't be reached
  vi.stubGlobal('fetch', async () => { throw new TypeError('failed to fetch'); });
  setOutboxUser(() => who);
  entries.push(entry({ id: 'a' }), entry({ id: 'b' }));
  await startOutbox();
  await outboxClient()!.run();
});

afterEach(() => {
  resetOutboxForTests();
  setReachable(true);
  vi.unstubAllGlobals();
});

describe('the outbox bar and list', () => {
  it('says "Offline — 2 waiting to send" while the office server can\'t be reached, in each language, with the way to the list', () => {
    expect(outboxClient()!.snapshot.online).toBe(false);
    const en = render(<OutboxBanner page="home" />);
    expect(en).toContain('Offline — 2 waiting to send');
    expect(en).toContain('href="#/outbox"');
    expect(en).toContain('role="status"');
    expect(render(<OutboxBanner page="home" />, 'ar')).toContain('غير متصل — 2 بانتظار الإرسال');
    expect(render(<OutboxBanner page="home" />, 'ku')).toContain('بێ پەیوەندی — 2 چاوەڕێی ناردنن');
    // on the list itself, no link to it
    expect(render(<OutboxBanner page="outbox" />)).not.toContain('href="#/outbox"');
  });

  it('is gone once the link is back and all was sent; a refusal stays, as a bar of its own', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    entries.push(entry({ id: 'c', state: 'refused', error: { status: 400, code: 'validation', details: [{ code: 'stock_insufficient', line: 1, available: 0 }] } }));
    outboxClient()!.kick();
    await outboxClient()!.run();
    expect(entries.map((e) => e.id)).toEqual(['c']);
    const html = render(<OutboxBanner page="home" />);
    expect(html).not.toContain('Offline');
    expect(html).toContain('1 not accepted by the server and need a person');
    expect(html).toContain('role="alert"');
    entries.splice(0);
    await outboxClient()!.refresh();
    expect(render(<OutboxBanner page="home" />)).toBe('');
  });

  it('tells sending from waiting from offline', () => {
    const state = (over: Partial<OutboxState>): OutboxState => ({ available: true, online: true, sending: false, entries: [entry({ id: 'x' })], damaged: false, nextTry: null, ...over });
    expect(outboxNotice(state({ online: false }))).toEqual({ kind: 'offline', waiting: 1 });
    expect(outboxNotice(state({ online: false, entries: [] }))).toEqual({ kind: 'offline', waiting: 0 });
    expect(outboxNotice(state({ sending: true }))).toEqual({ kind: 'sending', waiting: 1 });
    expect(outboxNotice(state({}))).toEqual({ kind: 'waiting', waiting: 1 });
    expect(outboxNotice(state({ entries: [] }))).toBeNull();
    expect(outboxNotice(null)).toBeNull();
  });

  it('lists what waits: an admin sees everyone\'s and may discard, anyone else only their own, and a refusal says why', async () => {
    entries.push(entry({ id: 'las', user: { id: 'u-las', name: 'Las' }, kind: 'voucher', path: '/api/vouchers', reference: null }));
    entries.push(entry({ id: 'bad', state: 'refused', attempts: 1, error: { status: 400, code: 'validation', details: [{ code: 'stock_insufficient', line: 1, available: 0 }] } }));
    await outboxClient()!.refresh();
    const admin = render(<OutboxPage admin />);
    expect(admin).toContain('OFF-Counter1-0001');
    expect(admin).toContain('Receipt voucher');
    expect(admin).toContain('Sent when Las signs in on this PC');
    expect(admin).toContain('Line 1: not enough in stock');
    expect(admin).toContain('Not accepted');
    expect(admin.match(/Discard…/g)).toHaveLength(4);
    expect(admin).toContain(OUTBOX_TEXT.ob_fixHint[1]);

    who = { id: 'u-las', name: 'Las', admin: false };
    const las = render(<OutboxPage admin={false} />);
    expect(las).not.toContain('OFF-Counter1-0001');
    expect(las).toContain('Receipt voucher');
    expect(las).not.toContain('Discard…');
    expect(las).toContain('Send now');
    who = { id: 'u-mer', name: 'Mer', admin: true };

    expect(visibleEntries({ entries }, { id: 'u-las', name: 'Las' }, false).map((e) => e.id)).toEqual(['las']);
    expect(visibleEntries({ entries }, null, true).map((e) => e.id)).toEqual(['a', 'b', 'las', 'bad']);
  });

  it('asks before a discard, and can\'t do it without the office server (the audit log is there)', () => {
    const i18n = makeI18n('en', 'western', () => {}, () => {});
    const offline = render(<DiscardDialog entry={entries[0]!} online={false} i18n={i18n} onCancel={() => {}} onDone={() => {}} />);
    expect(offline).toContain('Discard from the waiting list?');
    expect(offline).toContain('It will never be booked');
    expect(offline).toContain('Discarding needs the office server');
    expect(offline).toMatch(/<button[^>]*disabled=""[^>]*>Discard for good/);
    const online = render(<DiscardDialog entry={entries[0]!} online i18n={i18n} onCancel={() => {}} onDone={() => {}} />);
    expect(online).not.toMatch(/<button[^>]*disabled=""[^>]*>Discard for good/);
    expect(online).toContain('OFF-Counter1-0001');
  });

  it('shows nothing and says so where the PC keeps no outbox', () => {
    resetOutboxForTests();
    expect(render(<OutboxBanner page="home" />)).toBe('');
    expect(render(<OutboxPage admin />)).toContain('only on a PC connected to an office server');
  });
});
