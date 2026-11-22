import { ApiError } from '../api.ts';
import type { ApprovalAction, ApprovalFor, SupervisorRules } from './rules-api.ts';

/**
 * The approvals a sale needs from a supervisor (2.0), worked out at the till as the server will (pos.ts): each is for
 * one very thing, which the server keeps with the approval and holds its use to. The till keeps what was approved
 * with each token, so it knows which approvals still cover the basket as it is now, and asks again for the others
 * (a price changed again, a larger discount, a basket held and resumed, an approval that ran out).
 */
export interface HeldApproval { action: ApprovalAction; token: string; subject?: string | undefined; amount?: number | undefined }

export interface ApprovalNeed {
  action: 'price' | 'discount' | 'credit_over';
  /** the item and unit (price), or the customer (credit over the limit) */
  subject?: string;
  /** the lowest price asked, the discount, or the amount going on account */
  amount: number;
  what: ApprovalFor;
  /** the line a price need is about (for the words shown to the supervisor) */
  line?: ApprovalLine;
}

export interface ApprovalLine { itemId: string; itemUnit: string; unit: string | null; unitPrice: number; listPrice: number; name?: string }

/** The subject of a price approval, as the server writes it: the item, and the unit when it is not the item's own. */
export const priceSubjectOf = (l: Pick<ApprovalLine, 'itemId' | 'itemUnit' | 'unit'>): string => `${l.itemId}|${l.unit && l.unit !== l.itemUnit ? l.unit : ''}`;

/** Whether an approval the till holds covers a need of the sale as it is now. */
export function covers(a: HeldApproval, need: ApprovalNeed): boolean {
  if (a.action !== need.action || a.amount === undefined) return false;
  if (need.action === 'price') return a.subject === need.subject && a.amount <= need.amount;
  if (need.action === 'discount') return a.amount >= need.amount;
  return a.subject === need.subject && a.amount >= need.amount;
}

/**
 * What this sale needs approved: each item and unit sold below its list price (its lowest line price), a discount
 * over the company's limit, and credit over the customer's limit (the amount that goes on their account).
 */
export function approvalNeeds(input: {
  rules: SupervisorRules; miscItemId: string | null; lines: readonly ApprovalLine[];
  discount: number; subtotal: number; overLimit: boolean; partyId: string; onAccount: number;
}): ApprovalNeed[] {
  const needs: ApprovalNeed[] = [];
  if (input.rules.price) {
    const lowest = new Map<string, ApprovalLine>();
    for (const l of input.lines) {
      if (l.itemId === input.miscItemId || l.unitPrice >= l.listPrice) continue;
      const subject = priceSubjectOf(l);
      const had = lowest.get(subject);
      if (!had || l.unitPrice < had.unitPrice) lowest.set(subject, l);
    }
    for (const [subject, l] of lowest) {
      needs.push({ action: 'price', subject, amount: l.unitPrice, line: l, what: { itemId: l.itemId, ...(l.unit ? { unit: l.unit } : {}), amount: l.unitPrice } });
    }
  }
  if (input.rules.discountPct > 0 && input.discount * 100 > input.rules.discountPct * input.subtotal) {
    needs.push({ action: 'discount', amount: input.discount, what: { amount: input.discount } });
  }
  if (input.overLimit && input.rules.creditOver && input.partyId) {
    needs.push({ action: 'credit_over', subject: input.partyId, amount: input.onAccount, what: { partyId: input.partyId, amount: input.onAccount } });
  }
  return needs;
}

/** The actions the server says still need a supervisor (pos_needs_supervisor), from its refusal; none: another error. */
export function refusedActions(error: unknown): ApprovalAction[] {
  if (!(error instanceof ApiError) || error.code !== 'validation' || !Array.isArray(error.details)) return [];
  return (error.details as { code?: string; action?: ApprovalAction }[]).filter((d) => d.code === 'pos_needs_supervisor' && d.action).map((d) => d.action!);
}

/**
 * After the server refused a sale for want of an approval the till did send (it ran out, or was used): the approvals
 * still good (those of other actions), or null when the refusal was about nothing the till held.
 */
export function dropDead(held: readonly HeldApproval[], error: unknown): HeldApproval[] | null {
  const dead = refusedActions(error);
  if (!dead.length || !held.some((a) => dead.includes(a.action))) return null;
  return held.filter((a) => !dead.includes(a.action));
}

/** The company's rate a refusal carries (a rate typed too far from it), to put back in the till's field. */
export function companyRateOf(error: unknown, code: 'pos_usd_rate_far' | 'pos_rate_far'): number | null {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return null;
  const d = (error.details as { code?: string; rateX100?: unknown }[]).find((x) => x.code === code);
  return d && typeof d.rateX100 === 'number' && d.rateX100 > 0 ? d.rateX100 : null;
}
