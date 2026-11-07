import { z } from 'zod';
import {
  isCurrency, isUnit, normalizeForSearch, parseAmount, parseQty, todayIso, toWesternDigits, UNITS,
  type CurrencyCode, type UnitCode
} from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, invalid, notFound } from './errors.ts';
import { createItem } from './items.ts';
import { createParty } from './parties.ts';
import { createStockDoc } from './stock-docs.ts';
import { createJournalEntry } from './journal.ts';
import { createAccount, loadAccounts } from './accounts.ts';
import type { Account } from '@qasa/core';
import type { ApiExtension, ApiRequest } from './routes.ts';
import type { Actor } from './auth.ts';

/**
 * Item pictures and importing from Excel (free, every edition).
 *
 * Pictures: one per item, sent as base64 and checked by their first bytes (JPEG, PNG or WebP — never trusting a name
 * or a type the client claims), at most 400 KB. The app shrinks them before sending, so a list of items stays light.
 * They are read back as base64 JSON rather than raw bytes, so the website demo (which answers in the browser, with
 * JSON only) works too, and the page shows them as data: URLs (the app's content security policy allows data: images).
 *
 * Import: the app reads the Excel or CSV file and matches its columns; the server checks every row and then makes
 * everything in one transaction — all or nothing, with the row number of each problem. A dry run does all of that and
 * rolls back, so the person sees exactly what would happen. Opening stock becomes a draft opening-stock document and
 * opening balances a draft journal entry: both are posted the usual way, through the preparer, checker and approver.
 */

export const MAX_IMAGE_BYTES = 400 * 1024;
export const MAX_IMPORT_ROWS = 5000;

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

/** The picture's type from its first bytes, or null when it isn't a JPEG, PNG or WebP. */
export function imageMime(bytes: Uint8Array): ImageMime | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function ascii(b: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...b.subarray(from, to));
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Decodes base64 (no Buffer: this code also runs in the browser for the demo). Null when it isn't base64. */
export function fromBase64(text: string): Uint8Array | null {
  const clean = text.replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  if (clean.length % 4 !== 0 || !BASE64.test(clean)) return null;
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

export interface ItemImageView { itemId: string; mime: ImageMime; data: string; updatedAt: string }

function itemExists(db: Db, id: string): boolean {
  return !!db.prepare('SELECT 1 FROM items WHERE id = ?').get(id);
}

export function getItemImage(db: Db, itemId: string): ItemImageView {
  const row = db.prepare('SELECT mime, data, updated_at FROM item_images WHERE item_id = ?').get(itemId) as
    { mime: ImageMime; data: Uint8Array; updated_at: string } | undefined;
  if (!row) throw notFound('item_image');
  return { itemId, mime: row.mime, data: toBase64(new Uint8Array(row.data)), updatedAt: row.updated_at };
}

/** Which items have a picture, and since when (the page asks for a picture only when there is one). */
export function listItemImages(db: Db): { itemId: string; updatedAt: string }[] {
  return (db.prepare('SELECT item_id, updated_at FROM item_images ORDER BY item_id').all() as { item_id: string; updated_at: string }[])
    .map((r) => ({ itemId: r.item_id, updatedAt: r.updated_at }));
}

export function setItemImage(db: Db, itemId: string, base64: string, user: string): { itemId: string; mime: ImageMime; bytes: number; updatedAt: string } {
  if (!itemExists(db, itemId)) throw notFound('item');
  const bytes = fromBase64(base64);
  if (!bytes || bytes.length === 0) throw invalid([{ code: 'md_image_invalid' }]);
  if (bytes.length > MAX_IMAGE_BYTES) throw invalid([{ code: 'md_image_too_large' }]);
  const mime = imageMime(bytes);
  if (!mime) throw invalid([{ code: 'md_image_invalid' }]);
  const now = new Date().toISOString();
  transaction(db, () => {
    // delete + insert works the same on SQLite and MariaDB/MySQL (no upsert syntax to tell apart)
    db.prepare('DELETE FROM item_images WHERE item_id = ?').run(itemId);
    db.prepare('INSERT INTO item_images (item_id, mime, data, updated_at) VALUES (?, ?, ?, ?)').run(itemId, mime, bytes, now);
    audit(db, user, 'update', 'item_image', itemId, { mime, bytes: bytes.length });
  });
  return { itemId, mime, bytes: bytes.length, updatedAt: now };
}

export function deleteItemImage(db: Db, itemId: string, user: string): void {
  if (!itemExists(db, itemId)) throw notFound('item');
  transaction(db, () => {
    const removed = db.prepare('DELETE FROM item_images WHERE item_id = ?').run(itemId);
    if (Number(removed.changes) > 0) audit(db, user, 'delete', 'item_image', itemId);
  });
}

/* ---------- import ---------- */

export const IMPORT_KINDS = ['customers', 'suppliers', 'items', 'opening_stock', 'opening_balances', 'trial_balance'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export interface ImportOptions {
  /** opening stock and opening balances */
  date?: string | undefined;
  /** opening stock: the warehouse the goods are in (default: the first active one) */
  warehouseId?: string | undefined;
  /** opening stock and balances: the account on the other side (default 21, capital) */
  counterAccountCode?: string | undefined;
  /** opening balances: whose balances these are */
  partyType?: 'customer' | 'supplier' | undefined;
  /** opening balances in USD: IQD per USD × 100 */
  rateX100?: number | undefined;
  /** trial balance: the currency its amounts are in (default IQD) */
  currency?: CurrencyCode | undefined;
}

export interface ImportInput { kind: ImportKind; rows: Record<string, unknown>[]; dryRun: boolean; options?: ImportOptions | undefined }

export interface ImportResult {
  kind: ImportKind;
  dryRun: boolean;
  rows: number;
  created: number;
  /** rows already in the books (same name, code or …), left as they are */
  skipped: { line: number; reason: string }[];
  /** the draft documents it made (opening stock, opening balances), to review and post */
  documents: { type: 'stock_doc' | 'entry'; id: string; currency?: CurrencyCode }[];
}

type RowError = { code: string; line?: number; [k: string]: unknown };

/** Rows start at 2: row 1 of the sheet is the header. */
const lineOf = (index: number) => index + 2;

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();

/** Unit words in the three languages (and a few common spellings) → the unit code. */
function unitOf(value: string): UnitCode | null {
  const v = normalizeForSearch(value);
  if (!v) return 'piece';
  if (isUnit(v)) return v;
  for (const [code, names] of Object.entries(UNITS) as [UnitCode, { ar: string; en: string; ku: string }][]) {
    if ([names.ar, names.en, names.ku].some((n) => normalizeForSearch(n) === v)) return code;
  }
  const extra: Record<string, UnitCode> = { pcs: 'piece', pc: 'piece', pieces: 'piece', عدد: 'piece', حبة: 'piece', kilo: 'kg', كيلو: 'kg', meter: 'm', متر: 'm', litre: 'l', liter: 'l', لتر: 'l', كارتونة: 'carton' };
  return extra[v] ?? null;
}

/** Currency words → IQD or USD; empty means IQD. */
function currencyOf(value: string): CurrencyCode | null {
  const v = normalizeForSearch(value).replace(/\s/g, '');
  if (!v) return 'IQD';
  const upper = v.toUpperCase();
  if (isCurrency(upper)) return upper;
  if (['دينار', 'د.ع', 'دع', 'دینار', 'iqd', 'dinar'].includes(v)) return 'IQD';
  if (['دولار', '$', 'usd', 'dollar', 'دۆلار'].includes(v)) return 'USD';
  return null;
}

/** A signed amount ("-1,250,000", "(1,250,000)") in minor units, or null. */
function signedAmount(value: string, currency: CurrencyCode): number | null {
  let s = toWesternDigits(value).trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith('-') || s.startsWith('−')) { negative = true; s = s.slice(1); }
  const n = parseAmount(s, currency);
  return n === null ? null : negative ? -n : n;
}

const OPTIONS = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  warehouseId: z.string().min(1).max(64).optional(),
  counterAccountCode: z.string().regex(/^[1-4]\d{0,11}$/).optional(),
  partyType: z.enum(['customer', 'supplier']).optional(),
  rateX100: z.number().int().positive().max(100_000_000).optional(),
  currency: z.enum(['IQD', 'USD']).optional()
});

const INPUT = z.object({
  kind: z.enum(IMPORT_KINDS),
  rows: z.array(z.record(z.string().max(60), z.unknown())).max(MAX_IMPORT_ROWS),
  dryRun: z.boolean().default(true),
  options: OPTIONS.optional()
});

class DryRun extends Error {
  constructor(readonly result: ImportResult) { super('dry_run'); }
}

/** Runs an import: checks every row, then makes everything at once — or, for a dry run, does it all and rolls back. */
export function runImport(db: Db, input: ImportInput, actor: Actor): ImportResult {
  if (!input.rows.length) throw invalid([{ code: 'md_no_rows' }]);
  if (input.rows.length > MAX_IMPORT_ROWS) throw invalid([{ code: 'md_too_many_rows', n: MAX_IMPORT_ROWS }]);
  const result: ImportResult = { kind: input.kind, dryRun: input.dryRun, rows: input.rows.length, created: 0, skipped: [], documents: [] };
  try {
    transaction(db, () => {
      IMPORTERS[input.kind](db, input, actor, result);
      if (input.dryRun) throw new DryRun(result);
    });
  } catch (error) {
    if (error instanceof DryRun) return error.result;
    throw error;
  }
  audit(db, actor.name, 'import', 'import', input.kind, { rows: result.rows, created: result.created, skipped: result.skipped.length });
  return result;
}

/** Calls a service for one row and gives its problems that row's number. */
function atRow<T>(errors: RowError[], line: number | undefined, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === 'validation' && Array.isArray(error.details)) {
      for (const d of error.details as { code?: string }[]) errors.push({ ...d, code: d.code ?? 'internal', ...(line === undefined ? {} : { line }) });
    } else {
      errors.push({ code: error.code, ...(line === undefined ? {} : { line }) });
    }
    return undefined;
  }
}

function fail(errors: RowError[]): void {
  if (errors.length) throw invalid(errors.slice(0, 200));
}

type Importer = (db: Db, input: ImportInput, actor: Actor, result: ImportResult) => void;

const importParties = (type: 'customer' | 'supplier'): Importer => (db, input, actor, result) => {
  const errors: RowError[] = [];
  const existing = new Set((db.prepare('SELECT name FROM parties WHERE type = ?').all(type) as { name: string }[]).map((p) => normalizeForSearch(p.name)));
  const seen = new Map<string, number>();
  const rows = input.rows.map((r, i) => {
    const line = lineOf(i);
    const name = text(r.name);
    const key = normalizeForSearch(name);
    if (!name) errors.push({ code: 'md_name_required', line });
    else if (seen.has(key)) errors.push({ code: 'md_duplicate_in_file', line, other: seen.get(key) });
    else seen.set(key, line);
    let creditLimit: number | null = null;
    if (type === 'customer' && text(r.creditLimit)) {
      creditLimit = parseAmount(text(r.creditLimit), 'IQD');
      if (creditLimit === null) errors.push({ code: 'md_amount_invalid', line });
    }
    return { line, name, key, phone: text(r.phone), address: text(r.address), notes: text(r.notes), creditLimit };
  });
  fail(errors);
  for (const row of rows) {
    if (existing.has(row.key)) { result.skipped.push({ line: row.line, reason: 'exists' }); continue; }
    const made = atRow(errors, row.line, () => createParty(db, type, {
      name: row.name, phone: row.phone || undefined, address: row.address || undefined, notes: row.notes || undefined,
      ...(type === 'customer' ? { creditLimit: row.creditLimit } : {})
    }, actor.name));
    if (made) result.created++;
  }
  fail(errors);
};

const importItems: Importer = (db, input, actor, result) => {
  const errors: RowError[] = [];
  const codes = new Set((db.prepare('SELECT code FROM items').all() as { code: string }[]).map((i) => i.code.toLowerCase()));
  const seenCodes = new Map<string, number>();
  const seenBarcodes = new Map<string, number>();
  const rows = input.rows.map((r, i) => {
    const line = lineOf(i);
    const code = text(r.code);
    const barcode = toWesternDigits(text(r.barcode));
    const name = { ar: text(r.nameAr), en: text(r.nameEn), ku: text(r.nameKu) };
    // one name is enough: the other languages show it until someone writes theirs
    const any = name.ar || name.en || name.ku || text(r.name);
    if (!any) errors.push({ code: 'md_name_required', line });
    const names = { ar: name.ar || any, en: name.en || any, ku: name.ku || any };
    const unit = unitOf(text(r.unit));
    if (!unit) errors.push({ code: 'md_unit_invalid', line });
    const currency = currencyOf(text(r.currency));
    if (!currency) errors.push({ code: 'md_currency_invalid', line });
    const price = text(r.price) ? parseAmount(text(r.price), currency ?? 'IQD') : 0;
    if (price === null) errors.push({ code: 'md_price_invalid', line });
    if (code) {
      const k = code.toLowerCase();
      if (seenCodes.has(k)) errors.push({ code: 'md_duplicate_in_file', line, other: seenCodes.get(k) });
      else seenCodes.set(k, line);
    }
    if (barcode) {
      if (seenBarcodes.has(barcode)) errors.push({ code: 'md_duplicate_in_file', line, other: seenBarcodes.get(barcode) });
      else seenBarcodes.set(barcode, line);
    }
    return { line, code, barcode, names, unit, currency, price };
  });
  fail(errors);
  for (const row of rows) {
    if (row.code && codes.has(row.code.toLowerCase())) { result.skipped.push({ line: row.line, reason: 'exists' }); continue; }
    const made = atRow(errors, row.line, () => createItem(db, {
      code: row.code || undefined, barcode: row.barcode || undefined, name: row.names, unit: row.unit!, salePrice: row.price!, saleCurrency: row.currency!
    }, actor.name));
    if (made) result.created++;
  }
  fail(errors);
};

/** Finds an item by code, barcode or exact name in any language. */
function findItem(db: Db, ref: string): { id: string; trackStock: boolean } | null {
  const v = toWesternDigits(ref).trim();
  if (!v) return null;
  const byCode = db.prepare('SELECT id, track_stock FROM items WHERE code = ? OR barcode = ?').get(v, v) as { id: string; track_stock: number } | undefined;
  if (byCode) return { id: byCode.id, trackStock: Number(byCode.track_stock) === 1 };
  const key = normalizeForSearch(v);
  const all = db.prepare('SELECT id, track_stock, name_ar, name_en, name_ku FROM items').all() as { id: string; track_stock: number; name_ar: string; name_en: string; name_ku: string }[];
  const hits = all.filter((i) => [i.name_ar, i.name_en, i.name_ku].some((n) => normalizeForSearch(n) === key));
  return hits.length === 1 ? { id: hits[0]!.id, trackStock: Number(hits[0]!.track_stock) === 1 } : null;
}

function defaultWarehouse(db: Db, id: string | undefined): string {
  if (id) {
    const w = db.prepare('SELECT active FROM warehouses WHERE id = ?').get(id) as { active: number } | undefined;
    if (!w || Number(w.active) !== 1) throw invalid([{ code: 'warehouse_invalid' }]);
    return id;
  }
  const first = db.prepare('SELECT id FROM warehouses WHERE active = 1 ORDER BY code LIMIT 1').get() as { id: string } | undefined;
  if (!first) throw invalid([{ code: 'warehouse_invalid' }]);
  return first.id;
}

const importOpeningStock: Importer = (db, input, actor, result) => {
  const errors: RowError[] = [];
  const o = input.options ?? {};
  const warehouseId = defaultWarehouse(db, o.warehouseId);
  const seen = new Map<string, number>();
  const lines = input.rows.map((r, i) => {
    const line = lineOf(i);
    const item = findItem(db, text(r.item));
    if (!item) errors.push({ code: 'md_item_not_found', line });
    else if (!item.trackStock) errors.push({ code: 'md_item_not_stocked', line });
    else if (seen.has(item.id)) errors.push({ code: 'md_duplicate_in_file', line, other: seen.get(item.id) });
    else seen.set(item.id, line);
    const qtyMilli = parseQty(text(r.qty));
    if (qtyMilli === null || qtyMilli <= 0) errors.push({ code: 'md_qty_invalid', line });
    const unitCost = text(r.cost) ? parseAmount(text(r.cost), 'IQD') : 0;
    if (unitCost === null) errors.push({ code: 'md_cost_invalid', line });
    return { itemId: item?.id ?? '', qtyMilli: qtyMilli ?? 0, unitCost: unitCost ?? 0 };
  });
  fail(errors);
  const doc = atRow(errors, undefined, () => createStockDoc(db, {
    kind: 'opening', date: o.date ?? todayIso(), warehouseId, counterAccountCode: o.counterAccountCode ?? '21',
    notes: 'Imported from Excel', lines
  }, actor.name));
  fail(errors);
  result.created = lines.length;
  result.documents.push({ type: 'stock_doc', id: doc!.id });
};

/** Finds a customer or supplier by code or exact name. */
function findParty(db: Db, type: 'customer' | 'supplier', ref: string): { id: string; accountCode: string } | null {
  const v = ref.trim();
  if (!v) return null;
  const byCode = db.prepare('SELECT id, account_code FROM parties WHERE type = ? AND code = ?').get(type, v) as { id: string; account_code: string } | undefined;
  if (byCode) return { id: byCode.id, accountCode: byCode.account_code };
  const key = normalizeForSearch(v);
  const hits = (db.prepare('SELECT id, name, account_code FROM parties WHERE type = ?').all(type) as { id: string; name: string; account_code: string }[])
    .filter((p) => normalizeForSearch(p.name) === key);
  return hits.length === 1 ? { id: hits[0]!.id, accountCode: hits[0]!.account_code } : null;
}

const importOpeningBalances: Importer = (db, input, actor, result) => {
  const errors: RowError[] = [];
  const o = input.options ?? {};
  const type = o.partyType ?? 'customer';
  const counter = o.counterAccountCode ?? '21';
  const seen = new Map<string, number>();
  const rows = input.rows.map((r, i) => {
    const line = lineOf(i);
    const party = findParty(db, type, text(r.party));
    if (!party) errors.push({ code: 'md_party_not_found', line });
    else if (seen.has(party.id)) errors.push({ code: 'md_duplicate_in_file', line, other: seen.get(party.id) });
    else seen.set(party.id, line);
    const currency = currencyOf(text(r.currency));
    if (!currency) errors.push({ code: 'md_currency_invalid', line });
    const amount = signedAmount(text(r.amount), currency ?? 'IQD');
    if (amount === null) errors.push({ code: 'md_amount_invalid', line });
    return { line, party, currency: currency ?? 'IQD', amount: amount ?? 0 };
  });
  if (rows.some((r) => r.currency === 'USD') && !o.rateX100) errors.push({ code: 'md_rate_required' });
  fail(errors);
  for (const currency of ['IQD', 'USD'] as const) {
    const own = rows.filter((r) => r.currency === currency && r.amount !== 0);
    if (!own.length) { result.skipped.push(...rows.filter((r) => r.currency === currency).map((r) => ({ line: r.line, reason: 'zero' }))); continue; }
    // a customer's positive balance is owed to us (debit); a supplier's positive balance is what we owe (credit)
    const lines: { accountCode: string; partyId?: string; debit: number; credit: number }[] = own.map((r) => {
      const debit = type === 'customer' ? r.amount > 0 : r.amount < 0;
      const value = Math.abs(r.amount);
      return { accountCode: r.party!.accountCode, partyId: r.party!.id, debit: debit ? value : 0, credit: debit ? 0 : value };
    });
    const net = lines.reduce((s, l) => s + l.debit - l.credit, 0);
    if (net !== 0) lines.push({ accountCode: counter, debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0 });
    const entry = atRow(errors, undefined, () => createJournalEntry(db, {
      date: o.date ?? todayIso(), description: type === 'customer' ? 'Opening balances of customers (imported)' : 'Opening balances of suppliers (imported)',
      currency, rateX100: currency === 'IQD' ? 100 : o.rateX100!,
      lines
    }, actor.name, actor.id));
    fail(errors);
    result.created += own.length;
    result.documents.push({ type: 'entry', id: entry!.id, currency });
    result.skipped.push(...rows.filter((r) => r.currency === currency && r.amount === 0).map((r) => ({ line: r.line, reason: 'zero' })));
  }
};


/* ---------- a trial balance from another program (ميزان مراجعة) → the unified chart + one opening entry ---------- */

/**
 * Words people use for accounts, pointing at the unified chart (Arabic, English, Kurdish). Name similarity does the
 * rest; these catch the accounts every company has, whatever the other program called them.
 */
const ACCOUNT_WORDS: [string[], string][] = [
  [['صندوق', 'الصندوق', 'قاصة', 'القاصة', 'خزينة', 'الخزينة', 'cash', 'cash on hand', 'petty cash', 'safe', 'قاسە', 'سندوق'], '1811'],
  [['مصرف', 'المصرف', 'بنك', 'البنك', 'bank', 'بانک'], '1831'],
  [['زبائن', 'الزبائن', 'عملاء', 'العملاء', 'مدينون', 'المدينون', 'ذمم مدينة', 'customers', 'receivable', 'receivables', 'accounts receivable', 'debtors', 'کڕیاران', 'قەرزداران'], '1611'],
  [['مجهزون', 'المجهزون', 'موردون', 'الموردون', 'دائنون', 'الدائنون', 'ذمم دائنة', 'suppliers', 'vendors', 'payable', 'payables', 'accounts payable', 'creditors', 'دابینکەران'], '2611'],
  [['مخزون', 'المخزون', 'بضاعة', 'البضاعة', 'بضاعة اول المدة', 'inventory', 'stock', 'goods', 'کۆگا'], '1371'],
  [['راس المال', 'رأس المال', 'capital', 'equity', "owner's equity", 'سەرمایە'], '21'],
  [['ارباح محتجزة', 'الأرباح المحتجزة', 'فائض متراكم', 'retained earnings', 'accumulated surplus'], '229'],
  [['رواتب', 'الرواتب', 'اجور', 'الأجور', 'salaries', 'wages', 'payroll', 'مووچە'], '31'],
  [['مبيعات', 'المبيعات', 'ايراد المبيعات', 'sales', 'revenue', 'income', 'فرۆشتن'], '42'],
  [['مشتريات', 'المشتريات', 'purchases', 'کڕین'], '35'],
  [['ايجار', 'الإيجار', 'rent', 'کرێ'], '36'],
  [['سلف الموظفين', 'سلف', 'employee advances', 'advances', 'سولفە'], '1661'],
  [['اثاث', 'الأثاث', 'furniture', 'office equipment'], '116'],
  [['سيارات', 'وسائط نقل', 'vehicles', 'cars', 'ئۆتۆمبێل'], '114'],
  [['مكائن', 'معدات', 'machinery', 'equipment'], '113'],
  [['مباني', 'المباني', 'buildings'], '112'],
  [['اراضي', 'الأراضي', 'land'], '111'],
  [['اندثار متراكم', 'مخصص الاندثار', 'accumulated depreciation'], '231'],
  [['قروض', 'القروض', 'loans', 'loan'], '24']
];

const words = (s: string) => normalizeForSearch(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1);

/** How alike two names are, 0–1, by the words they share. */
function likeness(a: string, b: string): number {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / Math.max(x.size, y.size);
}

export interface AccountSuggestion { code: string; score: number }

/**
 * The best places in this company's chart for an account from another program (its code and name, as written there):
 * the same code, the longest of our codes its number starts with, words every company uses for its cash, bank,
 * customers …, and how alike the names are in Arabic, English and Kurdish. Up to three, best first.
 */
export function suggestAccounts(chart: readonly Account[], source: { code?: string | undefined; name: string }): AccountSuggestion[] {
  const scores = new Map<string, number>();
  const add = (code: string, score: number) => {
    if (!chart.some((a) => a.code === code)) return;
    scores.set(code, Math.max(scores.get(code) ?? 0, score));
  };
  const code = toWesternDigits(source.code ?? '').replace(/\D/g, '');
  if (code) {
    if (chart.some((a) => a.code === code)) add(code, 1);
    const prefix = chart.filter((a) => code.startsWith(a.code) && a.code !== code).sort((a, b) => b.code.length - a.code.length)[0];
    if (prefix) add(prefix.code, 0.55 + Math.min(prefix.code.length, 4) * 0.05);
  }
  const name = normalizeForSearch(source.name);
  for (const [list, target] of ACCOUNT_WORDS) {
    for (const w of list) {
      const nw = normalizeForSearch(w);
      if (name === nw) add(target, 0.95);
      else if (` ${name} `.includes(` ${nw} `)) add(target, 0.8);
    }
  }
  for (const a of chart) {
    const best = Math.max(likeness(source.name, a.name.ar), likeness(source.name, a.name.en), likeness(source.name, a.name.ku));
    if (best > 0) add(a.code, best * 0.85);
  }
  return [...scores].map(([c, score]) => ({ code: c, score: Math.round(score * 100) / 100 }))
    .sort((a, b) => b.score - a.score || a.code.length - b.code.length).slice(0, 3);
}

/** The next free code under a parent: one more digit (1–9), then two. */
function nextChildCode(db: Db, parent: string): string | null {
  const taken = new Set((db.prepare("SELECT code FROM accounts WHERE code LIKE ? || '%'").all(parent) as { code: string }[]).map((r) => r.code));
  for (let d = 1; d <= 9; d++) if (!taken.has(parent + d)) return parent + d;
  for (let d = 10; d <= 99; d++) if (!taken.has(parent + d)) return parent + d;
  return null;
}

/**
 * Rows: the account as the other program named it, the chart account chosen for it (`target`) — or, with `newName`, a
 * new sub-account made under `target` — and its debit and credit. Accounts named twice are added together. The
 * result is one draft opening entry (it follows the preparer, checker and approver); a difference between the
 * debits and credits goes to `counterAccountCode` when one is given, otherwise the check says by how much.
 */
const importTrialBalance: Importer = (db, input, actor, result) => {
  const errors: RowError[] = [];
  const o = input.options ?? {};
  const currency = o.currency ?? 'IQD';
  if (currency === 'USD' && !o.rateX100) errors.push({ code: 'md_rate_required' });
  let chart = loadAccounts(db);
  const byCode = () => new Map(chart.map((a) => [a.code, a]));
  let map = byCode();
  const made = new Map<string, string>(); // "parent|name" → new code
  const amounts = new Map<string, number>(); // account → debit − credit
  for (const [i, r] of input.rows.entries()) {
    const line = lineOf(i);
    const debit = text(r.debit) ? signedAmount(text(r.debit), currency) : 0;
    const credit = text(r.credit) ? signedAmount(text(r.credit), currency) : 0;
    if (debit === null || credit === null) { errors.push({ code: 'md_amount_invalid', line }); continue; }
    const net = debit - credit;
    if (net === 0) { result.skipped.push({ line, reason: 'zero' }); continue; }
    const target = text(r.target);
    const newName = text(r.newName);
    const account = map.get(target);
    if (!account) { errors.push({ code: 'md_account_not_chosen', line }); continue; }
    let code = target;
    if (newName) {
      const key = `${target}|${normalizeForSearch(newName)}`;
      const existing = made.get(key) ?? chart.find((a) => a.parentCode === target && [a.name.ar, a.name.en, a.name.ku].some((n) => normalizeForSearch(n) === normalizeForSearch(newName)))?.code;
      if (existing) code = existing;
      else {
        const next = nextChildCode(db, target);
        if (!next) { errors.push({ code: 'md_account_full', line }); continue; }
        const created = atRow(errors, line, () => createAccount(db, { parentCode: target, code: next, name: { ar: newName, en: newName, ku: newName } }, actor.name));
        if (!created) continue;
        made.set(key, next);
        chart = loadAccounts(db);
        map = byCode();
        code = next;
      }
    } else if (!account.postable) {
      errors.push({ code: 'md_account_not_postable', line, c: target });
      continue;
    }
    amounts.set(code, (amounts.get(code) ?? 0) + net);
  }
  fail(errors);
  const lines = [...amounts].filter(([, v]) => v !== 0).map(([accountCode, v]) => ({ accountCode, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 }));
  if (!lines.length) throw invalid([{ code: 'md_no_rows' }]);
  const difference = lines.reduce((s, l) => s + l.debit - l.credit, 0);
  if (difference !== 0) {
    if (!o.counterAccountCode) throw invalid([{ code: 'md_not_balanced', a: difference, cur: currency }]);
    lines.push({ accountCode: o.counterAccountCode, debit: difference < 0 ? -difference : 0, credit: difference > 0 ? difference : 0 });
  }
  const entry = atRow(errors, undefined, () => createJournalEntry(db, {
    date: o.date ?? todayIso(), description: 'Opening balances (imported trial balance)',
    currency, rateX100: currency === 'IQD' ? 100 : o.rateX100!, lines
  }, actor.name, actor.id));
  fail(errors);
  result.created = amounts.size;
  result.documents.push({ type: 'entry', id: entry!.id, currency });
};

/* ---------- a Google Sheet shared by link ---------- */

/**
 * The CSV address of a Google Sheet from the link people copy ("Share → Anyone with the link", or "Publish to the
 * web"). Only docs.google.com sheet links are accepted, and the address is rebuilt from the sheet's id, never passed on.
 */
export function googleSheetCsvUrl(link: string): string | null {
  let url: URL;
  try { url = new URL(link.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return null;
  const gidMatch = /(?:^|[#&?])gid=(\d{1,12})/.exec(url.hash + '&' + url.search);
  const gid = gidMatch ? gidMatch[1]! : '0';
  const published = /^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]{20,200})\//.exec(url.pathname);
  if (published) return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv&gid=${gid}`;
  const shared = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,200})(?:\/|$)/.exec(url.pathname);
  if (shared) return `https://docs.google.com/spreadsheets/d/${shared[1]}/export?format=csv&gid=${gid}`;
  return null;
}

const SHEET_HOSTS = /^(docs\.google\.com|[a-z0-9-]+\.googleusercontent\.com)$/;
const MAX_SHEET_BYTES = 5 * 1024 * 1024;

/**
 * Fetches a shared sheet as CSV on the app's own server (the page itself may only talk to the app). It follows
 * Google's redirects only within Google's own addresses, stops after 15 seconds or 5 MB, and says so plainly when the
 * sheet isn't shared ("anyone with the link"): Google then answers with its sign-in page.
 */
export async function fetchGoogleSheet(link: string, fetchFn: typeof fetch = fetch): Promise<{ csv: string }> {
  let next = googleSheetCsvUrl(link);
  if (!next) throw invalid([{ code: 'md_sheet_link_invalid' }]);
  const signal = AbortSignal.timeout(15_000);
  for (let hop = 0; hop < 6; hop++) {
    let res: Response;
    try {
      res = await fetchFn(next, { redirect: 'manual', signal, headers: { accept: 'text/csv,text/plain;q=0.9' } });
    } catch {
      throw invalid([{ code: 'md_sheet_unreachable' }]);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) break;
      const target = new URL(location, next);
      if (target.protocol !== 'https:' || !SHEET_HOSTS.test(target.hostname)) throw invalid([{ code: 'md_sheet_not_shared' }]);
      next = target.toString();
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) throw invalid([{ code: 'md_sheet_not_shared' }]);
    if (!res.ok) throw invalid([{ code: 'md_sheet_unreachable' }]);
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/html')) throw invalid([{ code: 'md_sheet_not_shared' }]);
    const reader = res.body?.getReader();
    if (!reader) return { csv: '' };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_SHEET_BYTES) { await reader.cancel(); throw invalid([{ code: 'md_sheet_too_large' }]); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.length; }
    return { csv: new TextDecoder().decode(bytes) };
  }
  throw invalid([{ code: 'md_sheet_unreachable' }]);
}

const IMPORTERS: Record<ImportKind, Importer> = {
  customers: importParties('customer'),
  suppliers: importParties('supplier'),
  items: importItems,
  opening_stock: importOpeningStock,
  opening_balances: importOpeningBalances,
  trial_balance: importTrialBalance
};

/* ---------- routes ---------- */

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const idParam = z.object({ id: z.string().min(1).max(64) });

/**
 * Pictures: anyone signed in sees them; changing one needs the stock permission. Importing, the account suggestions
 * and fetching a Google Sheet need an admin (they aren't listed in rules, so the app's own rule applies — and POST
 * routes are changes, so a non-admin is refused even for the read-only suggestions).
 */
export const mediaApi: ApiExtension = {
  rules: {
    'PUT /api/items/:id/image': 'stock',
    'DELETE /api/items/:id/image': 'stock'
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    return [
      { method: 'GET', path: '/api/item-images', handler: async () => listItemImages(db) },
      { method: 'GET', path: '/api/items/:id/image', handler: async (req) => getItemImage(db, parse(idParam, req.params).id) },
      {
        method: 'PUT', path: '/api/items/:id/image',
        handler: async (req) => {
          const body = parse(z.object({ data: z.string().min(1).max(Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 200) }), req.body);
          return setItemImage(db, parse(idParam, req.params).id, body.data, actor(req).name);
        }
      },
      {
        method: 'DELETE', path: '/api/items/:id/image',
        handler: async (req, reply) => {
          deleteItemImage(db, parse(idParam, req.params).id, actor(req).name);
          reply.status(204).send();
          return undefined;
        }
      },
      {
        method: 'POST', path: '/api/import',
        handler: async (req) => {
          const body = parse(INPUT, req.body);
          if (body.kind === 'opening_balances' && !body.options?.partyType) throw invalid([{ code: 'md_party_type_required' }]);
          return runImport(db, { kind: body.kind, rows: body.rows, dryRun: body.dryRun, options: body.options }, actor(req));
        }
      },
      {
        // where each account of another program's trial balance most likely belongs in this company's chart
        method: 'POST', path: '/api/import/suggest-accounts',
        handler: async (req) => {
          const body = parse(z.object({ accounts: z.array(z.object({ code: z.string().max(40).optional(), name: z.string().max(300) })).max(MAX_IMPORT_ROWS) }), req.body);
          const chart = loadAccounts(db);
          return body.accounts.map((a) => suggestAccounts(chart, a));
        }
      },
      {
        method: 'POST', path: '/api/import/google-sheet',
        handler: async (req) => fetchGoogleSheet(parse(z.object({ url: z.string().min(10).max(2000) }), req.body).url)
      }
    ];
  }
};

