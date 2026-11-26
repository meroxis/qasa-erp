import { describe, expect, it } from 'vitest';
import { cashToTake } from '@qasa/core';
import { ApiError } from '../api.ts';
import { rememberTill, tillCache, forgetTill } from '../industry/offline-till.ts';
import { supervisorReview } from '../pages/Outbox.tsx';
import type { OutboxEntry } from '../industry/outbox.ts';
import { approvalNeeds, rateStanding, companyRateOf, covers, dropDead, priceSubjectOf, type HeldApproval } from './approvals.ts';
import { NO_RULES, type Approval } from './rules-api.ts';
import { refundWithPin } from './Supervisor.tsx';
import { tillSource } from '../till-source.ts';
import { readFileSync } from 'node:fs';
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
    expect(list[0]!.what).toEqual({ itemId: 'tea', amount: 2_000, currency: 'IQD' });
    expect(list[1]!.what).toEqual({ itemId: 'tea', unit: 'box', amount: 20_000, currency: 'IQD' });
    // the item's own unit named on the line is the item itself, as the server writes it
    expect(priceSubjectOf({ itemId: 'sugar', itemUnit: 'piece', unit: 'piece' })).toBe('sugar|');
  });

  it('names the discount, and the customer and the amount that goes on their account', () => {
    expect(needs({ discount: 1_000 })).toEqual([]);
    expect(needs({ discount: 1_500 })).toEqual([{ action: 'discount', amount: 1_500, gross: 10_000, what: { amount: 1_500, gross: 10_000 } }]);
    expect(needs({ overLimit: true, partyId: 'ali', onAccount: 4_000 })).toEqual([{ action: 'credit_over', subject: 'ali', amount: 4_000, what: { partyId: 'ali', amount: 4_000 } }]);
  });

  it('knows which approvals still cover the basket: a lower price, a larger discount or another customer needs a new one', () => {
    const price: HeldApproval = { action: 'price', token: 't1', subject: 'tea|', amount: 2_500, currency: 'IQD' };
    const [need] = needs({ lines: [{ ...tea, unitPrice: 2_500 }] });
    expect(covers(price, need!)).toBe(true);
    expect(covers(price, needs({ lines: [{ ...tea, unitPrice: 2_000 }] })[0]!)).toBe(false);
    expect(covers({ ...price, subject: 'sugar|' }, need!)).toBe(false);
    const discount: HeldApproval = { action: 'discount', token: 't2', amount: 1_500, gross: 10_000 };
    expect(covers(discount, needs({ discount: 1_200 })[0]!)).toBe(true);
    expect(covers(discount, needs({ discount: 2_000 })[0]!)).toBe(false);
    const credit: HeldApproval = { action: 'credit_over', token: 't3', subject: 'ali', amount: 4_000 };
    expect(covers(credit, needs({ overLimit: true, partyId: 'sam', onAccount: 1_000 })[0]!)).toBe(false);
    // an approval from before what it was for was kept covers nothing: it is asked again
    expect(covers({ action: 'price', token: 'old' }, need!)).toBe(false);
  });

  it('asks again when the basket got smaller under its discount, or the sale changed currency (verify report, finding 6)', () => {
    // 1,500 approved on a basket of 10,000 (15%)
    const discount: HeldApproval = { action: 'discount', token: 't2', amount: 1_500, gross: 10_000 };
    expect(covers(discount, needs({ discount: 1_500, subtotal: 10_000 })[0]!)).toBe(true);
    expect(covers(discount, needs({ discount: 1_500, subtotal: 12_000 })[0]!)).toBe(true);
    // the same 1,500 off a basket of 5,000 is 30%: not what was approved
    expect(covers(discount, needs({ discount: 1_500, subtotal: 5_000 })[0]!)).toBe(false);
    // the same share of the smaller basket is covered
    expect(covers(discount, needs({ discount: 750, subtotal: 5_000 })[0]!)).toBe(true);
    // one kept before the basket was kept with it covers nothing
    expect(covers({ action: 'discount', token: 'old', amount: 1_500 }, needs({ discount: 1_500 })[0]!)).toBe(false);
    // a price approved in dinars is not one in dollars
    const price: HeldApproval = { action: 'price', token: 't1', subject: 'tea|', amount: 2_500, currency: 'IQD' };
    expect(covers(price, needs({ lines: [{ ...tea, unitPrice: 2_500 }], currency: 'USD' })[0]!)).toBe(false);
    expect(needs({ lines: [{ ...tea, unitPrice: 2_500 }], currency: 'USD' })[0]!.what).toMatchObject({ currency: 'USD' });
  });

  it('holds dollars to the day\'s rate: 3% free, to 15% a supervisor approves that very rate, beyond is a slip (verify report, finding 5)', () => {
    const rate = { referenceX100: 150_000, freePct: 3, bandPct: 15 };
    expect([154_500, 145_500, 150_000].map((r) => rateStanding(r, rate))).toEqual(['ok', 'ok', 'ok']);
    expect([154_600, 145_400, 172_500, 127_500].map((r) => rateStanding(r, rate))).toEqual(['approve', 'approve', 'approve', 'approve']);
    expect([172_600, 127_400, 15_000, 0].map((r) => rateStanding(r, rate))).toEqual(['far', 'far', 'far', 'far']);
    // a dollar sale's own rate, and dollar notes on a dinar sale
    expect(needs({ rate, saleRateX100: 151_000 })).toEqual([]);
    const [sale] = needs({ rate, saleRateX100: 140_000, currency: 'USD' });
    expect(sale).toMatchObject({ action: 'rate', subject: 'sale:140000', what: { rate: { kind: 'sale', rateX100: 140_000 } } });
    const [notes] = needs({ rate, notesRateX100: 160_000 });
    expect(notes).toMatchObject({ action: 'rate', subject: 'notes:160000' });
    // an approval is for that very rate and kind
    const held: HeldApproval = { action: 'rate', token: 'r', subject: 'notes:160000', amount: 160_000 };
    expect(covers(held, notes!)).toBe(true);
    expect(covers(held, needs({ rate, notesRateX100: 161_000 })[0]!)).toBe(false);
    expect(covers(held, needs({ rate, saleRateX100: 160_000, currency: 'USD' })[0]!)).toBe(false);
    // a server that names no rate (an older one) asks nothing here: it decides itself
    expect(needs({ saleRateX100: 140_000 })).toEqual([]);
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

describe('a refund on the invoice screens that needs a supervisor (verify report, finding 7)', () => {
  const refusal = (action: string) => new ApiError(400, 'validation', [{ code: 'pos_needs_supervisor', action }]);
  const approval: Approval = { token: 'tok', approver: 'Raz', action: 'refund', expiresAt: '', used: false };

  it('asks for the PIN there and sends the refund again with the approval; never for another error, never without a PIN', async () => {
    const kept: string[] = [];
    let sent = 0;
    const send = async () => { sent += 1; if (!kept.length) throw refusal('refund'); return 'returned'; };
    expect(await refundWithPin(send, async () => approval, (t) => kept.push(t))).toBe('returned');
    expect([sent, kept]).toEqual([2, ['tok']]);
    // the dialog closed with no PIN: the server's refusal is what the page shows, and nothing is sent again
    let asked = 0;
    sent = 0;
    await expect(refundWithPin(async () => { sent += 1; throw refusal('refund'); }, async () => { asked += 1; return null; }, () => {})).rejects.toMatchObject({ code: 'validation' });
    expect([sent, asked]).toEqual([1, 1]);
    // another refusal (a date, another approval) is not a refund's: nobody is asked
    for (const other of [refusal('price'), new ApiError(409, 'period_closed', null)]) {
      asked = 0;
      await expect(refundWithPin(async () => { throw other; }, async () => { asked += 1; return approval; }, () => {})).rejects.toBe(other);
      expect(asked).toBe(0);
    }
    // a refund that needs nobody goes once
    sent = 0;
    expect(await refundWithPin(async () => { sent += 1; return 1; }, async () => approval, () => {})).toBe(1);
    expect(sent).toBe(1);
  });

  it('is what the invoice page\'s return and cancel go through, with the office route for the PIN', () => {
    const page = readFileSync(new URL('../pages/Invoices.tsx', import.meta.url), 'utf8');
    expect(page).toMatch(/refundPin\.run\(id, undefined, \(\) => api\.cancelInvoice\(id, cancelDate\)\)/);
    expect(page).toMatch(/refundPin\.run\(v\.id, back, \(\) => sendReturn\(v\.id,/);
    expect(page.match(/\{refundPin\.dialog\}/g)?.length).toBe(2);
    expect(tillSource()).toMatch(/request<Approval>\('POST', '\/api\/refund-approvals'/);
  });
});

describe('an admin unlocks approvals (verify report, finding 4)', () => {
  it('has the button beside the notice, and the words in three languages', () => {
    const settings = readFileSync(new URL('./TillRulesSettings.tsx', import.meta.url), 'utf8');
    expect(settings).toMatch(/data-action="pin-unlock" onClick=\{\(\) => void tillRulesApi\.unlockPins\(\)/);
    expect(settings).toMatch(/\(rules\.pinAlert \|\| rules\.pinLocked\)/);
    for (const key of ['tu_pinUnlock', 'tu_pinUnlocked', 'tu_pinLockedNow', 'tu_rateToday', 'tu_rateAsk', 'tu_act_rate'] as const) {
      expect(TILL_UI_TEXT[key].every((s) => s.length > 0), key).toBe(true);
    }
  });
});
