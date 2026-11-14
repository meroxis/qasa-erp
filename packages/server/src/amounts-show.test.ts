import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { getSettings, updateSettings, writeSetting } from './settings.ts';

// Settings → Language and display → "Show amounts in": one choice for the whole company, kept with its settings.
// Dinar only is the default, so a company that never chose sees what it always saw.

let db: Db;
let app: FastifyInstance;

beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
});

const put = (body: unknown) => app.inject({ method: 'PUT', url: '/api/settings', payload: body as object, headers: { 'x-qasa-user': 'Mer' } });

describe('how the company sees amounts', () => {
  it('is dinar only until it is chosen', async () => {
    expect(getSettings(db).amountsShow).toBe('iqd');
    expect((await app.inject('/api/settings')).json().amountsShow).toBe('iqd');
  });

  it('keeps each of the three choices, and leaves the other settings as they were', async () => {
    const before = getSettings(db);
    for (const choice of ['iqd_usd', 'usd_iqd', 'iqd'] as const) {
      const res = await put({ amountsShow: choice });
      expect(res.statusCode).toBe(200);
      expect(res.json().amountsShow).toBe(choice);
      expect(getSettings(db).amountsShow).toBe(choice);
    }
    const after = getSettings(db);
    expect(after.defaultRateX100).toBe(before.defaultRateX100);
    expect(after.fiscalYearStart).toBe(before.fiscalYearStart);
    // saving the company's details without the choice does not reset it
    await put({ amountsShow: 'usd_iqd' });
    await put({ defaultRateX100: 131000 });
    expect(getSettings(db).amountsShow).toBe('usd_iqd');
  });

  it('refuses anything else, and nothing is saved', async () => {
    await put({ amountsShow: 'iqd_usd' });
    for (const bad of ['usd', 'IQD', '', 'iqd_usd ', 1, null, ['iqd'], { v: 'iqd' }]) {
      const res = await put({ amountsShow: bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(getSettings(db).amountsShow).toBe('iqd_usd');
    // the server's own function checks too (it is called from other places than the API)
    expect(() => updateSettings(db, { amountsShow: 'eur' as never }, 'Mer')).toThrow();
    expect(getSettings(db).amountsShow).toBe('iqd_usd');
  });

  it('reads a value it does not know (from a newer version, or edited by hand) as dinar only', () => {
    writeSetting(db, 'amounts_show', 'eur_iqd');
    expect(getSettings(db).amountsShow).toBe('iqd');
  });

  it('writes the change in the audit log', async () => {
    await put({ amountsShow: 'usd_iqd' });
    const row = db.prepare("SELECT details FROM audit_log WHERE entity = 'settings' ORDER BY id DESC LIMIT 1").get() as { details: string } | undefined;
    expect(row?.details).toContain('usd_iqd');
  });
});
