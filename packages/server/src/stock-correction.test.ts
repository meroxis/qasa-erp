import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';

// 1.4.2: an item added from inside an item picker (one name, a barcode, a unit and its prices), and an item's stock
// corrected from its own page through the documents the app already has (adjustments.ts, stock-docs.ts, invoices.ts).

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let stockAccount: string;
let supplierId: string;
let pipeId: string;

type Headers = Record<string, string>;
const owner: Headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const withKey = (key: string, h: Headers = owner): Headers => ({ ...h, 'x-qasa-idempotency': key });
const post = (url: string, body: unknown = {}, h: Headers = owner) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const put = (url: string, body: unknown = {}, h: Headers = owner) => app.inject({ method: 'PUT', url, payload: body as object, headers: h });
const get = (url: string, h: Headers = owner) => app.inject({ method: 'GET', url, headers: h });
const today = todayIso();
const one = (text: string) => ({ ar: text, en: text, ku: text });

async function made(res: Promise<{ statusCode: number; body: string; json(): any }>, status = 201): Promise<any> {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r.json();
}

beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  stockAccount = (db.prepare('SELECT account_code FROM warehouses WHERE id = ?').get(warehouseId) as { account_code: string }).account_code;
  supplierId = (await made(post('/api/parties', { type: 'supplier', name: 'Las' }))).id;
  pipeId = (await made(post('/api/items', { code: 'PIPE-1', name: one('Steel pipe'), unit: 'piece', salePrice: 30_000, saleCurrency: 'IQD', purchasePrice: 22_000 }))).id;
  // 10 pipes at 20,000 and 10 at 26,000: 20 on hand, worth 460,000 (an average of 23,000)
  for (const price of [20_000, 26_000]) {
    const draft = await made(post('/api/invoices', {
      kind: 'purchase', date: today, partyId: supplierId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
      lines: [{ itemId: pipeId, qtyMilli: 10_000, unitPrice: price }]
    }));
    await made(post(`/api/invoices/${draft.id}/post`), 200);
  }
});

afterEach(async () => {
  await app.close();
  db.close();
});

/** Everyone signs in: the owner (admin), a storekeeper, a cashier, a buyer and an approver. */
async function signedIn() {
  await made(post('/api/plan/trial'), 200);
  const first = (await get('/api/users')).json()[0] as { id: string; username: string };
  await made(post(`/api/users/${first.id}/password`, { password: 'admin-pass-123' }), 200);
  for (const [username, name, roles] of [['las', 'Las', ['storekeeper']], ['raz', 'Raz', ['sales']], ['las2', 'Las', ['purchasing']], ['mer2', 'Mer', ['approver', 'storekeeper']]] as const) {
    await made(post('/api/users', { username, name, password: `${username}-pass-123`, roles }));
  }
  await made(put('/api/auth/signin', { on: true }), 200);
  const signIn = async (username: string, password: string): Promise<Headers> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, headers: { 'x-qasa-client': '1' } });
    expect(res.statusCode, res.body).toBe(200);
    return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
  };
  return {
    admin: await signIn(first.username, 'admin-pass-123'),
    keeper: await signIn('las', 'las-pass-123'),
    cashier: await signIn('raz', 'raz-pass-123'),
    buyer: await signIn('las2', 'las2-pass-123'),
    approver: await signIn('mer2', 'mer2-pass-123')
  };
}

const correct = (body: object, h: Headers = owner) => post(`/api/items/${pipeId}/stock-correction`, { warehouseId, ...body }, h);

async function stock(h: Headers = owner) {
  const s = (await get(`/api/items/${pipeId}`, h)).json().stock.find((x: { warehouseId: string }) => x.warehouseId === warehouseId) as { qtyMilli: number; value: number };
  return { qty: s.qtyMilli / 1000, value: s.value };
}

async function entryOf(id: string) {
  return (await get(`/api/entries/${id}`)).json() as { status: string; lines: { accountCode: string; debit: number; credit: number }[] };
}

const accountsOf = (lines: { accountCode: string; debit: number; credit: number }[]) => lines.map((l) => [l.accountCode, l.debit, l.credit]);

describe('an item added from an item picker', () => {
  const quick = { name: one('Mango juice 1 L'), barcode: '6260000000123', unit: 'piece', salePrice: 1_750, saleCurrency: 'IQD', purchasePrice: 1_250, purchaseCurrency: 'IQD' };

  it('is made once for a key sent twice, and the second answer is the first item', async () => {
    const key = randomUUID();
    const first = await post('/api/items', quick, withKey(key));
    expect(first.statusCode, first.body).toBe(201);
    const again = await post('/api/items', quick, withKey(key));
    expect(again.statusCode).toBe(201);
    expect(again.headers['x-qasa-idempotent-replay']).toBe('1');
    expect(again.json().id).toBe(first.json().id);
    expect((db.prepare("SELECT COUNT(*) AS n FROM items WHERE barcode = '6260000000123'").get() as { n: number }).n).toBe(1);
    // its one name is kept for every language, with its prices and the unit
    expect(first.json()).toMatchObject({ name: one('Mango juice 1 L'), unit: 'piece', salePrice: 1_750, purchasePrice: 1_250, trackStock: true });
    // the same key with another item is refused, and makes nothing
    const other = await post('/api/items', { ...quick, barcode: '6260000000999' }, withKey(key));
    expect(other.statusCode).toBe(409);
    expect(other.json().error).toBe('idempotency_key_reused');
  });

  it('is checked on the server: a name, a known unit, a free barcode; a weighed item in kilograms', async () => {
    expect((await post('/api/items', { ...quick, name: one('  ') })).json().details).toEqual([{ code: 'name_required' }]);
    expect((await post('/api/items', { ...quick, unit: 'parsec' })).statusCode).toBe(400);
    expect((await post('/api/items', { ...quick, salePrice: -5 })).statusCode).toBe(400);
    await made(post('/api/items', quick));
    const twice = await post('/api/items', { ...quick, name: one('Mango juice') });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error).toBe('barcode_exists');
    const kg = await made(post('/api/items', { name: one('Tomatoes'), unit: 'kg', salePrice: 1_000, saleCurrency: 'IQD' }));
    expect(kg).toMatchObject({ unit: 'kg', trackStock: true, qtyMilli: 0 });
  });

  it("keeps a barcode from clashing with a scale's labels: a weighed item's label is not another item's barcode, either way round", async () => {
    // cheese, weighed: barcode 2100017 (its scale prints 2100017 01250 3 for 1.250 kg)
    const cheese = await made(post('/api/items', { name: one('White cheese'), unit: 'kg', barcode: '2100017', salePrice: 9_000, saleCurrency: 'IQD' }));
    const label = await post('/api/items', { ...quick, barcode: '2100017012503' });
    expect(label.statusCode).toBe(409);
    expect(label.json().error).toBe('barcode_scale_label');
    // a 13-digit code that is not a label (a wrong check digit) is an ordinary barcode
    await made(post('/api/items', { ...quick, barcode: '2100017012504' }));
    // the other way: a full label is already an item's barcode, so a weighed item may not take its first seven digits
    await made(post('/api/items', { ...quick, name: one('Olives'), barcode: '2200031005007' }));
    const weighed = await post('/api/items', { name: one('Olives, weighed'), unit: 'kg', barcode: '2200031', salePrice: 7_000, saleCurrency: 'IQD' });
    expect(weighed.statusCode).toBe(409);
    expect(weighed.json().error).toBe('barcode_scale_label');
    // a piece item may still have those seven digits (it is never read from a label), and the cheese saves again as it is
    await made(post('/api/items', { name: one('Olive jar'), unit: 'piece', barcode: '2200031', salePrice: 3_000, saleCurrency: 'IQD' }));
    expect((await put(`/api/items/${cheese.id}`, { name: one('White cheese'), unit: 'kg', barcode: '2100017', salePrice: 9_500, saleCurrency: 'IQD' })).statusCode).toBe(200);
  });

  it("counts the barcodes of an item's other units too, both ways (the till finds a unit's barcode first)", async () => {
    const cheese = await made(post('/api/items', { name: one('White cheese'), unit: 'kg', barcode: '2100017', salePrice: 9_000, saleCurrency: 'IQD' }));
    // a carton whose barcode is the cheese's 1.250 kg label: refused on a new item and on an item saved again
    const carton = (barcode: string) => [{ unit: 'carton', factorMilli: 24_000, barcode }];
    const added = await post('/api/items', { ...quick, units: carton('2100017012503') });
    expect(added.statusCode).toBe(409);
    expect(added.json().error).toBe('barcode_scale_label');
    expect((await made(post('/api/items', { ...quick, units: carton('6260000000777') }))).id).toBeTruthy();
    const juice = (db.prepare("SELECT id FROM items WHERE barcode = '6260000000123'").get() as { id: string }).id;
    const changed = await put(`/api/items/${juice}`, { ...quick, units: carton('2100017012503') });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error).toBe('barcode_scale_label');
    // a weighed item's own label is not one of its units' barcodes either
    const own = await put(`/api/items/${cheese.id}`, { name: one('White cheese'), unit: 'kg', barcode: '2100017', salePrice: 9_000, saleCurrency: 'IQD', units: [{ unit: 'carton', factorMilli: 5_000, barcode: '2100017012503' }] });
    expect(own.statusCode).toBe(409);
    // the other way: a carton's barcode is a full label, so a weighed item may not take its first seven digits
    await made(post('/api/items', { ...quick, name: one('Dates'), barcode: '6260000000555', units: carton('2300045002006') }));
    const weighed = await post('/api/items', { name: one('Dates, weighed'), unit: 'kg', barcode: '2300045', salePrice: 6_000, saleCurrency: 'IQD' });
    expect(weighed.statusCode).toBe(409);
    expect(weighed.json().error).toBe('barcode_scale_label');
    // the juice saves again with the carton it has
    expect((await put(`/api/items/${juice}`, { ...quick, salePrice: 1_800, units: carton('6260000000777') })).statusCode).toBe(200);
  });

  it('needs the stock permission, as on the Items page: a cashier or a buyer alone may not add one', async () => {
    const u = await signedIn();
    expect((await post('/api/items', quick, u.cashier)).statusCode).toBe(403);
    expect((await post('/api/items', quick, u.buyer)).statusCode).toBe(403);
    const byKeeper = await made(post('/api/items', quick, withKey(randomUUID(), u.keeper)));
    expect(byKeeper.purchasePrice).toBe(1_250);
  });
});

describe("an item's stock corrected from its page", () => {
  it('found in a count: the surplus comes in at the average cost, Dr the warehouse / Cr the gain account, and shows in the moves', async () => {
    const r = await made(correct({ mode: 'set', qtyMilli: 25_000, reason: 'found' }), 200);
    expect(r).toMatchObject({ posted: true, diffMilli: 5_000, document: { type: 'adjustment', status: 'posted' } });
    expect(r.document.number).toMatch(/^ADJ-/);
    expect(await stock()).toEqual({ qty: 25, value: 575_000 });
    const adj = (await get(`/api/adjustments/${r.document.id}`)).json();
    expect(adj).toMatchObject({ reason: 'count', valueIn: 115_000, valueOut: 0 });
    expect(accountsOf((await entryOf(adj.entry.id)).lines)).toEqual([[stockAccount, 115_000, 0], ['49', 0, 115_000]]);
    // the item's page shows it at once: the new quantity, and the move with the adjustment's number
    expect(r.item.qtyMilli).toBe(25_000);
    expect(r.item.moves.at(-1)).toMatchObject({ sourceType: 'adjustment', sourceNumber: r.document.number, qtyMilli: 5_000, balanceQtyMilli: 25_000 });
  });

  it('a count that finds fewer takes the shortage out at the average cost into the count-shortage account', async () => {
    const r = await made(correct({ mode: 'set', qtyMilli: 18_000, reason: 'found' }), 200);
    expect(r.diffMilli).toBe(-2_000);
    expect(await stock()).toEqual({ qty: 18, value: 414_000 });
    const adj = (await get(`/api/adjustments/${r.document.id}`)).json();
    expect(accountsOf((await entryOf(adj.entry.id)).lines)).toEqual([['39', 46_000, 0], [stockAccount, 0, 46_000]]);
  });

  it('damaged and lost only take out, at the average cost into losses', async () => {
    const r = await made(correct({ mode: 'change', qtyMilli: -3_000, reason: 'damaged', note: 'Broken in the yard' }), 200);
    const adj = (await get(`/api/adjustments/${r.document.id}`)).json();
    expect(adj).toMatchObject({ reason: 'damaged', valueOut: 69_000, notes: 'Broken in the yard' });
    expect(accountsOf((await entryOf(adj.entry.id)).lines)).toEqual([['39', 69_000, 0], [stockAccount, 0, 69_000]]);
    const up = await correct({ mode: 'change', qtyMilli: 1_000, reason: 'lost' });
    expect(up.statusCode).toBe(400);
    expect(up.json().details).toEqual([{ code: 'correction_out_only', field: 'reason' }]);
  });

  it('a purchase not entered is never income: it is on credit from a supplier or paid from a safe, one of the two', async () => {
    const cash = (await get('/api/settings')).json().postingAccounts.cash as string;
    for (const how of [{}, { supplierId, cashAccountCode: cash }]) {
      const r = await correct({ mode: 'change', qtyMilli: 10_000, reason: 'purchase_missing', unitCost: 30_000, ...how });
      expect(r.statusCode).toBe(400);
      expect(r.json().details).toEqual([{ code: 'purchase_how_required', field: 'supplierId' }]);
    }
    // a safe is only for a purchase
    expect((await correct({ mode: 'change', qtyMilli: 1_000, reason: 'found', cashAccountCode: cash })).json().details)
      .toEqual([{ code: 'cash_account_invalid', field: 'cashAccountCode' }]);
    // its cost is asked: no average to fall back on for a purchase
    expect((await correct({ mode: 'change', qtyMilli: 1_000, reason: 'purchase_missing', supplierId })).json().details).toEqual([{ code: 'line_price_invalid', field: 'unitCost' }]);
    expect((await get('/api/adjustments')).json()).toEqual([]);
    expect((await get('/api/invoices?kind=purchase')).json()).toHaveLength(2);
    expect(await stock()).toEqual({ qty: 20, value: 460_000 });
  });

  it('a purchase not entered, paid in cash: a posted cash purchase invoice, Dr the warehouse / Cr the safe, and the average cost follows', async () => {
    const cash = (await get('/api/settings')).json().postingAccounts.cash as string;
    const r = await made(correct({ mode: 'change', qtyMilli: 10_000, reason: 'purchase_missing', unitCost: 30_000, cashAccountCode: cash, note: 'From the wholesale market' }), 200);
    expect(r.document).toMatchObject({ type: 'invoice', status: 'posted' });
    // 20 worth 460,000 and 10 at 30,000: 30 worth 760,000, an average of 25,333
    expect(await stock()).toEqual({ qty: 30, value: 760_000 });
    const inv = (await get(`/api/invoices/${r.document.id}`)).json();
    expect(inv).toMatchObject({ kind: 'purchase', payment: 'cash', cashAccountCode: cash, total: 300_000, notes: 'From the wholesale market' });
    const lines = accountsOf((await entryOf(inv.entryId)).lines);
    expect(lines).toEqual(expect.arrayContaining([[stockAccount, 300_000, 0], [cash, 0, 300_000]]));
    // nothing is booked as income
    expect(lines.some(([code]) => String(code).startsWith('4'))).toBe(false);
  });

  it('a purchase not entered, with its supplier: a posted purchase invoice on the supplier account instead', async () => {
    const before = (await get(`/api/parties/${supplierId}`)).json().balance as number;
    const r = await made(correct({ mode: 'set', qtyMilli: 24_000, reason: 'purchase_missing', unitCost: 25_000, supplierId }), 200);
    expect(r.document).toMatchObject({ type: 'invoice', status: 'posted' });
    expect(await stock()).toEqual({ qty: 24, value: 560_000 });
    const inv = (await get(`/api/invoices/${r.document.id}`)).json();
    expect(inv).toMatchObject({ kind: 'purchase', payment: 'credit', partyId: supplierId, total: 100_000 });
    expect((await get(`/api/parties/${supplierId}`)).json().balance).toBe(before + 100_000);
  });

  it('opening stock: an opening stock document, Dr the warehouse / Cr capital', async () => {
    const tomato = await made(post('/api/items', { name: one('Tomatoes'), unit: 'kg', salePrice: 1_000, saleCurrency: 'IQD' }));
    const r = await made(post(`/api/items/${tomato.id}/stock-correction`, { warehouseId, mode: 'set', qtyMilli: 12_500, reason: 'opening', unitCost: 700 }), 200);
    expect(r.document).toMatchObject({ type: 'stock_doc', status: 'posted' });
    expect(r.item.qtyMilli).toBe(12_500);
    const doc = (await get(`/api/stock-docs/${r.document.id}`)).json();
    expect(doc).toMatchObject({ kind: 'opening', counterAccountCode: '21', totalValue: 8_750 });
    expect(accountsOf((await entryOf(doc.entryId)).lines)).toEqual([[stockAccount, 8_750, 0], ['21', 0, 8_750]]);
    expect((await post(`/api/items/${tomato.id}/stock-correction`, { warehouseId, mode: 'change', qtyMilli: -1_000, reason: 'opening', unitCost: 1 })).json().details)
      .toEqual([{ code: 'correction_in_only', field: 'reason' }]);
  });

  it('other needs a note; nothing to change, or more than there is, is refused and leaves no document behind', async () => {
    expect((await correct({ mode: 'change', qtyMilli: 1_000, reason: 'other' })).json().details).toEqual([{ code: 'note_required', field: 'note' }]);
    expect((await correct({ mode: 'set', qtyMilli: 20_000, reason: 'found' })).json().details).toEqual([{ code: 'correction_no_change' }]);
    const short = await correct({ mode: 'change', qtyMilli: -50_000, reason: 'lost' });
    expect(short.statusCode).toBe(400);
    expect(short.json().details[0]).toMatchObject({ code: 'stock_insufficient' });
    expect((await get('/api/adjustments')).json()).toEqual([]);
    expect(await stock()).toEqual({ qty: 20, value: 460_000 });
  });

  it('is made once for a key sent twice', async () => {
    const key = randomUUID();
    const body = { warehouseId, mode: 'change', qtyMilli: 2_000, reason: 'found' };
    const first = await made(post(`/api/items/${pipeId}/stock-correction`, body, withKey(key)), 200);
    const again = await post(`/api/items/${pipeId}/stock-correction`, body, withKey(key));
    expect(again.headers['x-qasa-idempotent-replay']).toBe('1');
    expect(again.json()).toMatchObject({ document: first.document, diffMilli: 2_000 });
    expect((await get('/api/adjustments')).json()).toHaveLength(1);
    expect(await stock()).toEqual({ qty: 22, value: 506_000 });
  });

  it('needs the stock permission, and purchases too for a purchase invoice', async () => {
    const u = await signedIn();
    expect((await correct({ mode: 'change', qtyMilli: 1_000, reason: 'found' }, u.cashier)).statusCode).toBe(403);
    expect((await correct({ mode: 'change', qtyMilli: 1_000, reason: 'found' }, u.buyer)).statusCode).toBe(403);
    const cash = (await get('/api/settings', u.admin)).json().postingAccounts.cash as string;
    // a purchase not entered is a purchase, on credit or in cash: someone who keeps the stock alone asks the buyer
    for (const how of [{ supplierId }, { cashAccountCode: cash }]) {
      const noPurchases = await correct({ mode: 'change', qtyMilli: 1_000, reason: 'purchase_missing', unitCost: 20_000, ...how }, u.keeper);
      expect(noPurchases.statusCode).toBe(403);
      expect(noPurchases.json().details).toEqual({ need: 'purchases' });
    }
    await made(correct({ mode: 'change', qtyMilli: 1_000, reason: 'found' }, u.keeper), 200);
    expect(await stock(u.admin)).toMatchObject({ qty: 21 });
  });

  it('with "Separate duties" on, waits as a draft for an approver who did not prepare it', async () => {
    const u = await signedIn();
    await made(put('/api/auth/separate-duties', { on: true }, u.admin), 200);
    const r = await made(correct({ mode: 'change', qtyMilli: -2_000, reason: 'damaged' }, u.keeper), 200);
    expect(r).toMatchObject({ posted: false, document: { type: 'adjustment', status: 'draft', number: null } });
    // nothing moved yet
    expect(r.item.qtyMilli).toBe(20_000);
    expect(await stock(u.admin)).toEqual({ qty: 20, value: 460_000 });
    // the one who prepared it may not post it; an approver does, on the Stock adjustments page
    expect((await post(`/api/adjustments/${r.document.id}/post`, {}, u.keeper)).statusCode).toBe(403);
    await made(post(`/api/adjustments/${r.document.id}/post`, {}, u.approver), 200);
    expect(await stock(u.admin)).toEqual({ qty: 18, value: 414_000 });
    // opening stock waits the same way
    const opening = await made(correct({ mode: 'change', qtyMilli: 1_000, reason: 'opening', unitCost: 20_000 }, u.keeper), 200);
    expect(opening).toMatchObject({ posted: false, document: { type: 'stock_doc', status: 'draft' } });
  });
});
