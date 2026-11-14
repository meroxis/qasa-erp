import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { migrate, openDatabase, SCHEMA_VERSION, schemaVersion, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { MYSQL_TABLES, pendingMysqlSteps, V13_MYSQL_STEPS } from './schema-mysql.ts';

// The item form of 1.4: one name, the purchase price beside the sale price, the units a company uses, the market.
const onServer = !!process.env.QASA_TEST_DB;

let db: Db;
let app: FastifyInstance;

const headers = { 'x-qasa-user': encodeURIComponent('Mer') };
type Headers = Record<string, string>;
const post = (url: string, body: unknown = {}, h: Headers = headers) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const put = (url: string, body: unknown = {}, h: Headers = headers) => app.inject({ method: 'PUT', url, payload: body as object, headers: h });
const get = (url: string, h: Headers = headers) => app.inject({ url, headers: h });

const one = (text: string) => ({ ar: text, en: text, ku: text });
const item = (extra: object = {}) => ({ name: one('Rice 5 kg'), unit: 'piece', salePrice: 9_000, saleCurrency: 'IQD', ...extra });

beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('one name for an item', () => {
  it('keeps the text typed for every language, whichever one it was sent in', async () => {
    const made = await post('/api/items', item({ name: { ar: '', en: '', ku: 'برنج 5 کیلۆ' } }));
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json().name).toEqual(one('برنج 5 کیلۆ'));
    expect(db.prepare('SELECT name_ar, name_en, name_ku FROM items').get()).toEqual({ name_ar: 'برنج 5 کیلۆ', name_en: 'برنج 5 کیلۆ', name_ku: 'برنج 5 کیلۆ' });
    // an item with no name at all is still refused
    expect((await post('/api/items', item({ name: one('  ') }))).json().details).toContainEqual({ code: 'name_required' });
  });

  it('keeps a text per language where an item has them, and fills only the empty ones on a change', async () => {
    const id = (await post('/api/items', item({ name: { ar: 'رز', en: 'Rice', ku: 'برنج' } }))).json().id;
    expect((await get(`/api/items/${id}`)).json().name).toEqual({ ar: 'رز', en: 'Rice', ku: 'برنج' });
    const changed = await put(`/api/items/${id}`, item({ name: { ar: 'رز بسمتي', en: 'Rice', ku: '' } }));
    expect(changed.json().name).toEqual({ ar: 'رز بسمتي', en: 'Rice', ku: 'رز بسمتي' });
  });
});

describe('the purchase price beside the sale price', () => {
  it('is kept with its currency, stays when a change leaves it out, and is cleared by null', async () => {
    const made = await post('/api/items', item({ purchasePrice: 550, purchaseCurrency: 'USD' }));
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json()).toMatchObject({ purchasePrice: 550, purchaseCurrency: 'USD', salePrice: 9_000, saleCurrency: 'IQD' });
    const id = made.json().id;
    // a change that says nothing about it (an older screen) keeps it
    expect((await put(`/api/items/${id}`, item({ salePrice: 9_500 }))).json()).toMatchObject({ purchasePrice: 550, purchaseCurrency: 'USD', salePrice: 9_500 });
    // a price with no currency is in the sale currency
    expect((await put(`/api/items/${id}`, item({ purchasePrice: 7_000 }))).json()).toMatchObject({ purchasePrice: 7_000, purchaseCurrency: 'IQD' });
    expect((await put(`/api/items/${id}`, item({ purchasePrice: null }))).json()).toMatchObject({ purchasePrice: null, purchaseCurrency: 'IQD' });
    expect(db.prepare('SELECT purchase_price, purchase_currency FROM items WHERE id = ?').get(id)).toEqual({ purchase_price: null, purchase_currency: null });
  });

  it('refuses a price that is not a whole, non-negative amount, and a currency it does not know', async () => {
    expect((await post('/api/items', item({ purchasePrice: -1 }))).statusCode).toBe(400);
    expect((await post('/api/items', item({ purchasePrice: 1.5 }))).statusCode).toBe(400);
    expect((await post('/api/items', item({ purchasePrice: 100, purchaseCurrency: 'EUR' }))).statusCode).toBe(400);
    expect((await get('/api/items')).json()).toEqual([]);
  });

  it('is not told to someone who only sells; the stock keeper and the buyer see it', async () => {
    const id = (await post('/api/items', item({ barcode: '6260001000003', purchasePrice: 7_000 }))).json().id;
    const ownerId = (db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string }).id;
    await post(`/api/users/${ownerId}/password`, { password: 'owner-pass-1' });
    // more than one user needs a paid plan: the free month
    expect((await post('/api/plan/trial')).statusCode).toBe(200);
    for (const [username, name, roles] of [['las', 'Las', ['sales']], ['raz', 'Raz', ['storekeeper']]] as const) {
      const made = await post('/api/users', { username, name, roles, password: `${username}-pass-1` });
      expect(made.statusCode, made.body).toBe(201);
    }
    expect((await put('/api/auth/signin', { on: true })).statusCode).toBe(200);
    const login = async (username: string) => {
      const res = await post('/api/auth/login', { username, password: `${username}-pass-1` }, {});
      expect(res.statusCode, res.body).toBe(200);
      return { cookie: String(res.headers['set-cookie']).split(';')[0]! };
    };
    const cashier = await login('las');
    const keeper = await login('raz');
    for (const url of [`/api/items/${id}`, '/api/items', '/api/items?barcode=6260001000003']) {
      const seen = (await get(url, cashier)).json();
      const view = Array.isArray(seen) ? seen[0] : seen.item ?? seen;
      expect(view.salePrice, url).toBe(9_000);
      expect('purchasePrice' in view, url).toBe(false);
      expect('purchaseCurrency' in view, url).toBe(false);
    }
    expect((await get(`/api/items/${id}`, keeper)).json()).toMatchObject({ purchasePrice: 7_000, purchaseCurrency: 'IQD' });
    // the cashier may not change items at all
    expect((await put(`/api/items/${id}`, item({ purchasePrice: 1 }), cashier)).statusCode).toBe(403);
  });
});

describe('the units a company uses', () => {
  it('lists the base units and other units of its items, each once', async () => {
    expect((await get('/api/item-units/used')).json()).toEqual([]);
    await post('/api/items', item({ unit: 'kg' }));
    await post('/api/items', item({ unit: 'piece', units: [{ unit: 'carton', factorMilli: 24_000 }, { unit: 'pack', factorMilli: 6_000 }] }));
    await post('/api/items', item({ unit: 'piece' }));
    expect((await get('/api/item-units/used')).json()).toEqual(['carton', 'kg', 'pack', 'piece']);
  });

  it('saves a bigger unit with what it holds, gives it back on the item and offers it to a sale line', async () => {
    const made = await post('/api/items', item({ units: [{ unit: 'carton', factorMilli: 24_000, barcode: '6260001000201', salePrice: 200_000 }], saleUnit: 'carton' }));
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json().id;
    const again = (await get(`/api/items/${id}`)).json();
    expect(again.units).toEqual([{ unit: 'carton', factorMilli: 24_000, barcode: '6260001000201', salePrice: 200_000 }]);
    expect(again.saleUnit).toBe('carton');
    // the carton's own barcode finds the item in that unit
    expect((await get('/api/items?barcode=6260001000201')).json()).toMatchObject({ unit: 'carton', item: { id } });
  });
});

describe('a market or supermarket', () => {
  it('is a business type of its own, on every plan, and starts new items with expiry dates', async () => {
    expect((await get('/api/batches/settings')).json()).toMatchObject({ defaultTrackExpiry: false });
    const saved = await put('/api/settings', { businessTypes: ['trade', 'market'] });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().businessTypes).toEqual(['trade', 'market']);
    expect((await get('/api/batches/settings')).json()).toMatchObject({ defaultTrackExpiry: true });
    const made = (await post('/api/items', item({ unit: 'kg' }))).json();
    expect(made).toMatchObject({ unit: 'kg', trackExpiry: true, trackBatches: true });
  });
});

describe.skipIf(onServer)('a company file from schema 12 opened by schema 13', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qasa-v13-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('keeps its items, with no purchase price until one is written', () => {
    const file = join(dir, 'books.sqlite');
    const old = new DatabaseSync(file);
    migrate(old as unknown as Db, 12);
    old.prepare(`INSERT INTO items (id, code, name_ar, name_en, name_ku, unit, sale_price, sale_currency, created_at)
                 VALUES ('i1', 'I-0001', 'رز', 'Rice', 'برنج', 'kg', 2500, 'IQD', '2026-11-01T00:00:00Z')`).run();
    old.close();
    const opened = openDatabase(file);
    try {
      expect(schemaVersion(opened)).toBe(SCHEMA_VERSION);
      expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(13);
      expect(opened.prepare('SELECT name_ar, name_en, name_ku, sale_price, purchase_price, purchase_currency FROM items').all())
        .toEqual([{ name_ar: 'رز', name_en: 'Rice', name_ku: 'برنج', sale_price: 2500, purchase_price: null, purchase_currency: null }]);
      expect(() => opened.prepare("UPDATE items SET purchase_price = -1 WHERE id = 'i1'").run()).toThrow();
      expect(() => opened.prepare("UPDATE items SET purchase_price = 1, purchase_currency = 'EUR' WHERE id = 'i1'").run()).toThrow();
    } finally {
      opened.close();
    }
  });

  it('adds the same two columns to a server database, once', () => {
    const items = MYSQL_TABLES.find((t) => t.name === 'items')!.sql;
    expect(items).toContain('purchase_price BIGINT');
    expect(items).toContain('purchase_currency');
    expect(pendingMysqlSteps(V13_MYSQL_STEPS, { columns: new Set(), foreignKeys: new Set() })).toHaveLength(2);
    expect(pendingMysqlSteps(V13_MYSQL_STEPS, { columns: new Set(['items.purchase_price', 'items.purchase_currency']), foreignKeys: new Set() })).toEqual([]);
  });
});
