import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { setLicensePublicKeyForTests } from './license.ts';
import { resetLoginThrottle } from './auth.ts';

// Offers (1.7): buy X get Y, bundles and special prices, worked out by the server on the invoice screen and at the
// till, posted at the net amount, given back in proportion on returns, and reported per offer.
let db: Db;
let app: FastifyInstance;
let proKey: string;
let warehouseId: string;
let colaId: string;
let chipsId: string;
let drinksId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const put = (url: string, body: unknown = {}) => app.inject({ method: 'PUT', url, payload: body as object, headers });
const get = (url: string) => app.inject({ url, headers });
const del = (url: string) => app.inject({ method: 'DELETE', url, headers });
const TODAY = todayIso();

beforeAll(() => {
  const pair = generateKeyPairSync('ed25519');
  setLicensePublicKeyForTests(pair.publicKey.export({ format: 'jwk' }).x!);
  const body = `QASA1.${Buffer.from(JSON.stringify({ v: 1, id: 'QL-TEST-pro', plan: 'pro', to: 'Test Company', issued: '2026-01-01', expires: null })).toString('base64url')}`;
  proKey = `${body}.${sign(null, Buffer.from(body), pair.privateKey).toString('base64url')}`;
});

beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  const cat = await post('/api/item-categories', { code: 'DRK', name: { ar: 'مشروبات', en: 'Drinks', ku: 'خواردنەوە' } });
  expect(cat.statusCode, cat.body).toBe(201);
  drinksId = cat.json().id;
  // services (no stock), so sales need no purchases first
  colaId = (await post('/api/items', { code: 'COLA', name: { ar: 'كولا', en: 'Cola', ku: 'کۆلا' }, unit: 'service', salePrice: 1_000, saleCurrency: 'IQD', categoryId: drinksId })).json().id;
  chipsId = (await post('/api/items', { code: 'CHIPS', name: { ar: 'شيبس', en: 'Chips', ku: 'چیپس' }, unit: 'service', salePrice: 800, saleCurrency: 'IQD' })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

const licensed = async () => expect((await post('/api/plan/license', { key: proKey })).statusCode).toBe(200);
const buy2get1 = () => ({ code: 'B2G1', names: { ar: 'اشتر ٢ واحصل على ١', en: 'Buy 2 get 1', ku: '٢ بکڕە ١ وەربگرە' }, kind: 'buyGet', items: [colaId], buyMilli: 2000, getMilli: 1000, getPercent: 100 });
async function offer(body: object = {}) {
  const res = await post('/api/offers', { ...buy2get1(), ...body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}
const sale = (lines: object[], extra: object = {}) =>
  post('/api/invoices', { kind: 'sale', date: TODAY, warehouseId, currency: 'IQD', rateX100: 100, payment: 'cash', cashAccountCode: '1811', discount: 0, lines, ...extra });
const colas = (n: number) => ({ itemId: colaId, qtyMilli: n * 1000, unitPrice: 1_000 });

describe('offers: the plan and the list', () => {
  it('need Starter or above to be made or switched on; switching off never does', async () => {
    expect((await post('/api/offers', buy2get1())).json()).toMatchObject({ error: 'plan_limit', details: { limit: 'promotions' } });
    expect((await get('/api/offers')).json()).toMatchObject({ available: false, offers: [] });
    await licensed();
    const o = await offer();
    expect(o).toMatchObject({ code: 'B2G1', kind: 'buyGet', active: true, used: 0, getPercent: 100 });
    expect((await post(`/api/offers/${o.id}/active`, { active: false })).json().active).toBe(false);
    // checked: the goods, the hours, the code taken
    const bad = await post('/api/offers', { ...buy2get1(), items: ['nope'], fromTime: '09:00' });
    expect(bad.json().details.map((d: { code: string }) => d.code)).toEqual(expect.arrayContaining(['offer_hours_invalid', 'offer_target_invalid', 'offer_code_taken']));
  });
});

describe('offers on a sale invoice', () => {
  it('come off by themselves, beside the discount typed, and post at the net amount', async () => {
    await licensed();
    const o = await offer();
    const draft = await sale([colas(3), { itemId: chipsId, qtyMilli: 1000, unitPrice: 800 }], { discount: 100 });
    expect(draft.statusCode, draft.body).toBe(201);
    expect(draft.json()).toMatchObject({ subtotal: 3_800, discount: 1_100, offerDiscount: 1_000, total: 2_700 });
    expect(draft.json().offers).toEqual([expect.objectContaining({ offerId: o.id, code: 'B2G1', discount: 1_000 })]);
    expect(draft.json().lines[0]).toMatchObject({ offerDiscount: 1_000 });
    // saved again with what was typed: the offers are worked out again, never added twice
    const again = await put(`/api/invoices/${draft.json().id}`, { kind: 'sale', date: TODAY, warehouseId, currency: 'IQD', rateX100: 100, payment: 'cash', cashAccountCode: '1811', discount: 100, lines: [colas(3), { itemId: chipsId, qtyMilli: 1000, unitPrice: 800 }] });
    expect(again.json()).toMatchObject({ discount: 1_100, offerDiscount: 1_000, total: 2_700 });
    const posted = await post(`/api/invoices/${draft.json().id}/post`);
    expect(posted.statusCode, posted.body).toBe(200);
    expect(posted.json()).toMatchObject({ status: 'posted', total: 2_700 });
    const lines = db.prepare('SELECT account_code, debit, credit FROM entry_lines WHERE entry_id = ?').all(posted.json().entryId) as { account_code: string; debit: number; credit: number }[];
    expect(lines.find((l) => l.account_code === '1811')?.debit).toBe(2_700);
    expect(lines.reduce((s, l) => s + Number(l.credit), 0)).toBe(2_700);
    expect((await get(`/api/offers/${o.id}`)).json().used).toBe(1);
    expect((await del(`/api/offers/${o.id}`)).json()).toMatchObject({ error: 'offer_used' });
  });

  it('are worked out again when posted: an offer switched off since gives nothing', async () => {
    await licensed();
    const o = await offer();
    const draft = await sale([colas(3)]);
    expect(draft.json().total).toBe(2_000);
    await post(`/api/offers/${o.id}/active`, { active: false });
    const posted = await post(`/api/invoices/${draft.json().id}/post`);
    expect(posted.json()).toMatchObject({ total: 3_000, offerDiscount: 0, offers: [] });
    expect((await del(`/api/offers/${o.id}`)).statusCode).toBe(204);
  });

  it('are not put on a phone\'s draft sale (2.0: the phone showed its customer its own total), at posting either; saved on a PC, they are', async () => {
    await licensed();
    await offer();
    const body = { kind: 'sale', date: TODAY, warehouseId, currency: 'IQD', rateX100: 100, payment: 'cash', cashAccountCode: '1811', discount: 0, lines: [colas(3)] };
    // as the phone link sends it (pro/src/phone/phone.ts)
    const draft = await app.inject({ method: 'POST', url: '/api/invoices', payload: body, headers: { ...headers, 'x-qasa-phone': '1' } });
    expect(draft.statusCode, draft.body).toBe(201);
    expect(draft.json()).toMatchObject({ subtotal: 3_000, offerDiscount: 0, total: 3_000, offers: [] });
    const posted = await post(`/api/invoices/${draft.json().id}/post`);
    expect(posted.json()).toMatchObject({ status: 'posted', total: 3_000, offerDiscount: 0 });
    // a second one, opened and saved at the office: the offers apply, and whoever saved it sees the total
    const other = await app.inject({ method: 'POST', url: '/api/invoices', payload: body, headers: { ...headers, 'x-qasa-phone': '1' } });
    expect((await put(`/api/invoices/${other.json().id}`, body)).json()).toMatchObject({ offerDiscount: 1_000, total: 2_000 });
  });

  it('give nothing without the plan, and nothing on a back-dated sale for an offer limited to hours', async () => {
    await licensed();
    await offer({ fromTime: '00:00', toTime: '23:59' });
    expect((await sale([colas(3)], { date: '2026-01-05' })).json()).toMatchObject({ total: 3_000, offerDiscount: 0 });
    db.prepare("DELETE FROM settings WHERE key LIKE 'license%'").run();
    const plain = await sale([colas(3)]);
    expect(plain.json()).toMatchObject({ total: 3_000, offerDiscount: 0 });
  });

  it('are given back on a return in proportion to what comes back of each line', async () => {
    await licensed();
    await offer();
    const draft = await sale([colas(3), { itemId: chipsId, qtyMilli: 1000, unitPrice: 800 }]);
    const posted = await post(`/api/invoices/${draft.json().id}/post`);
    expect(posted.json().total).toBe(2_800);
    // one can back: a third of the cans' 3,000 less a third of their 1,000 off
    const ret = await post(`/api/invoices/${posted.json().id}/returns`, { date: TODAY, payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    expect(ret.statusCode, ret.body).toBe(201);
    expect(ret.json()).toMatchObject({ subtotal: 1_000, discount: 333, total: 667 });
    // the chips had no offer: back at their full price
    const chips = await post(`/api/invoices/${posted.json().id}/returns`, { date: TODAY, payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 2, qtyMilli: 1000 }] });
    expect(chips.json()).toMatchObject({ subtotal: 800, discount: 0, total: 800 });
    const report = (await get(`/api/offers/report?from=${TODAY}&to=${TODAY}`)).json();
    expect(report.rows).toEqual([expect.objectContaining({ code: 'B2G1', sales: 1, given: 1_000, returned: 333, net: 667 })]);
  });
});

describe('a free item with another (accounting review #4)', () => {
  it('spreads what is given over the set, so returning only what was bought gives back what it cost, not its full price', async () => {
    await licensed();
    // a can bought gives a bag of chips free
    await offer({ code: 'C1F', items: [colaId], getItems: [chipsId], buyMilli: 1000, getMilli: 1000 });
    const draft = await sale([colas(1), { itemId: chipsId, qtyMilli: 1000, unitPrice: 800 }]);
    const posted = await post(`/api/invoices/${draft.json().id}/post`);
    expect(posted.json()).toMatchObject({ total: 1_000, offerDiscount: 800 });
    // the 800 off is on both lines by value: 1,000 and 800 → 445 and 355
    const ret = await post(`/api/invoices/${posted.json().id}/returns`, { date: TODAY, payment: 'cash', cashAccountCode: '1811', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    expect(ret.statusCode, ret.body).toBe(201);
    expect(ret.json()).toMatchObject({ subtotal: 1_000, discount: 445, total: 555 });
    // the chips kept are paid for (445), never free with the can given back
  });
});

describe('offers at the till', () => {
  it('are in the till\'s list and preview, and the sale is paid at the server\'s figure', async () => {
    await licensed();
    await offer({ code: 'HALF', kind: 'price', items: [], categories: [drinksId], percentOff: 50, buyMilli: null, getMilli: null, getPercent: null });
    const till = (await get(`/api/offers/till?warehouseId=${warehouseId}`)).json();
    expect(till.offers.map((o: { code: string }) => o.code)).toEqual(['HALF']);
    const preview = (await post('/api/offers/preview', { warehouseId, currency: 'IQD', lines: [{ itemId: colaId, qtyMilli: 2000, amount: 2_000 }] })).json();
    expect(preview).toMatchObject({ total: 1_000, byLine: { 1: 1_000 } });
    const shift = (await post('/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId, openingCash: 0 })).json();
    const wrong = await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: colaId, qtyMilli: 2000, unitPrice: 1_000 }], payments: [{ method: 'cash', amount: 2_000 }] });
    expect(wrong.json()).toMatchObject({ error: 'validation', details: [{ code: 'payments_total_mismatch', total: 1_000 }] });
    const ok = await post(`/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: colaId, qtyMilli: 2000, unitPrice: 1_000 }], payments: [{ method: 'cash', amount: 1_000 }] });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().invoice).toMatchObject({ total: 1_000, offerDiscount: 1_000, offers: [expect.objectContaining({ code: 'HALF', discount: 1_000 })] });
    // the sales of the shift count after the offers
    const report = (await get(`/api/pos/shifts/${shift.id}`)).json();
    expect(report.items).toEqual([expect.objectContaining({ code: 'COLA', amount: expect.objectContaining({ IQD: 1_000 }) })]);
  });
});
