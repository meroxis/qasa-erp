import { z } from 'zod';
import { todayIso } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { AppError, conflict, invalid } from './errors.ts';
import { createReturn } from './returns.ts';
import { getShift } from './pos.ts';
import { getInvoice, type InvoiceView } from './invoices.ts';
import { userBranchLists } from './branches.ts';
import { assertRefundApproved } from './till-settings.ts';
import { vouchersOfReturn } from './gift-vouchers.ts';
import { onceOnly } from './idempotency.ts';
import { parse } from './categories.ts';
import type { Actor } from './auth.ts';
import type { ApiExtension } from './routes.ts';

/**
 * A return at the till (2.0.0): the cashier finds a till sale by its receipt number (typed or scanned), picks the lines
 * that come back and pays the money back from the open shift's own safe. Only for sales made at a till (pos_sales), on
 * the cashier's own open shift (the Point of sale role is enough: no Sales permission), and with a supervisor's
 * approval for this shift when the company's till rules ask for one on refunds ("refund"), checked here on the server.
 * The return itself is the ordinary sales return (returns.ts): its guards (no more than was sold, paid back as it was
 * paid, separate duties) all apply.
 */

/** The till sale a receipt number (or invoice id) names, for the return dialog: its lines and what each has had back. */
export function findTillSale(db: Db, shiftId: string, q: string, actor: Actor): InvoiceView {
  // reading only: anyone who may see this shift may look a till sale up from it (the return itself needs the open shift)
  getShift(db, shiftId, actor);
  const key = q.trim();
  if (!key) throw invalid([{ code: 'pos_return_number_required' }]);
  const row = db.prepare(`SELECT i.id FROM invoices i JOIN pos_sales s ON s.invoice_id = i.id
                          WHERE i.kind = 'sale' AND (i.id = ? OR UPPER(i.number) = UPPER(?)) LIMIT 1`).get(key, key) as { id: string } | undefined;
  if (!row) throw new AppError(404, 'pos_return_sale_not_found');
  return getInvoice(db, row.id, userBranchLists(db, actor));
}

export interface TillReturnInput { invoiceId: string; lines: { lineNo: number; qtyMilli: number }[]; approvals?: string[] | undefined; notes?: string | undefined }

export function tillReturn(db: Db, shiftId: string, input: TillReturnInput, actor: Actor): InvoiceView {
  const shift = getShift(db, shiftId, actor);
  if (shift.status !== 'open') throw conflict('pos_shift_closed');
  if (!shift.actions.includes('sell')) throw new AppError(403, 'forbidden', { need: 'shift_owner' });
  if (!db.prepare('SELECT 1 FROM pos_sales WHERE invoice_id = ?').get(input.invoiceId)) throw conflict('pos_return_not_till_sale');
  if (!input.lines.some((l) => l.qtyMilli > 0)) throw invalid([{ code: 'pos_return_nothing' }]);
  const lines = input.lines.filter((l) => l.qtyMilli > 0);
  // the approval is used in the return's own transaction: a return that fails leaves it to be used again
  return transaction(db, () => {
    // the one refund rule (till-settings.ts), as for returns, cancels and exchanges: for this sale and these lines
    assertRefundApproved(db, input.invoiceId, actor, input.approvals, { cashAccount: shift.cashAccountCode, lines });
    return createReturn(db, input.invoiceId, {
      date: todayIso(), payment: 'cash', cashAccountCode: shift.cashAccountCode, lines,
      ...(input.notes ? { notes: input.notes } : {})
    }, actor.name, actor, { shiftId });
  });
}

const id = z.string().min(1).max(64);
export const tillReturnsApi: ApiExtension = {
  rules: {
    'GET /api/pos/shifts/:id/sale': 'pos',
    'POST /api/pos/shifts/:id/returns': 'pos'
  },
  routes: (db, { actorOf }) => [
    {
      method: 'GET', path: '/api/pos/shifts/:id/sale',
      handler: async (req) => {
        const { q } = parse(z.object({ q: z.string().max(80) }), req.query ?? {});
        return findTillSale(db, parse(z.object({ id }), req.params).id, q, actorOf(req));
      }
    },
    {
      method: 'POST', path: '/api/pos/shifts/:id/returns',
      handler: async (req, reply) => {
        const body = parse(z.object({
          invoiceId: id,
          lines: z.array(z.object({ lineNo: z.number().int().min(1), qtyMilli: z.number().int().min(0) })).min(1).max(500),
          approvals: z.array(id).max(4).optional(),
          notes: z.string().max(500).optional()
        }), req.body);
        const shiftId = parse(z.object({ id }), req.params).id;
        const who = actorOf(req);
        // with the gift vouchers money went back onto (a new voucher's code is the customer's only way to it)
        const withVouchers = (doc: InvoiceView) => ({ ...doc, voucherBack: vouchersOfReturn(db, doc.id) });
        const made = onceOnly(db, req, reply, who, 'POST /api/pos/shifts/:id/returns', () => {
          const doc = tillReturn(db, shiftId, body as TillReturnInput, who);
          return { id: doc.id, result: withVouchers(doc) };
        }, (docId) => withVouchers(getInvoice(db, docId, userBranchLists(db, who))));
        reply.status(201).send(made);
        return undefined;
      }
    }
  ]
};
