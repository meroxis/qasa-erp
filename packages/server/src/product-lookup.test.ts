import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '@qasa/core';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { MAX_IMAGE_BYTES } from './media.ts';
import {
  allowedUrl, bulkFinished, BULK_PACE_MS, configureProductLookup, LOOKUP_HOSTS, LOOKUP_READS_PER_MINUTE, LOOKUP_USER_AGENT, nameSuggestions, plainText,
  readProductAnswer, resetProductLookup
} from './product-lookup.ts';

// No test talks to the internet: the answers are the ones recorded in fixtures/product-lookup (see its README), given
// back by a network of the test's own, which also writes down every request the server made.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/product-lookup/${name}`, import.meta.url), 'utf8');
const COKE = '5449000000996';
const CREAM = '8410757001090';
const UNKNOWN = '3600523951369';
const FOOD = 'https://world.openfoodfacts.org/api/v2/product/';
const BEAUTY = 'https://world.openbeautyfacts.org/api/v2/product/';
const COKE_400 = 'https://images.openfoodfacts.org/images/products/544/900/000/0996/front_en.1129.400.jpg';
const COKE_200 = 'https://images.openfoodfacts.org/images/products/544/900/000/0996/front_en.1129.200.jpg';
const CREAM_400 = 'https://images.openbeautyfacts.org/images/products/841/075/700/1090/front_en.26.400.jpg';

/** bytes that begin as a JPEG does, `size` long */
const jpeg = (size = 2000) => { const b = new Uint8Array(size).fill(7); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

type Answer = { status?: number; type?: string; body?: string | Uint8Array; headers?: Record<string, string> } | 'down';
interface Call { url: string; headers: Record<string, string>; redirect: string | undefined }
let calls: Call[];
let net: Map<string, Answer>;
let clock: number;
let slept: number[];

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), redirect: init?.redirect });
  const answer = net.get(url.split('?')[0]!);
  if (!answer || answer === 'down') throw new TypeError('fetch failed');
  const body = answer.body ?? '';
  return new Response(typeof body === 'string' ? body : Buffer.from(body), { status: answer.status ?? 200, headers: { 'content-type': answer.type ?? 'application/json; charset=utf-8', ...(answer.headers ?? {}) } });
}) as typeof fetch;

function usualNet(): void {
  net = new Map<string, Answer>([
    [FOOD + COKE, { body: fixture(`found-${COKE}.json`) }],
    [FOOD + UNKNOWN, { status: 404, body: fixture(`not-found-${UNKNOWN}.json`) }],
    [FOOD + CREAM, { status: 404, body: fixture(`elsewhere-${CREAM}.json`) }],
    [BEAUTY + CREAM, { body: fixture(`found-beauty-${CREAM}.json`) }],
    [COKE_400, { type: 'image/jpeg', body: jpeg() }],
    [COKE_200, { type: 'image/jpeg', body: jpeg(500) }],
    [CREAM_400, { type: 'image/png', body: PNG }]
  ]);
}

let db: Db;
let app: FastifyInstance;
type Headers = Record<string, string>;
const headers: Headers = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, h: Headers = headers) =>
  app.inject({ method, url, headers: h, ...(body === undefined ? {} : { payload: body as object }) });
const lookup = async (barcode: string, h: Headers = headers) => (await send('POST', '/api/items/lookup', { barcode }, h)).json();
const switchOn = async () => { expect((await send('PUT', '/api/items/lookup/settings', { enabled: true })).statusCode).toBe(200); };
const addItem = async (en: string, barcode?: string) =>
  (await send('POST', '/api/items', { name: { ar: en, en, ku: en }, unit: 'piece', salePrice: 1000, saleCurrency: 'IQD', trackStock: false, ...(barcode ? { barcode } : {}) })).json() as { id: string };
const reads = () => calls.filter((c) => c.url.includes('/api/v2/product/'));
const count = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);

beforeEach(() => {
  resetLoginThrottle();
  resetProductLookup();
  calls = [];
  slept = [];
  clock = Date.parse('2026-11-23T10:00:00Z');
  usualNet();
  // waiting is not waited in tests: the clock just moves on
  configureProductLookup({ fetch: fakeFetch, now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; }, server: true });
  db = openDatabase(':memory:');
  app = buildApp(db);
});
afterEach(async () => {
  await bulkFinished(db);
  resetProductLookup();
  await app.close();
  db.close();
});

describe('reading what a database answered (the recorded answers)', () => {
  it('a product found: its names, brand, size, both pictures and its page', () => {
    const answer = readProductAnswer('openfoodfacts', COKE, 200, fixture(`found-${COKE}.json`));
    expect(answer).toEqual({
      kind: 'found',
      row: {
        barcode: COKE, found: true, source: 'openfoodfacts', name: 'Coca-Cola Original', nameAr: 'كوكاكولا', nameEn: 'Coca-Cola', nameKu: null,
        brand: 'COCA-COLA SERVICES SA/NV', quantity: '330 ml', imageUrl: COKE_400, imageSmallUrl: COKE_200, pageUrl: `https://world.openfoodfacts.org/product/${COKE}`
      }
    });
    if (answer.kind !== 'found') throw new Error('not found');
    expect(nameSuggestions(answer.row)).toEqual([
      { lang: 'ar', text: 'كوكاكولا' }, { lang: 'en', text: 'Coca-Cola' }, { lang: 'en', text: 'Coca-Cola Original' }, { lang: 'ar', text: 'كوكاكولا 330 ml' }
    ]);
  });

  it('not found, and found in a sister project', () => {
    expect(readProductAnswer('openfoodfacts', UNKNOWN, 404, fixture(`not-found-${UNKNOWN}.json`))).toEqual({ kind: 'not_found' });
    expect(readProductAnswer('openfoodfacts', CREAM, 404, fixture(`elsewhere-${CREAM}.json`))).toEqual({ kind: 'elsewhere', source: 'openbeautyfacts' });
    const beauty = readProductAnswer('openbeautyfacts', CREAM, 200, fixture(`found-beauty-${CREAM}.json`));
    expect(beauty).toMatchObject({ kind: 'found', row: { source: 'openbeautyfacts', name: 'Crema Manos', nameAr: null, imageUrl: CREAM_400, pageUrl: `https://world.openbeautyfacts.org/product/${CREAM}` } });
  });

  it('what is no answer is unreadable; a page with neither a name nor a picture is not found', () => {
    expect(readProductAnswer('openfoodfacts', COKE, 200, '<html>')).toEqual({ kind: 'unreadable' });
    expect(readProductAnswer('openfoodfacts', COKE, 500, '{"status":1,"product":{"product_name":"x"}}')).toEqual({ kind: 'unreadable' });
    expect(readProductAnswer('openfoodfacts', COKE, 200, '[]')).toEqual({ kind: 'unreadable' });
    expect(readProductAnswer('openfoodfacts', COKE, 200, '{"status":1,"product":{"brands":"x"}}')).toEqual({ kind: 'not_found' });
  });

  it('a picture address outside their picture hosts is dropped; text is made plain and short', () => {
    const body = JSON.stringify({ status: 1, product: {
      product_name: '  Tea‮\u0000  <b>bags</b>\n' + 'x'.repeat(300), brands: 'One, Two',
      image_front_url: 'https://images.openfoodfacts.org.evil.example/a.jpg', image_front_small_url: 'http://images.openfoodfacts.org/a.jpg'
    } });
    const answer = readProductAnswer('openfoodfacts', COKE, 200, body);
    if (answer.kind !== 'found') throw new Error('not found');
    expect(answer.row.imageUrl).toBeNull();
    expect(answer.row.imageSmallUrl).toBeNull();
    expect(answer.row.brand).toBe('One');
    expect(answer.row.name!.startsWith('Tea <b>bags</b> xxx')).toBe(true);
    expect([...answer.row.name!].length).toBeLessThanOrEqual(120);
    expect(plainText('کتێبی‌نوێ')).toBe('کتێبی‌نوێ');
    expect(plainText(42)).toBeNull();
    expect(plainText(' \n ')).toBeNull();
  });
});

describe('the addresses the lookup may talk to', () => {
  it('only the four databases and their picture hosts, over https, without a user or a port', () => {
    expect([...LOOKUP_HOSTS].sort()).toEqual([
      'images.openbeautyfacts.org', 'images.openfoodfacts.org', 'images.openpetfoodfacts.org', 'images.openproductsfacts.org',
      'world.openbeautyfacts.org', 'world.openfoodfacts.org', 'world.openpetfoodfacts.org', 'world.openproductsfacts.org'
    ]);
    expect(allowedUrl('https://world.openfoodfacts.org/api/v2/product/1', LOOKUP_HOSTS)).not.toBeNull();
    for (const bad of [
      'http://world.openfoodfacts.org/x', 'https://world.openfoodfacts.org.evil.example/x', 'https://evil.example/world.openfoodfacts.org', 'https://user:pw@world.openfoodfacts.org/x',
      'https://world.openfoodfacts.org:8443/x', 'https://127.0.0.1/x', 'https://localhost/x', 'file:///etc/passwd', 'https://world.openfoodfacts.net/x', 'not an address'
    ]) expect(allowedUrl(bad, LOOKUP_HOSTS), bad).toBeNull();
  });
});

describe('the setting', () => {
  it('is off until an admin switches it on, and off means no request at all', async () => {
    expect((await send('GET', '/api/items/lookup/settings')).json()).toEqual({ enabled: false, asked: false, available: true });
    expect(await lookup(COKE)).toEqual({ found: false, reason: 'off' });
    expect((await send('POST', '/api/items/lookup/bulk')).json()).toMatchObject({ running: false, ended: 'off' });
    expect(calls).toEqual([]);
    expect(count('SELECT COUNT(*) AS n FROM product_lookups')).toBe(0);
  });

  it('“not now” is an answer too: the question is not put again, and nothing is asked', async () => {
    expect((await send('PUT', '/api/items/lookup/settings', { enabled: false })).json()).toEqual({ enabled: false, asked: true, available: true });
    expect(await lookup(COKE)).toEqual({ found: false, reason: 'off' });
    expect(calls).toEqual([]);
  });

  it('where there is no server to ask from (the website demo) it can’t be on', async () => {
    await switchOn();
    configureProductLookup({ server: false });
    expect((await send('GET', '/api/items/lookup/settings')).json()).toEqual({ enabled: false, asked: true, available: false });
    expect(await lookup(COKE)).toEqual({ found: false, reason: 'off' });
    expect(calls).toEqual([]);
  });
});

describe('looking a barcode up', () => {
  beforeEach(switchOn);

  it('finds the names and the picture, and sends nothing but the barcode', async () => {
    const result = await lookup(COKE);
    expect(result).toEqual({
      found: true, source: 'openfoodfacts', brand: 'COCA-COLA SERVICES SA/NV', quantity: '330 ml', licence: 'CC BY-SA 3.0', pageUrl: `https://world.openfoodfacts.org/product/${COKE}`,
      names: [{ lang: 'ar', text: 'كوكاكولا' }, { lang: 'en', text: 'Coca-Cola' }, { lang: 'en', text: 'Coca-Cola Original' }, { lang: 'ar', text: 'كوكاكولا 330 ml' }],
      image: { mime: 'image/jpeg', data: Buffer.from(jpeg()).toString('base64') }
    });
    expect(calls.map((c) => c.url)).toEqual([
      `${FOOD}${COKE}?fields=code,product_name,product_name_ar,product_name_en,product_name_ku,product_name_ckb,brands,quantity,image_front_url,image_front_small_url`,
      COKE_400
    ]);
    for (const c of calls) {
      // who is asking is the app, by name and version, with a contact: nothing of the company or the user
      expect(c.headers).toEqual({ 'user-agent': LOOKUP_USER_AGENT, accept: expect.any(String) });
      expect(c.redirect).toBe('manual');
      expect(c.url).not.toMatch(/Mer|company|user/i);
    }
    expect(LOOKUP_USER_AGENT).toBe(`QasaERP/${APP_VERSION} (info@qasaerp.com; https://qasaerp.com)`);
    // nothing is stored for any item: only the answer is kept
    expect(count('SELECT COUNT(*) AS n FROM item_images')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM item_image_sources')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM product_lookups')).toBe(1);
  });

  it('a product kept by a sister project is asked for there', async () => {
    const result = await lookup(CREAM);
    expect(result).toMatchObject({ found: true, source: 'openbeautyfacts', names: [{ lang: 'en', text: 'Crema Manos' }, { lang: 'en', text: 'Crema Manos 150 ml' }], image: { mime: 'image/png' } });
    expect(calls.map((c) => c.url.split('?')[0])).toEqual([FOOD + CREAM, BEAUTY + CREAM, CREAM_400]);
  });

  it('the shop’s own codes are never sent: a scale’s label, the 04 range, short codes, a wrong check digit', async () => {
    for (const code of ['2100017012503', '2100017', '0400000000176', '12345', '5449000000997', 'TEA-1', '']) {
      const res = await send('POST', '/api/items/lookup', { barcode: code });
      if (code) expect(res.json(), code).toEqual({ found: false, reason: 'own' });
      else expect(res.statusCode).toBe(400);
    }
    expect(calls).toEqual([]);
    expect(count('SELECT COUNT(*) AS n FROM product_lookups')).toBe(0);
  });

  it('an answer is kept: the same barcode is not asked twice, a “not found” for a week, a product for a month', async () => {
    expect(await lookup(UNKNOWN)).toEqual({ found: false, reason: 'not_found' });
    expect(await lookup(UNKNOWN)).toEqual({ found: false, reason: 'not_found' });
    expect((await lookup(COKE)).found).toBe(true);
    expect((await lookup(COKE)).found).toBe(true);
    expect(reads().map((c) => c.url.split('?')[0])).toEqual([FOOD + UNKNOWN, FOOD + COKE]);
    // the picture itself is not kept: it is fetched again from their picture host
    expect(calls.filter((c) => c.url === COKE_400)).toHaveLength(2);
    clock += 8 * 86_400_000;
    await lookup(UNKNOWN);
    await lookup(COKE);
    expect(reads()).toHaveLength(3);
    clock += 23 * 86_400_000;
    await lookup(COKE);
    expect(reads()).toHaveLength(4);
  });

  it('two forms asking about one barcode at once make one request', async () => {
    const [a, b] = await Promise.all([lookup(COKE), lookup(COKE)]);
    expect(a.found && b.found).toBe(true);
    expect(reads()).toHaveLength(1);
  });

  it(`asks at most ${LOOKUP_READS_PER_MINUTE} times a minute (theirs is 15): past that it says so and sends nothing`, async () => {
    const codes = ['4006381333931', '4006381333948', '4006381333955', '4006381333962', '4006381333979', '4006381333986', '4006381333993', '4006381334006', '4006381334013', '4006381334020', '4006381334037'];
    for (const code of codes.slice(0, 10)) expect(await lookup(code), code).toEqual({ found: false, reason: 'unreachable' });
    expect(reads()).toHaveLength(10);
    expect(await lookup(codes[10]!)).toEqual({ found: false, reason: 'busy' });
    expect(reads()).toHaveLength(10);
    // and for the whole server: another company on the same address shares the minute
    const other = openDatabase(':memory:');
    const otherApp = buildApp(other);
    try {
      await otherApp.inject({ method: 'PUT', url: '/api/items/lookup/settings', headers, payload: { enabled: true } });
      expect((await otherApp.inject({ method: 'POST', url: '/api/items/lookup', headers, payload: { barcode: COKE } })).json()).toEqual({ found: false, reason: 'busy' });
    } finally {
      await otherApp.close();
      other.close();
    }
    clock += 61_000;
    expect((await lookup(COKE)).found).toBe(true);
  });

  it('no internet, a slow or broken answer: nothing found, nothing kept, no error', async () => {
    net.set(FOOD + COKE, 'down');
    const res = await send('POST', '/api/items/lookup', { barcode: COKE });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ found: false, reason: 'unreachable' });
    net.set(FOOD + COKE, { status: 503, type: 'text/html', body: '<html>busy</html>' });
    expect(await lookup(COKE)).toEqual({ found: false, reason: 'unreachable' });
    net.set(FOOD + COKE, { body: 'x'.repeat(300 * 1024) });
    expect(await lookup(COKE)).toEqual({ found: false, reason: 'unreachable' });
    expect(count('SELECT COUNT(*) AS n FROM product_lookups')).toBe(0);
    // a request that never answers is given up after three seconds
    configureProductLookup({ fetch: ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(new Error('aborted'))); })) as typeof fetch });
    const started = Date.now();
    expect(await lookup(COKE)).toEqual({ found: false, reason: 'unreachable' });
    expect(Date.now() - started).toBeLessThan(4500);
  }, 10_000);

  it('a redirect is followed only to their own addresses', async () => {
    net.set(FOOD + COKE, { status: 302, headers: { location: 'https://evil.example/steal' }, body: '' });
    expect(await lookup(COKE)).toEqual({ found: false, reason: 'unreachable' });
    expect(calls.map((c) => c.url.split('?')[0])).toEqual([FOOD + COKE]);
    calls = [];
    // the API's own host may send to itself; a picture may move between their picture hosts, never off them
    usualNet();
    net.set(COKE_400, { status: 301, headers: { location: 'https://images.openbeautyfacts.org/moved.jpg' }, body: '' });
    net.set('https://images.openbeautyfacts.org/moved.jpg', { type: 'image/jpeg', body: jpeg(900) });
    expect((await lookup(COKE)).image).toEqual({ mime: 'image/jpeg', data: Buffer.from(jpeg(900)).toString('base64') });
    net.set(COKE_400, { status: 301, headers: { location: 'http://images.openfoodfacts.org/plain.jpg' }, body: '' });
    net.set(COKE_200, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' }, body: '' });
    expect((await lookup(COKE)).image).toBeNull();
    expect(calls.some((c) => /169\.254|plain\.jpg|evil/.test(c.url))).toBe(false);
  });

  it('a picture is taken only when its bytes are a picture and it fits: else the small one, else none', async () => {
    // too big for an item's picture: the 200-pixel one is taken
    net.set(COKE_400, { type: 'image/jpeg', body: jpeg(MAX_IMAGE_BYTES + 1) });
    expect((await lookup(COKE)).image).toEqual({ mime: 'image/jpeg', data: Buffer.from(jpeg(500)).toString('base64') });
    // far too big: the download is stopped
    net.set(COKE_400, { type: 'image/jpeg', body: jpeg(3 * 1024 * 1024) });
    net.set(COKE_200, { type: 'image/jpeg', body: 'GIF89a not a jpeg at all' });
    expect(await lookup(COKE)).toMatchObject({ found: true, image: null });
    // a page sent as a picture, a picture sent as a page, a script named .jpg, nothing
    net.set(COKE_400, { type: 'text/html', body: jpeg() });
    net.set(COKE_200, { type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' });
    expect(await lookup(COKE)).toMatchObject({ found: true, image: null });
    net.set(COKE_400, { status: 404, type: 'image/jpeg', body: jpeg() });
    net.set(COKE_200, { type: 'image/jpeg', body: '' });
    expect(await lookup(COKE)).toMatchObject({ found: true, image: null, names: expect.any(Array) });
    // asked without the picture: no download
    calls = [];
    expect((await send('POST', '/api/items/lookup', { barcode: COKE, image: false })).json()).toMatchObject({ found: true, image: null });
    expect(calls).toEqual([]);
  });
});

describe('a picture saved from a lookup keeps its source', () => {
  beforeEach(switchOn);

  it('the credit is what the lookup kept, and goes when the picture is replaced or removed', async () => {
    const item = await addItem('Cola', COKE);
    const found = await lookup(COKE);
    const saved = await send('PUT', `/api/items/${item.id}/image`, { data: found.image.data, lookupBarcode: COKE });
    expect(saved.statusCode, saved.body).toBe(200);
    const source = { source: 'openfoodfacts', licence: 'CC BY-SA 3.0', url: `https://world.openfoodfacts.org/product/${COKE}` };
    expect(saved.json().source).toEqual(source);
    expect((await send('GET', `/api/items/${item.id}/image`)).json().source).toEqual(source);
    expect((await send('GET', '/api/item-images')).json()).toEqual([{ itemId: item.id, updatedAt: expect.any(String), source: 'openfoodfacts' }]);
    // the shop's own photo in its place: no credit any more
    const own = await send('PUT', `/api/items/${item.id}/image`, { data: PNG.toString('base64') });
    expect(own.json().source).toBeUndefined();
    expect((await send('GET', '/api/item-images')).json()).toEqual([{ itemId: item.id, updatedAt: expect.any(String) }]);
    expect(count('SELECT COUNT(*) AS n FROM item_image_sources')).toBe(0);
    await send('PUT', `/api/items/${item.id}/image`, { data: found.image.data, lookupBarcode: COKE });
    expect(count('SELECT COUNT(*) AS n FROM item_image_sources')).toBe(1);
    expect((await send('DELETE', `/api/items/${item.id}/image`)).statusCode).toBe(204);
    expect(count('SELECT COUNT(*) AS n FROM item_image_sources')).toBe(0);
  });

  it('the price checker names the source of a picture that came from a database, and nothing for the shop’s own', async () => {
    const cola = await addItem('Cola', COKE);
    const tea = await addItem('Tea', '4006381333931');
    const found = await lookup(COKE);
    await send('PUT', `/api/items/${cola.id}/image`, { data: found.image.data, lookupBarcode: COKE });
    await send('PUT', `/api/items/${tea.id}/image`, { data: PNG.toString('base64') });
    await send('POST', '/api/plan/trial');
    const warehouseId = (await send('GET', '/api/warehouses')).json()[0].id;
    const device = (await send('POST', '/api/price-checker/devices', { name: 'Aisle 3', warehouseId })).json() as { token: string };
    const check = async (code: string) => (await app.inject({ method: 'GET', url: `/api/price-check?code=${code}`, headers: { 'x-qasa-price-checker': device.token } })).json();
    expect(await check(COKE)).toMatchObject({ found: true, image: expect.stringMatching(/^data:image\/jpeg;base64,/), imageSource: 'openfoodfacts' });
    const own = await check('4006381333931');
    expect(own.image).toMatch(/^data:image\/png/);
    expect('imageSource' in own).toBe(false);
  });

  it('a barcode no lookup found a picture for gives no credit; a client can’t write one of its own', async () => {
    const item = await addItem('Cola', COKE);
    const res = await send('PUT', `/api/items/${item.id}/image`, { data: PNG.toString('base64'), lookupBarcode: UNKNOWN });
    expect(res.statusCode).toBe(200);
    expect(res.json().source).toBeUndefined();
    expect((await send('PUT', `/api/items/${item.id}/image`, { data: PNG.toString('base64'), lookupBarcode: 'https://evil.example' })).statusCode).toBe(400);
    expect((await send('PUT', `/api/items/${item.id}/image`, { data: PNG.toString('base64'), source: { source: 'openfoodfacts', url: 'https://evil.example' } })).json().source).toBeUndefined();
    expect(count('SELECT COUNT(*) AS n FROM item_image_sources')).toBe(0);
  });
});

describe('who may', () => {
  it('whoever may add items looks up; the setting and the search over every item are an admin’s', async () => {
    await switchOn();
    await send('POST', '/api/plan/trial');
    const ownerId = (await send('GET', '/api/users')).json()[0].id;
    expect((await send('POST', `/api/users/${ownerId}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
    expect((await send('POST', '/api/users', { username: 'las', name: 'Las', password: 'las-pass-123', roles: ['storekeeper'] })).statusCode).toBe(201);
    expect((await send('POST', '/api/users', { username: 'raz', name: 'Raz', password: 'raz-pass-123', roles: ['sales'] })).statusCode).toBe(201);
    expect((await send('PUT', '/api/auth/signin', { on: true })).statusCode).toBe(200);
    const login = async (username: string, password: string): Promise<Headers> => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, headers: { 'x-qasa-client': '1' } });
      expect(res.statusCode, res.body).toBe(200);
      return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    };
    const las = await login('las', 'las-pass-123');
    const raz = await login('raz', 'raz-pass-123');
    // signed out: nothing
    expect((await app.inject({ method: 'POST', url: '/api/items/lookup', payload: { barcode: COKE }, headers: { 'x-qasa-client': '1' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/items/lookup/settings' })).statusCode).toBe(401);
    // a request from another site (no app header) is refused
    expect((await app.inject({ method: 'POST', url: '/api/items/lookup', payload: { barcode: COKE }, headers: { cookie: las.cookie! } })).statusCode).toBe(403);
    expect((await send('POST', '/api/items/lookup', { barcode: COKE }, las)).json().found).toBe(true);
    expect((await send('POST', '/api/items/lookup', { barcode: COKE }, raz)).statusCode).toBe(403);
    expect((await send('GET', '/api/items/lookup/settings', undefined, raz)).json()).toMatchObject({ enabled: true });
    for (const who of [las, raz]) {
      expect((await send('PUT', '/api/items/lookup/settings', { enabled: false }, who)).statusCode).toBe(403);
      expect((await send('POST', '/api/items/lookup/bulk', {}, who)).statusCode).toBe(403);
      expect((await send('DELETE', '/api/items/lookup/bulk', undefined, who)).statusCode).toBe(403);
    }
    expect((await send('GET', '/api/items/lookup/settings', undefined, las)).json().enabled).toBe(true);
  });
});

describe('pictures for the items that have none', () => {
  beforeEach(switchOn);

  it('adds what it finds, with its source, one item at a time within the limit, and never replaces a picture', async () => {
    const cola = await addItem('Cola', COKE);
    const cream = await addItem('Cream', CREAM);
    const nothing = await addItem('Unknown', UNKNOWN);
    const scale = await addItem('Cheese', '2100017');
    await addItem('No barcode');
    const has = await addItem('Has one', '4006381333931');
    await send('PUT', `/api/items/${has.id}/image`, { data: PNG.toString('base64') });
    const before = (db.prepare('SELECT sha256 FROM item_images WHERE item_id = ?').get(has.id) as { sha256: string }).sha256;

    // the first wait is held until the test lets go, so the search is still running when it is started again
    let letGo = () => {};
    const held = new Promise<void>((resolve) => { letGo = resolve; });
    configureProductLookup({ sleep: async (ms) => { slept.push(ms); clock += ms; await held; } });
    const started = (await send('POST', '/api/items/lookup/bulk')).json();
    expect(started).toMatchObject({ running: true, total: 3, done: 0 });
    // a second start joins the first
    expect((await send('POST', '/api/items/lookup/bulk')).json()).toMatchObject({ running: true, total: 3 });
    letGo();
    const ended = await bulkFinished(db);
    expect(ended).toEqual({ running: false, total: 3, done: 3, added: 2, ended: 'done', startedAt: expect.any(String) });
    expect((await send('GET', '/api/items/lookup/bulk')).json()).toEqual(ended);

    const sources = Object.fromEntries((db.prepare('SELECT item_id, source FROM item_image_sources').all() as { item_id: string; source: string }[]).map((r) => [r.item_id, r.source]));
    expect(sources).toEqual({ [cola.id]: 'openfoodfacts', [cream.id]: 'openbeautyfacts' });
    expect(count('SELECT COUNT(*) AS n FROM item_images')).toBe(3);
    expect(db.prepare('SELECT 1 FROM item_images WHERE item_id IN (?, ?)').get(nothing.id, scale.id)).toBeUndefined();
    expect((db.prepare('SELECT sha256 FROM item_images WHERE item_id = ?').get(has.id) as { sha256: string }).sha256).toBe(before);
    // the scale's code and the item that has a picture were never asked about
    expect(reads().map((c) => c.url.split('?')[0]).sort()).toEqual([BEAUTY + CREAM, FOOD + UNKNOWN, FOOD + COKE, FOOD + CREAM].sort());
    // it waited between items (none after the last)
    expect(slept).toEqual([BULK_PACE_MS, BULK_PACE_MS]);
    expect((db.prepare("SELECT user FROM audit_log WHERE entity = 'item_image' AND entity_id = ?").get(cola.id) as { user: string }).user).toBe('Mer');
  });

  it('a picture a person added meanwhile stays', async () => {
    const cola = await addItem('Cola', COKE);
    // the person's photo lands while the picture is being downloaded
    const real = fakeFetch;
    configureProductLookup({ fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === COKE_400) db.prepare('INSERT INTO item_images (item_id, mime, data, updated_at, sha256) VALUES (?, ?, ?, ?, ?)').run(cola.id, 'image/png', PNG, new Date().toISOString(), 'own');
      return real(input, init);
    }) as typeof fetch });
    await send('POST', '/api/items/lookup/bulk');
    expect(await bulkFinished(db)).toMatchObject({ done: 1, added: 0, ended: 'done' });
    expect((db.prepare('SELECT sha256 FROM item_images WHERE item_id = ?').get(cola.id) as { sha256: string }).sha256).toBe('own');
    expect(count('SELECT COUNT(*) AS n FROM item_image_sources')).toBe(0);
  });

  it('can be stopped, ends when the setting is switched off, and gives up when the databases don’t answer', async () => {
    const codes = ['4006381333931', '4006381333948', '4006381333955', '4006381333962', '4006381333979'];
    for (const [i, code] of codes.entries()) await addItem(`Item ${i}`, code);
    for (const code of codes) net.set(FOOD + code, { status: 404, body: fixture(`not-found-${UNKNOWN}.json`) });
    // stopped during the first wait
    configureProductLookup({ sleep: async (ms) => { slept.push(ms); clock += ms; await send('DELETE', '/api/items/lookup/bulk'); } });
    await send('POST', '/api/items/lookup/bulk');
    expect(await bulkFinished(db)).toMatchObject({ running: false, total: 5, done: 1, ended: 'stopped' });

    // switched off during a wait: it ends, and nothing more is asked
    configureProductLookup({ sleep: async (ms) => { slept.push(ms); clock += ms; await send('PUT', '/api/items/lookup/settings', { enabled: false }); } });
    await send('POST', '/api/items/lookup/bulk');
    const off = await bulkFinished(db);
    expect(off).toMatchObject({ running: false, ended: 'off' });
    const asked = reads().length;
    expect(asked).toBeLessThan(5);

    // no internet: three in a row, then it ends
    await switchOn();
    clock += 10 * 86_400_000;
    configureProductLookup({ sleep: async (ms) => { slept.push(ms); clock += ms; } });
    for (const code of codes) net.set(FOOD + code, 'down');
    await send('POST', '/api/items/lookup/bulk');
    expect(await bulkFinished(db)).toMatchObject({ running: false, done: 2, added: 0, ended: 'unreachable' });
  });

  it('what was answered before is not asked again', async () => {
    await addItem('Unknown', UNKNOWN);
    expect(await lookup(UNKNOWN)).toEqual({ found: false, reason: 'not_found' });
    calls = [];
    await send('POST', '/api/items/lookup/bulk');
    expect(await bulkFinished(db)).toMatchObject({ total: 1, done: 1, added: 0, ended: 'done' });
    expect(calls).toEqual([]);
    expect(slept).toEqual([]);
  });
});
