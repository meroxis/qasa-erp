import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, SCHEMA_VERSION, type Db } from './db.ts';

// Settings → About → Remote support, "Copy support details": the company file's schema version, and nothing else.
let db: Db;
let app: FastifyInstance;
beforeEach(() => { db = openDatabase(':memory:'); app = buildApp(db); });
afterEach(async () => { await app.close(); db.close(); });

it('answers the company file’s schema version and the app’s', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/support', headers: { 'x-qasa-client': '1', 'x-qasa-user': 'Mer' } });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ schema: SCHEMA_VERSION, app: SCHEMA_VERSION });
});
