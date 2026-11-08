import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { todayIso, type Names } from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { createJournalEntry, deleteEntry, getEntry, reverseEntryInternal } from './journal.ts';
import { deleteSetting, readSetting, writeSetting } from './settings.ts';
import type { Actor } from './auth.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Fixed assets (الموجودات الثابتة) and their depreciation (الاندثار), in dinars.
 *
 * The purchase itself is an ordinary purchase invoice or payment voucher to the asset account (11…); the register only
 * adds what depreciation needs: cost, salvage value, useful life, the accounts, and any depreciation taken before
 * Qasa ERP (opening accumulated depreciation). Nothing is posted when an asset is registered.
 *
 * Straight line, month by month. Depreciation starts in the month the asset was acquired when that was on or before
 * the 15th, otherwise in the next month (the half-month convention). Month n of the life (1 … life) gets
 * round(D × n / life) − round(D × (n − 1) / life), D = cost − salvage, so the months add up to D exactly; a month never
 * takes more than what is left (D − accumulated), so opening depreciation and earlier runs are never exceeded. Land
 * (111) is not depreciated.
 *
 * A month's run is one draft journal entry (it follows the preparer, checker and approver): Dr the depreciation
 * expense accounts, Cr the accumulated depreciation accounts, a line per account and asset category. One run per
 * month; a run whose entry is still a draft can be cancelled, which frees the month.
 *
 * Disposal (sale or scrapping) makes a draft entry too: Dr accumulated depreciation, Dr the account the proceeds went
 * to (if any), Cr the asset account at cost, and the difference to gain (49 other revenue) or loss (39 other
 * expenses) — the unified chart has no dedicated accounts for gains and losses on assets; both can be changed.
 */

export type Lang = 'ar' | 'en' | 'ku';
export type AssetCategory = 'land' | 'buildings' | 'machinery' | 'vehicles' | 'tools' | 'furniture' | 'computers';

/**
 * Default accounts and useful lives per category. The lives are common practice, NOT the official Iraqi rates: the
 * company's accountant should set the lives from the depreciation rates that apply to it; every value is editable.
 */
export const CATEGORIES: Record<AssetCategory, { account: string; lifeMonths: number }> = {
  land: { account: '111', lifeMonths: 1200 },
  buildings: { account: '112', lifeMonths: 300 },
  machinery: { account: '113', lifeMonths: 120 },
  vehicles: { account: '114', lifeMonths: 60 },
  tools: { account: '115', lifeMonths: 60 },
  furniture: { account: '116', lifeMonths: 120 },
  computers: { account: '116', lifeMonths: 48 }
};
export const DEFAULT_ACCUM_ACCOUNT = '231';
export const DEFAULT_EXPENSE_ACCOUNT = '37';
export const DEFAULT_GAIN_ACCOUNT = '49';
export const DEFAULT_LOSS_ACCOUNT = '39';

const NOT_DEPRECIATED = '111';

export interface AssetInput {
  name: string;
  category?: AssetCategory | undefined;
  assetAccount: string;
  accumAccount: string;
  expenseAccount: string;
  acquired: string;
  cost: number;
  salvage?: number | undefined;
  lifeMonths: number;
  openingAccum?: number | undefined;
  location?: string | undefined;
  notes?: string | undefined;
}

export type AssetAction = 'edit' | 'editAll' | 'delete' | 'dispose' | 'undispose';

export interface AccountRef { code: string; name: Names }

export interface DisposalView { date: string; proceeds: number; proceedsAccount: string | null; gain: number; entry: EntryRef }
export interface EntryRef { id: string; number: string | null; status: string }

export interface AssetView {
  id: string;
  code: string;
  name: string;
  category: AssetCategory | null;
  assetAccount: AccountRef;
  accumAccount: AccountRef;
  expenseAccount: AccountRef;
  acquired: string;
  cost: number;
  salvage: number;
  lifeMonths: number;
  openingAccum: number;
  /** opening + every month run so far */
  accumulated: number;
  bookValue: number;
  /** the usual monthly amount (D / life, rounded) */
  monthly: number;
  depreciated: boolean;
  /** first and last months of depreciation, YYYY-MM */
  startMonth: string;
  endMonth: string;
  location: string;
  status: 'active' | 'disposed';
  disposedOn: string | null;
  disposal: DisposalView | null;
  notes: string;
  actions: AssetAction[];
}

export interface ScheduleRow { period: string; amount: number; accumulated: number; bookValue: number; state: 'run' | 'planned' | 'opening' }

export interface AssetDetail extends AssetView { schedule: ScheduleRow[] }

export interface RunLineView { assetId: string; code: string; name: string; category: AssetCategory | null; amount: number }
export interface RunView {
  id: string;
  period: string;
  status: 'posted';
  entry: EntryRef | null;
  total: number;
  lines: RunLineView[];
  createdBy: string;
  createdAt: string;
  actions: ('cancel' | 'reverse')[];
}
export interface PreviewView { period: string; date: string; total: number; lines: RunLineView[]; alreadyRun: boolean }

export interface AssetsSummary {
  count: number;
  active: number;
  cost: number;
  accumulated: number;
  bookValue: number;
  lastRun: string | null;
  nextPeriod: string;
}

interface AssetRow {
  id: string; code: string; name: string; asset_account: string; accum_account: string; expense_account: string; acquired: string;
  cost: number; salvage: number; life_months: number; method: string; opening_accum: number; location: string | null;
  status: 'active' | 'disposed'; disposed_on: string | null; notes: string | null; created_at: string; updated_at: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const isDate = (s: unknown): s is string => typeof s === 'string' && ISO.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const isAmount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
const trimmed = (s: string | undefined) => s?.trim() || null;

// ——— months ———

const monthIndex = (period: string) => Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1;
const periodOf = (index: number) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
const lastDay = (period: string) => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** The first month depreciated: the acquisition month when acquired by the 15th, else the next. */
export function startMonthOf(acquired: string): string {
  const day = Number(acquired.slice(8, 10));
  return periodOf(monthIndex(acquired.slice(0, 7)) + (day <= 15 ? 0 : 1));
}

/** Month n (1-based) of the life: the scheduled amount, so that the months add up to the depreciable amount exactly. */
export function scheduled(depreciable: number, life: number, n: number): number {
  if (n < 1 || n > life || depreciable <= 0) return 0;
  return Math.round((depreciable * n) / life) - Math.round((depreciable * (n - 1)) / life);
}

/**
 * What month `period` takes for an asset with `accumulated` so far: the scheduled month, plus whatever months that were
 * not run for it left behind (an asset registered after a month was run, a month skipped), so that by the end of its life
 * it reaches the depreciable amount; never beyond that amount.
 */
export function monthAmount(a: { acquired: string; cost: number; salvage: number; lifeMonths: number; accumulated: number }, period: string): number {
  const n = monthIndex(period) - monthIndex(startMonthOf(a.acquired)) + 1;
  const depreciable = a.cost - a.salvage;
  if (n < 1 || depreciable <= 0) return 0;
  const target = Math.round((depreciable * Math.min(n, a.lifeMonths)) / a.lifeMonths);
  return Math.max(0, Math.min(depreciable - a.accumulated, Math.max(scheduled(depreciable, a.lifeMonths, n), target - a.accumulated)));
}

// ——— accounts ———

function accountMap(db: Db): Map<string, { code: string; name: Names; postable: boolean }> {
  return new Map(loadAccounts(db).map((a) => [a.code, a]));
}

const ref = (accounts: ReturnType<typeof accountMap>, code: string): AccountRef => ({ code, name: accounts.get(code)?.name ?? { ar: code, en: code, ku: code } });

function categoryOf(assetAccount: string): AssetCategory | null {
  for (const [cat, c] of Object.entries(CATEGORIES) as [AssetCategory, { account: string }][]) {
    if (cat === 'computers') continue;
    if (assetAccount.startsWith(c.account)) return cat;
  }
  return null;
}

function accountErrors(db: Db, input: { assetAccount: string; accumAccount: string; expenseAccount: string }): { code: string; field: string; accountCode: string }[] {
  const accounts = accountMap(db);
  const errors: { code: string; field: string; accountCode: string }[] = [];
  const check = (field: string, code: string, under: string) => {
    const a = accounts.get(code);
    if (!a || !code.startsWith(under)) errors.push({ code: 'fa_account_invalid', field, accountCode: code });
    else if (!a.postable) errors.push({ code: 'fa_account_not_postable', field, accountCode: code });
  };
  check('assetAccount', input.assetAccount, '11');
  check('accumAccount', input.accumAccount, '23');
  check('expenseAccount', input.expenseAccount, '3');
  return errors;
}

// ——— reading ———

function accumulatedRuns(db: Db, assetId?: string): Map<string, number> {
  const rows = db.prepare(`SELECT l.asset_id AS id, COALESCE(SUM(l.amount), 0) AS total FROM depreciation_lines l
                           JOIN depreciation_runs r ON r.id = l.run_id WHERE r.status <> 'cancelled' ${assetId ? 'AND l.asset_id = ?' : ''}
                           GROUP BY l.asset_id`).all(...(assetId ? [assetId] : [])) as { id: string; total: number }[];
  return new Map(rows.map((r) => [r.id, Number(r.total)]));
}

function hasRuns(db: Db, assetId: string): boolean {
  return !!db.prepare(`SELECT 1 FROM depreciation_lines l JOIN depreciation_runs r ON r.id = l.run_id WHERE l.asset_id = ? AND r.status <> 'cancelled' LIMIT 1`).get(assetId);
}

const DISPOSAL = (id: string) => `fa_disposal:${id}`;

function disposalOf(db: Db, id: string): { entryId: string; date: string; proceeds: number; proceedsAccount: string | null; gain: number } | null {
  const raw = readSetting(db, DISPOSAL(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { entryId: string; date: string; proceeds: number; proceedsAccount: string | null; gain: number };
  } catch {
    return null;
  }
}

function entryRef(db: Db, id: string): EntryRef | null {
  try {
    const e = getEntry(db, id);
    return { id: e.id, number: e.number, status: e.status };
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  }
}

function view(db: Db, r: AssetRow, accounts: ReturnType<typeof accountMap>, runs: Map<string, number>): AssetView {
  const accumulated = Number(r.opening_accum) + (runs.get(r.id) ?? 0);
  const depreciated = !r.asset_account.startsWith(NOT_DEPRECIATED);
  const start = startMonthOf(r.acquired);
  const depreciable = Number(r.cost) - Number(r.salvage);
  const disposal = disposalOf(db, r.id);
  const disposalEntry = disposal ? entryRef(db, disposal.entryId) : null;
  const used = hasRuns(db, r.id);
  const actions: AssetAction[] = [];
  if (r.status === 'active') {
    actions.push('edit', 'dispose');
    if (!used) actions.push('editAll', 'delete');
  } else if (disposalEntry && (disposalEntry.status === 'draft'
    || (disposalEntry.status === 'approved' && !!db.prepare('SELECT 1 FROM entries WHERE id = ? AND reversed_by_id IS NULL').get(disposalEntry.id)))) {
    // a draft disposal is deleted, an approved one reversed (checked: the checker returns it to draft first)
    actions.push('undispose');
  }
  return {
    id: r.id, code: r.code, name: r.name, category: categoryOf(r.asset_account),
    assetAccount: ref(accounts, r.asset_account), accumAccount: ref(accounts, r.accum_account), expenseAccount: ref(accounts, r.expense_account),
    acquired: r.acquired, cost: Number(r.cost), salvage: Number(r.salvage), lifeMonths: Number(r.life_months), openingAccum: Number(r.opening_accum),
    accumulated, bookValue: Number(r.cost) - accumulated, monthly: depreciated ? Math.round(depreciable / Number(r.life_months)) : 0, depreciated,
    startMonth: start, endMonth: periodOf(monthIndex(start) + Number(r.life_months) - 1),
    location: r.location ?? '', status: r.status, disposedOn: r.disposed_on,
    disposal: disposal && disposalEntry ? { date: disposal.date, proceeds: disposal.proceeds, proceedsAccount: disposal.proceedsAccount, gain: disposal.gain, entry: disposalEntry } : null,
    notes: r.notes ?? '', actions
  };
}

function row(db: Db, id: string): AssetRow {
  const r = db.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(id) as AssetRow | undefined;
  if (!r) throw notFound('asset');
  return r;
}

export function listAssets(db: Db, f: { status?: 'active' | 'disposed' | undefined; q?: string | undefined } = {}): AssetView[] {
  const accounts = accountMap(db);
  const runs = accumulatedRuns(db);
  const rows = db.prepare('SELECT * FROM fixed_assets ORDER BY code').all() as unknown as AssetRow[];
  const q = f.q?.trim().toLowerCase();
  return rows
    .filter((r) => (!f.status || r.status === f.status) && (!q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || (r.location ?? '').toLowerCase().includes(q)))
    .map((r) => view(db, r, accounts, runs));
}

export function getAsset(db: Db, id: string): AssetDetail {
  const r = row(db, id);
  const accounts = accountMap(db);
  const v = view(db, r, accounts, accumulatedRuns(db, id));
  return { ...v, schedule: scheduleOf(db, v) };
}

/** Month by month: the runs already made, then what the coming months will take (until fully depreciated). */
function scheduleOf(db: Db, a: AssetView): ScheduleRow[] {
  if (!a.depreciated) return [];
  const runRows = db.prepare(`SELECT r.period, l.amount FROM depreciation_lines l JOIN depreciation_runs r ON r.id = l.run_id
                              WHERE l.asset_id = ? AND r.status <> 'cancelled' ORDER BY r.period`).all(a.id) as { period: string; amount: number }[];
  const out: ScheduleRow[] = [];
  let accumulated = a.openingAccum;
  if (a.openingAccum > 0) out.push({ period: '', amount: a.openingAccum, accumulated, bookValue: a.cost - accumulated, state: 'opening' });
  const ran = new Set<string>();
  for (const r of runRows) {
    accumulated += Number(r.amount);
    ran.add(r.period);
    out.push({ period: r.period, amount: Number(r.amount), accumulated, bookValue: a.cost - accumulated, state: 'run' });
  }
  if (a.status !== 'active') return out;
  const depreciable = a.cost - a.salvage;
  const lastRun = runRows.length ? runRows[runRows.length - 1]!.period : null;
  // planned months: from the next month the company will run (after its last run, or this month) and after this asset's last run
  const globalLast = (db.prepare("SELECT MAX(period) AS p FROM depreciation_runs WHERE status <> 'cancelled'").get() as { p: string | null }).p;
  let index = Math.max(monthIndex(a.startMonth), globalLast ? monthIndex(globalLast) + 1 : monthIndex(todayIso().slice(0, 7)), lastRun ? monthIndex(lastRun) + 1 : 0);
  for (let i = 0; i < 600 && accumulated < depreciable; i++, index++) {
    const period = periodOf(index);
    if (ran.has(period)) continue;
    const amount = monthAmount({ acquired: a.acquired, cost: a.cost, salvage: a.salvage, lifeMonths: a.lifeMonths, accumulated }, period);
    if (amount <= 0 && monthIndex(period) > monthIndex(a.endMonth)) break;
    if (amount <= 0) continue;
    accumulated += amount;
    out.push({ period, amount, accumulated, bookValue: a.cost - accumulated, state: 'planned' });
  }
  return out;
}

export function summary(db: Db): AssetsSummary {
  const assets = listAssets(db);
  const lastRun = (db.prepare("SELECT MAX(period) AS p FROM depreciation_runs WHERE status <> 'cancelled'").get() as { p: string | null }).p;
  return {
    count: assets.length,
    active: assets.filter((a) => a.status === 'active').length,
    cost: assets.filter((a) => a.status === 'active').reduce((s, a) => s + a.cost, 0),
    accumulated: assets.filter((a) => a.status === 'active').reduce((s, a) => s + a.accumulated, 0),
    bookValue: assets.filter((a) => a.status === 'active').reduce((s, a) => s + a.bookValue, 0),
    lastRun,
    nextPeriod: lastRun ? periodOf(monthIndex(lastRun) + 1) : todayIso().slice(0, 7)
  };
}

export function defaults(db: Db): { categories: { id: AssetCategory; account: string; accountPostable: boolean; lifeMonths: number }[]; accumAccount: string; expenseAccount: string; gainAccount: string; lossAccount: string } {
  const accounts = accountMap(db);
  return {
    categories: (Object.entries(CATEGORIES) as [AssetCategory, { account: string; lifeMonths: number }][])
      .map(([id, c]) => ({ id, account: c.account, accountPostable: !!accounts.get(c.account)?.postable, lifeMonths: c.lifeMonths })),
    accumAccount: DEFAULT_ACCUM_ACCOUNT, expenseAccount: DEFAULT_EXPENSE_ACCOUNT, gainAccount: DEFAULT_GAIN_ACCOUNT, lossAccount: DEFAULT_LOSS_ACCOUNT
  };
}

// ——— register ———

function inputErrors(db: Db, input: AssetInput): { code: string; field?: string; accountCode?: string }[] {
  const errors: { code: string; field?: string; accountCode?: string }[] = [];
  if (!input.name?.trim()) errors.push({ code: 'fa_name_required', field: 'name' });
  if (!isDate(input.acquired)) errors.push({ code: 'date_invalid', field: 'acquired' });
  else if (input.acquired > todayIso()) errors.push({ code: 'fa_acquired_future', field: 'acquired' });
  if (!isAmount(input.cost) || input.cost <= 0) errors.push({ code: 'fa_cost_invalid', field: 'cost' });
  const salvage = input.salvage ?? 0;
  if (!isAmount(salvage) || salvage < 0 || (isAmount(input.cost) && salvage >= input.cost)) errors.push({ code: 'fa_salvage_invalid', field: 'salvage' });
  if (!Number.isInteger(input.lifeMonths) || input.lifeMonths < 1 || input.lifeMonths > 1200) errors.push({ code: 'fa_life_invalid', field: 'lifeMonths' });
  const opening = input.openingAccum ?? 0;
  if (!isAmount(opening) || opening < 0 || (isAmount(input.cost) && opening > input.cost - salvage)) errors.push({ code: 'fa_opening_invalid', field: 'openingAccum' });
  errors.push(...accountErrors(db, input));
  return errors;
}

export function createAsset(db: Db, input: AssetInput, actor: Actor): AssetDetail {
  const errors = inputErrors(db, input);
  if (errors.length) throw invalid(errors);
  const id = randomUUID();
  transaction(db, () => {
    const code = `FA-${String(nextSequence(db, 'fixed_asset')).padStart(4, '0')}`;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO fixed_assets (id, code, name, asset_account, accum_account, expense_account, acquired, cost, salvage, life_months, method,
                opening_accum, location, status, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'straight_line', ?, ?, 'active', ?, ?, ?, ?)`)
      .run(id, code, input.name.trim(), input.assetAccount, input.accumAccount, input.expenseAccount, input.acquired, input.cost, input.salvage ?? 0,
        input.lifeMonths, input.openingAccum ?? 0, trimmed(input.location), trimmed(input.notes), actor.name, now, now);
    audit(db, actor.name, 'create', 'fixed_asset', id, { code, cost: input.cost });
  });
  return getAsset(db, id);
}

/** Name, location and notes can always change; the figures and accounts only before the first month is run. */
export function updateAsset(db: Db, id: string, input: Partial<AssetInput>, actor: Actor): AssetDetail {
  const r = row(db, id);
  const current = getAsset(db, id);
  if (!current.actions.includes('edit')) throw conflict('action_not_allowed', { action: 'edit' });
  const figures = (['assetAccount', 'accumAccount', 'expenseAccount', 'acquired', 'cost', 'salvage', 'lifeMonths', 'openingAccum'] as const)
    .some((k) => input[k] !== undefined);
  if (figures && !current.actions.includes('editAll')) throw conflict('fa_has_depreciation');
  const merged: AssetInput = {
    name: input.name ?? r.name, assetAccount: input.assetAccount ?? r.asset_account, accumAccount: input.accumAccount ?? r.accum_account,
    expenseAccount: input.expenseAccount ?? r.expense_account, acquired: input.acquired ?? r.acquired, cost: input.cost ?? Number(r.cost),
    salvage: input.salvage ?? Number(r.salvage), lifeMonths: input.lifeMonths ?? Number(r.life_months), openingAccum: input.openingAccum ?? Number(r.opening_accum),
    location: input.location ?? r.location ?? undefined, notes: input.notes ?? r.notes ?? undefined
  };
  const errors = inputErrors(db, merged).filter((e) => !(e.code === 'fa_acquired_future' && merged.acquired === r.acquired));
  if (errors.length) throw invalid(errors);
  transaction(db, () => {
    db.prepare(`UPDATE fixed_assets SET name = ?, asset_account = ?, accum_account = ?, expense_account = ?, acquired = ?, cost = ?, salvage = ?,
                life_months = ?, opening_accum = ?, location = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(merged.name.trim(), merged.assetAccount, merged.accumAccount, merged.expenseAccount, merged.acquired, merged.cost, merged.salvage ?? 0,
        merged.lifeMonths, merged.openingAccum ?? 0, trimmed(merged.location), trimmed(merged.notes), new Date().toISOString(), id);
    audit(db, actor.name, 'update', 'fixed_asset', id, input);
  });
  return getAsset(db, id);
}

export function deleteAsset(db: Db, id: string, actor: Actor): void {
  const a = getAsset(db, id);
  if (!a.actions.includes('delete')) throw conflict('fa_has_depreciation');
  transaction(db, () => {
    db.prepare('DELETE FROM fixed_assets WHERE id = ?').run(id);
    audit(db, actor.name, 'delete', 'fixed_asset', id, { code: a.code });
  });
}

// ——— monthly depreciation ———

const RUN_TEXT: Record<Lang, (p: string) => string> = {
  ar: (p) => `اندثار شهر ${p}`,
  en: (p) => `Depreciation for ${p}`,
  ku: (p) => `داخورانی مانگی ${p}`
};
const CATEGORY_TEXT: Record<Lang, Record<AssetCategory, string>> = {
  ar: { land: 'الأراضي', buildings: 'المباني', machinery: 'الآلات والمعدات', vehicles: 'وسائل النقل', tools: 'العدد والقوالب', furniture: 'الأثاث وأجهزة المكاتب', computers: 'الحاسبات' },
  en: { land: 'Land', buildings: 'Buildings', machinery: 'Machinery & equipment', vehicles: 'Vehicles', tools: 'Tools & moulds', furniture: 'Furniture & office equipment', computers: 'Computers' },
  ku: { land: 'زەوی', buildings: 'بینا', machinery: 'ئامێر و کەرەستە', vehicles: 'ئامرازی گواستنەوە', tools: 'ئامراز و قاڵب', furniture: 'کەلوپەل و ئامێری نووسینگە', computers: 'کۆمپیوتەر' }
};

/** The date a month's entry carries: its last day, or today while the month is still running. */
const runDate = (period: string) => (lastDay(period) > todayIso() ? todayIso() : lastDay(period));

/** What a month would take from each asset in service then (active, started, not disposed before it). */
export function previewRun(db: Db, period: string): PreviewView {
  if (!PERIOD.test(period)) throw invalid([{ code: 'fa_period_invalid' }]);
  if (period > todayIso().slice(0, 7)) throw invalid([{ code: 'fa_period_future' }]);
  const runs = accumulatedRuns(db);
  const rows = db.prepare('SELECT * FROM fixed_assets ORDER BY code').all() as unknown as AssetRow[];
  const lines: RunLineView[] = [];
  for (const r of rows) {
    if (r.asset_account.startsWith(NOT_DEPRECIATED)) continue;
    // a disposed asset takes nothing more: its disposal already took its cost and depreciation off the books
    if (r.status === 'disposed') continue;
    const amount = monthAmount({ acquired: r.acquired, cost: Number(r.cost), salvage: Number(r.salvage), lifeMonths: Number(r.life_months),
      accumulated: Number(r.opening_accum) + (runs.get(r.id) ?? 0) }, period);
    if (amount > 0) lines.push({ assetId: r.id, code: r.code, name: r.name, category: categoryOf(r.asset_account), amount });
  }
  const alreadyRun = !!db.prepare("SELECT 1 FROM depreciation_runs WHERE period = ? AND status <> 'cancelled'").get(period);
  return { period, date: runDate(period), total: lines.reduce((s, l) => s + l.amount, 0), lines, alreadyRun };
}

function runRow(db: Db, id: string): { id: string; period: string; entry_id: string | null; status: string; created_by: string; created_at: string } {
  const r = db.prepare('SELECT * FROM depreciation_runs WHERE id = ?').get(id) as { id: string; period: string; entry_id: string | null; status: string; created_by: string; created_at: string } | undefined;
  if (!r || r.status === 'cancelled') throw notFound('depreciation_run');
  return r;
}

export function getRun(db: Db, id: string): RunView {
  const r = runRow(db, id);
  const lines = db.prepare(`SELECT l.asset_id, l.amount, a.code, a.name, a.asset_account FROM depreciation_lines l JOIN fixed_assets a ON a.id = l.asset_id
                            WHERE l.run_id = ? ORDER BY a.code`).all(id) as { asset_id: string; amount: number; code: string; name: string; asset_account: string }[];
  const entry = r.entry_id ? entryRef(db, r.entry_id) : null;
  // a month that took depreciation from an asset since disposed stays: the disposal was worked out with it
  const disposed = !!db.prepare(`SELECT 1 FROM depreciation_lines l JOIN fixed_assets a ON a.id = l.asset_id WHERE l.run_id = ? AND a.status = 'disposed' LIMIT 1`).get(id);
  const approvedEntry = !!r.entry_id && !!db.prepare("SELECT 1 FROM entries WHERE id = ? AND status = 'approved' AND reversed_by_id IS NULL").get(r.entry_id);
  const actions: RunView['actions'] = disposed ? [] : !entry || entry.status === 'draft' ? ['cancel'] : approvedEntry ? ['reverse'] : [];
  return {
    id: r.id, period: r.period, status: 'posted', entry,
    total: lines.reduce((s, l) => s + Number(l.amount), 0),
    lines: lines.map((l) => ({ assetId: l.asset_id, code: l.code, name: l.name, category: categoryOf(l.asset_account), amount: Number(l.amount) })),
    createdBy: r.created_by, createdAt: r.created_at,
    actions
  };
}

export function listRuns(db: Db): RunView[] {
  const ids = db.prepare("SELECT id FROM depreciation_runs WHERE status <> 'cancelled' ORDER BY period DESC").all() as { id: string }[];
  return ids.map((r) => getRun(db, r.id));
}

/** Runs a month: one draft journal entry, Dr expense / Cr accumulated depreciation, per account and asset category. */
export function runDepreciation(db: Db, period: string, lang: Lang, actor: Actor): RunView {
  const preview = previewRun(db, period);
  if (preview.alreadyRun) throw conflict('fa_period_done', { period });
  if (preview.total <= 0) throw conflict('fa_nothing_to_run', { period });
  const assets = new Map((db.prepare('SELECT id, accum_account, expense_account, asset_account FROM fixed_assets').all() as
    { id: string; accum_account: string; expense_account: string; asset_account: string }[]).map((a) => [a.id, a]));
  const debit = new Map<string, number>();
  const credit = new Map<string, number>();
  for (const l of preview.lines) {
    const a = assets.get(l.assetId)!;
    const cat = categoryOf(a.asset_account);
    const dk = `${a.expense_account}|${cat ?? ''}`;
    const ck = `${a.accum_account}|${cat ?? ''}`;
    debit.set(dk, (debit.get(dk) ?? 0) + l.amount);
    credit.set(ck, (credit.get(ck) ?? 0) + l.amount);
  }
  const desc = (cat: string) => `${RUN_TEXT[lang](period)}${cat ? ' · ' + CATEGORY_TEXT[lang][cat as AssetCategory] : ''}`;
  const lines = [
    ...[...debit].map(([k, amount]) => ({ accountCode: k.split('|')[0]!, debit: amount, credit: 0, description: desc(k.split('|')[1]!) })),
    ...[...credit].map(([k, amount]) => ({ accountCode: k.split('|')[0]!, debit: 0, credit: amount, description: desc(k.split('|')[1]!) }))
  ];
  const id = randomUUID();
  transaction(db, () => {
    const entry = createJournalEntry(db, { date: preview.date, description: RUN_TEXT[lang](period), currency: 'IQD', rateX100: 100, lines }, actor.name, actor.id);
    db.prepare("INSERT INTO depreciation_runs (id, period, entry_id, status, created_by, created_at) VALUES (?, ?, ?, 'posted', ?, ?)")
      .run(id, period, entry.id, actor.name, new Date().toISOString());
    const insert = db.prepare('INSERT INTO depreciation_lines (run_id, asset_id, amount) VALUES (?, ?, ?)');
    for (const l of preview.lines) insert.run(id, l.assetId, l.amount);
    audit(db, actor.name, 'run', 'depreciation', id, { period, total: preview.total, entry: entry.id });
  });
  return getRun(db, id);
}

/** A month that took from an asset disposed since can't be taken back: the disposal was worked out with it. */
function assertNoDisposedAsset(run: RunView, db: Db): void {
  if (db.prepare(`SELECT 1 FROM depreciation_lines l JOIN fixed_assets a ON a.id = l.asset_id WHERE l.run_id = ? AND a.status = 'disposed' LIMIT 1`).get(run.id)) {
    throw conflict('fa_run_has_disposed_asset', { period: run.period });
  }
}

/** While its entry is still a draft, a month can be cancelled: the entry and the run go, and the month is free again. */
export function cancelRun(db: Db, id: string, actor: Actor): void {
  const run = getRun(db, id);
  assertNoDisposedAsset(run, db);
  if (!run.actions.includes('cancel')) throw conflict('action_not_allowed', { action: 'cancel' });
  transaction(db, () => {
    db.prepare('DELETE FROM depreciation_lines WHERE run_id = ?').run(id);
    db.prepare('DELETE FROM depreciation_runs WHERE id = ?').run(id);
    if (run.entry) deleteEntry(db, run.entry.id, actor.name);
    audit(db, actor.name, 'cancel', 'depreciation', id, { period: run.period });
  });
}

/**
 * Once its entry is approved, a month is taken back with a reversal entry (dated `date`, else today): both stay in the
 * books, the run goes, and the month is free to run again.
 */
export function reverseRun(db: Db, id: string, actor: Actor, date?: string): void {
  const run = getRun(db, id);
  assertNoDisposedAsset(run, db);
  if (!run.actions.includes('reverse') || !run.entry) throw conflict('action_not_allowed', { action: 'reverse' });
  const entryId = run.entry.id;
  transaction(db, () => {
    db.prepare('DELETE FROM depreciation_lines WHERE run_id = ?').run(id);
    db.prepare('DELETE FROM depreciation_runs WHERE id = ?').run(id);
    const reversal = reverseEntryInternal(db, entryId, actor.name, date);
    audit(db, actor.name, 'reverse', 'depreciation', id, { period: run.period, entry: entryId, reversal });
  });
}

/**
 * The first month, from the asset's start up to the month before the disposal, that the company has not run while it
 * runs depreciation in Qasa (from its first run): disposing first would leave that month's depreciation out for good.
 */
function monthNotRun(db: Db, a: AssetDetail, disposalDate: string): string | null {
  if (!a.depreciated || a.accumulated >= a.cost - a.salvage) return null;
  const first = (db.prepare("SELECT MIN(period) AS p FROM depreciation_runs WHERE status <> 'cancelled'").get() as { p: string | null }).p;
  if (!first) return null;
  const ran = new Set((db.prepare("SELECT period FROM depreciation_runs WHERE status <> 'cancelled'").all() as { period: string }[]).map((r) => r.period));
  const end = monthIndex(disposalDate.slice(0, 7));
  for (let i = Math.max(monthIndex(a.startMonth), monthIndex(first)); i < end; i++) {
    if (!ran.has(periodOf(i))) return periodOf(i);
  }
  return null;
}

// ——— disposal ———

export interface DisposeInput {
  date: string;
  proceeds?: number | undefined;
  /** where the proceeds went: a safe or bank (18…) or a debtor (16…) */
  proceedsAccount?: string | undefined;
  gainAccount?: string | undefined;
  lossAccount?: string | undefined;
  lang: Lang;
}

const DISPOSE_TEXT: Record<Lang, (code: string, name: string) => string> = {
  ar: (c, n) => `استبعاد الموجود ${c} — ${n}`,
  en: (c, n) => `Disposal of asset ${c} — ${n}`,
  ku: (c, n) => `دەرکردنی سامانی ${c} — ${n}`
};

/**
 * Sells or scraps an asset: a draft entry takes the cost and the accumulated depreciation off the books and books the
 * difference from the proceeds as a gain or loss. No month may be run for the asset after the disposal month.
 */
export function disposeAsset(db: Db, id: string, input: DisposeInput, actor: Actor): AssetDetail {
  const a = getAsset(db, id);
  if (!a.actions.includes('dispose')) throw conflict('action_not_allowed', { action: 'dispose' });
  const errors: { code: string; field?: string; accountCode?: string }[] = [];
  const proceeds = input.proceeds ?? 0;
  if (!isDate(input.date)) errors.push({ code: 'date_invalid', field: 'date' });
  else {
    if (input.date < a.acquired) errors.push({ code: 'fa_dispose_before_acquired', field: 'date' });
    if (input.date > todayIso()) errors.push({ code: 'fa_dispose_future', field: 'date' });
  }
  if (!isAmount(proceeds) || proceeds < 0) errors.push({ code: 'fa_proceeds_invalid', field: 'proceeds' });
  const accounts = accountMap(db);
  const postable = (code: string | undefined, under: string[]) => !!code && under.some((u) => code.startsWith(u)) && !!accounts.get(code)?.postable;
  if (proceeds > 0 && !postable(input.proceedsAccount, ['18', '16'])) errors.push({ code: 'fa_account_invalid', field: 'proceedsAccount', accountCode: input.proceedsAccount ?? '' });
  const gainAccount = input.gainAccount ?? DEFAULT_GAIN_ACCOUNT;
  const lossAccount = input.lossAccount ?? DEFAULT_LOSS_ACCOUNT;
  if (!postable(gainAccount, ['4'])) errors.push({ code: 'fa_account_invalid', field: 'gainAccount', accountCode: gainAccount });
  if (!postable(lossAccount, ['3'])) errors.push({ code: 'fa_account_invalid', field: 'lossAccount', accountCode: lossAccount });
  if (errors.length) throw invalid(errors);
  const later = db.prepare(`SELECT r.period FROM depreciation_lines l JOIN depreciation_runs r ON r.id = l.run_id
                            WHERE l.asset_id = ? AND r.status <> 'cancelled' AND r.period > ? LIMIT 1`).get(id, input.date.slice(0, 7)) as { period: string } | undefined;
  if (later) throw conflict('fa_runs_after_disposal', { period: later.period });
  const missing = monthNotRun(db, a, input.date);
  if (missing) throw conflict('fa_months_not_run', { period: missing });

  const gain = proceeds + a.accumulated - a.cost;
  const text = DISPOSE_TEXT[input.lang](a.code, a.name);
  const lines: { accountCode: string; debit: number; credit: number; description: string }[] = [];
  if (a.accumulated > 0) lines.push({ accountCode: a.accumAccount.code, debit: a.accumulated, credit: 0, description: text });
  if (proceeds > 0) lines.push({ accountCode: input.proceedsAccount!, debit: proceeds, credit: 0, description: text });
  lines.push({ accountCode: a.assetAccount.code, debit: 0, credit: a.cost, description: text });
  if (gain > 0) lines.push({ accountCode: gainAccount, debit: 0, credit: gain, description: text });
  if (gain < 0) lines.push({ accountCode: lossAccount, debit: -gain, credit: 0, description: text });
  transaction(db, () => {
    const entry = createJournalEntry(db, { date: input.date, description: text, currency: 'IQD', rateX100: 100, lines }, actor.name, actor.id);
    db.prepare("UPDATE fixed_assets SET status = 'disposed', disposed_on = ?, disposal_entry_id = ?, updated_at = ? WHERE id = ?").run(input.date, entry.id, new Date().toISOString(), id);
    writeSetting(db, DISPOSAL(id), JSON.stringify({ entryId: entry.id, date: input.date, proceeds, proceedsAccount: input.proceedsAccount ?? null, gain }));
    audit(db, actor.name, 'dispose', 'fixed_asset', id, { code: a.code, proceeds, gain, entry: entry.id });
  });
  return getAsset(db, id);
}

/**
 * A disposal is taken back: while its entry is still a draft the entry is deleted; once approved it is reversed (dated
 * `date`, else today) and both stay in the books. The asset is in service again.
 */
export function undisposeAsset(db: Db, id: string, actor: Actor, date?: string): AssetDetail {
  const a = getAsset(db, id);
  if (!a.actions.includes('undispose') || !a.disposal) throw conflict('action_not_allowed', { action: 'undispose' });
  const entryId = a.disposal.entry.id;
  const draft = a.disposal.entry.status === 'draft';
  transaction(db, () => {
    db.prepare("UPDATE fixed_assets SET status = 'active', disposed_on = NULL, disposal_entry_id = NULL, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    deleteSetting(db, DISPOSAL(id));
    const reversal = draft ? null : reverseEntryInternal(db, entryId, actor.name, date);
    if (draft) deleteEntry(db, entryId, actor.name);
    audit(db, actor.name, 'undispose', 'fixed_asset', id, { code: a.code, entry: entryId, reversal });
  });
  return getAsset(db, id);
}

// ——— API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const date = z.string().regex(ISO);
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const account = z.string().min(1).max(12);
const lang = z.enum(['ar', 'en', 'ku']).default('ar');
const idParam = z.object({ id: z.string().min(1).max(64) });
const assetBody = z.object({
  name: z.string().max(200), category: z.enum(['land', 'buildings', 'machinery', 'vehicles', 'tools', 'furniture', 'computers']).optional(),
  assetAccount: account, accumAccount: account, expenseAccount: account, acquired: date, cost: amount, salvage: amount.optional(),
  lifeMonths: z.number().int(), openingAccum: amount.optional(), location: z.string().max(200).optional(), notes: z.string().max(1000).optional()
});

/**
 * Reading is open to every signed-in user; every change (the register, running a month, disposing) is for an admin,
 * as the app's own changes are when no rule is listed.
 */
export const assetsApi: ApiExtension = {
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    return [
      { method: 'GET', path: '/api/assets/summary', handler: async () => summary(db) },
      { method: 'GET', path: '/api/assets/defaults', handler: async () => defaults(db) },
      {
        method: 'GET', path: '/api/assets',
        handler: async (req) => {
          const q = parse(z.object({ status: z.enum(['active', 'disposed']).optional(), q: z.string().max(100).optional() }), req.query);
          return listAssets(db, q);
        }
      },
      { method: 'GET', path: '/api/assets/depreciation', handler: async () => listRuns(db) },
      {
        method: 'GET', path: '/api/assets/depreciation/preview',
        handler: async (req) => previewRun(db, parse(z.object({ period: z.string().max(7) }), req.query).period)
      },
      { method: 'GET', path: '/api/assets/depreciation/:id', handler: async (req) => getRun(db, parse(idParam, req.params).id) },
      {
        method: 'POST', path: '/api/assets/depreciation',
        handler: async (req, reply) => {
          const body = parse(z.object({ period: z.string().max(7), lang }), req.body);
          reply.status(201).send(runDepreciation(db, body.period, body.lang as Lang, actor(req)));
          return undefined;
        }
      },
      {
        method: 'POST', path: '/api/assets/depreciation/:id/cancel',
        handler: async (req, reply) => {
          cancelRun(db, parse(idParam, req.params).id, actor(req));
          reply.status(204).send();
          return undefined;
        }
      },
      {
        method: 'POST', path: '/api/assets/depreciation/:id/reverse',
        handler: async (req, reply) => {
          const body = parse(z.object({ date: date.optional() }), req.body ?? {});
          reverseRun(db, parse(idParam, req.params).id, actor(req), body.date);
          reply.status(204).send();
          return undefined;
        }
      },
      { method: 'GET', path: '/api/assets/:id', handler: async (req) => getAsset(db, parse(idParam, req.params).id) },
      {
        method: 'POST', path: '/api/assets',
        handler: async (req, reply) => {
          reply.status(201).send(createAsset(db, parse(assetBody, req.body), actor(req)));
          return undefined;
        }
      },
      {
        method: 'PUT', path: '/api/assets/:id',
        handler: async (req) => updateAsset(db, parse(idParam, req.params).id, parse(assetBody.partial(), req.body), actor(req))
      },
      {
        method: 'DELETE', path: '/api/assets/:id',
        handler: async (req, reply) => {
          deleteAsset(db, parse(idParam, req.params).id, actor(req));
          reply.status(204).send();
          return undefined;
        }
      },
      {
        method: 'POST', path: '/api/assets/:id/dispose',
        handler: async (req) => {
          const body = parse(z.object({
            date, proceeds: amount.optional(), proceedsAccount: account.optional(), gainAccount: account.optional(), lossAccount: account.optional(), lang
          }), req.body);
          return disposeAsset(db, parse(idParam, req.params).id, { ...body, lang: body.lang as Lang }, actor(req));
        }
      },
      {
        method: 'POST', path: '/api/assets/:id/undispose',
        handler: async (req) => undisposeAsset(db, parse(idParam, req.params).id, actor(req), parse(z.object({ date: date.optional() }), req.body ?? {}).date)
      }
    ];
  }
};
