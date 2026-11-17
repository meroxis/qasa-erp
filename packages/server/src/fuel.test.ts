import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { seedDemo } from './demo-data.ts';
import { cylinderChart, seedPetrolStationDemo } from './demo-petrol.ts';
import { getEntry } from './journal.ts';
import { listAccounts } from './accounts.ts';
import { writeSetting } from './settings.ts';

// Petrol stations: tanks with their book stock and average cost, pumps and nozzles, the shift sheet with its meter
// readings (and a meter's rollover), tanker deliveries and dips, the entries each posts and their reversals, behind the
// plan, the permissions (the sheet is Point of sale), and cost kept from those who may not see it.

let db: Db;
let app: FastifyInstance;
type H = Record<string, string>;
const owner: H = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
let as: H = owner;
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, h: H = as) =>
  app.inject({ method, url, headers: h, ...(body === undefined ? {} : { payload: body as object }) });
const lines = (entryId: string) => getEntry(db, entryId).lines.map((l) => [l.accountCode, l.debit, l.credit]);
const balanced = (entryId: string) => getEntry(db, entryId).lines.reduce((s, l) => s + l.debit - l.credit, 0) === 0;
const L = (litres: number) => Math.round(litres * 1000);

beforeEach(() => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  as = owner;
});

afterEach(async () => {
  await app.close();
  db.close();
});

interface Station {
  reg: { id: string; name: unknown }; dsl: { id: string };
  t1: { id: string }; t2: { id: string };
  pump: { id: string; nozzles: { id: string }[] };
}

/**
 * Two fuels, a tank of each (20,000 L of benzine at 780 a litre, with a chart; 10,000 L of diesel at 690), one pump with
 * a nozzle on each tank. "Vouchers need approval" is on, so the owner's entries are approved as they are made.
 */
async function station(): Promise<Station> {
  writeSetting(db, 'vouchers_need_approval', '1');
  expect((await call('POST', '/api/plan/trial', {})).statusCode).toBe(200);
  const reg = (await call('POST', '/api/fuel/types', { code: 'B-REG', name: { ar: 'بنزين عادي', en: 'Regular benzine', ku: 'بەنزینی ئاسایی' }, price: 850 })).json();
  const dsl = (await call('POST', '/api/fuel/types', { code: 'GASOIL', name: { ar: 'كاز', en: 'Diesel', ku: 'گازۆیل' }, price: 750 })).json();
  const t1 = await call('POST', '/api/fuel/tanks', { code: 'T1', name: 'Benzine', fuelTypeId: reg.id, capacityMilli: L(40_000), chart: cylinderChart(280, 40_000), openingMilli: L(20_000), openingCost: 780, openingDate: '2026-11-01' });
  expect(t1.statusCode, t1.body).toBe(201);
  const t2 = await call('POST', '/api/fuel/tanks', { code: 'T2', name: 'Diesel', fuelTypeId: dsl.id, capacityMilli: L(30_000), openingMilli: L(10_000), openingCost: 690, openingDate: '2026-11-01' });
  expect(t2.statusCode, t2.body).toBe(201);
  const pump = await call('POST', '/api/fuel/pumps', { number: 1, nozzles: [{ number: 1, tankId: t1.json().id, meterMilli: L(100_000) }, { number: 2, tankId: t2.json().id, meterMilli: L(50_000) }] });
  expect(pump.statusCode, pump.body).toBe(201);
  return { reg, dsl, t1: t1.json(), t2: t2.json(), pump: pump.json() };
}

const openOn = (pumpId: string, date = '2026-11-17') => call('POST', '/api/fuel/shifts', { date, shift: 'morning', attendant: 'Las', pumpIds: [pumpId] });
const tank = async (id: string) => (await call('GET', '/api/fuel/setup')).json().tanks.find((t: { id: string }) => t.id === id);
async function closeWith(s: Station, regLitres: number, dslLitres: number, extra: Record<string, unknown> = {}) {
  const shift = (await openOn(s.pump.id)).json();
  const [r1, r2] = shift.readings as { openingMilli: number }[];
  const sales = Math.round(regLitres * 850) + Math.round(dslLitres * 750);
  return call('POST', `/api/fuel/shifts/${shift.id}/close`, {
    readings: [{ nozzleId: s.pump.nozzles[0]!.id, closingMilli: r1!.openingMilli + L(regLitres) }, { nozzleId: s.pump.nozzles[1]!.id, closingMilli: r2!.openingMilli + L(dslLitres) }],
    handed: sales, lang: 'en', ...extra
  });
}

/** Users with these roles (and the owner as an admin), signed in; sign-in is on from here. */
async function people(roles: Record<string, string[]>): Promise<Record<string, H>> {
  const ownerUser = (await call('GET', '/api/users')).json()[0];
  expect((await call('POST', `/api/users/${ownerUser.id}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
  for (const [username, r] of Object.entries(roles)) {
    const made = await call('POST', '/api/users', { username, name: username[0]!.toUpperCase() + username.slice(1), password: `${username}-pass-123`, roles: r });
    expect(made.statusCode, made.body).toBe(201);
  }
  expect((await call('PUT', '/api/auth/signin', { on: true })).statusCode).toBe(200);
  const login = async (username: string, password: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, headers: { 'x-qasa-client': '1' } });
    expect(res.statusCode, res.body).toBe(200);
    return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
  };
  const out: Record<string, H> = { admin: await login(ownerUser.username, 'admin-pass-123') };
  for (const username of Object.keys(roles)) out[username] = await login(username, `${username}-pass-123`);
  return out;
}

describe('petrol station setup', () => {
  it('needs the Pro plan (the month\'s trial counts)', async () => {
    expect((await call('POST', '/api/fuel/types', { code: 'X', name: { ar: 'x', en: 'x', ku: 'x' }, price: 1 })).json().error).toBe('plan_limit');
    expect((await call('GET', '/api/fuel/setup')).json().available).toBe(false);
  });

  it('a tank\'s opening stock is posted to fuel stock (made under 137) against capital, and is its book', async () => {
    const s = await station();
    const t1 = await tank(s.t1.id);
    expect(t1).toMatchObject({ bookMilli: L(20_000), value: 15_600_000, avgCost: 780, capacityMilli: L(40_000) });
    expect(t1.chart.length).toBeGreaterThan(10);
    const opening = db.prepare('SELECT opening_entry_id FROM fuel_tanks WHERE id = ?').get(s.t1.id) as { opening_entry_id: string };
    expect(lines(opening.opening_entry_id)).toEqual([['1379', 15_600_000, 0], ['21', 0, 15_600_000]]);
    expect(listAccounts(db).find((a) => a.code === '1379')).toMatchObject({ parentCode: '137', name: { en: 'Fuel stock' } });
    // the fuel's own entries are changed only from the petrol station's page
    expect((await call('POST', `/api/entries/${opening.opening_entry_id}/reverse`, {})).json().error).toBe('entry_belongs_to_fuel');
  });

  it('refuses a wrong chart, a tank below its stock, a fuel or tank still in use; a nozzle sells its tank\'s fuel', async () => {
    const s = await station();
    const bad = await call('POST', '/api/fuel/tanks', { code: 'T9', name: 'x', fuelTypeId: s.reg.id, capacityMilli: L(1000), chart: [{ mm: 100, milli: 0 }, { mm: 50, milli: 10 }] });
    expect(bad.json().details).toEqual([{ code: 'fuel_chart_not_rising', field: 'chart' }]);
    expect((await call('POST', '/api/fuel/tanks', { code: 'T9', name: 'x', fuelTypeId: s.reg.id, capacityMilli: L(1000), chart: [{ mm: 0, milli: 0 }, { mm: 50, milli: L(2000) }] })).json().details[0].code).toBe('fuel_chart_over_capacity');
    expect((await call('PUT', `/api/fuel/tanks/${s.t1.id}`, { code: 'T1', name: 'Benzine', fuelTypeId: s.reg.id, capacityMilli: L(10_000) })).json().details[0].code).toBe('fuel_capacity_below_stock');
    expect((await call('PUT', `/api/fuel/tanks/${s.t1.id}`, { code: 'T1', name: 'Benzine', fuelTypeId: s.dsl.id, capacityMilli: L(40_000) })).json().error).toBe('fuel_tank_fuel_fixed');
    expect((await call('PUT', `/api/fuel/tanks/${s.t1.id}`, { code: 'T1', name: 'Benzine', fuelTypeId: s.reg.id, capacityMilli: L(40_000), active: false })).json().error).toBe('fuel_tank_in_use');
    expect((await call('PUT', `/api/fuel/types/${s.reg.id}`, { code: 'B-REG', name: s.reg.name, price: 850, active: false })).json().error).toBe('fuel_type_in_use');
    const renamed = await call('PUT', `/api/fuel/types/${s.reg.id}`, { code: 'B-REG', name: { ar: 'بنزين', en: 'Benzine', ku: 'بەنزین' }, price: 900 });
    expect(renamed.json()).toMatchObject({ price: 900, name: { en: 'Benzine' } });
    const moved = await call('PUT', `/api/fuel/nozzles/${s.pump.nozzles[0]!.id}`, { tankId: s.t2.id });
    expect(moved.json()).toMatchObject({ tankId: s.t2.id, fuelTypeId: s.dsl.id });
    expect((await call('PUT', `/api/fuel/nozzles/${s.pump.nozzles[0]!.id}`, { tankId: s.t1.id, meterMilli: L(2_000_000) })).json().details).toEqual([{ code: 'fuel_meter_over_max', line: '1/1' }]);
    expect((await call('POST', `/api/fuel/pumps/${s.pump.id}/nozzles`, { number: 3, tankId: s.t1.id, meterMilli: 0 })).statusCode).toBe(201);
    expect((await call('POST', `/api/fuel/pumps/${s.pump.id}/nozzles`, { number: 3, tankId: s.t1.id, meterMilli: 0 })).json().details).toEqual([{ code: 'fuel_nozzle_twice' }]);
    expect((await call('PUT', `/api/fuel/pumps/${s.pump.id}`, { number: 7, active: false })).json()).toMatchObject({ number: 7, active: false });
  });

  it('settings take only postable accounts of the right kind, and nothing but the fields it knows', async () => {
    await station();
    const bad = await call('PUT', '/api/fuel/settings', { cashAccount: '42', overAccount: '18', costAccount: '1811' });
    expect(bad.json().details.map((d: { field: string }) => d.field).sort()).toEqual(['cashAccount', 'costAccount', 'overAccount']);
    expect((await call('PUT', '/api/fuel/settings', { shortAccount: '39', dipToleranceBp: 30 })).json()).toMatchObject({ shortAccount: '39', dipToleranceBp: 30, stockAccount: '1379' });
    expect((await call('PUT', '/api/fuel/settings', { shortAccount: "39' OR 1=1 --" })).statusCode).toBe(400);
    expect((await call('PUT', '/api/fuel/settings', { anything: 1 })).statusCode).toBe(400);
    expect((await call('PUT', '/api/fuel/settings', { dipToleranceBp: 5000 })).statusCode).toBe(400);
  });
});

describe('petrol station shifts', () => {
  it('open with the nozzles\' last readings, refuse a closing reading below the opening one, and name the nozzle', async () => {
    const { pump } = await station();
    const opened = await openOn(pump.id);
    expect(opened.statusCode, opened.body).toBe(201);
    const shift = opened.json();
    expect(shift.number).toBe('SH-0001');
    expect(shift.readings.map((r: { openingMilli: number }) => r.openingMilli)).toEqual([L(100_000), L(50_000)]);
    expect((await openOn(pump.id)).json().error).toBe('fuel_nozzle_in_shift');
    const below = await call('PUT', `/api/fuel/shifts/${shift.id}`, { readings: [{ nozzleId: pump.nozzles[0]!.id, closingMilli: L(99_999) }] });
    expect(below.statusCode).toBe(400);
    expect(below.json().details).toEqual([{ code: 'fuel_closing_below_opening', line: '1/1' }]);
    for (const bad of ['100600', 100_600_000.5, -1]) {
      expect((await call('PUT', `/api/fuel/shifts/${shift.id}`, { readings: [{ nozzleId: pump.nozzles[0]!.id, closingMilli: bad }] })).statusCode).toBe(400);
    }
    // the opening reading is the meter's last closing: it can't be typed in (raising it would hide litres sold)
    expect((await call('PUT', `/api/fuel/shifts/${shift.id}`, { readings: [{ nozzleId: pump.nozzles[0]!.id, openingMilli: L(100_500), closingMilli: L(100_600) }] })).statusCode).toBe(400);
    const missing = await call('POST', `/api/fuel/shifts/${shift.id}/close`, { readings: [{ nozzleId: pump.nozzles[0]!.id, closingMilli: L(100_600) }], handed: 510_000 });
    expect(missing.json().details).toEqual([{ code: 'fuel_closing_missing', line: '1/2' }]);
    expect((await call('GET', `/api/fuel/shifts/${shift.id}`)).json().status).toBe('open');
  });

  it('closing posts sales, cash, a shortage and the cost of the litres in one balanced entry; the tanks give the litres', async () => {
    const s = await station();
    // 600 L of benzine at 850 = 510,000 (cost 600 × 780); 300 L of diesel at 750 = 225,000 (cost 300 × 690)
    const closed = await closeWith(s, 600, 300, { handed: 727_500 });
    expect(closed.statusCode, closed.body).toBe(200);
    const view = closed.json();
    expect(view).toMatchObject({ status: 'closed', sales: 735_000, cost: 675_000, profit: 60_000 });
    expect(view.cash).toMatchObject({ expected: 735_000, handed: 727_500, difference: -7_500, result: 'short' });
    expect(lines(view.entry.id)).toEqual([
      ['1811', 727_500, 0], ['1661', 7_500, 0], ['35', 468_000, 0], ['35', 207_000, 0],
      ['42', 0, 510_000], ['42', 0, 225_000], ['1379', 0, 468_000], ['1379', 0, 207_000]
    ]);
    expect(balanced(view.entry.id)).toBe(true);
    expect(await tank(s.t1.id)).toMatchObject({ bookMilli: L(19_400), value: 15_600_000 - 468_000, avgCost: 780 });
    expect(await tank(s.t2.id)).toMatchObject({ bookMilli: L(9_700) });
    const setup = (await call('GET', '/api/fuel/setup')).json();
    expect(setup.pumps[0].nozzles.map((n: { meterMilli: number }) => n.meterMilli)).toEqual([L(100_600), L(50_300)]);
    expect((await call('PUT', `/api/fuel/shifts/${view.id}`, { readings: [] })).json().error).toBe('action_not_allowed');
    // the shift's entry is changed only from the shift
    expect((await call('POST', `/api/entries/${view.entry.id}/reverse`, {})).json().error).toBe('entry_belongs_to_fuel');
  });

  it('a second close of the same shift changes nothing (the close is guarded by the shift being open)', async () => {
    const s = await station();
    const shift = (await openOn(s.pump.id)).json();
    const body = { readings: [{ nozzleId: s.pump.nozzles[0]!.id, closingMilli: L(100_100) }, { nozzleId: s.pump.nozzles[1]!.id, closingMilli: L(50_000) }], handed: 85_000 };
    const [a, b] = await Promise.all([call('POST', `/api/fuel/shifts/${shift.id}/close`, body), call('POST', `/api/fuel/shifts/${shift.id}/close`, body)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect((await call('POST', `/api/fuel/shifts/${shift.id}/close`, body)).json().error).toBe('action_not_allowed');
    expect(Number((db.prepare("SELECT COUNT(*) AS n FROM fuel_moves WHERE kind = 'sale'").get() as { n: number }).n)).toBe(1);
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number }).n)).toBe(3); // two opening stocks, one shift
  });

  it('cash over and sales on credit are posted to their own accounts', async () => {
    const s = await station();
    const closed = (await closeWith(s, 100, 0, { credit: 35_000, handed: 52_000 })).json();
    expect(closed.cash).toMatchObject({ expected: 50_000, difference: 2_000, result: 'over' });
    expect(lines(closed.entry.id)).toEqual([['1811', 52_000, 0], ['1611', 35_000, 0], ['35', 78_000, 0], ['42', 0, 85_000], ['49', 0, 2_000], ['1379', 0, 78_000]]);
    const again = (await openOn(s.pump.id)).json();
    expect((await call('PUT', `/api/fuel/shifts/${again.id}`, { readings: [], credit: 1 })).json().details).toEqual([{ code: 'fuel_credit_over_sales', field: 'credit' }]);
  });

  it('a meter that rolled over counts across its maximum only when ticked, and only as many litres as the tank holds', async () => {
    const s = await station();
    expect((await call('PUT', `/api/fuel/nozzles/${s.pump.nozzles[0]!.id}`, { tankId: s.t1.id, meterMilli: 999_900_000, meterMaxMilli: 999_999_990 })).statusCode).toBe(200);
    const shift = (await openOn(s.pump.id)).json();
    const first = (closingMilli: number, rollover?: boolean) => ({ nozzleId: s.pump.nozzles[0]!.id, closingMilli, ...(rollover === undefined ? {} : { rollover }) });
    expect((await call('PUT', `/api/fuel/shifts/${shift.id}`, { readings: [first(150_000)] })).json().details).toEqual([{ code: 'fuel_closing_below_opening', line: '1/1' }]);
    expect((await call('PUT', `/api/fuel/shifts/${shift.id}`, { readings: [first(999_950_000, true)] })).json().details).toEqual([{ code: 'fuel_rollover_not_needed', line: '1/1' }]);
    const saved = await call('PUT', `/api/fuel/shifts/${shift.id}`, { readings: [first(150_000, true)] });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().totals.lines[0].milli).toBe(249_990); // 999999.99 − 999900 + 150
    const closed = await call('POST', `/api/fuel/shifts/${shift.id}/close`, { readings: [first(150_000, true), { nozzleId: s.pump.nozzles[1]!.id, closingMilli: L(50_000) }], handed: 212_492 });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json().readings[0]).toMatchObject({ rollover: true, closingMilli: 150_000 });
    expect((await call('GET', '/api/fuel/setup')).json().pumps[0].nozzles[0].meterMilli).toBe(150_000);
    // a mistyped reading is no rollover: 500,000 L to 100,000 L would be ~600,000 L from a 40,000 L tank
    expect((await call('PUT', `/api/fuel/nozzles/${s.pump.nozzles[0]!.id}`, { tankId: s.t1.id, meterMilli: L(500_000) })).statusCode).toBe(200);
    const next = (await openOn(s.pump.id)).json();
    expect((await call('PUT', `/api/fuel/shifts/${next.id}`, { readings: [first(L(100_000), true)] })).json().details).toEqual([{ code: 'fuel_rollover_implausible', line: '1/1' }]);
  });

  it('an admin reverses a closed shift with a reason: the opposite entry, the litres back, the meters back, done again after', async () => {
    const s = await station();
    const closed = (await closeWith(s, 600, 300)).json();
    expect(getEntry(db, closed.entry.id).status).toBe('approved');
    expect((await call('POST', `/api/fuel/shifts/${closed.id}/reverse`, { reason: '' })).json().details).toEqual([{ code: 'fuel_reason_required', field: 'reason' }]);
    const reversed = await call('POST', `/api/fuel/shifts/${closed.id}/reverse`, { reason: 'Wrong closing reading on pump 1' });
    expect(reversed.statusCode, reversed.body).toBe(200);
    const view = reversed.json();
    expect(view).toMatchObject({ status: 'reversed', reverseReason: 'Wrong closing reading on pump 1', reversedBy: 'Mer', actions: [] });
    expect(lines(view.reversal.id)).toEqual(lines(closed.entry.id).map(([a, d, c]) => [a, c, d]));
    expect(getEntry(db, closed.entry.id).reversedById).toBe(view.reversal.id);
    expect(await tank(s.t1.id)).toMatchObject({ bookMilli: L(20_000), value: 15_600_000 });
    const setup = (await call('GET', '/api/fuel/setup')).json();
    expect(setup.pumps[0].nozzles.map((n: { meterMilli: number }) => n.meterMilli)).toEqual([L(100_000), L(50_000)]);
    expect(db.prepare("SELECT 1 FROM audit_log WHERE entity = 'fuel_shift' AND action = 'reverse'").get()).toBeTruthy();
    // a reversed shift is in nobody's totals, and is not reversed twice
    expect((await call('GET', '/api/fuel/attendants?from=2026-11-01&to=2026-11-30')).json()).toEqual([]);
    expect((await call('POST', `/api/fuel/shifts/${closed.id}/reverse`, { reason: 'again' })).json().error).toBe('action_not_allowed');
    // done again: the new shift opens where the reversed one opened
    const redo = (await openOn(s.pump.id)).json();
    expect(redo.readings.map((r: { openingMilli: number }) => r.openingMilli)).toEqual([L(100_000), L(50_000)]);
  });

  it('only the last shift of its nozzles is reversed (a later one would have its meters wound back)', async () => {
    const s = await station();
    const first = (await closeWith(s, 100, 100)).json();
    await closeWith(s, 50, 50);
    expect((await call('POST', `/api/fuel/shifts/${first.id}/reverse`, { reason: 'mistake' })).json().details[0]).toEqual({ code: 'fuel_shift_not_last', line: '1/1' });
  });

  it('a shift whose entry is still a draft is reversed by deleting the draft', async () => {
    const s = await station();
    writeSetting(db, 'vouchers_need_approval', '0');
    const closed = (await closeWith(s, 100, 0)).json();
    expect(getEntry(db, closed.entry.id).status).toBe('draft');
    const reversed = (await call('POST', `/api/fuel/shifts/${closed.id}/reverse`, { reason: 'mistake' })).json();
    expect(reversed).toMatchObject({ status: 'reversed', entry: null, reversal: null });
    expect(db.prepare('SELECT 1 FROM entries WHERE id = ?').get(closed.entry.id)).toBeUndefined();
    expect(await tank(s.t1.id)).toMatchObject({ bookMilli: L(20_000) });
  });
});

describe('tanker deliveries', () => {
  async function supplier(name = 'Raz') {
    const made = await call('POST', '/api/parties', { type: 'supplier', name });
    expect(made.statusCode, made.body).toBe(201);
    return made.json() as { id: string; accountCode: string };
  }
  const deliver = (s: Station, supplierId: string, extra: Record<string, unknown> = {}) =>
    call('POST', '/api/fuel/deliveries', { date: '2026-11-16', tankId: s.t1.id, supplierId, noteNo: 'WS-100', qtyMilli: L(10_000), costPerLitre: 810, payment: 'credit', lang: 'en', ...extra });

  it('on credit: Dr fuel stock, Cr the supplier (on the line); the tank\'s average cost moves and the litres sold leave at it', async () => {
    const s = await station();
    const raz = await supplier();
    const made = await deliver(s, raz.id);
    expect(made.statusCode, made.body).toBe(201);
    const d = made.json();
    expect(d).toMatchObject({ number: 'FD-0001', qtyMilli: L(10_000), cost: 8_100_000, payment: 'credit', status: 'posted' });
    expect(lines(d.entry.id)).toEqual([['1379', 8_100_000, 0], [raz.accountCode, 0, 8_100_000]]);
    expect(getEntry(db, d.entry.id).lines[1]!.partyId).toBe(raz.id);
    // 20,000 L at 780 and 10,000 L at 810: 30,000 L worth 23,700,000, 790 a litre
    expect(await tank(s.t1.id)).toMatchObject({ bookMilli: L(30_000), value: 23_700_000, avgCost: 790, lastCost: 810 });
    const closed = (await closeWith(s, 100, 0)).json();
    expect(lines(closed.entry.id).filter(([a]) => a === '35')).toEqual([['35', 79_000, 0]]);
  });

  it('paid now: Cr the safe; a supplier\'s delivery note is entered once', async () => {
    const s = await station();
    const raz = await supplier();
    const d = (await deliver(s, raz.id, { payment: 'cash' })).json();
    expect(lines(d.entry.id)).toEqual([['1379', 8_100_000, 0], ['1811', 0, 8_100_000]]);
    expect((await deliver(s, raz.id, { qtyMilli: L(100) })).json().error).toBe('fuel_note_taken');
    // another supplier may have the same note number
    const las = await supplier('Las');
    expect((await deliver(s, las.id, { qtyMilli: L(100) })).statusCode).toBe(201);
    // a customer is no supplier; a note with odd characters is refused
    const customer = (await call('POST', '/api/parties', { type: 'customer', name: 'Mer' })).json();
    expect((await deliver(s, customer.id, { noteNo: 'X1' })).json().details).toEqual([{ code: 'fuel_supplier_invalid', field: 'supplierId' }]);
    expect((await deliver(s, raz.id, { noteNo: "1'; DROP TABLE x" })).statusCode).toBe(400);
  });

  it('a delivery past the tank\'s capacity is refused, with the room left; an admin may go past it, saying so', async () => {
    const s = await station();
    const raz = await supplier();
    const over = await deliver(s, raz.id, { qtyMilli: L(25_000) });
    expect(over.json().details).toEqual([{ code: 'fuel_tank_overfill', field: 'qtyMilli', available: L(20_000) }]);
    expect((await deliver(s, raz.id, { qtyMilli: L(25_000), overCapacity: true })).statusCode).toBe(201);
  });

  it('an admin reverses a delivery with a reason, unless its litres are sold already', async () => {
    const s = await station();
    const raz = await supplier();
    const d = (await deliver(s, raz.id)).json();
    const reversed = await call('POST', `/api/fuel/deliveries/${d.id}/reverse`, { reason: 'Entered twice' });
    expect(reversed.statusCode, reversed.body).toBe(200);
    expect(lines(reversed.json().reversal.id)).toEqual([['1379', 0, 8_100_000], [raz.accountCode, 8_100_000, 0]]);
    expect(await tank(s.t1.id)).toMatchObject({ bookMilli: L(20_000), value: 15_600_000 });
    // the note can be entered again once its delivery is reversed
    const again = (await deliver(s, raz.id, { qtyMilli: L(1_000) })).json();
    expect(again.status).toBe('posted');
    // 1,000 L delivered into a tank of 20,000, then 20,500 L sold: the delivery's litres are gone
    await closeWith(s, 20_500, 0);
    expect((await call('POST', `/api/fuel/deliveries/${again.id}/reverse`, { reason: 'mistake' })).json().error).toBe('fuel_delivery_used');
  });
});

describe('tank dips', () => {
  it('by the stick and the tank\'s chart: a small loss is posted at average cost to fuel loss, and called normal evaporation', async () => {
    const s = await station();
    const chart = (await tank(s.t1.id)).chart as { mm: number; milli: number }[];
    // halfway between the two rows around 19,950 L, so the dip reads a little under the book of 20,000 L
    const i = chart.findIndex((r) => r.milli > L(19_950));
    const mm = Math.round((chart[i - 1]!.mm + chart[i]!.mm) / 2);
    const dip = await call('POST', '/api/fuel/dips', { date: '2026-11-17', tankId: s.t1.id, dipMm: mm, lang: 'en' });
    expect(dip.statusCode, dip.body).toBe(201);
    const v = dip.json();
    expect(v.measuredMilli).toBeGreaterThan(chart[i - 1]!.milli);
    expect(v.measuredMilli).toBeLessThan(chart[i]!.milli);
    expect(v).toMatchObject({ number: 'DP-0001', bookMilli: L(20_000), varianceMilli: v.measuredMilli - L(20_000) });
    const loss = Math.round(((L(20_000) - v.measuredMilli) * 780) / 1000);
    expect(v.value).toBe(-loss);
    expect(lines(v.entry.id)).toEqual([['39', loss, 0], ['1379', 0, loss]]);
    expect(v.normal).toBe(Math.abs(v.varianceMilli) * 10_000 <= 50 * L(20_000));
    expect(await tank(s.t1.id)).toMatchObject({ bookMilli: v.measuredMilli, lastDip: { date: '2026-11-17', measuredMilli: v.measuredMilli } });
  });

  it('a gain comes back from fuel loss; a stick without a chart, outside it, or during an open shift is refused', async () => {
    const s = await station();
    const gain = (await call('POST', '/api/fuel/dips', { date: '2026-11-17', tankId: s.t2.id, measuredMilli: L(10_010), lang: 'en' })).json();
    expect(gain).toMatchObject({ varianceMilli: L(10), value: 6_900, normal: true });
    expect(lines(gain.entry.id)).toEqual([['1379', 6_900, 0], ['39', 0, 6_900]]);
    expect((await call('POST', '/api/fuel/dips', { date: '2026-11-17', tankId: s.t2.id, dipMm: 500 })).json().details).toEqual([{ code: 'fuel_tank_no_chart', field: 'dipMm' }]);
    expect((await call('POST', '/api/fuel/dips', { date: '2026-11-17', tankId: s.t1.id, dipMm: 9_000 })).json().details).toEqual([{ code: 'fuel_dip_outside_chart', field: 'dipMm' }]);
    expect((await call('POST', '/api/fuel/dips', { date: '2026-11-17', tankId: s.t1.id, dipMm: 500, measuredMilli: 5 })).json().details[0].code).toBe('fuel_dip_one_way');
    // reversing the gain puts the book back
    const back = await call('POST', `/api/fuel/dips/${gain.id}/reverse`, { reason: 'Read the wrong tank' });
    expect(back.json().status).toBe('reversed');
    expect(await tank(s.t2.id)).toMatchObject({ bookMilli: L(10_000), value: 6_900_000 });
    await openOn(s.pump.id);
    expect((await call('POST', '/api/fuel/dips', { date: '2026-11-17', tankId: s.t1.id, measuredMilli: L(19_000) })).json().error).toBe('fuel_tank_in_open_shift');
  });
});

describe('petrol station reports', () => {
  it('per fuel: litres, sales, cost and gross profit; per tank: opening, delivered, sold, adjusted and closing', async () => {
    const s = await station();
    const raz = (await call('POST', '/api/parties', { type: 'supplier', name: 'Raz' })).json();
    expect((await call('POST', '/api/fuel/deliveries', { date: '2026-11-16', tankId: s.t1.id, supplierId: raz.id, noteNo: 'A1', qtyMilli: L(5_000), costPerLitre: 780, payment: 'credit' })).statusCode).toBe(201);
    await closeWith(s, 600, 300);
    expect((await call('POST', '/api/fuel/dips', { date: '2026-11-17', tankId: s.t2.id, measuredMilli: L(9_690) })).statusCode).toBe(201);
    const report = (await call('GET', '/api/fuel/reports?from=2026-11-10&to=2026-11-30')).json();
    expect(report.fuels).toEqual([
      { fuelTypeId: s.reg.id, milli: L(600), sales: 510_000, cost: 468_000, profit: 42_000 },
      { fuelTypeId: s.dsl.id, milli: L(300), sales: 225_000, cost: 207_000, profit: 18_000 }
    ]);
    expect(report.tanks).toEqual([
      { tankId: s.t1.id, openingMilli: L(20_000), deliveredMilli: L(5_000), soldMilli: L(600), adjustedMilli: 0, closingMilli: L(24_400), value: 19_032_000 },
      { tankId: s.t2.id, openingMilli: L(10_000), deliveredMilli: 0, soldMilli: L(300), adjustedMilli: -L(10), closingMilli: L(9_690), value: 6_686_100 }
    ]);
    expect((await call('GET', '/api/fuel/reports?from=2026-11-30&to=2026-11-01')).statusCode).toBe(400);
  });
});

describe('who may do what at the petrol station', () => {
  it('the shift sheet is Point of sale (not sales); deliveries purchasing; dips stock; setup and reversals an admin', async () => {
    const s = await station();
    const raz = (await call('POST', '/api/parties', { type: 'supplier', name: 'Raz' })).json();
    const who = await people({ las: ['pos'], raz: ['sales'] });
    as = who.raz!;
    expect((await openOn(s.pump.id)).statusCode).toBe(403);
    as = who.las!;
    const opened = await openOn(s.pump.id);
    expect(opened.statusCode, opened.body).toBe(201);
    const shift = opened.json();
    const closed = await call('POST', `/api/fuel/shifts/${shift.id}/close`, {
      readings: [{ nozzleId: s.pump.nozzles[0]!.id, closingMilli: L(100_100) }, { nozzleId: s.pump.nozzles[1]!.id, closingMilli: L(50_000) }], handed: 85_000
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await call('POST', `/api/fuel/shifts/${shift.id}/reverse`, { reason: 'mine' })).statusCode).toBe(403);
    expect((await call('POST', '/api/fuel/deliveries', { date: '2026-11-16', tankId: s.t1.id, supplierId: raz.id, noteNo: 'A', qtyMilli: L(1), costPerLitre: 1, payment: 'credit' })).statusCode).toBe(403);
    expect((await call('POST', '/api/fuel/dips', { date: '2026-11-17', tankId: s.t1.id, measuredMilli: L(1) })).statusCode).toBe(403);
    expect((await call('PUT', `/api/fuel/types/${s.reg.id}`, { code: 'B-REG', name: s.reg.name, price: 1 })).statusCode).toBe(403);
    expect((await call('POST', '/api/fuel/tanks', { code: 'T9', name: 'x', fuelTypeId: s.reg.id, capacityMilli: 1000 })).statusCode).toBe(403);
    expect((await call('PUT', '/api/fuel/settings', { shortAccount: '39' })).statusCode).toBe(403);
    expect((await call('GET', '/api/fuel/setup')).statusCode).toBe(200);
    as = who.admin!;
    expect((await call('POST', `/api/fuel/shifts/${shift.id}/reverse`, { reason: 'checked' })).statusCode).toBe(200);
    expect((await call('GET', '/api/fuel/setup', undefined, { 'x-qasa-client': '1' })).statusCode).toBe(401);
  });

  it('a buyer brings tankers in (past capacity only as an admin) and a storekeeper dips', async () => {
    const s = await station();
    const raz = (await call('POST', '/api/parties', { type: 'supplier', name: 'Raz' })).json();
    const who = await people({ las: ['purchasing'], raz: ['storekeeper'] });
    as = who.las!;
    const body = { date: '2026-11-16', tankId: s.t1.id, supplierId: raz.id, noteNo: 'A', qtyMilli: L(25_000), costPerLitre: 800, payment: 'credit', overCapacity: true };
    expect((await call('POST', '/api/fuel/deliveries', body)).json().details[0].code).toBe('fuel_tank_overfill');
    expect((await call('POST', '/api/fuel/deliveries', { ...body, qtyMilli: L(1_000) })).statusCode).toBe(201);
    expect((await openOn(s.pump.id)).statusCode).toBe(403);
    as = who.raz!;
    expect((await call('POST', '/api/fuel/dips', { date: '2026-11-17', tankId: s.t2.id, measuredMilli: L(9_990) })).statusCode).toBe(201);
    expect((await call('POST', '/api/fuel/deliveries', { ...body, noteNo: 'B', qtyMilli: L(1) })).statusCode).toBe(403);
  });

  it('a cashier sees litres and sales of their own shifts but no cost, stock value, profit, deliveries, dips or reports', async () => {
    const s = await station();
    const raz = (await call('POST', '/api/parties', { type: 'supplier', name: 'Raz' })).json();
    const d = (await call('POST', '/api/fuel/deliveries', { date: '2026-11-16', tankId: s.t1.id, supplierId: raz.id, noteNo: 'A', qtyMilli: L(1_000), costPerLitre: 800, payment: 'credit' })).json();
    const theirs = (await closeWith(s, 100, 100)).json();
    expect((await call('POST', '/api/fuel/dips', { date: '2026-11-17', tankId: s.t2.id, measuredMilli: L(9_890) })).statusCode).toBe(201);
    const who = await people({ las: ['pos'], raz: ['sales', 'pos'] });
    const forbidden = /"(cost|profit|value|avgCost|lastCost|costPerLitre)"/;
    // Las opens and closes a shift of her own
    as = who.las!;
    const opened = (await openOn(s.pump.id)).json();
    const [r1, r2] = opened.readings as { openingMilli: number }[];
    const mine = await call('POST', `/api/fuel/shifts/${opened.id}/close`, {
      readings: [{ nozzleId: s.pump.nozzles[0]!.id, closingMilli: r1!.openingMilli + L(10) }, { nozzleId: s.pump.nozzles[1]!.id, closingMilli: r2!.openingMilli }], handed: 8_500
    });
    expect(mine.statusCode, mine.body).toBe(200);
    expect(mine.body).not.toMatch(forbidden);
    for (const url of ['/api/fuel/setup', '/api/fuel/shifts', `/api/fuel/shifts/${opened.id}`]) {
      const res = await call('GET', url);
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).not.toMatch(forbidden);
    }
    expect((await call('GET', `/api/fuel/shifts/${opened.id}`)).json().sales).toBe(8_500);
    expect((await call('GET', '/api/fuel/setup')).json().tanks[0].bookMilli).toBe(L(20_890));
    // only their own shifts: the owner's shift is not there for them, and its sheet is not theirs to work
    expect((await call('GET', '/api/fuel/shifts')).json().map((x: { id: string }) => x.id)).toEqual([opened.id]);
    expect((await call('GET', `/api/fuel/shifts/${theirs.id}`)).statusCode).toBe(404);
    // every attendant's short and over, the deliveries, the dips and the fuel report are the books'
    for (const url of ['/api/fuel/attendants?from=2026-11-01&to=2026-11-30', '/api/fuel/deliveries', `/api/fuel/deliveries/${d.id}`, '/api/fuel/dips', '/api/fuel/reports?from=2026-11-01&to=2026-11-30']) {
      expect((await call('GET', url)).statusCode, url).toBe(403);
    }
    // Raz (sales and Point of sale) reads none of Las's shifts, and cannot close or delete one she opened
    as = who.raz!;
    expect((await call('GET', '/api/fuel/shifts')).json()).toEqual([]);
    expect((await call('GET', `/api/fuel/shifts/${opened.id}`)).statusCode).toBe(404);
    as = who.las!;
    const again = (await openOn(s.pump.id)).json();
    as = who.raz!;
    expect((await call('PUT', `/api/fuel/shifts/${again.id}`, { readings: [] })).statusCode).toBe(403);
    expect((await call('POST', `/api/fuel/shifts/${again.id}/close`, { readings: [], handed: 0 })).statusCode).toBe(403);
    expect((await call('DELETE', `/api/fuel/shifts/${again.id}`)).statusCode).toBe(403);
    as = who.admin!;
    expect((await call('GET', `/api/fuel/shifts/${theirs.id}`)).json()).toMatchObject({ cost: 78_095 + 69_000, profit: 160_000 - 147_095 }); // benzine at (15,600,000 + 800,000) ÷ 21,000 L
    expect((await call('GET', '/api/fuel/shifts')).json()).toHaveLength(3);
    expect((await call('DELETE', `/api/fuel/shifts/${again.id}`)).statusCode).toBe(204);
  });
});

describe('the petrol station sample (website demo, ?petrol)', () => {
  it('has tanks with charts, deliveries, a dip with a small loss, and shifts by Mer, Las and Raz drawing stock and posting cost', () => {
    seedDemo(db);
    seedPetrolStationDemo(db);
    const shifts = db.prepare('SELECT attendant, status, difference, cost FROM fuel_shifts ORDER BY number').all() as
      { attendant: string; status: string; difference: number | null; cost: number | null }[];
    expect(shifts.map((s) => s.status)).toEqual(['closed', 'closed', 'closed', 'closed', 'closed', 'open']);
    expect(new Set(shifts.map((s) => s.attendant))).toEqual(new Set(['Mer', 'Las', 'Raz']));
    expect(shifts.some((s) => (s.difference ?? 0) < 0)).toBe(true);
    expect(shifts.filter((s) => s.status === 'closed').every((s) => Number(s.cost) > 0)).toBe(true);
    const entries = (db.prepare(`SELECT entry_id AS id FROM fuel_shifts WHERE entry_id IS NOT NULL UNION ALL SELECT entry_id FROM fuel_deliveries
                                 UNION ALL SELECT entry_id FROM fuel_dips WHERE entry_id IS NOT NULL UNION ALL SELECT opening_entry_id FROM fuel_tanks`).all() as { id: string }[]).map((r) => r.id);
    expect(entries).toHaveLength(5 + 2 + 1 + 3);
    for (const id of entries) {
      expect(getEntry(db, id).status).toBe('approved');
      expect(balanced(id)).toBe(true);
    }
    const tanks = db.prepare('SELECT chart FROM fuel_tanks ORDER BY code').all() as { chart: string | null }[];
    expect(tanks).toHaveLength(3);
    expect(tanks.every((t) => (JSON.parse(t.chart ?? '[]') as unknown[]).length > 10)).toBe(true);
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM fuel_deliveries').get() as { n: number }).n)).toBe(2);
    const dip = db.prepare('SELECT variance_milli, book_milli, value FROM fuel_dips').get() as { variance_milli: number; book_milli: number; value: number };
    expect(Number(dip.variance_milli)).toBeLessThan(0);
    expect(Math.abs(Number(dip.variance_milli)) * 10_000).toBeLessThanOrEqual(50 * Number(dip.book_milli));
    expect(Number(dip.value)).toBeLessThan(0);
    // the fuel stock account holds what the tanks' books are worth
    const value = Number((db.prepare('SELECT SUM(value) AS v FROM fuel_moves').get() as { v: number }).v);
    expect(listAccounts(db).find((a) => a.code === '1379')!.balance).toBe(value);
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM fuel_nozzles').get() as { n: number }).n)).toBe(8);
  });
});
