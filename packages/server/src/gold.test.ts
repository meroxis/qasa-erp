import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { getEntry } from './journal.ts';
import { writeSetting } from './settings.ts';
import { createGoldDoc, postGoldDoc, updateGoldDoc } from './gold.ts';
import type { Actor } from './auth.ts';

// Gold and jewellery shops: pieces by weight and karat, the day's board pricing them, sales and the customer's slip,
// old gold bought and melted, suppliers settled in gold, cancelling, separate duties and the plan.

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let stockAccount: string;
let supplierId: string;
let customerId: string;
let ringId: string;

type H = Record<string, string>;
const headers: H = { 'x-qasa-user': encodeURIComponent('Mer') };
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, h: H = headers) =>
  app.inject({ method, url, headers: h, ...(body === undefined ? {} : { payload: body as object }) });
async function ok(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  const r = await call(method, url, body);
  expect(r.statusCode, `${method} ${url}: ${r.body}`).toBeLessThan(300);
  return r.statusCode === 204 ? null : r.json();
}

const balanceOf = (code: string) => Number((db.prepare(`SELECT COALESCE(SUM(l.base_debit - l.base_credit), 0) AS b FROM entry_lines l JOIN entries e ON e.id = l.entry_id
                                                         WHERE l.account_code = ? AND e.status = 'approved'`).get(code) as { b: number }).b);
const stock = (itemId: string) => db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q, COALESCE(SUM(value), 0) AS v FROM stock_moves WHERE item_id = ?').get(itemId) as { q: number; v: number };
const salePrice = (itemId: string) => Number((db.prepare('SELECT sale_price FROM items WHERE id = ?').get(itemId) as { sale_price: number }).sale_price);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T09:00:00Z'));
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await ok('GET', '/api/warehouses'))[0].id;
  stockAccount = (db.prepare('SELECT account_code FROM warehouses WHERE id = ?').get(warehouseId) as { account_code: string }).account_code;
  supplierId = (await ok('POST', '/api/parties', { type: 'supplier', name: 'Baghdad Gold Workshop' })).id;
  customerId = (await ok('POST', '/api/parties', { type: 'customer', name: 'Las' })).id;
  ringId = (await ok('POST', '/api/items', { code: 'RING-21', name: { ar: 'خاتم', en: 'Ring', ku: 'ئەنگوستیلە' }, unit: 'piece', salePrice: 0, saleCurrency: 'IQD' })).id;
});

afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  db.close();
});

const board = (prices: object[], date = '2026-11-20') => ok('PUT', '/api/gold/board', { date, currency: 'IQD', prices });

async function postDoc(body: object) {
  const draft = await ok('POST', '/api/gold/docs', body);
  return call('POST', `/api/gold/docs/${draft.id}/post`, { lang: 'en' });
}

async function setUp() {
  await ok('POST', '/api/plan/trial');
  // a 5 g ring of 21 karat, 5,000 dinars a gram for its making
  await ok('PUT', `/api/gold/items/${ringId}`, { weightMg: 5000, karat: 21, makingKind: 'gram', makingAmount: 5_000 });
  await board([{ karat: 21, buyPerGram: 95_000, sellPerGram: 100_000 }, { karat: 24, buyPerGram: 110_000, sellPerGram: 120_000 }]);
}

describe('gold and jewellery shops', () => {
  it('is behind the plan', async () => {
    const free = await call('PUT', `/api/gold/items/${ringId}`, { weightMg: 5000, karat: 21, makingKind: 'gram', makingAmount: 5_000 });
    expect(free.statusCode).toBe(409);
    expect(free.json()).toMatchObject({ error: 'plan_limit', details: { limit: 'goldShop' } });
    await ok('POST', '/api/plan/trial');
    expect((await call('PUT', `/api/gold/items/${ringId}`, { weightMg: 5000, karat: 21, makingKind: 'gram', makingAmount: 5_000 })).statusCode).toBe(200);
  });

  it('prices every piece from the day’s board: weight × the karat’s selling price + making', async () => {
    await setUp();
    expect(salePrice(ringId)).toBe(525_000); // 5 g × 100,000 + 5 g × 5,000
    const item = await ok('GET', `/api/gold/items/${ringId}`);
    expect(item).toMatchObject({ karat: 21, weightMg: 5000, fineMg: 4375, boardPrice: 525_000, salePrice: 525_000 });
    // a new board the next day prices it again
    vi.setSystemTime(new Date('2026-11-21T09:00:00Z'));
    const r = await board([{ karat: 21, buyPerGram: 96_000, sellPerGram: 102_000 }], '2026-11-21');
    expect(r.repriced).toBe(1);
    expect(salePrice(ringId)).toBe(535_000);
    // a making charge per piece
    await ok('PUT', `/api/gold/items/${ringId}`, { weightMg: 5000, karat: 21, makingKind: 'piece', makingAmount: 30_000 });
    expect(salePrice(ringId)).toBe(540_000);
    // a board whose selling price is under its buying price is refused, and a karat given twice
    expect((await call('PUT', '/api/gold/board', { date: '2026-11-21', currency: 'IQD', prices: [{ karat: 18, buyPerGram: 90_000, sellPerGram: 80_000 }] })).statusCode).toBe(400);
    expect((await call('PUT', '/api/gold/board', { date: '2026-11-21', currency: 'IQD', prices: [{ karat: 18, buyPerGram: 1, sellPerGram: 2 }, { karat: 18, buyPerGram: 1, sellPerGram: 2 }] })).statusCode).toBe(400);
    // the board of a day is what was set on or before it
    const b = await ok('GET', '/api/gold/board?currency=IQD&date=2026-11-20');
    expect(b.board['21']).toMatchObject({ sellPerGram: 100_000, date: '2026-11-20' });
    expect(b.board['18']).toBeNull();
  });

  it('takes pieces in from a supplier in gold and money, sells one, and prints the customer’s slip', async () => {
    await setUp();
    const r = await postDoc({ kind: 'receipt', date: '2026-11-20', partyId: supplierId, warehouseId, pricePerGram: 120_000, lines: [{ itemId: ringId }] });
    expect(r.statusCode, r.body).toBe(200);
    const doc = r.json();
    expect(doc).toMatchObject({ status: 'posted', number: 'GR-2026-0001', amount: 550_000 });
    // gold: 4.375 g pure × 120,000 = 525,000; making 25,000
    expect(doc.lines[0]).toMatchObject({ fineMg: 4375, goldValue: 525_000, making: 25_000 });
    const entry = getEntry(db, doc.entryId);
    expect(entry.status).toBe('approved');
    expect(balanceOf(stockAccount)).toBe(550_000);
    expect(balanceOf('264')).toBe(-525_000);
    expect(stock(ringId)).toEqual({ q: 1000, v: 550_000 });
    const suppliers = await ok('GET', '/api/gold/suppliers');
    expect(suppliers).toEqual([expect.objectContaining({ partyId: supplierId, basisKarat: 21, fineMg: 4375, basisMg: 5000, value: 525_000 })]);
    // the supplier settled in 24 karat sees 4.375 g of it
    await ok('PUT', `/api/gold/suppliers/${supplierId}`, { basisKarat: 24 });
    expect((await ok('GET', `/api/gold/suppliers/${supplierId}`)).supplier).toMatchObject({ basisKarat: 24, basisMg: 4375 });

    const draft = await ok('POST', '/api/invoices', {
      kind: 'sale', date: '2026-11-20', partyId: customerId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
      lines: [{ itemId: ringId, qtyMilli: 1000, unitPrice: 520_000 }]
    });
    await ok('POST', `/api/invoices/${draft.id}/post`, {});
    const slip = await ok('GET', `/api/gold/slip/${draft.id}`);
    // sold for 520,000: less 25,000 making over 5 g is 99,000 a gram
    expect(slip.lines).toEqual([expect.objectContaining({ weightMg: 5000, karat: 21, making: 25_000, perGram: 99_000, amount: 520_000 })]);
    // the receipt can't be cancelled once its piece is sold
    const cancel = await call('POST', `/api/gold/docs/${doc.id}/cancel`, {});
    expect(cancel.statusCode).toBe(400);
    expect(cancel.json().details).toEqual([expect.objectContaining({ code: 'gold_piece_sold' })]);
  });

  it('buys old gold for cash, melts it, and settles a supplier’s gold with it (a gain to other revenue)', async () => {
    await setUp();
    await postDoc({ kind: 'receipt', date: '2026-11-20', partyId: supplierId, warehouseId, pricePerGram: 120_000, lines: [{ itemId: ringId, making: 0 }] });
    const buy = await postDoc({ kind: 'buy', date: '2026-11-20', customerName: 'A walk-in customer', karat: 21, weightMg: 10_000, pricePerGram: 90_000, cashAccount: '1811' });
    expect(buy.statusCode, buy.body).toBe(200);
    expect(buy.json()).toMatchObject({ number: 'GB-2026-0001', amount: 900_000 });
    expect(balanceOf('1378')).toBe(900_000);
    expect(balanceOf('1811')).toBe(-900_000);
    // melting: fine gold can't grow
    const gains = await call('POST', '/api/gold/docs', { kind: 'melt', date: '2026-11-20', karat: 21, weightMg: 10_000, karatOut: 24, weightOutMg: 9_000 });
    expect(gains.statusCode).toBe(400);
    const melt = await postDoc({ kind: 'melt', date: '2026-11-20', karat: 21, weightMg: 10_000, karatOut: 24, weightOutMg: 8_600 });
    expect(melt.statusCode, melt.body).toBe(200);
    expect(melt.json().entryId).toBeNull();
    const stockNow = await ok('GET', '/api/gold/stock');
    expect(stockNow.byKarat.find((k: { karat: number }) => k.karat === 24)).toMatchObject({ scrapWeightMg: 8_600, scrapValue: 900_000, fineMg: 8_600 });
    expect(stockNow.byKarat.find((k: { karat: number }) => k.karat === 21)).toMatchObject({ scrapWeightMg: 0, scrapValue: 0, pieces: 1, piecesWeightMg: 5000 });

    // more than is owed is refused
    const over = await call('POST', '/api/gold/docs', { kind: 'delivery', date: '2026-11-20', partyId: supplierId, karat: 24, weightMg: 5_000 });
    const overPost = await call('POST', `/api/gold/docs/${over.json().id}/post`, {});
    expect(overPost.json().details).toEqual([expect.objectContaining({ code: 'gold_over_owed', owedMg: 4375 })]);
    await call('DELETE', `/api/gold/docs/${over.json().id}`);

    const delivery = await postDoc({ kind: 'delivery', date: '2026-11-20', partyId: supplierId, karat: 24, weightMg: 4_375 });
    expect(delivery.statusCode, delivery.body).toBe(200);
    // the gold owed (525,000) is settled with old gold that cost 900,000 × 4.375 / 8.6 = 457,849: a gain of 67,151
    expect(balanceOf('264')).toBe(0);
    expect(balanceOf('1378')).toBe(900_000 - 457_849);
    const gain = db.prepare(`SELECT SUM(l.base_credit) AS c FROM entry_lines l WHERE l.entry_id = ? AND l.account_code LIKE '49%'`).get(delivery.json().entryId) as { c: number };
    expect(Number(gain.c)).toBe(67_151);
    expect((await ok('GET', '/api/gold/suppliers'))[0]).toMatchObject({ fineMg: 0, value: 0 });

    // cancelling the delivery gives the gold owed back; then the melt can't be cancelled while the gold it made is used? it can: the delivery's gold is back
    const cancelled = await call('POST', `/api/gold/docs/${delivery.json().id}/cancel`, {});
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(balanceOf('264')).toBe(-525_000);
    expect(balanceOf('1378')).toBe(900_000);
    expect((await call('POST', `/api/gold/docs/${melt.json().id}/cancel`, {})).statusCode).toBe(200);
    expect((await ok('GET', '/api/gold/stock')).byKarat.find((k: { karat: number }) => k.karat === 21)).toMatchObject({ scrapWeightMg: 10_000, scrapValue: 900_000 });
    // old gold bought and already melted again can't be cancelled while the melt stands: here it was taken back, so it can
    expect((await call('POST', `/api/gold/docs/${buy.json().id}/cancel`, {})).statusCode).toBe(200);
    expect(balanceOf('1378')).toBe(0);
    expect(balanceOf('1811')).toBe(0);
  });

  it("puts the making charge on the supplier's statement, and refuses to cancel a receipt once gold was handed over against it (accounting review #2, #6)", async () => {
    await setUp();
    const ring2 = (await ok('POST', '/api/items', { code: 'RING-B', name: { ar: 'خاتم ب', en: 'Ring B', ku: 'ئەنگوستیلەی ب' }, unit: 'piece', salePrice: 0, saleCurrency: 'IQD' })).id;
    await ok('PUT', `/api/gold/items/${ring2}`, { weightMg: 5000, karat: 21, makingKind: 'gram', makingAmount: 5_000 });
    const a = (await postDoc({ kind: 'receipt', date: '2026-11-20', partyId: supplierId, warehouseId, pricePerGram: 100_000, lines: [{ itemId: ringId }] })).json();
    // the making charge (25,000) is owed to the supplier by name
    expect((await ok('GET', `/api/parties/${supplierId}`)).balance).toBe(25_000);
    const b = (await postDoc({ kind: 'receipt', date: '2026-11-20', partyId: supplierId, warehouseId, pricePerGram: 140_000, lines: [{ itemId: ring2, making: 0 }] })).json();
    void a;
    expect((await postDoc({ kind: 'buy', date: '2026-11-20', customerName: 'x', karat: 24, weightMg: 4375, pricePerGram: 110_000, cashAccount: '1811' })).statusCode).toBe(200);
    expect((await postDoc({ kind: 'delivery', date: '2026-11-20', partyId: supplierId, karat: 24, weightMg: 4375 })).statusCode).toBe(200);
    // undoing B now would leave gold owed of no weight but a value: refused, the delivery is cancelled first
    expect((await call('POST', `/api/gold/docs/${b.id}/cancel`, {})).json()).toMatchObject({ details: [{ code: 'gold_already_settled' }] });
  });

  it('refuses to cancel old gold that was melted, and posting by the preparer with separate duties on', async () => {
    await setUp();
    const buy = await postDoc({ kind: 'buy', date: '2026-11-20', customerName: 'Raz', karat: 18, weightMg: 4_000, pricePerGram: 70_000, cashAccount: '1811' });
    await postDoc({ kind: 'melt', date: '2026-11-20', karat: 18, weightMg: 4_000, karatOut: 24, weightOutMg: 2_900 });
    const r = await call('POST', `/api/gold/docs/${buy.json().id}/cancel`, {});
    expect(r.statusCode).toBe(400);
    expect(r.json().details).toEqual([expect.objectContaining({ code: 'gold_scrap_used', karat: 18 })]);

    writeSetting(db, 'separate_duties', '1');
    const draft = await ok('POST', '/api/gold/docs', { kind: 'buy', date: '2026-11-20', customerName: 'Raz', karat: 18, weightMg: 1_000, pricePerGram: 70_000, cashAccount: '1811' });
    const same = await call('POST', `/api/gold/docs/${draft.id}/post`, {});
    expect(same.statusCode).toBe(409);
    expect(same.json().error).toBe('same_person');
  });

  it('makes whoever rewrote a draft its preparer: with separate duties on, an approver can’t change it and post it himself (2.0 books review #3)', async () => {
    await setUp();
    writeSetting(db, 'separate_duties', '1');
    const k = await ok('POST', '/api/users', { username: 'kawa', name: 'Kawa', password: 'kawa-pass-123', roles: ['purchasing'] });
    const z = await ok('POST', '/api/users', { username: 'azad', name: 'Azad', password: 'azad-pass-123', roles: ['purchasing', 'approver'] });
    const kawa = { id: k.id, name: 'Kawa', username: 'kawa', roles: [], permissions: ['purchases'] } as unknown as Actor;
    const azad = { id: z.id, name: 'Azad', username: 'azad', roles: [], permissions: ['purchases', 'entries.approve'] } as unknown as Actor;
    const body = { kind: 'buy' as const, date: '2026-11-20', customerName: 'Raz', karat: 18 as const, weightMg: 1_000, pricePerGram: 70_000, cashAccount: '1811' };
    const draft = createGoldDoc(db, body, kawa);
    // Azad rewrites it to 100 g at 95,000 and tries to post it: it is his draft now
    updateGoldDoc(db, draft.id, { ...body, customerName: 'his cousin', weightMg: 100_000, pricePerGram: 95_000 }, azad);
    expect(() => postGoldDoc(db, draft.id, azad)).toThrowError(expect.objectContaining({ code: 'same_person' }));
    expect(balanceOf('1811')).toBe(0);
    // untouched by him, Kawa's draft is his to post
    const other = createGoldDoc(db, body, kawa);
    expect(postGoldDoc(db, other.id, azad).status).toBe('posted');
  });

  it('checks what a document needs, and keeps the entries it posts out of the vouchers page', async () => {
    await setUp();
    const bad = await call('POST', '/api/gold/docs', { kind: 'buy', date: '2026-11-20', karat: 21, weightMg: 1000, pricePerGram: 1, cashAccount: '261' });
    expect(bad.statusCode).toBe(400);
    const codes = bad.json().details.map((d: { code: string }) => d.code);
    expect(codes).toEqual(expect.arrayContaining(['gold_seller_required', 'gold_cash_account']));
    const notPiece = await call('POST', '/api/gold/docs', { kind: 'receipt', date: '2026-11-20', partyId: supplierId, warehouseId, pricePerGram: 1, lines: [{ itemId: 'nope' }] });
    expect(notPiece.json().details).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'gold_not_a_piece' })]));
    const buy = await postDoc({ kind: 'buy', date: '2026-11-20', customerName: 'Raz', karat: 21, weightMg: 1_000, pricePerGram: 90_000, cashAccount: '1811' });
    const del = await call('DELETE', `/api/entries/${buy.json().entryId}`);
    expect(del.statusCode).toBeGreaterThanOrEqual(400);
  });
});
