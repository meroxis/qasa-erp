import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { writeSetting } from './settings.ts';
import { priceFor, pricesApi } from './prices.ts';

let db: Db;
let app: FastifyInstance;
let shopId: string;
let garageId: string;
let supplierId: string;
let filterId: string;
let usdId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer') };
const post = (url: string, body: unknown = {}, h: Record<string, string> = headers) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const put = (url: string, body: unknown = {}, h: Record<string, string> = headers) => app.inject({ method: 'PUT', url, payload: body as object, headers: h });
const get = (url: string, h: Record<string, string> = headers) => app.inject({ url, headers: h });

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  shopId = (await post('/api/parties', { type: 'customer', name: 'Walk-in' })).json().id;
  garageId = (await post('/api/parties', { type: 'customer', name: 'Ali Garage' })).json().id;
  supplierId = (await post('/api/parties', { type: 'supplier', name: 'Parts Co' })).json().id;
  filterId = (await post('/api/items', { code: 'OF-1', name: { ar: 'فلتر زيت', en: 'Oil filter', ku: 'فلتەری ڕۆن' }, unit: 'piece', salePrice: 12_000, saleCurrency: 'IQD' })).json().id;
  usdId = (await post('/api/items', { code: 'BAT-70', name: { ar: 'بطارية', en: 'Battery 70A', ku: 'پاتری' }, unit: 'piece', salePrice: 9_000, saleCurrency: 'USD' })).json().id;
  writeSetting(db, 'default_rate_x100', '150000');
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('price lists', () => {
  it('gives retail by default, wholesale from item_prices, then the parts card, then retail', async () => {
    expect(priceFor(db, filterId, shopId)).toMatchObject({ price: 12_000, list: 'retail', source: 'retail', currency: 'IQD' });
    expect((await put(`/api/prices/party/${garageId}`, { list: 'wholesale' })).json()).toEqual({ partyId: garageId, list: 'wholesale' });
    // wholesale customer but no wholesale price anywhere: retail
    expect(priceFor(db, filterId, garageId)).toMatchObject({ price: 12_000, list: 'wholesale', source: 'retail' });
    // the car-parts card
    db.prepare('INSERT INTO part_details (item_id, wholesale_price, updated_at) VALUES (?, ?, ?)').run(filterId, 10_000, new Date().toISOString());
    expect(priceFor(db, filterId, garageId)).toMatchObject({ price: 10_000, source: 'part_details' });
    // the item's own wholesale price wins
    expect((await put(`/api/prices/item/${filterId}`, { wholesale: 9_500 })).json()).toMatchObject({ retail: 12_000, wholesale: 9_500, partsWholesale: 10_000, currency: 'IQD' });
    expect(priceFor(db, filterId, garageId)).toMatchObject({ price: 9_500, source: 'item_prices' });
    // retail customers and no customer still pay retail
    expect(priceFor(db, filterId, shopId).price).toBe(12_000);
    expect(priceFor(db, filterId, null).price).toBe(12_000);
    // clearing falls back again
    await put(`/api/prices/item/${filterId}`, { wholesale: null });
    expect(priceFor(db, filterId, garageId).source).toBe('part_details');
    await put(`/api/prices/party/${garageId}`, { list: 'retail' });
    expect(priceFor(db, filterId, garageId).list).toBe('retail');
  });

  it('converts to the invoice currency at the default rate', async () => {
    expect((await get(`/api/prices?itemId=${usdId}&currency=IQD`)).json()).toMatchObject({ price: 135_000, currency: 'IQD', converted: true });
    expect((await get(`/api/prices?itemId=${filterId}&partyId=${shopId}&currency=USD`)).json()).toMatchObject({ price: 800, currency: 'USD' });
    expect((await get(`/api/prices?itemId=${usdId}`)).json()).toMatchObject({ price: 9_000, currency: 'USD', converted: false });
  });

  it('checks what it is given', async () => {
    expect((await put(`/api/prices/party/${supplierId}`, { list: 'wholesale' })).json().details).toEqual([{ code: 'price_list_customers_only' }]);
    expect((await put(`/api/prices/party/${garageId}`, { list: 'vip' })).statusCode).toBe(400);
    expect((await put(`/api/prices/item/${filterId}`, { wholesale: -5 })).json().details).toEqual([{ code: 'price_invalid' }]);
    expect((await get('/api/prices?itemId=nope')).statusCode).toBe(404);
    expect((await get('/api/prices')).statusCode).toBe(400);
  });

  it('needs sales for a customer list and stock for an item price', async () => {
    writeSetting(db, 'trial_started', new Date().toISOString().slice(0, 10));
    const owner = (await get('/api/users')).json()[0].id;
    await post(`/api/users/${owner}/password`, { password: 'owner-pass-1' });
    await post('/api/users', { username: 'sara', name: 'Sara', roles: ['sales'], password: 'sara-pass-1' });
    await post('/api/users', { username: 'kawa', name: 'Kawa', roles: ['storekeeper'], password: 'kawa-pass-1' });
    expect((await app.inject({ method: 'PUT', url: '/api/auth/signin', payload: { on: true }, headers })).statusCode).toBe(200);
    const signIn = async (username: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: `${username}-pass-1` }, headers: { 'x-qasa-client': '1' } });
      expect(res.statusCode, res.body).toBe(200);
      return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    };
    const sara = await signIn('sara');
    const kawa = await signIn('kawa');
    expect((await put(`/api/prices/party/${garageId}`, { list: 'wholesale' }, kawa)).statusCode).toBe(403);
    expect((await put(`/api/prices/party/${garageId}`, { list: 'wholesale' }, sara)).statusCode).toBe(200);
    expect((await put(`/api/prices/item/${filterId}`, { wholesale: 9_000 }, sara)).statusCode).toBe(403);
    expect((await put(`/api/prices/item/${filterId}`, { wholesale: 9_000 }, kawa)).statusCode).toBe(200);
    expect((await get(`/api/prices?itemId=${filterId}&partyId=${garageId}`, sara)).json().price).toBe(9_000);
    expect((await get(`/api/prices?itemId=${filterId}`)).statusCode).toBe(401);
  });
});
