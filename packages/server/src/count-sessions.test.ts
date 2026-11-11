import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';

/** A stock count saved on the server as it is typed, with each item's book quantity frozen when first counted. */

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let supplierId: string;
let customerId: string;
let pipeId: string;
let cableId: string;

type Headers = Record<string, string>;
const headers: Headers = { 'x-qasa-user': encodeURIComponent('Mer') };
const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, h: Headers = headers) =>
  app.inject({ method, url, headers: h, ...(body !== undefined ? { payload: body as object } : {}) });

beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await send('GET', '/api/warehouses')).json()[0].id;
  supplierId = (await send('POST', '/api/parties', { type: 'supplier', name: 'RapidNet Ltd' })).json().id;
  customerId = (await send('POST', '/api/parties', { type: 'customer', name: 'Mer' })).json().id;
  pipeId = (await send('POST', '/api/items', { code: 'PIPE-1', name: { ar: 'أنبوب', en: 'Steel pipe', ku: 'بۆری' }, unit: 'piece', salePrice: 30_000, saleCurrency: 'IQD' })).json().id;
  cableId = (await send('POST', '/api/items', { code: 'CAB-6', name: { ar: 'كيبل', en: 'Cable 6mm', ku: 'کێبڵ' }, unit: 'piece', salePrice: 5_000, saleCurrency: 'IQD' })).json().id;
  // 20 pipes at 23,000 and 10 cables at 4,000
  for (const [itemId, qtyMilli, unitPrice] of [[pipeId, 20_000, 23_000], [cableId, 10_000, 4_000]] as const) {
    const draft = await send('POST', '/api/invoices', {
      kind: 'purchase', date: '2026-09-01', partyId: supplierId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
      lines: [{ itemId, qtyMilli, unitPrice }]
    });
    expect((await send('POST', `/api/invoices/${draft.json().id}/post`)).statusCode).toBe(200);
  }
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function sell(itemId: string, qtyMilli: number) {
  const draft = await send('POST', '/api/invoices', {
    kind: 'sale', date: '2026-09-10', partyId: customerId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
    lines: [{ itemId, qtyMilli, unitPrice: 30_000 }]
  });
  expect(draft.statusCode, draft.body).toBe(201);
  expect((await send('POST', `/api/invoices/${draft.json().id}/post`)).statusCode).toBe(200);
}

const start = async () => {
  const res = await send('POST', '/api/adjustments/counts', { date: '2026-09-10', warehouseId });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; lines: { itemId: string; countedMilli: number; bookMilli: number }[] };
};
const save = (id: string, counts: { itemId: string; countedMilli: number | null; unitCost?: number }[], extra: object = {}) =>
  send('PUT', `/api/adjustments/counts/${id}`, { counts, ...extra });

describe('stock count sessions', () => {
  it('keeps the count on the server, so it is there again after leaving the page', async () => {
    const session = await start();
    expect((await save(session.id, [{ itemId: pipeId, countedMilli: 19_000 }], { notes: 'Shelf A' })).statusCode).toBe(200);
    // the page is opened again: the open count of the warehouse comes back with what was typed
    const again = (await send('GET', `/api/adjustments/counts/open?warehouseId=${warehouseId}`)).json();
    expect(again).toMatchObject({ id: session.id, status: 'open', notes: 'Shelf A', lines: [{ itemId: pipeId, countedMilli: 19_000, bookMilli: 20_000 }] });
    // starting again gives the same count, not a second one
    expect((await start()).id).toBe(session.id);
  });

  it('freezes the book quantity when an item is first counted: a sale during the count is no surplus', async () => {
    const session = await start();
    await save(session.id, [{ itemId: pipeId, countedMilli: 20_000 }]);
    // 5 pipes are sold while the rest of the warehouse is counted
    await sell(pipeId, 5_000);
    // typing over the count keeps the quantity frozen at the first count
    const saved = (await save(session.id, [{ itemId: pipeId, countedMilli: 20_000 }, { itemId: cableId, countedMilli: 9_000 }])).json();
    expect(saved.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: pipeId, countedMilli: 20_000, bookMilli: 20_000 }),
      expect.objectContaining({ itemId: cableId, countedMilli: 9_000, bookMilli: 10_000 })
    ]));
    const finished = await send('POST', `/api/adjustments/counts/${session.id}/finish`);
    expect(finished.statusCode, finished.body).toBe(200);
    const result = finished.json();
    // only the cable that is really missing; no false surplus of 5 pipes
    expect(result).toMatchObject({ differences: 1, session: { status: 'done' } });
    expect(result.adjustment.lines.map((l: { itemId: string; qtyMilli: number }) => [l.itemId, l.qtyMilli])).toEqual([[cableId, -1_000]]);
    // posting uses those quantities
    const posted = await send('POST', `/api/adjustments/${result.adjustment.id}/post`);
    expect(posted.statusCode, posted.body).toBe(200);
    expect(posted.json()).toMatchObject({ status: 'posted', valueOut: 4_000, valueIn: 0 });
    const pipeStock = (await send('GET', `/api/items/${pipeId}`)).json().stock.find((s: { warehouseId: string }) => s.warehouseId === warehouseId);
    expect(pipeStock.qtyMilli).toBe(15_000);
  });

  it('the count against today\'s books (the old way) would have made that false surplus', async () => {
    await sell(pipeId, 5_000);
    const old = await send('POST', '/api/adjustments/count', { date: '2026-09-10', warehouseId, counts: [{ itemId: pipeId, countedMilli: 20_000 }] });
    expect(old.json().adjustment.lines[0]).toMatchObject({ itemId: pipeId, qtyMilli: 5_000 });
  });

  it('the one-shot count import is refused while the warehouse has an open count, and works again once it is closed', async () => {
    const session = await start();
    await save(session.id, [{ itemId: pipeId, countedMilli: 20_000 }]);
    await sell(pipeId, 5_000);
    // beside the open count it would measure against today's books: a false surplus of the 5 pipes sold meanwhile
    const refused = await send('POST', '/api/adjustments/count', { date: '2026-09-10', warehouseId, counts: [{ itemId: pipeId, countedMilli: 20_000 }] });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'count_session_open', details: { countId: session.id } });
    expect((await send('GET', '/api/adjustments?status=draft')).json()).toEqual([]);
    expect((await send('DELETE', `/api/adjustments/counts/${session.id}`)).statusCode).toBe(204);
    const after = await send('POST', '/api/adjustments/count', { date: '2026-09-10', warehouseId, counts: [{ itemId: cableId, countedMilli: 9_000 }] });
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json()).toMatchObject({ differences: 1 });
  });

  it('an item taken off the count and counted again is frozen again then', async () => {
    const session = await start();
    await save(session.id, [{ itemId: pipeId, countedMilli: 20_000 }]);
    await sell(pipeId, 2_000);
    const off = (await save(session.id, [{ itemId: pipeId, countedMilli: null }])).json();
    expect(off.lines).toEqual([]);
    const again = (await save(session.id, [{ itemId: pipeId, countedMilli: 17_000 }])).json();
    expect(again.lines).toEqual([expect.objectContaining({ itemId: pipeId, countedMilli: 17_000, bookMilli: 18_000 })]);
  });

  it('with "count all", an item not counted counts as zero; when all agree nothing is made', async () => {
    const session = await start();
    await save(session.id, [{ itemId: pipeId, countedMilli: 20_000 }], { full: true });
    const result = (await send('POST', `/api/adjustments/counts/${session.id}/finish`)).json();
    expect(result.adjustment.lines.map((l: { itemId: string; qtyMilli: number }) => [l.itemId, l.qtyMilli])).toEqual([[cableId, -10_000]]);

    const agree = await start();
    expect(agree.id).not.toBe(session.id);
    await save(agree.id, [{ itemId: pipeId, countedMilli: 20_000 }]);
    expect((await send('POST', `/api/adjustments/counts/${agree.id}/finish`)).json()).toMatchObject({ adjustment: null, differences: 0 });
  });

  it('with "count all", an item made or switched on again during the count is no shortage when it is finished', async () => {
    const wire = { code: 'WIRE-2', name: { ar: 'سلك', en: 'Wire', ku: 'وایەر' }, unit: 'piece', salePrice: 2_000, saleCurrency: 'IQD' };
    const wireId = (await send('POST', '/api/items', { ...wire, active: false })).json().id;
    const session = await start();
    await save(session.id, [{ itemId: pipeId, countedMilli: 20_000 }, { itemId: cableId, countedMilli: 10_000 }], { full: true });
    // while the shelves are counted, a new item is made and bought, and a switched-off one is switched on and bought
    const lampId = (await send('POST', '/api/items', { code: 'LAMP-1', name: { ar: 'مصباح', en: 'Lamp', ku: 'چرا' }, unit: 'piece', salePrice: 8_000, saleCurrency: 'IQD' })).json().id;
    expect((await send('PUT', `/api/items/${wireId}`, { ...wire, active: true })).statusCode).toBe(200);
    for (const [itemId, qtyMilli] of [[lampId, 5_000], [wireId, 3_000]] as const) {
      const draft = await send('POST', '/api/invoices', {
        kind: 'purchase', date: '2026-09-10', partyId: supplierId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
        lines: [{ itemId, qtyMilli, unitPrice: 1_000 }]
      });
      expect((await send('POST', `/api/invoices/${draft.json().id}/post`)).statusCode).toBe(200);
    }
    // they were never on the count sheet: everything counted agrees, so nothing is made
    expect((await send('POST', `/api/adjustments/counts/${session.id}/finish`)).json()).toMatchObject({ adjustment: null, differences: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM stock_moves WHERE item_id IN (?, ?) AND qty_milli < 0').get(lampId, wireId)).toMatchObject({ n: 0 });
  });

  it('a "count all" begun before the items were fixed at its start covers only what was counted in it', async () => {
    // an open count kept by an older version: no stock_count_items rows
    const session = await start();
    db.prepare('DELETE FROM stock_count_items WHERE count_id = ?').run(session.id);
    await save(session.id, [{ itemId: pipeId, countedMilli: 18_000 }], { full: true });
    const result = (await send('POST', `/api/adjustments/counts/${session.id}/finish`)).json();
    // the cable (not counted) is left alone instead of being taken for a shortage of all 10
    expect(result.adjustment.lines.map((l: { itemId: string; qtyMilli: number }) => [l.itemId, l.qtyMilli])).toEqual([[pipeId, -2_000]]);
  });

  it('an item a count started with can still be deleted when it was never used', async () => {
    const spare = (await send('POST', '/api/items', { code: 'SPARE-1', name: { ar: 'قطعة', en: 'Spare', ku: 'پارچە' }, unit: 'piece', salePrice: 1_000, saleCurrency: 'IQD' })).json().id;
    await start();
    expect((await send('DELETE', `/api/items/${spare}`)).statusCode).toBe(204);
  });

  it('a finished or discarded count can no longer change, and bad input is refused', async () => {
    const session = await start();
    expect((await save(session.id, [{ itemId: pipeId, countedMilli: -1 }])).statusCode).toBe(400);
    expect((await save(session.id, [{ itemId: 'nope', countedMilli: 1 }])).json().details).toEqual([{ code: 'item_invalid', row: 1 }]);
    expect((await send('POST', `/api/adjustments/counts/${session.id}/finish`)).json().details).toEqual([{ code: 'lines_required' }]);
    expect((await send('DELETE', `/api/adjustments/counts/${session.id}`)).statusCode).toBe(204);
    expect((await save(session.id, [{ itemId: pipeId, countedMilli: 1_000 }])).json()).toMatchObject({ error: 'action_not_allowed' });
    expect((await send('GET', `/api/adjustments/counts/open?warehouseId=${warehouseId}`)).json()).toBeNull();
    expect((await send('GET', '/api/adjustments/counts/missing')).statusCode).toBe(404);
  });

  it('needs the stock permission to count', async () => {
    await send('POST', '/api/plan/trial');
    const owner = (await send('GET', '/api/users')).json()[0].id;
    await send('POST', `/api/users/${owner}/password`, { password: 'owner-pass-1' });
    await send('POST', '/api/users', { username: 'raz', name: 'Raz', roles: ['viewer'], password: 'raz-pass-11' });
    await send('PUT', '/api/auth/signin', { on: true });
    const login = await send('POST', '/api/auth/login', { username: 'raz', password: 'raz-pass-11' });
    const raz = { cookie: String(login.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    expect((await send('POST', '/api/adjustments/counts', { date: '2026-09-10', warehouseId }, raz)).statusCode).toBe(403);
  });
});

describe('a count limited to some categories and brands (1.1)', () => {
  it('lists, counts and adjusts only those items (subcategories with their category); the rest are left alone, and the draft says what was counted', async () => {
    const pipes = (await send('POST', '/api/item-categories', { name: { ar: 'أنابيب', en: 'Pipes', ku: 'بۆری' } })).json();
    const steel = (await send('POST', '/api/item-categories', { name: { ar: 'حديد', en: 'Steel', ku: 'ئاسن' }, parentId: pipes.id })).json();
    await send('PUT', `/api/items/${pipeId}`, { name: { ar: 'أنبوب', en: 'Steel pipe', ku: 'بۆری' }, unit: 'piece', salePrice: 30_000, saleCurrency: 'IQD', categoryId: steel.id });
    const scope = { categoryIds: [pipes.id] };
    const res = await send('POST', '/api/adjustments/counts', { date: '2026-09-10', warehouseId, full: true, scope });
    expect(res.statusCode, res.body).toBe(201);
    const count = res.json();
    expect(count.scope).toEqual({ categoryIds: [pipes.id], brandIds: [] });
    expect(db.prepare('SELECT item_id FROM stock_count_items WHERE count_id = ?').all(count.id)).toEqual([{ item_id: pipeId }]);
    // the cable is not this count's
    expect((await save(count.id, [{ itemId: cableId, countedMilli: 3_000 }])).json()).toMatchObject({ error: 'validation', details: [{ code: 'item_outside_count', row: 1 }] });
    // "count all" with nothing typed: the pipes count as zero, the cables are untouched
    const done = (await send('POST', `/api/adjustments/counts/${count.id}/finish`)).json();
    expect(done.adjustment.lines.map((l: { itemId: string; qtyMilli: number }) => [l.itemId, l.qtyMilli])).toEqual([[pipeId, -20_000]]);
    const draft = (await send('GET', `/api/adjustments/${done.adjustment.id}`)).json();
    expect(draft.countScope).toEqual({ categoryIds: [pipes.id], brandIds: [] });
    // unknown categories or brands are refused
    expect((await send('POST', '/api/adjustments/counts', { date: '2026-09-10', warehouseId, scope: { brandIds: ['nope'] } })).json()).toMatchObject({ details: [{ code: 'brand_invalid' }] });
  });

  it('by brand, with a category too: only items in both', async () => {
    const brand = (await send('POST', '/api/brands', { name: 'Grohe' })).json();
    await send('PUT', `/api/items/${cableId}`, { name: { ar: 'كيبل', en: 'Cable 6mm', ku: 'کێبڵ' }, unit: 'piece', salePrice: 5_000, saleCurrency: 'IQD', brandId: brand.id });
    const count = (await send('POST', '/api/adjustments/counts', { date: '2026-09-10', warehouseId, scope: { brandIds: [brand.id] } })).json();
    expect(db.prepare('SELECT item_id FROM stock_count_items WHERE count_id = ?').all(count.id)).toEqual([{ item_id: cableId }]);
    expect((await save(count.id, [{ itemId: cableId, countedMilli: 9_000 }])).statusCode).toBe(200);
  });
});
