import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, changesRecords, configureViewOnly } from './app.ts';
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
    expect(changesRecords('POST', '/api/backup')).toBe(false);
    expect(changesRecords('POST', '/%61pi/auth/login')).toBe(false);
    expect(changesRecords('GET', '/api/items')).toBe(false);
  });
});
