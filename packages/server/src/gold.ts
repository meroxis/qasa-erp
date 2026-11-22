import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  costOut, fineMg, fineToKarat, GOLD_KARATS, goldPiecePrice, goldValue, isIsoDate, makingCharge, toBase, todayIso,
  type CurrencyCode, type EntryInput, type GoldKarat, type MakingKind, type Names
} from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { loadAccounts } from './accounts.ts';
import { planStatus } from './license.ts';
import { isPeriodLocked, readSetting } from './settings.ts';
import { assertValid, insertEntry, nextNumber, reverseEntryInternal } from './journal.ts';
import { addStockMove, stockOf } from './items.ts';
import { seesBooks, type Actor } from './auth.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';
import { onceOnly } from './idempotency.ts';
import { featureAccount } from './feature-accounts.ts';

/**
 * Gold and jewellery shops (goldShop; Starter, Pro and Business).
 *
 * - A gold piece is an ordinary item (sold at the till and on invoices like any other) with its gold terms beside it
 *   (gold_items): weight in milligrams, karat (18, 21, 22, 24) and a making charge per gram or per piece.
 * - The day's gold board (gold_prices) keeps a buying and a selling price per gram for each karat, in dinars or dollars.
 *   Saving it prices every gold piece again: sale price = weight × the day's selling price of its karat + making charge,
 *   so the till, invoices, the offline till and labels all sell at the day's price without anything else changing.
 *   The cashier may still change a price (the making charge is often bargained over), as with any item.
 * - Old gold bought from customers (kind 'buy') is kept by karat and weight with its cost (gold_scrap_moves), in an
 *   "old gold" stock account (1378 under 137 (1379 is the petrol station's fuel stock), goods held for sale; made the first time it is needed): Dr old gold /
 *   Cr the safe. Melting (kind 'melt') turns a weight of one karat into a weight of another (refined, or lost in the
 *   fire): the cost moves with it, so only the cost per gram changes; there is no entry.
 * - Suppliers who are settled in gold: pieces received from them (kind 'receipt') come into stock at their gold value
 *   (the pure gold in them at the 24 karat price used for the receipt) plus the making charge in money. Dr the
 *   warehouse / Cr the supplier (the making charge, paid in money as usual) and Cr gold owed to suppliers (264 under
 *   26, creditors) for the gold. Each supplier's gold balance is kept in pure gold (gold_supplier_moves) and shown in
 *   the karat it is settled in (21 or 24). Old gold handed to a supplier (kind 'delivery') settles that balance: Dr gold
 *   owed (at what the gold owed is carried at) / Cr old gold (at its cost); the difference is a gain (49, other revenue)
 *   or a loss (39, other expenses).
 *
 * Every document is saved as a draft and posted; posting approves its entry at once, as stock documents do, so with
 * "separate duties" on it is the approver's step and not the preparer's. Cancelling reverses the entry.
 */

export const OLD_GOLD_ACCOUNT = '1378';
export const GOLD_OWED_ACCOUNT = '264';
const OLD_GOLD_NAMES: Names = { ar: 'الذهب الكسر (المستعمل)', en: 'Old gold (scrap)', ku: 'زێڕی شکاو (بەکارهاتوو)' };
const GOLD_OWED_NAMES: Names = { ar: 'ذهب مستحق للمجهزين', en: 'Gold owed to suppliers', ku: 'زێڕی قەرزاری دابینکەران' };

export type GoldDocKind = 'buy' | 'melt' | 'receipt' | 'delivery';
export type GoldDocStatus = 'draft' | 'posted' | 'cancelled';

export const goldAvailable = (db: Db): boolean => planStatus(db).features.includes('goldShop');

function requirePlan(db: Db): void {
  if (!goldAvailable(db)) throw conflict('plan_limit', { limit: 'goldShop' });
}

const nowIso = () => new Date().toISOString();

// ——— accounts ———


export const oldGoldAccount = (db: Db, user: string): string => featureAccount(db, 'oldGold', user, OLD_GOLD_NAMES);
export const goldOwedAccount = (db: Db, user: string): string => featureAccount(db, 'goldOwed', user, GOLD_OWED_NAMES);

function firstPostableUnder(db: Db, root: string): string {
  const a = loadAccounts(db).filter((x) => x.postable && x.code.startsWith(root)).sort((x, y) => x.code.localeCompare(y.code))[0];
  if (!a) throw conflict('gold_account_missing', { code: root });
  return a.code;
}

// ——— the day's board ———

export interface GoldBoardRow { karat: GoldKarat; buyPerGram: number; sellPerGram: number; date: string }

/** The board on a day: for each karat, the latest prices set on or before it (null for a karat never priced). */
export function boardOn(db: Db, date: string, currency: CurrencyCode): Record<GoldKarat, GoldBoardRow | null> {
  const out = {} as Record<GoldKarat, GoldBoardRow | null>;
  for (const karat of GOLD_KARATS) {
    const r = db.prepare('SELECT date, buy_per_gram, sell_per_gram FROM gold_prices WHERE karat = ? AND currency = ? AND date <= ? ORDER BY date DESC LIMIT 1')
      .get(karat, currency, date) as { date: string; buy_per_gram: number; sell_per_gram: number } | undefined;
    out[karat] = r ? { karat, date: r.date, buyPerGram: Number(r.buy_per_gram), sellPerGram: Number(r.sell_per_gram) } : null;
  }
  return out;
}

export function boardHistory(db: Db, currency: CurrencyCode, limit = 60): (GoldBoardRow & { createdBy: string })[] {
  return (db.prepare('SELECT date, karat, buy_per_gram, sell_per_gram, created_by FROM gold_prices WHERE currency = ? ORDER BY date DESC, karat DESC LIMIT ?')
    .all(currency, limit) as Record<string, unknown>[]).map((r) => ({
    karat: Number(r.karat) as GoldKarat, date: String(r.date), buyPerGram: Number(r.buy_per_gram), sellPerGram: Number(r.sell_per_gram), createdBy: String(r.created_by)
  }));
}

export interface BoardInput { date: string; currency: CurrencyCode; prices: { karat: GoldKarat; buyPerGram: number; sellPerGram: number }[] }

/** Sets a day's prices (a karat set again that day is replaced), then prices the gold pieces again. */
export function setBoard(db: Db, input: BoardInput, actor: Actor): { board: Record<GoldKarat, GoldBoardRow | null>; repriced: number } {
  requirePlan(db);
  if (!isIsoDate(input.date)) throw invalid([{ code: 'date_invalid' }]);
  if (!input.prices.length) throw invalid([{ code: 'gold_board_empty' }]);
  const seen = new Set<number>();
  const errors: { code: string; karat?: number }[] = [];
  for (const p of input.prices) {
    if (seen.has(p.karat)) errors.push({ code: 'gold_karat_twice', karat: p.karat });
    seen.add(p.karat);
    if (p.sellPerGram < p.buyPerGram) errors.push({ code: 'gold_sell_below_buy', karat: p.karat });
  }
  if (errors.length) throw invalid(errors);
  let repriced = 0;
  transaction(db, () => {
    for (const p of input.prices) {
      db.prepare('DELETE FROM gold_prices WHERE date = ? AND karat = ? AND currency = ?').run(input.date, p.karat, input.currency);
      db.prepare('INSERT INTO gold_prices (id, date, karat, currency, buy_per_gram, sell_per_gram, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), input.date, p.karat, input.currency, p.buyPerGram, p.sellPerGram, actor.name, nowIso());
    }
    audit(db, actor.name, 'update', 'gold_board', input.date, { currency: input.currency, prices: input.prices });
    repriced = repriceGoldItems(db);
  });
  return { board: boardOn(db, todayIso(), input.currency), repriced };
}

// ——— gold pieces ———

export interface GoldTerms { weightMg: number; karat: GoldKarat; makingKind: MakingKind; makingAmount: number }

export interface GoldItemView extends GoldTerms {
  itemId: string;
  code: string;
  barcode: string | null;
  name: Names;
  currency: CurrencyCode;
  salePrice: number;
  /** the price at today's board (null: its karat has no selling price in its currency yet) */
  boardPrice: number | null;
  onHandMilli: number;
  fineMg: number;
}

interface GoldItemRow { item_id: string; weight_mg: number; karat: number; making_kind: MakingKind; making_amount: number }

export function goldTermsOf(db: Db, itemId: string): GoldTerms | null {
  const r = db.prepare('SELECT item_id, weight_mg, karat, making_kind, making_amount FROM gold_items WHERE item_id = ?').get(itemId) as unknown as GoldItemRow | undefined;
  return r ? { weightMg: Number(r.weight_mg), karat: Number(r.karat) as GoldKarat, makingKind: r.making_kind, makingAmount: Number(r.making_amount) } : null;
}

function boardPriceOf(terms: GoldTerms, board: Record<GoldKarat, GoldBoardRow | null>): number | null {
  const row = board[terms.karat];
  return row ? goldPiecePrice(terms, row.sellPerGram) : null;
}

/** Every gold piece priced at today's board in its own currency; returns how many prices changed. */
export function repriceGoldItems(db: Db, onlyItem?: string): number {
  const today = todayIso();
  const boards: Partial<Record<CurrencyCode, Record<GoldKarat, GoldBoardRow | null>>> = {};
  const rows = db.prepare(`SELECT g.item_id, g.weight_mg, g.karat, g.making_kind, g.making_amount, i.sale_price, i.sale_currency
                           FROM gold_items g JOIN items i ON i.id = g.item_id${onlyItem ? ' WHERE g.item_id = ?' : ''}`)
    .all(...(onlyItem ? [onlyItem] : [])) as Record<string, unknown>[];
  let changed = 0;
  for (const r of rows) {
    const currency = r.sale_currency as CurrencyCode;
    const board = (boards[currency] ??= boardOn(db, today, currency));
    const price = boardPriceOf({ weightMg: Number(r.weight_mg), karat: Number(r.karat) as GoldKarat, makingKind: r.making_kind as MakingKind, makingAmount: Number(r.making_amount) }, board);
    if (price === null || price === Number(r.sale_price)) continue;
    db.prepare('UPDATE items SET sale_price = ?, updated_at = ? WHERE id = ?').run(price, nowIso(), String(r.item_id));
    changed++;
  }
  return changed;
}

const onHandOf = (db: Db, itemId: string): number =>
  Number((db.prepare('SELECT SUM(qty_milli) AS q FROM stock_moves WHERE item_id = ?').get(itemId) as { q: number | null }).q ?? 0);

export function listGoldItems(db: Db, q?: string): GoldItemView[] {
  const board: Partial<Record<CurrencyCode, Record<GoldKarat, GoldBoardRow | null>>> = {};
  const where = q ? ' WHERE LOWER(i.code) LIKE ? OR LOWER(i.name_ar) LIKE ? OR LOWER(i.name_en) LIKE ? OR LOWER(i.name_ku) LIKE ? OR i.barcode = ?' : '';
  const like = `%${(q ?? '').toLowerCase()}%`;
  const rows = db.prepare(`SELECT g.item_id, g.weight_mg, g.karat, g.making_kind, g.making_amount, i.code, i.barcode, i.name_ar, i.name_en, i.name_ku, i.sale_price, i.sale_currency
                           FROM gold_items g JOIN items i ON i.id = g.item_id${where} ORDER BY i.code`)
    .all(...(q ? [like, like, like, like, q] : [])) as Record<string, unknown>[];
  return rows.map((r) => {
    const currency = r.sale_currency as CurrencyCode;
    const terms: GoldTerms = { weightMg: Number(r.weight_mg), karat: Number(r.karat) as GoldKarat, makingKind: r.making_kind as MakingKind, makingAmount: Number(r.making_amount) };
    return {
      itemId: String(r.item_id), code: String(r.code), barcode: (r.barcode as string | null) ?? null,
      name: { ar: String(r.name_ar), en: String(r.name_en), ku: String(r.name_ku) }, currency, salePrice: Number(r.sale_price),
      ...terms, boardPrice: boardPriceOf(terms, (board[currency] ??= boardOn(db, todayIso(), currency))),
      onHandMilli: onHandOf(db, String(r.item_id)), fineMg: fineMg(terms.weightMg, terms.karat)
    };
  });
}

export function getGoldItem(db: Db, itemId: string): GoldItemView {
  const found = listGoldItems(db).find((x) => x.itemId === itemId);
  if (!found) throw notFound('gold_item');
  return found;
}

export function setGoldItem(db: Db, itemId: string, terms: GoldTerms, actor: Actor): GoldItemView {
  requirePlan(db);
  const item = db.prepare('SELECT id, track_stock FROM items WHERE id = ?').get(itemId) as { id: string; track_stock: number } | undefined;
  if (!item) throw notFound('item');
  if (Number(item.track_stock) !== 1) throw invalid([{ code: 'gold_item_not_stocked' }]);
  if (terms.makingKind === 'gram' && terms.makingAmount > 0 && goldValue(terms.weightMg, terms.makingAmount) === 0) throw invalid([{ code: 'gold_making_too_small' }]);
  transaction(db, () => {
    const now = nowIso();
    const had = db.prepare('SELECT 1 FROM gold_items WHERE item_id = ?').get(itemId);
    if (had) {
      db.prepare('UPDATE gold_items SET weight_mg = ?, karat = ?, making_kind = ?, making_amount = ?, updated_at = ? WHERE item_id = ?')
        .run(terms.weightMg, terms.karat, terms.makingKind, terms.makingAmount, now, itemId);
    } else {
      db.prepare('INSERT INTO gold_items (item_id, weight_mg, karat, making_kind, making_amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(itemId, terms.weightMg, terms.karat, terms.makingKind, terms.makingAmount, now, now);
    }
    audit(db, actor.name, had ? 'update' : 'create', 'gold_item', itemId, { ...terms });
    repriceGoldItems(db, itemId);
  });
  return getGoldItem(db, itemId);
}

/** Takes an item's gold terms away (it stays an ordinary item at its last price). Not while a draft receipt lists it. */
export function removeGoldItem(db: Db, itemId: string, actor: Actor): void {
  if (!db.prepare('SELECT 1 FROM gold_items WHERE item_id = ?').get(itemId)) throw notFound('gold_item');
  if (db.prepare("SELECT 1 FROM gold_doc_lines l JOIN gold_docs d ON d.id = l.doc_id WHERE l.item_id = ? AND d.status = 'draft'").get(itemId)) throw conflict('gold_item_in_draft');
  transaction(db, () => {
    db.prepare('DELETE FROM gold_items WHERE item_id = ?').run(itemId);
    audit(db, actor.name, 'delete', 'gold_item', itemId);
  });
}

// ——— old gold and suppliers' gold ———

export interface ScrapStock { karat: GoldKarat; weightMg: number; value: number }

export function scrapOf(db: Db, karat: number): { weightMg: number; value: number } {
  const r = db.prepare('SELECT SUM(weight_mg) AS w, SUM(value) AS v FROM gold_scrap_moves WHERE karat = ?').get(karat) as { w: number | null; v: number | null };
  return { weightMg: Number(r.w ?? 0), value: Number(r.v ?? 0) };
}

export function scrapStock(db: Db): ScrapStock[] {
  return GOLD_KARATS.map((karat) => ({ karat, ...scrapOf(db, karat) }));
}

function writeScrap(db: Db, m: { date: string; karat: number; weightMg: number; value: number; sourceType: string; sourceId: string }): void {
  db.prepare('INSERT INTO gold_scrap_moves (id, date, karat, weight_mg, value, source_type, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), m.date, m.karat, m.weightMg, m.value, m.sourceType, m.sourceId, nowIso());
}

export function supplierGold(db: Db, partyId: string): { fineMg: number; value: number } {
  const r = db.prepare('SELECT SUM(fine_mg) AS f, SUM(value) AS v FROM gold_supplier_moves WHERE party_id = ?').get(partyId) as { f: number | null; v: number | null };
  return { fineMg: Number(r.f ?? 0), value: Number(r.v ?? 0) };
}

function writeSupplierGold(db: Db, m: { partyId: string; date: string; fineMg: number; value: number; sourceType: string; sourceId: string }): void {
  db.prepare('INSERT INTO gold_supplier_moves (id, party_id, date, fine_mg, value, source_type, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), m.partyId, m.date, m.fineMg, m.value, m.sourceType, m.sourceId, nowIso());
}

export const basisKaratOf = (db: Db, partyId: string): 21 | 24 =>
  Number((db.prepare('SELECT basis_karat FROM gold_suppliers WHERE party_id = ?').get(partyId) as { basis_karat: number } | undefined)?.basis_karat ?? 21) === 24 ? 24 : 21;

function supplierRow(db: Db, id: string): { id: string; name: string; account_code: string } {
  const r = db.prepare("SELECT id, name, account_code FROM parties WHERE id = ? AND type = 'supplier'").get(id) as { id: string; name: string; account_code: string } | undefined;
  if (!r) throw invalid([{ code: 'supplier_not_found' }]);
  return r;
}

export function setSupplierBasis(db: Db, partyId: string, basisKarat: 21 | 24, actor: Actor): void {
  requirePlan(db);
  supplierRow(db, partyId);
  transaction(db, () => {
    db.prepare('DELETE FROM gold_suppliers WHERE party_id = ?').run(partyId);
    db.prepare('INSERT INTO gold_suppliers (party_id, basis_karat, updated_at) VALUES (?, ?, ?)').run(partyId, basisKarat, nowIso());
    audit(db, actor.name, 'update', 'gold_supplier', partyId, { basisKarat });
  });
}

export interface GoldSupplierView { partyId: string; name: string; basisKarat: 21 | 24; fineMg: number; basisMg: number; value: number }

export function goldSuppliers(db: Db): GoldSupplierView[] {
  const rows = db.prepare(`SELECT p.id, p.name FROM parties p WHERE p.type = 'supplier' AND (p.id IN (SELECT party_id FROM gold_suppliers) OR p.id IN (SELECT party_id FROM gold_supplier_moves)) ORDER BY p.name`)
    .all() as { id: string; name: string }[];
  return rows.map((r) => {
    const g = supplierGold(db, r.id);
    const basis = basisKaratOf(db, r.id);
    return { partyId: r.id, name: r.name, basisKarat: basis, fineMg: g.fineMg, basisMg: fineToKarat(g.fineMg, basis), value: g.value };
  });
}

export interface GoldSupplierStatementRow { date: string; sourceType: string; number: string | null; fineMg: number; basisMg: number; value: number; balanceBasisMg: number }

export function goldSupplierStatement(db: Db, partyId: string): { supplier: GoldSupplierView; rows: GoldSupplierStatementRow[] } {
  const s = supplierRow(db, partyId);
  const basis = basisKaratOf(db, partyId);
  const moves = db.prepare(`SELECT m.date, m.source_type, m.fine_mg, m.value, d.number FROM gold_supplier_moves m LEFT JOIN gold_docs d ON d.id = m.source_id
                            WHERE m.party_id = ? ORDER BY m.date, m.created_at, m.id`).all(partyId) as Record<string, unknown>[];
  let balance = 0;
  const rows = moves.map((m) => {
    balance += Number(m.fine_mg);
    return {
      date: String(m.date), sourceType: String(m.source_type), number: (m.number as string | null) ?? null, fineMg: Number(m.fine_mg),
      basisMg: fineToKarat(Number(m.fine_mg), basis), value: Number(m.value), balanceBasisMg: fineToKarat(balance, basis)
    };
  });
  const g = supplierGold(db, partyId);
  return { supplier: { partyId, name: s.name, basisKarat: basis, fineMg: g.fineMg, basisMg: fineToKarat(g.fineMg, basis), value: g.value }, rows };
}

// ——— documents ———

export interface GoldDocLineInput { itemId: string; making?: number | undefined }

export interface GoldDocInput {
  kind: GoldDocKind;
  date: string;
  partyId?: string | undefined;
  customerName?: string | undefined;
  warehouseId?: string | undefined;
  cashAccount?: string | undefined;
  currency?: CurrencyCode | undefined;
  rateX100?: number | undefined;
  karat?: GoldKarat | undefined;
  weightMg?: number | undefined;
  pricePerGram?: number | undefined;
  karatOut?: GoldKarat | undefined;
  weightOutMg?: number | undefined;
  lines?: GoldDocLineInput[] | undefined;
  notes?: string | undefined;
}

export interface GoldDocLineView { seq: number; itemId: string; code: string; name: Names; weightMg: number; karat: GoldKarat; fineMg: number; making: number; goldValue: number }

export interface GoldDocView {
  id: string;
  kind: GoldDocKind;
  number: string | null;
  date: string;
  status: GoldDocStatus;
  partyId: string | null;
  partyName: string | null;
  customerName: string | null;
  warehouseId: string | null;
  cashAccount: string | null;
  currency: CurrencyCode;
  rateX100: number;
  karat: GoldKarat | null;
  weightMg: number | null;
  pricePerGram: number | null;
  karatOut: GoldKarat | null;
  weightOutMg: number | null;
  /** what the document is worth in its currency: paid for old gold; the pieces' gold and making for a receipt */
  amount: number;
  lines: GoldDocLineView[];
  entryId: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

type DocRow = Record<string, unknown> & { id: string; kind: GoldDocKind; status: GoldDocStatus; date: string; prepared_by_id: string | null };

function loadDoc(db: Db, id: string): DocRow {
  const row = db.prepare('SELECT * FROM gold_docs WHERE id = ?').get(id) as DocRow | undefined;
  if (!row) throw notFound('gold_doc');
  return row;
}

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function getGoldDoc(db: Db, id: string): GoldDocView {
  const r = loadDoc(db, id);
  const lines = (db.prepare(`SELECT l.seq, l.item_id, l.making, i.code, i.name_ar, i.name_en, i.name_ku, g.weight_mg, g.karat
                             FROM gold_doc_lines l JOIN items i ON i.id = l.item_id LEFT JOIN gold_items g ON g.item_id = l.item_id
                             WHERE l.doc_id = ? ORDER BY l.seq`).all(id) as Record<string, unknown>[]).map((l) => {
    const weight = Number(l.weight_mg ?? 0);
    const karat = Number(l.karat ?? 24) as GoldKarat;
    const fine = fineMg(weight, karat);
    return {
      seq: Number(l.seq), itemId: String(l.item_id), code: String(l.code), name: { ar: String(l.name_ar), en: String(l.name_en), ku: String(l.name_ku) },
      weightMg: weight, karat, fineMg: fine, making: Number(l.making), goldValue: r.price_per_gram === null ? 0 : goldValue(fine, Number(r.price_per_gram))
    };
  });
  const kind = r.kind;
  const amount = kind === 'buy' ? goldValue(Number(r.weight_mg ?? 0), Number(r.price_per_gram ?? 0))
    : kind === 'receipt' ? lines.reduce((s, l) => s + l.goldValue + l.making, 0) : 0;
  const party = r.party_id ? (db.prepare('SELECT name FROM parties WHERE id = ?').get(String(r.party_id)) as { name: string } | undefined)?.name ?? null : null;
  return {
    id: r.id, kind, number: (r.number as string | null) ?? null, date: r.date, status: r.status, partyId: (r.party_id as string | null) ?? null, partyName: party,
    customerName: (r.customer_name as string | null) ?? null, warehouseId: (r.warehouse_id as string | null) ?? null, cashAccount: (r.cash_account as string | null) ?? null,
    currency: r.currency as CurrencyCode, rateX100: Number(r.rate_x100), karat: numOrNull(r.karat) as GoldKarat | null, weightMg: numOrNull(r.weight_mg),
    pricePerGram: numOrNull(r.price_per_gram), karatOut: numOrNull(r.karat_out) as GoldKarat | null, weightOutMg: numOrNull(r.weight_out_mg), amount, lines,
    entryId: (r.entry_id as string | null) ?? null, notes: (r.notes as string | null) ?? null, createdBy: String(r.created_by), createdAt: String(r.created_at)
  };
}

export function listGoldDocs(db: Db, f: { kind?: GoldDocKind | undefined; status?: GoldDocStatus | undefined; partyId?: string | undefined; limit?: number | undefined } = {}): GoldDocView[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.kind) { where.push('kind = ?'); params.push(f.kind); }
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  if (f.partyId) { where.push('party_id = ?'); params.push(f.partyId); }
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 1000);
  const ids = db.prepare(`SELECT id FROM gold_docs${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY date DESC, created_at DESC LIMIT ${limit}`).all(...params) as { id: string }[];
  return ids.map((r) => getGoldDoc(db, r.id));
}

const isPostableCash = (db: Db, code: string): boolean => loadAccounts(db).some((a) => a.code === code && a.postable && a.code.startsWith('18'));

/** Checks a document's input by its kind and returns what is kept. */
function checked(db: Db, input: GoldDocInput): GoldDocInput & { currency: CurrencyCode; rateX100: number } {
  const errors: { code: string; field?: string; line?: number }[] = [];
  if (!isIsoDate(input.date)) errors.push({ code: 'date_invalid' });
  const currency: CurrencyCode = input.currency ?? 'IQD';
  if (currency === 'USD' && !input.rateX100) errors.push({ code: 'gold_field_required', field: 'rateX100' });
  const need = (field: keyof GoldDocInput) => { if (input[field] === undefined || input[field] === null || input[field] === '') errors.push({ code: 'gold_field_required', field }); };
  switch (input.kind) {
    case 'buy':
      need('karat'); need('weightMg'); need('pricePerGram'); need('cashAccount');
      if (!input.partyId && !input.customerName?.trim()) errors.push({ code: 'gold_seller_required' });
      if (input.cashAccount && !isPostableCash(db, input.cashAccount)) errors.push({ code: 'gold_cash_account', field: 'cashAccount' });
      if (input.weightMg && input.pricePerGram !== undefined && goldValue(input.weightMg, input.pricePerGram) <= 0) errors.push({ code: 'gold_amount_zero' });
      break;
    case 'melt':
      need('karat'); need('weightMg'); need('karatOut'); need('weightOutMg');
      if (input.karat && input.weightMg && input.karatOut && input.weightOutMg && fineMg(input.weightOutMg, input.karatOut) > fineMg(input.weightMg, input.karat)) errors.push({ code: 'gold_melt_gains' });
      break;
    case 'receipt': {
      need('partyId'); need('warehouseId'); need('pricePerGram');
      const lines = input.lines ?? [];
      if (!lines.length) errors.push({ code: 'lines_required' });
      const seen = new Set<string>();
      lines.forEach((l, i) => {
        if (seen.has(l.itemId)) errors.push({ code: 'gold_piece_twice', line: i + 1 });
        seen.add(l.itemId);
        if (!goldTermsOf(db, l.itemId)) errors.push({ code: 'gold_not_a_piece', line: i + 1 });
      });
      if (input.warehouseId && !db.prepare('SELECT 1 FROM warehouses WHERE id = ?').get(input.warehouseId)) errors.push({ code: 'warehouse_not_found' });
      break;
    }
    case 'delivery':
      need('partyId'); need('karat'); need('weightMg');
      break;
  }
  if (input.partyId && (input.kind === 'receipt' || input.kind === 'delivery')) {
    if (!db.prepare("SELECT 1 FROM parties WHERE id = ? AND type = 'supplier'").get(input.partyId)) errors.push({ code: 'supplier_not_found' });
  }
  if (input.partyId && input.kind === 'buy' && !db.prepare('SELECT 1 FROM parties WHERE id = ?').get(input.partyId)) errors.push({ code: 'party_not_found' });
  if (errors.length) throw invalid(errors);
  return { ...input, currency, rateX100: currency === 'USD' ? input.rateX100! : 100 };
}

function writeDoc(db: Db, id: string, input: ReturnType<typeof checked>): void {
  db.prepare(`UPDATE gold_docs SET date = ?, party_id = ?, customer_name = ?, warehouse_id = ?, cash_account = ?, currency = ?, rate_x100 = ?, karat = ?, weight_mg = ?,
              price_per_gram = ?, karat_out = ?, weight_out_mg = ?, notes = ?, updated_at = ? WHERE id = ?`)
    .run(input.date, input.partyId ?? null, input.customerName?.trim() || null, input.warehouseId ?? null, input.cashAccount ?? null, input.currency, input.rateX100,
      input.karat ?? null, input.weightMg ?? null, input.pricePerGram ?? null, input.karatOut ?? null, input.weightOutMg ?? null, input.notes?.trim() || null, nowIso(), id);
  db.prepare('DELETE FROM gold_doc_lines WHERE doc_id = ?').run(id);
  (input.kind === 'receipt' ? input.lines ?? [] : []).forEach((l, i) => {
    const terms = goldTermsOf(db, l.itemId)!;
    // the making charge: as typed, else the piece's own (its making per gram works on its weight)
    const making = l.making ?? makingCharge(terms.weightMg, terms.makingKind, terms.makingAmount);
    db.prepare('INSERT INTO gold_doc_lines (doc_id, seq, item_id, making) VALUES (?, ?, ?, ?)').run(id, i + 1, l.itemId, making);
  });
}

export function createGoldDoc(db: Db, raw: GoldDocInput, actor: Actor): GoldDocView {
  requirePlan(db);
  const input = checked(db, raw);
  const id = randomUUID();
  transaction(db, () => {
    const now = nowIso();
    db.prepare(`INSERT INTO gold_docs (id, kind, number, date, status, currency, rate_x100, created_by, prepared_by_id, created_at, updated_at)
                VALUES (?, ?, NULL, ?, 'draft', ?, ?, ?, ?, ?, ?)`).run(id, input.kind, input.date, input.currency, input.rateX100, actor.name, actor.id, now, now);
    writeDoc(db, id, input);
    audit(db, actor.name, 'create', 'gold_doc', id, { kind: input.kind });
  });
  return getGoldDoc(db, id);
}

export function updateGoldDoc(db: Db, id: string, raw: GoldDocInput, actor: Actor): GoldDocView {
  requirePlan(db);
  const row = loadDoc(db, id);
  if (row.status !== 'draft') throw conflict('action_not_allowed', { status: row.status, action: 'edit' });
  const input = checked(db, { ...raw, kind: row.kind });
  transaction(db, () => {
    writeDoc(db, id, input);
    // whoever changed the draft last is its preparer (as on a voucher, a stock adjustment or a consignment document):
    // under "separate duties" an approver can't rewrite someone's draft and post it himself
    db.prepare('UPDATE gold_docs SET prepared_by_id = ? WHERE id = ?').run(actor.id, id);
    audit(db, actor.name, 'update', 'gold_doc', id);
  });
  return getGoldDoc(db, id);
}

export function deleteGoldDoc(db: Db, id: string, actor: Actor): void {
  const row = loadDoc(db, id);
  if (row.status !== 'draft') throw conflict('action_not_allowed', { status: row.status, action: 'delete' });
  transaction(db, () => {
    db.prepare('DELETE FROM gold_docs WHERE id = ?').run(id);
    audit(db, actor.name, 'delete', 'gold_doc', id);
  });
}

/** With "separate duties" on, posting (which approves its entry at once) is the approver's step, not the preparer's. */
function assertMayPost(db: Db, row: DocRow, actor: Actor): void {
  if (readSetting(db, 'separate_duties') !== '1') return;
  if (!actor.permissions.includes('entries.approve')) throw new AppError(403, 'forbidden', { need: 'entries.approve' });
  if (actor.id && row.prepared_by_id === actor.id) throw conflict('same_person');
}

function insertApproved(db: Db, entry: EntryInput, user: string): string {
  assertValid(db, entry);
  const entryId = insertEntry(db, entry, user, null);
  const now = nowIso();
  db.prepare(`UPDATE entries SET status = 'approved', number = ?, checked_by = ?, checked_at = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`)
    .run(nextNumber(db, 'journal', entry.date), user, now, user, now, now, entryId);
  return entryId;
}

export type GoldLang = 'ar' | 'en' | 'ku';
const DOC_WORDS: Record<GoldLang, Record<GoldDocKind, string>> = {
  ar: { buy: 'شراء ذهب كسر', melt: 'صهر ذهب', receipt: 'استلام مصوغات من مجهز', delivery: 'تسليم ذهب لمجهز' },
  en: { buy: 'Old gold bought', melt: 'Gold melted', receipt: 'Pieces received from a supplier', delivery: 'Gold handed to a supplier' },
  ku: { buy: 'کڕینی زێڕی شکاو', melt: 'تواندنەوەی زێڕ', receipt: 'وەرگرتنی خشڵ لە دابینکەر', delivery: 'ڕادەستکردنی زێڕ بە دابینکەر' }
};
const PREFIX: Record<GoldDocKind, string> = { buy: 'GB', melt: 'GM', receipt: 'GR', delivery: 'GD' };

const warehouseAccount = (db: Db, warehouseId: string): string =>
  (db.prepare('SELECT account_code FROM warehouses WHERE id = ?').get(warehouseId) as { account_code: string }).account_code;

export function postGoldDoc(db: Db, id: string, actor: Actor, lang: GoldLang = 'ar'): GoldDocView {
  requirePlan(db);
  const row = loadDoc(db, id);
  if (row.status !== 'draft') throw conflict('action_not_allowed', { status: row.status, action: 'post' });
  assertMayPost(db, row, actor);
  const doc = getGoldDoc(db, id);
  checked(db, { ...doc, partyId: doc.partyId ?? undefined, customerName: doc.customerName ?? undefined, warehouseId: doc.warehouseId ?? undefined, cashAccount: doc.cashAccount ?? undefined,
    karat: doc.karat ?? undefined, weightMg: doc.weightMg ?? undefined, pricePerGram: doc.pricePerGram ?? undefined, karatOut: doc.karatOut ?? undefined, weightOutMg: doc.weightOutMg ?? undefined,
    lines: doc.lines.map((l) => ({ itemId: l.itemId, making: l.making })), notes: doc.notes ?? undefined });
  if (isPeriodLocked(db, doc.date)) throw invalid([{ code: 'period_locked', period: doc.date.slice(0, 7) }]);
  const who = doc.partyName ?? doc.customerName ?? '';
  const sourceType = `gold_${doc.kind}`;

  transaction(db, () => {
    const number = `${PREFIX[doc.kind]}-${doc.date.slice(0, 4)}-${String(nextSequence(db, `gold_${doc.kind}:${doc.date.slice(0, 4)}`)).padStart(4, '0')}`;
    const description = `${number} · ${DOC_WORDS[lang][doc.kind]}${who ? ` · ${who}` : ''}${doc.notes ? ` · ${doc.notes}` : ''}`.slice(0, 300);
    let entryId: string | null = null;
    switch (doc.kind) {
      case 'buy': {
        // Dr old gold / Cr the safe, in the document's currency; the old gold is carried at its value in dinars
        const amount = doc.amount;
        const value = toBase(amount, doc.currency, doc.rateX100);
        const scrap = oldGoldAccount(db, actor.name);
        entryId = insertApproved(db, {
          type: 'journal', date: doc.date, currency: doc.currency, rateX100: doc.rateX100, description, ...(who ? { party: who } : {}),
          lines: [{ accountCode: scrap, debit: amount, credit: 0, description }, { accountCode: doc.cashAccount!, debit: 0, credit: amount, description }]
        } as EntryInput, actor.name);
        writeScrap(db, { date: doc.date, karat: doc.karat!, weightMg: doc.weightMg!, value, sourceType, sourceId: id });
        break;
      }
      case 'melt': {
        const s = scrapOf(db, doc.karat!);
        if (s.weightMg < doc.weightMg!) throw invalid([{ code: 'gold_scrap_short', karat: doc.karat, available: Math.max(0, s.weightMg) }]);
        const value = costOut(s.weightMg, s.value, doc.weightMg!);
        writeScrap(db, { date: doc.date, karat: doc.karat!, weightMg: -doc.weightMg!, value: -value, sourceType, sourceId: id });
        writeScrap(db, { date: doc.date, karat: doc.karatOut!, weightMg: doc.weightOutMg!, value, sourceType, sourceId: id });
        break;
      }
      case 'receipt': {
        const supplier = supplierRow(db, doc.partyId!);
        const owed = goldOwedAccount(db, actor.name);
        const gold = doc.lines.reduce((s, l) => s + l.goldValue, 0);
        const making = doc.lines.reduce((s, l) => s + l.making, 0);
        const total = gold + making;
        const stockAccount = warehouseAccount(db, doc.warehouseId!);
        if (total > 0) {
          const lines: EntryInput['lines'] = [{ accountCode: stockAccount, debit: total, credit: 0, description }];
          // the supplier's line names the supplier, so their statement and balance show what is owed for the making
          if (making > 0) lines.push({ accountCode: supplier.account_code, debit: 0, credit: making, description, partyId: supplier.id });
          if (gold > 0) lines.push({ accountCode: owed, debit: 0, credit: gold, description });
          entryId = insertApproved(db, { type: 'journal', date: doc.date, currency: doc.currency, rateX100: doc.rateX100, description, party: supplier.name, lines } as EntryInput, actor.name);
        }
        // each piece into stock at its gold value and making, in dinars (the cents rounded so they add up to the entry)
        const values = doc.lines.map((l) => toBase(l.goldValue + l.making, doc.currency, doc.rateX100));
        const diff = toBase(total, doc.currency, doc.rateX100) - values.reduce((s, v) => s + v, 0);
        if (values.length) values[values.length - 1]! += diff;
        doc.lines.forEach((l, i) => addStockMove(db, { itemId: l.itemId, warehouseId: doc.warehouseId!, date: doc.date, qtyMilli: 1000, value: values[i]!, sourceType, sourceId: id }));
        const fine = doc.lines.reduce((s, l) => s + l.fineMg, 0);
        writeSupplierGold(db, { partyId: supplier.id, date: doc.date, fineMg: fine, value: toBase(gold, doc.currency, doc.rateX100), sourceType, sourceId: id });
        break;
      }
      case 'delivery': {
        const supplier = supplierRow(db, doc.partyId!);
        const s = scrapOf(db, doc.karat!);
        if (s.weightMg < doc.weightMg!) throw invalid([{ code: 'gold_scrap_short', karat: doc.karat, available: Math.max(0, s.weightMg) }]);
        const fine = fineMg(doc.weightMg!, doc.karat!);
        const g = supplierGold(db, supplier.id);
        if (fine > g.fineMg) throw invalid([{ code: 'gold_over_owed', owedMg: Math.max(0, g.fineMg) }]);
        const cost = costOut(s.weightMg, s.value, doc.weightMg!);
        const relief = costOut(g.fineMg, g.value, fine);
        const lines: EntryInput['lines'] = [];
        if (relief > 0) lines.push({ accountCode: goldOwedAccount(db, actor.name), debit: relief, credit: 0, description });
        if (cost > 0) lines.push({ accountCode: oldGoldAccount(db, actor.name), debit: 0, credit: cost, description });
        if (relief > cost) lines.push({ accountCode: firstPostableUnder(db, '49'), debit: 0, credit: relief - cost, description });
        if (cost > relief) lines.push({ accountCode: firstPostableUnder(db, '39'), debit: cost - relief, credit: 0, description });
        if (lines.length > 1) entryId = insertApproved(db, { type: 'journal', date: doc.date, currency: 'IQD', rateX100: 100, description, party: supplier.name, lines } as EntryInput, actor.name);
        writeScrap(db, { date: doc.date, karat: doc.karat!, weightMg: -doc.weightMg!, value: -cost, sourceType, sourceId: id });
        writeSupplierGold(db, { partyId: supplier.id, date: doc.date, fineMg: -fine, value: -relief, sourceType, sourceId: id });
        break;
      }
    }
    db.prepare(`UPDATE gold_docs SET status = 'posted', number = ?, entry_id = ?, updated_at = ? WHERE id = ?`).run(number, entryId, nowIso(), id);
    audit(db, actor.name, 'post', 'gold_doc', id, { number, entryId });
  });
  return getGoldDoc(db, id);
}

/** Cancels a posted document: its entry is reversed and its gold moves undone (what it brought in must still be there). */
export function cancelGoldDoc(db: Db, id: string, actor: Actor, date?: string): GoldDocView {
  const row = loadDoc(db, id);
  if (row.status !== 'posted') throw conflict('action_not_allowed', { status: row.status, action: 'cancel' });
  assertMayPost(db, row, actor);
  const doc = getGoldDoc(db, id);
  const cancelDate = date ?? (todayIso() < doc.date ? doc.date : todayIso());
  if (!isIsoDate(cancelDate)) throw invalid([{ code: 'date_invalid' }]);
  if (cancelDate < doc.date) throw invalid([{ code: 'date_before_document' }]);
  if (isPeriodLocked(db, cancelDate)) throw invalid([{ code: 'period_locked', period: cancelDate.slice(0, 7) }]);
  const sourceType = `gold_${doc.kind}`;
  const scrapMoves = db.prepare('SELECT karat, weight_mg, value FROM gold_scrap_moves WHERE source_type = ? AND source_id = ?').all(sourceType, id) as { karat: number; weight_mg: number; value: number }[];
  const supplierMoves = db.prepare('SELECT party_id, fine_mg, value FROM gold_supplier_moves WHERE source_type = ? AND source_id = ?').all(sourceType, id) as { party_id: string; fine_mg: number; value: number }[];
  const stockMoves = db.prepare('SELECT item_id, warehouse_id, qty_milli, value FROM stock_moves WHERE source_type = ? AND source_id = ?').all(sourceType, id) as { item_id: string; warehouse_id: string; qty_milli: number; value: number }[];

  // what came in must still be there: old gold of the karat, the pieces in their warehouse, and the gold still owed
  const errors: { code: string; karat?: number; itemId?: string }[] = [];
  const scrapAfter = new Map<number, { weightMg: number; value: number }>();
  for (const m of scrapMoves) {
    const s = scrapAfter.get(Number(m.karat)) ?? scrapOf(db, Number(m.karat));
    const after = { weightMg: s.weightMg - Number(m.weight_mg), value: s.value - Number(m.value) };
    scrapAfter.set(Number(m.karat), after);
  }
  for (const [karat, s] of scrapAfter) if (s.weightMg < 0 || s.value < 0 || (s.weightMg === 0 && s.value !== 0)) errors.push({ code: 'gold_scrap_used', karat });
  for (const m of stockMoves) {
    const s = stockOf(db, m.item_id, m.warehouse_id);
    if (s.qtyMilli < Number(m.qty_milli) || s.value < Number(m.value)) errors.push({ code: 'gold_piece_sold', itemId: m.item_id });
  }
  for (const m of supplierMoves) {
    const g = supplierGold(db, m.party_id);
    // gold handed over since: undoing the receipt would leave the supplier owed less than nothing, or no gold with value
    // still on the books (accounting review #6): refused, the delivery is cancelled first
    const after = { fineMg: g.fineMg - Number(m.fine_mg), value: g.value - Number(m.value) };
    if (Number(m.fine_mg) > 0 && (g.fineMg < Number(m.fine_mg) || after.value < 0 || (after.fineMg === 0 && after.value !== 0))) errors.push({ code: 'gold_already_settled' });
  }
  if (errors.length) throw invalid(errors);

  transaction(db, () => {
    const reversalId = doc.entryId ? reverseEntryInternal(db, doc.entryId, actor.name, cancelDate) : null;
    for (const m of scrapMoves) writeScrap(db, { date: cancelDate, karat: Number(m.karat), weightMg: -Number(m.weight_mg), value: -Number(m.value), sourceType: `${sourceType}_cancel`, sourceId: id });
    for (const m of supplierMoves) writeSupplierGold(db, { partyId: m.party_id, date: cancelDate, fineMg: -Number(m.fine_mg), value: -Number(m.value), sourceType: `${sourceType}_cancel`, sourceId: id });
    for (const m of stockMoves) addStockMove(db, { itemId: m.item_id, warehouseId: m.warehouse_id, date: cancelDate, qtyMilli: -Number(m.qty_milli), value: -Number(m.value), sourceType: `${sourceType}_cancel`, sourceId: id });
    db.prepare("UPDATE gold_docs SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso(), id);
    audit(db, actor.name, 'cancel', 'gold_doc', id, { reversalId });
  });
  return getGoldDoc(db, id);
}

// ——— reports ———

export interface GoldStockByKarat {
  karat: GoldKarat;
  pieces: number;
  piecesWeightMg: number;
  piecesValue: number;
  scrapWeightMg: number;
  scrapValue: number;
  fineMg: number;
}

/** Gold in the shop by karat: pieces on hand (by their weight) and old gold, with their pure-gold equivalent and cost. */
export function goldStock(db: Db): { byKarat: GoldStockByKarat[]; fineMg: number; value: number } {
  const byKarat = new Map<number, GoldStockByKarat>(GOLD_KARATS.map((k) => [k, { karat: k, pieces: 0, piecesWeightMg: 0, piecesValue: 0, scrapWeightMg: 0, scrapValue: 0, fineMg: 0 }]));
  const pieces = db.prepare(`SELECT g.karat, g.weight_mg, SUM(m.qty_milli) AS q, SUM(m.value) AS v FROM gold_items g JOIN stock_moves m ON m.item_id = g.item_id GROUP BY g.item_id, g.karat, g.weight_mg`)
    .all() as { karat: number; weight_mg: number; q: number; v: number }[];
  for (const p of pieces) {
    const q = Number(p.q ?? 0);
    if (q <= 0) continue;
    const k = byKarat.get(Number(p.karat))!;
    const weight = Math.round((q * Number(p.weight_mg)) / 1000);
    k.pieces += q / 1000;
    k.piecesWeightMg += weight;
    k.piecesValue += Number(p.v ?? 0);
  }
  for (const s of scrapStock(db)) {
    const k = byKarat.get(s.karat)!;
    k.scrapWeightMg = s.weightMg;
    k.scrapValue = s.value;
  }
  const rows = [...byKarat.values()].map((k) => ({ ...k, fineMg: fineMg(k.piecesWeightMg + k.scrapWeightMg, k.karat) }));
  return { byKarat: rows, fineMg: rows.reduce((s, r) => s + r.fineMg, 0), value: rows.reduce((s, r) => s + r.piecesValue + r.scrapValue, 0) };
}

export interface GoldSlipLine { lineNo: number; itemId: string; code: string; name: Names; qtyMilli: number; weightMg: number; karat: GoldKarat; making: number; perGram: number; amount: number }

/** A sale invoice's gold pieces as the customer's slip shows them: weight, karat, the price per gram it came to, making. */
export function goldSlip(db: Db, invoiceId: string): { invoiceId: string; number: string | null; date: string; party: string | null; currency: CurrencyCode; total: number; lines: GoldSlipLine[] } {
  const inv = db.prepare('SELECT i.id, i.number, i.date, i.currency, i.total, p.name AS party FROM invoices i LEFT JOIN parties p ON p.id = i.party_id WHERE i.id = ?').get(invoiceId) as Record<string, unknown> | undefined;
  if (!inv) throw notFound('invoice');
  const lines = (db.prepare(`SELECT l.line_no, l.item_id, l.qty_milli, l.unit_price, l.amount, i.code, i.name_ar, i.name_en, i.name_ku, g.weight_mg, g.karat, g.making_kind, g.making_amount
                             FROM invoice_lines l JOIN items i ON i.id = l.item_id JOIN gold_items g ON g.item_id = l.item_id
                             WHERE l.invoice_id = ? ORDER BY l.line_no`).all(invoiceId) as Record<string, unknown>[]).map((l) => {
    const weight = Number(l.weight_mg);
    const making = makingCharge(weight, l.making_kind as MakingKind, Number(l.making_amount));
    // the price per gram the piece was sold at: its unit price less the making charge, over its weight
    const perGram = weight > 0 ? Math.max(0, Math.round(((Number(l.unit_price) - making) * 1000) / weight)) : 0;
    return {
      lineNo: Number(l.line_no), itemId: String(l.item_id), code: String(l.code), name: { ar: String(l.name_ar), en: String(l.name_en), ku: String(l.name_ku) },
      qtyMilli: Number(l.qty_milli), weightMg: weight, karat: Number(l.karat) as GoldKarat, making, perGram, amount: Number(l.amount)
    };
  });
  return { invoiceId, number: (inv.number as string | null) ?? null, date: String(inv.date), party: (inv.party as string | null) ?? null, currency: inv.currency as CurrencyCode, total: Number(inv.total), lines };
}

// ——— API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);
const idParam = z.object({ id });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().int().nonnegative().max(1e15);
const currency = z.enum(['IQD', 'USD']);
const karat = z.union([z.literal(18), z.literal(21), z.literal(22), z.literal(24)]);
const weight = z.number().int().min(1).max(1e9);
const lang = z.enum(['ar', 'en', 'ku']).optional();
const termsBody = z.object({ weightMg: weight, karat, makingKind: z.enum(['gram', 'piece']), makingAmount: money });
const docBody = z.object({
  kind: z.enum(['buy', 'melt', 'receipt', 'delivery']), date, partyId: id.optional(), customerName: z.string().max(120).optional(), warehouseId: id.optional(),
  cashAccount: z.string().max(32).optional(), currency: currency.optional(), rateX100: z.number().int().positive().max(1e9).optional(), karat: karat.optional(),
  weightMg: weight.optional(), pricePerGram: money.optional(), karatOut: karat.optional(), weightOutMg: weight.optional(),
  lines: z.array(z.object({ itemId: id, making: money.optional() })).max(500).optional(), notes: z.string().max(500).optional()
}).strict();

/** Gold's costs, what was paid and what suppliers are owed are for those who see the books. */
function books(actor: Actor): Actor {
  if (!seesBooks(actor)) throw new AppError(403, 'forbidden', { need: 'purchases' });
  return actor;
}

export const goldApi: ApiExtension = {
  rules: {
    'PUT /api/gold/board': 'sales',
    'PUT /api/gold/items/:id': 'stock',
    'DELETE /api/gold/items/:id': 'stock',
    'PUT /api/gold/suppliers/:id': 'purchases',
    'POST /api/gold/docs': 'purchases',
    'PUT /api/gold/docs/:id': 'purchases',
    'DELETE /api/gold/docs/:id': 'purchases',
    'POST /api/gold/docs/:id/post': 'purchases',
    'POST /api/gold/docs/:id/cancel': 'purchases'
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    return [
      {
        method: 'GET', path: '/api/gold/board',
        handler: async (req) => {
          actor(req);
          const q = parse(z.object({ currency: currency.optional(), date: date.optional() }), req.query);
          const c = q.currency ?? 'IQD';
          return { available: goldAvailable(db), currency: c, date: q.date ?? todayIso(), board: boardOn(db, q.date ?? todayIso(), c), history: boardHistory(db, c) };
        }
      },
      {
        method: 'PUT', path: '/api/gold/board',
        handler: async (req) => setBoard(db, parse(z.object({ date, currency, prices: z.array(z.object({ karat, buyPerGram: money, sellPerGram: money })).min(1).max(4) }), req.body), actor(req))
      },
      {
        method: 'GET', path: '/api/gold/items',
        handler: async (req) => { actor(req); return listGoldItems(db, parse(z.object({ q: z.string().max(100).optional() }), req.query).q); }
      },
      { method: 'GET', path: '/api/gold/items/:id', handler: async (req) => { actor(req); return getGoldItem(db, parse(idParam, req.params).id); } },
      { method: 'PUT', path: '/api/gold/items/:id', handler: async (req) => setGoldItem(db, parse(idParam, req.params).id, parse(termsBody, req.body), actor(req)) },
      {
        method: 'DELETE', path: '/api/gold/items/:id',
        handler: async (req, reply) => { removeGoldItem(db, parse(idParam, req.params).id, actor(req)); reply.status(204).send(); return undefined; }
      },
      { method: 'GET', path: '/api/gold/stock', handler: async (req) => { books(actor(req)); return goldStock(db); } },
      { method: 'GET', path: '/api/gold/suppliers', handler: async (req) => { books(actor(req)); return goldSuppliers(db); } },
      { method: 'GET', path: '/api/gold/suppliers/:id', handler: async (req) => { books(actor(req)); return goldSupplierStatement(db, parse(idParam, req.params).id); } },
      {
        method: 'PUT', path: '/api/gold/suppliers/:id',
        handler: async (req) => {
          const { id: partyId } = parse(idParam, req.params);
          setSupplierBasis(db, partyId, parse(z.object({ basisKarat: z.union([z.literal(21), z.literal(24)]) }), req.body).basisKarat, actor(req));
          return goldSupplierStatement(db, partyId);
        }
      },
      {
        method: 'GET', path: '/api/gold/docs',
        handler: async (req) => {
          books(actor(req));
          const f = parse(z.object({ kind: z.enum(['buy', 'melt', 'receipt', 'delivery']).optional(), status: z.enum(['draft', 'posted', 'cancelled']).optional(), partyId: id.optional(), limit: z.coerce.number().int().min(1).max(1000).optional() }), req.query);
          return listGoldDocs(db, f);
        }
      },
      { method: 'GET', path: '/api/gold/docs/:id', handler: async (req) => { books(actor(req)); return getGoldDoc(db, parse(idParam, req.params).id); } },
      {
        method: 'POST', path: '/api/gold/docs',
        handler: async (req, reply) => {
          const body = parse(docBody, req.body);
          const who = actor(req);
          reply.status(201).send(onceOnly(db, req, reply, who, 'POST /api/gold/docs', () => { const made = createGoldDoc(db, body, who); return { id: made.id, result: made }; }, (d) => getGoldDoc(db, d)));
          return undefined;
        }
      },
      { method: 'PUT', path: '/api/gold/docs/:id', handler: async (req) => updateGoldDoc(db, parse(idParam, req.params).id, parse(docBody, req.body), actor(req)) },
      {
        method: 'DELETE', path: '/api/gold/docs/:id',
        handler: async (req, reply) => { deleteGoldDoc(db, parse(idParam, req.params).id, actor(req)); reply.status(204).send(); return undefined; }
      },
      {
        method: 'POST', path: '/api/gold/docs/:id/post',
        handler: async (req, reply) => {
          const { id: docId } = parse(idParam, req.params);
          const l = parse(z.object({ lang }), req.body ?? {}).lang;
          const who = actor(req);
          return onceOnly(db, req, reply, who, 'POST /api/gold/docs/:id/post', () => { const posted = postGoldDoc(db, docId, who, l); return { id: posted.id, result: posted }; }, (d) => getGoldDoc(db, d));
        }
      },
      {
        method: 'POST', path: '/api/gold/docs/:id/cancel',
        handler: async (req) => cancelGoldDoc(db, parse(idParam, req.params).id, actor(req), parse(z.object({ date: date.optional() }), req.body ?? {}).date)
      },
      {
        method: 'GET', path: '/api/gold/slip/:id',
        handler: async (req) => {
          const who = actor(req);
          if (!['admin', 'sales', 'pos'].some((p) => who.permissions.includes(p as never)) && !seesBooks(who)) throw new AppError(403, 'forbidden', { need: 'sales' });
          return goldSlip(db, parse(idParam, req.params).id);
        }
      }
    ];
  }
};
