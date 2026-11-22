import { describe, expect, it } from 'vitest';
import { cashToTake } from '@qasa/core';
import { ApiError } from '../api.ts';
import { rememberTill, tillCache, forgetTill } from '../industry/offline-till.ts';
import { supervisorReview } from '../pages/Outbox.tsx';
import type { OutboxEntry } from '../industry/outbox.ts';
import { approvalNeeds, companyRateOf, covers, dropDead, priceSubjectOf, type HeldApproval } from './approvals.ts';
import { NO_RULES } from './rules-api.ts';
import { TILL_UI_TEXT } from '../i18n/till-ui.ts';

// The till's side of the reviews of 2.0: what an approval is for, asking again for one that ran out, the rules kept
// with the offline till, and the cash rounded as the server rounds it.

const RULES = { lineDelete: false, void: false, price: true, discountPct: 10, noSale: false, refund: false, creditOver: true };
const tea = { itemId: 'tea', itemUnit: 'piece', unit: null, listPrice: 2_750 };
const needs = (over: Partial<Parameters<typeof approvalNeeds>[0]> = {}) => approvalNeeds({
  rules: RULES, miscItemId: 'misc', lines: [], discount: 0, subtotal: 10_000, overLimit: false, partyId: '', onAccount: 0, ...over
});

describe('what a sale needs approved, and for what exactly', () => {
  it('asks once for each item sold below its list price, at its lowest price; never for the open-price item', () => {
    const list = needs({ lines: [
      { ...tea, unitPrice: 2_500 }, { ...tea, unitPrice: 2_000 }, { ...tea, unit: 'box', listPrice: 25_000, unitPrice: 20_000 },
      { itemId: 'misc', itemUnit: 'service', unit: null, listPrice: 0, unitPrice: 0 }, { itemId: 'sugar', itemUnit: 'piece', unit: 'piece', listPrice: 1_500, unitPrice: 1_500 }
    ] });
    expect(list.map((n) => [n.action, n.subject, n.amount])).toEqual([['price', 'tea|', 2_000], ['price', 'tea|box', 20_000]]);
    expect(list[0]!.what).toEqual({ itemId: 'tea', amount: 2_000 });
    expect(list[1]!.what).toEqual({ itemId: 'tea', unit: 'box', amount: 20_000 });
    // the item's own unit named on the line is the item itself, as the server writes it
    expect(priceSubjectOf({ itemId: 'sugar', itemUnit: 'piece', unit: 'piece' })).toBe('sugar|');
  });

  it('names the discount, and the customer and the amount that goes on their account', () => {
    expect(needs({ discount: 1_000 })).toEqual([]);
    expect(needs({ discount: 1_500 })).toEqual([{ action: 'discount', amount: 1_500, what: { amount: 1_500 } }]);
    expect(needs({ overLimit: true, partyId: 'ali', onAccount: 4_000 })).toEqual([{ action: 'credit_over', subject: 'ali', amount: 4_000, what: { partyId: 'ali', amount: 4_000 } }]);
  });

  it('knows which approvals still cover the basket: a lower price, a larger discount or another customer needs a new one', () => {
    const price: HeldApproval = { action: 'price', token: 't1', subject: 'tea|', amount: 2_500 };
    const [need] = needs({ lines: [{ ...tea, unitPrice: 2_500 }] });
    expect(covers(price, need!)).toBe(true);
    expect(covers(price, needs({ lines: [{ ...tea, unitPrice: 2_000 }] })[0]!)).toBe(false);
    expect(covers({ ...price, subject: 'sugar|' }, need!)).toBe(false);
    const discount: HeldApproval = { action: 'discount', token: 't2', amount: 1_500 };
    expect(covers(discount, needs({ discount: 1_200 })[0]!)).toBe(true);
    expect(covers(discount, needs({ discount: 2_000 })[0]!)).toBe(false);
    const credit: HeldApproval = { action: 'credit_over', token: 't3', subject: 'ali', amount: 4_000 };
    expect(covers(credit, needs({ overLimit: true, partyId: 'sam', onAccount: 1_000 })[0]!)).toBe(false);
    // an approval from before what it was for was kept covers nothing: it is asked again
    expect(covers({ action: 'price', token: 'old' }, need!)).toBe(false);
  });
});

describe('an approval the server no longer takes (third review)', () => {
  const refusal = (action: string) => new ApiError(400, 'validation', [{ code: 'pos_needs_supervisor', action }]);
  const held: HeldApproval[] = [{ action: 'price', token: 'p', subject: 'tea|', amount: 2_000 }, { action: 'discount', token: 'd', amount: 1_500 }];

  it('is dropped, the others kept, so the till asks for that one again', () => {
    expect(dropDead(held, refusal('price'))).toEqual([held[1]]);
    expect(dropDead(held, refusal('discount'))).toEqual([held[0]]);
  });

  it('is left alone when the refusal is about something else, or about an approval the till never held', () => {
    expect(dropDead(held, new ApiError(400, 'validation', [{ code: 'stock_insufficient' }]))).toBeNull();
    expect(dropDead(held, refusal('credit_over'))).toBeNull();
    expect(dropDead([], refusal('price'))).toBeNull();
    expect(dropDead(held, new TypeError('Failed to fetch'))).toBeNull();
  });

  it('reads the company’s rate from a refusal of a rate typed too far from it', () => {
    expect(companyRateOf(new ApiError(400, 'validation', [{ code: 'pos_usd_rate_far', rateX100: 142_000 }]), 'pos_usd_rate_far')).toBe(142_000);
    expect(companyRateOf(new ApiError(400, 'validation', [{ code: 'pos_usd_rate_far', rateX100: 142_000 }]), 'pos_rate_far')).toBeNull();
    expect(companyRateOf(new ApiError(400, 'validation', [{ code: 'pos_usd_rate_far' }]), 'pos_usd_rate_far')).toBeNull();
  });
});

describe('the rules of the offline till (third review)', () => {
  it('are kept with what the till last had from the server, for the same person only', () => {
    forgetTill();
    const rules = { ...NO_RULES, rounding: { step: 250, mode: 'nearest' } as const };
    rememberTill('user:las', { rules });
    expect(tillCache('user:las')?.rules?.rounding).toEqual({ step: 250, mode: 'nearest' });
    expect(tillCache('user:kay')).toBeNull();
    // the till takes the cash the server will book: 2,300 to the nearest 250 is 2,250, never 2,300
    expect(cashToTake(2_300, tillCache('user:las')!.rules!.rounding)).toBe(2_250);
    expect(cashToTake(2_300, NO_RULES.rounding)).toBe(2_300);
    // and never rounds a small sale down to nothing
    expect(cashToTake(100, { step: 250, mode: 'down' })).toBe(100);
  });

  it('no longer says a card pays the exact amount (cards are not offered at the till for now)', () => {
    for (const text of TILL_UI_TEXT.tu_roundHelp) expect(text).not.toMatch(/card|بطاق|کارت/i);
  });
});

describe('a kept sale refused for want of a supervisor (third review)', () => {
  const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
    id: 'k1', seq: 1, kind: 'pos_sale', path: '/api/pos/shifts/s1/sales', books: 'b'.repeat(32), createdAt: '2026-11-11T09:30:00.000Z',
    body: { currency: 'IQD', discount: 500, lines: [{ itemId: 'tea', qtyMilli: 2000, unitPrice: 2_000 }, { itemId: 'box', unit: 'box', unitQtyMilli: 500, qtyMilli: 5000, unitPrice: 20_000 }], offline: { reference: 'OFF-C1-0007' } },
    user: { id: 'u-las', name: 'Las' }, reference: 'OFF-C1-0007', summary: { total: 13_500, currency: 'IQD', lines: 2, register: 'C1' },
    state: 'refused', attempts: 1, lastTriedAt: null, error: { status: 400, code: 'validation', details: [{ code: 'pos_offline_supervisor' }] }, ...over
  });

  it('can be approved by a supervisor for that receipt and what it is worth, as the server reckons it', () => {
    expect(supervisorReview(entry())).toEqual({ shiftId: 's1', reference: 'OFF-C1-0007', amount: 4_000 + 10_000 - 500 });
  });

  it('is offered for that refusal only', () => {
    expect(supervisorReview(entry({ state: 'waiting', error: null }))).toBeNull();
    expect(supervisorReview(entry({ error: { status: 400, code: 'validation', details: [{ code: 'stock_insufficient' }] } }))).toBeNull();
    expect(supervisorReview(entry({ kind: 'voucher' }))).toBeNull();
  });
});
