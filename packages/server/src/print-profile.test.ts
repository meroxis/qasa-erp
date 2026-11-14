import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { toBase64 } from './media.ts';
import { writeSetting } from './settings.ts';
import { DEFAULT_PRINT_DESIGN, designFor, PLAN_IDS, PLANS, PRINT_FIELDS, PRINT_GALLERY, withGalleryDesign } from '@qasa/core';
import { getCompanyLogo, getPrintDesigns, logoSize, MAX_LOGO_BYTES, MAX_LOGO_SIDE } from './print-profile.ts';

let db: Db;
let app: FastifyInstance;

const owner = { 'x-qasa-client': '1', 'x-qasa-user': encodeURIComponent('Mer') };
type Headers = Record<string, string>;
const send = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, body?: unknown, headers: Headers = owner) =>
  app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body as object }) });

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const chars = (s: string) => [...s].map((c) => c.charCodeAt(0));
/** A PNG as far as its structure goes: the signature, an IHDR stating the size, and the IEND at the very end. */
const png = (width: number, height: number, extra: number[] = []) => new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ...be32(13), ...chars('IHDR'), ...be32(width), ...be32(height), 8, 6, 0, 0, 0, 0, 0, 0, 0,
  ...extra,
  ...be32(0), ...chars('IEND'), 0xae, 0x42, 0x60, 0x82
]);
/** A JPEG: start mark, an APP0 block, a frame header stating the size, the end mark. */
const jpeg = (width: number, height: number) => new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2,
  0xff, 0xc0, 0, 11, 8, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 1, 1, 0x11, 0,
  0xff, 0xd9
]);
/** A WebP with the extended header (VP8X), which states the canvas size less one. */
const webp = (width: number, height: number) => {
  const body = [...chars('WEBP'), ...chars('VP8X'), ...le32(10), 0, 0, 0, 0, ...le32(width - 1).slice(0, 3), ...le32(height - 1).slice(0, 3)];
  return new Uint8Array([...chars('RIFF'), ...le32(body.length), ...body]);
};
const PNG = png(120, 60);
/** the free month: every paid feature, the company logo among them */
const startTrial = () => writeSetting(db, 'trial_started', new Date().toISOString().slice(0, 10));
const profile = { address: '  Erbil, 60m street  ', phone: '0750 000 0000', taxNumber: 'TX-123', footer: 'Goods sold are not returned after 7 days', showLogo: true };

beforeEach(() => {
  db = openDatabase(':memory:');
  // the routes are registered here until printProfileApi joins BUILT_IN_FEATURES; then this becomes buildApp(db)
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('print header and footer', () => {
  it('starts empty and saves what the company prints at the top and foot of its papers', async () => {
    expect((await send('GET', '/api/print-profile')).json()).toEqual({ address: '', phone: '', taxNumber: '', footer: '', showLogo: true, logo: null, logoKept: false });
    const saved = await send('PUT', '/api/print-profile', profile);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ ...profile, address: 'Erbil, 60m street', logo: null });
    expect((await send('GET', '/api/print-profile')).json().footer).toBe(profile.footer);
  });

  it('refuses unknown fields and over-long lines', async () => {
    expect((await send('PUT', '/api/print-profile', { ...profile, script: '<x>' })).statusCode).toBe(400);
    expect((await send('PUT', '/api/print-profile', { ...profile, footer: 'x'.repeat(301) })).statusCode).toBe(400);
    expect((await send('PUT', '/api/print-profile', { address: '' })).statusCode).toBe(400);
  });
});

describe('company logo', () => {
  it('is a paid feature checked on the server: the Free plan can neither save a logo nor print one', async () => {
    const refused = await send('PUT', '/api/company-logo', { data: toBase64(PNG) });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'plan_limit', details: { limit: 'companyLogo' } });
    expect((await send('GET', '/api/print-profile')).json()).toMatchObject({ logo: null, logoKept: false });
    // the rest of the header stays free
    expect((await send('PUT', '/api/print-profile', profile)).statusCode).toBe(200);
  });

  it('keeps a logo saved on a paid plan when the plan ends: not printed, not lost, removable, and back with the plan', async () => {
    startTrial();
    expect((await send('PUT', '/api/company-logo', { data: toBase64(PNG) })).statusCode).toBe(200);
    expect((await send('GET', '/api/print-profile')).json()).toMatchObject({ logo: { mime: 'image/png' }, logoKept: false });
    // the free month is over
    writeSetting(db, 'trial_started', '2020-01-01');
    expect((await send('GET', '/api/print-profile')).json()).toMatchObject({ logo: null, logoKept: true });
    expect((await send('PUT', '/api/company-logo', { data: toBase64(png(10, 10)) })).statusCode).toBe(409);
    expect(getCompanyLogo(db)?.data).toBe(toBase64(PNG));
    expect((await send('DELETE', '/api/company-logo')).statusCode).toBe(204);
    expect((await send('GET', '/api/print-profile')).json()).toMatchObject({ logo: null, logoKept: false });
  });

  it('includes the logo in Starter, Pro and Business and not in Free', () => {
    expect(PLAN_IDS.map((id) => PLANS[id].features.includes('companyLogo'))).toEqual([false, true, true, true]);
  });

  it('reads the picture size from the file itself and refuses a file that is not a whole picture', () => {
    expect(logoSize(png(120, 60), 'image/png')).toEqual({ width: 120, height: 60 });
    expect(logoSize(jpeg(640, 480), 'image/jpeg')).toEqual({ width: 640, height: 480 });
    expect(logoSize(webp(300, 200), 'image/webp')).toEqual({ width: 300, height: 200 });
    // the first bytes of a PNG and nothing else
    expect(logoSize(PNG.slice(0, 15), 'image/png')).toBeNull();
    // something stuck on after the picture's end
    expect(logoSize(new Uint8Array([...PNG, ...chars('<script>alert(1)</script>')]), 'image/png')).toBeNull();
    expect(logoSize(new Uint8Array([...jpeg(10, 10), 1, 2, 3]), 'image/jpeg')).toBeNull();
    expect(logoSize(new Uint8Array([...webp(10, 10), 0]), 'image/webp')).toBeNull();
    // a JPEG with no frame header
    expect(logoSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xda, 0, 2, 0, 0, 0xff, 0xd9]), 'image/jpeg')).toBeNull();
  });

  it('refuses a picture larger than the logo size or with no size, however small the file', async () => {
    startTrial();
    const huge = await send('PUT', '/api/company-logo', { data: toBase64(png(MAX_LOGO_SIDE + 1, 10)) });
    expect(huge.statusCode).toBe(400);
    expect(huge.body).toContain('pp_logo_too_wide');
    expect((await send('PUT', '/api/company-logo', { data: toBase64(png(60000, 60000)) })).statusCode).toBe(400);
    const empty = await send('PUT', '/api/company-logo', { data: toBase64(png(0, 10)) });
    expect(empty.statusCode).toBe(400);
    expect(empty.body).toContain('pp_logo_invalid');
    const cut = await send('PUT', '/api/company-logo', { data: toBase64(PNG.slice(0, 15)) });
    expect(cut.statusCode).toBe(400);
    expect(cut.body).toContain('pp_logo_invalid');
    const polyglot = await send('PUT', '/api/company-logo', { data: toBase64(new Uint8Array([...PNG, ...chars('<svg onload=alert(1)>')])) });
    expect(polyglot.statusCode).toBe(400);
    for (const [bytes, mime] of [[jpeg(640, 480), 'image/jpeg'], [webp(300, 200), 'image/webp'], [png(MAX_LOGO_SIDE, MAX_LOGO_SIDE), 'image/png']] as const) {
      const ok = await send('PUT', '/api/company-logo', { data: toBase64(bytes) });
      expect(ok.statusCode, mime + ' ' + ok.body).toBe(200);
      expect(ok.json().mime).toBe(mime);
    }
  });

  it('keeps a PNG, JPEG or WebP by its first bytes and hands it back', async () => {
    startTrial();
    const r = await send('PUT', '/api/company-logo', { data: toBase64(PNG) });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ mime: 'image/png', data: toBase64(PNG) });
    // a data: URL prefix is fine too
    expect((await send('PUT', '/api/company-logo', { data: `data:image/png;base64,${toBase64(PNG)}` })).statusCode).toBe(200);
    expect((await send('GET', '/api/print-profile')).json().logo).toMatchObject({ mime: 'image/png' });
    expect((await send('DELETE', '/api/company-logo')).statusCode).toBe(204);
    expect((await send('GET', '/api/print-profile')).json().logo).toBeNull();
  });

  it('refuses SVG, other files and anything over 200 KB', async () => {
    startTrial();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    const bad = await send('PUT', '/api/company-logo', { data: toBase64(svg) });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().details?.[0]?.code ?? bad.body).toContain('pp_logo_invalid');
    expect((await send('PUT', '/api/company-logo', { data: 'not base64!!' })).statusCode).toBe(400);
    // a whole PNG, only too big a file
    const big = png(120, 60, new Array(MAX_LOGO_BYTES).fill(0));
    expect((await send('PUT', '/api/company-logo', { data: toBase64(big) })).statusCode).toBe(400);
  });

  it('lets everyone signed in read it, and only an admin change it', async () => {
    writeSetting(db, 'trial_started', new Date().toISOString().slice(0, 10)); // more than one user needs a paid plan
    const ownerId = (await send('GET', '/api/users')).json()[0].id;
    await send('POST', `/api/users/${ownerId}/password`, { password: 'owner-pass-1' });
    expect((await send('POST', '/api/users', { username: 'raz', name: 'Raz', roles: ['preparer'], password: 'raz-pass-1' })).statusCode).toBeLessThan(300);
    expect((await send('PUT', '/api/auth/signin', { on: true })).statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'raz', password: 'raz-pass-1' }, headers: { 'x-qasa-client': '1' } });
    expect(res.statusCode, res.body).toBe(200);
    const raz = { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    expect((await send('GET', '/api/print-profile', undefined, raz)).statusCode).toBe(200);
    expect((await send('PUT', '/api/print-profile', profile, raz)).statusCode).toBe(403);
    expect((await send('PUT', '/api/company-logo', { data: toBase64(PNG) }, raz)).statusCode).toBe(403);
    expect((await send('DELETE', '/api/company-logo', undefined, raz)).statusCode).toBe(403);
    expect((await send('GET', '/api/print-designs', undefined, raz)).statusCode).toBe(200);
    expect((await send('PUT', '/api/print-designs/sale', DEFAULT_PRINT_DESIGN, raz)).statusCode).toBe(403);
    expect((await send('DELETE', '/api/print-designs/sale', undefined, raz)).statusCode).toBe(403);
  });
});

describe('print designs', () => {
  const design = () => structuredClone(DEFAULT_PRINT_DESIGN);

  it('saves a design per kind, and every other kind follows the sale invoice', async () => {
    expect((await send('GET', '/api/print-designs')).json()).toEqual({});
    const r = await send('PUT', '/api/print-designs/sale', { ...design(), layout: 'modern', accent: '#AA0000' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().sale).toMatchObject({ layout: 'modern', accent: '#aa0000' });
    const saved = (await send('GET', '/api/print-designs')).json();
    expect(designFor(saved, 'purchase').layout).toBe('modern');
    expect(designFor(saved, 'pos').layout).toBe('receipt80');
    expect((await send('PUT', '/api/print-designs/quote', { ...design(), layout: 'compact' })).statusCode).toBe(200);
    expect(designFor((await send('GET', '/api/print-designs')).json(), 'quote').layout).toBe('compact');
  });

  it('refuses unknown kinds, unknown keys and bad values', async () => {
    expect((await send('PUT', '/api/print-designs/letter', design())).statusCode).toBe(400);
    const extra = await send('PUT', '/api/print-designs/sale', { ...design(), style: 'body{display:none}' });
    expect(extra.statusCode).toBe(400);
    expect(extra.body).toContain('pd_unknown_field');
    expect((await send('PUT', '/api/print-designs/sale', { ...design(), accent: 'javascript:1' })).statusCode).toBe(400);
    expect((await send('GET', '/api/print-designs')).json()).toEqual({});
  });

  it('resets a kind to the default', async () => {
    await send('PUT', '/api/print-designs/quote', { ...design(), layout: 'compact' });
    const r = await send('DELETE', '/api/print-designs/quote');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({});
    expect((await send('DELETE', '/api/print-designs/sale')).statusCode).toBe(200);
  });

  it('saves each design of the gallery, with every part of the paper on or off', async () => {
    for (const g of PRINT_GALLERY) {
      const d = withGalleryDesign(design(), g.id);
      const allOn = { ...d, show: Object.fromEntries(PRINT_FIELDS.map((f) => [f, true])) };
      const r = await send('PUT', '/api/print-designs/voucher', allOn);
      expect(r.statusCode, g.id + ' ' + r.body).toBe(200);
      expect(r.json().voucher).toMatchObject({ layout: g.layout, paper: g.paper, show: { previousBalance: true, partyBalance: true, logo: true } });
      expect(getPrintDesigns(db).voucher?.show.previousBalance).toBe(true);
    }
    const off = { ...design(), show: Object.fromEntries(PRINT_FIELDS.map((f) => [f, false])) };
    expect((await send('PUT', '/api/print-designs/voucher', off)).json().voucher.show).toEqual(off.show);
  });

  it('still prints a design saved before 1.4 as it printed then, and shows the balance before the paper with the balance after it', async () => {
    const before14 = ['itemCode', 'barcode', 'itemImage', 'unit', 'discount', 'usdEquivalent', 'partyBalance', 'qr', 'signatures', 'stamp', 'bankDetails', 'terms', 'pageNumbers'];
    const old = (on: string[], over: object = {}) => ({ ...design(), ...over, show: Object.fromEntries(before14.map((f) => [f, on.includes(f)])) });
    writeSetting(db, 'print_designs', JSON.stringify({
      sale: old(['itemCode', 'unit']),
      // the receipt voucher with "balance after this paper" switched on in an earlier version
      voucher: old(['partyBalance', 'signatures']),
      pos: old(['qr'], { layout: 'receipt80', paper: '80mm', marginMm: 3 })
    }));
    const saved = (await send('GET', '/api/print-designs')).json();
    expect(Object.keys(saved)).toEqual(['sale', 'voucher', 'pos']);
    expect(saved.sale.show).toMatchObject({ logo: true, companyAddress: true, companyPhone: true, companyTax: true, partyPhone: true, partyAddress: true, subtotal: true, notes: true, amountWords: true, exchangeRate: true, previousBalance: false, partyBalance: false });
    expect(saved.voucher.show).toMatchObject({ partyBalance: true, previousBalance: true });
    // the receipt roll never printed the amount in words
    expect(saved.pos.show.amountWords).toBe(false);
    // a part of before 1.4 may still not be missing
    expect((await send('PUT', '/api/print-designs/sale', old([]))).statusCode).toBe(200);
    const { itemCode: _drop, ...noCode } = design().show;
    expect((await send('PUT', '/api/print-designs/sale', { ...design(), show: noCode })).statusCode).toBe(400);
  });

  it('skips a stored design that no longer checks out instead of printing it', async () => {
    writeSetting(db, 'print_designs', JSON.stringify({ sale: { ...design(), accent: 'red' }, quote: design() }));
    expect(Object.keys((await send('GET', '/api/print-designs')).json())).toEqual(['quote']);
  });
});
