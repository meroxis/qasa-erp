import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  averageCost, chartProblem, tankCostOut, dipLitres, dipVariance, DIP_MAX_MM, CHART_MAX_ROWS, DEFAULT_METER_MAX_MILLI, FUEL_SHIFTS, fuelAmount, isIsoDate,
  METER_MAX_MILLI, meterText, mulDiv, readingProblem, shiftCash, shiftTotals, soldMilli, todayIso, withinTolerance,
  type ChartRow, type FuelShift, type Names, type NozzleReading, type ShiftCash, type ShiftTotals, type TankStock
} from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { planStatus } from './license.ts';
import { getPostingAccounts, isPeriodLocked, readSetting, writeSetting } from './settings.ts';
import { createJournalEntry, deleteEntry, getEntry, reverseEntryInternal } from './journal.ts';
import { preparerOf } from './quick-vouchers.ts';
import { seesBooks, signInRequired, type Actor } from './auth.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Petrol stations (Pro): the fuels with their price per litre, the tanks, the pumps and their nozzles, the shift sheet,
 * the tanker deliveries and the dips.
 *
 * A tank holds one fuel. Every litre in or out of it is a row of fuel_moves with what it cost: its book stock and the
 * value of that stock are their sums, and the average cost is value ÷ litres (a moving average: a delivery adds its
 * litres at its own price, a sale or a loss takes litres out at the average). Each nozzle draws from one tank of its
 * fuel; its meter only counts up, or rolls over to zero past its maximum (the sheet says so for that nozzle).
 *
 * Closing a shift posts one entry (the app's approval rules apply, as to any entry):
 *
 *   Dr the safe ............................. the cash handed in
 *   Dr the credit / coupons account .......... what was sold on credit or for coupons (when any)
 *   Dr the shortage account .................. a shortage (the attendant owes it: Employee advances 1661 by default)
 *   Dr cost of fuel sold ..................... litres × each tank's average cost, one line per fuel
 *       Cr each fuel's revenue account ....... litres × price, one line per fuel
 *       Cr the cash-over account ............. cash over (Other revenue 49 by default)
 *       Cr fuel stock ........................ the same cost, one line per fuel
 *
 * A delivery: Dr fuel stock, Cr the supplier (on credit, with the supplier on the line) or the safe (paid now).
 * A dip: a loss is Dr fuel loss and evaporation, Cr fuel stock; a gain the other way round, at the tank's average cost.
 * Opening stock of a new tank: Dr fuel stock, Cr capital or reserves (as opening stock of goods is).
 *
 * Nothing posted is changed: an admin reverses a closed shift, a delivery or a dip (with a reason, audit-logged). The
 * reversal posts the opposite entry (or deletes the entry while it is still a draft), puts the litres back, and for a
 * shift sets the meters back to their opening readings, so the shift can be done again. Every state is checked inside
 * the transaction that changes it, with the change guarded by the state it expects (… WHERE status = 'open'), on a
 * company file and on the office server alike. Every query is parameterised.
 */

export type Lang = 'ar' | 'en' | 'ku';

export interface FuelSettings {
  /** the safe the shift's cash is handed into, and a delivery paid now is paid from */
  cashAccount: string;
  /** where a shortage goes (the attendant owes it), or an expense account if the station bears it */
  shortAccount: string;
  /** where cash over goes */
  overAccount: string;
  /** what was sold on credit or for coupons */
  creditAccount: string;
  /** the fuel in the tanks (an inventory account) */
  stockAccount: string;
  /** cost of fuel sold */
  costAccount: string;
  /** fuel loss and evaporation found by a dip (a gain is credited to it) */
  lossAccount: string;
  /** what a tank's opening stock is credited to (capital or reserves) */
  openingAccount: string;
  /** a dip's difference within this many basis points of the book (50 = 0.5%) is called normal evaporation */
  dipToleranceBp: number;
}

/** The fuel stock account made the first time it is needed, under 137 (goods held for sale), when the company has none. */
export const FUEL_STOCK_ACCOUNT = '1379';
const FUEL_STOCK_NAMES: Names = { ar: 'مخزون الوقود', en: 'Fuel stock', ku: 'کۆگای سووتەمەنی' };

export const DEFAULT_FUEL_SETTINGS: Omit<FuelSettings, 'costAccount'> = {
  cashAccount: '1811', shortAccount: '1661', overAccount: '49', creditAccount: '1611', stockAccount: FUEL_STOCK_ACCOUNT, lossAccount: '39', openingAccount: '21', dipToleranceBp: 50
};

export interface FuelTypeView { id: string; code: string; name: Names; price: number; revenueAccount: string; active: boolean; sort: number }
export interface NozzleView {
  id: string; pumpId: string; number: number; fuelTypeId: string; tankId: string; meterMilli: number; meterMaxMilli: number; active: boolean; openShift: string | null;
}
export interface PumpView { id: string; number: number; active: boolean; nozzles: NozzleView[] }
export interface TankView {
  id: string; code: string; name: string; fuelTypeId: string; capacityMilli: number; chart: ChartRow[] | null; active: boolean;
  /** the book: what the tank should hold now */
  bookMilli: number;
  lastDip: { date: string; measuredMilli: number; varianceMilli: number } | null;
  /** cost (left out for someone who may not see cost): the stock's value, its average cost per litre, the last delivery's */
  value: number; avgCost: number; lastCost: number;
  /** whether an open shift draws from it */
  inOpenShift: boolean;
}
export interface FuelSetupView { available: boolean; types: FuelTypeView[]; tanks: TankView[]; pumps: PumpView[]; settings: FuelSettings }

export interface ReadingView extends NozzleReading { pumpNumber: number; nozzleNumber: number; tankId: string; meterMaxMilli: number; rollover: boolean; cost: number | null }

export type FuelShiftAction = 'save' | 'close' | 'cancel' | 'reverse';
export type FuelShiftStatus = 'open' | 'closed' | 'reversed';
interface EntryRef { id: string; number: string | null; status: string }

export interface ShiftSummary {
  id: string; number: string; date: string; shift: FuelShift; attendant: string; status: FuelShiftStatus;
  pumps: number[];
  sales: number | null; credit: number; handed: number | null; difference: number | null;
  /** cost of the litres sold and the gross profit (left out for someone who may not see cost) */
  cost: number | null; profit: number | null;
  entry: EntryRef | null; reversal: EntryRef | null;
  openedBy: string; openedAt: string; closedBy: string | null; closedAt: string | null;
  reversedBy: string | null; reversedAt: string | null; reverseReason: string | null;
}
export interface ShiftView extends ShiftSummary {
  readings: ReadingView[];
  totals: ShiftTotals;
  /** expected against handed in, once cash was written */
  cash: ShiftCash | null;
  notes: string;
  actions: FuelShiftAction[];
}

const now = () => new Date().toISOString();
const MAX_LITRES_MILLI = 100_000_000_000; // a hundred million litres: more than any tank or tanker holds
/** The most money one shift, delivery or dip may come to (far above any real one; keeps every sum a safe whole number). */
const MAX_AMOUNT = 1_000_000_000_000_000;

export const fuelAvailable = (db: Db): boolean => planStatus(db).features.includes('petrolStation');
function requirePlan(db: Db): void {
  if (!fuelAvailable(db)) throw conflict('plan_limit', { limit: 'petrolStation' });
}

/** A posting date: a real day, not in a locked period. */
function assertDate(db: Db, date: string): void {
  if (!isIsoDate(date)) throw invalid([{ code: 'date_invalid', field: 'date' }]);
  if (isPeriodLocked(db, date)) throw invalid([{ code: 'period_locked', period: date.slice(0, 7) }]);
}

/** Today, or `date` when that is later: a reversal is never dated before what it reverses. */
const reversalDate = (date: string) => (todayIso() < date ? date : todayIso());

// ——— settings and accounts ———

export function fuelSettings(db: Db): FuelSettings {
  const base: FuelSettings = { ...DEFAULT_FUEL_SETTINGS, costAccount: getPostingAccounts(db).costOfSales };
  try {
    const stored = JSON.parse(readSetting(db, 'fuel_settings') ?? 'null') as Partial<FuelSettings> | null;
    return { ...base, ...(stored && typeof stored === 'object' ? stored : {}) };
  } catch {
    return base;
  }
}

type AccountKey = Exclude<keyof FuelSettings, 'dipToleranceBp'>;
/** Which account each setting must be: a postable account under its group. */
const SETTING_GROUP: Record<AccountKey, RegExp> = {
  cashAccount: /^18/, shortAccount: /^(16|3)/, overAccount: /^4/, creditAccount: /^16/, stockAccount: /^13/, costAccount: /^3/, lossAccount: /^3/, openingAccount: /^2[12]/
};

function postableAccounts(db: Db): Set<string> {
  return new Set(loadAccounts(db).filter((a) => a.postable).map((a) => a.code));
}

/** Whether the fuel stock account can be made under 137 (137 there, and none of its own entries). */
function stockAccountCanBeMade(db: Db): boolean {
  if (db.prepare('SELECT 1 FROM accounts WHERE code = ?').get(FUEL_STOCK_ACCOUNT)) return false;
  if (!db.prepare("SELECT 1 FROM accounts WHERE code = '137'").get()) return false;
  return !db.prepare("SELECT 1 FROM entry_lines WHERE account_code = '137' LIMIT 1").get();
}

/** The fuel stock account to post to: the one chosen, made under 137 the first time when it is the default one. */
function stockAccount(db: Db, settings: FuelSettings, user: string): string {
  const code = settings.stockAccount;
  if (postableAccounts(db).has(code)) return code;
  if (code === FUEL_STOCK_ACCOUNT && stockAccountCanBeMade(db)) {
    db.prepare('INSERT INTO accounts (code, name_ar, name_en, name_ku, "system", created_at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(FUEL_STOCK_ACCOUNT, FUEL_STOCK_NAMES.ar, FUEL_STOCK_NAMES.en, FUEL_STOCK_NAMES.ku, now());
    audit(db, user, 'create', 'account', FUEL_STOCK_ACCOUNT, { name: FUEL_STOCK_NAMES, for: 'fuel_stock' });
    return FUEL_STOCK_ACCOUNT;
  }
  throw conflict('fuel_stock_account_missing');
}

export function updateFuelSettings(db: Db, input: Partial<FuelSettings>, actor: Actor): FuelSettings {
  requirePlan(db);
  const next = { ...fuelSettings(db), ...input };
  const postable = postableAccounts(db);
  const errors = (Object.keys(SETTING_GROUP) as AccountKey[])
    .filter((k) => !SETTING_GROUP[k].test(next[k]) || !(postable.has(next[k]) || (k === 'stockAccount' && next[k] === FUEL_STOCK_ACCOUNT && stockAccountCanBeMade(db))))
    .map((k) => ({ code: 'fuel_account_invalid', field: k, accountCode: next[k] }));
  if (errors.length) throw invalid(errors);
  transaction(db, () => {
    writeSetting(db, 'fuel_settings', JSON.stringify(next));
    audit(db, actor.name, 'update', 'fuel_settings', null, next);
  });
  return next;
}

// ——— the tanks' book ———

/** A tank's book stock and its value (the sums of its moves). */
function stockOf(db: Db, tankId: string): TankStock {
  const r = db.prepare('SELECT SUM(qty_milli) AS qty, SUM(value) AS total FROM fuel_moves WHERE tank_id = ?').get(tankId) as { qty: number | null; total: number | null };
  return { milli: Number(r.qty ?? 0), value: Number(r.total ?? 0) };
}

type MoveKind = 'opening' | 'delivery' | 'sale' | 'dip';

function addMove(db: Db, m: { tankId: string; date: string; kind: MoveKind; sourceId: string; milli: number; value: number }): void {
  db.prepare('INSERT INTO fuel_moves (id, tank_id, date, kind, source_id, qty_milli, value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), m.tankId, m.date, m.kind, m.sourceId, m.milli, m.value, now());
}

/** Takes a source's moves back (a reversal): the opposite of each, dated `date`. */
function reverseMoves(db: Db, sourceId: string, date: string): void {
  const moves = db.prepare('SELECT tank_id, kind, qty_milli, value FROM fuel_moves WHERE source_id = ? ORDER BY created_at, id').all(sourceId) as
    { tank_id: string; kind: MoveKind; qty_milli: number; value: number }[];
  for (const m of moves) addMove(db, { tankId: m.tank_id, date, kind: m.kind, sourceId, milli: -Number(m.qty_milli), value: -Number(m.value) });
}

// ——— fuels, tanks, pumps and nozzles ———

interface TypeRow { id: string; code: string; name_ar: string; name_en: string; name_ku: string; price: number; revenue_account: string; active: number; sort: number }
const typeView = (r: TypeRow): FuelTypeView => ({
  id: r.id, code: r.code, name: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, price: Number(r.price), revenueAccount: r.revenue_account, active: Number(r.active) === 1, sort: Number(r.sort)
});

export function listFuelTypes(db: Db): FuelTypeView[] {
  return (db.prepare('SELECT * FROM fuel_types ORDER BY sort, code').all() as unknown as TypeRow[]).map(typeView);
}

interface TankRow { id: string; code: string; name: string; fuel_type_id: string; capacity_milli: number; chart: string | null; last_cost: number; active: number }

function parseChart(text: string | null): ChartRow[] | null {
  if (!text) return null;
  try {
    const rows = JSON.parse(text) as unknown;
    return Array.isArray(rows) ? rows.map((r) => ({ mm: Number((r as ChartRow).mm), milli: Number((r as ChartRow).milli) })) : null;
  } catch {
    return null;
  }
}

function tankRow(db: Db, id: string): TankRow {
  const r = db.prepare('SELECT * FROM fuel_tanks WHERE id = ?').get(id) as unknown as TankRow | undefined;
  if (!r) throw notFound('fuel_tank');
  return r;
}

function openShiftNozzles(db: Db): Map<string, string> {
  return new Map((db.prepare(`SELECT r.nozzle_id, s.number FROM fuel_readings r JOIN fuel_shifts s ON s.id = r.shift_id WHERE s.status = 'open'`).all() as
    { nozzle_id: string; number: string }[]).map((r) => [r.nozzle_id, r.number]));
}

export function listTanks(db: Db): TankView[] {
  const rows = db.prepare('SELECT * FROM fuel_tanks ORDER BY code').all() as unknown as TankRow[];
  const busy = new Set((db.prepare(`SELECT DISTINCT r.tank_id FROM fuel_readings r JOIN fuel_shifts s ON s.id = r.shift_id WHERE s.status = 'open'`).all() as { tank_id: string }[]).map((r) => r.tank_id));
  const lastDip = db.prepare(`SELECT date, measured_milli, variance_milli FROM fuel_dips WHERE tank_id = ? AND status = 'posted' ORDER BY date DESC, created_at DESC LIMIT 1`);
  return rows.map((r) => {
    const stock = stockOf(db, r.id);
    const dip = lastDip.get(r.id) as { date: string; measured_milli: number; variance_milli: number } | undefined;
    return {
      id: r.id, code: r.code, name: r.name, fuelTypeId: r.fuel_type_id, capacityMilli: Number(r.capacity_milli), chart: parseChart(r.chart), active: Number(r.active) === 1,
      bookMilli: stock.milli, lastDip: dip ? { date: dip.date, measuredMilli: Number(dip.measured_milli), varianceMilli: Number(dip.variance_milli) } : null,
      value: stock.value, avgCost: averageCost(stock, Number(r.last_cost)), lastCost: Number(r.last_cost), inOpenShift: busy.has(r.id)
    };
  });
}

export function fuelSetup(db: Db): FuelSetupView {
  const open = openShiftNozzles(db);
  const nozzles = (db.prepare('SELECT * FROM fuel_nozzles ORDER BY number').all() as
    { id: string; pump_id: string; number: number; fuel_type_id: string; tank_id: string; meter_milli: number; meter_max_milli: number; active: number }[]).map((n): NozzleView => ({
    id: n.id, pumpId: n.pump_id, number: Number(n.number), fuelTypeId: n.fuel_type_id, tankId: n.tank_id, meterMilli: Number(n.meter_milli),
    meterMaxMilli: Number(n.meter_max_milli), active: Number(n.active) === 1, openShift: open.get(n.id) ?? null
  }));
  const pumps = (db.prepare('SELECT * FROM fuel_pumps ORDER BY number').all() as { id: string; number: number; active: number }[]).map((p): PumpView => ({
    id: p.id, number: Number(p.number), active: Number(p.active) === 1, nozzles: nozzles.filter((n) => n.pumpId === p.id)
  }));
  return { available: fuelAvailable(db), types: listFuelTypes(db), tanks: listTanks(db), pumps, settings: fuelSettings(db) };
}

export interface FuelTypeInput { code: string; name: Names; price: number; revenueAccount?: string | undefined; active?: boolean | undefined; sort?: number | undefined }

function checkRevenue(db: Db, code: string): void {
  if (!code.startsWith('4') || !postableAccounts(db).has(code)) throw invalid([{ code: 'fuel_account_invalid', field: 'revenueAccount', accountCode: code }]);
}

const trimNames = (n: Names): Names => ({ ar: n.ar.trim(), en: n.en.trim(), ku: n.ku.trim() });

export function saveFuelType(db: Db, id: string | null, input: FuelTypeInput, actor: Actor): FuelTypeView {
  requirePlan(db);
  const code = input.code.trim();
  const name = trimNames(input.name);
  if (!code || !name.ar || !name.en || !name.ku) throw invalid([{ code: 'fuel_name_required' }]);
  const revenue = input.revenueAccount ?? getPostingAccounts(db).sales;
  checkRevenue(db, revenue);
  return transaction(db, () => {
    if (db.prepare('SELECT id FROM fuel_types WHERE code = ? AND id <> ?').get(code, id ?? '')) throw conflict('fuel_code_taken');
    const at = now();
    if (id) {
      const before = db.prepare('SELECT * FROM fuel_types WHERE id = ?').get(id) as unknown as TypeRow | undefined;
      if (!before) throw notFound('fuel_type');
      // a fuel still held by an active tank stays active (its pumps would have no fuel to sell)
      if (input.active === false && Number(before.active) === 1 && db.prepare('SELECT 1 FROM fuel_tanks WHERE fuel_type_id = ? AND active = 1').get(id)) throw conflict('fuel_type_in_use');
      db.prepare('UPDATE fuel_types SET code = ?, name_ar = ?, name_en = ?, name_ku = ?, price = ?, revenue_account = ?, active = ?, sort = ?, updated_at = ? WHERE id = ?')
        .run(code, name.ar, name.en, name.ku, input.price, revenue, input.active === false ? 0 : 1, input.sort ?? Number(before.sort), at, id);
      // a price change shows on the next shift; an open shift keeps the price it was opened at
      audit(db, actor.name, 'update', 'fuel_type', id, { code, name, price: input.price, was: Number(before.price), active: input.active !== false, revenue });
      return typeView(db.prepare('SELECT * FROM fuel_types WHERE id = ?').get(id) as unknown as TypeRow);
    }
    const newId = randomUUID();
    db.prepare('INSERT INTO fuel_types (id, code, name_ar, name_en, name_ku, price, revenue_account, active, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId, code, name.ar, name.en, name.ku, input.price, revenue, input.active === false ? 0 : 1, input.sort ?? 0, at, at);
    audit(db, actor.name, 'create', 'fuel_type', newId, { code, price: input.price });
    return typeView(db.prepare('SELECT * FROM fuel_types WHERE id = ?').get(newId) as unknown as TypeRow);
  });
}

export interface TankInput {
  code: string; name: string; fuelTypeId: string; capacityMilli: number; chart?: ChartRow[] | null | undefined; active?: boolean | undefined;
  /** a new tank only: what it holds when the station starts with Qasa, at what cost per litre, on which day */
  openingMilli?: number | undefined; openingCost?: number | undefined; openingDate?: string | undefined; lang?: Lang | undefined;
}

const TEXT_OPENING: Record<Lang, (tank: string) => string> = {
  ar: (t) => `رصيد أول المدة للوقود — ${t}`, en: (t) => `Opening fuel stock — ${t}`, ku: (t) => `کۆگای سەرەتای سووتەمەنی — ${t}`
};

/** A new tank (with its opening stock, posted) or a change to one: its name, capacity, chart, fuel while unused, active. */
export function saveTank(db: Db, id: string | null, input: TankInput, actor: Actor): TankView {
  requirePlan(db);
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code || !name) throw invalid([{ code: 'fuel_name_required' }]);
  const chart = input.chart && input.chart.length ? input.chart : null;
  if (chart) {
    const problem = chartProblem(chart, input.capacityMilli);
    if (problem) throw invalid([{ code: `fuel_${problem}`, field: 'chart' }]);
  }
  const opening = id ? 0 : input.openingMilli ?? 0;
  if (opening > input.capacityMilli) throw invalid([{ code: 'fuel_tank_overfill', field: 'openingMilli', available: input.capacityMilli }]);
  if (opening > 0 && !input.openingCost) throw invalid([{ code: 'fuel_cost_required', field: 'openingCost' }]);
  const openingDate = input.openingDate ?? todayIso();
  if (opening > 0) assertDate(db, openingDate);
  const settings = fuelSettings(db);
  const tankId = id ?? randomUUID();
  transaction(db, () => {
    if (db.prepare('SELECT id FROM fuel_tanks WHERE code = ? AND id <> ?').get(code, tankId)) throw conflict('fuel_tank_taken');
    const fuel = db.prepare('SELECT active FROM fuel_types WHERE id = ?').get(input.fuelTypeId) as { active: number } | undefined;
    const at = now();
    if (id) {
      const before = tankRow(db, id);
      if (!fuel || (Number(fuel.active) !== 1 && before.fuel_type_id !== input.fuelTypeId)) throw invalid([{ code: 'fuel_type_invalid', field: 'fuelTypeId' }]);
      if (before.fuel_type_id !== input.fuelTypeId
        && (db.prepare('SELECT 1 FROM fuel_moves WHERE tank_id = ? LIMIT 1').get(id) || db.prepare('SELECT 1 FROM fuel_nozzles WHERE tank_id = ? LIMIT 1').get(id))) {
        throw conflict('fuel_tank_fuel_fixed');
      }
      if (input.capacityMilli < stockOf(db, id).milli) throw invalid([{ code: 'fuel_capacity_below_stock', field: 'capacityMilli' }]);
      if (input.active === false && Number(before.active) === 1 && db.prepare('SELECT 1 FROM fuel_nozzles WHERE tank_id = ? AND active = 1').get(id)) throw conflict('fuel_tank_in_use');
      db.prepare('UPDATE fuel_tanks SET code = ?, name = ?, fuel_type_id = ?, capacity_milli = ?, chart = ?, active = ?, updated_at = ? WHERE id = ?')
        .run(code, name, input.fuelTypeId, input.capacityMilli, chart ? JSON.stringify(chart) : null, input.active === false ? 0 : 1, at, id);
      audit(db, actor.name, 'update', 'fuel_tank', id, { code, name, capacityMilli: input.capacityMilli, chartRows: chart?.length ?? 0, active: input.active !== false });
      return;
    }
    if (!fuel || Number(fuel.active) !== 1) throw invalid([{ code: 'fuel_type_invalid', field: 'fuelTypeId' }]);
    db.prepare('INSERT INTO fuel_tanks (id, code, name, fuel_type_id, capacity_milli, chart, last_cost, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run(tankId, code, name, input.fuelTypeId, input.capacityMilli, chart ? JSON.stringify(chart) : null, input.openingCost ?? 0, at, at);
    let entryId: string | null = null;
    if (opening > 0) {
      const value = fuelAmount(opening, input.openingCost!);
      const description = TEXT_OPENING[input.lang ?? 'ar'](`${code} · ${name}`);
      if (value > 0) {
        const stock = stockAccount(db, settings, actor.name);
        entryId = createJournalEntry(db, {
          date: openingDate, description, currency: 'IQD', rateX100: 100,
          lines: [{ accountCode: stock, debit: value, credit: 0, description }, { accountCode: settings.openingAccount, debit: 0, credit: value, description }]
        }, actor.name, actor.id, preparerOf(actor)).id;
      }
      if (entryId) db.prepare('UPDATE fuel_tanks SET opening_entry_id = ? WHERE id = ?').run(entryId, tankId);
      addMove(db, { tankId, date: openingDate, kind: 'opening', sourceId: tankId, milli: opening, value });
    }
    audit(db, actor.name, 'create', 'fuel_tank', tankId, { code, name, capacityMilli: input.capacityMilli, openingMilli: opening, entry: entryId });
  });
  return listTanks(db).find((t) => t.id === tankId)!;
}

export interface NozzleInput { number: number; tankId: string; meterMilli: number; meterMaxMilli?: number | undefined }

/** The tank a nozzle may draw from: an active one of an active fuel; the nozzle sells that tank's fuel. */
function tankForNozzle(db: Db, tankId: string, label: string): TankRow {
  const tank = db.prepare('SELECT * FROM fuel_tanks WHERE id = ?').get(tankId) as unknown as TankRow | undefined;
  if (!tank || Number(tank.active) !== 1) throw invalid([{ code: 'fuel_tank_invalid', line: label }]);
  const fuel = db.prepare('SELECT active FROM fuel_types WHERE id = ?').get(tank.fuel_type_id) as { active: number } | undefined;
  if (!fuel || Number(fuel.active) !== 1) throw invalid([{ code: 'fuel_type_invalid', line: label }]);
  return tank;
}

function checkMeter(meter: number, max: number, label: string): void {
  if (max <= 0 || max > METER_MAX_MILLI || meter > max) throw invalid([{ code: 'fuel_meter_over_max', line: label }]);
}

function insertNozzle(db: Db, pumpId: string, pumpNumber: number, n: NozzleInput, at: string): string {
  const label = `${pumpNumber}/${n.number}`;
  const tank = tankForNozzle(db, n.tankId, label);
  const max = n.meterMaxMilli ?? DEFAULT_METER_MAX_MILLI;
  checkMeter(n.meterMilli, max, label);
  const id = randomUUID();
  db.prepare('INSERT INTO fuel_nozzles (id, pump_id, number, fuel_type_id, tank_id, meter_milli, meter_max_milli, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)')
    .run(id, pumpId, n.number, tank.fuel_type_id, tank.id, n.meterMilli, max, at);
  return id;
}

/** A new pump with its nozzles, each drawing from a tank, with its meter's reading today and its maximum. */
export function createPump(db: Db, input: { number: number; nozzles: NozzleInput[] }, actor: Actor): PumpView {
  requirePlan(db);
  const numbers = new Set(input.nozzles.map((n) => n.number));
  if (numbers.size !== input.nozzles.length) throw invalid([{ code: 'fuel_nozzle_twice' }]);
  const id = randomUUID();
  transaction(db, () => {
    if (db.prepare('SELECT 1 FROM fuel_pumps WHERE number = ?').get(input.number)) throw conflict('fuel_pump_taken');
    const at = now();
    db.prepare('INSERT INTO fuel_pumps (id, number, active, created_at) VALUES (?, ?, 1, ?)').run(id, input.number, at);
    for (const n of input.nozzles) insertNozzle(db, id, input.number, n, at);
    audit(db, actor.name, 'create', 'fuel_pump', id, { number: input.number, nozzles: input.nozzles.length });
  });
  return fuelSetup(db).pumps.find((p) => p.id === id)!;
}

/** A pump's number, or taking it out of use (none of its nozzles in an open shift). */
export function updatePump(db: Db, id: string, input: { number: number; active: boolean }, actor: Actor): PumpView {
  requirePlan(db);
  transaction(db, () => {
    const before = db.prepare('SELECT number, active FROM fuel_pumps WHERE id = ?').get(id) as { number: number; active: number } | undefined;
    if (!before) throw notFound('fuel_pump');
    if (db.prepare('SELECT 1 FROM fuel_pumps WHERE number = ? AND id <> ?').get(input.number, id)) throw conflict('fuel_pump_taken');
    if (!input.active && db.prepare(`SELECT 1 FROM fuel_readings r JOIN fuel_nozzles n ON n.id = r.nozzle_id JOIN fuel_shifts s ON s.id = r.shift_id
                                     WHERE n.pump_id = ? AND s.status = 'open'`).get(id)) throw conflict('fuel_nozzle_in_shift');
    db.prepare('UPDATE fuel_pumps SET number = ?, active = ? WHERE id = ?').run(input.number, input.active ? 1 : 0, id);
    audit(db, actor.name, 'update', 'fuel_pump', id, { number: input.number, was: Number(before.number), active: input.active });
  });
  return fuelSetup(db).pumps.find((p) => p.id === id)!;
}

export function addNozzle(db: Db, pumpId: string, input: NozzleInput, actor: Actor): NozzleView {
  requirePlan(db);
  const id = transaction(db, () => {
    const pump = db.prepare('SELECT number FROM fuel_pumps WHERE id = ?').get(pumpId) as { number: number } | undefined;
    if (!pump) throw notFound('fuel_pump');
    if (db.prepare('SELECT 1 FROM fuel_nozzles WHERE pump_id = ? AND number = ?').get(pumpId, input.number)) throw invalid([{ code: 'fuel_nozzle_twice' }]);
    const newId = insertNozzle(db, pumpId, Number(pump.number), input, now());
    audit(db, actor.name, 'create', 'fuel_nozzle', newId, { pump: Number(pump.number), number: input.number, tankId: input.tankId, meterMilli: input.meterMilli });
    return newId;
  });
  return fuelSetup(db).pumps.flatMap((p) => p.nozzles).find((n) => n.id === id)!;
}

/**
 * A nozzle's tank (its fuel follows the tank), its meter after a repair or a new meter, the meter's maximum, or taking
 * it out of use: only while it is in no open shift. Every change is audit-logged with what it was.
 */
export function updateNozzle(db: Db, id: string, input: { tankId: string; meterMilli?: number | undefined; meterMaxMilli?: number | undefined; active?: boolean | undefined }, actor: Actor): NozzleView {
  requirePlan(db);
  transaction(db, () => {
    const n = db.prepare('SELECT n.tank_id, n.meter_milli, n.meter_max_milli, n.active, n.number, p.number AS pump_number FROM fuel_nozzles n JOIN fuel_pumps p ON p.id = n.pump_id WHERE n.id = ?').get(id) as
      { tank_id: string; meter_milli: number; meter_max_milli: number; active: number; number: number; pump_number: number } | undefined;
    if (!n) throw notFound('fuel_nozzle');
    const open = openShiftNozzles(db).get(id);
    if (open) throw conflict('fuel_nozzle_in_shift', { shift: open });
    const label = `${n.pump_number}/${n.number}`;
    const tank = input.tankId === n.tank_id ? tankRow(db, n.tank_id) : tankForNozzle(db, input.tankId, label);
    const meter = input.meterMilli ?? Number(n.meter_milli);
    const max = input.meterMaxMilli ?? Number(n.meter_max_milli);
    checkMeter(meter, max, label);
    const active = input.active ?? Number(n.active) === 1;
    db.prepare('UPDATE fuel_nozzles SET tank_id = ?, fuel_type_id = ?, meter_milli = ?, meter_max_milli = ?, active = ? WHERE id = ?')
      .run(tank.id, tank.fuel_type_id, meter, max, active ? 1 : 0, id);
    audit(db, actor.name, 'update', 'fuel_nozzle', id, {
      tankId: tank.id, wasTank: n.tank_id, meterMilli: meter, wasMeter: Number(n.meter_milli), meterMaxMilli: max, wasMax: Number(n.meter_max_milli), active
    });
  });
  return fuelSetup(db).pumps.flatMap((p) => p.nozzles).find((n) => n.id === id)!;
}

// ——— shifts ———

interface ShiftRow {
  id: string; number: string; date: string; shift: FuelShift; attendant: string; status: FuelShiftStatus; credit: number; handed: number | null;
  sales: number | null; cost: number | null; difference: number | null; cash_account: string | null; entry_id: string | null; reversal_entry_id: string | null;
  notes: string | null; opened_by: string; opened_at: string; closed_by: string | null; closed_at: string | null;
  reversed_by: string | null; reversed_at: string | null; reverse_reason: string | null;
}

function readingsOf(db: Db, shiftId: string): ReadingView[] {
  return (db.prepare(`SELECT r.nozzle_id, r.fuel_type_id, r.tank_id, r.price, r.opening_milli, r.closing_milli, r.meter_max_milli, r.rollover, r.cost,
                             n.number AS nozzle_number, p.number AS pump_number, t.capacity_milli
                      FROM fuel_readings r JOIN fuel_nozzles n ON n.id = r.nozzle_id JOIN fuel_pumps p ON p.id = n.pump_id JOIN fuel_tanks t ON t.id = r.tank_id
                      WHERE r.shift_id = ? ORDER BY p.number, n.number`).all(shiftId) as
    { nozzle_id: string; fuel_type_id: string; tank_id: string; price: number; opening_milli: number; closing_milli: number | null; meter_max_milli: number; rollover: number;
      cost: number | null; nozzle_number: number; pump_number: number; capacity_milli: number }[])
    .map((r) => ({
      nozzleId: r.nozzle_id, fuelTypeId: r.fuel_type_id, tankId: r.tank_id, price: Number(r.price), openingMilli: Number(r.opening_milli),
      closingMilli: r.closing_milli === null ? null : Number(r.closing_milli), meterMaxMilli: Number(r.meter_max_milli), rollover: Number(r.rollover) === 1,
      limitMilli: Number(r.capacity_milli), cost: r.cost === null ? null : Number(r.cost), pumpNumber: Number(r.pump_number), nozzleNumber: Number(r.nozzle_number)
    }));
}

function entryRef(db: Db, id: string | null): EntryRef | null {
  if (!id) return null;
  const e = getEntry(db, id);
  return { id: e.id, number: e.number, status: e.status };
}

function summaryOf(db: Db, r: ShiftRow): ShiftSummary {
  const pumps = (db.prepare(`SELECT DISTINCT p.number FROM fuel_readings r JOIN fuel_nozzles n ON n.id = r.nozzle_id JOIN fuel_pumps p ON p.id = n.pump_id
                             WHERE r.shift_id = ? ORDER BY p.number`).all(r.id) as { number: number }[]).map((p) => Number(p.number));
  const sales = r.sales === null ? null : Number(r.sales);
  const cost = r.cost === null ? null : Number(r.cost);
  return {
    id: r.id, number: r.number, date: r.date, shift: r.shift, attendant: r.attendant, status: r.status, pumps,
    sales, credit: Number(r.credit), handed: r.handed === null ? null : Number(r.handed),
    difference: r.difference === null ? null : Number(r.difference),
    cost, profit: sales !== null && cost !== null ? sales - cost : null,
    entry: entryRef(db, r.entry_id), reversal: entryRef(db, r.reversal_entry_id),
    openedBy: r.opened_by, openedAt: r.opened_at, closedBy: r.closed_by, closedAt: r.closed_at,
    reversedBy: r.reversed_by, reversedAt: r.reversed_at, reverseReason: r.reverse_reason
  };
}

function shiftRow(db: Db, id: string): ShiftRow {
  const r = db.prepare('SELECT * FROM fuel_shifts WHERE id = ?').get(id) as unknown as ShiftRow | undefined;
  if (!r) throw notFound('fuel_shift');
  return r;
}

/**
 * Whether this user opened the shift (as the till's shifts, pos.ts): with sign-in on, the user id kept in the shift's
 * append-only "open" audit record decides (names are not unique); without sign-in, the name typed on the PC.
 */
function isOpener(db: Db, row: Pick<ShiftRow, 'id' | 'opened_by'>, actor: Pick<Actor, 'id' | 'name'>): boolean {
  if (actor.id && signInRequired(db)) {
    const opened = db.prepare("SELECT details FROM audit_log WHERE entity = 'fuel_shift' AND entity_id = ? AND action = 'open' ORDER BY id DESC LIMIT 1")
      .get(row.id) as { details: string | null } | undefined;
    let openerId: unknown = null;
    try { openerId = opened?.details ? (JSON.parse(opened.details) as { userId?: unknown }).userId ?? null : null; } catch { openerId = null; }
    return typeof openerId === 'string' && openerId === actor.id;
  }
  return row.opened_by === actor.name;
}

/** Whoever keeps the books reads every shift; anyone else (a cashier) only the shifts they opened. */
function readsShift(db: Db, row: Pick<ShiftRow, 'id' | 'opened_by'>, actor: Actor | null): boolean {
  return !actor || seesBooks(actor) || isOpener(db, row, actor);
}

/** An open shift's sheet is worked by the person who opened it, or an admin (as a till's shift is). */
function mayRun(db: Db, id: string, actor: Actor): void {
  if (actor.permissions.includes('admin')) return;
  if (!isOpener(db, shiftRow(db, id), actor)) throw new AppError(403, 'forbidden');
}

/** A shift as this user may read it: not there for a cashier who did not open it. */
export function readShift(db: Db, id: string, actor: Actor): ShiftView {
  if (!readsShift(db, shiftRow(db, id), actor)) throw notFound('fuel_shift');
  return getShift(db, id);
}

export function getShift(db: Db, id: string): ShiftView {
  const r = shiftRow(db, id);
  const readings = readingsOf(db, id);
  const totals = shiftTotals(readings);
  const sales = r.status !== 'open' && r.sales !== null ? Number(r.sales) : totals.sales;
  return {
    ...summaryOf(db, r),
    readings, totals,
    cash: r.handed === null ? null : shiftCash(sales, Number(r.credit), Number(r.handed)),
    notes: r.notes ?? '',
    actions: r.status === 'open' ? ['save', 'close', 'cancel'] : r.status === 'closed' ? ['reverse'] : []
  };
}

export function listShifts(db: Db, f: { from?: string | undefined; to?: string | undefined; attendant?: string | undefined; status?: FuelShiftStatus | undefined } = {},
  actor: Actor | null = null): ShiftSummary[] {
  const ownOnly = !!actor && !seesBooks(actor);
  const where: string[] = [];
  const params: string[] = [];
  if (f.from) { where.push('date >= ?'); params.push(f.from); }
  if (f.to) { where.push('date <= ?'); params.push(f.to); }
  if (f.attendant) { where.push('attendant = ?'); params.push(f.attendant); }
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  const rows = db.prepare(`SELECT * FROM fuel_shifts${where.length ? ' WHERE ' + where.join(' AND ') : ''}
                           ORDER BY date DESC, CASE shift WHEN 'night' THEN 0 WHEN 'evening' THEN 1 ELSE 2 END, number DESC${ownOnly ? '' : ' LIMIT 500'}`).all(...params) as unknown as ShiftRow[];
  // a cashier gets their own shifts only (up to 500 of theirs, not of everyone's)
  return rows.filter((r) => !ownOnly || readsShift(db, r, actor)).slice(0, 500).map((r) => summaryOf(db, r));
}

export interface OpenShiftInput { date: string; shift: FuelShift; attendant: string; pumpIds: string[] }

/** Opens a shift on the pumps given: each nozzle's opening reading is its meter's last closing, at today's fuel prices. */
export function openShift(db: Db, input: OpenShiftInput, actor: Actor): ShiftView {
  requirePlan(db);
  const attendant = input.attendant.trim();
  if (!attendant) throw invalid([{ code: 'fuel_attendant_required', field: 'attendant' }]);
  if (!isIsoDate(input.date)) throw invalid([{ code: 'date_invalid', field: 'date' }]);
  const id = randomUUID();
  transaction(db, () => {
    const setup = fuelSetup(db);
    const pumps = [...new Set(input.pumpIds)].map((pid) => setup.pumps.find((p) => p.id === pid && p.active));
    if (!pumps.length || pumps.some((p) => !p)) throw invalid([{ code: 'fuel_pump_invalid', field: 'pumpIds' }]);
    const nozzles = pumps.flatMap((p) => p!.nozzles.filter((n) => n.active));
    if (!nozzles.length) throw invalid([{ code: 'fuel_pump_invalid', field: 'pumpIds' }]);
    // a nozzle is in one open shift at a time, so no litre is counted twice
    const busy = nozzles.find((n) => n.openShift);
    if (busy) throw conflict('fuel_nozzle_in_shift', { shift: busy.openShift });
    const types = new Map(setup.types.map((t) => [t.id, t]));
    const tanks = new Map(setup.tanks.map((t) => [t.id, t]));
    for (const n of nozzles) {
      const pump = pumps.find((p) => p!.id === n.pumpId)!;
      if (!types.get(n.fuelTypeId)?.active || !tanks.get(n.tankId)?.active) throw invalid([{ code: 'fuel_tank_invalid', line: `${pump.number}/${n.number}` }]);
    }
    const number = `SH-${String(nextSequence(db, 'fuel_shift')).padStart(4, '0')}`;
    db.prepare(`INSERT INTO fuel_shifts (id, number, date, shift, attendant, status, credit, opened_by, opened_at) VALUES (?, ?, ?, ?, ?, 'open', 0, ?, ?)`)
      .run(id, number, input.date, input.shift, attendant, actor.name, now());
    const add = db.prepare(`INSERT INTO fuel_readings (shift_id, nozzle_id, fuel_type_id, tank_id, price, opening_milli, closing_milli, meter_max_milli, rollover)
                            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0)`);
    for (const n of nozzles) add.run(id, n.id, n.fuelTypeId, n.tankId, types.get(n.fuelTypeId)!.price, n.meterMilli, n.meterMaxMilli);
    audit(db, actor.name, 'open', 'fuel_shift', id, { number, attendant, shift: input.shift, nozzles: nozzles.length, ...(actor.id ? { userId: actor.id } : {}) });
  });
  return getShift(db, id);
}

export interface SheetInput {
  /** closing readings only: an opening reading is the meter's last closing, never typed in (it would hide litres sold) */
  readings: { nozzleId: string; closingMilli: number | null; rollover?: boolean | undefined }[];
  credit?: number | undefined;
  handed?: number | null | undefined;
  notes?: string | undefined;
}

const nozzleLabel = (r: ReadingView) => `${r.pumpNumber}/${r.nozzleNumber}`;
const READING_ERROR: Record<string, string> = {
  closing_below_opening: 'fuel_closing_below_opening', rollover_not_needed: 'fuel_rollover_not_needed', rollover_implausible: 'fuel_rollover_implausible', reading_invalid: 'fuel_reading_invalid'
};

/**
 * Writes the sheet's readings and cash into an open shift (inside its transaction); every reading is checked, a wrong
 * one named by its pump/nozzle: closing below opening unless the meter rolled over, a rollover only when the meter went
 * back and the litres it makes fit the tank.
 */
function writeSheet(db: Db, shift: ShiftView, input: SheetInput): ReadingView[] {
  const byId = new Map(shift.readings.map((r) => [r.nozzleId, r]));
  const errors: { code: string; field?: string; line?: string }[] = [];
  const next = new Map(shift.readings.map((r) => [r.nozzleId, { ...r }]));
  for (const given of input.readings) {
    const r = byId.get(given.nozzleId);
    if (!r) { errors.push({ code: 'fuel_nozzle_not_in_shift' }); continue; }
    const row = next.get(given.nozzleId)!;
    row.closingMilli = given.closingMilli;
    row.rollover = given.closingMilli !== null && given.rollover === true;
    const problem = readingProblem(row);
    if (problem && problem !== 'closing_missing') errors.push({ code: READING_ERROR[problem]!, line: nozzleLabel(r) });
  }
  const credit = input.credit ?? shift.credit;
  const sales = shiftTotals([...next.values()]).sales;
  if (!Number.isSafeInteger(sales) || sales > MAX_AMOUNT) errors.push({ code: 'fuel_reading_invalid', line: '' });
  if (credit > sales) errors.push({ code: 'fuel_credit_over_sales', field: 'credit' });
  if (errors.length) throw invalid(errors);
  const update = db.prepare('UPDATE fuel_readings SET closing_milli = ?, rollover = ? WHERE shift_id = ? AND nozzle_id = ?');
  for (const r of next.values()) update.run(r.closingMilli, r.rollover ? 1 : 0, shift.id, r.nozzleId);
  db.prepare('UPDATE fuel_shifts SET credit = ?, handed = ?, notes = ? WHERE id = ?')
    .run(credit, input.handed === undefined ? shift.handed : input.handed, input.notes === undefined ? (shift.notes || null) : (input.notes.trim() || null), shift.id);
  return [...next.values()];
}

/** The shift as it stands inside the transaction, when `action` may be done to it; else action_not_allowed. */
function shiftFor(db: Db, id: string, action: FuelShiftAction): ShiftView {
  const shift = getShift(db, id);
  if (!shift.actions.includes(action)) throw conflict('action_not_allowed', { action, status: shift.status });
  return shift;
}

export function saveSheet(db: Db, id: string, input: SheetInput, actor: Actor): ShiftView {
  requirePlan(db);
  transaction(db, () => {
    mayRun(db, id, actor);
    const shift = shiftFor(db, id, 'save');
    writeSheet(db, shift, input);
    audit(db, actor.name, 'save', 'fuel_shift', id, { number: shift.number });
  });
  return getShift(db, id);
}

const SHIFT_WORD: Record<Lang, Record<FuelShift, string>> = {
  ar: { morning: 'الصباحية', evening: 'المسائية', night: 'الليلية' },
  en: { morning: 'morning', evening: 'evening', night: 'night' },
  ku: { morning: 'بەیانی', evening: 'ئێوارە', night: 'شەو' }
};
const TEXT: Record<Lang, {
  entry: (n: string, s: FuelShift, who: string) => string; litres: (fuel: string, l: string, p: number) => string;
  cash: string; credit: string; short: (who: string) => string; over: (who: string) => string; cost: (fuel: string, l: string) => string;
  delivery: (n: string, note: string, supplier: string, tank: string) => string; deliveryLine: (l: string, p: number) => string;
  dipLoss: (n: string, tank: string, l: string) => string; dipGain: (n: string, tank: string, l: string) => string;
}> = {
  ar: {
    entry: (n, s, who) => `مبيعات الوقود — الوردية ${SHIFT_WORD.ar[s]} ${n} — ${who}`, litres: (f, l, p) => `${f}: ${l} لتر × ${p}`,
    cash: 'النقد المسلَّم', credit: 'آجل وكوبونات', short: (who) => `عجز الوردية على ${who}`, over: (who) => `زيادة الوردية — ${who}`,
    cost: (f, l) => `كلفة ${f} المباع: ${l} لتر`,
    delivery: (n, note, s, t) => `استلام وقود ${n} — وصل الاستلام ${note} — ${s} — ${t}`, deliveryLine: (l, p) => `${l} لتر × ${p}`,
    dipLoss: (n, t, l) => `عجز قياس الخزان ${n} — ${t}: ${l} لتر`, dipGain: (n, t, l) => `زيادة قياس الخزان ${n} — ${t}: ${l} لتر`
  },
  en: {
    entry: (n, s, who) => `Fuel sales — ${SHIFT_WORD.en[s]} shift ${n} — ${who}`, litres: (f, l, p) => `${f}: ${l} L × ${p}`,
    cash: 'Cash handed in', credit: 'Credit and coupons', short: (who) => `Shift shortage owed by ${who}`, over: (who) => `Shift cash over — ${who}`,
    cost: (f, l) => `Cost of ${f} sold: ${l} L`,
    delivery: (n, note, s, t) => `Fuel delivery ${n} — delivery note ${note} — ${s} — ${t}`, deliveryLine: (l, p) => `${l} L × ${p}`,
    dipLoss: (n, t, l) => `Tank dip ${n} loss — ${t}: ${l} L`, dipGain: (n, t, l) => `Tank dip ${n} gain — ${t}: ${l} L`
  },
  ku: {
    entry: (n, s, who) => `فرۆشتنی سووتەمەنی — شەفتی ${SHIFT_WORD.ku[s]} ${n} — ${who}`, litres: (f, l, p) => `${f}: ${l} لیتر × ${p}`,
    cash: 'نەقدی ڕادەستکراو', credit: 'قەرز و کوپۆن', short: (who) => `کەمیی شەفت لەسەر ${who}`, over: (who) => `زیادەی شەفت — ${who}`,
    cost: (f, l) => `تێچووی ${f}ی فرۆشراو: ${l} لیتر`,
    delivery: (n, note, s, t) => `وەرگرتنی سووتەمەنی ${n} — وەسڵی وەرگرتن ${note} — ${s} — ${t}`, deliveryLine: (l, p) => `${l} لیتر × ${p}`,
    dipLoss: (n, t, l) => `کەمیی پێوانەی تانکی ${n} — ${t}: ${l} لیتر`, dipGain: (n, t, l) => `زیادەی پێوانەی تانکی ${n} — ${t}: ${l} لیتر`
  }
};

type Line = { accountCode: string; debit: number; credit: number; description: string; partyId?: string };

/**
 * The lines of the shift's entry (see the top of this file). Balanced: handed + credit + shortage + cost = sales + over
 * + cost. `costByFuel` is each fuel's cost of the litres sold (none for a fuel whose cost is nothing).
 */
export function shiftEntryLines(
  shift: { attendant: string }, totals: ShiftTotals, cash: ShiftCash, types: FuelTypeView[], settings: FuelSettings, cashAccount: string, lang: Lang,
  costByFuel: ReadonlyMap<string, number> = new Map(), stock = settings.stockAccount
): Line[] {
  const t = TEXT[lang];
  const lines: Line[] = [];
  const typeOf = new Map(types.map((x) => [x.id, x]));
  const milliOf = new Map<string, number>();
  for (const f of totals.byFuel) milliOf.set(f.fuelTypeId, (milliOf.get(f.fuelTypeId) ?? 0) + f.milli);
  const costText = (fuel: string) => t.cost(typeOf.get(fuel)!.name[lang], meterText(milliOf.get(fuel) ?? 0));
  if (cash.handed > 0) lines.push({ accountCode: cashAccount, debit: cash.handed, credit: 0, description: t.cash });
  if (cash.credit > 0) lines.push({ accountCode: settings.creditAccount, debit: cash.credit, credit: 0, description: t.credit });
  if (cash.difference < 0) lines.push({ accountCode: settings.shortAccount, debit: -cash.difference, credit: 0, description: t.short(shift.attendant) });
  const costs = [...costByFuel].filter(([, c]) => c > 0);
  for (const [fuel, c] of costs) lines.push({ accountCode: settings.costAccount, debit: c, credit: 0, description: costText(fuel) });
  for (const f of totals.byFuel) {
    if (f.amount <= 0) continue;
    const type = typeOf.get(f.fuelTypeId)!;
    lines.push({ accountCode: type.revenueAccount, debit: 0, credit: f.amount, description: t.litres(type.name[lang], meterText(f.milli), f.price) });
  }
  if (cash.difference > 0) lines.push({ accountCode: settings.overAccount, debit: 0, credit: cash.difference, description: t.over(shift.attendant) });
  for (const [fuel, c] of costs) lines.push({ accountCode: stock, debit: 0, credit: c, description: costText(fuel) });
  return lines;
}

export interface CloseInput extends SheetInput { handed: number; cashAccount?: string | undefined; lang: Lang }

/**
 * Closes the shift: every nozzle needs its closing reading, the cash handed in is written, the litres leave their tanks
 * at each tank's average cost, the entry is made (createJournalEntry, so "Vouchers need approval" and the checker and
 * approver apply as to any entry), and each nozzle's meter moves on to its closing reading. All in one transaction,
 * which first takes the shift from open to closed (guarded by its status): a second close of the same shift finds it
 * closed and changes nothing.
 */
export function closeShift(db: Db, id: string, input: CloseInput, actor: Actor): ShiftView {
  requirePlan(db);
  const settings = fuelSettings(db);
  const cashAccount = input.cashAccount ?? settings.cashAccount;
  if (!cashAccount.startsWith('18') || !postableAccounts(db).has(cashAccount)) throw invalid([{ code: 'fuel_account_invalid', field: 'cashAccount', accountCode: cashAccount }]);
  transaction(db, () => {
    mayRun(db, id, actor);
    const shift = shiftFor(db, id, 'close');
    const claimed = db.prepare(`UPDATE fuel_shifts SET status = 'closed', closed_by = ?, closed_at = ? WHERE id = ? AND status = 'open'`).run(actor.name, now(), id);
    if (Number(claimed.changes) !== 1) throw conflict('action_not_allowed', { action: 'close' });
    const readings = writeSheet(db, shift, input);
    const missing = readings.filter((r) => r.closingMilli === null);
    if (missing.length) throw invalid(missing.map((r) => ({ code: 'fuel_closing_missing', line: nozzleLabel(r) })));
    const totals = shiftTotals(readings);
    const credit = input.credit ?? shift.credit;
    const cash = shiftCash(totals.sales, credit, input.handed);
    if (totals.sales <= 0 && input.handed <= 0) throw conflict('fuel_shift_empty');
    // the litres leave their tanks at each tank's average cost, nozzle by nozzle
    const stockByTank = new Map<string, TankStock & { last: number }>();
    const costByFuel = new Map<string, number>();
    const moveByTank = new Map<string, { milli: number; value: number }>();
    const setCost = db.prepare('UPDATE fuel_readings SET cost = ? WHERE shift_id = ? AND nozzle_id = ?');
    let totalCost = 0;
    for (const r of readings) {
      const milli = soldMilli(r);
      let stock = stockByTank.get(r.tankId);
      if (!stock) { stock = { ...stockOf(db, r.tankId), last: Number(tankRow(db, r.tankId).last_cost) }; stockByTank.set(r.tankId, stock); }
      const cost = tankCostOut(stock, milli, stock.last);
      stock.milli -= milli;
      stock.value -= cost;
      setCost.run(cost, id, r.nozzleId);
      costByFuel.set(r.fuelTypeId, (costByFuel.get(r.fuelTypeId) ?? 0) + cost);
      const m = moveByTank.get(r.tankId) ?? { milli: 0, value: 0 };
      m.milli += milli;
      m.value += cost;
      moveByTank.set(r.tankId, m);
      totalCost += cost;
    }
    for (const [tankId, m] of moveByTank) if (m.milli > 0 || m.value > 0) addMove(db, { tankId, date: shift.date, kind: 'sale', sourceId: id, milli: -m.milli, value: -m.value });
    const stock = totalCost > 0 ? stockAccount(db, settings, actor.name) : settings.stockAccount;
    const lines = shiftEntryLines(shift, totals, cash, listFuelTypes(db), settings, cashAccount, input.lang, costByFuel, stock);
    const entry = createJournalEntry(db, {
      date: shift.date, description: TEXT[input.lang].entry(shift.number, shift.shift, shift.attendant), currency: 'IQD', rateX100: 100, lines
    }, actor.name, actor.id, preparerOf(actor));
    const meter = db.prepare('UPDATE fuel_nozzles SET meter_milli = ? WHERE id = ?');
    for (const r of readings) meter.run(r.closingMilli!, r.nozzleId);
    db.prepare('UPDATE fuel_shifts SET sales = ?, cost = ?, difference = ?, cash_account = ?, entry_id = ? WHERE id = ?')
      .run(totals.sales, totalCost, cash.difference, cashAccount, entry.id, id);
    audit(db, actor.name, 'close', 'fuel_shift', id, { number: shift.number, sales: totals.sales, cost: totalCost, handed: cash.handed, difference: cash.difference, entry: entry.id });
  });
  return getShift(db, id);
}

/** An open shift is taken away (opened by mistake); its nozzles keep their meters. */
export function cancelShift(db: Db, id: string, actor: Actor): void {
  requirePlan(db);
  transaction(db, () => {
    mayRun(db, id, actor);
    const shift = shiftFor(db, id, 'cancel');
    db.prepare('DELETE FROM fuel_readings WHERE shift_id = ?').run(id);
    const gone = db.prepare("DELETE FROM fuel_shifts WHERE id = ? AND status = 'open'").run(id);
    if (Number(gone.changes) !== 1) throw conflict('action_not_allowed', { action: 'cancel' });
    audit(db, actor.name, 'cancel', 'fuel_shift', id, { number: shift.number });
  });
}

/**
 * Takes a posted entry out of the books for a reversal (inside its transaction): an approved one is reversed (the
 * exact opposite entry, dated `date`); a draft (or one waiting for approval) is deleted, once `unlink` has let go of it.
 * A checked one is returned to draft by the checker first.
 */
function undoEntry(db: Db, entryId: string | null, date: string, user: string, unlink: () => void): string | null {
  if (!entryId) return null;
  const entry = getEntry(db, entryId);
  if (entry.status === 'approved') {
    if (entry.reversedById) throw conflict('fuel_entry_reversed');
    return reverseEntryInternal(db, entryId, user, date);
  }
  if (entry.status !== 'draft') throw conflict('fuel_entry_checked', { status: entry.status });
  unlink();
  deleteEntry(db, entryId, user);
  return null;
}

/**
 * An admin reverses a closed shift (with a reason): its entry is reversed (or deleted while a draft), its litres go
 * back into their tanks at the cost they left at, and each nozzle's meter goes back to its opening reading, so the shift
 * can be done again. Only the last shift of its nozzles: a meter that moved on since (a later shift) would be wound back.
 */
export function reverseShift(db: Db, id: string, input: { reason: string }, actor: Actor): ShiftView {
  requirePlan(db);
  const reason = input.reason.trim();
  if (reason.length < 3) throw invalid([{ code: 'fuel_reason_required', field: 'reason' }]);
  transaction(db, () => {
    const shift = shiftFor(db, id, 'reverse');
    const date = reversalDate(shift.date);
    assertDate(db, date);
    const open = openShiftNozzles(db);
    const meters = db.prepare('SELECT meter_milli FROM fuel_nozzles WHERE id = ?');
    for (const r of shift.readings) {
      const m = meters.get(r.nozzleId) as { meter_milli: number } | undefined;
      if (open.has(r.nozzleId) || !m || Number(m.meter_milli) !== r.closingMilli) throw invalid([{ code: 'fuel_shift_not_last', line: nozzleLabel(r) }]);
    }
    const claimed = db.prepare(`UPDATE fuel_shifts SET status = 'reversed', reversed_by = ?, reversed_at = ?, reverse_reason = ? WHERE id = ? AND status = 'closed'`)
      .run(actor.name, now(), reason, id);
    if (Number(claimed.changes) !== 1) throw conflict('action_not_allowed', { action: 'reverse' });
    const reversal = undoEntry(db, shift.entry?.id ?? null, date, actor.name, () => db.prepare('UPDATE fuel_shifts SET entry_id = NULL WHERE id = ?').run(id));
    if (reversal) db.prepare('UPDATE fuel_shifts SET reversal_entry_id = ? WHERE id = ?').run(reversal, id);
    reverseMoves(db, id, date);
    const meter = db.prepare('UPDATE fuel_nozzles SET meter_milli = ? WHERE id = ?');
    for (const r of shift.readings) meter.run(r.openingMilli, r.nozzleId);
    audit(db, actor.name, 'reverse', 'fuel_shift', id, { number: shift.number, reason, entry: shift.entry?.id ?? null, reversal });
  });
  return getShift(db, id);
}

/** Each attendant's closed shifts in a period: litres' money, shortages and cash over (a reversed shift is not counted). */
export function attendantTotals(db: Db, from: string, to: string): { attendant: string; shifts: number; sales: number; short: number; over: number }[] {
  return (db.prepare(`SELECT attendant, COUNT(*) AS shift_count, SUM(sales) AS sales,
                             SUM(CASE WHEN difference < 0 THEN -difference ELSE 0 END) AS short_amount,
                             SUM(CASE WHEN difference > 0 THEN difference ELSE 0 END) AS over_amount
                      FROM fuel_shifts WHERE status = 'closed' AND date >= ? AND date <= ? GROUP BY attendant ORDER BY attendant`).all(from, to) as
    { attendant: string; shift_count: number; sales: number; short_amount: number; over_amount: number }[])
    .map((r) => ({ attendant: r.attendant, shifts: Number(r.shift_count), sales: Number(r.sales ?? 0), short: Number(r.short_amount ?? 0), over: Number(r.over_amount ?? 0) }));
}

// ——— deliveries ———

export type DocStatus = 'posted' | 'reversed';
export interface DeliveryView {
  id: string; number: string; date: string; tankId: string; supplierId: string; supplierName: string; noteNo: string; qtyMilli: number;
  /** what the litres cost (left out for someone who may not see cost) */
  costPerLitre: number; cost: number;
  payment: 'cash' | 'credit'; cashAccount: string | null; status: DocStatus; entry: EntryRef | null; reversal: EntryRef | null; notes: string;
  createdBy: string; createdAt: string; reversedBy: string | null; reversedAt: string | null; reverseReason: string | null;
  actions: 'reverse'[];
}

interface DeliveryRow {
  id: string; number: string; date: string; tank_id: string; supplier_id: string; supplier_name: string; note_no: string; qty_milli: number; cost_per_litre: number;
  cost: number; payment: 'cash' | 'credit'; cash_account: string | null; status: DocStatus; entry_id: string | null; reversal_entry_id: string | null; notes: string | null;
  created_by: string; created_at: string; reversed_by: string | null; reversed_at: string | null; reverse_reason: string | null;
}

const deliveryView = (db: Db, r: DeliveryRow): DeliveryView => ({
  id: r.id, number: r.number, date: r.date, tankId: r.tank_id, supplierId: r.supplier_id, supplierName: r.supplier_name, noteNo: r.note_no, qtyMilli: Number(r.qty_milli),
  costPerLitre: Number(r.cost_per_litre), cost: Number(r.cost), payment: r.payment, cashAccount: r.cash_account, status: r.status,
  entry: entryRef(db, r.entry_id), reversal: entryRef(db, r.reversal_entry_id), notes: r.notes ?? '',
  createdBy: r.created_by, createdAt: r.created_at, reversedBy: r.reversed_by, reversedAt: r.reversed_at, reverseReason: r.reverse_reason,
  actions: r.status === 'posted' ? ['reverse'] : []
});

const SELECT_DELIVERY = 'SELECT d.*, p.name AS supplier_name FROM fuel_deliveries d JOIN parties p ON p.id = d.supplier_id';

export function getDelivery(db: Db, id: string): DeliveryView {
  const r = db.prepare(`${SELECT_DELIVERY} WHERE d.id = ?`).get(id) as unknown as DeliveryRow | undefined;
  if (!r) throw notFound('fuel_delivery');
  return deliveryView(db, r);
}

export function listDeliveries(db: Db, f: { from?: string | undefined; to?: string | undefined; tankId?: string | undefined } = {}): DeliveryView[] {
  const where: string[] = [];
  const params: string[] = [];
  if (f.from) { where.push('d.date >= ?'); params.push(f.from); }
  if (f.to) { where.push('d.date <= ?'); params.push(f.to); }
  if (f.tankId) { where.push('d.tank_id = ?'); params.push(f.tankId); }
  return (db.prepare(`${SELECT_DELIVERY}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY d.date DESC, d.number DESC LIMIT 500`).all(...params) as unknown as DeliveryRow[])
    .map((r) => deliveryView(db, r));
}

export interface DeliveryInput {
  date: string; tankId: string; supplierId: string; noteNo: string; qtyMilli: number; costPerLitre: number; payment: 'cash' | 'credit';
  cashAccount?: string | undefined; notes?: string | undefined; overCapacity?: boolean | undefined; lang: Lang;
}

/**
 * A tanker's delivery into a tank: litres at a price per litre (dinars), paid now from the safe or owed to the supplier.
 * The tank must have room (an admin may go past its capacity, saying so), and a supplier's delivery note is entered
 * once. The litres come in at their own price, so the tank's average cost moves.
 */
export function createDelivery(db: Db, input: DeliveryInput, actor: Actor): DeliveryView {
  requirePlan(db);
  assertDate(db, input.date);
  const noteNo = input.noteNo.trim();
  if (!noteNo) throw invalid([{ code: 'fuel_note_required', field: 'noteNo' }]);
  const settings = fuelSettings(db);
  const cashAccount = input.payment === 'cash' ? input.cashAccount ?? settings.cashAccount : null;
  if (cashAccount !== null && (!cashAccount.startsWith('18') || !postableAccounts(db).has(cashAccount))) throw invalid([{ code: 'fuel_account_invalid', field: 'cashAccount', accountCode: cashAccount }]);
  const id = randomUUID();
  transaction(db, () => {
    const tank = db.prepare('SELECT * FROM fuel_tanks WHERE id = ?').get(input.tankId) as unknown as TankRow | undefined;
    if (!tank || Number(tank.active) !== 1) throw invalid([{ code: 'fuel_tank_invalid', field: 'tankId' }]);
    const supplier = db.prepare('SELECT id, name, type, active, account_code FROM parties WHERE id = ?').get(input.supplierId) as
      { id: string; name: string; type: string; active: number; account_code: string } | undefined;
    if (!supplier || supplier.type !== 'supplier' || Number(supplier.active) !== 1) throw invalid([{ code: 'fuel_supplier_invalid', field: 'supplierId' }]);
    if (db.prepare("SELECT 1 FROM fuel_deliveries WHERE supplier_id = ? AND note_no = ? AND status = 'posted'").get(supplier.id, noteNo)) throw conflict('fuel_note_taken');
    const stock = stockOf(db, tank.id);
    const room = Number(tank.capacity_milli) - Math.max(0, stock.milli);
    const mayOverfill = input.overCapacity === true && actor.permissions.includes('admin');
    if (input.qtyMilli > room && !mayOverfill) throw invalid([{ code: 'fuel_tank_overfill', field: 'qtyMilli', available: Math.max(0, room) }]);
    const cost = fuelAmount(input.qtyMilli, input.costPerLitre);
    if (cost <= 0) throw invalid([{ code: 'fuel_cost_required', field: 'costPerLitre' }]);
    const number = `FD-${String(nextSequence(db, 'fuel_delivery')).padStart(4, '0')}`;
    const t = TEXT[input.lang];
    const description = t.delivery(number, noteNo, supplier.name, `${tank.code} · ${tank.name}`);
    const lineText = t.deliveryLine(meterText(input.qtyMilli), input.costPerLitre);
    const lines: Line[] = [
      { accountCode: stockAccount(db, settings, actor.name), debit: cost, credit: 0, description: lineText },
      cashAccount !== null
        ? { accountCode: cashAccount, debit: 0, credit: cost, description: lineText }
        : { accountCode: supplier.account_code, debit: 0, credit: cost, description: lineText, partyId: supplier.id }
    ];
    const entry = createJournalEntry(db, { date: input.date, description, party: supplier.name, currency: 'IQD', rateX100: 100, lines }, actor.name, actor.id, preparerOf(actor));
    db.prepare(`INSERT INTO fuel_deliveries (id, number, date, tank_id, supplier_id, note_no, qty_milli, cost_per_litre, cost, payment, cash_account, status, entry_id, notes, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?)`)
      .run(id, number, input.date, tank.id, supplier.id, noteNo, input.qtyMilli, input.costPerLitre, cost, input.payment, cashAccount, entry.id, input.notes?.trim() || null, actor.name, now());
    addMove(db, { tankId: tank.id, date: input.date, kind: 'delivery', sourceId: id, milli: input.qtyMilli, value: cost });
    db.prepare('UPDATE fuel_tanks SET last_cost = ?, updated_at = ? WHERE id = ?').run(input.costPerLitre, now(), tank.id);
    audit(db, actor.name, 'create', 'fuel_delivery', id, {
      number, tank: tank.code, supplier: supplier.id, noteNo, qtyMilli: input.qtyMilli, cost, payment: input.payment, entry: entry.id, overCapacity: input.qtyMilli > room
    });
  });
  return getDelivery(db, id);
}

/**
 * An admin reverses a delivery entered by mistake (with a reason): its entry is reversed (or deleted while a draft) and
 * its litres leave the tank at what they cost. Refused when the tank no longer holds them (sold since).
 */
export function reverseDelivery(db: Db, id: string, input: { reason: string }, actor: Actor): DeliveryView {
  requirePlan(db);
  const reason = input.reason.trim();
  if (reason.length < 3) throw invalid([{ code: 'fuel_reason_required', field: 'reason' }]);
  transaction(db, () => {
    const d = getDelivery(db, id);
    if (d.status !== 'posted') throw conflict('action_not_allowed', { action: 'reverse', status: d.status });
    const date = reversalDate(d.date);
    assertDate(db, date);
    const stock = stockOf(db, d.tankId);
    const after = { milli: stock.milli - d.qtyMilli, value: stock.value - d.cost };
    if (after.milli < 0 || after.value < 0 || (after.milli === 0 && after.value !== 0)) throw conflict('fuel_delivery_used');
    const claimed = db.prepare(`UPDATE fuel_deliveries SET status = 'reversed', reversed_by = ?, reversed_at = ?, reverse_reason = ? WHERE id = ? AND status = 'posted'`)
      .run(actor.name, now(), reason, id);
    if (Number(claimed.changes) !== 1) throw conflict('action_not_allowed', { action: 'reverse' });
    const reversal = undoEntry(db, d.entry?.id ?? null, date, actor.name, () => db.prepare('UPDATE fuel_deliveries SET entry_id = NULL WHERE id = ?').run(id));
    if (reversal) db.prepare('UPDATE fuel_deliveries SET reversal_entry_id = ? WHERE id = ?').run(reversal, id);
    reverseMoves(db, id, date);
    audit(db, actor.name, 'reverse', 'fuel_delivery', id, { number: d.number, reason, entry: d.entry?.id ?? null, reversal });
  });
  return getDelivery(db, id);
}

// ——— dips ———

export interface DipView {
  id: string; number: string; date: string; tankId: string; dipMm: number | null; measuredMilli: number; bookMilli: number; varianceMilli: number;
  /** within the station's tolerance: normal evaporation */
  normal: boolean;
  /** what the difference is worth at the tank's average cost (left out for someone who may not see cost) */
  value: number;
  status: DocStatus; entry: EntryRef | null; reversal: EntryRef | null; notes: string;
  createdBy: string; createdAt: string; reversedBy: string | null; reversedAt: string | null; reverseReason: string | null;
  actions: 'reverse'[];
}

interface DipRow {
  id: string; number: string; date: string; tank_id: string; dip_mm: number | null; measured_milli: number; book_milli: number; variance_milli: number; value: number;
  status: DocStatus; entry_id: string | null; reversal_entry_id: string | null; notes: string | null; created_by: string; created_at: string;
  reversed_by: string | null; reversed_at: string | null; reverse_reason: string | null;
}

const dipView = (db: Db, r: DipRow, toleranceBp: number): DipView => ({
  id: r.id, number: r.number, date: r.date, tankId: r.tank_id, dipMm: r.dip_mm === null ? null : Number(r.dip_mm), measuredMilli: Number(r.measured_milli),
  bookMilli: Number(r.book_milli), varianceMilli: Number(r.variance_milli), normal: withinTolerance(Number(r.variance_milli), Number(r.book_milli), toleranceBp),
  value: Number(r.value), status: r.status, entry: entryRef(db, r.entry_id), reversal: entryRef(db, r.reversal_entry_id), notes: r.notes ?? '',
  createdBy: r.created_by, createdAt: r.created_at, reversedBy: r.reversed_by, reversedAt: r.reversed_at, reverseReason: r.reverse_reason,
  actions: r.status === 'posted' ? ['reverse'] : []
});

export function getDip(db: Db, id: string): DipView {
  const r = db.prepare('SELECT * FROM fuel_dips WHERE id = ?').get(id) as unknown as DipRow | undefined;
  if (!r) throw notFound('fuel_dip');
  return dipView(db, r, fuelSettings(db).dipToleranceBp);
}

export function listDips(db: Db, f: { from?: string | undefined; to?: string | undefined; tankId?: string | undefined } = {}): DipView[] {
  const where: string[] = [];
  const params: string[] = [];
  if (f.from) { where.push('date >= ?'); params.push(f.from); }
  if (f.to) { where.push('date <= ?'); params.push(f.to); }
  if (f.tankId) { where.push('tank_id = ?'); params.push(f.tankId); }
  const tolerance = fuelSettings(db).dipToleranceBp;
  return (db.prepare(`SELECT * FROM fuel_dips${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, number DESC LIMIT 500`).all(...params) as unknown as DipRow[])
    .map((r) => dipView(db, r, tolerance));
}

export interface DipInput { date: string; tankId: string; dipMm?: number | undefined; measuredMilli?: number | undefined; notes?: string | undefined; lang: Lang }

/**
 * A dip of a tank: the stick in centimetres (read by the tank's chart) or the litres themselves. Set against the book,
 * a difference is posted as a stock adjustment at the tank's average cost (a loss to fuel loss and evaporation, a gain
 * back from it). Not while an open shift draws from the tank: its litres sold so far are not in the book yet.
 */
export function createDip(db: Db, input: DipInput, actor: Actor): DipView {
  requirePlan(db);
  assertDate(db, input.date);
  if ((input.dipMm === undefined) === (input.measuredMilli === undefined)) throw invalid([{ code: 'fuel_dip_one_way', field: 'dipMm' }]);
  const settings = fuelSettings(db);
  const id = randomUUID();
  transaction(db, () => {
    const tank = db.prepare('SELECT * FROM fuel_tanks WHERE id = ?').get(input.tankId) as unknown as TankRow | undefined;
    if (!tank || Number(tank.active) !== 1) throw invalid([{ code: 'fuel_tank_invalid', field: 'tankId' }]);
    if (db.prepare(`SELECT 1 FROM fuel_readings r JOIN fuel_shifts s ON s.id = r.shift_id WHERE r.tank_id = ? AND s.status = 'open'`).get(tank.id)) throw conflict('fuel_tank_in_open_shift');
    let measured = input.measuredMilli ?? null;
    if (input.dipMm !== undefined) {
      const chart = parseChart(tank.chart);
      if (!chart) throw invalid([{ code: 'fuel_tank_no_chart', field: 'dipMm' }]);
      measured = dipLitres(chart, input.dipMm);
      if (measured === null) throw invalid([{ code: 'fuel_dip_outside_chart', field: 'dipMm' }]);
    }
    if (measured! > Number(tank.capacity_milli)) throw invalid([{ code: 'fuel_dip_over_capacity', field: 'measuredMilli' }]);
    const stock = stockOf(db, tank.id);
    const variance = dipVariance(measured!, stock.milli);
    const last = Number(tank.last_cost);
    // a loss leaves at the average cost; a gain comes in at it (the last delivery's price when the book holds nothing)
    const value = variance < 0 ? -tankCostOut(stock, -variance, last)
      : variance > 0 ? (stock.milli > 0 && stock.value > 0 ? mulDiv(variance, stock.value, stock.milli) : fuelAmount(variance, last)) : 0;
    const number = `DP-${String(nextSequence(db, 'fuel_dip')).padStart(4, '0')}`;
    let entryId: string | null = null;
    if (value !== 0) {
      const t = TEXT[input.lang];
      const stockCode = stockAccount(db, settings, actor.name);
      const description = (variance < 0 ? t.dipLoss : t.dipGain)(number, `${tank.code} · ${tank.name}`, meterText(Math.abs(variance)));
      const amount = Math.abs(value);
      const lines: Line[] = variance < 0
        ? [{ accountCode: settings.lossAccount, debit: amount, credit: 0, description }, { accountCode: stockCode, debit: 0, credit: amount, description }]
        : [{ accountCode: stockCode, debit: amount, credit: 0, description }, { accountCode: settings.lossAccount, debit: 0, credit: amount, description }];
      entryId = createJournalEntry(db, { date: input.date, description, currency: 'IQD', rateX100: 100, lines }, actor.name, actor.id, preparerOf(actor)).id;
    }
    db.prepare(`INSERT INTO fuel_dips (id, number, date, tank_id, dip_mm, measured_milli, book_milli, variance_milli, value, status, entry_id, notes, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?)`)
      .run(id, number, input.date, tank.id, input.dipMm ?? null, measured!, stock.milli, variance, value, entryId, input.notes?.trim() || null, actor.name, now());
    if (variance !== 0) addMove(db, { tankId: tank.id, date: input.date, kind: 'dip', sourceId: id, milli: variance, value });
    audit(db, actor.name, 'create', 'fuel_dip', id, { number, tank: tank.code, measuredMilli: measured, bookMilli: stock.milli, varianceMilli: variance, value, entry: entryId });
  });
  return getDip(db, id);
}

/** An admin reverses a dip (with a reason): its adjustment entry is reversed (or deleted while a draft) and the litres go back. */
export function reverseDip(db: Db, id: string, input: { reason: string }, actor: Actor): DipView {
  requirePlan(db);
  const reason = input.reason.trim();
  if (reason.length < 3) throw invalid([{ code: 'fuel_reason_required', field: 'reason' }]);
  transaction(db, () => {
    const d = getDip(db, id);
    if (d.status !== 'posted') throw conflict('action_not_allowed', { action: 'reverse', status: d.status });
    const date = reversalDate(d.date);
    assertDate(db, date);
    const claimed = db.prepare(`UPDATE fuel_dips SET status = 'reversed', reversed_by = ?, reversed_at = ?, reverse_reason = ? WHERE id = ? AND status = 'posted'`)
      .run(actor.name, now(), reason, id);
    if (Number(claimed.changes) !== 1) throw conflict('action_not_allowed', { action: 'reverse' });
    const reversal = undoEntry(db, d.entry?.id ?? null, date, actor.name, () => db.prepare('UPDATE fuel_dips SET entry_id = NULL WHERE id = ?').run(id));
    if (reversal) db.prepare('UPDATE fuel_dips SET reversal_entry_id = ? WHERE id = ?').run(reversal, id);
    reverseMoves(db, id, date);
    audit(db, actor.name, 'reverse', 'fuel_dip', id, { number: d.number, reason, entry: d.entry?.id ?? null, reversal });
  });
  return getDip(db, id);
}

// ——— reports ———

export interface FuelReport {
  from: string; to: string;
  /** per fuel: litres sold in closed shifts, their sales, cost and gross profit (cost and profit left out without cost) */
  fuels: { fuelTypeId: string; milli: number; sales: number; cost: number; profit: number }[];
  /** per tank: the stock at the start, what came in, was sold, was adjusted by dips, and at the end (litres; value without cost) */
  tanks: { tankId: string; openingMilli: number; deliveredMilli: number; soldMilli: number; adjustedMilli: number; closingMilli: number; value: number }[];
}

/** Litres sold, sales, cost and gross profit per fuel, and each tank's stock movement, between two days (both counted). */
export function fuelReport(db: Db, from: string, to: string): FuelReport {
  const readings = db.prepare(`SELECT r.fuel_type_id, r.price, r.opening_milli, r.closing_milli, r.meter_max_milli, r.rollover, r.cost
                               FROM fuel_readings r JOIN fuel_shifts s ON s.id = r.shift_id
                               WHERE s.status = 'closed' AND s.date >= ? AND s.date <= ?`).all(from, to) as
    { fuel_type_id: string; price: number; opening_milli: number; closing_milli: number | null; meter_max_milli: number; rollover: number; cost: number | null }[];
  const fuels = new Map<string, { fuelTypeId: string; milli: number; sales: number; cost: number; profit: number }>();
  for (const r of readings) {
    const milli = soldMilli({ openingMilli: Number(r.opening_milli), closingMilli: r.closing_milli === null ? null : Number(r.closing_milli), rollover: Number(r.rollover) === 1, meterMaxMilli: Number(r.meter_max_milli) });
    const f = fuels.get(r.fuel_type_id) ?? { fuelTypeId: r.fuel_type_id, milli: 0, sales: 0, cost: 0, profit: 0 };
    f.milli += milli;
    f.sales += fuelAmount(milli, Number(r.price));
    f.cost += Number(r.cost ?? 0);
    f.profit = f.sales - f.cost;
    fuels.set(r.fuel_type_id, f);
  }
  const order = listFuelTypes(db).map((t) => t.id);
  const sumOf = db.prepare(`SELECT
      SUM(CASE WHEN date < ? OR (kind = 'opening' AND date <= ?) THEN qty_milli ELSE 0 END) AS opening_qty,
      SUM(CASE WHEN kind = 'delivery' AND date >= ? AND date <= ? THEN qty_milli ELSE 0 END) AS delivered_qty,
      SUM(CASE WHEN kind = 'sale' AND date >= ? AND date <= ? THEN qty_milli ELSE 0 END) AS sold_qty,
      SUM(CASE WHEN kind = 'dip' AND date >= ? AND date <= ? THEN qty_milli ELSE 0 END) AS adjusted_qty,
      SUM(CASE WHEN date <= ? THEN value ELSE 0 END) AS closing_value
    FROM fuel_moves WHERE tank_id = ?`);
  const tanks = (db.prepare('SELECT id FROM fuel_tanks ORDER BY code').all() as { id: string }[]).map((t) => {
    const s = sumOf.get(from, to, from, to, from, to, from, to, to, t.id) as { opening_qty: number | null; delivered_qty: number | null; sold_qty: number | null; adjusted_qty: number | null; closing_value: number | null };
    const openingMilli = Number(s.opening_qty ?? 0);
    const deliveredMilli = Number(s.delivered_qty ?? 0);
    const sold = -Number(s.sold_qty ?? 0);
    const adjustedMilli = Number(s.adjusted_qty ?? 0);
    return { tankId: t.id, openingMilli, deliveredMilli, soldMilli: sold, adjustedMilli, closingMilli: openingMilli + deliveredMilli - sold + adjustedMilli, value: Number(s.closing_value ?? 0) };
  });
  return { from, to, fuels: [...fuels.values()].sort((a, b) => order.indexOf(a.fuelTypeId) - order.indexOf(b.fuelTypeId)), tanks };
}

// ——— the API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => isIsoDate(s));
const id = z.string().min(1).max(64);
const idParam = z.object({ id }).strict();
const money = z.number().int().nonnegative().max(1_000_000_000_000);
const meter = z.number().int().nonnegative().max(METER_MAX_MILLI);
const litres = z.number().int().positive().max(MAX_LITRES_MILLI);
const pricePerLitre = z.number().int().positive().max(1_000_000);
const account = z.string().regex(/^\d{1,12}$/);
const lang = z.enum(['ar', 'en', 'ku']).default('ar');
const names = z.object({ ar: z.string().max(100), en: z.string().max(100), ku: z.string().max(100) }).strict();
const code = z.string().max(20);
const reason = z.object({ reason: z.string().max(300) }).strict();
const chart = z.array(z.object({ mm: z.number().int().min(0).max(DIP_MAX_MM), milli: z.number().int().min(0).max(MAX_LITRES_MILLI) }).strict()).max(CHART_MAX_ROWS);
const period = z.object({ from: isoDate.optional(), to: isoDate.optional(), tankId: id.optional() }).strict();
const nozzleBody = z.object({ number: z.number().int().min(1).max(20), tankId: id, meterMilli: meter, meterMaxMilli: meter.min(1).optional() }).strict();

const sheet = {
  readings: z.array(z.object({ nozzleId: id, closingMilli: meter.nullable(), rollover: z.boolean().optional() }).strict()).max(200),
  credit: money.optional(),
  notes: z.string().max(500).optional()
};

const POS = 'pos' as const;
const PURCHASES = 'purchases' as const;
const STOCK = 'stock' as const;
const ADMIN = 'admin' as const;

/**
 * Reading the setup and the shifts is open to every signed-in user (cost and profit are left out for someone who may not
 * see cost: cost-view.ts); a cashier reads only the shifts they opened, and the attendants' totals, the deliveries, the
 * dips and the report are the books' (cost-view.ts BOOKS_ONLY). A cashier works only the sheet of a shift they opened.
 * The shift sheet (open, save, close, delete an open shift) is the Point of sale permission, as the till is; a tanker delivery is purchasing; a dip is stock (as a stock count is);
 * fuels, prices, tanks, pumps, nozzles, the accounts and every reversal need an admin.
 */
export const fuelApi: ApiExtension = {
  rules: {
    'POST /api/fuel/shifts': POS,
    'PUT /api/fuel/shifts/:id': POS,
    'POST /api/fuel/shifts/:id/close': POS,
    'DELETE /api/fuel/shifts/:id': POS,
    'POST /api/fuel/shifts/:id/reverse': ADMIN,
    'POST /api/fuel/deliveries': PURCHASES,
    'POST /api/fuel/deliveries/:id/reverse': ADMIN,
    'POST /api/fuel/dips': STOCK,
    'POST /api/fuel/dips/:id/reverse': ADMIN,
    'PUT /api/fuel/settings': ADMIN,
    'POST /api/fuel/types': ADMIN,
    'PUT /api/fuel/types/:id': ADMIN,
    'POST /api/fuel/tanks': ADMIN,
    'PUT /api/fuel/tanks/:id': ADMIN,
    'POST /api/fuel/pumps': ADMIN,
    'PUT /api/fuel/pumps/:id': ADMIN,
    'POST /api/fuel/pumps/:id/nozzles': ADMIN,
    'PUT /api/fuel/nozzles/:id': ADMIN
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    return [
      { method: 'GET', path: '/api/fuel/setup', handler: async () => fuelSetup(db) },
      {
        method: 'PUT', path: '/api/fuel/settings',
        handler: async (req) => updateFuelSettings(db, parse(z.object({
          cashAccount: account, shortAccount: account, overAccount: account, creditAccount: account, stockAccount: account, costAccount: account,
          lossAccount: account, openingAccount: account, dipToleranceBp: z.number().int().min(0).max(1000)
        }).partial().strict(), req.body), actor(req))
      },
      {
        method: 'POST', path: '/api/fuel/types',
        handler: async (req, reply) => {
          const body = parse(z.object({ code, name: names, price: pricePerLitre, revenueAccount: account.optional(), sort: z.number().int().min(0).max(1000).optional() }).strict(), req.body);
          reply.status(201).send(saveFuelType(db, null, body, actor(req)));
          return undefined;
        }
      },
      {
        method: 'PUT', path: '/api/fuel/types/:id',
        handler: async (req) => saveFuelType(db, parse(idParam, req.params).id,
          parse(z.object({ code, name: names, price: pricePerLitre, revenueAccount: account.optional(), active: z.boolean().optional(), sort: z.number().int().min(0).max(1000).optional() }).strict(), req.body), actor(req))
      },
      {
        method: 'POST', path: '/api/fuel/tanks',
        handler: async (req, reply) => {
          const body = parse(z.object({
            code, name: z.string().max(100), fuelTypeId: id, capacityMilli: litres, chart: chart.nullable().optional(),
            openingMilli: z.number().int().min(0).max(MAX_LITRES_MILLI).optional(), openingCost: pricePerLitre.optional(), openingDate: isoDate.optional(), lang: lang.optional()
          }).strict(), req.body);
          reply.status(201).send(saveTank(db, null, body, actor(req)));
          return undefined;
        }
      },
      {
        method: 'PUT', path: '/api/fuel/tanks/:id',
        handler: async (req) => saveTank(db, parse(idParam, req.params).id, parse(z.object({
          code, name: z.string().max(100), fuelTypeId: id, capacityMilli: litres, chart: chart.nullable().optional(), active: z.boolean().optional()
        }).strict(), req.body), actor(req))
      },
      {
        method: 'POST', path: '/api/fuel/pumps',
        handler: async (req, reply) => {
          const body = parse(z.object({ number: z.number().int().min(1).max(999), nozzles: z.array(nozzleBody).min(1).max(20) }).strict(), req.body);
          reply.status(201).send(createPump(db, body, actor(req)));
          return undefined;
        }
      },
      {
        method: 'PUT', path: '/api/fuel/pumps/:id',
        handler: async (req) => updatePump(db, parse(idParam, req.params).id, parse(z.object({ number: z.number().int().min(1).max(999), active: z.boolean() }).strict(), req.body), actor(req))
      },
      {
        method: 'POST', path: '/api/fuel/pumps/:id/nozzles',
        handler: async (req, reply) => {
          const pumpId = parse(idParam, req.params).id;
          const body = parse(nozzleBody, req.body);
          reply.status(201).send(addNozzle(db, pumpId, body, actor(req)));
          return undefined;
        }
      },
      {
        method: 'PUT', path: '/api/fuel/nozzles/:id',
        handler: async (req) => updateNozzle(db, parse(idParam, req.params).id,
          parse(z.object({ tankId: id, meterMilli: meter.optional(), meterMaxMilli: meter.min(1).optional(), active: z.boolean().optional() }).strict(), req.body), actor(req))
      },
      {
        method: 'GET', path: '/api/fuel/shifts',
        handler: async (req) => listShifts(db, parse(z.object({
          from: isoDate.optional(), to: isoDate.optional(), attendant: z.string().max(100).optional(), status: z.enum(['open', 'closed', 'reversed']).optional()
        }).strict(), req.query ?? {}), actor(req))
      },
      {
        method: 'GET', path: '/api/fuel/attendants',
        handler: async (req) => {
          const q = parse(z.object({ from: isoDate, to: isoDate }).strict(), req.query ?? {});
          return attendantTotals(db, q.from, q.to);
        }
      },
      { method: 'GET', path: '/api/fuel/shifts/:id', handler: async (req) => readShift(db, parse(idParam, req.params).id, actor(req)) },
      {
        method: 'POST', path: '/api/fuel/shifts',
        handler: async (req, reply) => {
          const body = parse(z.object({ date: isoDate, shift: z.enum(FUEL_SHIFTS), attendant: z.string().max(100), pumpIds: z.array(id).min(1).max(100) }).strict(), req.body);
          reply.status(201).send(openShift(db, body, actor(req)));
          return undefined;
        }
      },
      {
        method: 'PUT', path: '/api/fuel/shifts/:id',
        handler: async (req) => saveSheet(db, parse(idParam, req.params).id, parse(z.object({ ...sheet, handed: money.nullable().optional() }).strict(), req.body), actor(req))
      },
      {
        method: 'POST', path: '/api/fuel/shifts/:id/close',
        handler: async (req) => closeShift(db, parse(idParam, req.params).id,
          parse(z.object({ ...sheet, handed: money, cashAccount: account.optional(), lang }).strict(), req.body), actor(req))
      },
      {
        method: 'POST', path: '/api/fuel/shifts/:id/reverse',
        handler: async (req) => reverseShift(db, parse(idParam, req.params).id, parse(reason, req.body), actor(req))
      },
      {
        method: 'DELETE', path: '/api/fuel/shifts/:id',
        handler: async (req, reply) => {
          cancelShift(db, parse(idParam, req.params).id, actor(req));
          reply.status(204).send();
          return undefined;
        }
      },
      { method: 'GET', path: '/api/fuel/deliveries', handler: async (req) => listDeliveries(db, parse(period, req.query ?? {})) },
      { method: 'GET', path: '/api/fuel/deliveries/:id', handler: async (req) => getDelivery(db, parse(idParam, req.params).id) },
      {
        method: 'POST', path: '/api/fuel/deliveries',
        handler: async (req, reply) => {
          const body = parse(z.object({
            date: isoDate, tankId: id, supplierId: id, noteNo: z.string().max(40).regex(/^[\p{L}\p{N}\p{M} ./-]*$/u), qtyMilli: litres, costPerLitre: pricePerLitre,
            payment: z.enum(['cash', 'credit']), cashAccount: account.optional(), notes: z.string().max(500).optional(), overCapacity: z.boolean().optional(), lang
          }).strict(), req.body);
          reply.status(201).send(createDelivery(db, body, actor(req)));
          return undefined;
        }
      },
      {
        method: 'POST', path: '/api/fuel/deliveries/:id/reverse',
        handler: async (req) => reverseDelivery(db, parse(idParam, req.params).id, parse(reason, req.body), actor(req))
      },
      { method: 'GET', path: '/api/fuel/dips', handler: async (req) => listDips(db, parse(period, req.query ?? {})) },
      {
        method: 'POST', path: '/api/fuel/dips',
        handler: async (req, reply) => {
          const body = parse(z.object({
            date: isoDate, tankId: id, dipMm: z.number().int().min(0).max(DIP_MAX_MM).optional(), measuredMilli: z.number().int().min(0).max(MAX_LITRES_MILLI).optional(),
            notes: z.string().max(500).optional(), lang
          }).strict(), req.body);
          reply.status(201).send(createDip(db, body, actor(req)));
          return undefined;
        }
      },
      {
        method: 'POST', path: '/api/fuel/dips/:id/reverse',
        handler: async (req) => reverseDip(db, parse(idParam, req.params).id, parse(reason, req.body), actor(req))
      },
      {
        method: 'GET', path: '/api/fuel/reports',
        handler: async (req) => {
          const q = parse(z.object({ from: isoDate, to: isoDate }).strict().refine((v) => v.from <= v.to), req.query ?? {});
          return fuelReport(db, q.from, q.to);
        }
      }
    ];
  }
};
