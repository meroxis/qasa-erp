import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, MODULE_ROUTES } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { apiRoutes } from './routes.ts';

// 1.4: the server says which module routes the build serves beside its own (/api/auth/me → modules), so the app asks
// only for what is there: a build without the Pro module is not asked for backups, the office network, phones or a
// database server (each such request was answered "not found").

let db: Db;
let app: FastifyInstance;
const headers = { 'x-qasa-client': '1', 'x-qasa-user': encodeURIComponent('Mer') };
const modules = async () => (await app.inject({ url: '/api/auth/me', headers })).json().modules as string[];

beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp(db);
});
afterEach(async () => { await app.close(); db.close(); });

describe('what the build serves beside the app\'s own routes', () => {
  it('is nothing in a build without a module, and none of those addresses answers', async () => {
    expect(await modules()).toEqual([]);
    for (const url of Object.values(MODULE_ROUTES)) expect((await app.inject({ url, headers })).statusCode, url).toBe(404);
  });

  it('names a module once its routes are added to the server, as the Pro module adds them after the app is built', async () => {
    app.get('/api/backup', async () => ({ on: false }));
    expect(await modules()).toEqual(['backup']);
    // (routes are added before a server starts: a second server stands for the build with all of them)
    const full = buildApp(db);
    full.get('/api/backup', async () => ({ on: false }));
    full.get('/api/network', async () => ({ on: false }));
    full.get('/api/phones', async () => ({ phones: [] }));
    full.get('/api/database', async () => ({ kind: 'file' }));
    // the medicines of a pharmacy and the module's own licence check are asked for only where they are served
    full.get('/api/pharmacy', async () => ({ available: true }));
    full.get('/api/pro/licence-check', async () => ({ heldBack: false, reason: null }));
    try {
      expect((await full.inject({ url: '/api/auth/me', headers })).json().modules).toEqual(['backup', 'network', 'phones', 'database', 'pharmacy', 'pro']);
    } finally {
      await full.close();
    }
  });

  it('none of the names is a route of the app itself, and the website demo (no server) has none', () => {
    const own = new Set(apiRoutes(db).map((r) => `${r.method} ${r.path}`));
    for (const url of Object.values(MODULE_ROUTES)) expect(own.has(`GET ${url}`), url).toBe(false);
    const me = apiRoutes(db, { demo: true }).find((r) => r.method === 'GET' && r.path === '/api/auth/me')!;
    return expect(me.handler({ params: {}, query: {}, body: undefined, headers: {} } as never, {} as never)).resolves.toMatchObject({ demo: true, modules: [] });
  });
});
