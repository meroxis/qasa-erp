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
const CONSIGNMENT_HELD_CODE = '268';

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

  it('charges a customer return to the supplier whose goods were sold, after the item changed supplier (accounting review #10)', async () => {
    await ok('POST', '/api/plan/trial');
    const other = (await ok('POST', '/api/parties', { type: 'supplier', name: 'Second Bakery' })).id;
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'IQD', unitCost: 800 });
    const r1 = await postDoc(receipt([{ itemId: breadId, qtyMilli: 2_000 }]));
    expect(r1.statusCode, r1.body).toBe(200);
    const first = await invoiceSale(2);
    expect((await call('POST', '/api/consignment/settlements', { supplierId, currency: 'IQD', date: '2026-11-20' })).statusCode).toBeLessThan(300);
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId: other, currency: 'IQD', unitCost: 800 });
    const r2 = await postDoc(receipt([{ itemId: breadId, qtyMilli: 5_000 }], { supplierId: other, date: '2026-11-13' }));
    expect(r2.statusCode, r2.body).toBe(200);
    await invoiceSale(5, '2026-11-14');
    expect((await call('POST', `/api/invoices/${first.id}/returns`, { date: '2026-11-20', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 1_000 }] })).statusCode).toBe(201);
    // the second bakery delivered 5 and 5 sold: it is owed 5 × 800, untouched by the first bakery's bread coming back
    const owed = await ok('GET', `/api/consignment/settlements/preview?supplierId=${other}&currency=IQD&date=2026-11-20`);
    expect(owed.amount).toBe(4_000);
    const back = db.prepare("SELECT supplier_id FROM consignment_moves WHERE source_type = 'sale_return'").get() as { supplier_id: string };
    expect(back.supplier_id).toBe(supplierId);
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

  it('makes, posts, settles and cancels once when a request comes twice with its key', async () => {
    await ok('POST', '/api/plan/trial');
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'IQD', unitCost: 500 });
    const key = (n: number) => ({ ...headers, 'x-qasa-idempotency': `5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e7${n}` });
    const twice = async (n: number, url: string, body: object) => {
      const first = await call('POST', url, body, key(n));
      expect(first.statusCode, first.body).toBeLessThan(300);
      const again = await call('POST', url, body, key(n));
      expect(again.headers['x-qasa-idempotent-replay'], url).toBe('1');
      expect(again.json().id).toBe(first.json().id);
      return first.json();
    };
    const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const stock = () => Number((db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q FROM stock_moves WHERE item_id = ?').get(breadId) as { q: number }).q);

    // the document, and posting it: one receipt, the goods in once
    const doc = await twice(1, '/api/consignment/docs', receipt([{ itemId: breadId, qtyMilli: 10_000 }]));
    expect(count('consignment_docs')).toBe(1);
    await twice(2, `/api/consignment/docs/${doc.id}/post`, { lang: 'en' });
    expect(stock()).toBe(10_000);
    expect(balanceOf(CONSIGNMENT_HELD_CODE)).toBe(-5_000);

    // the settlement of what sold: one settlement, the supplier owed once
    await sellAtTill(4);
    const settlement = await twice(3, '/api/consignment/settlements', { supplierId, currency: 'IQD', date: '2026-11-20', lang: 'en' });
    expect(count('consignment_settlements')).toBe(1);
    expect(settlement.amount).toBe(2_000);

    // taking the settlement back, and a second receipt cancelled: each once, the retry answered with the first
    const entries = count('entries');
    expect(await twice(4, `/api/consignment/settlements/${settlement.id}/cancel`, {})).toMatchObject({ status: 'cancelled' });
    expect(count('entries')).toBeLessThanOrEqual(entries);
    const second = await ok('POST', '/api/consignment/docs', receipt([{ itemId: breadId, qtyMilli: 3_000 }], { date: '2026-11-20' }));
    await ok('POST', `/api/consignment/docs/${second.id}/post`, { lang: 'en' });
    expect(await twice(5, `/api/consignment/docs/${second.id}/cancel`, {})).toMatchObject({ status: 'cancelled' });
    expect(stock()).toBe(6_000);
  });

  it('lets a dollar settlement at another rate be checked and approved (2.0 books review #1)', async () => {
    await ok('POST', '/api/plan/trial');
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'USD', unitCost: 100 });
    expect((await postDoc(receipt([{ itemId: breadId, qtyMilli: 10_000 }], { rateX100: 130_000 }))).statusCode).toBe(200);
    await sellAtTill(4);
    const s = await ok('POST', '/api/consignment/settlements', { supplierId, currency: 'USD', date: '2026-11-20', rateX100: 140_000 });
    // the line in dinars only (the exchange difference, 400) is no empty line
    const checked = await call('POST', `/api/entries/${s.entryId}/check`);
    expect(checked.statusCode, checked.body).toBe(200);
    const approved = await call('POST', `/api/entries/${s.entryId}/approve`);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(getEntry(db, s.entryId).status).toBe('approved');
    expect(balanceOf(CONSIGNMENT_HELD_CODE)).toBe(-(13_000 - 5_200));

    // revaluing dollar balances (books review #9): the supplier is owed $4, revalued like any debt; the goods held are
    // kept in dinars by the consignment's own ledger, so no line is put on 268 that a later settlement could not take off
    const report = await ok('GET', '/api/fx/revaluation?date=2026-11-20&rateX100=150000');
    expect(report.rows.map((r: { accountCode: string }) => r.accountCode)).not.toContain(CONSIGNMENT_HELD_CODE);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ partyId: supplierId, usd: -400, carried: -5_600, revalued: -6_000, mixed: false });
  });

  it('moves dollar goods between warehouses without changing the dollars owed (2.0 books review #4)', async () => {
    await ok('POST', '/api/plan/trial');
    const w2 = (await ok('POST', '/api/warehouses', { code: 'W2', name: { ar: 'مخزن ٢', en: 'Second store', ku: 'کۆگای ٢' } })).id;
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'USD', unitCost: 1_000 });
    // 10 × $10 in the second store when a dollar is 1,300, and 10 × $10 in the main one at 1,500
    expect((await postDoc(receipt([{ itemId: breadId, qtyMilli: 10_000 }], { warehouseId: w2, rateX100: 130_000 }))).statusCode).toBe(200);
    expect((await postDoc(receipt([{ itemId: breadId, qtyMilli: 10_000 }], { rateX100: 150_000 }))).statusCode).toBe(200);
    const transfer = await ok('POST', '/api/stock-docs', { kind: 'transfer', date: '2026-11-11', warehouseId, toWarehouseId: w2, lines: [{ itemId: breadId, qtyMilli: 10_000 }] });
    await ok('POST', `/api/stock-docs/${transfer.id}/post`, {});
    const legs = db.prepare("SELECT qty_milli, ccy_value FROM consignment_moves WHERE source_type = 'transfer' ORDER BY qty_milli").all() as { qty_milli: number; ccy_value: number }[];
    expect(legs.map((l) => Number(l.ccy_value))).toEqual([-10_000, 10_000]);
    const sale = await ok('POST', '/api/invoices', {
      kind: 'sale', date: '2026-11-12', partyId: customerId, warehouseId: w2, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
      lines: [{ itemId: breadId, qtyMilli: 20_000, unitPrice: 20_000 }]
    });
    await ok('POST', `/api/invoices/${sale.id}/post`, {});
    const owed = await ok('GET', `/api/consignment/settlements/preview?supplierId=${supplierId}&currency=USD&date=2026-11-20`);
    expect(owed.amount).toBe(20_000);
  });

  it('keeps goods already received at what they were received at when the agreed cost changes, also across a transfer (2.0 books review #4)', async () => {
    await ok('POST', '/api/plan/trial');
    const w2 = (await ok('POST', '/api/warehouses', { code: 'W2', name: { ar: 'مخزن ٢', en: 'Second store', ku: 'کۆگای ٢' } })).id;
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'USD', unitCost: 1_000 });
    expect((await postDoc(receipt([{ itemId: breadId, qtyMilli: 10_000 }], { rateX100: 130_000 }))).statusCode).toBe(200);
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'USD', unitCost: 1_200 });
    const transfer = await ok('POST', '/api/stock-docs', { kind: 'transfer', date: '2026-11-11', warehouseId, toWarehouseId: w2, lines: [{ itemId: breadId, qtyMilli: 10_000 }] });
    await ok('POST', `/api/stock-docs/${transfer.id}/post`, {});
    const sale = await ok('POST', '/api/invoices', {
      kind: 'sale', date: '2026-11-12', partyId: customerId, warehouseId: w2, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
      lines: [{ itemId: breadId, qtyMilli: 10_000, unitPrice: 20_000 }]
    });
    await ok('POST', `/api/invoices/${sale.id}/post`, {});
    expect((await ok('GET', `/api/consignment/settlements/preview?supplierId=${supplierId}&currency=USD&date=2026-11-20`)).amount).toBe(10_000);
  });

  it('owes a returned unit sold again to the supplier whose goods it is (2.0 books review #11)', async () => {
    await ok('POST', '/api/plan/trial');
    const other = (await ok('POST', '/api/parties', { type: 'supplier', name: 'Second Bakery' })).id;
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'IQD', unitCost: 800 });
    expect((await postDoc(receipt([{ itemId: breadId, qtyMilli: 2_000 }]))).statusCode).toBe(200);
    const first = await invoiceSale(2);
    await ok('POST', '/api/consignment/settlements', { supplierId, currency: 'IQD', date: '2026-11-12' });
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId: other, currency: 'IQD', unitCost: 900 });
    expect((await postDoc(receipt([{ itemId: breadId, qtyMilli: 5_000 }], { supplierId: other, date: '2026-11-13' }))).statusCode).toBe(200);
    // one of the first bakery's loaves comes back, then all six on the shelf sell
    expect((await call('POST', `/api/invoices/${first.id}/returns`, { date: '2026-11-14', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 1_000 }] })).statusCode).toBe(201);
    await invoiceSale(6, '2026-11-15');
    const second = await ok('GET', `/api/consignment/settlements/preview?supplierId=${other}&currency=IQD&date=2026-11-20`);
    expect(second.amount).toBe(4_500);
    const firstAgain = await ok('GET', `/api/consignment/settlements/preview?supplierId=${supplierId}&currency=IQD&date=2026-11-20`);
    // the loaf that came back (−800) and was sold again (+800): nothing more is owed to the first bakery
    expect(firstAgain.amount).toBe(0);
    const onHand = db.prepare('SELECT supplier_id, SUM(qty_milli) AS q, SUM(value) AS v FROM consignment_moves GROUP BY supplier_id').all() as { supplier_id: string; q: number; v: number }[];
    expect(onHand.map((r) => [Number(r.q), Number(r.v)])).toEqual([[0, 0], [0, 0]]);
  });

  it('leaves no dinars on a supplier with no goods: a returned unit carried above the average, sold one at a time or sent back (verify report #14)', async () => {
    await ok('POST', '/api/plan/trial');
    const other = (await ok('POST', '/api/parties', { type: 'supplier', name: 'Second Bakery' })).id;
    const layers = () => (db.prepare('SELECT supplier_id, SUM(qty_milli) AS q, SUM(value) AS v FROM consignment_moves GROUP BY supplier_id').all() as { supplier_id: string; q: number; v: number }[])
      .map((r) => [r.supplier_id === supplierId ? 'first' : 'second', Number(r.q), Number(r.v)]).sort();
    // the first bakery's loaves cost 900, the second's 800
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'IQD', unitCost: 900 });
    expect((await postDoc(receipt([{ itemId: breadId, qtyMilli: 2_000 }]))).statusCode).toBe(200);
    const first = await invoiceSale(2);
    await ok('POST', '/api/consignment/settlements', { supplierId, currency: 'IQD', date: '2026-11-12' });
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId: other, currency: 'IQD', unitCost: 800 });
    expect((await postDoc(receipt([{ itemId: breadId, qtyMilli: 5_000 }], { supplierId: other, date: '2026-11-13' }))).statusCode).toBe(200);
    // one of the first bakery's loaves comes back (carried at 900), then one loaf sells: the shelf's average is 816.67,
    // and the loaf that goes is the first bakery's
    expect((await call('POST', `/api/invoices/${first.id}/returns`, { date: '2026-11-14', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 1_000 }] })).statusCode).toBe(201);
    await invoiceSale(1, '2026-11-15');
    // the first bakery has no goods and no dinars left on it; what the average put elsewhere is on the second's goods
    expect(layers()).toEqual([['first', 0, 0], ['second', 5_000, 4_083]]);
    expect(stock(breadId)).toMatchObject({ q: 5_000, v: 4_083 });
    // … and is owed the loaf at what it is carried at: nothing more after the return (−900) and the sale (+900)
    expect((await ok('GET', `/api/consignment/settlements/preview?supplierId=${supplierId}&currency=IQD&date=2026-11-20`)).amount).toBe(0);
    // the second bakery's five sell one at a time: it ends with no goods, no dinars, and is owed 5 × 800 to the dinar
    for (let i = 0; i < 5; i++) await invoiceSale(1, '2026-11-16');
    expect(layers()).toEqual([['first', 0, 0], ['second', 0, 0]]);
    expect((await ok('GET', `/api/consignment/settlements/preview?supplierId=${other}&currency=IQD&date=2026-11-20`)).amount).toBe(4_000);
  });

  it('sends a supplier\'s goods back at what that supplier\'s goods are carried at, with another supplier\'s unit on the shelf (verify report #14)', async () => {
    await ok('POST', '/api/plan/trial');
    const other = (await ok('POST', '/api/parties', { type: 'supplier', name: 'Second Bakery' })).id;
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId, currency: 'IQD', unitCost: 900 });
    expect((await postDoc(receipt([{ itemId: breadId, qtyMilli: 2_000 }]))).statusCode).toBe(200);
    const first = await invoiceSale(2);
    await ok('PUT', `/api/consignment/items/${breadId}`, { supplierId: other, currency: 'IQD', unitCost: 800 });
    expect((await postDoc(receipt([{ itemId: breadId, qtyMilli: 5_000 }], { supplierId: other, date: '2026-11-13' }))).statusCode).toBe(200);
    expect((await call('POST', `/api/invoices/${first.id}/returns`, { date: '2026-11-14', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 1_000 }] })).statusCode).toBe(201);
    // all five of the second bakery's loaves go back to it: 5 × 800, not five sixths of the shelf's 4,900
    const back = await postDoc({ kind: 'return', date: '2026-11-15', supplierId: other, warehouseId, lines: [{ itemId: breadId, qtyMilli: 5_000 }] });
    expect(back.statusCode, back.body).toBe(200);
    const rows = (db.prepare('SELECT supplier_id, SUM(qty_milli) AS q, SUM(value) AS v FROM consignment_moves GROUP BY supplier_id').all() as { supplier_id: string; q: number; v: number }[])
      .map((r) => [r.supplier_id === supplierId ? 'first' : 'second', Number(r.q), Number(r.v)]).sort();
    expect(rows).toEqual([['first', 1_000, 900], ['second', 0, 0]]);
    expect(stock(breadId)).toMatchObject({ q: 1_000, v: 900 });
    expect(balanceOf(CONSIGNMENT_HELD_CODE)).toBe(-(db.prepare("SELECT COALESCE(SUM(value), 0) AS v FROM consignment_moves WHERE kind IN ('received', 'returned')").get() as { v: number }).v);
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
