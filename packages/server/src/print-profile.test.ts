import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { toBase64 } from './media.ts';
import { writeSetting } from './settings.ts';
import { DEFAULT_PRINT_DESIGN, designFor } from '@qasa/core';
import { MAX_LOGO_BYTES, printProfileApi } from './print-profile.ts';

let db: Db;
let app: FastifyInstance;

const owner = { 'x-qasa-client': '1', 'x-qasa-user': encodeURIComponent('Mer') };
type Headers = Record<string, string>;
const send = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, body?: unknown, headers: Headers = owner) =>
  app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body as object }) });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
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
    expect((await send('GET', '/api/print-profile')).json()).toEqual({ address: '', phone: '', taxNumber: '', footer: '', showLogo: true, logo: null });
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
  it('keeps a PNG, JPEG or WebP by its first bytes and hands it back', async () => {
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
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    const bad = await send('PUT', '/api/company-logo', { data: toBase64(svg) });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().details?.[0]?.code ?? bad.body).toContain('pp_logo_invalid');
    expect((await send('PUT', '/api/company-logo', { data: 'not base64!!' })).statusCode).toBe(400);
    const big = new Uint8Array(MAX_LOGO_BYTES + 1);
    big.set(PNG);
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

  it('skips a stored design that no longer checks out instead of printing it', async () => {
    writeSetting(db, 'print_designs', JSON.stringify({ sale: { ...design(), accent: 'red' }, quote: design() }));
    expect(Object.keys((await send('GET', '/api/print-designs')).json())).toEqual(['quote']);
  });
});
