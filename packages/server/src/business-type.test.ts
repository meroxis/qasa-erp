import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';

let db: Db;
let app: FastifyInstance;
const headers = { 'x-qasa-client': '1', 'x-qasa-user': 'Mer' };

beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp(db);
});
afterEach(async () => {
  await app.close();
  db.close();
});

describe('business type', () => {
  it('is unset until chosen, then keeps the industries asked for, once each and in order', async () => {
    expect((await app.inject({ url: '/api/settings', headers })).json().businessTypes).toBeNull();
    const saved = await app.inject({ method: 'PUT', url: '/api/settings', headers, payload: { businessTypes: ['autoParts', 'trade', 'autoParts'] } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().businessTypes).toEqual(['autoParts', 'trade']);
  });

  it('refuses an empty choice or an unknown industry', async () => {
    for (const businessTypes of [[], ['bakery']]) {
      const res = await app.inject({ method: 'PUT', url: '/api/settings', headers, payload: { businessTypes } });
      expect(res.statusCode).toBe(400);
    }
  });
});
