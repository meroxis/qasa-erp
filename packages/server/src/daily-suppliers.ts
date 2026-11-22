import { randomUUID } from 'node:crypto';
import { onceOnly } from './idempotency.ts';
import { z } from 'zod';
import { isIsoDate, todayIso, type Names, type UnitCode } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { createInvoice, getInvoice, postInvoice, returnedByLine } from './invoices.ts';
import { createReturn } from './returns.ts';
import { getParty } from './parties.ts';
import { userBranchLists } from './branches.ts';
import type { Actor } from './auth.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Suppliers who deliver every day (bread, milk, yoghurt, eggs; every plan): one quick sheet per supplier and day.
 *
 * - The supplier's usual items are listed (daily_supplier_items, in the shop's order) with what came yesterday (the
 *   last sheet), the agreed cost and how much of what they brought before can still go back.
 * - The person types what came today and what goes back unsold, and saves once:
 *   - what came is an ordinary purchase invoice on the supplier's account (Dr stock / Cr the supplier), posted as the
 *     invoice screen posts one (purchases);
 *   - what goes back is an ordinary purchase return (Dr the supplier / Cr stock) of the supplier's earlier daily
 *     purchases, newest first, as far as each has goods left to return: one return per earlier invoice.
 *   Both or neither: the sheet is one transaction. One sheet per supplier and day, unless the person says the supplier
 *   came again (`again`).
 * - The supplier's running balance is their account's, as on their statement; they are paid with a payment voucher.
 * Undoing a sheet is cancelling its purchase or returns on the invoice screen, as for any purchase.
 */

export interface DailyItemView { itemId: string; code: string; name: Names; unit: UnitCode; sort: number; unitCost: number | null; lastReceivedMilli: number | null; lastReturnedMilli: number | null; returnableMilli: number; lastDate: string | null }
export interface DailySheet { partyId: string; partyName: string; balance: number; date: string; items: DailyItemView[]; doneToday: boolean }

function supplier(db: Db, partyId: string) {
  const p = getParty(db, partyId);
  if (p.type !== 'supplier') throw notFound('party');
  return p;
}

/**
 * What of each item the supplier's earlier daily purchases still hold to return: [invoice, line, qty left], newest
 * first. Only goods still on the shelf go back (2.0 books review #16): what was bought and not returned yet, as far as
 * the warehouse it came into still has of the item — bread that sold is not there to hand back.
 */
function returnable(db: Db, partyId: string, itemId: string, before: string): { invoiceId: string; lineNo: number; left: number }[] {
  const rows = db.prepare(`SELECT r.purchase_id AS invoice_id, r.date FROM daily_receipts r JOIN invoices i ON i.id = r.purchase_id
                           WHERE r.party_id = ? AND r.date <= ? AND i.status = 'posted' ORDER BY r.date DESC, r.created_at DESC LIMIT 14`).all(partyId, before) as { invoice_id: string; date: string }[];
  const out: { invoiceId: string; lineNo: number; left: number }[] = [];
  const onHand = new Map<string, number>();
  const shelf = (warehouseId: string): number => {
    if (!onHand.has(warehouseId)) {
      const r = db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q FROM stock_moves WHERE item_id = ? AND warehouse_id = ?').get(itemId, warehouseId) as { q: number };
      onHand.set(warehouseId, Math.max(0, Number(r.q)));
    }
    return onHand.get(warehouseId)!;
  };
  for (const r of rows) {
    const inv = getInvoice(db, r.invoice_id);
    const back = returnedByLine(db, r.invoice_id);
    for (const l of inv.lines) {
      if (l.itemId !== itemId) continue;
      const left = Math.min(l.qtyMilli - (back.get(l.lineNo)?.qtyMilli ?? 0), shelf(inv.warehouseId));
      if (left > 0) {
        out.push({ invoiceId: r.invoice_id, lineNo: l.lineNo, left });
        onHand.set(inv.warehouseId, shelf(inv.warehouseId) - left);
      }
    }
  }
  return out;
}

export function dailySheet(db: Db, partyId: string, date = todayIso()): DailySheet {
  const p = supplier(db, partyId);
  const last = db.prepare('SELECT id, date FROM daily_receipts WHERE party_id = ? AND date < ? ORDER BY date DESC, created_at DESC LIMIT 1').get(partyId, date) as { id: string; date: string } | undefined;
  const lastLine = db.prepare('SELECT received_milli, returned_milli, unit_cost FROM daily_receipt_lines WHERE receipt_id = ? AND item_id = ?');
  const rows = db.prepare(`SELECT d.item_id, d.sort, d.unit_cost, i.code, i.name_ar, i.name_en, i.name_ku, i.unit, i.purchase_price
                           FROM daily_supplier_items d JOIN items i ON i.id = d.item_id WHERE d.party_id = ? AND i.active = 1 ORDER BY d.sort, i.code`).all(partyId) as {
    item_id: string; sort: number; unit_cost: number | null; code: string; name_ar: string; name_en: string; name_ku: string; unit: UnitCode; purchase_price: number | null;
  }[];
  const items = rows.map((r) => {
    const l = last ? lastLine.get(last.id, r.item_id) as { received_milli: number; returned_milli: number; unit_cost: number } | undefined : undefined;
    return {
      itemId: r.item_id, code: r.code, name: { ar: r.name_ar, en: r.name_en, ku: r.name_ku }, unit: r.unit, sort: Number(r.sort),
      // the cost agreed for this supplier, else the last one paid, else the item's purchase price
      unitCost: r.unit_cost !== null ? Number(r.unit_cost) : l ? Number(l.unit_cost) : r.purchase_price === null ? null : Number(r.purchase_price),
      lastReceivedMilli: l ? Number(l.received_milli) : null, lastReturnedMilli: l ? Number(l.returned_milli) : null,
      returnableMilli: returnable(db, partyId, r.item_id, date).reduce((s, x) => s + x.left, 0), lastDate: last?.date ?? null
    };
  });
  const doneToday = !!db.prepare('SELECT 1 FROM daily_receipts WHERE party_id = ? AND date = ?').get(partyId, date);
  return { partyId, partyName: p.name, balance: p.balance, date, items, doneToday };
}

/** The supplier's usual items, in the order the sheet lists them, with an agreed cost each (null: none agreed). */
export function setDailyItems(db: Db, partyId: string, items: { itemId: string; unitCost?: number | null | undefined }[], user: string): DailySheet {
  supplier(db, partyId);
  const errors: { code: string; line?: number }[] = [];
  const seen = new Set<string>();
  items.forEach((it, i) => {
    const row = db.prepare('SELECT unit, active FROM items WHERE id = ?').get(it.itemId) as { unit: string; active: number } | undefined;
    if (!row || row.active !== 1 || row.unit === 'service') errors.push({ code: 'item_invalid', line: i + 1 });
    if (seen.has(it.itemId)) errors.push({ code: 'ds_item_twice', line: i + 1 });
    seen.add(it.itemId);
  });
  if (items.length > 100) errors.push({ code: 'ds_too_many' });
  if (errors.length) throw invalid(errors);
  // a cost left out keeps the one agreed (someone who may not see cost reorders the list without touching them)
  const agreed = new Map((db.prepare('SELECT item_id, unit_cost FROM daily_supplier_items WHERE party_id = ?').all(partyId) as { item_id: string; unit_cost: number | null }[])
    .map((r) => [r.item_id, r.unit_cost === null ? null : Number(r.unit_cost)]));
  transaction(db, () => {
    db.prepare('DELETE FROM daily_supplier_items WHERE party_id = ?').run(partyId);
    const insert = db.prepare('INSERT INTO daily_supplier_items (party_id, item_id, sort, unit_cost) VALUES (?, ?, ?, ?)');
    items.forEach((it, i) => insert.run(partyId, it.itemId, i, it.unitCost === undefined ? agreed.get(it.itemId) ?? null : it.unitCost));
    audit(db, user, 'update', 'daily_supplier', partyId, { items: items.length });
  });
  return dailySheet(db, partyId);
}

/** unitCost left out: the cost agreed with the supplier, else the last one paid, else the item's purchase price */
export interface DailyLineInput { itemId: string; receivedMilli: number; returnedMilli: number; unitCost?: number | undefined }
/** again: the supplier came a second time that day, and the person said so (a second sheet is otherwise refused) */
export interface DailyReceiptInput { partyId: string; date: string; warehouseId: string; notes?: string | undefined; again?: boolean | undefined; lines: DailyLineInput[] }
export interface DailyReceiptView {
  id: string; partyId: string; date: string; warehouseId: string; purchaseId: string | null; purchaseNumber: string | null;
  returns: { id: string; number: string | null; total: number }[]; received: number; returned: number; createdBy: string; createdAt: string;
  lines: { itemId: string; receivedMilli: number; returnedMilli: number; unitCost: number }[];
}

export function getDailyReceipt(db: Db, id: string): DailyReceiptView {
  const r = db.prepare('SELECT * FROM daily_receipts WHERE id = ?').get(id) as {
    id: string; party_id: string; date: string; warehouse_id: string; purchase_id: string | null; created_by: string; created_at: string;
  } | undefined;
  if (!r) throw notFound('daily_receipt');
  const purchase = r.purchase_id ? getInvoice(db, r.purchase_id) : null;
  const returns = (db.prepare('SELECT return_id FROM daily_receipt_returns WHERE receipt_id = ?').all(id) as { return_id: string }[])
    .map(({ return_id }) => { const inv = getInvoice(db, return_id); return { id: inv.id, number: inv.number, total: inv.total }; });
  const lines = (db.prepare('SELECT item_id, received_milli, returned_milli, unit_cost FROM daily_receipt_lines WHERE receipt_id = ?').all(id) as {
    item_id: string; received_milli: number; returned_milli: number; unit_cost: number;
  }[]).map((l) => ({ itemId: l.item_id, receivedMilli: Number(l.received_milli), returnedMilli: Number(l.returned_milli), unitCost: Number(l.unit_cost) }));
  return {
    id: r.id, partyId: r.party_id, date: r.date, warehouseId: r.warehouse_id, purchaseId: r.purchase_id, purchaseNumber: purchase?.number ?? null, returns,
    received: purchase?.total ?? 0, returned: returns.reduce((s, x) => s + x.total, 0), createdBy: r.created_by, createdAt: r.created_at, lines
  };
}

export function listDailyReceipts(db: Db, partyId: string): DailyReceiptView[] {
  return (db.prepare('SELECT id FROM daily_receipts WHERE party_id = ? ORDER BY date DESC, created_at DESC LIMIT 60').all(partyId) as { id: string }[]).map((r) => getDailyReceipt(db, r.id));
}

/** Today's sheet: the purchase of what came and the returns of what goes back, together or not at all. */
export function saveDailyReceipt(db: Db, input: DailyReceiptInput, actor: Actor): DailyReceiptView {
  supplier(db, input.partyId);
  const errors: { code: string; line?: number; available?: number }[] = [];
  if (!isIsoDate(input.date)) errors.push({ code: 'date_invalid' });
  if (!db.prepare('SELECT 1 FROM warehouses WHERE id = ? AND active = 1').get(input.warehouseId)) errors.push({ code: 'warehouse_invalid' });
  const mine = userBranchLists(db, actor)?.warehouses ?? null;
  if (mine && !mine.includes(input.warehouseId)) throw new AppError(403, 'forbidden', { need: 'branch' });
  // one sheet per supplier and day: a second one is the same delivery typed twice far more often than a second visit,
  // and it would buy the goods twice. The page asks, and sends `again` when the person says the supplier did come again
  if (!errors.length && !input.again && db.prepare('SELECT 1 FROM daily_receipts WHERE party_id = ? AND date = ? LIMIT 1').get(input.partyId, input.date)) {
    throw conflict('ds_sheet_exists', { date: input.date });
  }
  const seen = new Set<string>();
  const known = new Map(dailySheet(db, input.partyId, input.date).items.map((it) => [it.itemId, it.unitCost]));
  const lines = input.lines.filter((l) => l.receivedMilli > 0 || l.returnedMilli > 0)
    .map((l) => ({ ...l, unitCost: l.unitCost ?? known.get(l.itemId) ?? 0 }));
  lines.forEach((l, i) => {
    if (seen.has(l.itemId)) errors.push({ code: 'ds_item_twice', line: i + 1 });
    seen.add(l.itemId);
    if (!db.prepare("SELECT 1 FROM items WHERE id = ? AND active = 1 AND unit <> 'service'").get(l.itemId)) errors.push({ code: 'item_invalid', line: i + 1 });
    if (l.receivedMilli > 0 && l.unitCost <= 0) errors.push({ code: 'ds_cost_required', line: i + 1 });
    if (l.returnedMilli > 0) {
      const can = returnable(db, input.partyId, l.itemId, input.date).reduce((s, x) => s + x.left, 0);
      if (l.returnedMilli > can) errors.push({ code: 'ds_return_too_much', line: i + 1, available: can });
    }
  });
  if (!lines.length) errors.push({ code: 'lines_required' });
  if (errors.length) throw invalid(errors);
  const id = randomUUID();
  transaction(db, () => {
    // what goes back first: the goods left from the earlier days, before today's come in on the same item
    const returnIds: string[] = [];
    const byInvoice = new Map<string, { lineNo: number; qtyMilli: number }[]>();
    for (const l of lines.filter((x) => x.returnedMilli > 0)) {
      let left = l.returnedMilli;
      for (const r of returnable(db, input.partyId, l.itemId, input.date)) {
        if (left <= 0) break;
        const take = Math.min(left, r.left);
        byInvoice.set(r.invoiceId, [...(byInvoice.get(r.invoiceId) ?? []), { lineNo: r.lineNo, qtyMilli: take }]);
        left -= take;
      }
    }
    for (const [invoiceId, returnLines] of byInvoice) {
      const back = createReturn(db, invoiceId, { date: input.date, payment: 'credit', notes: 'daily', lines: returnLines }, actor.name, actor);
      returnIds.push(back.id);
    }
    const received = lines.filter((l) => l.receivedMilli > 0);
    let purchaseId: string | null = null;
    if (received.length) {
      const draft = createInvoice(db, {
        kind: 'purchase', date: input.date, partyId: input.partyId, warehouseId: input.warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
        ...(input.notes?.trim() ? { notes: input.notes.trim().slice(0, 500) } : {}),
        lines: received.map((l) => ({ itemId: l.itemId, qtyMilli: l.receivedMilli, unitPrice: l.unitCost }))
      }, actor.name);
      purchaseId = postInvoice(db, draft.id, actor.name).id;
    }
    db.prepare('INSERT INTO daily_receipts (id, party_id, date, warehouse_id, purchase_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.partyId, input.date, input.warehouseId, purchaseId, actor.name, new Date().toISOString());
    const insert = db.prepare('INSERT INTO daily_receipt_lines (receipt_id, item_id, received_milli, returned_milli, unit_cost) VALUES (?, ?, ?, ?, ?)');
    for (const l of lines) insert.run(id, l.itemId, l.receivedMilli, l.returnedMilli, l.unitCost);
    const link = db.prepare('INSERT INTO daily_receipt_returns (receipt_id, return_id) VALUES (?, ?)');
    for (const r of returnIds) link.run(id, r);
    audit(db, actor.name, 'receive', 'daily_receipt', id, { party: input.partyId, purchase: purchaseId, returns: returnIds.length });
  });
  return getDailyReceipt(db, id);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const qty = z.number().int().min(0).max(1e12);

/**
 * Purchasing staff (purchases) keep the daily sheets and the suppliers' usual items. Reading is open, as the suppliers'
 * balances are; what the goods cost (the agreed costs, the money of each day's purchase and returns) goes to those who
 * may see cost only (cost-view.ts).
 */
export const dailySuppliersApi: ApiExtension = {
  rules: {
    'PUT /api/daily-suppliers/:id/items': 'purchases',
    'POST /api/daily-suppliers/receipts': 'purchases'
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    return [
      {
        method: 'GET', path: '/api/daily-suppliers',
        handler: async () => (db.prepare(`SELECT p.id, p.name, COUNT(d.item_id) AS items FROM parties p JOIN daily_supplier_items d ON d.party_id = p.id
                                          WHERE p.type = 'supplier' GROUP BY p.id ORDER BY p.name`).all() as { id: string; name: string; items: number }[])
          .map((r) => ({ partyId: r.id, name: r.name, items: Number(r.items), balance: getParty(db, r.id).balance, doneToday: !!db.prepare('SELECT 1 FROM daily_receipts WHERE party_id = ? AND date = ?').get(r.id, todayIso()) }))
      },
      {
        method: 'GET', path: '/api/daily-suppliers/:id/sheet',
        handler: async (req) => dailySheet(db, parse(z.object({ id }), req.params).id, parse(z.object({ date: day.optional() }), req.query ?? {}).date)
      },
      {
        method: 'PUT', path: '/api/daily-suppliers/:id/items',
        handler: async (req) => setDailyItems(db, parse(z.object({ id }), req.params).id,
          parse(z.object({ items: z.array(z.object({ itemId: id, unitCost: z.number().int().min(0).max(1e12).nullable().optional() })).max(100) }), req.body).items, actor(req).name)
      },
      { method: 'GET', path: '/api/daily-suppliers/:id/receipts', handler: async (req) => listDailyReceipts(db, parse(z.object({ id }), req.params).id) },
      {
        method: 'POST', path: '/api/daily-suppliers/receipts',
        handler: async (req, reply) => {
          const body = parse(z.object({
            partyId: id, date: day, warehouseId: id, notes: z.string().max(500).optional(), again: z.boolean().optional(),
            lines: z.array(z.object({ itemId: id, receivedMilli: qty, returnedMilli: qty, unitCost: z.number().int().min(0).max(1e12).optional() })).max(100)
          }), req.body);
          const who = actor(req);
          reply.status(201).send(onceOnly(db, req, reply, who, 'POST /api/daily-suppliers/receipts',
            () => { const made = saveDailyReceipt(db, body, who); return { id: made.id, result: made }; }, (r) => getDailyReceipt(db, r)));
          return undefined;
        }
      }
    ];
  }
};
