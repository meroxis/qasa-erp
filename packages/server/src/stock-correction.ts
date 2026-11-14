import { z } from 'zod';
import { isIsoDate, MAX_BATCH_NO, todayIso } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { AppError, invalid } from './errors.ts';
import type { Actor } from './auth.ts';
import { readSetting } from './settings.ts';
import { getItem, itemMoves, itemStock, stockOf, type ItemView, type StockByWarehouse, type StockMoveView } from './items.ts';
import { createAdjustment, getAdjustment, postAdjustment, type AdjustmentLang, type AdjustmentReason } from './adjustments.ts';
import { createStockDoc, getStockDoc, postStockDoc } from './stock-docs.ts';
import { createInvoice, getInvoice, postInvoice } from './invoices.ts';
import { userBranchLists } from './branches.ts';
import { onceOnly } from './idempotency.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Correcting an item's stock from its own page (1.4.2): "the shelf has 12, the books say 7". The person says how much
 * is there now (or how much to add or take away), in which warehouse and why; the server makes the document the app
 * already has for that reason, so the books, the item's moves, its average cost and the reports stay right, and posts it
 * at once where the company's rules let this person post it:
 *
 * - found in a count: a stock adjustment "count" (a surplus: Dr the warehouse / Cr the gain account, 49; a shortage:
 *   Dr the count-shortage account, 39 / Cr the warehouse), at the average cost (a surplus at the cost given);
 * - damaged, lost: an adjustment "damaged" or "lost", out only (Dr losses, 39 / Cr the warehouse, at the average cost);
 * - other: an adjustment "other" either way, with a note that says why (out: Dr 39; in: Cr the gain account);
 * - opening stock: an opening stock document (in only, at the cost given: Dr the warehouse / Cr capital, 21);
 * - a purchase that was never entered, with its supplier: a purchase invoice on the supplier's account (Dr the
 *   warehouse / Cr the supplier), posted at once, as the Purchases page would; it needs the purchases permission too.
 *   Without a supplier: an adjustment "other" in, at the cost given (Cr the gain account, as a count surplus), whose
 *   note says it was a purchase not entered.
 *
 * Approval: with "Separate duties" on, an adjustment or opening stock is posted by an approver who did not prepare it
 * (adjustments.ts, stock-docs.ts). The person correcting prepared it, so it is saved as a draft that waits on the Stock
 * adjustments (or Stock documents) page, exactly as one typed there; nothing moves until it is posted. A purchase
 * invoice has no such step and is posted. Everything is made in one transaction: a refusal (not enough stock, a date
 * before the item's last move, a locked month) leaves nothing behind.
 */

export const CORRECTION_REASONS = ['purchase_missing', 'found', 'damaged', 'lost', 'opening', 'other'] as const;
export type CorrectionReason = (typeof CORRECTION_REASONS)[number];

/** Notes are the adjustment's own limit (500); the first words say the reason where the adjustment has none of its own. */
export const MAX_CORRECTION_NOTE = 400;

export interface StockCorrectionInput {
  warehouseId: string;
  /** set: `qtyMilli` is what is there now (counted, ≥ 0); change: what to add (+) or take away (−), never 0 */
  mode: 'set' | 'change';
  qtyMilli: number;
  reason: CorrectionReason;
  /** IQD per base unit for what comes in; absent: the average cost (an adjustment) */
  unitCost?: number | undefined;
  /** a purchase not entered: the supplier it was bought from (a purchase invoice instead of an adjustment) */
  supplierId?: string | undefined;
  note?: string | undefined;
  /** absent: today */
  date?: string | undefined;
  /** a batch item: what comes in names its batch and expiry date */
  batchNo?: string | undefined;
  expiry?: string | undefined;
  /** the language the entry's description is written in */
  lang?: AdjustmentLang | undefined;
}

export type CorrectionDocType = 'adjustment' | 'stock_doc' | 'invoice';

export interface StockCorrectionResult {
  document: { type: CorrectionDocType; id: string; number: string | null; status: string };
  /** false: saved as a draft that waits for an approver (separate duties); the stock has not moved yet */
  posted: boolean;
  /** what was added (+) or taken (−), base thousandths */
  diffMilli: number;
  /** the item as its page reads it, after the correction */
  item: ItemView & { stock: StockByWarehouse[]; moves: StockMoveView[] };
}

/** Words the note starts with where the document has no reason of its own for it, in the poster's language. */
const PURCHASE_WORDS: Record<AdjustmentLang, string> = { ar: 'شراء لم يُدخَل', en: 'Purchase not entered', ku: 'کڕینێک کە نەنووسراوە' };

const ADJUSTMENT_REASON: Record<Exclude<CorrectionReason, 'opening'>, AdjustmentReason> = {
  purchase_missing: 'other', found: 'count', damaged: 'damaged', lost: 'lost', other: 'other'
};

/** Opening stock credits capital (the Stock documents page's own default). */
export const OPENING_COUNTER_ACCOUNT = '21';

/** Whether this person may post the document they are about to prepare (separate duties: never their own). */
const postsAtOnce = (db: Db): boolean => readSetting(db, 'separate_duties') !== '1';

function itemPage(db: Db, itemId: string, actor: Actor): StockCorrectionResult['item'] {
  const warehouses = userBranchLists(db, actor)?.warehouses ?? null;
  return { ...getItem(db, itemId, warehouses), stock: itemStock(db, itemId, warehouses), moves: itemMoves(db, itemId, warehouses) };
}

/** The document a correction made, as it stands now, with the quantity its one line moves. */
function documentOf(db: Db, type: CorrectionDocType, id: string): { document: StockCorrectionResult['document']; qtyMilli: number } {
  if (type === 'adjustment') {
    const a = getAdjustment(db, id);
    return { document: { type, id, number: a.number, status: a.status }, qtyMilli: a.lines[0]?.qtyMilli ?? 0 };
  }
  if (type === 'stock_doc') {
    const d = getStockDoc(db, id);
    return { document: { type, id, number: d.number, status: d.status }, qtyMilli: d.lines[0]?.qtyMilli ?? 0 };
  }
  const inv = getInvoice(db, id);
  return { document: { type, id, number: inv.number, status: inv.status }, qtyMilli: inv.lines[0]?.qtyMilli ?? 0 };
}

/** The answer for a correction's document (also when a request is sent again with its key): as it stands now. */
export function correctionResult(db: Db, itemId: string, key: string, actor: Actor): StockCorrectionResult {
  const [type, id] = key.split(':') as [CorrectionDocType, string];
  const { document, qtyMilli } = documentOf(db, type, id);
  return { document, posted: document.status === 'posted', diffMilli: qtyMilli, item: itemPage(db, itemId, actor) };
}

/** What the request asks to move, checked: the difference, and the refusals that do not need the documents' own checks. */
function checkCorrection(db: Db, itemId: string, input: StockCorrectionInput, actor: Actor): { diff: number; date: string } {
  const item = getItem(db, itemId);
  const errors: { code: string; field?: string }[] = [];
  if (!item.active) errors.push({ code: 'item_invalid' });
  else if (!item.trackStock) errors.push({ code: 'item_not_stock' });
  const date = input.date ?? todayIso();
  if (!isIsoDate(date)) errors.push({ code: 'date_invalid' });
  if (!Number.isSafeInteger(input.qtyMilli) || (input.mode === 'set' ? input.qtyMilli < 0 : input.qtyMilli === 0)) errors.push({ code: 'line_qty_invalid', field: 'qtyMilli' });
  if (input.unitCost !== undefined && (!Number.isSafeInteger(input.unitCost) || input.unitCost < 0)) errors.push({ code: 'line_price_invalid', field: 'unitCost' });
  if (errors.length) throw invalid(errors);
  const diff = input.mode === 'set' ? input.qtyMilli - stockOf(db, itemId, input.warehouseId).qtyMilli : input.qtyMilli;
  if (diff === 0) errors.push({ code: 'correction_no_change' });
  else if ((input.reason === 'damaged' || input.reason === 'lost') && diff > 0) errors.push({ code: 'correction_out_only', field: 'reason' });
  else if ((input.reason === 'purchase_missing' || input.reason === 'opening') && diff < 0) errors.push({ code: 'correction_in_only', field: 'reason' });
  if (input.reason === 'other' && !input.note?.trim()) errors.push({ code: 'note_required', field: 'note' });
  // what comes in as a purchase or opening stock is at the price it was bought for (no average to fall back on)
  if (diff > 0 && (input.reason === 'purchase_missing' || input.reason === 'opening') && input.unitCost === undefined) errors.push({ code: 'line_price_invalid', field: 'unitCost' });
  if (input.supplierId !== undefined && input.reason !== 'purchase_missing') errors.push({ code: 'party_invalid', field: 'supplierId' });
  if (errors.length) throw invalid(errors);
  // a purchase invoice is a purchase: whoever corrects the stock may make it only if they may enter purchases
  if (input.supplierId !== undefined && !actor.permissions.includes('purchases')) throw new AppError(403, 'forbidden', { need: 'purchases' });
  return { diff, date };
}

/**
 * Makes (and, where the rules allow, posts) the document for a correction. The id it returns names its kind
 * ("adjustment:<id>"), so a request sent again with the same key is answered with the same document.
 */
export function correctStock(db: Db, itemId: string, input: StockCorrectionInput, actor: Actor): { key: string; result: StockCorrectionResult } {
  const { diff, date } = checkCorrection(db, itemId, input, actor);
  const lang = input.lang ?? 'ar';
  const note = input.note?.trim() ?? '';
  const batch = diff > 0 ? { ...(input.batchNo?.trim() ? { batchNo: input.batchNo.trim() } : {}), ...(input.expiry ? { expiry: input.expiry } : {}) } : {};
  return transaction(db, () => {
    let type: CorrectionDocType;
    let id: string;
    if (input.reason === 'purchase_missing' && input.supplierId !== undefined) {
      type = 'invoice';
      const draft = createInvoice(db, {
        kind: 'purchase', date, partyId: input.supplierId, warehouseId: input.warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
        ...(note ? { notes: note } : {}),
        lines: [{ itemId, qtyMilli: diff, unitPrice: input.unitCost ?? 0, ...batch }]
      }, actor.name);
      id = postInvoice(db, draft.id, actor.name).id;
    } else if (input.reason === 'opening') {
      type = 'stock_doc';
      const draft = createStockDoc(db, {
        kind: 'opening', date, warehouseId: input.warehouseId, counterAccountCode: OPENING_COUNTER_ACCOUNT, ...(note ? { notes: note } : {}),
        lines: [{ itemId, qtyMilli: diff, unitCost: input.unitCost ?? 0, ...batch }]
      }, actor.name);
      id = postsAtOnce(db) ? postStockDoc(db, draft.id, actor.name, actor).id : draft.id;
    } else {
      type = 'adjustment';
      const notes = input.reason === 'purchase_missing' ? [PURCHASE_WORDS[lang], note].filter(Boolean).join(' · ') : note;
      const draft = createAdjustment(db, {
        date, warehouseId: input.warehouseId, reason: ADJUSTMENT_REASON[input.reason], ...(notes ? { notes } : {}),
        lines: [{ itemId, qtyMilli: diff, ...(diff > 0 && input.unitCost !== undefined ? { unitCost: input.unitCost } : {}), ...batch }]
      }, actor);
      id = postsAtOnce(db) ? postAdjustment(db, draft.id, actor, lang).id : draft.id;
    }
    const key = `${type}:${id}`;
    return { key, result: correctionResult(db, itemId, key, actor) };
  });
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);
const correctionBody = z.object({
  warehouseId: id,
  mode: z.enum(['set', 'change']),
  qtyMilli: z.number().int().min(-1e12).max(1e12),
  reason: z.enum(CORRECTION_REASONS),
  unitCost: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  supplierId: id.optional(),
  note: z.string().max(MAX_CORRECTION_NOTE).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  batchNo: z.string().max(MAX_BATCH_NO * 2).optional(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lang: z.enum(['ar', 'en', 'ku']).optional()
});

export const stockCorrectionApi: ApiExtension = {
  rules: {
    // the stock permission, as for a stock adjustment; a purchase invoice made instead needs purchases too (checkCorrection)
    'POST /api/items/:id/stock-correction': 'stock'
  },
  routes(db, { actorOf }) {
    return [
      {
        method: 'POST', path: '/api/items/:id/stock-correction',
        handler: async (req: ApiRequest, reply) => {
          const itemId = parse(z.object({ id }), req.params).id;
          const body = parse(correctionBody, req.body);
          const who = actorOf(req);
          const input: StockCorrectionInput = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as unknown as StockCorrectionInput;
          return onceOnly(db, req, reply, who, 'POST /api/items/:id/stock-correction',
            () => { const made = correctStock(db, itemId, input, who); return { id: made.key, result: made.result }; },
            (key) => correctionResult(db, itemId, key, who));
        }
      }
    ];
  }
};
