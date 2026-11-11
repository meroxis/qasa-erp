import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { migrate, openDatabase, schemaVersion, SCHEMA_VERSION, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { IDEMPOTENCY_KEEP_DAYS, idempotencyKeyOf, pruneIdempotencyKeys, requestFingerprint, resetIdempotencyPrune } from './idempotency.ts';
import { offlineSaleDate } from './pos.ts';

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let customerId: string;
let teaId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const withKey = (key: string, h: Record<string, string> = headers) => ({ ...h, 'x-qasa-idempotency': key });
const post = (url: string, body: unknown = {}, h: Record<string, string> = headers) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const get = (url: string, h: Record<string, string> = headers) => app.inject({ url, headers: h });
const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

beforeEach(async () => {
  resetLoginThrottle();
  resetIdempotencyPrune();
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  customerId = (await post('/api/parties', { type: 'customer', name: 'Raz', accountCode: '1612' })).json().id;
  teaId = (await post('/api/items', { code: 'TEA', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 2_500, saleCurrency: 'IQD' })).json().id;
  const doc = await post('/api/stock-docs', { kind: 'opening', date: '2026-01-01', warehouseId, counterAccountCode: '21', lines: [{ itemId: teaId, qtyMilli: 20_000, unitCost: 1_500 }] });
  expect((await post(`/api/stock-docs/${doc.json().id}/post`)).statusCode).toBe(200);
});

afterEach(async () => {
  await app.close();
  db.close();
});

const openShift = async () => {
  const res = await post('/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId, openingCash: 0 });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; openedAt: string };
};
const teaSale = (qty = 1) => ({ currency: 'IQD', lines: [{ itemId: teaId, qtyMilli: qty * 1000, unitPrice: 2_500 }] });

describe('the idempotency key', () => {
  it('accepts one UUID v4 only, in any case, and nothing else', () => {
    const key = randomUUID();
    expect(idempotencyKeyOf({})).toBeNull();
    expect(idempotencyKeyOf({ 'x-qasa-idempotency': key.toUpperCase() })).toBe(key);
    for (const bad of ['', 'abc', key + '0', '6fa459ea-ee8a-3ca4-894e-db77e160355e', "x' OR 1=1 --", [key, key]]) {
      expect(() => idempotencyKeyOf({ 'x-qasa-idempotency': bad as string })).toThrowError(expect.objectContaining({ code: 'validation' }));
    }
    // the request's own words decide its fingerprint
    expect(requestFingerprint('POST /a', { id: '1' }, { x: 1 })).toBe(requestFingerprint('POST /a', { id: '1' }, { x: 1 }));
    expect(requestFingerprint('POST /a', { id: '1' }, { x: 1 })).not.toBe(requestFingerprint('POST /a', { id: '2' }, { x: 1 }));
  });

  it('books a till sale sent twice with the same key once, and answers the second time from the first', async () => {
    const shift = await openShift();
    const key = randomUUID();
    const first = await post(`/api/pos/shifts/${shift.id}/sales`, teaSale(2), withKey(key));
    expect(first.statusCode, first.body).toBe(201);
    expect(first.headers['x-qasa-idempotent-replay']).toBeUndefined();
    const again = await post(`/api/pos/shifts/${shift.id}/sales`, teaSale(2), withKey(key));
    expect(again.statusCode, again.body).toBe(201);
    expect(again.headers['x-qasa-idempotent-replay']).toBe('1');
    expect(again.json().invoice.id).toBe(first.json().invoice.id);
    expect(again.json().invoice.number).toBe(first.json().invoice.number);
    expect(again.json().shift).toMatchObject({ count: 1, sales: { IQD: 5_000, USD: 0 } });
    expect(count('invoices')).toBe(1);
    expect(count('pos_sales')).toBe(1);
    // a sale without a key is a new sale, as before
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, teaSale(2))).statusCode).toBe(201);
    expect(count('invoices')).toBe(2);
  });

  it('makes one document when two requests with the same key arrive at once', async () => {
    const shift = await openShift();
    const key = randomUUID();
    const answers = await Promise.all([1, 2, 3].map(() => post(`/api/pos/shifts/${shift.id}/sales`, teaSale(1), withKey(key))));
    for (const a of answers) expect(a.statusCode, a.body).toBe(201);
    expect(new Set(answers.map((a) => a.json().invoice.id)).size).toBe(1);
    expect(count('invoices')).toBe(1);
    expect(answers.filter((a) => a.headers['x-qasa-idempotent-replay'] === '1')).toHaveLength(2);
    const stock = (await get(`/api/items/${teaId}`)).json() as { qtyMilli: number };
    expect(stock.qtyMilli).toBe(19_000);
  });

  it('refuses the same key with another body, for another route or from another user, and never shows their document', async () => {
    const shift = await openShift();
    const key = randomUUID();
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, teaSale(1), withKey(key))).statusCode).toBe(201);
    const otherBody = await post(`/api/pos/shifts/${shift.id}/sales`, teaSale(3), withKey(key));
    expect(otherBody.statusCode).toBe(409);
    expect(otherBody.json()).toEqual({ error: 'idempotency_key_reused', details: null });
    const otherRoute = await post('/api/vouchers', {
      kind: 'receipt', date: '2026-09-10', cashAccountCode: '1811', description: 'x', currency: 'IQD', rateX100: 100, items: [{ accountCode: '1612', amount: 1_000 }]
    }, withKey(key));
    expect(otherRoute.json().error).toBe('idempotency_key_reused');
    expect(count('invoices')).toBe(1);
    expect(count('entries')).toBe(2); // the opening stock and the one sale

    // sign-in on: Las sends a key Mer used already
    await post('/api/plan/trial');
    const ownerId = (await get('/api/users')).json()[0].id;
    expect((await post(`/api/users/${ownerId}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
    expect((await post('/api/users', { username: 'las', name: 'Las', password: 'las-pass-123', roles: ['sales'] })).statusCode).toBe(201);
    expect((await app.inject({ method: 'PUT', url: '/api/auth/signin', payload: { on: true }, headers })).statusCode).toBe(200);
    const login = async (username: string, password: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, headers: { 'x-qasa-client': '1' } });
      expect(res.statusCode, res.body).toBe(200);
      return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    };
    const las = await login('las', 'las-pass-123');
    const lasShift = (await post('/api/pos/shifts', { register: 'Counter 2', cashAccountCode: '1811', warehouseId, openingCash: 0 }, las)).json();
    const lasKey = randomUUID();
    expect((await post(`/api/pos/shifts/${lasShift.id}/sales`, teaSale(1), withKey(lasKey, las))).statusCode).toBe(201);
    const admin = await login('admin', 'admin-pass-123');
    // the admin may sell on Las's shift, but not with Las's key
    const stolen = await post(`/api/pos/shifts/${lasShift.id}/sales`, teaSale(1), withKey(lasKey, admin));
    expect(stolen.statusCode).toBe(409);
    expect(stolen.json().error).toBe('idempotency_key_reused');
    expect(count('invoices')).toBe(2);
  });

  it('refuses a malformed key before anything is made', async () => {
    const shift = await openShift();
    const res = await post(`/api/pos/shifts/${shift.id}/sales`, teaSale(1), withKey('not-a-key'));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation', details: [{ code: 'idempotency_key_invalid' }] });
    expect(count('invoices')).toBe(0);
  });

  it('keeps no key for a request that was refused, so the same key works once the cause is fixed', async () => {
    const shift = await openShift();
    const key = randomUUID();
    const tooMany = await post(`/api/pos/shifts/${shift.id}/sales`, teaSale(25), withKey(key));
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().details[0].code).toBe('stock_insufficient');
    expect(count('idempotency_keys')).toBe(0);
    // more stock arrives; the same sale with the same key goes through, once
    const doc = await post('/api/stock-docs', { kind: 'opening', date: '2026-01-02', warehouseId, counterAccountCode: '21', lines: [{ itemId: teaId, qtyMilli: 10_000, unitCost: 1_500 }] });
    await post(`/api/stock-docs/${doc.json().id}/post`);
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, teaSale(25), withKey(key))).statusCode).toBe(201);
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, teaSale(25), withKey(key))).headers['x-qasa-idempotent-replay']).toBe('1');
    expect(count('invoices')).toBe(1);
  });

  it('makes each kind of document a client may send again only once: invoices, posting, vouchers, returns, stock documents, adjustments', async () => {
    const twice = async (url: string, body: object, status = 201) => {
      const key = randomUUID();
      const a = await post(url, body, withKey(key));
      expect(a.statusCode, a.body).toBe(status);
      const b = await post(url, body, withKey(key));
      expect(b.statusCode, b.body).toBe(status);
      expect(b.headers['x-qasa-idempotent-replay']).toBe('1');
      expect(b.json().id).toBe(a.json().id);
      return a.json();
    };
    const invoicesBefore = count('invoices');
    const draft = await twice('/api/invoices', { kind: 'sale', date: '2026-09-10', partyId: customerId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0, lines: [{ itemId: teaId, qtyMilli: 2000, unitPrice: 2_500 }] });
    expect(count('invoices')).toBe(invoicesBefore + 1);
    const posted = await twice(`/api/invoices/${draft.id}/post`, {}, 200);
    expect(posted.status).toBe('posted');
    const entriesBefore = count('entries');
    await twice('/api/vouchers', { kind: 'receipt', date: '2026-09-11', cashAccountCode: '1811', description: 'Raz paid', currency: 'IQD', rateX100: 100, items: [{ accountCode: '1612', amount: 5_000, partyId: customerId }] });
    expect(count('entries')).toBe(entriesBefore + 1);
    const ret = await twice(`/api/invoices/${draft.id}/returns`, { date: '2026-09-12', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    expect(ret.kind).toBe('sale_return');
    expect(count('invoices')).toBe(invoicesBefore + 2);
    const docsBefore = count('stock_docs');
    const doc = await twice('/api/stock-docs', { kind: 'opening', date: '2026-09-12', warehouseId, counterAccountCode: '21', lines: [{ itemId: teaId, qtyMilli: 1000, unitCost: 1_500 }] });
    expect(count('stock_docs')).toBe(docsBefore + 1);
    await twice(`/api/stock-docs/${doc.id}/post`, {}, 200);
    const adj = await twice('/api/adjustments', { date: '2026-09-12', warehouseId, reason: 'damaged', lines: [{ itemId: teaId, qtyMilli: -1000 }] });
    const adjPosted = await twice(`/api/adjustments/${adj.id}/post`, {}, 200);
    expect(adjPosted.status).toBe('posted');
    const tea = (await get(`/api/items/${teaId}`)).json() as { qtyMilli: number };
    // 20 + 1 opened, 2 sold, 1 returned, 1 damaged: each counted once
    expect(tea.qtyMilli).toBe(19_000);
  });

  it(`keeps keys at least 30 days (${IDEMPOTENCY_KEEP_DAYS}), then clears them`, async () => {
    const shift = await openShift();
    const key = randomUUID();
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, teaSale(1), withKey(key))).statusCode).toBe(201);
    const day = 86_400_000;
    expect(pruneIdempotencyKeys(db, Date.now() + 30 * day)).toBe(0);
    expect(pruneIdempotencyKeys(db, Date.now() + (IDEMPOTENCY_KEEP_DAYS - 1) * day)).toBe(0);
    expect(count('idempotency_keys')).toBe(1);
    expect(pruneIdempotencyKeys(db, Date.now() + (IDEMPOTENCY_KEEP_DAYS + 1) * day)).toBe(1);
    expect(count('idempotency_keys')).toBe(0);
  });
});

describe('a till sale made offline', () => {
  const offline = (reference: string, soldAt: string, soldOn: string) => ({ reference, soldAt, soldOn });

  it('is booked on the date it was sold, keeps its receipt reference, and both references find it', async () => {
    const shift = await openShift();
    const soldAt = new Date(Date.now() - 60_000).toISOString();
    const res = await post(`/api/pos/shifts/${shift.id}/sales`, { ...teaSale(1), offline: offline('OFF-Counter1-0007', soldAt, todayIso()) }, withKey(randomUUID()));
    expect(res.statusCode, res.body).toBe(201);
    const invoice = res.json().invoice;
    expect(invoice).toMatchObject({ status: 'posted', date: todayIso(), offlineRef: 'OFF-Counter1-0007' });
    expect(invoice.number).toMatch(/^INV-/);
    expect((await get(`/api/invoices?q=${encodeURIComponent('OFF-Counter1-0007')}`)).json().map((i: { id: string }) => i.id)).toEqual([invoice.id]);
    expect((await get(`/api/invoices?q=${encodeURIComponent(invoice.number)}`)).json().map((i: { id: string }) => i.id)).toEqual([invoice.id]);
    const report = (await get(`/api/pos/shifts/${shift.id}`)).json();
    expect(report.invoices).toMatchObject([{ invoiceId: invoice.id, offlineRef: 'OFF-Counter1-0007', createdAt: soldAt }]);
    expect(report).toMatchObject({ count: 1, sales: { IQD: 2_500, USD: 0 } });
    // written to the audit log with both references
    const audit = db.prepare("SELECT details FROM audit_log WHERE action = 'offline_sale'").get() as { details: string };
    expect(JSON.parse(audit.details)).toMatchObject({ reference: 'OFF-Counter1-0007', number: invoice.number });
    // an ordinary sale has no reference of that kind
    const plain = (await post(`/api/pos/shifts/${shift.id}/sales`, teaSale(1))).json().invoice;
    expect(plain.offlineRef).toBeUndefined();
  });

  it('takes the reference a PC\'s outbox prints, with its list\'s code, and refuses one that is malformed', async () => {
    const shift = await openShift();
    const soldAt = new Date(Date.now() - 60_000).toISOString();
    for (const reference of ['OFF-Counter1-K7Q3MX-0001', 'OFF-صندوقالفرعالرئيس-2B9ZQH-123456789']) {
      const res = await post(`/api/pos/shifts/${shift.id}/sales`, { ...teaSale(1), offline: offline(reference, soldAt, todayIso()) }, withKey(randomUUID()));
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().invoice.offlineRef).toBe(reference);
    }
    // a code with a letter that is never made (O), or of another length, is not a reference
    for (const reference of ['OFF-Counter1-K7Q3MO-0001', 'OFF-Counter1-K7Q3M-0001', 'OFF-Counter1-K7Q3MX-01']) {
      const res = await post(`/api/pos/shifts/${shift.id}/sales`, { ...teaSale(1), offline: offline(reference, soldAt, todayIso()) }, withKey(randomUUID()));
      expect(res.statusCode, reference).toBe(400);
    }
  });

  it('works with a register named in Arabic or Kurdish', async () => {
    const shift = await openShift();
    const res = await post(`/api/pos/shifts/${shift.id}/sales`, { ...teaSale(1), offline: offline('OFF-الكاشير1-0001', new Date().toISOString(), todayIso()) });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().invoice.offlineRef).toBe('OFF-الكاشير1-0001');
  });

  it('is never on a customer\'s account (that needs the live credit-limit check), and its reference must be a till\'s', async () => {
    const shift = await openShift();
    const onAccount = await post(`/api/pos/shifts/${shift.id}/sales`, {
      ...teaSale(1), partyId: customerId, payments: [{ method: 'account', amount: 2_500 }], offline: offline('OFF-C1-0001', new Date().toISOString(), todayIso())
    });
    expect(onAccount.statusCode).toBe(400);
    expect(onAccount.json().details.map((d: { code: string }) => d.code)).toContain('pos_offline_on_account');
    // a cash sale to a named customer is fine
    const named = await post(`/api/pos/shifts/${shift.id}/sales`, { ...teaSale(1), partyId: customerId, offline: offline('OFF-C1-0002', new Date().toISOString(), todayIso()) });
    expect(named.statusCode, named.body).toBe(201);
    for (const bad of [offline('INV-2026-0001', new Date().toISOString(), todayIso()), offline('OFF-C 1-0001', new Date().toISOString(), todayIso()), offline('OFF-C1-0003', 'yesterday', todayIso())]) {
      expect((await post(`/api/pos/shifts/${shift.id}/sales`, { ...teaSale(1), offline: bad })).statusCode).toBe(400);
    }
    expect(count('pos_offline_sales')).toBe(1);
  });

  it('is dated within its shift and never in the future, whatever the till\'s clock said', () => {
    const now = new Date(2026, 10, 11, 12, 0, 0);
    const opened = new Date(2026, 10, 10, 8, 0, 0).toISOString();
    expect(offlineSaleDate('2026-11-10', opened, now)).toBe('2026-11-10');
    expect(offlineSaleDate('2026-11-11', opened, now)).toBe('2026-11-11');
    expect(offlineSaleDate('2026-11-12', opened, now)).toBe('2026-11-11');
    expect(offlineSaleDate('2026-11-01', opened, now)).toBe('2026-11-10');
    expect(offlineSaleDate('nonsense', opened, now)).toBe('2026-11-11');
  });

  it('still needs its shift open: a sale sent after the shift closed is refused (the till keeps it for a person)', async () => {
    const shift = await openShift();
    expect((await post(`/api/pos/shifts/${shift.id}/close`, { countedCash: 0 })).statusCode).toBe(200);
    const late = await post(`/api/pos/shifts/${shift.id}/sales`, { ...teaSale(1), offline: offline('OFF-C1-0009', new Date().toISOString(), todayIso()) }, withKey(randomUUID()));
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe('pos_shift_closed');
    expect(count('idempotency_keys')).toBe(0);
  });
});

describe('discarding what waits on a PC', () => {
  const entry = (key: string) => ({ key, kind: 'pos_sale', reference: 'OFF-C1-0004', total: 2_500, currency: 'IQD', lines: 1, madeBy: 'Mer', madeAt: new Date().toISOString(), refusal: 'stock_insufficient', reason: 'Sold from the display shelf' });

  it('is written to the audit log by an admin, saying whether it reached the books', async () => {
    const key = randomUUID();
    const res = await post('/api/outbox/discarded', entry(key));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ recorded: true, booked: null });
    const row = db.prepare("SELECT user, entity, entity_id, details FROM audit_log WHERE action = 'discard'").get() as { user: string; entity: string; entity_id: string; details: string };
    expect(row).toMatchObject({ user: 'Mer', entity: 'outbox', entity_id: key });
    expect(JSON.parse(row.details)).toMatchObject({ kind: 'pos_sale', reference: 'OFF-C1-0004', total: 2_500, refusal: 'stock_insufficient', madeBy: 'Mer', booked: null });
    // one that was booked after all (its answer was lost): the audit says which document
    const shift = await openShift();
    const sentKey = randomUUID();
    const sale = (await post(`/api/pos/shifts/${shift.id}/sales`, teaSale(1), withKey(sentKey))).json();
    expect((await post('/api/outbox/discarded', entry(sentKey))).json()).toEqual({ recorded: true, booked: sale.invoice.id });
  });

  it('checks every field, and is for admins only', async () => {
    expect((await post('/api/outbox/discarded', { ...entry(randomUUID()), key: 'nope' })).statusCode).toBe(400);
    expect((await post('/api/outbox/discarded', { ...entry(randomUUID()), refusal: '<script>' })).statusCode).toBe(400);
    expect((await post('/api/outbox/discarded', { ...entry(randomUUID()), kind: 'payment' })).statusCode).toBe(400);
    await post('/api/plan/trial');
    const ownerId = (await get('/api/users')).json()[0].id;
    await post(`/api/users/${ownerId}/password`, { password: 'admin-pass-123' });
    await post('/api/users', { username: 'raz', name: 'Raz', password: 'raz-pass-123', roles: ['sales'] });
    await app.inject({ method: 'PUT', url: '/api/auth/signin', payload: { on: true }, headers });
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'raz', password: 'raz-pass-123' }, headers: { 'x-qasa-client': '1' } });
    const raz = { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    expect((await post('/api/outbox/discarded', entry(randomUUID()), raz)).statusCode).toBe(403);
  });
});

describe('schema 12 (offline outbox)', () => {
  it('adds its tables to a company file from schema 11', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-v12-'));
    try {
      const file = join(dir, 'books.sqlite');
      const raw = new DatabaseSync(file);
      migrate(raw as unknown as Db, 11);
      raw.close();
      const db12 = openDatabase(file);
      try {
        expect(schemaVersion(db12)).toBe(SCHEMA_VERSION);
        expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(12);
        for (const table of ['idempotency_keys', 'pos_offline_sales']) {
          expect(db12.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).toBeTruthy();
        }
      } finally {
        db12.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the books a PC kept something for', () => {
  it('has an id of its own, the same every time, and other books refuse what was kept for these', async () => {
    const books = (await get('/api/outbox/books')).json().books as string;
    expect(books).toMatch(/^[0-9a-f]{32}$/);
    expect((await get('/api/outbox/books')).json().books).toBe(books);
    const shift = await openShift();
    const wrong = await post(`/api/pos/shifts/${shift.id}/sales`, teaSale(1), { ...withKey(randomUUID()), 'x-qasa-books': 'ab'.repeat(16) });
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json().error).toBe('other_books');
    expect(count('invoices')).toBe(0);
    const right = await post(`/api/pos/shifts/${shift.id}/sales`, teaSale(1), { ...withKey(randomUUID()), 'x-qasa-books': books });
    expect(right.statusCode, right.body).toBe(201);
    // another company file has its own
    const other = openDatabase(':memory:');
    const otherApp = buildApp(other);
    try {
      expect((await otherApp.inject({ url: '/api/outbox/books', headers })).json().books).not.toBe(books);
    } finally {
      await otherApp.close();
      other.close();
    }
  });
});

describe('a sale whose first try was booked but whose answer was lost', () => {
  it('answers the till\'s later offline try from the first one, and keeps the receipt reference the till printed then', async () => {
    const shift = await openShift();
    const key = randomUUID();
    const first = await post(`/api/pos/shifts/${shift.id}/sales`, teaSale(1), withKey(key));
    expect(first.statusCode).toBe(201);
    const stamp = { reference: 'OFF-Counter1-0003', soldAt: new Date().toISOString(), soldOn: todayIso() };
    const later = await post(`/api/pos/shifts/${shift.id}/sales`, { ...teaSale(1), offline: stamp }, withKey(key));
    expect(later.statusCode, later.body).toBe(201);
    expect(later.headers['x-qasa-idempotent-replay']).toBe('1');
    expect(later.json().invoice).toMatchObject({ id: first.json().invoice.id, offlineRef: 'OFF-Counter1-0003' });
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { ...teaSale(1), offline: stamp }, withKey(key))).json().invoice.id).toBe(first.json().invoice.id);
    expect(count('invoices')).toBe(1);
    expect(count('pos_offline_sales')).toBe(1);
    // the stamp aside, the sale must be the same
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { ...teaSale(2), offline: stamp }, withKey(key))).json().error).toBe('idempotency_key_reused');
  });
});
