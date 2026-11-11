import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
const headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const call = async (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => {
  const r = await app.inject({ method, url, headers, ...(body !== undefined ? { payload: body as object } : {}) });
  expect(r.statusCode, `${url} ${r.body}`).toBeLessThan(300);
  return r.json();
};
const names = (en: string) => ({ ar: en, en, ku: en });

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await call('GET', '/api/warehouses'))[0].id;
});
afterEach(async () => {
  await app.close();
  db.close();
});

describe('low stock (1.1)', () => {
  it('lists items at or below their minimum — their own first, else their category\'s, else the parent category\'s — grouped by category and brand', async () => {
    const drinks = await call('POST', '/api/item-categories', { name: names('Drinks'), reorderMilli: 10_000 });
    const juice = await call('POST', '/api/item-categories', { name: names('Juice'), parentId: drinks.id });
    const tools = await call('POST', '/api/item-categories', { name: names('Tools') });
    const brand = await call('POST', '/api/brands', { name: 'Al Kabeer' });
    const item = (code: string, extra: object) => call('POST', '/api/items', { code, name: names(code), unit: 'piece', salePrice: 1_000, saleCurrency: 'IQD', ...extra });
    const water = await item('WATER', { categoryId: drinks.id });               // the category's 10
    const orange = await item('ORANGE', { categoryId: juice.id, brandId: brand.id }); // the parent's 10
    const tea = await item('TEA', { categoryId: drinks.id, reorderMilli: 2_000 });     // its own 2 wins
    await item('HAMMER', { categoryId: tools.id });                                     // no minimum at all
    const nails = await item('NAILS', { reorderMilli: 0 });                             // 0: only when none left
    await item('FIX', { unit: 'service', reorderMilli: 5_000 });                        // a service has no stock
    const doc = await call('POST', '/api/stock-docs', { kind: 'opening', date: '2026-10-01', warehouseId, counterAccountCode: '21', lines: [
      { itemId: water.id, qtyMilli: 10_000, unitCost: 100 }, { itemId: orange.id, qtyMilli: 25_000, unitCost: 100 }, { itemId: tea.id, qtyMilli: 3_000, unitCost: 100 }
    ] });
    await call('POST', `/api/stock-docs/${doc.id}/post`);
    const list = await call('GET', '/api/stock/reorder');
    expect(list.map((r: { code: string; reorderMilli: number; levelFrom: string; qtyMilli: number }) => [r.code, r.qtyMilli, r.reorderMilli, r.levelFrom]))
      .toEqual([['WATER', 10_000, 10_000, 'category'], ['NAILS', 0, 0, 'item']]);
    // the car-parts card and the item form set the same level
    await call('PUT', `/api/items/${orange.id}`, { name: names('ORANGE'), unit: 'piece', salePrice: 1_000, saleCurrency: 'IQD', reorderMilli: 30_000 });
    expect((await call('GET', '/api/stock/reorder')).map((r: { code: string }) => r.code)).toEqual(['WATER', 'ORANGE', 'NAILS']);
    // the daily brief's "running out" uses the same levels
    const brief = await call('GET', '/api/brief?date=2026-10-02');
    expect(brief.lowStock.map((r: { code: string }) => r.code).sort()).toEqual(['NAILS', 'ORANGE', 'WATER']);
    // one warehouse: the stock is that warehouse's
    await call('POST', '/api/plan/trial');
    const other = await call('POST', '/api/warehouses', { code: 'ERBIL', name: names('Erbil') });
    expect((await call('GET', `/api/stock/reorder?warehouseId=${other.id}`)).map((r: { code: string }) => r.code)).toEqual(['TEA', 'WATER', 'ORANGE', 'NAILS']);
    expect((await app.inject({ url: '/api/item-categories', method: 'POST', headers, payload: { name: names('Bad'), reorderMilli: -1 } })).statusCode).toBe(400);
  });
});
