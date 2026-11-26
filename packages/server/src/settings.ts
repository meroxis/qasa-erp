import { businessUnion, checkBusinessChoice, choiceFromStored, type BusinessChoice } from '@qasa/core';
import { DEFAULT_AMOUNTS_SHOW, DEFAULT_POSTING_ACCOUNTS, fiscalYear, fiscalYearOf, isAmountsShow, isBusinessType, isPosBigPictures, isPosUse, POS_QUICK_MAX, type AmountsShow, type BusinessType, type Names, type PosBigPictures, type PosUse, type PostingAccounts } from '@qasa/core';
import type { Db } from './db.ts';
import { audit } from './audit.ts';
import { insertOrKeep, isMysql, transaction } from './db.ts';
import { conflict, invalid } from './errors.ts';

export interface Settings {
  companyName: Names;
  /** Default USD rate, IQD per 1 USD × 100. */
  defaultRateX100: number;
  /** "MM-DD" */
  fiscalYearStart: string;
  /** Accounts that invoices post to. */
  postingAccounts: PostingAccounts;
  /**
   * What the company does (which industry pages the menu shows): every type, the main one first; null until it is
   * chosen. Everything that decides pages reads this one list (core business-choice.ts).
   */
  businessTypes: BusinessType[] | null;
  /** 1.7: the ONE type the company mainly does (null until chosen). */
  businessType: BusinessType | null;
  /** 1.7: what it also does (Settings → "My company also does…"): at most two, more only when kept from before 1.7. */
  businessTypesExtra: BusinessType[];
  /** How the screens show amounts: dinar only (the default), dinar and dollar, or dollar and dinar (core dual.ts). */
  amountsShow: AmountsShow;
  /**
   * 1.5.2: whether the company uses the point of sale: follow the business type (the default), on or off (core
   * pos-use.ts). The menu, home page and search follow it; each person also needs the Point of sale role ('pos'),
   * which the till's API checks (pos.ts).
   */
  posUse: PosUse;
  /**
   * The till's quick buttons: the items shown as one-tap buttons above its categories, in their order (core
   * pos-look.ts). Only items that still exist and are on sale are read back: one deleted or archived since drops out.
   */
  posQuickItems: string[];
  /** Big picture tiles on the till: 'auto' (nobody has chosen: normal tiles), on or off (core pos-look.ts). */
  posBigPictures: PosBigPictures;
}

/** Where each posting account must sit in the unified chart. */
const POSTING_ACCOUNT_PARENTS: Record<keyof PostingAccounts, string> = {
  customers: '16', suppliers: '26', sales: '4', costOfSales: '3', cash: '18', yearResult: '22'
};

export function readSetting(db: Db, key: string): string | undefined {
  return (db.prepare('SELECT value FROM settings WHERE "key" = ?').get(key) as { value: string } | undefined)?.value;
}

export function writeSetting(db: Db, key: string, value: string): void {
  db.prepare(isMysql(db)
    ? 'INSERT INTO settings ("key", value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?'
    : 'INSERT INTO settings ("key", value) VALUES (?, ?) ON CONFLICT ("key") DO UPDATE SET value = ?').run(key, value, value);
}

export function deleteSetting(db: Db, key: string): void {
  db.prepare('DELETE FROM settings WHERE "key" = ?').run(key);
}

export function getPostingAccounts(db: Db): PostingAccounts {
  const stored = JSON.parse(readSetting(db, 'posting_accounts') ?? '{}') as Partial<PostingAccounts>;
  // a company from before the year-end closing where 229 could not be added (22 already had entries): 22 itself
  const yearResult = stored.yearResult
    ?? (db.prepare('SELECT 1 FROM accounts WHERE code = ?').get(DEFAULT_POSTING_ACCOUNTS.yearResult) ? DEFAULT_POSTING_ACCOUNTS.yearResult : '22');
  return { ...DEFAULT_POSTING_ACCOUNTS, ...stored, yearResult };
}

/** The company's choice: `business_type` (1.7, the main one) and `business_types` (every type, the main one first). */
function businessChoice(db: Db): BusinessChoice | null {
  let list: unknown = null;
  try { list = JSON.parse(readSetting(db, 'business_types') ?? 'null'); } catch { list = null; }
  return choiceFromStored(readSetting(db, 'business_type'), list);
}

function businessTypes(db: Db): BusinessType[] | null {
  const choice = businessChoice(db);
  return choice ? businessUnion(choice) : null;
}

export function getSettings(db: Db): Settings {
  const choice = businessChoice(db);
  return {
    companyName: JSON.parse(readSetting(db, 'company_name') ?? '{"ar":"","en":"","ku":""}') as Names,
    defaultRateX100: Number(readSetting(db, 'default_rate_x100') ?? '142000'),
    fiscalYearStart: readSetting(db, 'fiscal_year_start') ?? '01-01',
    postingAccounts: getPostingAccounts(db),
    businessTypes: choice ? businessUnion(choice) : null,
    businessType: choice?.main ?? null,
    businessTypesExtra: choice?.extras ?? [],
    amountsShow: amountsShow(db),
    posUse: posUse(db),
    posQuickItems: quickItems(db),
    posBigPictures: bigPictures(db)
  };
}

/** The ids as saved, each once, at most POS_QUICK_MAX; a value that is not a list of ids (damaged) reads as none. */
function storedQuickItems(db: Db): string[] {
  try {
    const list = JSON.parse(readSetting(db, 'pos_quick_items') ?? '[]') as unknown;
    return Array.isArray(list) ? [...new Set(list.filter((x): x is string => typeof x === 'string'))].slice(0, POS_QUICK_MAX) : [];
  } catch {
    return [];
  }
}

/** Which of these ids are items on sale now: they exist and are active (what the till lists). */
function onSale(db: Db, ids: readonly string[]): Set<string> {
  if (!ids.length) return new Set();
  const rows = db.prepare(`SELECT id FROM items WHERE active = 1 AND id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/**
 * The till's quick buttons: the saved list less the items deleted or archived since. They drop out quietly; an item
 * put on sale again comes back in its place.
 */
function quickItems(db: Db): string[] {
  const ids = storedQuickItems(db);
  const live = onSale(db, ids);
  return ids.filter((id) => live.has(id));
}

/** The company's choice of big pictures; anything unknown (a value from a newer version) is 'auto': normal tiles. */
function bigPictures(db: Db): PosBigPictures {
  const stored = readSetting(db, 'pos_big_pictures');
  return isPosBigPictures(stored) ? stored : 'auto';
}

/**
 * A new list of quick buttons: ids of items on sale now, each once, at most POS_QUICK_MAX. An id that is no item, or
 * an archived one, is refused (not dropped), so whoever sent it is told.
 */
function assertQuickItems(db: Db, ids: unknown): void {
  const bad = () => invalid([{ code: 'pos_quick_items_invalid', field: 'posQuickItems' }]);
  if (!Array.isArray(ids) || ids.length > POS_QUICK_MAX) throw bad();
  if (ids.some((id) => typeof id !== 'string' || !id || id.length > 64) || new Set(ids).size !== ids.length) throw bad();
  const live = onSale(db, ids as string[]);
  const errors = (ids as string[]).flatMap((id, i) => (live.has(id) ? [] : [{ code: 'pos_quick_item_not_on_sale', field: `posQuickItems.${i}` }]));
  if (errors.length) throw invalid(errors);
}

/** The company's choice about the till; anything unknown (a value from a newer version) follows the business type. */
function posUse(db: Db): PosUse {
  const stored = readSetting(db, 'pos_use');
  return isPosUse(stored) ? stored : 'auto';
}

/** The company's choice of how amounts show; anything unknown (a value from a newer version) reads as dinar only. */
function amountsShow(db: Db): AmountsShow {
  const stored = readSetting(db, 'amounts_show');
  return isAmountsShow(stored) ? stored : DEFAULT_AMOUNTS_SHOW;
}

function assertPostingAccounts(db: Db, accounts: PostingAccounts): void {
  const exists = db.prepare('SELECT 1 FROM accounts WHERE code = ?');
  const hasChildren = db.prepare("SELECT 1 FROM accounts WHERE code LIKE ? || '%' AND code <> ? LIMIT 1");
  const errors: { code: string; field: string }[] = [];
  for (const key of Object.keys(POSTING_ACCOUNT_PARENTS) as (keyof PostingAccounts)[]) {
    const code = accounts[key];
    if (!code || !code.startsWith(POSTING_ACCOUNT_PARENTS[key]) || !exists.get(code)) errors.push({ code: 'account_invalid', field: key });
    else if (hasChildren.get(code, code)) errors.push({ code: 'account_not_postable', field: key });
  }
  if (errors.length) throw invalid(errors);
}

/**
 * The choice a patch asks for, or undefined when it changes nothing about it. `businessType` and/or
 * `businessTypesExtra` (1.7): a new main type keeps the extras (all but itself); extras alone keep the main type.
 * `businessTypes` (a list, as before 1.7 and from older apps on an office network): its first industry is the main
 * type and every other one an extra, none dropped.
 */
function choiceOf(db: Db, patch: Partial<Settings>): BusinessChoice | undefined {
  const before = businessChoice(db);
  // read as a company file from before 1.7 is: the first industry is the main type, every other one stays
  if (patch.businessTypes) return choiceFromStored(undefined, patch.businessTypes) ?? undefined;
  if (!patch.businessType && !patch.businessTypesExtra) return undefined;
  const main = patch.businessType ?? before?.main;
  if (!main) throw invalid([{ code: 'business_type_required', field: 'businessType' }]);
  const extras = patch.businessTypesExtra ?? (before?.extras ?? []).filter((t) => t !== main);
  const next = { main, extras: [...extras] };
  const error = checkBusinessChoice(next, before);
  if (error) throw invalid([{ code: error, field: 'businessTypesExtra' }]);
  return next;
}

export function updateSettings(db: Db, patch: Partial<Settings>, user: string): Settings {
  const choice = choiceOf(db, patch);
  if (patch.postingAccounts) assertPostingAccounts(db, { ...getPostingAccounts(db), ...patch.postingAccounts });
  if (patch.amountsShow !== undefined && !isAmountsShow(patch.amountsShow)) throw invalid([{ code: 'amounts_show_invalid', field: 'amountsShow' }]);
  if (patch.posUse !== undefined && !isPosUse(patch.posUse)) throw invalid([{ code: 'pos_use_invalid', field: 'posUse' }]);
  if (patch.posBigPictures !== undefined && !isPosBigPictures(patch.posBigPictures)) throw invalid([{ code: 'pos_big_pictures_invalid', field: 'posBigPictures' }]);
  if (patch.posQuickItems !== undefined) assertQuickItems(db, patch.posQuickItems);
  transaction(db, () => {
    if (patch.companyName) writeSetting(db, 'company_name', JSON.stringify(patch.companyName));
    if (patch.defaultRateX100 !== undefined) writeSetting(db, 'default_rate_x100', String(patch.defaultRateX100));
    if (patch.fiscalYearStart) writeSetting(db, 'fiscal_year_start', patch.fiscalYearStart);
    if (patch.postingAccounts) writeSetting(db, 'posting_accounts', JSON.stringify({ ...getPostingAccounts(db), ...patch.postingAccounts }));
    if (choice) {
      const types = businessUnion(choice);
      const had = businessTypes(db) ?? [];
      // a pharmacy starts its new items with expiry dates (1.1); switching it off later is the company's own choice
      if (types.includes('pharmacy') && !had.includes('pharmacy')) writeSetting(db, 'default_track_expiry', '1');
      // so does a market or supermarket (1.4): food and drink carry a date
      if (types.includes('market') && !had.includes('market')) writeSetting(db, 'default_track_expiry', '1');
      // the list stays every type (main first), as the app before 1.7 reads it: an older copy shows the same pages
      writeSetting(db, 'business_types', JSON.stringify(types));
      writeSetting(db, 'business_type', choice.main);
    }
    if (patch.amountsShow !== undefined) writeSetting(db, 'amounts_show', patch.amountsShow);
    if (patch.posUse !== undefined) writeSetting(db, 'pos_use', patch.posUse);
    if (patch.posBigPictures !== undefined) writeSetting(db, 'pos_big_pictures', patch.posBigPictures);
    if (patch.posQuickItems !== undefined) writeSetting(db, 'pos_quick_items', JSON.stringify(patch.posQuickItems));
    audit(db, user, 'update', 'settings', null, patch);
  });
  return getSettings(db);
}

export function lockedPeriods(db: Db): { period: string; lockedBy: string; lockedAt: string }[] {
  return (db.prepare('SELECT period, locked_by, locked_at FROM locked_periods ORDER BY period').all() as { period: string; locked_by: string; locked_at: string }[])
    .map((r) => ({ period: r.period, lockedBy: r.locked_by, lockedAt: r.locked_at }));
}

export function isPeriodLocked(db: Db, isoDate: string): boolean {
  return !!db.prepare('SELECT 1 FROM locked_periods WHERE period = ?').get(isoDate.slice(0, 7));
}

export function lockPeriod(db: Db, period: string, user: string): void {
  transaction(db, () => {
    insertOrKeep(db, 'locked_periods', ['period', 'locked_by', 'locked_at'], 'period').run(period, user, new Date().toISOString());
    audit(db, user, 'lock', 'period', period);
  });
}

export function unlockPeriod(db: Db, period: string, user: string): void {
  transaction(db, () => {
    const start = getSettings(db).fiscalYearStart;
    const closings = db.prepare("SELECT date FROM entries WHERE type = 'closing' AND status = 'approved' AND reversed_by_id IS NULL").all() as { date: string }[];
    for (const closing of closings) {
      const { from, to } = fiscalYear(fiscalYearOf(closing.date, start), start);
      if (period >= from.slice(0, 7) && period <= to.slice(0, 7)) throw conflict('period_in_closed_year');
    }
    db.prepare('DELETE FROM locked_periods WHERE period = ?').run(period);
    audit(db, user, 'unlock', 'period', period);
  });
}
