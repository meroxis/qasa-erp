import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let customerId: string;
let supplierId: string;
let medId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer') };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const put = (url: string, body: unknown = {}) => app.inject({ method: 'PUT', url, payload: body as object, headers });
const get = (url: string) => app.inject({ url, headers });

// a medicine kept in tablets: a strip holds 10, a box 10 strips (100 tablets)
const MED_UNITS = [
  { unit: 'strip', factorMilli: 10_000, barcode: '6260001000102', salePrice: 2_400 },
  { unit: 'box', factorMilli: 100_000, barcode: '6260001000201' }
];

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  customerId = (await post('/api/parties', { type: 'customer', name: 'Mer' })).json().id;
  supplierId = (await post('/api/parties', { type: 'supplier', name: 'Las' })).json().id;
  const med = await post('/api/items', {
    code: 'AMOX-500', barcode: '6260001000003', name: { ar: 'أموكسيسيلين 500', en: 'Amoxicillin 500', ku: 'ئەمۆکسیسیلین 500' }, unit: 'tablet',
    salePrice: 250, saleCurrency: 'IQD', units: MED_UNITS, saleUnit: 'strip', purchaseUnit: 'box'
  });
  expect(med.statusCode, med.body).toBe(201);
  medId = med.json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

const invoice = (kind: 'sale' | 'purchase', lines: object[], extra: object = {}) => ({
  kind, date: '2026-11-01', partyId: kind === 'sale' ? customerId : supplierId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
  lines, ...extra
});

async function postNew(body: object) {
  const draft = await post('/api/invoices', body);
  expect(draft.statusCode, draft.body).toBe(201);
  const posted = await post(`/api/invoices/${draft.json().id}/post`);
  expect(posted.statusCode, posted.body).toBe(200);
  return posted.json();
}

const stock = async () => {
  const item = (await get(`/api/items/${medId}`)).json();
  return { qty: item.qtyMilli, value: item.value };
};

describe('units with conversions on the server', () => {
  it('keeps an item\'s units, default sale and purchase units, and gives them back', async () => {
    const item = (await get(`/api/items/${medId}`)).json();
    expect(item.unit).toBe('tablet');
    expect(item.units).toEqual([
      { unit: 'strip', factorMilli: 10_000, barcode: '6260001000102', salePrice: 2_400 },
      { unit: 'box', factorMilli: 100_000, barcode: '6260001000201', salePrice: null }
    ]);
    expect(item.saleUnit).toBe('strip');
    expect(item.purchaseUnit).toBe('box');
    expect(item.updatedAt).toEqual(expect.any(String));
    // an update that does not send units keeps them
    const { units: _u, ...rest } = { ...item, name: { ...item.name, en: 'Amoxicillin 500 mg' } };
    const kept = await put(`/api/items/${medId}`, { code: rest.code, barcode: rest.barcode, name: rest.name, unit: 'tablet', salePrice: 250, saleCurrency: 'IQD' });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(kept.json().units).toHaveLength(2);
  });

  it('a purchase of 2 boxes puts 200 tablets in stock, valued at the line amount', async () => {
    const inv = await postNew(invoice('purchase', [{ itemId: medId, unit: 'box', unitQtyMilli: 2_000, unitPrice: 18_000 }]));
    expect(inv.lines[0]).toMatchObject({ qtyMilli: 200_000, lineUnit: 'box', unitFactorMilli: 100_000, unitQtyMilli: 2_000, unitPrice: 18_000, amount: 36_000 });
    expect(inv.total).toBe(36_000);
    expect(await stock()).toEqual({ qty: 200_000, value: 36_000 });
  });

  it('the count sheet lists the units of each item with their factors (the stock shows in boxes and strips; counts stay in tablets)', async () => {
    await postNew(invoice('purchase', [{ itemId: medId, unit: 'box', unitQtyMilli: 2_000, unitPrice: 18_000 }]));
    const sheet = (await get(`/api/adjustments/count-sheet?warehouseId=${warehouseId}`)).json();
    expect(sheet).toEqual([expect.objectContaining({ itemId: medId, unit: 'tablet', stockMilli: 200_000, units: [{ unit: 'strip', factorMilli: 10_000 }, { unit: 'box', factorMilli: 100_000 }] })]);
  });

  it('a sale of 3 strips and 5 tablets takes 35 tablets at average cost; a strip comes back; cancelling puts the rest back', async () => {
    await postNew(invoice('purchase', [{ itemId: medId, unit: 'box', unitQtyMilli: 2_000, unitPrice: 18_000 }]));
    const sale = await postNew(invoice('sale', [
      { itemId: medId, unit: 'strip', unitQtyMilli: 3_000, unitPrice: 2_400 },
      { itemId: medId, qtyMilli: 5_000, unitPrice: 250 }
    ]));
    expect(sale.lines.map((l: { qtyMilli: number; amount: number; cost: number }) => [l.qtyMilli, l.amount, l.cost])).toEqual([[30_000, 7_200, 5_400], [5_000, 1_250, 900]]);
    expect(await stock()).toEqual({ qty: 165_000, value: 29_700 });

    // returning 1 strip: the screen sends the base quantity (10 tablets); the line keeps its unit
    const ret = await post(`/api/invoices/${sale.id}/returns`, { date: '2026-11-02', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 10_000 }] });
    expect(ret.statusCode, ret.body).toBe(201);
    expect(ret.json().lines[0]).toMatchObject({ qtyMilli: 10_000, lineUnit: 'strip', unitQtyMilli: 1_000, unitFactorMilli: 10_000, amount: 2_400, cost: 1_800 });
    expect(await stock()).toEqual({ qty: 175_000, value: 31_500 });
    // half a strip is 5 tablets: kept in tablets, the price per tablet
    const half = await post(`/api/invoices/${sale.id}/returns`, { date: '2026-11-02', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 5_000 }] });
    expect(half.json().lines[0]).toMatchObject({ qtyMilli: 5_000, lineUnit: 'strip', unitQtyMilli: 500, amount: 1_200 });
    const odd = await post(`/api/invoices/${sale.id}/returns`, { date: '2026-11-02', payment: 'credit', lines: [{ lineNo: 1, qtyMilli: 3 }] });
    expect(odd.json().lines[0]).toMatchObject({ qtyMilli: 3, lineUnit: null, unitQtyMilli: null, unitPrice: 240 });
    for (const r of [ret.json(), half.json(), odd.json()]) expect((await post(`/api/invoices/${r.id}/cancel`, { date: '2026-11-03' })).statusCode).toBe(200);

    const cancelled = await post(`/api/invoices/${sale.id}/cancel`, { date: '2026-11-03' });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(await stock()).toEqual({ qty: 200_000, value: 36_000 });
  });

  it('refuses a quantity that is no whole thousandth of a tablet, and a unit the item does not have', async () => {
    // a gram of rice kept in kilograms is fine; a thousandth of a gram is not
    const rice = (await post('/api/items', { name: { ar: 'رز', en: 'Rice', ku: 'برنج' }, unit: 'kg', salePrice: 2_000, saleCurrency: 'IQD', units: [{ unit: 'g', factorMilli: 1 }] })).json();
    const gram = await post('/api/invoices', invoice('sale', [{ itemId: rice.id, unit: 'g', unitQtyMilli: 250_000, unitPrice: 2 }]));
    expect(gram.json().lines[0]).toMatchObject({ qtyMilli: 250, lineUnit: 'g', amount: 500 });
    const odd = await post('/api/invoices', invoice('sale', [{ itemId: rice.id, unit: 'g', unitQtyMilli: 1, unitPrice: 2 }]));
    expect(odd.statusCode).toBe(400);
    expect(odd.json().details).toEqual([{ code: 'unit_qty_fraction', line: 1 }]);
    const other = await post('/api/invoices', invoice('sale', [{ itemId: medId, unit: 'carton', unitQtyMilli: 1_000, unitPrice: 1 }]));
    expect(other.json().details).toEqual([{ code: 'unit_invalid', line: 1 }]);
    const unknown = await post('/api/invoices', invoice('sale', [{ itemId: medId, unit: 'barrel', unitQtyMilli: 1_000, unitPrice: 1 }]));
    expect(unknown.statusCode).toBe(400);
  });

  it('a POS sale by a unit barcode takes that unit', async () => {
    await postNew(invoice('purchase', [{ itemId: medId, unit: 'box', unitQtyMilli: 1_000, unitPrice: 18_000 }]));
    const scan = (await get('/api/items?barcode=6260001000102')).json();
    expect(scan.item.id).toBe(medId);
    expect(scan.unit).toBe('strip');
    const own = (await get('/api/items?barcode=6260001000003')).json();
    expect(own).toMatchObject({ item: { id: medId }, unit: null });
    expect((await get('/api/items?barcode=nothing')).json()).toEqual({ item: null, unit: null });
    // the item list finds it by a unit's barcode too
    expect((await get('/api/items?q=6260001000201')).json().map((i: { id: string }) => i.id)).toEqual([medId]);

    const shift = (await post('/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId, openingCash: 0 })).json();
    const sold = await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: medId, unit: scan.unit, unitQtyMilli: 2_000, unitPrice: 2_400 }] });
    expect(sold.statusCode, sold.body).toBe(201);
    expect(sold.json().invoice.lines[0]).toMatchObject({ qtyMilli: 20_000, lineUnit: 'strip', amount: 4_800 });
    expect(sold.json().invoice.total).toBe(4_800);
    expect((await stock()).qty).toBe(80_000);
  });

  it('a change of a unit\'s factor leaves posted lines as they were', async () => {
    const inv = await postNew(invoice('purchase', [{ itemId: medId, unit: 'box', unitQtyMilli: 1_000, unitPrice: 18_000 }]));
    const item = (await get(`/api/items/${medId}`)).json();
    const changed = await put(`/api/items/${medId}`, {
      code: item.code, barcode: item.barcode, name: item.name, unit: 'tablet', salePrice: 250, saleCurrency: 'IQD',
      units: [MED_UNITS[0], { ...MED_UNITS[1], factorMilli: 50_000 }]
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const again = (await get(`/api/invoices/${inv.id}`)).json();
    expect(again.lines[0]).toMatchObject({ qtyMilli: 100_000, unitFactorMilli: 100_000, unitQtyMilli: 1_000, amount: 18_000 });
    // cancelling still takes the 100 tablets it brought in
    expect((await post(`/api/invoices/${inv.id}/cancel`, { date: '2026-11-03' })).statusCode).toBe(200);
    expect((await stock()).qty).toBe(0);
  });

  it('refuses a barcode another item or another item\'s unit has', async () => {
    const other = { name: { ar: 'باراسيتامول', en: 'Paracetamol', ku: 'پاراسیتامۆڵ' }, unit: 'tablet', salePrice: 100, saleCurrency: 'IQD' };
    const unitTaken = await post('/api/items', { ...other, barcode: '6260001000102' });
    expect(unitTaken.statusCode).toBe(409);
    expect(unitTaken.json()).toMatchObject({ error: 'barcode_taken', details: { item: 'AMOX-500' } });
    const itemTaken = await post('/api/items', { ...other, units: [{ unit: 'box', factorMilli: 20_000, barcode: '6260001000003' }] });
    expect(itemTaken.json()).toMatchObject({ error: 'barcode_taken', details: { item: 'AMOX-500', unit: 'box' } });
    const twice = await post('/api/items', { ...other, units: [{ unit: 'box', factorMilli: 20_000, barcode: '6260001000201' }] });
    expect(twice.json().error).toBe('barcode_taken');
    const ownTwice = await post('/api/items', { ...other, barcode: '1', units: [{ unit: 'box', factorMilli: 20_000, barcode: '1' }] });
    expect(ownTwice.json().details).toEqual([{ code: 'unit_barcode_repeated', unit: 'box' }]);
    const asBase = await post('/api/items', { ...other, units: [{ unit: 'tablet', factorMilli: 1_000 }] });
    expect(asBase.json().details).toEqual([{ code: 'unit_is_base', unit: 'tablet' }]);
  });

  it('a draft that uses a unit stops the unit from being removed', async () => {
    const draft = await post('/api/invoices', invoice('sale', [{ itemId: medId, unit: 'box', unitQtyMilli: 1_000, unitPrice: 20_000 }]));
    const item = (await get(`/api/items/${medId}`)).json();
    const body = { code: item.code, barcode: item.barcode, name: item.name, unit: 'tablet', salePrice: 250, saleCurrency: 'IQD', saleUnit: 'strip', purchaseUnit: null, units: [MED_UNITS[0]] };
    const refused = await put(`/api/items/${medId}`, body);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'unit_in_use', details: { units: ['box'], drafts: [{ type: 'invoice', id: draft.json().id }] } });
    await app.inject({ method: 'DELETE', url: `/api/invoices/${draft.json().id}`, headers });
    expect((await put(`/api/items/${medId}`, body)).statusCode).toBe(200);
  });

  it('a draft that uses a unit stops its factor from changing (the draft would say another quantity when next saved)', async () => {
    const draft = (await post('/api/invoices', invoice('sale', [{ itemId: medId, unit: 'box', unitQtyMilli: 1_000, unitPrice: 20_000 }]))).json();
    expect(draft.lines[0]).toMatchObject({ qtyMilli: 100_000, unitFactorMilli: 100_000 });
    const item = (await get(`/api/items/${medId}`)).json();
    const body = (units: object[]) => ({ code: item.code, barcode: item.barcode, name: item.name, unit: 'tablet', salePrice: 250, saleCurrency: 'IQD', saleUnit: 'strip', purchaseUnit: 'box', units });
    const refused = await put(`/api/items/${medId}`, body([MED_UNITS[0]!, { ...MED_UNITS[1], factorMilli: 120_000 }]));
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'unit_factor_in_use', details: { units: ['box'], drafts: [{ type: 'invoice', id: draft.id, number: null, date: '2026-11-01' }] } });
    expect((await get(`/api/items/${medId}`)).json().units[1].factorMilli).toBe(100_000);
    // a unit no draft uses may still change
    expect((await put(`/api/items/${medId}`, body([{ ...MED_UNITS[0], factorMilli: 12_000 }, MED_UNITS[1]!]))).statusCode).toBe(200);
    // once the draft is gone, the box changes too
    await app.inject({ method: 'DELETE', url: `/api/invoices/${draft.id}`, headers });
    expect((await put(`/api/items/${medId}`, body([MED_UNITS[0]!, { ...MED_UNITS[1], factorMilli: 120_000 }]))).statusCode).toBe(200);
  });

  it('an open document that names an item stops its base unit from changing, though nothing has moved', async () => {
    const item = (await get(`/api/items/${medId}`)).json();
    const body = { code: item.code, barcode: item.barcode, name: item.name, unit: 'piece', salePrice: 250, saleCurrency: 'IQD', saleUnit: 'strip', purchaseUnit: 'box', units: MED_UNITS };
    // a draft in the base unit (5 tablets) and a quote: both would be read as pieces
    const draft = (await post('/api/invoices', invoice('sale', [{ itemId: medId, qtyMilli: 5_000, unitPrice: 250 }]))).json();
    const quote = await post('/api/quotes', { date: '2026-11-02', partyId: customerId, currency: 'IQD', discount: 0, lines: [{ itemId: medId, description: '', qtyMilli: 3_000, unitPrice: 250 }] });
    expect(quote.statusCode, quote.body).toBe(201);
    const refused = await put(`/api/items/${medId}`, body);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({
      error: 'base_unit_in_use',
      details: { drafts: [{ type: 'invoice', id: draft.id, number: null, date: '2026-11-01' }, { type: 'quote', id: quote.json().id, date: '2026-11-02' }] }
    });
    expect((await get(`/api/items/${medId}`)).json().unit).toBe('tablet');
    await app.inject({ method: 'DELETE', url: `/api/invoices/${draft.id}`, headers });
    expect((await post(`/api/quotes/${quote.json().id}/status`, { action: 'reject' })).statusCode).toBeLessThan(300);
    // a rejected quote can be reopened: it still holds the item; cancelled, it no longer does
    expect((await put(`/api/items/${medId}`, body)).json()).toMatchObject({ error: 'base_unit_in_use', details: { drafts: [{ type: 'quote' }] } });
    expect((await post(`/api/quotes/${quote.json().id}/status`, { action: 'cancel' })).statusCode).toBeLessThan(300);
    // an open stock count of the item holds it too
    const count = await post('/api/adjustments/counts', { date: '2026-11-03', warehouseId });
    expect(count.statusCode, count.body).toBe(201);
    expect((await put(`/api/adjustments/counts/${count.json().id}`, { counts: [{ itemId: medId, countedMilli: 4_000, unitCost: 200 }] })).statusCode).toBe(200);
    expect((await put(`/api/items/${medId}`, body)).json()).toMatchObject({ error: 'base_unit_in_use', details: { drafts: [{ type: 'count', id: count.json().id }] } });
    await app.inject({ method: 'DELETE', url: `/api/adjustments/counts/${count.json().id}`, headers });
    const changed = await put(`/api/items/${medId}`, body);
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().unit).toBe('piece');
  });

  it('a request with no unit means what it meant in 1.0.3', async () => {
    const plain = await postNew(invoice('purchase', [{ itemId: medId, qtyMilli: 50_000, unitPrice: 180 }]));
    expect(plain.lines[0]).toMatchObject({ qtyMilli: 50_000, lineUnit: null, unitFactorMilli: null, unitQtyMilli: null, unitPrice: 180, amount: 9_000 });
    expect(await stock()).toEqual({ qty: 50_000, value: 9_000 });
    // the base unit named as a unit is the same thing
    const same = await post('/api/invoices', invoice('sale', [{ itemId: medId, unit: 'tablet', unitQtyMilli: 2_000, unitPrice: 250 }]));
    expect(same.json().lines[0]).toMatchObject({ qtyMilli: 2_000, lineUnit: null, amount: 500 });
  });

  it('carries units through stock documents, adjustments and purchase orders', async () => {
    const opening = await post('/api/stock-docs', {
      kind: 'opening', date: '2026-11-01', warehouseId, counterAccountCode: '21', lines: [{ itemId: medId, unit: 'box', unitQtyMilli: 3_000, unitCost: 17_000 }]
    });
    expect(opening.statusCode, opening.body).toBe(201);
    expect(opening.json().lines[0]).toMatchObject({ qtyMilli: 300_000, lineUnit: 'box', unitQtyMilli: 3_000 });
    const posted = await post(`/api/stock-docs/${opening.json().id}/post`);
    expect(posted.json().totalValue).toBe(51_000);
    expect(await stock()).toEqual({ qty: 300_000, value: 51_000 });

    const adj = await post('/api/adjustments', { date: '2026-11-02', warehouseId, reason: 'damaged', lines: [{ itemId: medId, unit: 'strip', unitQtyMilli: -2_000 }] });
    expect(adj.statusCode, adj.body).toBe(201);
    expect(adj.json().lines[0]).toMatchObject({ qtyMilli: -20_000, lineUnit: 'strip', unitQtyMilli: -2_000 });
    expect((await post(`/api/adjustments/${adj.json().id}/post`)).statusCode).toBe(200);
    expect((await stock()).qty).toBe(280_000);

    const po = await post('/api/purchase-orders', { date: '2026-11-02', partyId: supplierId, currency: 'IQD', lines: [{ itemId: medId, unit: 'box', unitQtyMilli: 2_000, unitPrice: 18_000 }] });
    expect(po.statusCode, po.body).toBe(201);
    expect(po.json()).toMatchObject({ total: 36_000, lines: [{ qtyMilli: 200_000, lineUnit: 'box', amount: 36_000 }] });
    await post(`/api/purchase-orders/${po.json().id}/status`, { action: 'send' });
    const received = await post(`/api/purchase-orders/${po.json().id}/receive`, { date: '2026-11-03', warehouseId });
    expect(received.statusCode, received.body).toBe(201);
    const bill = (await get(`/api/invoices/${received.json().invoiceId}`)).json();
    expect(bill.lines[0]).toMatchObject({ qtyMilli: 200_000, lineUnit: 'box', unitQtyMilli: 2_000, unitPrice: 18_000, amount: 36_000 });
  });
});
