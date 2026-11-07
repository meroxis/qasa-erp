import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { setLicensePublicKeyForTests } from './license.ts';
import { SIGNED_PREFIX, VERIFY_URL, companyVerifyKey, verifyApi, type QrPayload } from './verify.ts';
import { encodeQr } from '../../../apps/web/src/industry/qr.ts';

let db: Db;
let app: FastifyInstance;
let customerId: string;
let itemId: string;
let warehouseId: string;
let licensor: KeyObject;

const headers = { 'x-qasa-user': encodeURIComponent('Mer Las'), 'x-qasa-client': '1' };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const get = (url: string) => app.inject({ url, headers });

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  const pair = generateKeyPairSync('ed25519');
  licensor = pair.privateKey;
  setLicensePublicKeyForTests(pair.publicKey.export({ format: 'jwk' }).x!);
  await app.inject({ method: 'PUT', url: '/api/settings', headers, payload: { companyName: { ar: 'شركة ميروكسيس للتجارة العامة والمقاولات المحدودة', en: 'Meroxis', ku: 'کۆمپانیای مێرۆکسیس' } } });
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  customerId = (await post('/api/parties', { type: 'customer', name: 'شركة سانوس للتجارة والاستيراد والتصدير العام', accountCode: '1612' })).json().id;
  itemId = (await post('/api/items', { code: 'SRV', name: { ar: 'خدمة', en: 'Service', ku: 'خزمەت' }, unit: 'service', salePrice: 1_000, saleCurrency: 'IQD' })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function postedSale(currency: 'IQD' | 'USD' = 'IQD', price = 12_750_000): Promise<string> {
  const draft = await post('/api/invoices', {
    kind: 'sale', date: '2026-11-07', partyId: customerId, warehouseId, currency, rateX100: currency === 'USD' ? 131_000 : 100, payment: 'credit', discount: 0,
    lines: [{ itemId, qtyMilli: 1000, unitPrice: price }]
  });
  expect(draft.statusCode, draft.body).toBe(201);
  const posted = await post(`/api/invoices/${draft.json().id}/post`);
  expect(posted.statusCode, posted.body).toBe(200);
  return posted.json().id;
}

/** What the verify page does: split the link, check the signature with the company's public key. */
function check(url: string, publicKeyX: string): QrPayload | null {
  const [body, signature] = url.slice(VERIFY_URL.length).split('.');
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKeyX }, format: 'jwk' });
  if (!verify(null, Buffer.from(SIGNED_PREFIX + body), key, Buffer.from(signature!, 'base64url'))) return null;
  return JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as QrPayload;
}

function licenceKey(): string {
  const body = `QASA1.${Buffer.from(JSON.stringify({ v: 1, id: 'QP-2026-0042', plan: 'pro', to: 'Meroxis', issued: '2026-01-01', expires: '2099-12-31' })).toString('base64url')}`;
  return `${body}.${sign(null, Buffer.from(body), licensor).toString('base64url')}`;
}

describe('invoice QR codes', () => {
  it('signs a posted sale with the company key; the verify page can check it and sees any change', async () => {
    const id = await postedSale();
    const res = await get(`/api/verify/invoices/${id}?lang=ar`);
    expect(res.statusCode, res.body).toBe(200);
    const { url, payload, licensed } = res.json();
    expect(url.startsWith(VERIFY_URL)).toBe(true);
    expect(licensed).toBe(false);
    expect(payload).toMatchObject({ v: 1, n: expect.stringMatching(/^INV-2026-\d+$/), d: '2026-11-07', t: 12_750_000, cur: 'IQD' });
    expect(payload.l).toBeUndefined();
    // long names are cut so the code stays small
    expect(Array.from(payload.c as string).length).toBeLessThanOrEqual(40);
    expect(Array.from(payload.p as string).length).toBeLessThanOrEqual(40);

    const key = companyVerifyKey(db);
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(check(url, key)).toEqual(payload);
    // a total changed after printing
    const [body, signature] = url.slice(VERIFY_URL.length).split('.');
    const edited = Buffer.from(JSON.stringify({ ...payload, t: 1_000 })).toString('base64url');
    expect(check(`${VERIFY_URL}${edited}.${signature}`, key)).toBeNull();
    expect(body).not.toBe(edited);
    // another company's key
    expect(check(url, generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x!)).toBeNull();
  });

  it('keeps one key pair per company and never hands out the private half', async () => {
    const first = companyVerifyKey(db);
    expect(companyVerifyKey(db)).toBe(first);
    expect((await get('/api/verify/key')).json()).toEqual({ publicKey: first });
    const settings = (await get('/api/settings')).body;
    expect(settings).not.toContain('verify_private_key');
  });

  it('names the licence on a paid plan, so the page can find the company keys on the portal', async () => {
    expect((await post('/api/plan/license', { key: licenceKey() })).statusCode).toBe(200);
    const id = await postedSale('USD', 15_000_00);
    const { payload, licensed } = (await get(`/api/verify/invoices/${id}?lang=en`)).json();
    expect(licensed).toBe(true);
    expect(payload).toMatchObject({ l: 'QP-2026-0042', c: 'Meroxis', cur: 'USD', t: 15_000_00 });
  });

  it('only for posted sale invoices', async () => {
    const draft = await post('/api/invoices', {
      kind: 'sale', date: '2026-11-07', partyId: customerId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
      lines: [{ itemId, qtyMilli: 1000, unitPrice: 5_000 }]
    });
    const res = await get(`/api/verify/invoices/${draft.json().id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('qr_needs_posted_sale');
  });

  it('fits in a QR code that phones read from paper (version 20 or smaller)', async () => {
    expect((await post('/api/plan/license', { key: licenceKey() })).statusCode).toBe(200);
    const id = await postedSale();
    const { url } = (await get(`/api/verify/invoices/${id}?lang=ku`)).json();
    const size = encodeQr(url, 'M').length;
    expect(size).toBeLessThanOrEqual(20 * 4 + 17);
  });
});
