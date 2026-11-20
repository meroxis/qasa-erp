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

  it('keeps one main type (1.7) and the list every older reader uses, main first', async () => {
    const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/settings', headers, payload });
    const first = await put({ businessType: 'pharmacy' });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ businessType: 'pharmacy', businessTypesExtra: [], businessTypes: ['pharmacy'] });
    // a pharmacy's new items carry expiry dates, as before
    expect(db.prepare("SELECT value FROM settings WHERE key = 'default_track_expiry'").get()).toMatchObject({ value: '1' });
    // what the company also does: up to two
    const also = await put({ businessTypesExtra: ['market', 'mobileShop'] });
    expect(also.json()).toMatchObject({ businessType: 'pharmacy', businessTypesExtra: ['market', 'mobileShop'], businessTypes: ['pharmacy', 'market', 'mobileShop'] });
    // the company file keeps the full list, so an app from before 1.7 shows the same pages
    expect(JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'business_types'").get() as { value: string }).value)).toEqual(['pharmacy', 'market', 'mobileShop']);
    // a new main type keeps the extras (all but itself); the old main one is only hidden
    const changed = await put({ businessType: 'market' });
    expect(changed.json()).toMatchObject({ businessType: 'market', businessTypesExtra: ['mobileShop'], businessTypes: ['market', 'mobileShop'] });
  });

  it('refuses a third extra, the main one among them, the same one twice, and both ways at once', async () => {
    const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/settings', headers, payload });
    await put({ businessType: 'market' });
    const cases: [object, string][] = [
      [{ businessTypesExtra: ['pharmacy', 'mobileShop', 'autoParts'] }, 'business_type_too_many_extras'],
      [{ businessTypesExtra: ['market'] }, 'business_type_extra_is_main'],
      [{ businessTypesExtra: ['pharmacy', 'pharmacy'] }, 'business_type_extra_twice'],
      [{ businessTypes: ['market'], businessType: 'market' }, 'business_type_one_way']
    ];
    for (const [payload, code] of cases) {
      const res = await put(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(JSON.stringify(res.json())).toContain(code);
    }
    expect((await put({ businessType: 'bakery' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/settings', headers })).json()).toMatchObject({ businessType: 'market', businessTypesExtra: [] });
  });

  it('asks for the main type before extras on a company that has none', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/settings', headers, payload: { businessTypesExtra: ['market'] } });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain('business_type_required');
  });

  it('reads a company from before 1.7 with every page it had, and lets it keep more than two extras', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('business_types', ?)").run(JSON.stringify(['trade', 'mobileShop', 'autoParts', 'electricalSolar']));
    const got = (await app.inject({ url: '/api/settings', headers })).json();
    expect(got).toMatchObject({ businessType: 'mobileShop', businessTypesExtra: ['trade', 'autoParts', 'electricalSolar'] });
    expect([...got.businessTypes].sort()).toEqual(['autoParts', 'electricalSolar', 'mobileShop', 'trade']);
    const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/settings', headers, payload });
    // saving them again, or fewer of them, is fine; a new one on top is not
    expect((await put({ businessTypesExtra: ['trade', 'autoParts', 'electricalSolar'] })).statusCode).toBe(200);
    expect((await put({ businessTypesExtra: ['trade', 'autoParts', 'electricalSolar', 'generators'] })).statusCode).toBe(400);
    expect((await put({ businessTypesExtra: ['trade', 'autoParts'] })).statusCode).toBe(200);
    expect((await put({ businessTypesExtra: ['trade', 'autoParts', 'generators'] })).statusCode).toBe(400);
  });

  it('takes the old list from an app before 1.7 (an office PC not updated yet): its first industry is the main type', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/settings', headers, payload: { businessTypes: ['trade', 'pharmacy'] } });
    expect(res.json()).toMatchObject({ businessType: 'pharmacy', businessTypesExtra: ['trade'], businessTypes: ['pharmacy', 'trade'] });
  });

  // only an admin changes it: PUT /api/settings is admin-only (auth.test.ts)
});
