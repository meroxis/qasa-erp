import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  applyOffers, minutesOf, offerActive, offerLineRows, offerRuleErrors, orderRules, roundHalfUp, toBase, todayIso,
  type CurrencyCode, type Names, type OfferKind, type OfferResult, type OfferRule
} from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { planStatus } from './license.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Offers (1.7, Starter and up; core/offers.ts works them out). A sale made at the till or on the invoice screen gets
 * the offers that are on for it by itself; the server always works them out again from the offers stored here, so
 * what a till previewed is never taken on trust.
 *
 * The books: a sale is posted at what the customer pays, as with the discount typed on an invoice (Dr safe or customer
 * / Cr sales, the net amount): an offer is a discount on that sale. invoices.discount holds both parts and
 * invoices.offer_discount the offers' part; each line's discount_share has its own offer discount plus its share of
 * the typed one, so reports by item and returns take back exactly what the goods returned were given.
 *
 * Reading offers (and the till's list) is open to every signed-in user; changing them needs an admin; the preview a
 * till or an invoice asks for needs the sales permission.
 */

export const promotionsAvailable = (db: Db): boolean => planStatus(db).features.includes('promotions');

export interface OfferView extends OfferRule {
  active: boolean;
  notes: string;
  /** sales that got it (posted or draft): an offer used once is switched off, never deleted */
  used: number;
  createdAt: string;
  updatedAt: string;
}

interface OfferRow {
  id: string; code: string; name_ar: string; name_en: string; name_ku: string; kind: OfferKind; active: number; priority: number; exclusive: number;
  max_per_sale: number | null; starts_on: string | null; ends_on: string | null; weekdays: string | null; from_time: string | null; to_time: string | null;
  branch_ids: string | null; items: string; categories: string; get_items: string; get_categories: string;
  buy_milli: number | null; get_milli: number | null; get_percent: number | null; bundle_milli: number | null; bundle_price: number | null;
  price: number | null; percent_off: number | null; notes: string | null; created_at: string; updated_at: string;
}

const list = (json: string | null): string[] => {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const num = (v: number | null) => (v === null || v === undefined ? null : Number(v));

function toRule(r: OfferRow): OfferRule {
  return {
    id: r.id, code: r.code, names: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, kind: r.kind, priority: Number(r.priority), exclusive: r.exclusive === 1,
    maxPerSale: num(r.max_per_sale), startsOn: r.starts_on, endsOn: r.ends_on,
    weekdays: r.weekdays ? r.weekdays.split(',').map(Number) : null, fromTime: r.from_time, toTime: r.to_time,
    branchIds: r.branch_ids ? list(r.branch_ids) : null,
    items: list(r.items), categories: list(r.categories), getItems: list(r.get_items), getCategories: list(r.get_categories),
    buyMilli: num(r.buy_milli), getMilli: num(r.get_milli), getPercent: num(r.get_percent), bundleMilli: num(r.bundle_milli), bundlePrice: num(r.bundle_price),
    price: num(r.price), percentOff: num(r.percent_off)
  };
}

function usedCounts(db: Db): Map<string, number> {
  const rows = db.prepare('SELECT offer_id, COUNT(DISTINCT invoice_id) AS n FROM invoice_offer_lines GROUP BY offer_id').all() as { offer_id: string; n: number }[];
  return new Map(rows.map((r) => [r.offer_id, Number(r.n)]));
}

function toView(r: OfferRow, used: number): OfferView {
  return { ...toRule(r), active: r.active === 1, notes: r.notes ?? '', used, createdAt: r.created_at, updatedAt: r.updated_at };
}

export function listOffers(db: Db): OfferView[] {
  const used = usedCounts(db);
  return (db.prepare('SELECT * FROM offers ORDER BY active DESC, priority DESC, code').all() as unknown as OfferRow[]).map((r) => toView(r, used.get(r.id) ?? 0));
}

function loadRow(db: Db, id: string): OfferRow {
  const row = db.prepare('SELECT * FROM offers WHERE id = ?').get(id) as unknown as OfferRow | undefined;
  if (!row) throw notFound('offer');
  return row;
}

export function getOffer(db: Db, id: string): OfferView {
  return toView(loadRow(db, id), usedCounts(db).get(id) ?? 0);
}

export type OfferInput = Omit<OfferRule, 'id'> & { notes?: string | undefined; active?: boolean | undefined };

function requirePlan(db: Db): void {
  if (!promotionsAvailable(db)) throw conflict('plan_limit', { limit: 'promotions' });
}

function assertOffer(db: Db, input: OfferInput, id: string | null): void {
  const errors: { code: string; field?: string; id?: string }[] = offerRuleErrors(input);
  const clash = db.prepare('SELECT id FROM offers WHERE code = ?').get(input.code) as { id: string } | undefined;
  if (clash && clash.id !== id) errors.push({ code: 'offer_code_taken', field: 'code' });
  const exists = (sql: string, ids: readonly string[], field: string) => {
    const q = db.prepare(sql);
    for (const x of ids) if (!q.get(x)) errors.push({ code: 'offer_target_invalid', field, id: x });
  };
  exists('SELECT 1 FROM items WHERE id = ?', [...input.items, ...input.getItems], 'items');
  exists('SELECT 1 FROM item_categories WHERE id = ?', [...input.categories, ...input.getCategories], 'categories');
  if (input.branchIds) exists('SELECT 1 FROM branches WHERE id = ?', input.branchIds, 'branchIds');
  if (errors.length) throw invalid(errors);
}

function columns(input: OfferInput): (string | number | null)[] {
  const ids = (v: readonly string[]) => JSON.stringify([...new Set(v)]);
  return [
    input.code.trim(), input.names.ar.trim(), input.names.en.trim(), input.names.ku.trim(), input.kind, input.priority, input.exclusive ? 1 : 0, input.maxPerSale,
    input.startsOn, input.endsOn, input.weekdays ? [...new Set(input.weekdays)].sort().join(',') : null, input.fromTime, input.toTime,
    input.branchIds && input.branchIds.length ? ids(input.branchIds) : null,
    ids(input.items), ids(input.categories), ids(input.kind === 'buyGet' ? input.getItems : []), ids(input.kind === 'buyGet' ? input.getCategories : []),
    input.kind === 'buyGet' ? input.buyMilli : null, input.kind === 'buyGet' ? input.getMilli : null, input.kind === 'buyGet' ? input.getPercent : null,
    input.kind === 'bundle' ? input.bundleMilli : null, input.kind === 'bundle' ? input.bundlePrice : null,
    input.kind === 'price' ? input.price : null, input.kind === 'price' ? input.percentOff : null,
    input.notes?.trim() || null
  ];
}

const COLUMNS = `code, name_ar, name_en, name_ku, kind, priority, exclusive, max_per_sale, starts_on, ends_on, weekdays, from_time, to_time, branch_ids,
  items, categories, get_items, get_categories, buy_milli, get_milli, get_percent, bundle_milli, bundle_price, price, percent_off, notes`;

export function createOffer(db: Db, input: OfferInput, user: string): OfferView {
  requirePlan(db);
  assertOffer(db, input, null);
  const id = randomUUID();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO offers (id, ${COLUMNS}, active, created_by, created_at, updated_at) VALUES (?, ${Array(26).fill('?').join(', ')}, ?, ?, ?, ?)`)
      .run(id, ...columns(input), input.active === false ? 0 : 1, user, now, now);
    audit(db, user, 'create', 'offer', id, { code: input.code, kind: input.kind });
  });
  return getOffer(db, id);
}

/**
 * Changes an offer. Sales already made keep what they got (their own rows); a draft gets the offer as it now is when
 * it is saved or posted again.
 */
export function updateOffer(db: Db, id: string, input: OfferInput, user: string): OfferView {
  loadRow(db, id);
  requirePlan(db);
  assertOffer(db, input, id);
  const sets = COLUMNS.split(',').map((c) => `${c.trim()} = ?`).join(', ');
  transaction(db, () => {
    db.prepare(`UPDATE offers SET ${sets}, active = ?, updated_at = ? WHERE id = ?`)
      .run(...columns(input), input.active === false ? 0 : 1, new Date().toISOString(), id);
    audit(db, user, 'update', 'offer', id, { code: input.code });
  });
  return getOffer(db, id);
}

/** Switching an offer on needs the plan; switching it off never does. */
export function setOfferActive(db: Db, id: string, active: boolean, user: string): OfferView {
  loadRow(db, id);
  if (active) requirePlan(db);
  db.prepare('UPDATE offers SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, new Date().toISOString(), id);
  audit(db, user, active ? 'activate' : 'deactivate', 'offer', id);
  return getOffer(db, id);
}

/** Only an offer no sale has got is deleted; one that has stays (switched off) for the report. */
export function deleteOffer(db: Db, id: string, user: string): void {
  loadRow(db, id);
  if (db.prepare('SELECT 1 FROM invoice_offer_lines WHERE offer_id = ?').get(id)) throw conflict('offer_used');
  db.prepare('DELETE FROM offers WHERE id = ?').run(id);
  audit(db, user, 'delete', 'offer', id);
}

/** Every offer switched on (the plan has them), as the engine reads them. */
export function activeRules(db: Db): OfferRule[] {
  if (!promotionsAvailable(db)) return [];
  return (db.prepare('SELECT * FROM offers WHERE active = 1').all() as unknown as OfferRow[]).map(toRule);
}

export function branchOfWarehouse(db: Db, warehouseId: string): string | null {
  return (db.prepare('SELECT branch_id FROM branch_warehouses WHERE warehouse_id = ?').get(warehouseId) as { branch_id: string } | undefined)?.branch_id ?? null;
}

/**
 * The offers a till selling from `warehouseId` works with (its offline preview too): those switched on that have not
 * ended and fit its branch, in the order they are tried. The branch is settled here, so the till's copy has none.
 */
export function tillOffers(db: Db, warehouseId: string | null, today = todayIso()): OfferRule[] {
  const branchId = warehouseId ? branchOfWarehouse(db, warehouseId) : null;
  return orderRules(activeRules(db)
    .filter((r) => !r.endsOn || r.endsOn >= today)
    .filter((r) => !r.branchIds?.length || (!!branchId && r.branchIds.includes(branchId)))
    .map((r) => ({ ...r, branchIds: null })));
}

export interface SaleOfferLine { itemId: string; qtyMilli: number; amount: number }

/**
 * Works out the offers a sale gets. `at`: when it is sold (hours count only when that moment is on the sale's date;
 * a back-dated invoice gets no offer limited to hours).
 */
export function saleOffers(
  db: Db, sale: { date: string; warehouseId: string; currency: CurrencyCode; rateX100: number; lines: readonly SaleOfferLine[] }, at: Date,
  /** the day whose offers these are, when not the sale's own date (a delivery order delivered on a later day) */
  on?: string
): OfferResult {
  const rules = activeRules(db);
  if (!rules.length || !sale.lines.length) return { allocations: [], byLine: {}, offers: [], total: 0 };
  const category = db.prepare('SELECT category_id FROM items WHERE id = ?');
  const lines = sale.lines.map((l, i) => ({
    lineNo: i + 1, itemId: l.itemId, qtyMilli: l.qtyMilli, amount: l.amount,
    categoryId: (category.get(l.itemId) as { category_id: string | null } | undefined)?.category_id ?? null
  }));
  return applyOffers(lines, rules, {
    date: on ?? sale.date, minutes: todayIso(at) === (on ?? sale.date) ? minutesOf(at) : null, branchId: branchOfWarehouse(db, sale.warehouseId),
    currency: sale.currency, rateX100: sale.currency === 'IQD' ? 100 : sale.rateX100
  });
}

/** Keeps what a draft sale got (its rows are written again with each save). */
export function writeOfferLines(db: Db, invoiceId: string, result: OfferResult): void {
  db.prepare('DELETE FROM invoice_offer_lines WHERE invoice_id = ?').run(invoiceId);
  const insert = db.prepare('INSERT INTO invoice_offer_lines (invoice_id, line_no, offer_id, qty_milli, discount) VALUES (?, ?, ?, ?, ?)');
  for (const r of offerLineRows(result)) insert.run(invoiceId, r.lineNo, r.offerId, r.qtyMilli, r.discount);
}

export interface InvoiceOfferView { offerId: string; code: string; names: Names; discount: number; lines: { lineNo: number; qtyMilli: number; discount: number }[] }

/** The offers an invoice got, with what each gave (for the invoice page, the receipt and the till). */
export function invoiceOffers(db: Db, invoiceId: string): InvoiceOfferView[] {
  const rows = db.prepare(`SELECT l.offer_id, l.line_no, l.qty_milli, l.discount, o.code, o.name_ar, o.name_en, o.name_ku FROM invoice_offer_lines l
                           JOIN offers o ON o.id = l.offer_id WHERE l.invoice_id = ? ORDER BY o.priority DESC, o.code, l.line_no`).all(invoiceId) as {
    offer_id: string; line_no: number; qty_milli: number; discount: number; code: string; name_ar: string; name_en: string; name_ku: string;
  }[];
  const out = new Map<string, InvoiceOfferView>();
  for (const r of rows) {
    const v = out.get(r.offer_id) ?? { offerId: r.offer_id, code: r.code, names: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, discount: 0, lines: [] };
    v.discount += Number(r.discount);
    v.lines.push({ lineNo: Number(r.line_no), qtyMilli: Number(r.qty_milli), discount: Number(r.discount) });
    out.set(r.offer_id, v);
  }
  return [...out.values()].filter((v) => v.discount > 0);
}

export interface OfferReportRow {
  offerId: string; code: string; names: Names; kind: OfferKind; active: boolean;
  /** posted sales that got it */
  sales: number;
  given: number;
  /** what returns of those sales took back */
  returned: number;
  net: number;
}

/**
 * The discount each offer gave on posted sales dated `from`–`to` (in dinars), less what returns of those sales took
 * back (each returned line gives back its offer discount in proportion to the quantity returned).
 */
export function offersReport(db: Db, from: string, to: string): { from: string; to: string; rows: OfferReportRow[]; total: number } {
  const lines = db.prepare(`SELECT ol.invoice_id, ol.line_no, ol.offer_id, ol.discount, il.qty_milli, i.currency, i.rate_x100
                            FROM invoice_offer_lines ol JOIN invoices i ON i.id = ol.invoice_id
                            JOIN invoice_lines il ON il.invoice_id = ol.invoice_id AND il.line_no = ol.line_no
                            WHERE i.kind = 'sale' AND i.status = 'posted' AND i.date >= ? AND i.date <= ? AND ol.discount > 0`).all(from, to) as {
    invoice_id: string; line_no: number; offer_id: string; discount: number; qty_milli: number; currency: CurrencyCode; rate_x100: number;
  }[];
  const returned = new Map<string, number>();
  for (const r of db.prepare(`SELECT r.return_of, rl.source_line, SUM(rl.qty_milli) AS qty FROM invoices r JOIN invoice_lines rl ON rl.invoice_id = r.id
                              JOIN invoices s ON s.id = r.return_of
                              WHERE r.kind = 'sale_return' AND r.status = 'posted' AND s.date >= ? AND s.date <= ? GROUP BY r.return_of, rl.source_line`)
    .all(from, to) as { return_of: string; source_line: number; qty: number }[]) returned.set(`${r.return_of}|${r.source_line}`, Number(r.qty));
  const iqd = (v: number, currency: CurrencyCode, rate: number) => toBase(v, currency, rate);
  const by = new Map<string, { sales: Set<string>; given: number; returned: number }>();
  for (const l of lines) {
    const row = by.get(l.offer_id) ?? { sales: new Set<string>(), given: 0, returned: 0 };
    row.sales.add(l.invoice_id);
    row.given += iqd(Number(l.discount), l.currency, Number(l.rate_x100));
    const back = returned.get(`${l.invoice_id}|${l.line_no}`) ?? 0;
    if (back > 0) row.returned += iqd(roundHalfUp((Number(l.discount) * Math.min(back, Number(l.qty_milli))) / Number(l.qty_milli)), l.currency, Number(l.rate_x100));
    by.set(l.offer_id, row);
  }
  const rows: OfferReportRow[] = [];
  for (const [offerId, v] of by) {
    const o = toRule(loadRow(db, offerId));
    const active = (db.prepare('SELECT active FROM offers WHERE id = ?').get(offerId) as { active: number }).active === 1;
    rows.push({ offerId, code: o.code, names: o.names, kind: o.kind, active, sales: v.sales.size, given: v.given, returned: v.returned, net: v.given - v.returned });
  }
  rows.sort((a, b) => b.net - a.net || a.code.localeCompare(b.code));
  return { from, to, rows, total: rows.reduce((s, r) => s + r.net, 0) };
}

// ——— the API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);
const idParam = z.object({ id });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ids = z.array(id).max(500);
const qty = z.number().int().positive().max(1_000_000_000);
const offerSchema = z.object({
  code: z.string().min(1).max(24),
  names: z.object({ ar: z.string().max(120), en: z.string().max(120), ku: z.string().max(120) }),
  kind: z.enum(['buyGet', 'bundle', 'price']),
  priority: z.number().int().min(0).max(1000).default(0),
  exclusive: z.boolean().default(false),
  maxPerSale: z.number().int().positive().max(100_000_000).nullable().default(null),
  startsOn: isoDate.nullable().default(null),
  endsOn: isoDate.nullable().default(null),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).nullable().default(null),
  fromTime: z.string().max(5).nullable().default(null),
  toTime: z.string().max(5).nullable().default(null),
  branchIds: ids.nullable().default(null),
  items: ids.default([]),
  categories: ids.default([]),
  getItems: ids.default([]),
  getCategories: ids.default([]),
  buyMilli: qty.nullable().default(null),
  getMilli: qty.nullable().default(null),
  getPercent: z.number().int().min(1).max(100).nullable().default(null),
  bundleMilli: qty.nullable().default(null),
  bundlePrice: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().default(null),
  price: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().default(null),
  percentOff: z.number().int().min(1).max(100).nullable().default(null),
  notes: z.string().max(1000).optional(),
  active: z.boolean().optional()
});
const previewSchema = z.object({
  date: isoDate.optional(),
  warehouseId: id,
  currency: z.enum(['IQD', 'USD']),
  rateX100: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  lines: z.array(z.object({ itemId: id, qtyMilli: qty, amount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })).max(500)
});

export const offersApi: ApiExtension = {
  rules: {
    'POST /api/offers/preview': 'sales'
  },
  routes(db, { actorOf }) {
    const user = (req: ApiRequest) => actorOf(req).name;
    return [
      { method: 'GET', path: '/api/offers', handler: async () => ({ available: promotionsAvailable(db), offers: listOffers(db) }) },
      {
        method: 'GET', path: '/api/offers/till',
        handler: async (req) => ({ offers: tillOffers(db, parse(z.object({ warehouseId: id.optional() }), req.query ?? {}).warehouseId ?? null) })
      },
      {
        method: 'GET', path: '/api/offers/report',
        handler: async (req) => {
          const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional() }), req.query ?? {});
          const to = q.to ?? todayIso();
          return offersReport(db, q.from ?? `${to.slice(0, 7)}-01`, to);
        }
      },
      {
        method: 'POST', path: '/api/offers/preview',
        handler: async (req) => {
          const b = parse(previewSchema, req.body ?? {});
          if (b.currency === 'USD' && !b.rateX100) throw invalid([{ code: 'rate_invalid' }]);
          const result = saleOffers(db, { date: b.date ?? todayIso(), warehouseId: b.warehouseId, currency: b.currency, rateX100: b.rateX100 ?? 100, lines: b.lines }, new Date());
          return { total: result.total, byLine: result.byLine, offers: result.offers, rows: offerLineRows(result) };
        }
      },
      { method: 'GET', path: '/api/offers/:id', handler: async (req) => getOffer(db, parse(idParam, req.params).id) },
      {
        method: 'POST', path: '/api/offers',
        handler: async (req, reply) => { reply.status(201).send(createOffer(db, parse(offerSchema, req.body ?? {}) as OfferInput, user(req))); return undefined; }
      },
      { method: 'PUT', path: '/api/offers/:id', handler: async (req) => updateOffer(db, parse(idParam, req.params).id, parse(offerSchema, req.body ?? {}) as OfferInput, user(req)) },
      {
        method: 'POST', path: '/api/offers/:id/active',
        handler: async (req) => setOfferActive(db, parse(idParam, req.params).id, parse(z.object({ active: z.boolean() }), req.body ?? {}).active, user(req))
      },
      {
        method: 'DELETE', path: '/api/offers/:id',
        handler: async (req, reply) => { deleteOffer(db, parse(idParam, req.params).id, user(req)); reply.status(204).send(); return undefined; }
      }
    ];
  }
};

/** Whether an offer is on at a moment (for the offers page's "on now" badge). */
export function offerOnNow(rule: OfferRule, now: Date = new Date()): boolean {
  return offerActive({ ...rule, branchIds: null }, { date: todayIso(now), minutes: minutesOf(now), branchId: null });
}
