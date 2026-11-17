import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { seedDemo } from './demo-data.ts';
import { seedPetrolStationDemo } from './demo-petrol.ts';
import { getEntry } from './journal.ts';

// Petrol stations (prototype): pumps and nozzles, the shift sheet with its meter readings, and the entry a closed shift
// posts (the safe, the fuels' revenue, a shortage or cash over), behind the plan and the permissions.

let db: Db;
let app: FastifyInstance;
type H = Record<string, string>;
const owner: H = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, h: H = owner) =>
  app.inject({ method, url, headers: h, ...(body === undefined ? {} : { payload: body as object }) });

beforeEach(() => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function station() {
  expect((await call('POST', '/api/plan/trial', {})).statusCode).toBe(200);
  const reg = (await call('POST', '/api/fuel/types', { code: 'B-REG', name: { ar: 'بنزين عادي', en: 'Regular benzine', ku: 'بەنزینی ئاسایی' }, price: 850 })).json();
  const dsl = (await call('POST', '/api/fuel/types', { code: 'GASOIL', name: { ar: 'كاز', en: 'Diesel', ku: 'گازۆیل' }, price: 750 })).json();
  const pump = await call('POST', '/api/fuel/pumps', { number: 1, nozzles: [{ number: 1, fuelTypeId: reg.id, meterMilli: 100_000_000 }, { number: 2, fuelTypeId: dsl.id, meterMilli: 50_000_000 }] });
  expect(pump.statusCode, pump.body).toBe(201);
  return { reg, dsl, pump: pump.json() as { id: string; nozzles: { id: string }[] } };
}

async function openOn(pumpId: string, h: H = owner) {
  return call('POST', '/api/fuel/shifts', { date: '2026-11-17', shift: 'morning', attendant: 'Las', pumpIds: [pumpId] }, h);
}

describe('petrol station shifts', () => {
  it('need the Pro plan (the month\'s trial counts)', async () => {
    expect((await call('POST', '/api/fuel/types', { code: 'X', name: { ar: 'x', en: 'x', ku: 'x' }, price: 1 })).json().error).toBe('plan_limit');
    expect((await call('GET', '/api/fuel/setup')).json().available).toBe(false);
  });

  it('open with the nozzles\' last readings, refuse a closing reading below the opening one, and name the nozzle', async () => {
    const { pump } = await station();
    const opened = await openOn(pump.id);
    expect(opened.statusCode, opened.body).toBe(201);
    const shift = opened.json();
    expect(shift.number).toBe('SH-0001');
    expect(shift.readings.map((r: { openingMilli: number }) => r.openingMilli)).toEqual([100_000_000, 50_000_000]);
    // the same pump cannot be in two open shifts
    expect((await openOn(pump.id)).json().error).toBe('fuel_nozzle_in_shift');

    const below = await call('PUT', `/api/fuel/shifts/${shift.id}`, { readings: [{ nozzleId: pump.nozzles[0]!.id, closingMilli: 99_999_000 }] });
    expect(below.statusCode).toBe(400);
    expect(below.json().details).toEqual([{ code: 'fuel_closing_below_opening', line: '1/1' }]);
    // a reading is a whole number of millilitres, never text or a fraction
    for (const bad of ['100600', 100_600_000.5, -1]) {
      expect((await call('PUT', `/api/fuel/shifts/${shift.id}`, { readings: [{ nozzleId: pump.nozzles[0]!.id, closingMilli: bad }] })).statusCode).toBe(400);
    }
    // the opening reading is the meter's last closing: it can't be typed in (raising it would hide litres sold)
    expect((await call('PUT', `/api/fuel/shifts/${shift.id}`, { readings: [{ nozzleId: pump.nozzles[0]!.id, openingMilli: 100_500_000, closingMilli: 100_600_000 }] })).statusCode).toBe(400);
    // closing needs every nozzle's closing reading
    const missing = await call('POST', `/api/fuel/shifts/${shift.id}/close`, { readings: [{ nozzleId: pump.nozzles[0]!.id, closingMilli: 100_600_000 }], handed: 510_000 });
    expect(missing.json().details).toEqual([{ code: 'fuel_closing_missing', line: '1/2' }]);
    // nothing was kept from the refused close
    expect((await call('GET', `/api/fuel/shifts/${shift.id}`)).json().status).toBe('open');
  });

  it('closing posts the sales, the safe and a shortage in one balanced entry, and moves the meters on', async () => {
    const { pump } = await station();
    const shift = (await openOn(pump.id)).json();
    // 600 L of regular at 850 = 510,000; 300 L of diesel at 750 = 225,000; 735,000 expected, 727,500 handed in
    const closed = await call('POST', `/api/fuel/shifts/${shift.id}/close`, {
      readings: [{ nozzleId: pump.nozzles[0]!.id, closingMilli: 100_600_000 }, { nozzleId: pump.nozzles[1]!.id, closingMilli: 50_300_000 }],
      handed: 727_500, lang: 'en'
    });
    expect(closed.statusCode, closed.body).toBe(200);
    const view = closed.json();
    expect(view.status).toBe('closed');
    expect(view.cash).toMatchObject({ sales: 735_000, expected: 735_000, handed: 727_500, difference: -7_500, result: 'short' });
    const entry = getEntry(db, view.entry.id);
    const lines = entry.lines.map((l) => [l.accountCode, l.debit, l.credit]);
    expect(lines).toEqual([['1811', 727_500, 0], ['1661', 7_500, 0], ['42', 0, 510_000], ['42', 0, 225_000]]);
    expect(entry.lines.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0);
    // the next shift opens where this one closed
    const setup = (await call('GET', '/api/fuel/setup')).json();
    expect(setup.pumps[0].nozzles.map((n: { meterMilli: number }) => n.meterMilli)).toEqual([100_600_000, 50_300_000]);
    const next = (await openOn(pump.id)).json();
    expect(next.readings.map((r: { openingMilli: number }) => r.openingMilli)).toEqual([100_600_000, 50_300_000]);
    // a closed shift is final
    expect((await call('PUT', `/api/fuel/shifts/${shift.id}`, { readings: [] })).json().error).toBe('action_not_allowed');
  });

  it('cash over and sales on credit are posted to their own accounts', async () => {
    const { pump } = await station();
    const shift = (await openOn(pump.id)).json();
    const closed = (await call('POST', `/api/fuel/shifts/${shift.id}/close`, {
      readings: [{ nozzleId: pump.nozzles[0]!.id, closingMilli: 100_100_000 }, { nozzleId: pump.nozzles[1]!.id, closingMilli: 50_000_000 }],
      credit: 35_000, handed: 52_000, lang: 'ar'
    })).json();
    // 100 L × 850 = 85,000; 35,000 on credit; 50,000 expected; 52,000 handed in: 2,000 over
    expect(closed.cash).toMatchObject({ expected: 50_000, difference: 2_000, result: 'over' });
    expect(getEntry(db, closed.entry.id).lines.map((l) => [l.accountCode, l.debit, l.credit]))
      .toEqual([['1811', 52_000, 0], ['1611', 35_000, 0], ['42', 0, 85_000], ['49', 0, 2_000]]);
    // credit can't be more than the litres sold
    const again = (await openOn(pump.id)).json();
    expect((await call('PUT', `/api/fuel/shifts/${again.id}`, { readings: [], credit: 1 })).json().details).toEqual([{ code: 'fuel_credit_over_sales', field: 'credit' }]);
  });

  it('the shift sheet is the sales permission; fuels, prices and pumps need an admin', async () => {
    const { pump, reg } = await station();
    const ownerId = (await call('GET', '/api/users')).json()[0].id;
    expect((await call('POST', `/api/users/${ownerId}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
    for (const [username, roles] of [['las', ['sales']], ['raz', ['viewer']]] as const) {
      expect((await call('POST', '/api/users', { username, name: username === 'las' ? 'Las' : 'Raz', password: `${username}-pass-123`, roles })).statusCode).toBe(201);
    }
    expect((await call('PUT', '/api/auth/signin', { on: true })).statusCode).toBe(200);
    const login = async (username: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: `${username}-pass-123` }, headers: { 'x-qasa-client': '1' } });
      expect(res.statusCode, res.body).toBe(200);
      return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    };
    const las = await login('las');
    const raz = await login('raz');
    expect((await openOn(pump.id, raz)).statusCode).toBe(403);
    const opened = await openOn(pump.id, las);
    expect(opened.statusCode, opened.body).toBe(201);
    expect((await call('PUT', `/api/fuel/types/${reg.id}`, { code: 'B-REG', name: reg.name, price: 1 }, las)).statusCode).toBe(403);
    expect((await call('PUT', '/api/fuel/settings', { shortAccount: '39' }, las)).statusCode).toBe(403);
    expect((await call('GET', '/api/fuel/setup', undefined, raz)).statusCode).toBe(200);
    // nobody signed in: nothing at all
    expect((await call('GET', '/api/fuel/setup', undefined, { 'x-qasa-client': '1' })).statusCode).toBe(401);
  });

  it('settings take only postable accounts of the right kind', async () => {
    await station();
    const bad = await call('PUT', '/api/fuel/settings', { cashAccount: '42', overAccount: '18' });
    expect(bad.json().details.map((d: { field: string }) => d.field).sort()).toEqual(['cashAccount', 'overAccount']);
    expect((await call('PUT', '/api/fuel/settings', { shortAccount: '39' })).json().shortAccount).toBe('39');
    expect((await call('PUT', '/api/fuel/settings', { shortAccount: "39' OR 1=1 --" })).statusCode).toBe(400);
  });
});

describe('the petrol station sample (website demo, ?petrol)', () => {
  it('has three fuels, four pumps of two nozzles, closed shifts by Mer, Las and Raz with approved, balanced entries, and one open shift', () => {
    seedDemo(db);
    seedPetrolStationDemo(db);
    const shifts = db.prepare('SELECT attendant, status, difference, entry_id FROM fuel_shifts ORDER BY number').all() as
      { attendant: string; status: string; difference: number | null; entry_id: string | null }[];
    expect(shifts.map((s) => s.status)).toEqual(['closed', 'closed', 'closed', 'closed', 'closed', 'open']);
    expect(new Set(shifts.map((s) => s.attendant))).toEqual(new Set(['Mer', 'Las', 'Raz']));
    expect(shifts.some((s) => (s.difference ?? 0) < 0)).toBe(true);
    for (const s of shifts.filter((x) => x.entry_id)) {
      const e = getEntry(db, s.entry_id!);
      expect(e.status).toBe('approved');
      expect(e.lines.reduce((sum, l) => sum + l.debit - l.credit, 0)).toBe(0);
    }
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM fuel_nozzles').get() as { n: number }).n)).toBe(8);
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM fuel_types').get() as { n: number }).n)).toBe(3);
  });
});
