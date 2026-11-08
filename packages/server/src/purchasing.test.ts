import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { writeSetting } from './settings.ts';
import { purchasingApi } from './purchasing.ts';

let db: Db;
let app: FastifyInstance;
let supplierId: string;
let customerId: string;
let acId: string;
let pipeId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer') };
const post = (url: string, body: unknown = {}, h: Record<string, string> = headers) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const put = (url: string, body: unknown = {}, h: Record<string, string> = headers) => app.inject({ method: 'PUT', url, payload: body as object, headers: h });
const get = (url: string, h: Record<string, string> = headers) => app.inject({ url, headers: h });

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  supplierId = (await post('/api/parties', { type: 'supplier', name: 'Gree Iraq' })).json().id;
  customerId = (await post('/api/parties', { type: 'customer', name: 'Bazaar Trading Company' })).json().id;
  acId = (await post('/api/items', { code: 'AC-18', name: { ar: 'مكيف', en: 'AC 18,000 BTU', ku: 'سپلیت' }, unit: 'piece', salePrice: 823_600, saleCurrency: 'IQD' })).json().id;
  pipeId = (await post('/api/items', { code: 'CU-14', name: { ar: 'أنبوب نحاس', en: 'Copper pipe', ku: 'بۆری مس' }, unit: 'piece', salePrice: 25_000, saleCurrency: 'IQD' })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

const order = (extra: object = {}) => ({
  date: '2026-11-01', partyId: supplierId, currency: 'IQD', expectedDate: '2026-11-10', notes: 'Winter stock',
  lines: [{ itemId: acId, qtyMilli: 10_000, unitPrice: 600_000 }, { itemId: pipeId, qtyMilli: 20_000, unitPrice: 15_000 }],
  ...extra
});

async function created(extra: object = {}) {
  const res = await post('/api/purchase-orders', order(extra));
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

async function sent() {
  const po = await created();
  const res = await post(`/api/purchase-orders/${po.id}/status`, { action: 'send' });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

async function receive(id: string) {
  const res = await post(`/api/purchase-orders/${id}/receive`, { date: '2026-11-05' });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { order: { status: string }; invoiceId: string };
}

describe('purchase orders', () => {
  it('numbers an order and totals it', async () => {
    const po = await created();
    expect(po).toMatchObject({ number: 'PO-2026-0001', status: 'draft', total: 6_300_000, currency: 'IQD', expectedDate: '2026-11-10' });
    expect(po.lines[0]).toMatchObject({ itemCode: 'AC-18', amount: 6_000_000, receivedMilli: 0, remainingMilli: 10_000 });
    expect(po.actions).toEqual(expect.arrayContaining(['edit', 'send', 'cancel']));
    expect(po.actions).not.toContain('receive');
    expect((await created()).number).toBe('PO-2026-0002');
  });

  it('checks what it is given', async () => {
    const bad = await post('/api/purchase-orders', order({ partyId: customerId, expectedDate: '2026-10-01', lines: [{ itemId: 'nope', qtyMilli: 0, unitPrice: -1 }] }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().details).toEqual(expect.arrayContaining([
      { code: 'party_invalid' }, { code: 'po_expected_invalid' }, { code: 'line_item_invalid', line: 1 }, { code: 'line_qty_invalid', line: 1 }, { code: 'line_price_invalid', line: 1 }
    ]));
    expect((await post('/api/purchase-orders', order({ lines: [] }))).json().details).toEqual([{ code: 'po_lines_required' }]);
    expect((await post('/api/purchase-orders', order({ partyId: '' }))).json().details).toEqual([{ code: 'po_supplier_required' }]);
  });

  it('is edited while draft or sent, before anything is received', async () => {
    const po = await sent();
    expect(po.status).toBe('sent');
    expect(po.actions).toEqual(expect.arrayContaining(['edit', 'receive', 'cancel']));
    const edited = (await put(`/api/purchase-orders/${po.id}`, order({ lines: [{ itemId: acId, qtyMilli: 4_000, unitPrice: 610_000 }] }))).json();
    expect(edited).toMatchObject({ total: 2_440_000, status: 'sent' });
    expect(edited.lines).toHaveLength(1);
    await receive(po.id);
    expect((await put(`/api/purchase-orders/${po.id}`, order())).json().error).toBe('action_not_allowed');
  });

  it('receives into a draft purchase invoice for the remaining quantities, partly then fully', async () => {
    const po = await sent();
    const first = await receive(po.id);
    const inv = (await get(`/api/invoices/${first.invoiceId}`)).json();
    expect(inv).toMatchObject({ kind: 'purchase', status: 'draft', currency: 'IQD', notes: po.number });
    expect(inv.lines.map((l: { qtyMilli: number; unitPrice: number }) => [l.qtyMilli, l.unitPrice])).toEqual([[10_000, 600_000], [20_000, 15_000]]);
    // a draft doesn't count, and a second receipt waits for it
    let now = (await get(`/api/purchase-orders/${po.id}`)).json();
    expect(now.status).toBe('sent');
    expect(now.actions).not.toContain('receive');
    expect(now.actions).not.toContain('cancel');
    expect((await post(`/api/purchase-orders/${po.id}/receive`, { date: '2026-11-05' })).json().error).toBe('po_receipt_pending');

    // only 6 air conditioners came: edit the draft before posting
    const lines = inv.lines.map((l: { itemId: string; qtyMilli: number; unitPrice: number }) => ({ itemId: l.itemId, qtyMilli: l.itemId === acId ? 6_000 : l.qtyMilli, unitPrice: l.unitPrice }));
    const upd = await put(`/api/invoices/${first.invoiceId}`, { kind: 'purchase', date: inv.date, partyId: supplierId, warehouseId: inv.warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0, notes: inv.notes, lines });
    expect(upd.statusCode, upd.body).toBe(200);
    expect((await post(`/api/invoices/${first.invoiceId}/post`)).statusCode).toBe(200);
    now = (await get(`/api/purchase-orders/${po.id}`)).json();
    expect(now.status).toBe('partial');
    expect(now.lines.map((l: { receivedMilli: number; remainingMilli: number }) => [l.receivedMilli, l.remainingMilli])).toEqual([[6_000, 4_000], [20_000, 0]]);
    expect(now.receipts).toHaveLength(1);
    expect(now.actions).toContain('receive');

    const second = await receive(po.id);
    const inv2 = (await get(`/api/invoices/${second.invoiceId}`)).json();
    expect(inv2.lines.map((l: { itemId: string; qtyMilli: number }) => [l.itemId, l.qtyMilli])).toEqual([[acId, 4_000]]);
    expect((await post(`/api/invoices/${second.invoiceId}/post`)).statusCode).toBe(200);
    now = (await get(`/api/purchase-orders/${po.id}`)).json();
    expect(now.status).toBe('received');
    expect(now.actions).toEqual([]);
    expect((await get('/api/purchase-orders?status=received')).json().map((x: { id: string }) => x.id)).toEqual([po.id]);
  });

  it('does not count cancelled invoices', async () => {
    const po = await sent();
    const r = await receive(po.id);
    expect((await post(`/api/invoices/${r.invoiceId}/post`)).statusCode).toBe(200);
    expect((await get(`/api/purchase-orders/${po.id}`)).json().status).toBe('received');
    const cancel = await post(`/api/invoices/${r.invoiceId}/cancel`, { date: '2026-11-06' });
    expect(cancel.statusCode, cancel.body).toBe(200);
    const now = (await get(`/api/purchase-orders/${po.id}`)).json();
    expect(now.status).toBe('sent');
    expect(now.lines[0].remainingMilli).toBe(10_000);
    expect(now.actions).toContain('receive');
  });

  it('cancels and reopens', async () => {
    const po = await created();
    const c = (await post(`/api/purchase-orders/${po.id}/status`, { action: 'cancel', reason: 'Prices went up' })).json();
    expect(c).toMatchObject({ status: 'cancelled', actions: ['reopen'] });
    expect((await post(`/api/purchase-orders/${po.id}/receive`, { date: '2026-11-05' })).json().error).toBe('action_not_allowed');
    expect((await post(`/api/purchase-orders/${po.id}/status`, { action: 'reopen' })).json().status).toBe('draft');
    expect((await get('/api/purchase-orders/summary')).json()).toMatchObject({ draft: 1, open: 0 });
  });

  it('suggests what to order from items that ran out, by their last supplier', async () => {
    // buy 2 air conditioners and sell them both: out of stock
    const buy = (await post('/api/invoices', { kind: 'purchase', date: '2026-10-01', partyId: supplierId, warehouseId: (await get('/api/warehouses')).json()[0].id, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0, lines: [{ itemId: acId, qtyMilli: 2_000, unitPrice: 590_000 }] })).json();
    expect((await post(`/api/invoices/${buy.id}/post`)).statusCode).toBe(200);
    const sale = (await post('/api/invoices', { kind: 'sale', date: '2026-10-02', partyId: customerId, warehouseId: buy.warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0, lines: [{ itemId: acId, qtyMilli: 2_000, unitPrice: 800_000 }] })).json();
    expect((await post(`/api/invoices/${sale.id}/post`)).statusCode).toBe(200);
    const groups = (await get('/api/purchase-orders/suggest')).json();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ party: { id: supplierId, name: 'Gree Iraq' }, currency: 'IQD' });
    expect(groups[0].lines).toEqual([expect.objectContaining({ itemId: acId, onHandMilli: 0, suggestMilli: 1_000, lastPrice: 590_000 })]);
    // the never-stocked copper pipe isn't suggested; once on an open order, the AC isn't either
    await created({ lines: [{ itemId: acId, qtyMilli: 1_000, unitPrice: 590_000 }] });
    expect((await get('/api/purchase-orders/suggest')).json()).toEqual([]);
  });

  it('needs the purchases permission to change orders; looking is open to signed-in users', async () => {
    writeSetting(db, 'trial_started', new Date().toISOString().slice(0, 10));
    const owner = (await get('/api/users')).json()[0].id;
    await post(`/api/users/${owner}/password`, { password: 'owner-pass-1' });
    await post('/api/users', { username: 'las', name: 'Las', roles: ['purchasing'], password: 'las-pass-1' });
    await post('/api/users', { username: 'raz', name: 'Raz', roles: ['sales'], password: 'raz-pass-1' });
    const po = await created();
    expect((await app.inject({ method: 'PUT', url: '/api/auth/signin', payload: { on: true }, headers })).statusCode).toBe(200);
    const signIn = async (username: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: `${username}-pass-1` }, headers: { 'x-qasa-client': '1' } });
      expect(res.statusCode, res.body).toBe(200);
      return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    };
    const las = await signIn('las');
    const raz = await signIn('raz');
    const seen = (await get(`/api/purchase-orders/${po.id}`, raz)).json();
    expect(seen.number).toBe(po.number);
    expect(seen.actions).toEqual([]);
    expect((await post('/api/purchase-orders', order(), raz)).statusCode).toBe(403);
    expect((await post(`/api/purchase-orders/${po.id}/status`, { action: 'send' }, raz)).statusCode).toBe(403);
    expect((await post(`/api/purchase-orders/${po.id}/status`, { action: 'send' }, las)).statusCode).toBe(200);
    expect((await post(`/api/purchase-orders/${po.id}/receive`, { date: '2026-11-05' }, las)).statusCode).toBe(201);
    expect((await get('/api/purchase-orders')).statusCode).toBe(401);
  });
});
