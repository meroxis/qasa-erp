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

export const IMPORT_KINDS = ['customers', 'suppliers', 'items', 'opening_stock', 'opening_balances'] as const;
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
  rateX100: z.number().int().positive().max(100_000_000).optional()
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

const IMPORTERS: Record<ImportKind, Importer> = {
  customers: importParties('customer'),
  suppliers: importParties('supplier'),
  items: importItems,
  opening_stock: importOpeningStock,
  opening_balances: importOpeningBalances
};

/* ---------- routes ---------- */

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const idParam = z.object({ id: z.string().min(1).max(64) });

/**
 * Pictures: anyone signed in sees them; changing one needs the stock permission. Importing needs an admin (it isn't
 * listed in rules, so the app's own rule applies).
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
      }
    ];
  }
};

