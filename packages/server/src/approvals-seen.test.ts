import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { resetLoginThrottle } from './auth.ts';
import { openDatabase, type Db } from './db.ts';
import { assertSeen, seenOf } from './entry-seen.ts';

// What an approver saw is what is approved (phone app 1.1): each of the five approval actions takes the preparedAt of
// the entry as it was shown (`seen`); changed since, the action is refused with 409 entry_changed and nothing changes.
// Without `seen` (the desktop) every action works as before.

let db: Db;
let app: FastifyInstance;
type Headers = Record<string, string>;
const owner: Headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
let mer: Headers;
let las: Headers;
let raz: Headers;

const call = (method: 'GET' | 'POST' | 'PUT', url: string, headers: Headers, payload?: object) =>
  app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signIn(username: string, password: string): Promise<Headers> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, headers: { 'x-qasa-client': '1' } });
  expect(res.statusCode, res.body).toBe(200);
  return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
}

beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  // roles are part of the paid plans: the free month has them
  expect((await call('POST', '/api/plan/trial', owner, {})).statusCode).toBe(200);
  const first = (await call('GET', '/api/users', owner)).json()[0] as { id: string; username: string };
  expect((await call('POST', `/api/users/${first.id}/password`, owner, { password: 'mer-pass-12345' })).statusCode).toBe(200);
  // Las prepares vouchers, Raz checks and approves them
  expect((await call('POST', '/api/users', owner, { username: 'las', name: 'Las', password: 'las-pass-12345', roles: ['preparer'] })).statusCode).toBe(201);
  expect((await call('POST', '/api/users', owner, { username: 'raz', name: 'Raz', password: 'raz-pass-12345', roles: ['checker', 'approver'] })).statusCode).toBe(201);
  expect((await call('PUT', '/api/auth/signin', owner, { on: true })).statusCode).toBe(200);
  mer = await signIn(first.username, 'mer-pass-12345');
  las = await signIn('las', 'las-pass-12345');
  raz = await signIn('raz', 'raz-pass-12345');
});

afterEach(async () => {
  await app.close();
  db.close();
});

const receipt = (amount: number) => ({
  kind: 'receipt', date: '2026-11-15', cashAccountCode: '1811', description: 'Received', currency: 'IQD', rateX100: 100,
  items: [{ accountCode: '1611', amount }]
});

/** A voucher Las prepared, as the approver's screen shows it now. */
async function prepared(amount = 10_000): Promise<{ id: string; preparedAt: string; revision: number }> {
  const made = await call('POST', '/api/vouchers', las, receipt(amount));
  expect(made.statusCode, made.body).toBe(201);
  return made.json();
}

const entry = async (id: string) => (await call('GET', `/api/entries/${id}`, mer)).json() as { status: string; number: string | null; total: number; preparedAt: string; approval: { state: string } | null };
const audited = (action: string, id: string) => (db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND entity_id = ?').get(action, id) as { n: number }).n;

/** Las changes the voucher after it was seen (a moment later, so its preparedAt moves on). */
async function changed(id: string, amount: number): Promise<string> {
  await sleep(5);
  const edit = await call('PUT', `/api/vouchers/${id}`, las, receipt(amount));
  expect(edit.statusCode, edit.body).toBe(200);
  return edit.json().preparedAt as string;
}

describe('approval actions with what the approver saw (seen)', () => {
  it('check, approve and return: refused when the voucher changed since it was seen, done with what is there now', async () => {
    const v = await prepared();
    const now = await changed(v.id, 25_000);
    expect(now).not.toBe(v.preparedAt);
    // checked with what was seen before the change: refused, still a draft, nothing in the log
    const stale = await call('POST', `/api/entries/${v.id}/check`, raz, { seen: v.preparedAt });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'entry_changed' });
    expect(await entry(v.id)).toMatchObject({ status: 'draft', total: 25_000 });
    expect(audited('check', v.id)).toBe(0);
    // with what is there now
    expect((await call('POST', `/api/entries/${v.id}/check`, raz, { seen: now })).statusCode).toBe(200);
    expect((await entry(v.id)).status).toBe('checked');
    // returned or approved with an old `seen`: refused, it stays checked
    for (const action of ['return', 'approve']) {
      const res = await call('POST', `/api/entries/${v.id}/${action}`, raz, { seen: v.preparedAt });
      expect(res.statusCode, `${action} ${res.body}`).toBe(409);
      expect(res.json().error).toBe('entry_changed');
    }
    expect(await entry(v.id)).toMatchObject({ status: 'checked', number: null });
    expect(audited('approve', v.id)).toBe(0);
    expect((await call('POST', `/api/entries/${v.id}/return`, raz, { seen: now })).statusCode).toBe(200);
    expect((await entry(v.id)).status).toBe('draft');
    expect((await call('POST', `/api/entries/${v.id}/check`, raz, { seen: now })).statusCode).toBe(200);
    const posted = await call('POST', `/api/entries/${v.id}/approve`, raz, { seen: now });
    expect(posted.statusCode, posted.body).toBe(200);
    expect(posted.json()).toMatchObject({ status: 'approved', total: 25_000 });
    expect(posted.json().number).toBeTruthy();
  });

  it('approve-waiting and reject: refused when the waiting voucher changed since it was seen', async () => {
    expect((await call('PUT', '/api/voucher-approval', mer, { on: true })).statusCode).toBe(200);
    const v = await prepared(10_000);
    expect((await entry(v.id)).approval).toMatchObject({ state: 'waiting' });
    // Las corrects it while it waits: it keeps waiting, with the new amount
    const now = await changed(v.id, 90_000);
    expect(await entry(v.id)).toMatchObject({ status: 'draft', total: 90_000, approval: { state: 'waiting' } });
    const approve = await call('POST', `/api/entries/${v.id}/approve-waiting`, raz, { seen: v.preparedAt });
    expect(approve.statusCode, approve.body).toBe(409);
    expect(approve.json().error).toBe('entry_changed');
    const reject = await call('POST', `/api/entries/${v.id}/reject`, raz, { seen: v.preparedAt, reason: 'Wrong amount' });
    expect(reject.statusCode, reject.body).toBe(409);
    expect(await entry(v.id)).toMatchObject({ status: 'draft', number: null, approval: { state: 'waiting' } });
    expect(audited('approve', v.id) + audited('reject', v.id)).toBe(0);
    // with what is there now: approved and posted, 90,000 as shown
    const done = await call('POST', `/api/entries/${v.id}/approve-waiting`, raz, { seen: now });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ status: 'approved', total: 90_000, approval: { state: 'approved' } });
  });

  it('a rejection with what is there now goes through, with its reason', async () => {
    expect((await call('PUT', '/api/voucher-approval', mer, { on: true })).statusCode).toBe(200);
    const v = await prepared(10_000);
    const res = await call('POST', `/api/entries/${v.id}/reject`, raz, { seen: v.preparedAt, reason: 'Not ours' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'draft', approval: { state: 'rejected', reason: 'Not ours' } });
  });

  it('without `seen` (the desktop) every action works as before, whatever changed', async () => {
    const v = await prepared();
    await changed(v.id, 30_000);
    expect((await call('POST', `/api/entries/${v.id}/check`, raz, {})).statusCode).toBe(200);
    expect((await call('POST', `/api/entries/${v.id}/return`, raz, {})).statusCode).toBe(200);
    expect((await call('POST', `/api/entries/${v.id}/check`, raz)).statusCode).toBe(200);
    expect((await call('POST', `/api/entries/${v.id}/approve`, raz, {})).json()).toMatchObject({ status: 'approved', total: 30_000 });
    expect((await call('PUT', '/api/voucher-approval', mer, { on: true })).statusCode).toBe(200);
    const w = await prepared(5_000);
    await changed(w.id, 6_000);
    expect((await call('POST', `/api/entries/${w.id}/approve-waiting`, raz, {})).json()).toMatchObject({ status: 'approved', total: 6_000 });
    const x = await prepared(7_000);
    expect((await call('POST', `/api/entries/${x.id}/reject`, raz, { reason: 'Again' })).json()).toMatchObject({ approval: { state: 'rejected' } });
  });

  it('checks the rest as before: who may, the entry\'s state, and a `seen` that is not one', async () => {
    const v = await prepared();
    // Las may not check (the route's permission comes first), whatever `seen` says
    expect((await call('POST', `/api/entries/${v.id}/check`, las, { seen: v.preparedAt })).statusCode).toBe(403);
    // an approval on a draft that waits for nothing: not allowed, as before
    const notWaiting = await call('POST', `/api/entries/${v.id}/approve-waiting`, raz, { seen: v.preparedAt });
    expect(notWaiting.statusCode).toBe(409);
    expect(notWaiting.json().error).toBe('action_not_allowed');
    // an entry that is not there: not found, as before
    expect((await call('POST', '/api/entries/no-such-entry/check', raz, { seen: v.preparedAt })).statusCode).toBe(404);
    // `seen` is a short string
    for (const seen of ['', 'x'.repeat(41), 42]) expect((await call('POST', `/api/entries/${v.id}/check`, raz, { seen })).statusCode, String(seen)).toBe(400);
    expect((await entry(v.id)).status).toBe('draft');
    // and the check on its own: nothing to compare without `seen`, a refusal only for another version
    expect(() => assertSeen(db, v.id)).not.toThrow();
    expect(() => assertSeen(db, v.id, v.preparedAt)).not.toThrow();
    expect(() => assertSeen(db, v.id, '2000-01-01T00:00:00.000Z')).toThrow(/entry_changed/);
    expect(() => assertSeen(db, 'no-such-entry', 'x')).not.toThrow();
  });
});

describe('the revision an approval is checked against (schema 15)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('goes up with every change, even two in the same millisecond, and an action with an older one is refused', async () => {
    expect((await call('PUT', '/api/voucher-approval', mer, { on: true })).statusCode).toBe(200);
    const v = await prepared(10_000);
    expect(v.revision).toBe(0);
    // the clock stands still: both changes are made in the same millisecond, so preparedAt can't tell them apart
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    const first = await call('PUT', `/api/vouchers/${v.id}`, las, receipt(20_000));
    expect(first.statusCode, first.body).toBe(200);
    const shown = first.json() as { preparedAt: string; revision: number };
    const second = await call('PUT', `/api/vouchers/${v.id}`, las, receipt(90_000));
    expect(second.statusCode, second.body).toBe(200);
    const now = second.json() as { preparedAt: string; revision: number };
    expect(now.preparedAt).toBe(shown.preparedAt);
    expect([shown.revision, now.revision]).toEqual([1, 2]);
    // the approver was shown 20,000: refused, nothing posted
    for (const [action, body] of [['approve-waiting', {}], ['reject', { reason: 'Wrong amount' }]] as const) {
      const res = await call('POST', `/api/entries/${v.id}/${action}`, raz, { seen: seenOf(shown), ...body });
      expect(res.statusCode, `${action} ${res.body}`).toBe(409);
      expect(res.json().error).toBe('entry_changed');
    }
    expect(await entry(v.id)).toMatchObject({ status: 'draft', number: null, total: 90_000, approval: { state: 'waiting' } });
    // with what is there now: approved, 90,000 as shown
    const done = await call('POST', `/api/entries/${v.id}/approve-waiting`, raz, { seen: seenOf(now) });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ status: 'approved', total: 90_000, revision: 2 });
  });

  it('check, return and approve leave it as it is: the same `seen` goes with each step', async () => {
    const v = await prepared();
    const seen = seenOf(v);
    expect(seen).toBe('r0');
    expect((await call('POST', `/api/entries/${v.id}/check`, raz, { seen })).statusCode).toBe(200);
    expect((await call('POST', `/api/entries/${v.id}/return`, raz, { seen })).statusCode).toBe(200);
    expect((await call('POST', `/api/entries/${v.id}/check`, raz, { seen })).statusCode).toBe(200);
    expect((await call('POST', `/api/entries/${v.id}/approve`, raz, { seen })).json()).toMatchObject({ status: 'approved', revision: 0 });
  });

  it('takes "r<number>" as a revision only; anything else is compared with preparedAt, as the first form of `seen`', () => {
    const id = 'e-rev';
    db.prepare(`INSERT INTO entries (id, type, date, description, currency, rate_x100, status, prepared_by, prepared_at, updated_at, revision)
                VALUES (?, 'journal', '2026-11-15', 'x', 'IQD', 100, 'draft', 'Las', '2026-11-15T10:00:00.000Z', '2026-11-15T10:00:00.000Z', 3)`).run(id);
    expect(() => assertSeen(db, id, 'r3')).not.toThrow();
    for (const stale of ['r2', 'r4', 'r03', 'r', 'r-3', 'r3 ', 'R3']) expect(() => assertSeen(db, id, stale), stale).toThrow(/entry_changed/);
    expect(() => assertSeen(db, id, '2026-11-15T10:00:00.000Z')).not.toThrow();
    expect(() => assertSeen(db, id, '2026-11-15T10:00:00.001Z')).toThrow(/entry_changed/);
  });
});

describe('what an approver has to approve, each entry once (toApprove)', () => {
  it('counts a checked voucher that also waits for approval once, beside the plain waiting ones', async () => {
    expect((await call('PUT', '/api/voucher-approval', mer, { on: true })).statusCode).toBe(200);
    const a = await prepared(10_000);
    const b = await prepared(20_000);
    // one is checked while it still waits for approval (books written by an earlier version, or a server copy): it is
    // in both lists of the phone's "Waiting for approval"
    db.prepare("UPDATE entries SET status = 'checked', checked_by = 'Raz', checked_at = updated_at WHERE id = ?").run(b.id);
    expect(await entry(b.id)).toMatchObject({ status: 'checked', approval: { state: 'waiting' } });
    // and an entry checked the usual way, waiting for nothing but its approval
    db.prepare("INSERT INTO entries (id, type, date, description, currency, rate_x100, status, prepared_by, prepared_at, updated_at) VALUES ('e-plain', 'journal', '2026-11-15', 'x', 'IQD', 100, 'checked', 'Mer', '2026-11-15T10:00:00.000Z', '2026-11-15T10:00:00.000Z')").run();
    const sent = (await call('GET', '/api/entries?approval=waiting', raz)).json() as { id: string }[];
    const inChecked = (await call('GET', '/api/entries?status=checked', raz)).json() as { id: string }[];
    expect(sent.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
    expect(inChecked.map((e) => e.id).sort()).toEqual([b.id, 'e-plain'].sort());
    const state = (await call('GET', '/api/voucher-approval', raz)).json();
    expect(state).toMatchObject({ waiting: 2, toApprove: 3 });
    // approved: nothing left
    const now = (await entry(b.id)) as unknown as { revision: number };
    expect((await call('POST', `/api/entries/${b.id}/approve-waiting`, raz, { seen: seenOf(now) })).statusCode).toBe(200);
    expect((await call('GET', '/api/voucher-approval', raz)).json()).toMatchObject({ waiting: 1, toApprove: 2 });
  });
});
