import { z } from 'zod';
import type { VoucherInput } from '@qasa/core';
import { transaction, type Db } from './db.ts';
import { AppError, conflict, invalid } from './errors.ts';
import type { Actor } from './auth.ts';
import {
  approvesOwn, approveWaiting, createVoucher, deleteEntry, getEntry, isOwnVoucher, MAX_REJECT_REASON, rejectWaiting, setVouchersNeedApproval, vouchersNeedApproval,
  waitingVouchers,
  type EntryView, type Preparer
} from './journal.ts';
import { getParty } from './parties.ts';
import { onceOnly } from './idempotency.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * 1.4: "Receive payment" and "Pay supplier": a receipt or payment voucher from a short form (who, how much, into or
 * out of which safe or bank), and the approval of vouchers that wait for it ("Vouchers need approval").
 *
 * The voucher is an ordinary one, made by createVoucher like any other: Dr safe / Cr the customer's account for a
 * receipt, Dr the supplier's account / Cr safe for a payment, with the party on the line so it shows on their
 * statement. Whether it is posted at once depends on who makes it:
 *  - "Vouchers need approval" on: at once for someone who may approve vouchers (entries.approve), otherwise it waits.
 *  - off: at once only for someone who could take it through the whole chain alone (check and approve); otherwise it
 *    is a draft, checked and approved as every voucher is.
 * Under "separate duties" nobody approves what they prepared, so it is never at once.
 *
 * Whoever prepared a voucher that is not posted (it waits, was rejected, or is a draft nobody checked yet) takes it
 * back: it is deleted, as a draft is. A corrected one is sent with the same form, which names the one it replaces: the
 * old one goes and the new one is made together, or neither. Only their own, and never an approved one: someone who
 * prepares vouchers on the vouchers screen changes and deletes drafts there, under entries.prepare.
 */

export interface QuickVoucherInput {
  kind: 'receipt' | 'payment';
  partyId: string;
  /** in the voucher's currency (minor units) */
  amount: number;
  currency: 'IQD' | 'USD';
  rateX100?: number | undefined;
  cashAccountCode: string;
  date: string;
  note?: string | undefined;
  /** this user's own voucher, not posted, that this one corrects: taken back as this one is made */
  replaces?: string | undefined;
}

export const preparerOf = (actor: Pick<Actor, 'id' | 'name' | 'permissions'>): Preparer =>
  ({ id: actor.id, name: actor.name, mayApprove: actor.permissions.includes('entries.approve') });

/** Receiving from a customer is for sales people, paying a supplier for purchasing; whoever prepares vouchers may do both. */
function assertMayPrepare(kind: QuickVoucherInput['kind'], actor: Pick<Actor, 'permissions'>): void {
  const need = kind === 'receipt' ? 'sales' : 'purchases';
  if (!actor.permissions.includes(need) && !actor.permissions.includes('entries.prepare')) throw new AppError(403, 'forbidden', { need });
}

/**
 * Takes back a voucher its preparer made and that is not in the books: their own receipt or payment (the same answer
 * for somebody else's as for one that does not exist), of a kind they may prepare, and not approved. deleteEntry
 * refuses the rest (one that was checked already, one a feature owns, one matched to a bank statement) and keeps the
 * audit line.
 */
export function withdrawOwnVoucher(db: Db, id: string, actor: Pick<Actor, 'id' | 'name' | 'permissions'>): void {
  if (!actor.id || !isOwnVoucher(db, id, actor.id)) throw new AppError(403, 'forbidden');
  const row = db.prepare('SELECT type, status FROM entries WHERE id = ?').get(id) as { type: QuickVoucherInput['kind']; status: string };
  assertMayPrepare(row.type, actor);
  if (row.status === 'approved') throw conflict('action_not_allowed', { status: row.status, action: 'delete' });
  deleteEntry(db, id, actor.name);
}

export function quickVoucher(db: Db, input: QuickVoucherInput, actor: Pick<Actor, 'id' | 'name' | 'permissions'>): EntryView {
  assertMayPrepare(input.kind, actor);
  const errors: { code: string }[] = [];
  const row = db.prepare('SELECT type, active FROM parties WHERE id = ?').get(input.partyId) as { type: string; active: number } | undefined;
  if (!row || Number(row.active) !== 1 || row.type !== (input.kind === 'receipt' ? 'customer' : 'supplier')) errors.push({ code: 'party_invalid' });
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) errors.push({ code: 'amount_invalid' });
  if (input.currency === 'USD' && !(Number.isSafeInteger(input.rateX100) && (input.rateX100 ?? 0) > 0)) errors.push({ code: 'rate_invalid' });
  if (errors.length) throw invalid(errors);
  const party = getParty(db, input.partyId);
  const note = input.note?.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const voucher: VoucherInput = {
    kind: input.kind, date: input.date, cashAccountCode: input.cashAccountCode, party: party.name,
    description: note || party.name, currency: input.currency, rateX100: input.currency === 'IQD' ? 100 : input.rateX100!,
    items: [{ accountCode: party.accountCode, amount: input.amount, partyId: party.id }]
  };
  const who = preparerOf(actor);
  // off: at once only for someone who may both check and approve; on: createVoucher decides (approved, or waiting)
  const now = !vouchersNeedApproval(db) && approvesOwn(db, who) && actor.permissions.includes('entries.check');
  const replaces = input.replaces;
  if (!replaces) return createVoucher(db, voucher, actor.name, actor.id, who, now);
  // a corrected voucher: the one it replaces is taken back and this one made together, or neither
  return transaction(db, () => {
    withdrawOwnVoucher(db, replaces, actor);
    return createVoucher(db, voucher, actor.name, actor.id, who, now);
  });
}

/**
 * What the screens ask: is the setting on, how many wait, may this user approve, are their own approved at once, and
 * is a voucher they make with the short form posted at once (the rule of quickVoucher above); when it is not, the
 * form says that the balance does not change yet.
 */
export function approvalState(db: Db, actor: Pick<Actor, 'id' | 'name' | 'permissions'>):
  { on: boolean; waiting: number; mayApprove: boolean; ownAtOnce: boolean; postsAtOnce: boolean } {
  const who = preparerOf(actor);
  const on = vouchersNeedApproval(db);
  const own = approvesOwn(db, who);
  return { on, waiting: waitingVouchers(db), mayApprove: who.mayApprove, ownAtOnce: on && own, postsAtOnce: own && (on || actor.permissions.includes('entries.check')) };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const idParam = z.object({ id: z.string().min(1).max(64) });

export const quickVouchersApi: ApiExtension = {
  rules: {
    // who may is decided by the kind (sales for a receipt, purchases for a payment): checked in quickVoucher
    'POST /api/quick-vouchers': null,
    // taking back one's own voucher that is not posted: own and not approved, checked in withdrawOwnVoucher
    'DELETE /api/quick-vouchers/:id': null,
    'POST /api/entries/:id/approve-waiting': 'entries.approve',
    'POST /api/entries/:id/reject': 'entries.approve'
    // PUT /api/voucher-approval is not listed: switching the setting needs an admin, as every change not listed does
  },
  routes(db, { actorOf }) {
    const actor = (req: ApiRequest) => actorOf(req);
    return [
      {
        method: 'GET', path: '/api/voucher-approval',
        handler: async (req) => approvalState(db, actor(req))
      },
      {
        method: 'PUT', path: '/api/voucher-approval',
        handler: async (req) => {
          setVouchersNeedApproval(db, parse(z.object({ on: z.boolean() }), req.body).on, actor(req).name);
          return approvalState(db, actor(req));
        }
      },
      {
        method: 'POST', path: '/api/quick-vouchers',
        handler: async (req, reply) => {
          const body = parse(z.object({
            kind: z.enum(['receipt', 'payment']), partyId: z.string().min(1).max(64),
            amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.enum(['IQD', 'USD']),
            rateX100: z.number().int().positive().max(100_000_000).optional(), cashAccountCode: z.string().min(1).max(12),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(500).optional(), replaces: z.string().min(1).max(64).optional()
          }), req.body);
          const who = actor(req);
          // a form sent twice (a lost answer, a second click) makes the voucher once
          const made = onceOnly(db, req, reply, who, 'POST /api/quick-vouchers', () => {
            const result = quickVoucher(db, body, who);
            return { id: result.id, result };
          }, (id) => getEntry(db, id));
          reply.status(201).send(made);
          return undefined;
        }
      },
      {
        method: 'DELETE', path: '/api/quick-vouchers/:id',
        handler: async (req, reply) => {
          withdrawOwnVoucher(db, parse(idParam, req.params).id, actor(req));
          return reply.status(204).send();
        }
      },
      {
        method: 'POST', path: '/api/entries/:id/approve-waiting',
        handler: async (req) => approveWaiting(db, parse(idParam, req.params).id, preparerOf(actor(req)))
      },
      {
        method: 'POST', path: '/api/entries/:id/reject',
        handler: async (req) => {
          const body = parse(z.object({ reason: z.string().min(1).max(MAX_REJECT_REASON) }), req.body);
          return rejectWaiting(db, parse(idParam, req.params).id, body.reason, preparerOf(actor(req)));
        }
      }
    ];
  }
};
