import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let customerId: string;
let teaId: string;
let cupId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const post = (url: string, body: unknown = {}, h: Record<string, string> = headers) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const get = (url: string, h: Record<string, string> = headers) => app.inject({ url, headers: h });

beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db); // point of sale is built in (BUILT_IN_FEATURES)
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  customerId = (await post('/api/parties', { type: 'customer', name: 'Raz', accountCode: '1612' })).json().id;
  teaId = (await post('/api/items', { code: 'TEA', barcode: '6260000000017', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 2_500, saleCurrency: 'IQD' })).json().id;
  cupId = (await post('/api/items', { code: 'CUP', name: { ar: 'كوب', en: 'Cup', ku: 'کوپ' }, unit: 'service', salePrice: 1_000, saleCurrency: 'IQD' })).json().id;
  // stock to sell: opening stock of 20 teas at 1,500 each
  const doc = await post('/api/stock-docs', { kind: 'opening', date: '2026-01-01', warehouseId, counterAccountCode: '21', lines: [{ itemId: teaId, qtyMilli: 20_000, unitCost: 1_500 }] });
  expect(doc.statusCode, doc.body).toBe(201);
  const posted = await post(`/api/stock-docs/${doc.json().id}/post`);
  expect(posted.statusCode, posted.body).toBe(200);
});

afterEach(async () => {
  await app.close();
  db.close();
});

const open = (extra: object = {}) => post('/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId, openingCash: 50_000, ...extra });

describe('point of sale', () => {
  it('opens one shift per register and checks the safe and warehouse', async () => {
    const first = await open();
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toMatchObject({ number: expect.stringMatching(/^POS-\d{4}-0001$/), status: 'open', openingCash: 50_000, actions: ['sell', 'close'] });
    expect((await open({ register: '  counter 1 ' })).json()).toMatchObject({ error: 'pos_register_open' });
    expect((await open({ register: 'Counter 2' })).statusCode).toBe(201);
    const bad = await open({ register: 'Counter 3', cashAccountCode: '1611', warehouseId: 'nope', openingCash: -1 });
    expect(bad.statusCode).toBe(400);
    const empty = await open({ register: ' ', cashAccountCode: '18' });
    expect(empty.json().details.map((d: { code: string }) => d.code)).toEqual(expect.arrayContaining(['pos_register_required', 'cash_account_invalid']));
    expect((await get('/api/pos/current')).json().shift.register).toBe('Counter 2');
  });

  it('sells as a posted cash invoice into the shift safe, linked to the shift, and adds it to the expected cash', async () => {
    const shift = (await open()).json();
    const sale = await post(`/api/pos/shifts/${shift.id}/sales`, {
      currency: 'IQD', discount: 500, lines: [{ itemId: teaId, qtyMilli: 3000, unitPrice: 2_500 }, { itemId: cupId, qtyMilli: 1000, unitPrice: 1_000 }]
    });
    expect(sale.statusCode, sale.body).toBe(201);
    const { invoice, shift: after } = sale.json();
    expect(invoice).toMatchObject({ kind: 'sale', status: 'posted', payment: 'cash', cashAccountCode: '1811', total: 8_000 });
    expect(after).toMatchObject({ sales: { IQD: 8_000, USD: 0 }, count: 1, expected: { IQD: 58_000, USD: 0 } });

    // the entry balances: the safe takes the cash; stock leaves at cost
    const entry = db.prepare('SELECT SUM(base_debit) AS d, SUM(base_credit) AS c FROM entry_lines WHERE entry_id = (SELECT entry_id FROM invoices WHERE id = ?)').get(invoice.id) as { d: number; c: number };
    expect(Number(entry.d)).toBe(Number(entry.c));
    const safe = db.prepare("SELECT SUM(base_debit) - SUM(base_credit) AS v FROM entry_lines WHERE account_code = '1811'").get() as { v: number };
    expect(Number(safe.v)).toBe(8_000);
    expect(db.prepare('SELECT shift_id FROM pos_sales WHERE invoice_id = ?').get(invoice.id)).toMatchObject({ shift_id: shift.id });

    // a walk-in sale in dollars at a rate, and one for a known customer
    const usd = await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'USD', rateX100: 131_000, lines: [{ itemId: teaId, qtyMilli: 1000, unitPrice: 200 }] });
    expect(usd.statusCode, usd.body).toBe(201);
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'USD', lines: [{ itemId: teaId, qtyMilli: 1000, unitPrice: 200 }] })).json()).toMatchObject({ error: 'validation' });
    const known = await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', partyId: customerId, lines: [{ itemId: cupId, qtyMilli: 2000, unitPrice: 1_000 }] });
    expect(known.json().invoice.partyName).toBe('Raz');

    const report = (await get(`/api/pos/shifts/${shift.id}`)).json();
    expect(report).toMatchObject({ count: 3, sales: { IQD: 10_000, USD: 200 }, expected: { IQD: 60_000, USD: 200 } });
    expect(report.invoices).toHaveLength(3);
    // item amounts are after the invoice discount (500 shared 441 / 59), so the items add up to the sales
    expect(report.items.find((i: { code: string }) => i.code === 'TEA')).toMatchObject({ qtyMilli: 4000, amount: { IQD: 7_059, USD: 200 } });
    const itemsTotal = report.items.reduce((s: { IQD: number; USD: number }, i: { amount: { IQD: number; USD: number } }) => ({ IQD: s.IQD + i.amount.IQD, USD: s.USD + i.amount.USD }), { IQD: 0, USD: 0 });
    expect(itemsTotal).toEqual(report.sales);
  });

  it('takes a cash refund from the shift safe out of the expected cash, so an honest count shows no shortage', async () => {
    const shift = (await open()).json();
    const sold = (await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', lines: [{ itemId: teaId, qtyMilli: 4000, unitPrice: 2_500 }] })).json();
    expect(sold.shift.expected).toEqual({ IQD: 60_000, USD: 0 });
    const back = await post(`/api/invoices/${sold.invoice.id}/returns`, { date: sold.invoice.date, payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 2000 }] });
    expect(back.statusCode, back.body).toBe(201);
    expect((await get(`/api/pos/shifts/${shift.id}`)).json()).toMatchObject({ sales: { IQD: 10_000, USD: 0 }, refunds: { IQD: 5_000, USD: 0 }, expected: { IQD: 55_000, USD: 0 } });
    const closed = (await post(`/api/pos/shifts/${shift.id}/close`, { countedCash: 55_000 })).json();
    expect(closed).toMatchObject({ expected: { IQD: 55_000, USD: 0 }, difference: { IQD: 0, USD: 0 } });
    // a shift opened later does not count the earlier refund
    expect((await open()).json()).toMatchObject({ refunds: { IQD: 0, USD: 0 }, expected: { IQD: 50_000, USD: 0 } });
  });

  it('counts a refund in one drawer only when two registers share a safe', async () => {
    const first = (await open()).json();
    const sold = (await post(`/api/pos/shifts/${first.id}/sales`, { currency: 'IQD', lines: [{ itemId: teaId, qtyMilli: 4000, unitPrice: 2_500 }] })).json();
    // the second register opens on the same safe a moment later; the refund is paid after that, from its drawer
    db.prepare('UPDATE pos_shifts SET opened_at = ? WHERE id = ?').run('2020-01-01T08:00:00.000Z', first.id);
    const second = (await open({ register: 'Counter 2', openingCash: 20_000 })).json();
    const back = await post(`/api/invoices/${sold.invoice.id}/returns`, { date: sold.invoice.date, payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 2000 }] });
    expect(back.statusCode, back.body).toBe(201);
    expect((await get(`/api/pos/shifts/${second.id}`)).json()).toMatchObject({ refunds: { IQD: 5_000, USD: 0 }, expected: { IQD: 15_000, USD: 0 } });
    expect((await get(`/api/pos/shifts/${first.id}`)).json()).toMatchObject({ refunds: { IQD: 0, USD: 0 }, expected: { IQD: 60_000, USD: 0 } });
    // once the second drawer has closed, a later refund belongs to the first again
    expect((await post(`/api/pos/shifts/${second.id}/close`, { countedCash: 15_000 })).json().difference).toEqual({ IQD: 0, USD: 0 });
    const again = await post(`/api/invoices/${sold.invoice.id}/returns`, { date: sold.invoice.date, payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    expect(again.statusCode, again.body).toBe(201);
    expect((await get(`/api/pos/shifts/${first.id}`)).json()).toMatchObject({ refunds: { IQD: 2_500, USD: 0 }, expected: { IQD: 57_500, USD: 0 } });
    expect((await get(`/api/pos/shifts/${second.id}`)).json().refunds).toEqual({ IQD: 5_000, USD: 0 });
  });

  it('lets the cashier who opened a shift before sign-in was switched on keep running it', async () => {
    // no sign-in yet: every PC is the owner, and Mer types her name on the counter PC
    const shift = (await open()).json();
    await post('/api/plan/trial');
    const ownerId = (await get('/api/users')).json()[0].id;
    expect((await post(`/api/users/${ownerId}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
    expect((await post('/api/users', { username: 'mer', name: 'Mer', password: 'mer-pass-123', roles: ['sales'] })).statusCode).toBe(201);
    expect((await app.inject({ method: 'PUT', url: '/api/auth/signin', payload: { on: true }, headers })).statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'mer', password: 'mer-pass-123' }, headers: { 'x-qasa-client': '1' } });
    expect(res.statusCode, res.body).toBe(200);
    const mer = { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    const sale = { currency: 'IQD', lines: [{ itemId: cupId, qtyMilli: 1000, unitPrice: 1_000 }] };
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, sale, mer)).statusCode).toBe(201);
    expect((await get('/api/pos/current', mer)).json().shift.id).toBe(shift.id);
  });

  it('refuses an empty cart, missing stock, and selling on a closed shift', async () => {
    const shift = (await open()).json();
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', lines: [] })).statusCode).toBe(400);
    const short = await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', lines: [{ itemId: teaId, qtyMilli: 99_000, unitPrice: 2_500 }] });
    expect(short.json()).toMatchObject({ error: 'validation' });
    expect(short.json().details[0].code).toBe('stock_insufficient');
    expect(db.prepare('SELECT COUNT(*) AS n FROM invoices').get()).toMatchObject({ n: 0 });

    expect((await post(`/api/pos/shifts/${shift.id}/close`, { countedCash: 50_000 })).statusCode).toBe(200);
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', lines: [{ itemId: cupId, qtyMilli: 1000, unitPrice: 1_000 }] })).json())
      .toMatchObject({ error: 'pos_shift_closed' });
  });

  it('closes with the counted cash and the difference, by currency, and frees the register', async () => {
    const shift = (await open()).json();
    await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', lines: [{ itemId: teaId, qtyMilli: 2000, unitPrice: 2_500 }] });
    await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'USD', rateX100: 131_000, lines: [{ itemId: cupId, qtyMilli: 1000, unitPrice: 500 }] });
    const closed = await post(`/api/pos/shifts/${shift.id}/close`, { countedCash: 54_000, countedUsd: 500, notes: 'short 1,000' });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json()).toMatchObject({
      status: 'closed', closedBy: 'Mer', expected: { IQD: 55_000, USD: 500 }, counted: { IQD: 54_000, USD: 500 },
      difference: { IQD: -1_000, USD: 0 }, notes: 'short 1,000', actions: []
    });
    const row = db.prepare('SELECT expected_cash, counted_cash, expected_usd, counted_usd, notes FROM pos_shifts WHERE id = ?').get(shift.id);
    expect(row).toMatchObject({ expected_cash: 55_000, counted_cash: 54_000, expected_usd: 500, counted_usd: 500, notes: 'short 1,000' });
    // a sale cancelled after closing doesn't change what was expected at closing
    const sold = (await get(`/api/pos/shifts/${shift.id}`)).json().invoices[0].invoiceId;
    expect((await post(`/api/invoices/${sold}/cancel`, { reason: 'test' })).statusCode).toBe(200);
    expect((await get(`/api/pos/shifts/${shift.id}`)).json()).toMatchObject({ expected: { IQD: 55_000, USD: 500 }, difference: { IQD: -1_000, USD: 0 } });
    expect((await post(`/api/pos/shifts/${shift.id}/close`, { countedCash: 1 })).json()).toMatchObject({ error: 'pos_shift_closed' });
    expect((await open()).statusCode).toBe(201);
    expect((await get('/api/pos/shifts?status=closed')).json()).toHaveLength(1);
  });

  it('lets only the sales permission open and sell, and only the opener (or an admin) run a shift', async () => {
    const shift = (await open()).json();
    // sign-in on (the Pro trial allows more users): a salesperson, a stock keeper, and the owner (admin)
    await post('/api/plan/trial');
    const ownerId = (await get('/api/users')).json()[0].id;
    expect((await post(`/api/users/${ownerId}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
    expect((await post('/api/users', { username: 'raz', name: 'Raz', password: 'raz-pass-123', roles: ['sales'] })).statusCode).toBe(201);
    expect((await post('/api/users', { username: 'las', name: 'Las', password: 'las-pass-123', roles: ['storekeeper'] })).statusCode).toBe(201);
    expect((await app.inject({ method: 'PUT', url: '/api/auth/signin', payload: { on: true }, headers })).statusCode).toBe(200);
    const login = async (username: string, password: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, headers: { 'x-qasa-client': '1' } });
      expect(res.statusCode, res.body).toBe(200);
      const cookie = String(res.headers['set-cookie']).split(';')[0]!;
      return { cookie, 'x-qasa-client': '1' };
    };
    const raz = await login('raz', 'raz-pass-123');
    const las = await login('las', 'las-pass-123');
    const boss = await login('admin', 'admin-pass-123');

    expect((await post('/api/pos/shifts', { register: 'Counter 9', cashAccountCode: '1811', warehouseId, openingCash: 0 }, las)).statusCode).toBe(403);
    // Raz can't sell on Mer's shift; the admin can
    const sale = { currency: 'IQD', lines: [{ itemId: cupId, qtyMilli: 1000, unitPrice: 1_000 }] };
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, sale, raz)).statusCode).toBe(403);
    expect((await get(`/api/pos/shifts/${shift.id}`, raz)).json().actions).toEqual([]);
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, sale, boss)).statusCode).toBe(201);
    // Raz's own shift
    const hers = await post('/api/pos/shifts', { register: 'Counter 2', cashAccountCode: '1811', warehouseId, openingCash: 0 }, raz);
    expect(hers.statusCode, hers.body).toBe(201);
    expect((await post(`/api/pos/shifts/${hers.json().id}/sales`, sale, raz)).statusCode).toBe(201);
    expect((await get('/api/pos/current', raz)).json().shift.id).toBe(hers.json().id);
    // without the client header a change is refused (another site)
    expect((await app.inject({ method: 'POST', url: `/api/pos/shifts/${hers.json().id}/close`, payload: { countedCash: 0 }, headers: { cookie: raz.cookie } })).statusCode).toBe(403);
  });

  it('tells two users with the same name apart: only the one who opened the shift runs it', async () => {
    await post('/api/plan/trial');
    const ownerId = (await get('/api/users')).json()[0].id;
    expect((await post(`/api/users/${ownerId}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
    for (const username of ['las1', 'las2']) {
      expect((await post('/api/users', { username, name: 'Las S', password: `${username}-pass-123`, roles: ['sales'] })).statusCode).toBe(201);
    }
    expect((await app.inject({ method: 'PUT', url: '/api/auth/signin', payload: { on: true }, headers })).statusCode).toBe(200);
    const login = async (username: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: `${username}-pass-123` }, headers: { 'x-qasa-client': '1' } });
      expect(res.statusCode, res.body).toBe(200);
      return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    };
    const first = await login('las1');
    const second = await login('las2');
    const shift = (await post('/api/pos/shifts', { register: 'Counter 5', cashAccountCode: '1811', warehouseId, openingCash: 0 }, first)).json();
    expect(shift.actions).toEqual(['sell', 'close']);
    const sale = { currency: 'IQD', lines: [{ itemId: cupId, qtyMilli: 1000, unitPrice: 1_000 }] };
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, sale, second)).statusCode).toBe(403);
    expect((await post(`/api/pos/shifts/${shift.id}/close`, { countedCash: 0 }, second)).statusCode).toBe(403);
    expect((await get('/api/pos/current', second)).json().shift).toBeNull();
    expect((await get('/api/pos/current', first)).json().shift.id).toBe(shift.id);
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, sale, first)).statusCode).toBe(201);
  });

  it('with separate duties, a cashier neither voids a till sale nor pays it back in cash: an approver does, never the one who rang it up', async () => {
    await post('/api/plan/trial');
    const ownerId = (await get('/api/users')).json()[0].id;
    expect((await post(`/api/users/${ownerId}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
    expect((await post('/api/users', { username: 'raz', name: 'Raz', password: 'raz-pass-123', roles: ['sales'] })).statusCode).toBe(201);
    expect((await post('/api/users', { username: 'las', name: 'Las', password: 'las-pass-123', roles: ['sales', 'approver'] })).statusCode).toBe(201);
    expect((await app.inject({ method: 'PUT', url: '/api/auth/separate-duties', payload: { on: true }, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/api/auth/signin', payload: { on: true }, headers })).statusCode).toBe(200);
    const login = async (username: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: `${username}-pass-123` }, headers: { 'x-qasa-client': '1' } });
      expect(res.statusCode, res.body).toBe(200);
      return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    };
    const raz = await login('raz');
    const las = await login('las');
    const shift = (await post('/api/pos/shifts', { register: 'Counter 7', cashAccountCode: '1811', warehouseId, openingCash: 0 }, raz)).json();
    const sell = async () => (await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', lines: [{ itemId: teaId, qtyMilli: 1000, unitPrice: 2_500 }] }, raz)).json().invoice;
    const first = await sell();
    const second = await sell();
    expect((await get(`/api/pos/shifts/${shift.id}`, raz)).json().expected.IQD).toBe(5_000);
    // the cashier: neither a void nor a cash refund
    expect((await post(`/api/invoices/${first.id}/cancel`, {}, raz)).json()).toMatchObject({ error: 'forbidden', details: { need: 'entries.approve' } });
    const refund = { date: first.date, payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 1000 }] };
    expect((await post(`/api/invoices/${first.id}/returns`, refund, raz)).json()).toMatchObject({ error: 'forbidden', details: { need: 'entries.approve' } });
    expect((await get(`/api/pos/shifts/${shift.id}`, raz)).json().expected.IQD).toBe(5_000);
    // an approver does both
    expect((await post(`/api/invoices/${first.id}/cancel`, {}, las)).statusCode).toBe(200);
    expect((await post(`/api/invoices/${second.id}/returns`, refund, las)).statusCode).toBe(201);
    expect((await get(`/api/pos/shifts/${shift.id}`, raz)).json().expected.IQD).toBe(0);
    // but never on a sale they rang up themselves
    const own = (await post('/api/pos/shifts', { register: 'Counter 8', cashAccountCode: '1811', warehouseId, openingCash: 0 }, las)).json();
    const theirs = (await post(`/api/pos/shifts/${own.id}/sales`, { currency: 'IQD', lines: [{ itemId: teaId, qtyMilli: 1000, unitPrice: 2_500 }] }, las)).json().invoice;
    expect((await post(`/api/invoices/${theirs.id}/cancel`, {}, las)).json().error).toBe('same_person');
  });
});
