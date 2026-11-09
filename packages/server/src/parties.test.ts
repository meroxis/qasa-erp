import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { isForeignKeyFailure } from './parties.ts';

let db: Db;
let app: FastifyInstance;

const headers = { 'x-qasa-user': encodeURIComponent('Mer') };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const del = (url: string) => app.inject({ method: 'DELETE', url, headers });

beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
});

const customer = async (name: string) => (await post('/api/parties', { type: 'customer', name })).json().id as string;

describe('deleting a customer', () => {
  it('refuses one that a quotation keeps, with a clear answer instead of a server error', async () => {
    const id = await customer('Mer');
    const q = await post('/api/quotes', {
      date: '2026-11-01', validUntil: '2026-11-15', partyId: id, currency: 'IQD', discount: 0,
      lines: [{ description: 'Installation', qtyMilli: 1000, unitPrice: 75_000 }]
    });
    expect(q.statusCode, q.body).toBe(201);
    const res = await del(`/api/parties/${id}`);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().error).toBe('party_has_entries');
    expect((await app.inject({ url: `/api/parties/${id}`, headers })).json().hasEntries).toBe(true);
  });

  it('deletes one with only a price list, and the price list with it', async () => {
    const id = await customer('Las');
    db.prepare("INSERT INTO party_price_lists (party_id, list) VALUES (?, 'wholesale')").run(id);
    expect((await del(`/api/parties/${id}`)).statusCode).toBe(204);
    expect(db.prepare('SELECT COUNT(*) AS n FROM party_price_lists').get()).toMatchObject({ n: 0 });
  });

  it('turns a foreign key refusal from either database into a conflict', () => {
    expect(isForeignKeyFailure(new Error('FOREIGN KEY constraint failed'))).toBe(true);
    expect(isForeignKeyFailure(Object.assign(new Error('Cannot delete or update a parent row'), { code: 'ER_ROW_IS_REFERENCED_2', errno: 1451 }))).toBe(true);
    expect(isForeignKeyFailure(new Error('database is locked'))).toBe(false);
  });
});

describe('a customer\'s credit limit', () => {
  it('stays as it is when an edit leaves it out; it goes only when the edit says null', async () => {
    const put = (id: string, body: object) => app.inject({ method: 'PUT', url: `/api/parties/${id}`, payload: body, headers });
    const id = (await post('/api/parties', { type: 'customer', name: 'Raz', creditLimit: 100_000 })).json().id as string;
    expect((await put(id, { type: 'customer', name: 'Raz Trading' })).json()).toMatchObject({ name: 'Raz Trading', creditLimit: 100_000 });
    expect((await put(id, { type: 'customer', name: 'Raz Trading', creditLimit: 150_000 })).json().creditLimit).toBe(150_000);
    const audit = db.prepare("SELECT details FROM audit_log WHERE action = 'update' AND entity = 'party' ORDER BY id DESC LIMIT 1").get() as { details: string };
    expect(JSON.parse(audit.details)).toMatchObject({ creditLimitBefore: 100_000, creditLimit: 150_000 });
    expect((await put(id, { type: 'customer', name: 'Raz Trading', creditLimit: null })).json().creditLimit).toBeNull();
  });
});
