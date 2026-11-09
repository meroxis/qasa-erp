import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { batchBalance, batchReport, updateBatch } from './batches.ts';
import { dailyBrief } from './brief.ts';

let db: Db;
let app: FastifyInstance;
let mainId: string;
let otherId: string;
let customerId: string;
let supplierId: string;
let medId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer') };
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) =>
  app.inject({ method, url, headers, ...(body !== undefined ? { payload: body as object } : {}) });
const ok = async (method: 'POST' | 'PUT', url: string, body: unknown = {}) => {
  const r = await call(method, url, body);
  expect(r.statusCode, `${url} ${r.body}`).toBeLessThan(300);
  return r.json();
};

/** For a tracked item, the batches of each warehouse always add up to its stock. */
function invariant(): void {
  for (const w of [mainId, otherId]) {
    const b = batchBalance(db, medId, w);
    expect(b.batches, `warehouse ${w}`).toBe(b.stock);
  }
}

const batches = async (warehouseId = mainId) => (await call('GET', `/api/batches?itemId=${medId}&warehouseId=${warehouseId}`)).json() as { batch: string; expiry: string | null; qtyMilli: number; batchId: string }[];
const byNumber = async (warehouseId = mainId) => Object.fromEntries((await batches(warehouseId)).map((b) => [b.batch, b.qtyMilli]));

const invoice = (kind: 'sale' | 'purchase', date: string, lines: object[]) => ({
  kind, date, partyId: kind === 'sale' ? customerId : supplierId, warehouseId: mainId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0, lines
});
async function postNew(body: object, post: object = {}) {
  const draft = await ok('POST', '/api/invoices', body);
  return call('POST', `/api/invoices/${draft.id}/post`, post);
}

/** A purchase of two batches: A expires first (2027-01), B later (2027-06). */
async function buyTwo(date = '2026-10-01') {
  const r = await postNew(invoice('purchase', date, [
    { itemId: medId, qtyMilli: 30_000, unitPrice: 200, batchNo: 'B-2706', expiry: '2027-06-30' },
    { itemId: medId, qtyMilli: 20_000, unitPrice: 200, batchNo: 'A-2701', expiry: '2027-01-31' }
  ]));
  expect(r.statusCode, r.body).toBe(200);
  invariant();
  return r.json();
}

beforeEach(async () => {
  // the documents here run into 2027 (sales on expired batches): today is after them, as stock moves can't be dated ahead
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-03-01T09:00:00Z'));
  db = openDatabase(':memory:');
  app = buildApp(db);
  mainId = (await call('GET', '/api/warehouses')).json()[0].id;
  await ok('POST', '/api/plan/trial'); // a second warehouse needs a paid plan (or the trial)
  otherId = (await ok('POST', '/api/warehouses', { code: 'ERBIL', name: { ar: 'أربيل', en: 'Erbil', ku: 'هەولێر' } })).id;
  customerId = (await ok('POST', '/api/parties', { type: 'customer', name: 'Mer' })).id;
  supplierId = (await ok('POST', '/api/parties', { type: 'supplier', name: 'Las' })).id;
  medId = (await ok('POST', '/api/items', {
    code: 'PARA-500', name: { ar: 'باراسيتامول 500', en: 'Paracetamol 500', ku: 'پاراسیتامۆڵ 500' }, unit: 'tablet', salePrice: 250, saleCurrency: 'IQD', trackExpiry: true
  })).id;
});

afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  db.close();
});

describe('batches and expiry dates', () => {
  it('an item with expiry dates tracks batches; a purchase line without an expiry is refused', async () => {
    const item = (await call('GET', `/api/items/${medId}`)).json();
    expect(item).toMatchObject({ trackBatches: true, trackExpiry: true });
    const r = await postNew(invoice('purchase', '2026-10-01', [{ itemId: medId, qtyMilli: 1000, unitPrice: 200, batchNo: 'X' }]));
    expect(r.statusCode).toBe(400);
    expect(r.json().details).toEqual([{ code: 'expiry_required', line: 1 }]);
    // one number means one expiry date
    await buyTwo();
    const differs = await postNew(invoice('purchase', '2026-10-02', [{ itemId: medId, qtyMilli: 1000, unitPrice: 200, batchNo: 'A-2701', expiry: '2027-02-28' }]));
    expect(differs.json().details).toEqual([{ code: 'batch_expiry_differs', line: 1, expiry: '2027-01-31' }]);
  });

  it('a sale takes the earliest expiry first, over two batches; a pinned batch is taken as asked; cancelling puts them back', async () => {
    await buyTwo();
    const sale = await postNew(invoice('sale', '2026-10-05', [{ itemId: medId, qtyMilli: 25_000, unitPrice: 250 }]));
    expect(sale.statusCode, sale.body).toBe(200);
    expect(await byNumber()).toEqual({ 'B-2706': 25_000 });
    invariant();
    const b = (await batches()).find((x) => x.batch === 'B-2706')!;
    const pinned = await postNew(invoice('sale', '2026-10-05', [{ itemId: medId, qtyMilli: 2_000, unitPrice: 250, batchId: b.batchId }]));
    expect(pinned.statusCode, pinned.body).toBe(200);
    expect(pinned.json().lines[0].batchId).toBe(b.batchId);
    expect(await byNumber()).toEqual({ 'B-2706': 23_000 });
    expect((await call('POST', `/api/invoices/${sale.json().id}/cancel`, { date: '2026-10-06' })).statusCode).toBe(200);
    expect(await byNumber()).toEqual({ 'A-2701': 20_000, 'B-2706': 28_000 });
    invariant();
  });

  it('expired stock: blocked by default; under warn only when the user confirms, and that sale is audited', async () => {
    await buyTwo('2026-10-01');
    // on 2027-02-15 batch A (2027-01-31) is past its date
    const blocked = await postNew(invoice('sale', '2027-02-15', [{ itemId: medId, qtyMilli: 40_000, unitPrice: 250 }]));
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().details).toEqual([{ code: 'batch_expired', line: 1, available: 30_000, batch: 'A-2701', expiry: '2027-01-31' }]);
    // good stock is enough: FEFO skips the expired batch
    expect((await postNew(invoice('sale', '2027-02-15', [{ itemId: medId, qtyMilli: 10_000, unitPrice: 250 }]))).statusCode).toBe(200);
    expect(await byNumber()).toEqual({ 'A-2701': 20_000, 'B-2706': 20_000 });
    const a = (await batches()).find((x) => x.batch === 'A-2701')!;
    const pinnedExpired = await postNew(invoice('sale', '2027-02-15', [{ itemId: medId, qtyMilli: 1_000, unitPrice: 250, batchId: a.batchId }]), { allowExpired: true });
    expect(pinnedExpired.json().details[0]).toMatchObject({ code: 'batch_expired', line: 1 });

    expect((await call('PUT', '/api/batches/settings', { expiredSales: 'warn' })).statusCode).toBe(200);
    const unconfirmed = await postNew(invoice('sale', '2027-02-15', [{ itemId: medId, qtyMilli: 30_000, unitPrice: 250 }]));
    expect(unconfirmed.json().details[0]).toMatchObject({ code: 'batch_expired' });
    const confirmed = await postNew(invoice('sale', '2027-02-15', [{ itemId: medId, qtyMilli: 30_000, unitPrice: 250 }]), { allowExpired: true });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(await byNumber()).toEqual({ 'A-2701': 10_000 });
    const audited = db.prepare("SELECT entity_id FROM audit_log WHERE action = 'sell_expired'").all() as { entity_id: string }[];
    expect(audited.map((r) => r.entity_id)).toEqual([confirmed.json().id]);
    invariant();
  });

  it('writes off an expired batch through a draft adjustment pinned to it', async () => {
    await buyTwo();
    const a = (await batches()).find((x) => x.batch === 'A-2701')!;
    const draft = await ok('POST', '/api/batches/write-off', { warehouseId: mainId, date: '2027-02-15', rows: [{ batchId: a.batchId, qtyMilli: 20_000 }] });
    expect(draft).toMatchObject({ status: 'draft', reason: 'expired', lines: [{ qtyMilli: -20_000, batchId: a.batchId }] });
    const posted = await ok('POST', `/api/adjustments/${draft.id}/post`);
    expect(posted.status).toBe('posted');
    expect(await byNumber()).toEqual({ 'B-2706': 30_000 });
    invariant();
    expect((await call('POST', `/api/adjustments/${draft.id}/cancel`, { date: '2027-02-16' })).statusCode).toBe(200);
    expect(await byNumber()).toEqual({ 'A-2701': 20_000, 'B-2706': 30_000 });
    invariant();
  });

  it('a transfer moves the same batches to the other warehouse, and cancelling brings them back', async () => {
    await buyTwo();
    const doc = await ok('POST', '/api/stock-docs', { kind: 'transfer', date: '2026-10-03', warehouseId: mainId, toWarehouseId: otherId, lines: [{ itemId: medId, qtyMilli: 25_000 }] });
    expect((await call('POST', `/api/stock-docs/${doc.id}/post`)).statusCode).toBe(200);
    expect(await byNumber(otherId)).toEqual({ 'A-2701': 20_000, 'B-2706': 5_000 });
    expect(await byNumber(mainId)).toEqual({ 'B-2706': 25_000 });
    invariant();
    expect((await call('POST', `/api/stock-docs/${doc.id}/cancel`, { date: '2026-10-04' })).statusCode).toBe(200);
    expect(await byNumber(otherId)).toEqual({});
    invariant();
  });

  it('a sale return goes back into the batches the sale took; a purchase return leaves from the purchase\'s batch', async () => {
    const purchase = await buyTwo();
    const sale = (await postNew(invoice('sale', '2026-10-05', [{ itemId: medId, qtyMilli: 25_000, unitPrice: 250 }]))).json();
    // the sale took 20 of A and 5 of B: a return of 8 gives back the 5 of B first, then 3 of A
    const ret = await ok('POST', `/api/invoices/${sale.id}/returns`, { date: '2026-10-06', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 8_000 }] });
    expect(await byNumber()).toEqual({ 'A-2701': 3_000, 'B-2706': 30_000 });
    // a second return continues where the first stopped
    await ok('POST', `/api/invoices/${sale.id}/returns`, { date: '2026-10-06', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 4_000 }] });
    expect(await byNumber()).toEqual({ 'A-2701': 7_000, 'B-2706': 30_000 });
    invariant();
    expect((await call('POST', `/api/invoices/${ret.id}/cancel`, { date: '2026-10-07' })).statusCode).toBe(200);
    invariant();

    // the purchase's line 2 brought batch A: 4 of it go back to the supplier
    const back = await ok('POST', `/api/invoices/${purchase.id}/returns`, { date: '2026-10-07', payment: 'credit', lines: [{ lineNo: 2, qtyMilli: 4_000 }] });
    expect(back.kind).toBe('purchase_return');
    expect(await byNumber()).toEqual({ 'B-2706': 25_000 });
    // nothing of A is left: more of it can't go back
    const more = await call('POST', `/api/invoices/${purchase.id}/returns`, { date: '2026-10-07', payment: 'credit', lines: [{ lineNo: 2, qtyMilli: 1_000 }] });
    expect(more.statusCode).toBe(400);
    expect(more.json().details[0]).toMatchObject({ code: 'batch_insufficient', batch: 'A-2701' });
    invariant();
  });

  it('a purchase whose batch was sold cannot be cancelled', async () => {
    const purchase = await buyTwo();
    await postNew(invoice('sale', '2026-10-05', [{ itemId: medId, qtyMilli: 20_000, unitPrice: 250 }]));
    const second = (await postNew(invoice('purchase', '2026-10-06', [{ itemId: medId, qtyMilli: 20_000, unitPrice: 200, batchNo: 'C-2712', expiry: '2027-12-31' }]))).json();
    expect(await byNumber()).toEqual({ 'B-2706': 30_000, 'C-2712': 20_000 });
    const refused = await call('POST', `/api/invoices/${purchase.id}/cancel`, { date: '2026-10-07' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().details[0]).toMatchObject({ code: 'batch_insufficient', batch: 'A-2701' });
    expect((await call('POST', `/api/invoices/${second.id}/cancel`, { date: '2026-10-07' })).statusCode).toBe(200);
    invariant();
  });

  it('switching tracking on for an item with stock puts it in the batch with no number', async () => {
    const plain = (await ok('POST', '/api/items', { code: 'ORS', name: { ar: 'محلول', en: 'ORS', ku: 'گیراوە' }, unit: 'sachet', salePrice: 500, saleCurrency: 'IQD' })).id;
    await postNew({ ...invoice('purchase', '2026-10-01', [{ itemId: plain, qtyMilli: 12_000, unitPrice: 300 }]) });
    const item = (await call('GET', `/api/items/${plain}`)).json();
    expect(item.trackBatches).toBe(false);
    const on = await ok('PUT', `/api/items/${plain}`, { code: 'ORS', name: item.name, unit: 'sachet', salePrice: 500, saleCurrency: 'IQD', trackBatches: true });
    expect(on.trackBatches).toBe(true);
    const rows = (await call('GET', `/api/batches?itemId=${plain}`)).json();
    expect(rows).toEqual([expect.objectContaining({ batch: '', expiry: null, qtyMilli: 12_000 })]);
    expect(batchBalance(db, plain, mainId)).toEqual({ batches: 12_000, stock: 12_000 });
  });

  it('a count shortage comes out earliest expiry first; a surplus goes into the batch with no number, with its expiry date', async () => {
    await buyTwo();
    const short = await ok('POST', '/api/adjustments', { date: '2026-10-08', warehouseId: mainId, reason: 'count', lines: [{ itemId: medId, qtyMilli: -5_000 }] });
    await ok('POST', `/api/adjustments/${short.id}/post`);
    expect(await byNumber()).toEqual({ 'A-2701': 15_000, 'B-2706': 30_000 });
    // an item with expiry dates: a surplus without its date is refused, numbered or not
    const undated = await ok('POST', '/api/adjustments', { date: '2026-10-08', warehouseId: mainId, reason: 'count', lines: [{ itemId: medId, qtyMilli: 2_000 }] });
    const refused = await call('POST', `/api/adjustments/${undated.id}/post`);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().details).toEqual([{ code: 'expiry_required', line: 1 }]);
    const surplus = await ok('POST', '/api/adjustments', { date: '2026-10-08', warehouseId: mainId, reason: 'count', lines: [{ itemId: medId, qtyMilli: 2_000, unitCost: 100, expiry: '2026-11-30' }] });
    await ok('POST', `/api/adjustments/${surplus.id}/post`);
    expect((await batches()).map((b) => [b.batch, b.expiry, b.qtyMilli])).toEqual([['', '2026-11-30', 2_000], ['A-2701', '2027-01-31', 15_000], ['B-2706', '2027-06-30', 30_000]]);
    // so it is flagged, and sold first
    expect((await call('GET', '/api/batches/report?state=near&date=2026-11-01')).json().rows.map((r: { batch: string }) => r.batch)).toEqual(['']);
    invariant();
  });

  it('stock with no batch number keeps the expiry date it came in with: one batch per date', async () => {
    expect((await postNew(invoice('purchase', '2026-10-01', [{ itemId: medId, qtyMilli: 5_000, unitPrice: 200, expiry: '2026-12-31' }]))).statusCode).toBe(200);
    expect((await postNew(invoice('purchase', '2026-10-02', [{ itemId: medId, qtyMilli: 20_000, unitPrice: 200, expiry: '2028-06-30' }]))).statusCode).toBe(200);
    expect((await postNew(invoice('purchase', '2026-10-03', [{ itemId: medId, qtyMilli: 1_000, unitPrice: 200, expiry: '2026-12-31' }]))).statusCode).toBe(200);
    expect((await batches()).map((b) => [b.batch, b.expiry, b.qtyMilli])).toEqual([['', '2026-12-31', 6_000], ['', '2028-06-30', 20_000]]);
    // after the first date the later stock still sells; the expired stock is blocked, never sold as 2028
    const sale = await postNew(invoice('sale', '2027-01-15', [{ itemId: medId, qtyMilli: 10_000, unitPrice: 250 }]));
    expect(sale.statusCode, sale.body).toBe(200);
    expect((await batches()).map((b) => [b.expiry, b.qtyMilli])).toEqual([['2026-12-31', 6_000], ['2028-06-30', 10_000]]);
    const tooMuch = await postNew(invoice('sale', '2027-01-15', [{ itemId: medId, qtyMilli: 12_000, unitPrice: 250 }]));
    expect(tooMuch.json()).toMatchObject({ error: 'validation', details: [{ code: 'batch_expired', available: 10_000 }] });
    // one batch per date for stock with no number: moving one onto the other's date is refused
    const [early, late] = await batches();
    expect((await call('PUT', `/api/batches/${late!.batchId}`, { expiry: early!.expiry })).statusCode).toBe(409);
    invariant();
  });

  it('cancelling documents posted before tracking was switched on keeps the batches equal to the stock', async () => {
    const plain = (await ok('POST', '/api/items', { code: 'ORS', name: { ar: 'محلول', en: 'ORS', ku: 'گیراوە' }, unit: 'sachet', salePrice: 500, saleCurrency: 'IQD' })).id;
    const p1 = (await postNew(invoice('purchase', '2026-10-01', [{ itemId: plain, qtyMilli: 10_000, unitPrice: 300 }]))).json();
    await postNew(invoice('purchase', '2026-10-01', [{ itemId: plain, qtyMilli: 10_000, unitPrice: 300 }]));
    const s = (await postNew(invoice('sale', '2026-10-02', [{ itemId: plain, qtyMilli: 4_000, unitPrice: 500 }]))).json();
    const adj = await ok('POST', '/api/adjustments', { date: '2026-10-02', warehouseId: mainId, reason: 'count', lines: [{ itemId: plain, qtyMilli: 1_000, unitCost: 300 }] });
    await ok('POST', `/api/adjustments/${adj.id}/post`);
    const doc = await ok('POST', '/api/stock-docs', { kind: 'transfer', date: '2026-10-02', warehouseId: mainId, toWarehouseId: otherId, lines: [{ itemId: plain, qtyMilli: 2_000 }] });
    await ok('POST', `/api/stock-docs/${doc.id}/post`);
    const item = (await call('GET', `/api/items/${plain}`)).json();
    await ok('PUT', `/api/items/${plain}`, { code: item.code, name: item.name, unit: item.unit, salePrice: 500, saleCurrency: 'IQD', trackBatches: true });
    // a numbered batch bought after tracking began
    expect((await postNew(invoice('purchase', '2026-10-03', [{ itemId: plain, qtyMilli: 5_000, unitPrice: 300, batchNo: 'N1', expiry: '2027-03-31' }]))).statusCode).toBe(200);
    const balanced = () => { for (const w of [mainId, otherId]) { const b = batchBalance(db, plain, w); expect(b.batches, w).toBe(b.stock); } };
    const numbers = async () => Object.fromEntries(((await call('GET', `/api/batches?itemId=${plain}&warehouseId=${mainId}`)).json() as { batch: string; qtyMilli: number }[]).map((b) => [b.batch, b.qtyMilli]));
    // a purchase from before: its goods leave the batch with no number; the numbered batch keeps its stock
    expect((await call('POST', `/api/invoices/${p1.id}/cancel`, { date: '2026-10-04' })).statusCode).toBe(200);
    balanced();
    expect(await numbers()).toEqual({ '': 5_000, N1: 5_000 });
    // a sale from before: its goods come back into the batch with no number
    expect((await call('POST', `/api/invoices/${s.id}/cancel`, { date: '2026-10-04' })).statusCode).toBe(200);
    balanced();
    expect(await numbers()).toEqual({ '': 9_000, N1: 5_000 });
    expect((await call('POST', `/api/adjustments/${adj.id}/cancel`, { date: '2026-10-04' })).statusCode).toBe(200);
    balanced();
    expect((await call('POST', `/api/stock-docs/${doc.id}/cancel`, { date: '2026-10-04' })).statusCode).toBe(200);
    balanced();
    expect(await numbers()).toEqual({ '': 10_000, N1: 5_000 });
    // and all of it can be sold
    const all = await postNew(invoice('sale', '2026-10-05', [{ itemId: plain, qtyMilli: 15_000, unitPrice: 500 }]));
    expect(all.statusCode, all.body).toBe(200);
    balanced();
  });

  it('a purchase return of goods bought before tracking leaves the batch with no number, not a newer numbered one', async () => {
    const plain = (await ok('POST', '/api/items', { code: 'ORS', name: { ar: 'محلول', en: 'ORS', ku: 'گیراوە' }, unit: 'sachet', salePrice: 500, saleCurrency: 'IQD' })).id;
    const old = (await postNew(invoice('purchase', '2026-10-01', [{ itemId: plain, qtyMilli: 10_000, unitPrice: 300 }]))).json();
    const item = (await call('GET', `/api/items/${plain}`)).json();
    await ok('PUT', `/api/items/${plain}`, { code: item.code, name: item.name, unit: item.unit, salePrice: 500, saleCurrency: 'IQD', trackBatches: true });
    expect((await postNew(invoice('purchase', '2026-10-02', [{ itemId: plain, qtyMilli: 5_000, unitPrice: 300, batchNo: 'N1', expiry: '2027-03-31' }]))).statusCode).toBe(200);
    await ok('POST', `/api/invoices/${old.id}/returns`, { date: '2026-10-03', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 5_000 }] });
    const rows = (await call('GET', `/api/batches?itemId=${plain}&warehouseId=${mainId}`)).json() as { batch: string; expiry: string | null; qtyMilli: number }[];
    expect(Object.fromEntries(rows.map((b) => [b.batch, [b.qtyMilli, b.expiry]]))).toEqual({ '': [5_000, null], N1: [5_000, '2027-03-31'] });
  });

  it('reports expired and near batches with their value, for a branch user only their warehouses, and the brief warns', async () => {
    await buyTwo();
    const doc = await ok('POST', '/api/stock-docs', { kind: 'transfer', date: '2026-10-03', warehouseId: mainId, toWarehouseId: otherId, lines: [{ itemId: medId, qtyMilli: 10_000 }] });
    await ok('POST', `/api/stock-docs/${doc.id}/post`);
    const report = (await call('GET', '/api/batches/report?state=near&date=2026-12-15')).json();
    const rows = report.rows as { batch: string; warehouseCode: string; qtyMilli: number; value: number; daysLeft: number; state: string }[];
    expect(rows.map((r) => [r.batch, r.warehouseCode, r.qtyMilli, r.value, r.daysLeft, r.state]).sort((a, b) => String(a[1]).localeCompare(String(b[1]))))
      .toEqual([['A-2701', 'ERBIL', 10_000, 2_000, 47, 'near'], ['A-2701', 'MAIN', 10_000, 2_000, 47, 'near']]);
    const expired = (await call('GET', '/api/batches/report?state=expired&date=2027-02-15')).json();
    expect(expired.rows).toHaveLength(2);

    const brief = dailyBrief(db, '2027-02-15');
    expect(brief.expiry).toMatchObject({ expired: 2, near: 0, days: 90 });
    expect(dailyBrief(db, '2027-02-15', { warehouses: [otherId], accounts: [] }).expiry).toMatchObject({ expired: 1 });

    // a user limited to the Erbil branch gets the Erbil batches only (the route passes their warehouses)
    expect(batchReport(db, { state: 'all' }, [otherId], '2026-12-15').map((r) => r.warehouseCode)).toEqual(['ERBIL']);
    expect(batchReport(db, { state: 'all' }, [], '2026-12-15')).toEqual([]);
  });

  it('fixes a batch\'s number or date until something has left it', async () => {
    await buyTwo();
    const a = (await batches()).find((x) => x.batch === 'A-2701')!;
    const fixed = await call('PUT', `/api/batches/${a.batchId}`, { number: 'A-2701X', expiry: '2027-01-30' });
    expect(fixed.statusCode, fixed.body).toBe(200);
    await postNew(invoice('sale', '2026-10-05', [{ itemId: medId, qtyMilli: 1_000, unitPrice: 250 }]));
    expect((await call('PUT', `/api/batches/${a.batchId}`, { number: 'Z' })).json().error).toBe('batch_in_use');
  });

  it('refuses a batch number longer than 40 instead of cutting it short (two lots never merge)', async () => {
    const stem = 'L'.repeat(40);
    // two lots that differ only after the 40th character: refused on the lines, nothing kept
    const r = await call('POST', '/api/invoices', invoice('purchase', '2026-10-01', [
      { itemId: medId, qtyMilli: 1_000, unitPrice: 200, batchNo: stem + '1', expiry: '2027-06-30' },
      { itemId: medId, qtyMilli: 1_000, unitPrice: 200, batchNo: stem + '2', expiry: '2027-06-30' }
    ]));
    expect(r.statusCode, r.body).toBe(400);
    expect(r.json().details).toEqual([{ code: 'batch_no_invalid', line: 1 }, { code: 'batch_no_invalid', line: 2 }]);
    // spaces collapse first: 40 kept characters typed with extra spaces are fine
    const spaced = await postNew(invoice('purchase', '2026-10-01', [{ itemId: medId, qtyMilli: 1_000, unitPrice: 200, batchNo: `  ${'M'.repeat(20)}    ${'N'.repeat(19)}  `, expiry: '2027-06-30' }]));
    expect(spaced.statusCode, spaced.body).toBe(200);
    // the same on a stock count adjustment and a batch fixed by hand
    const adj = await call('POST', '/api/adjustments', { date: '2026-10-02', warehouseId: mainId, reason: 'count', lines: [{ itemId: medId, qtyMilli: 1_000, unitCost: 200, batchNo: stem + 'X', expiry: '2027-06-30' }] });
    expect(adj.json().details, adj.body).toEqual([{ code: 'batch_no_invalid', line: 1 }]);
    const b = (await batches())[0]!;
    expect(() => updateBatch(db, b.batchId, { number: stem + 'Y' }, 'Raz')).toThrow(expect.objectContaining({ code: 'validation', details: [{ code: 'batch_no_invalid', field: 'number' }] }));
    expect((await batches()).map((x) => x.batch)).toEqual([`${'M'.repeat(20)} ${'N'.repeat(19)}`]);
  });

  it('makes an expired batch sellable again (a later date, or none) only for an approver', async () => {
    await buyTwo();
    const a = (await batches()).find((x) => x.batch === 'A-2701')!;
    expect(a.expiry).toBe('2027-01-31');
    // a storekeeper alone: refused, the date stays
    for (const expiry of ['2027-12-31', null]) {
      expect(() => updateBatch(db, a.batchId, { expiry }, 'Raz', null, ['stock'])).toThrow(expect.objectContaining({ code: 'forbidden', details: { need: 'entries.approve' } }));
    }
    expect((await batches()).find((x) => x.batch === 'A-2701')!.expiry).toBe('2027-01-31');
    // an earlier date, or the number only, is still theirs to fix
    expect(updateBatch(db, a.batchId, { expiry: '2027-01-30' }, 'Raz', null, ['stock']).expiry).toBe('2027-01-30');
    expect(updateBatch(db, a.batchId, { number: 'A-2701X' }, 'Raz', null, ['stock']).number).toBe('A-2701X');
    // a batch not yet expired can be moved as before; an approver may revive an expired one
    const b = (await batches()).find((x) => x.batch === 'B-2706')!;
    expect(updateBatch(db, b.batchId, { expiry: '2027-07-31' }, 'Raz', null, ['stock']).expiry).toBe('2027-07-31');
    expect(updateBatch(db, a.batchId, { expiry: '2027-12-31' }, 'Las', null, ['stock', 'entries.approve']).expiry).toBe('2027-12-31');
  });

  it('sells through the POS with a batch pinned, earliest expiry first otherwise', async () => {
    // a till sale is dated today: a day before batch A expires
    vi.setSystemTime(new Date('2026-11-15T09:00:00Z'));
    await buyTwo();
    const shift = await ok('POST', '/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId: mainId, openingCash: 0 });
    const sold = await call('POST', `/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: medId, qtyMilli: 3_000, unitPrice: 250 }] });
    expect(sold.statusCode, sold.body).toBe(201);
    expect(await byNumber()).toEqual({ 'A-2701': 17_000, 'B-2706': 30_000 });
    invariant();
  });

  it('writes its SQL so that it means the same on a MariaDB/MySQL server', () => {
    const source = readFileSync(join(import.meta.dirname, 'batches.ts'), 'utf8');
    const statements = [...source.matchAll(/\.(?:prepare|exec)\(\s*(['"`])([\s\S]*?)\1/g)].map((m) => m[2]!);
    expect(statements.length).toBeGreaterThan(10);
    for (const sql of statements) {
      expect(sql).not.toMatch(/ON\s+CONFLICT/i);
      expect(sql).not.toMatch(/\b(MAX|MIN)\s*\([^()]*,[^()]*\)/i);
    }
  });
});
