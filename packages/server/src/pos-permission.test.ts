import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { permissionsOf, resetLoginThrottle, ROLES, seesBooks, seesCost } from './auth.ts';

// 1.5.2: the till is the Point of sale permission ('pos'), given per person by an admin (the role of that name in Users).
// The sales role alone no longer opens, sells at or closes a till shift; nobody gets 'pos' by the update (the owner's
// decision, 2026-11-17); an admin has it, as every permission.

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let teaId: string;

const owner = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
type H = Record<string, string>;
const post = (url: string, body: unknown, h: H) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const get = (url: string, h: H) => app.inject({ url, headers: h });
const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
const sale = () => ({ currency: 'IQD', lines: [{ itemId: teaId, qtyMilli: 1_000, unitPrice: 2_500 }] });
const shiftBody = (register: string) => ({ register, cashAccountCode: '1811', warehouseId, openingCash: 0 });

async function setUp(database: Db) {
  db = database;
  app = buildApp(db);
  warehouseId = (await get('/api/warehouses', owner)).json()[0].id;
  teaId = (await post('/api/items', { code: 'TEA', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 2_500, saleCurrency: 'IQD' }, owner)).json().id;
  const doc = await post('/api/stock-docs', { kind: 'opening', date: '2026-01-01', warehouseId, counterAccountCode: '21', lines: [{ itemId: teaId, qtyMilli: 50_000, unitCost: 1_500 }] }, owner);
  expect((await post(`/api/stock-docs/${doc.json().id}/post`, {}, owner)).statusCode).toBe(200);
}

/** Sign-in on, with these people (password `<username>-pass-123`); the owner is "admin". */
async function signIn(people: Record<string, string[]>): Promise<Record<string, H>> {
  await post('/api/plan/trial', {}, owner);
  const ownerId = (await get('/api/users', owner)).json()[0].id;
  expect((await post(`/api/users/${ownerId}/password`, { password: 'admin-pass-123' }, owner)).statusCode).toBe(200);
  for (const [username, roles] of Object.entries(people)) {
    const made = await post('/api/users', { username, name: username[0]!.toUpperCase() + username.slice(1), password: `${username}-pass-123`, roles }, owner);
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

beforeEach(async () => {
  resetLoginThrottle();
  await setUp(openDatabase(':memory:'));
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('the Point of sale role', () => {
  it('is a role of its own granting the pos permission; the admin role has it, the sales role does not', () => {
    expect(ROLES).toEqual(['admin', 'preparer', 'checker', 'approver', 'sales', 'pos', 'supervisor', 'purchasing', 'storekeeper', 'viewer']);
    expect(permissionsOf(['pos'])).toEqual(['pos']);
    expect(permissionsOf(['admin'])).toContain('pos');
    expect(permissionsOf(['sales'])).toEqual(['sales']);
    for (const r of ROLES.filter((x) => x !== 'admin' && x !== 'pos')) expect(permissionsOf([r]), r).not.toContain('pos');
    // a person with pos (alone or with sales) is a cashier: no books, no cost
    for (const roles of [['pos'], ['sales', 'pos']] as const) {
      const actor = { roles: [...roles], permissions: permissionsOf([...roles]) };
      expect(seesBooks(actor)).toBe(false);
      expect(seesCost(actor)).toBe(false);
    }
  });

  it('is saved for a user and shown back', async () => {
    await post('/api/plan/trial', {}, owner);
    const made = await post('/api/users', { username: 'las', name: 'Las', password: 'las-pass-123', roles: ['sales', 'pos'] }, owner);
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json().roles).toEqual(['sales', 'pos']);
    expect((await post('/api/users', { username: 'raz', name: 'Raz', roles: ['cashier'] }, owner)).statusCode).toBe(400);
  });
});

describe('the till API needs the pos permission (403 otherwise)', () => {
  it('refuses opening, selling, closing and the till’s own reads without pos; sales + pos, pos alone and an admin may', async () => {
    const who = await signIn({ las: ['sales'], raz: ['sales', 'pos'], mer: ['pos'], keeper: ['storekeeper'] });
    // the sales role alone, and a storekeeper: refused before anything is made
    for (const name of ['las', 'keeper']) {
      const h = who[name]!;
      const opened = await post('/api/pos/shifts', shiftBody(`Counter ${name}`), h);
      expect(opened.statusCode, name).toBe(403);
      expect(opened.json()).toMatchObject({ error: 'forbidden', details: { need: 'pos' } });
      expect((await get('/api/pos/current', h)).statusCode, name).toBe(403);
      expect((await get('/api/pos/payment-accounts', h)).statusCode, name).toBe(403);
    }
    expect(count('pos_shifts')).toBe(0);
    // sales + pos, and pos alone: open, sell, X report, close, Z report
    for (const name of ['raz', 'mer']) {
      const h = who[name]!;
      const opened = await post('/api/pos/shifts', shiftBody(`Counter ${name}`), h);
      expect(opened.statusCode, opened.body).toBe(201);
      expect(opened.json().actions).toEqual(['sell', 'close']);
      expect((await post(`/api/pos/shifts/${opened.json().id}/sales`, sale(), h)).statusCode).toBe(201);
      expect((await get('/api/pos/current', h)).json().shift.id).toBe(opened.json().id);
      expect((await get(`/api/pos/shifts/${opened.json().id}`, h)).json().count).toBe(1);
      expect((await post(`/api/pos/shifts/${opened.json().id}/close`, { countedCash: 2_500 }, h)).statusCode).toBe(200);
      expect((await get(`/api/pos/shifts/${opened.json().id}`, h)).json()).toMatchObject({ status: 'closed', difference: { IQD: 0, USD: 0 } });
    }
    // an admin
    const boss = await post('/api/pos/shifts', shiftBody('Counter boss'), who.admin!);
    expect(boss.statusCode).toBe(201);
    expect((await post(`/api/pos/shifts/${boss.json().id}/sales`, sale(), who.admin!)).statusCode).toBe(201);
    // the sales role alone can't sell on, or close, a shift that is open (not even with the shift's id)
    expect((await post(`/api/pos/shifts/${boss.json().id}/sales`, sale(), who.las!)).statusCode).toBe(403);
    expect((await post(`/api/pos/shifts/${boss.json().id}/close`, { countedCash: 0 }, who.las!)).statusCode).toBe(403);
    expect(count('pos_sales')).toBe(3);
    // the card and wallet accounts stay the admin's to set
    expect((await app.inject({ method: 'PUT', url: '/api/pos/payment-accounts', payload: {}, headers: who.raz! })).statusCode).toBe(403);
  });

  it('keeps the cashier rules for sales + pos and for pos alone: own shifts only, no cost', async () => {
    const who = await signIn({ raz: ['sales', 'pos'], mer: ['pos'], acc: ['preparer'] });
    const razShift = (await post('/api/pos/shifts', shiftBody('Counter 1'), who.raz!)).json();
    const merShift = (await post('/api/pos/shifts', shiftBody('Counter 2'), who.mer!)).json();
    await post(`/api/pos/shifts/${razShift.id}/sales`, sale(), who.raz!);
    // not another cashier's shift: neither selling on it nor reading it
    expect((await post(`/api/pos/shifts/${razShift.id}/sales`, sale(), who.mer!)).statusCode).toBe(403);
    expect((await get(`/api/pos/shifts/${razShift.id}`, who.mer!)).statusCode).toBe(404);
    expect((await get('/api/pos/shifts', who.mer!)).json().map((s: { id: string }) => s.id)).toEqual([merShift.id]);
    expect((await get('/api/pos/shifts', who.raz!)).json().map((s: { id: string }) => s.id)).toEqual([razShift.id]);
    // the books' people read every shift's report, without pos (reading old shift reports is not the till)
    expect((await get(`/api/pos/shifts/${razShift.id}`, who.acc!)).json().count).toBe(1);
    expect((await get('/api/pos/shifts', who.acc!)).json()).toHaveLength(2);
    // no cost or profit for a cashier with pos
    for (const name of ['raz', 'mer']) {
      const me = (await get('/api/auth/me', who[name]!)).json();
      expect(me.user).toMatchObject({ seesCost: false, seesBooks: false });
      expect(me.user.permissions).toContain('pos');
    }
  });

  it('refuses a till sale kept offline and sent later (the outbox) by someone without pos: nothing is booked', async () => {
    const who = await signIn({ raz: ['sales', 'pos'], las: ['sales'] });
    const shift = (await post('/api/pos/shifts', shiftBody('Counter 1'), who.raz!)).json();
    const books = (await get('/api/outbox/books', who.raz!)).json().books as string;
    const kept = (h: H) => ({ ...h, 'x-qasa-idempotency': randomUUID(), 'x-qasa-books': books });
    const offline = { reference: 'OFF-Counter1-0001', soldAt: new Date().toISOString(), soldOn: new Date().toISOString().slice(0, 10) };
    const refused = await post(`/api/pos/shifts/${shift.id}/sales`, { ...sale(), offline }, kept(who.las!));
    expect(refused.statusCode).toBe(403);
    expect(count('pos_sales')).toBe(0);
    expect(count('pos_offline_sales')).toBe(0);
    // the same sale from someone with pos (the shift's own cashier) is booked once
    const key = kept(who.raz!);
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { ...sale(), offline }, key)).statusCode).toBe(201);
    expect((await post(`/api/pos/shifts/${shift.id}/sales`, { ...sale(), offline }, key)).statusCode).toBe(201);
    expect(count('pos_sales')).toBe(1);
  });
});

describe('the update gives nobody the till', () => {
  it('leaves a user who had the sales role with sales only: after the update they can no longer use the till', async () => {
    await app.close();
    db.close();
    const dir = mkdtempSync(join(tmpdir(), 'qasa-pos-perm-'));
    try {
      const file = join(dir, 'company.db');
      await setUp(openDatabase(file));
      const who = await signIn({ las: ['sales'] });
      // as a company file of an older version keeps it: the sales role only
      expect((db.prepare("SELECT roles FROM users WHERE username = 'las'").get() as { roles: string }).roles).toBe('["sales"]');
      await app.close();
      db.close();
      // opened again by this version (every upgrade step runs again where due): the roles stay as they were
      resetLoginThrottle();
      db = openDatabase(file);
      app = buildApp(db);
      expect((db.prepare("SELECT roles FROM users WHERE username = 'las'").get() as { roles: string }).roles).toBe('["sales"]');
      const me = (await get('/api/auth/me', who.las!)).json();
      expect(me.user.permissions).toEqual(['sales']);
      expect((await post('/api/pos/shifts', shiftBody('Counter 1'), who.las!)).statusCode).toBe(403);
      // they still sell with sales invoices
      const invoice = await post('/api/invoices', { kind: 'sale', date: '2026-11-17', warehouseId, currency: 'IQD', rateX100: 100, discount: 0, payment: 'cash', cashAccountCode: '1811', lines: [{ itemId: teaId, qtyMilli: 1_000, unitPrice: 2_500 }] }, who.las!);
      expect(invoice.statusCode, invoice.body).toBe(201);
      // an admin gives the role: then the till is theirs
      const id = (db.prepare("SELECT id FROM users WHERE username = 'las'").get() as { id: string }).id;
      const given = await app.inject({ method: 'PUT', url: `/api/users/${id}`, payload: { username: 'las', name: 'Las', roles: ['sales', 'pos'], active: true }, headers: (await signInAgain('admin')) });
      expect(given.statusCode, given.body).toBe(200);
      expect((await post('/api/pos/shifts', shiftBody('Counter 1'), await signInAgain('las'))).statusCode).toBe(201);
    } finally {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
      // afterEach closes them again: give it a fresh pair
      db = openDatabase(':memory:');
      app = buildApp(db);
    }
  });
});

async function signInAgain(username: string): Promise<H> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: `${username}-pass-123` }, headers: { 'x-qasa-client': '1' } });
  expect(res.statusCode, res.body).toBe(200);
  return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
}
