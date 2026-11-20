import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { batchBalance } from './batches.ts';
import { getEntry } from './journal.ts';
import { writeSetting } from './settings.ts';

// Goods on consignment (sale-or-return): receipts and returns to the supplier, sales at the till and on invoices at
// the agreed cost, customers' returns and write-offs, settlements that wait for approval, dollars, batches, the plan.

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let stockAccount: string;
let supplierId: string;
let customerId: string;
let breadId: string;

type H = Record<string, string>;
const headers: H = { 'x-qasa-user': encodeURIComponent('Mer') };
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, h: H = headers) =>
  app.inject({ method, url, headers: h, ...(body === undefined ? {} : { payload: body as object }) });
async function ok(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const r = await call(method, url, body);
  expect(r.statusCode, `${method} ${url}: ${r.body}`).toBeLessThan(300);
  return r.json();
}

/** an account's balance in the books (approved entries), debit positive */
const balanceOf = (code: string) => Number((db.prepare(`SELECT COALESCE(SUM(l.base_debit - l.base_credit), 0) AS b FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                                                         WHERE l.account_code = ? AND e.status = 'approved'`).get(code) as { b: number }).b);
const stock = (itemId: string) => db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q, COALESCE(SUM(value), 0) AS v FROM stock_moves WHERE item_id = ?').get(itemId) as { q: number; v: number };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T09:00:00Z'));
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await ok('GET', '/api/warehouses'))[0].id;
  stockAccount = (db.prepare('SELECT account_code FROM warehouses WHERE id = ?').get(warehouseId) as { account_code: string }).account_code;
  supplierId = (await ok('POST', '/api/parties', { type: 'supplier', name: 'Samoon Bakery' })).id;
  customerId = (await ok('POST', '/api/parties', { type: 'customer', name: 'Bazaar Trading Company' })).id;
  breadId = (await ok('POST', '/api/items', { code: 'SAMOON', name: { ar: 'صمون', en: 'Samoon bread', ku: 'سەموون' }, unit: 'piece', salePrice: 1_000, saleCurrency: 'IQD' })).id;
});

afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  db.close();
});

const receipt = (lines: object[], extra: object = {}) =>
  ({ kind: 'receipt', date: '2026-11-10', supplierId, warehouseId, lines, ...extra });

async function postDoc(body: object) {
  const draft = await ok('POST', '/api/consignment/docs', body);
  return call('POST', `/api/consignment/docs/${draft.id}/post`, { lang: 'en' });
}

async function sellAtTill(qty: number) {
  const shift = await ok('POST', '/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId, openingCash: 0 });
  const sale = await call('POST', `/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', lines: [{ itemId: breadId, qtyMilli: qty * 1000, unitPrice: 1_000 }] });
  expect(sale.statusCode, sale.body).toBe(201);
  return sale.json().invoice;
}

async function invoiceSale(qty: number, date = '2026-11-12') {
  const draft = await ok('POST', '/api/invoices', {
    kind: 'sale', date, partyId: customerId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
    lines: [{ itemId: breadId, qtyMilli: qty * 1000, unitPrice: 1_100 }]
  });
  return ok('POST', `/api/invoices/${draft.id}/post`, {});
}

describe('goods on consignment', () => {
  it('is behind the plan', async () => {
    const free = await call('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'IQD', unitCost: 750 });
    expect(free.statusCode).toBe(409);
    expect(free.json()).toMatchObject({ error: 'plan_limit', details: { limit: 'consignment' } });
    await ok('POST', '/api/plan/trial');
    expect((await call('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'IQD', unitCost: 750 })).statusCode).toBe(200);
  });

  it('takes goods in as the supplier’s, sells them at the agreed cost, and settles what sold through approval', async () => {
    await ok('POST', '/api/plan/trial');
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'IQD', unitCost: 750 });

    // 100 loaves come in at the agreed 750: Dr the warehouse, Cr consignment goods held (268, made on first use)
    const r = await postDoc(receipt([{ itemId: breadId, qtyMilli: 100_000 }]));
    expect(r.statusCode, r.body).toBe(200);
    const doc = r.json();
    expect(doc).toMatchObject({ status: 'posted', number: 'CSR-2026-0001', total: 75_000, actions: ['cancel'] });
    expect(getEntry(db, doc.entryId).lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([[stockAccount, 75_000, 0], ['268', 0, 75_000]]);
    expect(stock(breadId)).toMatchObject({ q: 100_000, v: 75_000 });
    // nothing is owed to the supplier for goods that have not sold
    expect((await ok('GET', `/api/parties/${supplierId}`)).balance).toBe(0);

    // the stock is the supplier's: it is never bought, nor brought in as opening stock
    const purchase = await ok('POST', '/api/invoices', {
      kind: 'purchase', date: '2026-11-11', partyId: supplierId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
      lines: [{ itemId: breadId, qtyMilli: 1000, unitPrice: 700 }]
    });
    const refused = await call('POST', `/api/invoices/${purchase.id}/post`, {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('item_on_consignment');

    // sold on an invoice and at the till like any item: the cost of sales is the agreed cost
    const sale = await invoiceSale(10);
    // a customer brings 2 back, and one loaf is written off as damaged (the shop bears it: it counts as sold)
    expect((await call('POST', `/api/invoices/${sale.id}/returns`, { date: '2026-11-13', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 2_000 }] })).statusCode).toBe(201);
    const adj = await ok('POST', '/api/adjustments', { date: '2026-11-13', warehouseId, reason: 'damaged', lines: [{ itemId: breadId, qtyMilli: -1_000 }] });
    expect((await call('POST', `/api/adjustments/${adj.id}/post`, {})).statusCode).toBe(200);
    // 5 go back to the supplier
    const back = await postDoc({ kind: 'return', date: '2026-11-14', supplierId, warehouseId, lines: [{ itemId: breadId, qtyMilli: 5_000 }] });
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json()).toMatchObject({ number: 'CST-2026-0001', total: 3_750 });
    const till = await sellAtTill(30);
    const tillEntry = getEntry(db, till.entryId).lines.map((l) => [l.accountCode, l.debit, l.credit]);
    expect(tillEntry).toContainEqual([stockAccount, 0, 22_500]);

    // on hand 56 (100 − 30 − 10 + 2 − 1 − 5); 268 holds them at cost plus the 39 sold and not settled
    expect(stock(breadId)).toMatchObject({ q: 56_000, v: 42_000 });
    expect(balanceOf('268')).toBe(-(42_000 + 39 * 750));
    const preview = await ok('GET', `/api/consignment/settlements/preview?supplierId=${supplierId}&currency=IQD&date=2026-11-20`);
    expect(preview).toMatchObject({ amount: 29_250, value: 29_250, lines: [{ itemId: breadId, qtyMilli: 39_000, amount: 29_250 }] });

    // the settlement is what the supplier is owed: an entry that waits for checking and approval
    const settled = await ok('POST', '/api/consignment/settlements', { supplierId, currency: 'IQD', date: '2026-11-20', lang: 'en' });
    expect(settled).toMatchObject({ number: 'CSS-2026-0001', amount: 29_250, entryState: 'draft', status: 'open' });
    expect(getEntry(db, settled.entryId).lines.map((l) => [l.accountCode, l.debit, l.credit, l.partyId ?? null]))
      .toEqual([['268', 29_250, 0, null], ['2611', 0, 29_250, supplierId]]);
    expect((await ok('GET', `/api/parties/${supplierId}`)).balance).toBe(0);
    // nothing is settled twice
    expect((await call('POST', '/api/consignment/settlements', { supplierId, currency: 'IQD', date: '2026-11-20' })).json().error).toBe('cs_nothing_to_settle');
    // its entry is taken back from the consignment page only
    expect((await call('DELETE', `/api/entries/${settled.entryId}`)).json().error).toBe('entry_belongs_to_consignment');

    // taken back while a draft: the entry goes and the sales are open to settle again
    const cancelled = await ok('POST', `/api/consignment/settlements/${settled.id}/cancel`, {});
    expect(cancelled).toMatchObject({ status: 'cancelled', entryId: null });
    expect(db.prepare('SELECT 1 FROM entries WHERE id = ?').get(settled.entryId)).toBeUndefined();
    expect((await ok('GET', `/api/consignment/settlements/preview?supplierId=${supplierId}&currency=IQD&date=2026-11-20`)).amount).toBe(29_250);

    // settled again, checked and approved: now the supplier is owed it, and 268 holds only the goods on hand
    const again = await ok('POST', '/api/consignment/settlements', { supplierId, currency: 'IQD', date: '2026-11-20' });
    await ok('POST', `/api/entries/${again.entryId}/check`, {});
    await ok('POST', `/api/entries/${again.entryId}/approve`, {});
    expect((await ok('GET', `/api/consignment/settlements/${again.id}`)).entryState).toBe('approved');
    expect((await ok('GET', `/api/parties/${supplierId}`)).balance).toBe(29_250);
    expect(balanceOf('268')).toBe(-42_000);

    // paid as usual
    const pay = await ok('POST', '/api/vouchers', {
      kind: 'payment', date: '2026-11-20', cashAccountCode: '1811', description: 'Samoon', currency: 'IQD', rateX100: 100,
      items: [{ accountCode: '2611', amount: 20_000, partyId: supplierId }]
    });
    await ok('POST', `/api/entries/${pay.id}/check`, {});
    await ok('POST', `/api/entries/${pay.id}/approve`, {});

    const st = await ok('GET', `/api/consignment/statement/${supplierId}?to=2026-11-20`);
    expect(st.items).toEqual([expect.objectContaining({ itemId: breadId, receivedMilli: 100_000, returnedMilli: 5_000, soldMilli: 39_000, onHandMilli: 56_000, soldAmount: 29_250, onHandAmount: 42_000 })]);
    expect(st.totals.IQD).toMatchObject({ received: 75_000, returned: 3_750, sold: 29_250, onHand: 42_000, settled: 29_250, waiting: 0, unsettled: 0 });
    expect(st).toMatchObject({ paid: 20_000, balance: 9_250 });

    // a reversal of the approved settlement owes nothing again and opens the sales to settle once more
    await ok('POST', `/api/consignment/settlements/${again.id}/cancel`, {});
    expect((await ok('GET', `/api/parties/${supplierId}`)).balance).toBe(-20_000);
    expect((await ok('GET', `/api/consignment/settlements/preview?supplierId=${supplierId}&currency=IQD&date=2026-11-20`)).amount).toBe(29_250);

    // the trial balance still balances
    const tb = await ok('GET', '/api/reports/trial-balance');
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it('keeps its terms while the item is on hand, and refuses to cancel a receipt whose goods have sold', async () => {
    await ok('POST', '/api/plan/trial');
    const other = (await ok('POST', '/api/parties', { type: 'supplier', name: 'Other Bakery' })).id;
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'IQD', unitCost: 750 });
    const r = (await postDoc(receipt([{ itemId: breadId, qtyMilli: 10_000 }]))).json();
    // a new cost is fine (it applies to the next receipt); a new supplier or currency waits for the stock to go
    expect((await call('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'IQD', unitCost: 800 })).statusCode).toBe(200);
    expect((await call('PUT', `/api/consignment/items/${breadId}`, { supplierId: other, currency: 'IQD', unitCost: 800 })).json().error).toBe('cs_item_has_stock');
    expect((await call('POST', `/api/consignment/items/${breadId}/end`, {})).json().error).toBe('cs_item_has_stock');
    // another supplier's item can't be on this supplier's receipt
    const theirs = (await ok('POST', '/api/items', { code: 'CAKE', name: { ar: 'كيك', en: 'Cake', ku: 'کێک' }, unit: 'piece', salePrice: 2_000, saleCurrency: 'IQD' })).id;
    await ok('PUT', `/api/consignment/items/${theirs}`, { supplierId: other, currency: 'IQD', unitCost: 1_500 });
    const mixed = await call('POST', '/api/consignment/docs', receipt([{ itemId: theirs, qtyMilli: 1_000 }]));
    expect(mixed.json().details).toEqual([{ code: 'cs_item_not_from_supplier', line: 1 }]);

    await sellAtTill(4);
    const cancel = await call('POST', `/api/consignment/docs/${r.id}/cancel`, {});
    expect(cancel.statusCode).toBe(400);
    expect(cancel.json().details[0].code).toBe('stock_insufficient');
    // what is left goes back to the supplier; the item can then leave consignment
    expect((await postDoc({ kind: 'return', date: '2026-11-20', supplierId, warehouseId, lines: [{ itemId: breadId, qtyMilli: 6_000 }] })).statusCode).toBe(200);
    expect((await ok('POST', `/api/consignment/items/${breadId}/end`, {})).active).toBe(false);
    // and once off consignment it is an ordinary item again: it can be bought
    const purchase = await ok('POST', '/api/invoices', {
      kind: 'purchase', date: '2026-11-20', partyId: other, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
      lines: [{ itemId: breadId, qtyMilli: 1000, unitPrice: 700 }]
    });
    expect((await call('POST', `/api/invoices/${purchase.id}/post`, {})).statusCode).toBe(200);
  });

  it('cancels a receipt whose goods are all still there, and a cancelled sale gives back what it took', async () => {
    await ok('POST', '/api/plan/trial');
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'IQD', unitCost: 750 });
    const first = (await postDoc(receipt([{ itemId: breadId, qtyMilli: 10_000 }]))).json();
    const sale = await invoiceSale(3, '2026-11-12');
    expect((await call('POST', `/api/invoices/${sale.id}/cancel`, { date: '2026-11-13' })).statusCode).toBe(200);
    expect((await ok('GET', `/api/consignment/settlements/preview?supplierId=${supplierId}&currency=IQD&date=2026-11-20`)).amount).toBe(0);
    const cancelled = await ok('POST', `/api/consignment/docs/${first.id}/cancel`, { date: '2026-11-14' });
    expect(cancelled.status).toBe('cancelled');
    expect(stock(breadId)).toMatchObject({ q: 0, v: 0 });
    expect(balanceOf('268')).toBe(0);
  });

  it('settles dollars at the day’s rate, the difference going to other expenses', async () => {
    await ok('POST', '/api/plan/trial');
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'USD', unitCost: 100 });
    // 10 at $1.00 when a dollar is 1,300: carried at 13,000
    const r = await postDoc(receipt([{ itemId: breadId, qtyMilli: 10_000 }], { rateX100: 130_000 }));
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ currency: 'USD', total: 1_000 });
    expect(stock(breadId)).toMatchObject({ v: 13_000 });
    expect((await call('POST', '/api/consignment/docs', receipt([{ itemId: breadId, qtyMilli: 1_000 }]))).json().details).toEqual([{ code: 'rate_invalid', field: 'rateX100' }]);
    await sellAtTill(4);
    const s = await ok('POST', '/api/consignment/settlements', { supplierId, currency: 'USD', date: '2026-11-20', rateX100: 140_000 });
    expect(s).toMatchObject({ amount: 400, value: 5_200, currency: 'USD' });
    const e = getEntry(db, s.entryId);
    const base = e.lines.reduce((t, l) => t + l.baseDebit - l.baseCredit, 0);
    expect(base).toBe(0);
    expect(e.lines.find((l) => l.partyId === supplierId)).toMatchObject({ credit: 400, baseCredit: 5_600 });
    expect(e.lines.find((l) => l.accountCode === '268')).toMatchObject({ debit: 400, baseDebit: 5_200 });
    expect(e.lines.find((l) => l.accountCode.startsWith('39'))).toMatchObject({ baseDebit: 400 });
  });

  it('keeps batches and expiry dates for consigned goods', async () => {
    await ok('POST', '/api/plan/trial');
    const milk = (await ok('POST', '/api/items', { code: 'MILK', name: { ar: 'حليب', en: 'Milk', ku: 'شیر' }, unit: 'piece', salePrice: 1_500, saleCurrency: 'IQD', trackExpiry: true })).id;
    await ok('PUT', `/api/consignment/items/${milk}`, { supplierId, currency: 'IQD', unitCost: 1_000 });
    const noExpiry = await postDoc(receipt([{ itemId: milk, qtyMilli: 5_000 }]));
    expect(noExpiry.json().details).toEqual([{ code: 'expiry_required', line: 1 }]);
    expect((await postDoc(receipt([{ itemId: milk, qtyMilli: 5_000, batchNo: 'M1', expiry: '2026-12-01' }]))).statusCode).toBe(200);
    expect((await postDoc({ kind: 'return', date: '2026-11-15', supplierId, warehouseId, lines: [{ itemId: milk, qtyMilli: 2_000 }] })).statusCode).toBe(200);
    const b = batchBalance(db, milk, warehouseId);
    expect(b.batches).toBe(b.stock);
    expect(b.stock).toBe(3_000);
  });

  it('lets an item on consignment that never moved be deleted, with its terms', async () => {
    await ok('POST', '/api/plan/trial');
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'IQD', unitCost: 750 });
    const draft = await ok('POST', '/api/consignment/docs', receipt([{ itemId: breadId, qtyMilli: 1_000 }]));
    expect((await call('DELETE', `/api/items/${breadId}`)).json().error).toBe('item_in_use');
    expect((await call('DELETE', `/api/consignment/docs/${draft.id}`)).statusCode).toBe(204);
    expect((await call('DELETE', `/api/items/${breadId}`)).statusCode).toBe(204);
    expect(db.prepare('SELECT 1 FROM consignment_items WHERE item_id = ?').get(breadId)).toBeUndefined();
  });

  it('shows its costs only to those who keep the books', async () => {
    await ok('POST', '/api/plan/trial');
    writeSetting(db, 'separate_duties', '0');
    const owner = (await ok('GET', '/api/users'))[0];
    await ok('POST', `/api/users/${owner.id}/password`, { password: 'admin-pass-123' });
    await ok('POST', '/api/users', { username: 'las', name: 'Las', password: 'las-pass-123', roles: ['pos'] });
    await ok('PUT', '/api/auth/signin', { on: true });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'las', password: 'las-pass-123' }, headers: { 'x-qasa-client': '1' } });
    const cashier = { cookie: String(login.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    expect((await call('GET', '/api/consignment/items', undefined, cashier)).statusCode).toBe(403);
    expect((await call('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'IQD', unitCost: 1 }, cashier)).statusCode).toBe(403);
  });
});
