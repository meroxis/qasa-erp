import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, todayIso } from '@qasa/core';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { resetLoginThrottle } from './auth.ts';
import { setLicensePublicKeyForTests } from './license.ts';
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

// 1.5: what arrived of an order, counted or scanned when it came (the phone app's "Receive goods")
describe('goods that arrived against an order', () => {
  const today = todayIso();
  const arrive = (id: string, body: unknown, h: Record<string, string> = headers) => post(`/api/purchase-orders/${id}/arrivals`, body, h);
  const lines = (inv: { lines: { itemId: string; qtyMilli: number; unit?: string | null; unitQtyMilli?: number | null; unitPrice: number }[] }) =>
    inv.lines.map((l) => [l.itemId === acId ? 'ac' : l.itemId === pipeId ? 'pipe' : l.itemId, l.qtyMilli, l.unitPrice]);

  it('makes a draft purchase invoice for what came, at the order\'s prices, with the draft\'s id and status at the top', async () => {
    const po = await sent();
    // the same item twice is added up
    const res = await arrive(po.id, { date: today, lines: [{ itemId: acId, qtyMilli: 2_000 }, { itemId: pipeId, qtyMilli: 5_000 }, { itemId: acId, qtyMilli: 1_000 }] });
    expect(res.statusCode, res.body).toBe(201);
    const made = res.json();
    expect(made).toMatchObject({ status: 'draft', order: { id: po.id, status: 'sent' } });
    expect(made.id).toBe(made.invoiceId);
    const inv = (await get(`/api/invoices/${made.invoiceId}`)).json();
    expect(inv).toMatchObject({ kind: 'purchase', status: 'draft', payment: 'credit', date: today, notes: po.number, partyId: supplierId });
    expect(lines(inv)).toEqual([['ac', 3_000, 600_000], ['pipe', 5_000, 15_000]]);
    // linked to the order: it waits for this draft, as after "receive"
    const again = await arrive(po.id, { lines: [{ itemId: acId, qtyMilli: 1_000 }] });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('po_receipt_pending');
    // posted, it counts: partial, then received with what is left
    expect((await post(`/api/invoices/${made.invoiceId}/post`)).statusCode).toBe(200);
    expect((await get(`/api/purchase-orders/${po.id}`)).json()).toMatchObject({ status: 'partial', lines: [{ receivedMilli: 3_000, remainingMilli: 7_000 }, { receivedMilli: 5_000, remainingMilli: 15_000 }] });
    const rest = (await arrive(po.id, { lines: [{ itemId: acId, qtyMilli: 7_000 }, { itemId: pipeId, qtyMilli: 15_000 }] })).json();
    expect((await post(`/api/invoices/${rest.invoiceId}/post`)).statusCode).toBe(200);
    expect((await get(`/api/purchase-orders/${po.id}`)).json().status).toBe('received');
    // nothing more can arrive on a received order
    expect((await arrive(po.id, { lines: [{ itemId: acId, qtyMilli: 1_000 }] })).json().error).toBe('action_not_allowed');
    // the audit log says what arrived, with the action word of receiving
    const audit = db.prepare("SELECT details FROM audit_log WHERE action = 'po.receive' ORDER BY id").all() as { details: string }[];
    expect(audit.map((a) => JSON.parse(a.details))).toEqual([
      expect.objectContaining({ number: po.number, invoiceId: made.invoiceId, lines: 2, arrivals: true }),
      expect.objectContaining({ invoiceId: rest.invoiceId, arrivals: true })
    ]);
  });

  it('takes only what is on the order and still to come, today or before, and nothing but the lines', async () => {
    const po = await sent();
    const refused = async (body: unknown) => {
      const res = await arrive(po.id, body);
      expect(res.statusCode, res.body).toBe(400);
      return res.json().details;
    };
    expect(await refused({ lines: [{ itemId: customerId, qtyMilli: 1_000 }] })).toEqual([{ code: 'po_line_unknown', itemId: customerId }]);
    expect(await refused({ lines: [{ itemId: acId, qtyMilli: 6_000 }, { itemId: acId, qtyMilli: 5_000 }] })).toEqual([{ code: 'po_over_remaining', itemId: acId, remaining: 10_000 }]);
    expect(await refused({ date: addDays(today, 1), lines: [{ itemId: acId, qtyMilli: 1_000 }] })).toEqual([{ code: 'date_future' }]);
    // a price, a cost or anything else is not taken from whoever counted
    for (const body of [{ lines: [{ itemId: acId, qtyMilli: 1_000, unitPrice: 1 }] }, { lines: [{ itemId: acId, qtyMilli: 1_000 }], rateX100: 100 }, { lines: [] }, { lines: [{ itemId: acId, qtyMilli: 0 }] }]) {
      expect((await arrive(po.id, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    // a draft order hasn't been sent: nothing arrives for it
    const draft = await created();
    expect((await arrive(draft.id, { lines: [{ itemId: acId, qtyMilli: 1_000 }] })).json().error).toBe('action_not_allowed');
    expect(db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE kind = 'purchase'").get()).toMatchObject({ n: 0 });
  });

  it('spreads an item over the order\'s lines, first line first, and keeps a line ordered in boxes in whole boxes', async () => {
    const boxed = (await post('/api/items', { code: 'FLT', name: { ar: 'فلتر', en: 'Filter', ku: 'فلتەر' }, unit: 'piece', salePrice: 5_000, saleCurrency: 'IQD', units: [{ unit: 'box', factorMilli: 12_000 }] })).json().id;
    const po = (await post('/api/purchase-orders', order({ lines: [
      { itemId: boxed, unit: 'box', unitQtyMilli: 2_000, unitPrice: 48_000 },
      { itemId: boxed, qtyMilli: 5_000, unitPrice: 4_100 }
    ] }))).json();
    expect((await post(`/api/purchase-orders/${po.id}/status`, { action: 'send' })).statusCode).toBe(200);
    // 12 pieces: one whole box on the boxed line
    const first = (await arrive(po.id, { lines: [{ itemId: boxed, qtyMilli: 12_000 }] })).json();
    const inv = (await get(`/api/invoices/${first.invoiceId}`)).json();
    expect(inv.lines.map((l: { lineUnit: string | null; unitQtyMilli: number | null; qtyMilli: number; unitPrice: number }) => [l.lineUnit, l.unitQtyMilli, l.qtyMilli, l.unitPrice]))
      .toEqual([['box', 1_000, 12_000, 48_000]]);
    expect((await post(`/api/invoices/${first.invoiceId}/post`)).statusCode).toBe(200);
    // 18 pieces: the 12 left on the boxed line (a whole box), then 6 on the next line in pieces
    const second = (await arrive(po.id, { lines: [{ itemId: boxed, qtyMilli: 17_000 }] })).json();
    const inv2 = (await get(`/api/invoices/${second.invoiceId}`)).json();
    expect(inv2.lines.map((l: { lineUnit: string | null; unitQtyMilli: number | null; qtyMilli: number; unitPrice: number }) => [l.lineUnit, l.unitQtyMilli, l.qtyMilli, l.unitPrice]))
      .toEqual([['box', 1_000, 12_000, 48_000], [null, null, 5_000, 4_100]]);
    // 6 pieces of a boxed line are half a box: received in pieces, at the box's price per piece
    expect((await app.inject({ method: 'DELETE', url: `/api/invoices/${second.invoiceId}`, headers })).statusCode).toBe(204);
    const third = (await arrive(po.id, { lines: [{ itemId: boxed, qtyMilli: 6_000 }] })).json();
    expect((await get(`/api/invoices/${third.invoiceId}`)).json().lines.map((l: { lineUnit: string | null; qtyMilli: number; unitPrice: number }) => [l.lineUnit, l.qtyMilli, l.unitPrice]))
      .toEqual([[null, 6_000, 4_000]]);
  });

  it('makes one draft when the same request comes again with its key, and answers it with the draft\'s id', async () => {
    const po = await sent();
    const key = { ...headers, 'x-qasa-idempotency': '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' };
    const body = { date: today, lines: [{ itemId: acId, qtyMilli: 2_000 }] };
    const first = await arrive(po.id, body, key);
    const second = await arrive(po.id, body, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ id: first.json().id, status: 'draft', invoiceId: first.json().invoiceId });
    expect(db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE kind = 'purchase'").get()).toMatchObject({ n: 1 });
  });

  it('is for whoever keeps the stock or buys; a sales person may not; posting the draft stays with purchases', async () => {
    writeSetting(db, 'trial_started', today);
    const owner = (await get('/api/users')).json()[0];
    await post(`/api/users/${owner.id}/password`, { password: 'owner-pass-1' });
    for (const [username, roles] of [['las', ['storekeeper']], ['mer', ['purchasing']], ['raz', ['sales']]] as const) {
      expect((await post('/api/users', { username, name: username, roles, password: `${username}-pass-1` })).statusCode).toBe(201);
    }
    const po = await sent();
    expect((await app.inject({ method: 'PUT', url: '/api/auth/signin', payload: { on: true }, headers })).statusCode).toBe(200);
    const signIn = async (username: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: `${username}-pass-1` }, headers: { 'x-qasa-client': '1' } });
      expect(res.statusCode, res.body).toBe(200);
      return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    };
    const [las, mer, raz] = [await signIn('las'), await signIn('mer'), await signIn('raz')];
    const refused = await arrive(po.id, { lines: [{ itemId: acId, qtyMilli: 1_000 }] }, raz);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().details).toEqual({ need: 'stock' });
    const kept = await arrive(po.id, { lines: [{ itemId: acId, qtyMilli: 1_000 }] }, las);
    expect(kept.statusCode, kept.body).toBe(201);
    // the storekeeper may not post it (purchases), the buyer may
    expect((await post(`/api/invoices/${kept.json().invoiceId}/post`, {}, las)).statusCode).toBe(403);
    expect((await post(`/api/invoices/${kept.json().invoiceId}/post`, {}, mer)).statusCode).toBe(200);
    expect((await arrive(po.id, { lines: [{ itemId: pipeId, qtyMilli: 1_000 }] }, mer)).statusCode).toBe(201);
  });

  it('is refused for an order of another branch\'s warehouse', async () => {
    resetLoginThrottle();
    const pair = generateKeyPairSync('ed25519');
    setLicensePublicKeyForTests(pair.publicKey.export({ format: 'jwk' }).x!);
    const body = `QASA1.${Buffer.from(JSON.stringify({ v: 1, id: 'QL-TEST-business', plan: 'business', to: 'Test Company', issued: '2026-01-01', expires: null })).toString('base64url')}`;
    expect((await post('/api/plan/license', { key: `${body}.${sign(null, Buffer.from(body), pair.privateKey).toString('base64url')}` })).statusCode).toBe(200);
    const hq = (await get('/api/warehouses')).json()[0].id;
    const erbil = (await post('/api/warehouses', { code: 'ERB', name: { ar: 'أربيل', en: 'Erbil', ku: 'هەولێر' } })).json().id;
    const branch = (await post('/api/branches', { code: 'ERB', name: 'Erbil', city: 'Erbil' })).json().id;
    expect((await put(`/api/branches/${branch}/warehouses`, { warehouseIds: [erbil] })).statusCode).toBe(200);
    const owner = (await get('/api/users')).json()[0];
    await post(`/api/users/${owner.id}/password`, { password: 'owner-pass-1' });
    const lasId = (await post('/api/users', { username: 'las', name: 'Las', roles: ['storekeeper'], password: 'las-pass-1' })).json().id;
    expect((await put(`/api/users/${lasId}/branches`, { branchIds: [branch] })).statusCode).toBe(200);
    const hqOrder = (await post('/api/purchase-orders', order({ warehouseId: hq }))).json();
    const erbilOrder = (await post('/api/purchase-orders', order({ warehouseId: erbil }))).json();
    for (const o of [hqOrder, erbilOrder]) expect((await post(`/api/purchase-orders/${o.id}/status`, { action: 'send' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/api/auth/signin', payload: { on: true }, headers })).statusCode).toBe(200);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'las', password: 'las-pass-1' }, headers: { 'x-qasa-client': '1' } });
    const las = { cookie: String(login.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    expect((await arrive(hqOrder.id, { lines: [{ itemId: acId, qtyMilli: 1_000 }] }, las)).statusCode).toBe(403);
    // and its own branch's order, but not into another branch's warehouse
    expect((await arrive(erbilOrder.id, { warehouseId: hq, lines: [{ itemId: acId, qtyMilli: 1_000 }] }, las)).statusCode).toBe(403);
    expect((await arrive(erbilOrder.id, { lines: [{ itemId: acId, qtyMilli: 1_000 }] }, las)).statusCode).toBe(201);
  });
});
