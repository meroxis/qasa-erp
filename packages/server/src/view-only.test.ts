import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, changesRecords, configureViewOnly, registeredRoutes, VIEW_ONLY_ALLOWED } from './app.ts';
import { openDatabase } from './db.ts';

// A company past the plan's limit opens view-only: no request changes it, however its address is written
// (review of the fixes, finding 9: "/%61pi/items" reached the route while the check read the raw text).
afterEach(() => configureViewOnly(null));

describe('a view-only company', () => {
  it('refuses a change whatever way its address is written, and still lets reads and sign-in through', async () => {
    const db = openDatabase(':memory:');
    const app = buildApp(db);
    try {
      configureViewOnly(() => true);
      const item = { name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 100, saleCurrency: 'IQD' };
      const h = { 'x-qasa-client': '1' };
      const count = () => Number((db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n);
      for (const url of ['/api/items', '/%61pi/items', '/api/%69tems', '/%61%70%69/items', '/api//items', '/api/items/', '/api/items?x=1', '/API/items']) {
        const r = await app.inject({ method: 'POST', url, payload: item, headers: h });
        expect(r.statusCode, url).toBeGreaterThanOrEqual(400);
        expect(count(), url).toBe(0);
      }
      expect((await app.inject({ method: 'POST', url: '/%61pi/items', payload: item, headers: h })).json()).toMatchObject({ error: 'company_view_only' });
      expect((await app.inject({ method: 'PUT', url: '/%61pi/settings', payload: { companyName: { ar: 'x', en: 'x', ku: 'x' } }, headers: h })).statusCode).toBe(409);
      // a read that says it is a write, or a write that says it is a read, is what its own method is
      const sneaky = await app.inject({ method: 'GET', url: '/api/items', headers: { ...h, 'x-http-method-override': 'POST', 'x-method-override': 'POST' }, payload: item });
      expect(sneaky.statusCode).toBe(200);
      expect(count()).toBe(0);
      const disguised = await app.inject({ method: 'POST', url: '/api/items', payload: item, headers: { ...h, 'x-http-method-override': 'GET' } });
      expect(disguised.json()).toMatchObject({ error: 'company_view_only' });
      expect((await app.inject({ method: 'GET', url: '/api/items' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/api/plan' })).statusCode).toBe(200);
      configureViewOnly(null);
      expect((await app.inject({ method: 'POST', url: '/api/items', payload: item, headers: h })).statusCode).toBe(201);
    } finally {
      await app.close();
      db.close();
    }
  });

  it('reads an address as the router does', () => {
    expect(changesRecords('POST', '/%61pi/items')).toBe(true);
    expect(changesRecords('POST', '/api//items/')).toBe(true);
    expect(changesRecords('POST', '/api/%E0%A4%A')).toBe(true);
    expect(changesRecords('POST', '/api/backup/restore')).toBe(true);
    expect(changesRecords('PUT', '/api/backup')).toBe(false);
    expect(changesRecords('POST', '/%61pi/auth/login')).toBe(false);
    expect(changesRecords('GET', '/api/items')).toBe(false);
  });

  it('opens exact routes only, never everything under an address (round four)', () => {
    // these passed while /api/auth and /api/backup were open as a whole
    for (const [method, route] of [['PUT', '/api/auth/signin'], ['PUT', '/api/auth/separate-duties'], ['POST', '/api/backup/cloud/restore'], ['POST', '/api/backup/restore'],
      ['PUT', '/api/auth/hello-reset'], ['DELETE', '/api/auth/hello-reset'], ['POST', '/api/auth/recovery-code'], ['DELETE', '/api/auth/reset-notice']] as const) {
      expect(changesRecords(method, route), `${method} ${route}`).toBe(true);
    }
    // a route nobody listed is closed, wherever it is; another method on a listed address too
    expect(changesRecords('POST', '/api/auth/anything-new')).toBe(true);
    expect(changesRecords('POST', '/api/backup')).toBe(true);
    expect(changesRecords('DELETE', '/api/auth/login')).toBe(true);
    expect(changesRecords('POST', '/api/auth/login/extra')).toBe(true);
    expect(changesRecords('POST', '/api/plan/license/../../items')).toBe(true);
    // the listed ones, as a route and as an address that names a company
    expect(changesRecords('post', '/api/auth/login')).toBe(false);
    expect(changesRecords('POST', '/api/companies/:id/open')).toBe(false);
    expect(changesRecords('POST', '/api/companies/3f2a/open')).toBe(false);
    expect(changesRecords('POST', '/api/companies/3f2a/b/open')).toBe(true);
    expect(changesRecords('POST', '/api/companies/3f2a/delete')).toBe(true);
  });

  it('refuses every route that is not a read, one by one, unless it is on the list (the sweep)', async () => {
    const db = openDatabase(':memory:');
    const app = buildApp(db);
    try {
      await app.ready();
      const writes = registeredRoutes(app).filter((r) => !['GET', 'HEAD', 'OPTIONS'].includes(r.method));
      expect(writes.length).toBeGreaterThan(150);
      configureViewOnly(() => true);
      const open: string[] = [];
      for (const r of writes) {
        const url = r.url.replace(/:[A-Za-z]+/g, 'x1');
        const res = await app.inject({ method: r.method as 'POST', url, payload: {}, headers: { 'x-qasa-client': '1' } });
        const refused = res.statusCode === 409 && (res.json() as { error?: string }).error === 'company_view_only';
        if (!refused) open.push(`${r.method} ${r.url}`);
        expect(refused, `${r.method} ${r.url}`).toBe(!VIEW_ONLY_ALLOWED.has(`${r.method} ${r.url}`));
      }
      // what this server leaves open, by name: nothing else
      expect(open.sort()).toEqual(['DELETE /api/plan/license', 'POST /api/auth/login', 'POST /api/auth/logout', 'POST /api/auth/password', 'POST /api/plan/activate', 'POST /api/plan/check',
        'POST /api/plan/deactivate', 'POST /api/plan/license', 'POST /api/plan/trial', 'POST /api/usage/context', 'PUT /api/usage']);
      // reads still pass
      expect((await app.inject({ method: 'GET', url: '/api/items' })).statusCode).toBe(200);
    } finally {
      await app.close();
      db.close();
    }
  });
});
