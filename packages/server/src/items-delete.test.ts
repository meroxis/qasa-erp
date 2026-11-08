import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { errorResponse } from './routes.ts';
import { toBase64 } from './media.ts';

let db: Db;
let app: FastifyInstance;
let itemId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) =>
  app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body as object }) });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  itemId = (await send('POST', '/api/items', { code: 'P-1', name: { ar: 'فلتر زيت', en: 'Oil filter', ku: 'فلتەری زەیت' }, unit: 'piece', salePrice: 15000, saleCurrency: 'IQD' })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE item_id = ?`).get(itemId) as { n: number }).n;

describe('deleting an item', () => {
  it('takes its picture and its wholesale price with it, instead of failing with a server error', async () => {
    expect((await send('PUT', `/api/items/${itemId}/image`, { data: toBase64(PNG) })).statusCode).toBe(200);
    expect((await send('PUT', `/api/prices/item/${itemId}`, { wholesale: 12_000 })).statusCode).toBe(200);
    expect([count('item_images'), count('item_prices')]).toEqual([1, 1]);
    const res = await send('DELETE', `/api/items/${itemId}`);
    expect(res.statusCode, res.body).toBe(204);
    expect([count('item_images'), count('item_prices')]).toEqual([0, 0]);
    expect((await send('GET', `/api/items/${itemId}`)).statusCode).toBe(404);
  });

  it('refuses an item a quotation still names, and keeps everything', async () => {
    const customer = (await send('POST', '/api/parties', { type: 'customer', name: 'Raz' })).json().id;
    const q = await send('POST', '/api/quotes', {
      date: '2026-11-01', validUntil: '2026-11-15', partyId: customer, currency: 'IQD', discount: 0,
      lines: [{ itemId, description: '', qtyMilli: 1000, unitPrice: 15_000 }]
    });
    expect(q.statusCode, q.body).toBe(201);
    await send('PUT', `/api/items/${itemId}/image`, { data: toBase64(PNG) });
    const res = await send('DELETE', `/api/items/${itemId}`);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().error).toBe('item_in_use');
    expect(count('item_images')).toBe(1);
    expect((await send('GET', `/api/items/${itemId}`)).statusCode).toBe(200);
  });
});

describe('a delete the database refuses', () => {
  it('answers 409 in_use, not a server error', () => {
    let caught: unknown;
    try {
      db.prepare("INSERT INTO item_prices (item_id, list, price) VALUES ('no-such-item', 'wholesale', 1)").run();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(errorResponse(caught)).toEqual({ status: 409, body: { error: 'in_use', details: null } });
    expect(errorResponse(new Error('something else'))).toEqual({ status: 500, body: { error: 'internal', details: null } });
  });

  it('answers the same on MySQL and MariaDB, for a delete of a row in use and a row pointing at one that is not there', () => {
    const serverError = (code: string, errno: number) => Object.assign(new Error(`${code}: Cannot add or update a child row`), { code, errno });
    for (const e of [serverError('ER_ROW_IS_REFERENCED_2', 1451), serverError('ER_NO_REFERENCED_ROW_2', 1452)]) {
      expect(errorResponse(e)).toEqual({ status: 409, body: { error: 'in_use', details: null } });
    }
  });
});
