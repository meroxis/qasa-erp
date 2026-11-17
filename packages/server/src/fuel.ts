import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FUEL_SHIFTS, METER_MAX_MILLI, meterText, shiftCash, shiftTotals, type FuelShift, type Names, type NozzleReading, type ShiftCash, type ShiftTotals } from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { planStatus } from './license.ts';
import { readSetting, writeSetting } from './settings.ts';
import { createJournalEntry, getEntry } from './journal.ts';
import { preparerOf } from './quick-vouchers.ts';
import type { Actor } from './auth.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Petrol stations (prototype, Pro): the fuels with their price per litre, the pumps and their nozzles (each nozzle
 * one fuel, with its meter's last reading), and the shift sheet. A shift is opened for an attendant on some pumps, each
 * nozzle's opening reading taken from its last closing; at the change of shift the closing readings are written, the
 * litres (closing − opening) at the fuel's price make the sales, and the cash handed in is set against what was
 * expected. Closing the shift posts one journal entry (the app's approval rules apply, as to any entry):
 *
 *   Dr the safe ............................. the cash handed in
 *   Dr the credit / coupons account .......... what was sold on credit or for coupons (when any)
 *   Dr the shortage account .................. a shortage (the attendant owes it: Employee advances by default)
 *       Cr each fuel's revenue account ....... litres × price, one line per fuel
 *       Cr the cash-over account ............. cash over (Other revenue by default)
 *
 * Readings are millilitres, prices whole dinars per litre (core/fuel.ts). A meter is never wound back: a closing
 * reading below the opening one is refused, with the pump and nozzle named. Every query is parameterised.
 */

export type Lang = 'ar' | 'en' | 'ku';

export interface FuelSettings {
  /** the safe the cash is handed into */
  cashAccount: string;
  /** where a shortage goes (the attendant owes it) */
  shortAccount: string;
  /** where cash over goes */
  overAccount: string;
  /** what was sold on credit or for coupons */
  creditAccount: string;
}

export const DEFAULT_FUEL_SETTINGS: FuelSettings = { cashAccount: '1811', shortAccount: '1661', overAccount: '49', creditAccount: '1611' };

export interface FuelTypeView { id: string; code: string; name: Names; price: number; revenueAccount: string; active: boolean; sort: number }
export interface NozzleView { id: string; pumpId: string; number: number; fuelTypeId: string; meterMilli: number; active: boolean; openShift: string | null }
export interface PumpView { id: string; number: number; active: boolean; nozzles: NozzleView[] }
export interface FuelSetupView { available: boolean; types: FuelTypeView[]; pumps: PumpView[]; settings: FuelSettings }

export interface ReadingView extends NozzleReading { pumpNumber: number; nozzleNumber: number }

export type FuelShiftAction = 'save' | 'close' | 'cancel';

export interface ShiftSummary {
  id: string; number: string; date: string; shift: FuelShift; attendant: string; status: 'open' | 'closed';
  pumps: number[];
  sales: number | null; credit: number; handed: number | null; difference: number | null;
  entry: { id: string; number: string | null; status: string } | null;
  openedBy: string; openedAt: string; closedBy: string | null; closedAt: string | null;
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

export const fuelAvailable = (db: Db): boolean => planStatus(db).features.includes('petrolStation');
function requirePlan(db: Db): void {
  if (!fuelAvailable(db)) throw conflict('plan_limit', { limit: 'petrolStation' });
}

// ——— settings ———

export function fuelSettings(db: Db): FuelSettings {
  try {
    const stored = JSON.parse(readSetting(db, 'fuel_settings') ?? 'null') as Partial<FuelSettings> | null;
    return { ...DEFAULT_FUEL_SETTINGS, ...(stored ?? {}) };
  } catch {
    return DEFAULT_FUEL_SETTINGS;
  }
}

/** Which account each setting must be: a postable account under its group. */
const SETTING_GROUP: Record<keyof FuelSettings, RegExp> = { cashAccount: /^18/, shortAccount: /^(16|3)/, overAccount: /^4/, creditAccount: /^16/ };

function postableAccounts(db: Db): Set<string> {
  return new Set(loadAccounts(db).filter((a) => a.postable).map((a) => a.code));
}

export function updateFuelSettings(db: Db, input: Partial<FuelSettings>, actor: Actor): FuelSettings {
  requirePlan(db);
  const next = { ...fuelSettings(db), ...input };
  const postable = postableAccounts(db);
  const errors = (Object.keys(SETTING_GROUP) as (keyof FuelSettings)[])
    .filter((k) => !postable.has(next[k]) || !SETTING_GROUP[k].test(next[k]))
    .map((k) => ({ code: 'fuel_account_invalid', field: k, accountCode: next[k] }));
  if (errors.length) throw invalid(errors);
  transaction(db, () => {
    writeSetting(db, 'fuel_settings', JSON.stringify(next));
    audit(db, actor.name, 'update', 'fuel_settings', null, next);
  });
  return next;
}

// ——— fuels, pumps and nozzles ———

interface TypeRow { id: string; code: string; name_ar: string; name_en: string; name_ku: string; price: number; revenue_account: string; active: number; sort: number }
const typeView = (r: TypeRow): FuelTypeView => ({
  id: r.id, code: r.code, name: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, price: Number(r.price), revenueAccount: r.revenue_account, active: r.active === 1, sort: Number(r.sort)
});

export function listFuelTypes(db: Db): FuelTypeView[] {
  return (db.prepare('SELECT * FROM fuel_types ORDER BY sort, code').all() as unknown as TypeRow[]).map(typeView);
}

export function fuelSetup(db: Db): FuelSetupView {
  const open = new Map((db.prepare(`SELECT r.nozzle_id, s.number FROM fuel_readings r JOIN fuel_shifts s ON s.id = r.shift_id WHERE s.status = 'open'`).all() as
    { nozzle_id: string; number: string }[]).map((r) => [r.nozzle_id, r.number]));
  const nozzles = (db.prepare('SELECT * FROM fuel_nozzles ORDER BY number').all() as
    { id: string; pump_id: string; number: number; fuel_type_id: string; meter_milli: number; active: number }[]).map((n): NozzleView => ({
    id: n.id, pumpId: n.pump_id, number: Number(n.number), fuelTypeId: n.fuel_type_id, meterMilli: Number(n.meter_milli), active: n.active === 1, openShift: open.get(n.id) ?? null
  }));
  const pumps = (db.prepare('SELECT * FROM fuel_pumps ORDER BY number').all() as { id: string; number: number; active: number }[]).map((p): PumpView => ({
    id: p.id, number: Number(p.number), active: p.active === 1, nozzles: nozzles.filter((n) => n.pumpId === p.id)
  }));
  return { available: fuelAvailable(db), types: listFuelTypes(db), pumps, settings: fuelSettings(db) };
}

export interface FuelTypeInput { code: string; name: Names; price: number; revenueAccount?: string | undefined; active?: boolean | undefined; sort?: number | undefined }

function checkRevenue(db: Db, code: string): void {
  if (!code.startsWith('4') || !postableAccounts(db).has(code)) throw invalid([{ code: 'fuel_account_invalid', field: 'revenueAccount', accountCode: code }]);
}

export function saveFuelType(db: Db, id: string | null, input: FuelTypeInput, actor: Actor): FuelTypeView {
  requirePlan(db);
  const code = input.code.trim();
  const name = { ar: input.name.ar.trim(), en: input.name.en.trim(), ku: input.name.ku.trim() };
  if (!code || !name.ar || !name.en || !name.ku) throw invalid([{ code: 'fuel_name_required' }]);
  const revenue = input.revenueAccount ?? '42';
  checkRevenue(db, revenue);
  const clash = db.prepare('SELECT id FROM fuel_types WHERE code = ? AND id <> ?').get(code, id ?? '') as { id: string } | undefined;
  if (clash) throw conflict('fuel_code_taken');
  return transaction(db, () => {
    const at = now();
    if (id) {
      const before = db.prepare('SELECT * FROM fuel_types WHERE id = ?').get(id) as unknown as TypeRow | undefined;
      if (!before) throw notFound('fuel_type');
      db.prepare('UPDATE fuel_types SET code = ?, name_ar = ?, name_en = ?, name_ku = ?, price = ?, revenue_account = ?, active = ?, sort = ?, updated_at = ? WHERE id = ?')
        .run(code, name.ar, name.en, name.ku, input.price, revenue, input.active === false ? 0 : 1, input.sort ?? Number(before.sort), at, id);
      // a price change shows on the next shift; an open shift keeps the price it was opened at
      audit(db, actor.name, 'update', 'fuel_type', id, { code, price: input.price, was: Number(before.price) });
      return typeView(db.prepare('SELECT * FROM fuel_types WHERE id = ?').get(id) as unknown as TypeRow);
    }
    const newId = randomUUID();
    db.prepare('INSERT INTO fuel_types (id, code, name_ar, name_en, name_ku, price, revenue_account, active, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId, code, name.ar, name.en, name.ku, input.price, revenue, input.active === false ? 0 : 1, input.sort ?? 0, at, at);
    audit(db, actor.name, 'create', 'fuel_type', newId, { code, price: input.price });
    return typeView(db.prepare('SELECT * FROM fuel_types WHERE id = ?').get(newId) as unknown as TypeRow);
  });
}

export interface PumpInput { number: number; nozzles: { number: number; fuelTypeId: string; meterMilli: number }[] }

/** A new pump with its nozzles, each with its meter's reading today. */
export function createPump(db: Db, input: PumpInput, actor: Actor): PumpView {
  requirePlan(db);
  if (db.prepare('SELECT 1 FROM fuel_pumps WHERE number = ?').get(input.number)) throw conflict('fuel_pump_taken');
  const numbers = new Set(input.nozzles.map((n) => n.number));
  if (numbers.size !== input.nozzles.length) throw invalid([{ code: 'fuel_nozzle_twice' }]);
  const types = new Set(listFuelTypes(db).filter((t) => t.active).map((t) => t.id));
  const errors = input.nozzles.filter((n) => !types.has(n.fuelTypeId)).map((n) => ({ code: 'fuel_type_invalid', line: `${input.number}/${n.number}` }));
  if (errors.length) throw invalid(errors);
  const id = randomUUID();
  transaction(db, () => {
    const at = now();
    db.prepare('INSERT INTO fuel_pumps (id, number, active, created_at) VALUES (?, ?, 1, ?)').run(id, input.number, at);
    const add = db.prepare('INSERT INTO fuel_nozzles (id, pump_id, number, fuel_type_id, meter_milli, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)');
    for (const n of input.nozzles) add.run(randomUUID(), id, n.number, n.fuelTypeId, n.meterMilli, at);
    audit(db, actor.name, 'create', 'fuel_pump', id, { number: input.number, nozzles: input.nozzles.length });
  });
  return fuelSetup(db).pumps.find((p) => p.id === id)!;
}

/** A nozzle's fuel (and, while it is in no open shift, its meter after a repair or a new meter). */
export function updateNozzle(db: Db, id: string, input: { fuelTypeId: string; meterMilli?: number | undefined }, actor: Actor): NozzleView {
  requirePlan(db);
  const nozzle = fuelSetup(db).pumps.flatMap((p) => p.nozzles).find((n) => n.id === id);
  if (!nozzle) throw notFound('fuel_nozzle');
  if (nozzle.openShift) throw conflict('fuel_nozzle_in_shift', { shift: nozzle.openShift });
  if (!listFuelTypes(db).some((t) => t.id === input.fuelTypeId && t.active)) throw invalid([{ code: 'fuel_type_invalid' }]);
  transaction(db, () => {
    db.prepare('UPDATE fuel_nozzles SET fuel_type_id = ?, meter_milli = ? WHERE id = ?').run(input.fuelTypeId, input.meterMilli ?? nozzle.meterMilli, id);
    audit(db, actor.name, 'update', 'fuel_nozzle', id, { fuelTypeId: input.fuelTypeId, meterMilli: input.meterMilli ?? nozzle.meterMilli, was: nozzle.meterMilli });
  });
  return fuelSetup(db).pumps.flatMap((p) => p.nozzles).find((n) => n.id === id)!;
}

// ——— shifts ———

interface ShiftRow {
  id: string; number: string; date: string; shift: FuelShift; attendant: string; status: 'open' | 'closed'; credit: number; handed: number | null;
  sales: number | null; difference: number | null; cash_account: string | null; entry_id: string | null; notes: string | null;
  opened_by: string; opened_at: string; closed_by: string | null; closed_at: string | null;
}

function readingsOf(db: Db, shiftId: string): ReadingView[] {
  return (db.prepare(`SELECT r.nozzle_id, r.fuel_type_id, r.price, r.opening_milli, r.closing_milli, n.number AS nozzle_number, p.number AS pump_number
                      FROM fuel_readings r JOIN fuel_nozzles n ON n.id = r.nozzle_id JOIN fuel_pumps p ON p.id = n.pump_id
                      WHERE r.shift_id = ? ORDER BY p.number, n.number`).all(shiftId) as
    { nozzle_id: string; fuel_type_id: string; price: number; opening_milli: number; closing_milli: number | null; nozzle_number: number; pump_number: number }[])
    .map((r) => ({
      nozzleId: r.nozzle_id, fuelTypeId: r.fuel_type_id, price: Number(r.price), openingMilli: Number(r.opening_milli),
      closingMilli: r.closing_milli === null ? null : Number(r.closing_milli), pumpNumber: Number(r.pump_number), nozzleNumber: Number(r.nozzle_number)
    }));
}

function summaryOf(db: Db, r: ShiftRow): ShiftSummary {
  const entry = r.entry_id ? getEntry(db, r.entry_id) : null;
  const pumps = (db.prepare(`SELECT DISTINCT p.number FROM fuel_readings r JOIN fuel_nozzles n ON n.id = r.nozzle_id JOIN fuel_pumps p ON p.id = n.pump_id
                             WHERE r.shift_id = ? ORDER BY p.number`).all(r.id) as { number: number }[]).map((p) => Number(p.number));
  return {
    id: r.id, number: r.number, date: r.date, shift: r.shift, attendant: r.attendant, status: r.status, pumps,
    sales: r.sales === null ? null : Number(r.sales), credit: Number(r.credit), handed: r.handed === null ? null : Number(r.handed),
    difference: r.difference === null ? null : Number(r.difference),
    entry: entry ? { id: entry.id, number: entry.number, status: entry.status } : null,
    openedBy: r.opened_by, openedAt: r.opened_at, closedBy: r.closed_by, closedAt: r.closed_at
  };
}

function shiftRow(db: Db, id: string): ShiftRow {
  const r = db.prepare('SELECT * FROM fuel_shifts WHERE id = ?').get(id) as unknown as ShiftRow | undefined;
  if (!r) throw notFound('fuel_shift');
  return r;
}

export function getShift(db: Db, id: string): ShiftView {
  const r = shiftRow(db, id);
  const readings = readingsOf(db, id);
  const totals = shiftTotals(readings);
  const sales = r.status === 'closed' && r.sales !== null ? Number(r.sales) : totals.sales;
  return {
    ...summaryOf(db, r),
    readings, totals,
    cash: r.handed === null ? null : shiftCash(sales, Number(r.credit), Number(r.handed)),
    notes: r.notes ?? '',
    actions: r.status === 'open' ? ['save', 'close', 'cancel'] : []
  };
}

export function listShifts(db: Db, f: { from?: string | undefined; to?: string | undefined; attendant?: string | undefined; status?: 'open' | 'closed' | undefined } = {}): ShiftSummary[] {
  const where: string[] = [];
  const params: string[] = [];
  if (f.from) { where.push('date >= ?'); params.push(f.from); }
  if (f.to) { where.push('date <= ?'); params.push(f.to); }
  if (f.attendant) { where.push('attendant = ?'); params.push(f.attendant); }
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  const rows = db.prepare(`SELECT * FROM fuel_shifts${where.length ? ' WHERE ' + where.join(' AND ') : ''}
                           ORDER BY date DESC, CASE shift WHEN 'night' THEN 0 WHEN 'evening' THEN 1 ELSE 2 END, number DESC LIMIT 500`).all(...params) as unknown as ShiftRow[];
  return rows.map((r) => summaryOf(db, r));
}

export interface OpenShiftInput { date: string; shift: FuelShift; attendant: string; pumpIds: string[] }

/** Opens a shift on the pumps given: each nozzle's opening reading is its meter's last closing, at today's fuel prices. */
export function openShift(db: Db, input: OpenShiftInput, actor: Actor): ShiftView {
  requirePlan(db);
  const attendant = input.attendant.trim();
  if (!attendant) throw invalid([{ code: 'fuel_attendant_required', field: 'attendant' }]);
  const setup = fuelSetup(db);
  const pumps = [...new Set(input.pumpIds)].map((id) => setup.pumps.find((p) => p.id === id && p.active));
  if (!pumps.length || pumps.some((p) => !p)) throw invalid([{ code: 'fuel_pump_invalid', field: 'pumpIds' }]);
  const nozzles = pumps.flatMap((p) => p!.nozzles.filter((n) => n.active));
  if (!nozzles.length) throw invalid([{ code: 'fuel_pump_invalid', field: 'pumpIds' }]);
  // a nozzle is in one open shift at a time, so no litre is counted twice
  const busy = nozzles.find((n) => n.openShift);
  if (busy) throw conflict('fuel_nozzle_in_shift', { shift: busy.openShift });
  const price = new Map(setup.types.map((t) => [t.id, t.price]));
  const id = randomUUID();
  transaction(db, () => {
    const number = `SH-${String(nextSequence(db, 'fuel_shift')).padStart(4, '0')}`;
    db.prepare(`INSERT INTO fuel_shifts (id, number, date, shift, attendant, status, credit, opened_by, opened_at) VALUES (?, ?, ?, ?, ?, 'open', 0, ?, ?)`)
      .run(id, number, input.date, input.shift, attendant, actor.name, now());
    const add = db.prepare('INSERT INTO fuel_readings (shift_id, nozzle_id, fuel_type_id, price, opening_milli, closing_milli) VALUES (?, ?, ?, ?, ?, NULL)');
    for (const n of nozzles) add.run(id, n.id, n.fuelTypeId, price.get(n.fuelTypeId)!, n.meterMilli);
    audit(db, actor.name, 'open', 'fuel_shift', id, { number, attendant, shift: input.shift, nozzles: nozzles.length });
  });
  return getShift(db, id);
}

export interface SheetInput {
  readings: { nozzleId: string; openingMilli?: number | undefined; closingMilli: number | null }[];
  credit?: number | undefined;
  handed?: number | null | undefined;
  notes?: string | undefined;
}

const nozzleLabel = (r: ReadingView) => `${r.pumpNumber}/${r.nozzleNumber}`;

/** Writes the sheet's readings and cash into an open shift; every reading is checked, a wrong one named by its pump/nozzle. */
function writeSheet(db: Db, shift: ShiftView, input: SheetInput): ReadingView[] {
  const byId = new Map(shift.readings.map((r) => [r.nozzleId, r]));
  const errors: { code: string; field?: string; line?: string }[] = [];
  const next = new Map(shift.readings.map((r) => [r.nozzleId, { ...r }]));
  for (const given of input.readings) {
    const r = byId.get(given.nozzleId);
    if (!r) { errors.push({ code: 'fuel_nozzle_not_in_shift' }); continue; }
    const row = next.get(given.nozzleId)!;
    if (given.openingMilli !== undefined) row.openingMilli = given.openingMilli;
    row.closingMilli = given.closingMilli;
    if (row.closingMilli !== null && row.closingMilli < row.openingMilli) errors.push({ code: 'fuel_closing_below_opening', line: nozzleLabel(r) });
  }
  const credit = input.credit ?? shift.credit;
  const sales = shiftTotals([...next.values()]).sales;
  if (credit > sales) errors.push({ code: 'fuel_credit_over_sales', field: 'credit' });
  if (errors.length) throw invalid(errors);
  const update = db.prepare('UPDATE fuel_readings SET opening_milli = ?, closing_milli = ? WHERE shift_id = ? AND nozzle_id = ?');
  for (const r of next.values()) update.run(r.openingMilli, r.closingMilli, shift.id, r.nozzleId);
  db.prepare('UPDATE fuel_shifts SET credit = ?, handed = ?, notes = ? WHERE id = ?')
    .run(credit, input.handed === undefined ? shift.handed : input.handed, input.notes === undefined ? (shift.notes || null) : (input.notes.trim() || null), shift.id);
  return [...next.values()];
}

export function saveSheet(db: Db, id: string, input: SheetInput, actor: Actor): ShiftView {
  requirePlan(db);
  const shift = getShift(db, id);
  if (!shift.actions.includes('save')) throw conflict('action_not_allowed', { action: 'save' });
  transaction(db, () => {
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
  cash: string; credit: string; short: (who: string) => string; over: (who: string) => string;
}> = {
  ar: {
    entry: (n, s, who) => `مبيعات الوقود — الوردية ${SHIFT_WORD.ar[s]} ${n} — ${who}`, litres: (f, l, p) => `${f}: ${l} لتر × ${p}`,
    cash: 'النقد المسلَّم', credit: 'آجل وكوبونات', short: (who) => `عجز الوردية على ${who}`, over: (who) => `زيادة الوردية — ${who}`
  },
  en: {
    entry: (n, s, who) => `Fuel sales — ${SHIFT_WORD.en[s]} shift ${n} — ${who}`, litres: (f, l, p) => `${f}: ${l} L × ${p}`,
    cash: 'Cash handed in', credit: 'Credit and coupons', short: (who) => `Shift shortage owed by ${who}`, over: (who) => `Shift cash over — ${who}`
  },
  ku: {
    entry: (n, s, who) => `فرۆشتنی سووتەمەنی — شەفتی ${SHIFT_WORD.ku[s]} ${n} — ${who}`, litres: (f, l, p) => `${f}: ${l} لیتر × ${p}`,
    cash: 'نەقدی ڕادەستکراو', credit: 'قەرز و کوپۆن', short: (who) => `کەمیی شەفت لەسەر ${who}`, over: (who) => `زیادەی شەفت — ${who}`
  }
};

export interface CloseInput extends SheetInput { handed: number; cashAccount?: string | undefined; lang: Lang }

/** The lines of the shift's entry (see the top of this file). Balanced: handed + credit + shortage = sales + over. */
export function shiftEntryLines(shift: { attendant: string }, totals: ShiftTotals, cash: ShiftCash, types: FuelTypeView[], settings: FuelSettings, cashAccount: string, lang: Lang) {
  const t = TEXT[lang];
  const lines: { accountCode: string; debit: number; credit: number; description: string }[] = [];
  if (cash.handed > 0) lines.push({ accountCode: cashAccount, debit: cash.handed, credit: 0, description: t.cash });
  if (cash.credit > 0) lines.push({ accountCode: settings.creditAccount, debit: cash.credit, credit: 0, description: t.credit });
  if (cash.difference < 0) lines.push({ accountCode: settings.shortAccount, debit: -cash.difference, credit: 0, description: t.short(shift.attendant) });
  const typeOf = new Map(types.map((x) => [x.id, x]));
  for (const f of totals.byFuel) {
    if (f.amount <= 0) continue;
    const type = typeOf.get(f.fuelTypeId)!;
    lines.push({ accountCode: type.revenueAccount, debit: 0, credit: f.amount, description: t.litres(type.name[lang], meterText(f.milli), f.price) });
  }
  if (cash.difference > 0) lines.push({ accountCode: settings.overAccount, debit: 0, credit: cash.difference, description: t.over(shift.attendant) });
  return lines;
}

/**
 * Closes the shift: every nozzle needs its closing reading (not below its opening), the cash handed in is written, the
 * entry is made (createJournalEntry, so "Vouchers need approval" and the checker and approver apply as to any entry),
 * and each nozzle's meter moves on to its closing reading for the next shift. All in one transaction.
 */
export function closeShift(db: Db, id: string, input: CloseInput, actor: Actor): ShiftView {
  requirePlan(db);
  const shift = getShift(db, id);
  if (!shift.actions.includes('close')) throw conflict('action_not_allowed', { action: 'close' });
  const settings = fuelSettings(db);
  const cashAccount = input.cashAccount ?? settings.cashAccount;
  if (!cashAccount.startsWith('18') || !postableAccounts(db).has(cashAccount)) throw invalid([{ code: 'fuel_account_invalid', field: 'cashAccount', accountCode: cashAccount }]);
  const entryId = transaction(db, () => {
    const readings = writeSheet(db, shift, input);
    const missing = readings.filter((r) => r.closingMilli === null);
    if (missing.length) throw invalid(missing.map((r) => ({ code: 'fuel_closing_missing', line: nozzleLabel(r) })));
    const totals = shiftTotals(readings);
    const credit = input.credit ?? shift.credit;
    const cash = shiftCash(totals.sales, credit, input.handed);
    if (totals.sales <= 0 && input.handed <= 0) throw conflict('fuel_shift_empty');
    const lines = shiftEntryLines(shift, totals, cash, listFuelTypes(db), settings, cashAccount, input.lang);
    const entry = createJournalEntry(db, {
      date: shift.date, description: TEXT[input.lang].entry(shift.number, shift.shift, shift.attendant), currency: 'IQD', rateX100: 100, lines
    }, actor.name, actor.id, preparerOf(actor));
    const meter = db.prepare('UPDATE fuel_nozzles SET meter_milli = ? WHERE id = ?');
    for (const r of readings) meter.run(r.closingMilli!, r.nozzleId);
    db.prepare(`UPDATE fuel_shifts SET status = 'closed', sales = ?, difference = ?, cash_account = ?, entry_id = ?, closed_by = ?, closed_at = ? WHERE id = ?`)
      .run(totals.sales, cash.difference, cashAccount, entry.id, actor.name, now(), id);
    audit(db, actor.name, 'close', 'fuel_shift', id, { number: shift.number, sales: totals.sales, handed: cash.handed, difference: cash.difference, entry: entry.id });
    return entry.id;
  });
  void entryId;
  return getShift(db, id);
}

/** An open shift is taken away (opened by mistake); its nozzles keep their meters. */
export function cancelShift(db: Db, id: string, actor: Actor): void {
  const shift = getShift(db, id);
  if (!shift.actions.includes('cancel')) throw conflict('action_not_allowed', { action: 'cancel' });
  transaction(db, () => {
    db.prepare('DELETE FROM fuel_readings WHERE shift_id = ?').run(id);
    db.prepare('DELETE FROM fuel_shifts WHERE id = ?').run(id);
    audit(db, actor.name, 'cancel', 'fuel_shift', id, { number: shift.number });
  });
}

/** Each attendant's shifts in a period: litres' money, shortages and cash over (closed shifts only). */
export function attendantTotals(db: Db, from: string, to: string): { attendant: string; shifts: number; sales: number; short: number; over: number }[] {
  return (db.prepare(`SELECT attendant, COUNT(*) AS shifts, SUM(sales) AS sales,
                             SUM(CASE WHEN difference < 0 THEN -difference ELSE 0 END) AS short_amount,
                             SUM(CASE WHEN difference > 0 THEN difference ELSE 0 END) AS over_amount
                      FROM fuel_shifts WHERE status = 'closed' AND date >= ? AND date <= ? GROUP BY attendant ORDER BY attendant`).all(from, to) as
    { attendant: string; shifts: number; sales: number; short_amount: number; over_amount: number }[])
    .map((r) => ({ attendant: r.attendant, shifts: Number(r.shifts), sales: Number(r.sales ?? 0), short: Number(r.short_amount ?? 0), over: Number(r.over_amount ?? 0) }));
}

// ——— the API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')));
const id = z.string().min(1).max(64);
const idParam = z.object({ id }).strict();
const money = z.number().int().nonnegative().max(1_000_000_000_000);
const meter = z.number().int().nonnegative().max(METER_MAX_MILLI);
const account = z.string().regex(/^\d{1,12}$/);
const lang = z.enum(['ar', 'en', 'ku']).default('ar');
const names = z.object({ ar: z.string().max(100), en: z.string().max(100), ku: z.string().max(100) }).strict();

const sheet = {
  readings: z.array(z.object({ nozzleId: id, openingMilli: meter.optional(), closingMilli: meter.nullable() }).strict()).max(200),
  credit: money.optional(),
  notes: z.string().max(500).optional()
};

const SALES = 'sales' as const;
const ADMIN = 'admin' as const;

/**
 * Reading the setup and the shifts is open to every signed-in user. The shift sheet (open, save, close, cancel) is the
 * sales permission, as the till is; fuels, prices, pumps, nozzles and the accounts need an admin.
 */
export const fuelApi: ApiExtension = {
  rules: {
    'POST /api/fuel/shifts': SALES,
    'PUT /api/fuel/shifts/:id': SALES,
    'POST /api/fuel/shifts/:id/close': SALES,
    'DELETE /api/fuel/shifts/:id': SALES,
    'PUT /api/fuel/settings': ADMIN,
    'POST /api/fuel/types': ADMIN,
    'PUT /api/fuel/types/:id': ADMIN,
    'POST /api/fuel/pumps': ADMIN,
    'PUT /api/fuel/nozzles/:id': ADMIN
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    return [
      { method: 'GET', path: '/api/fuel/setup', handler: async () => fuelSetup(db) },
      {
        method: 'PUT', path: '/api/fuel/settings',
        handler: async (req) => updateFuelSettings(db, parse(z.object({ cashAccount: account, shortAccount: account, overAccount: account, creditAccount: account }).partial().strict(), req.body), actor(req))
      },
      {
        method: 'POST', path: '/api/fuel/types',
        handler: async (req, reply) => {
          const body = parse(z.object({ code: z.string().max(20), name: names, price: money.min(1), revenueAccount: account.optional(), sort: z.number().int().min(0).max(1000).optional() }).strict(), req.body);
          reply.status(201).send(saveFuelType(db, null, body, actor(req)));
          return undefined;
        }
      },
      {
        method: 'PUT', path: '/api/fuel/types/:id',
        handler: async (req) => saveFuelType(db, parse(idParam, req.params).id,
          parse(z.object({ code: z.string().max(20), name: names, price: money.min(1), revenueAccount: account.optional(), active: z.boolean().optional(), sort: z.number().int().min(0).max(1000).optional() }).strict(), req.body), actor(req))
      },
      {
        method: 'POST', path: '/api/fuel/pumps',
        handler: async (req, reply) => {
          const body = parse(z.object({ number: z.number().int().min(1).max(999), nozzles: z.array(z.object({ number: z.number().int().min(1).max(20), fuelTypeId: id, meterMilli: meter }).strict()).min(1).max(20) }).strict(), req.body);
          reply.status(201).send(createPump(db, body, actor(req)));
          return undefined;
        }
      },
      {
        method: 'PUT', path: '/api/fuel/nozzles/:id',
        handler: async (req) => updateNozzle(db, parse(idParam, req.params).id, parse(z.object({ fuelTypeId: id, meterMilli: meter.optional() }).strict(), req.body), actor(req))
      },
      {
        method: 'GET', path: '/api/fuel/shifts',
        handler: async (req) => {
          const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional(), attendant: z.string().max(100).optional(), status: z.enum(['open', 'closed']).optional() }).strict(), req.query ?? {});
          return listShifts(db, q);
        }
      },
      {
        method: 'GET', path: '/api/fuel/attendants',
        handler: async (req) => {
          const q = parse(z.object({ from: isoDate, to: isoDate }).strict(), req.query ?? {});
          return attendantTotals(db, q.from, q.to);
        }
      },
      { method: 'GET', path: '/api/fuel/shifts/:id', handler: async (req) => getShift(db, parse(idParam, req.params).id) },
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
        method: 'DELETE', path: '/api/fuel/shifts/:id',
        handler: async (req, reply) => {
          cancelShift(db, parse(idParam, req.params).id, actor(req));
          reply.status(204).send();
          return undefined;
        }
      }
    ];
  }
};
