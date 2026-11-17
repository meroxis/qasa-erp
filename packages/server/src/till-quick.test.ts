import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { POS_QUICK_MAX, posBigTiles } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { getSettings, updateSettings } from './settings.ts';

// The till's quick buttons (every company that uses the till) and its big pictures (a phone shop by default): company
// settings, so every PC of the company agrees; changed by an admin only, as every setting

let db: Db;
let app: FastifyInstance;
const owner = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
type H = Record<string, string>;
const put = (body: unknown, h: H = owner) => app.inject({ method: 'PUT', url: '/api/settings', payload: body as object, headers: h });
const post = (url: string, body: unknown, h: H = owner) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const get = (url: string, h: H = owner) => app.inject({ url, headers: h });

async function item(code: string): Promise<string> {
  const res = await post('/api/items', { code, name: { ar: code, en: code, ku: code }, unit: 'piece', salePrice: 5_000, saleCurrency: 'IQD' });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
}

/** Sign-in on, with these people (password `<username>-pass-123`); the owner is "admin". */
async function signIn(people: Record<string, string[]>): Promise<Record<string, H>> {
  await post('/api/plan/trial', {});
  const ownerId = (await get('/api/users')).json()[0].id;
  expect((await post(`/api/users/${ownerId}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
  for (const [username, roles] of Object.entries(people)) {
    const made = await post('/api/users', { username, name: username[0]!.toUpperCase() + username.slice(1), password: `${username}-pass-123`, roles });
    expect(made.statusCode, made.body).toBe(201);
  }
  expect((await app.inject({ method: 'PUT', url: '/api/auth/signin', payload: { on: true }, headers: owner })).statusCode).toBe(200);
  const out: Record<string, H> = {};
  for (const username of ['admin', ...Object.keys(people)]) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: `${username}-pass-123` }, headers: { 'x-qasa-client': '1' } });
    expect(res.statusCode, res.body).toBe(200);
    out[username] = { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
  }
  return out;
}

beforeEach(() => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('the till’s quick buttons', () => {
  it('start empty, and keep a company’s list in its order', async () => {
    expect((await get('/api/settings')).json().posQuickItems).toEqual([]);
    const [bread, water, bag] = [await item('BREAD'), await item('WATER'), await item('BAG')];
    const res = await put({ posQuickItems: [water, bread, bag] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().posQuickItems).toEqual([water, bread, bag]);
    expect(getSettings(db).posQuickItems).toEqual([water, bread, bag]);
    // another order, then none
    expect((await put({ posQuickItems: [bag, water] })).json().posQuickItems).toEqual([bag, water]);
    expect((await put({ posQuickItems: [] })).json().posQuickItems).toEqual([]);
    // a change of something else leaves them as they are
    await put({ posQuickItems: [bread] });
    expect((await put({ amountsShow: 'iqd_usd' })).json().posQuickItems).toEqual([bread]);
  });

  it('take only items that exist and are on sale, each once, at most 24', async () => {
    const bread = await item('BREAD');
    const old = await item('OLD');
    db.prepare('UPDATE items SET active = 0 WHERE id = ?').run(old);
    for (const bad of [
      ['no-such-item'], [old], [bread, bread], [bread, ''], [bread, 7], 'BREAD', null, { 0: bread }, [bread, 'x'.repeat(65)]
    ]) {
      const res = await put({ posQuickItems: bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
    // the item that is not on sale is named
    expect((await put({ posQuickItems: [bread, old] })).json().details).toEqual([{ code: 'pos_quick_item_not_on_sale', field: 'posQuickItems.1' }]);
    const many: string[] = [];
    for (let i = 0; i <= POS_QUICK_MAX; i++) many.push(await item(`Q${i}`));
    expect((await put({ posQuickItems: many })).statusCode).toBe(400);
    expect((await put({ posQuickItems: many.slice(0, POS_QUICK_MAX) })).statusCode).toBe(200);
    // nothing refused was kept
    expect(getSettings(db).posQuickItems).toEqual(many.slice(0, POS_QUICK_MAX));
    // the same checks in the service itself
    expect(() => updateSettings(db, { posQuickItems: ['nothing'] }, 'Mer')).toThrowError(expect.objectContaining({ code: 'validation' }));
  });

  it('drop an item deleted or made inactive since, quietly, and bring it back when it is on sale again', async () => {
    const [bread, water, bag] = [await item('BREAD'), await item('WATER'), await item('BAG')];
    await put({ posQuickItems: [bread, water, bag] });
    expect((await app.inject({ method: 'DELETE', url: `/api/items/${water}`, headers: owner })).statusCode).toBeLessThan(300);
    db.prepare('UPDATE items SET active = 0 WHERE id = ?').run(bag);
    expect((await get('/api/settings')).json().posQuickItems).toEqual([bread]);
    db.prepare('UPDATE items SET active = 1 WHERE id = ?').run(bag);
    expect((await get('/api/settings')).json().posQuickItems).toEqual([bread, bag]);
  });

  it('read a damaged stored value as none', () => {
    db.prepare('INSERT INTO settings ("key", value) VALUES (?, ?)').run('pos_quick_items', '{not json');
    expect(getSettings(db).posQuickItems).toEqual([]);
    db.prepare('UPDATE settings SET value = ? WHERE "key" = ?').run('{"a":1}', 'pos_quick_items');
    expect(getSettings(db).posQuickItems).toEqual([]);
  });

  it('are changed by an admin only: a cashier, a storekeeper or a salesperson is refused', async () => {
    const bread = await item('BREAD');
    const who = await signIn({ raz: ['pos'], las: ['storekeeper'], keeper: ['sales', 'pos'] });
    for (const name of ['raz', 'las', 'keeper']) {
      const res = await put({ posQuickItems: [bread] }, who[name]!);
      expect(res.statusCode, name).toBe(403);
      // every signed-in person reads them (the till shows them)
      expect((await get('/api/settings', who[name]!)).statusCode).toBe(200);
    }
    expect(getSettings(db).posQuickItems).toEqual([]);
    const admin = await put({ posQuickItems: [bread] }, who.admin!);
    expect(admin.statusCode, admin.body).toBe(200);
    expect((await get('/api/settings', who.raz!)).json().posQuickItems).toEqual([bread]);
    // the change is in the audit log, by whom
    const logged = db.prepare("SELECT user AS u, details FROM audit_log WHERE entity = 'settings' ORDER BY id DESC LIMIT 1").get() as { u: string; details: string } | undefined;
    expect(logged?.u).toBe('Admin');
    expect(logged?.details).toContain(bread);
  });
});

describe('big pictures on the till', () => {
  it('follow the business type until someone chooses: a phone shop has them', async () => {
    const s = (await get('/api/settings')).json();
    expect(s.posBigPictures).toBe('auto');
    expect(posBigTiles(s)).toBe(false);
    expect(posBigTiles((await put({ businessTypes: ['mobileShop'] })).json())).toBe(true);
    expect(posBigTiles((await put({ businessTypes: ['trade', 'mobileShop'] })).json())).toBe(true);
    expect(posBigTiles((await put({ businessTypes: ['market'] })).json())).toBe(false);
    expect(posBigTiles((await put({ businessTypes: ['pharmacy', 'trade'] })).json())).toBe(false);
  });

  it('can be turned on for any company and off for a phone shop, and back to the business type', async () => {
    await put({ businessTypes: ['market'] });
    const on = await put({ posBigPictures: 'on' });
    expect(on.statusCode).toBe(200);
    expect(on.json().posBigPictures).toBe('on');
    expect(posBigTiles(on.json())).toBe(true);
    await put({ businessTypes: ['mobileShop'] });
    expect(posBigTiles((await put({ posBigPictures: 'off' })).json())).toBe(false);
    expect(posBigTiles((await put({ posBigPictures: 'auto' })).json())).toBe(true);
    for (const bad of ['yes', 1, null, '', true]) expect((await put({ posBigPictures: bad })).statusCode).toBe(400);
    expect(getSettings(db).posBigPictures).toBe('auto');
    expect(() => updateSettings(db, { posBigPictures: 'big' as never }, 'Mer')).toThrowError(expect.objectContaining({ code: 'validation' }));
  });

  it('read an unknown stored value (from a newer version) as following the business type', () => {
    db.prepare('INSERT INTO settings ("key", value) VALUES (?, ?)').run('pos_big_pictures', 'huge');
    expect(getSettings(db).posBigPictures).toBe('auto');
  });

  it('are an admin’s to change', async () => {
    const who = await signIn({ raz: ['pos', 'sales'] });
    expect((await put({ posBigPictures: 'on' }, who.raz!)).statusCode).toBe(403);
    expect((await put({ posBigPictures: 'on' }, who.admin!)).statusCode).toBe(200);
  });
});

describe('the website demo', () => {
  it('keeps the sample company as it was: no quick buttons, normal tiles', async () => {
    const { seedDemo } = await import('./demo-data.ts');
    const demo = openDatabase(':memory:');
    seedDemo(demo);
    const s = getSettings(demo);
    expect(s.posQuickItems).toEqual([]);
    expect(s.posBigPictures).toBe('auto');
    expect(posBigTiles(s)).toBe(false);
    demo.close();
  });

  it('opens as a phone shop on request (?phoneshop): big pictures by the business type, five quick buttons, drawn pictures', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { seedDemo, seedPhoneShopDemo } = await import('./demo-data.ts');
    const dir = new URL('../../../apps/web/src/demo/phone-shop/', import.meta.url);
    const pictures = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => [f.replace('.png', ''), readFileSync(new URL(f, dir)).toString('base64')]));
    expect(Object.keys(pictures).sort()).toEqual(['1001', '1002', '2001', '2002', '2003', '2004', '2005', '2006', '2007']);
    const demo = openDatabase(':memory:');
    seedDemo(demo);
    seedPhoneShopDemo(demo, pictures);
    const s = getSettings(demo);
    expect(s.businessTypes).toContain('mobileShop');
    expect(posBigTiles(s)).toBe(true);
    const codes = (ids: string[]) => ids.map((id) => (demo.prepare('SELECT code FROM items WHERE id = ?').get(id) as { code: string }).code);
    expect(codes(s.posQuickItems)).toEqual(['2001', '2002', '2003', '2004', '2005']);
    // every item on sale has its picture; the air-conditioning sample is off the till
    expect(Number((demo.prepare('SELECT COUNT(*) AS n FROM items WHERE active = 1').get() as { n: number }).n)).toBe(9);
    expect(Number((demo.prepare('SELECT COUNT(*) AS n FROM item_images m JOIN items i ON i.id = m.item_id WHERE i.active = 1').get() as { n: number }).n)).toBe(9);
    demo.close();
  });
});
