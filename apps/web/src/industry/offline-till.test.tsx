import { describe, expect, it } from 'vitest';
import { ApiError, type ItemView, type SendOptions } from '../api.ts';
import { posSaleLine } from '../pages/pos-logic.ts';
import {
  baseQtyOf, forgetTill, offlineMethods, offlineReceipt, offlineRefusal, payTillSale, rememberTill, shortStock, takeFromStock, tillCache
} from './offline-till.ts';
import { SALE_TIMEOUT_MS, type HeldKey } from './outbox.ts';
import type { SaleInput } from './pos-api.ts';

const item = (over: Partial<ItemView> = {}): ItemView => ({
  id: 'tea', code: 'TEA', barcode: '6260000000017', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 2_500, saleCurrency: 'IQD',
  trackStock: true, active: true, qtyMilli: 5_000, value: 0, hasMoves: true, units: [{ unit: 'box', factorMilli: 12_000, barcode: '6260000000024', salePrice: 27_000 }],
  saleUnit: null, purchaseUnit: null, updatedAt: null, trackBatches: false, trackExpiry: false, categoryId: null, brandId: null, reorderMilli: null, ...over
});

describe('the offline till', () => {
  it('sells for cash, by card and by wallet, never on a customer\'s account', () => {
    expect(offlineMethods(['cash', 'card', 'fib', 'account'])).toEqual(['cash', 'card', 'fib']);
    expect(offlineRefusal({ payments: [{ method: 'cash', amount: 1 }, { method: 'card', amount: 2 }] })).toBeNull();
    expect(offlineRefusal({})).toBeNull();
    expect(offlineRefusal({ payments: [{ method: 'cash', amount: 1 }, { method: 'account', amount: 2 }] })).toBe('pos_offline_on_account');
    // loyalty points need the customer's live balance: never kept for later either
    expect(offlineRefusal({ loyaltyPoints: 50 })).toBe('pos_offline_loyalty');
    expect(offlineRefusal({ loyaltyPoints: 0 })).toBeNull();
  });

  it('checks a sale against the stock last known (boxes counted in pieces), says what is short, and does not block it', () => {
    const tea = item();
    const cup = item({ id: 'cup', code: 'CUP', trackStock: false, qtyMilli: 0, units: [] });
    expect(baseQtyOf({ item: tea, qtyMilli: 1_000, unit: 'box' })).toBe(12_000);
    expect(baseQtyOf({ item: tea, qtyMilli: 2_000, unit: null })).toBe(2_000);
    expect(shortStock([{ item: tea, qtyMilli: 3_000, unit: null }, { item: cup, qtyMilli: 9_000, unit: null }])).toEqual([]);
    expect(shortStock([{ item: tea, qtyMilli: 3_000, unit: null }, { item: tea, qtyMilli: 3_000, unit: null }]))
      .toEqual([{ itemId: 'tea', code: 'TEA', name: tea.name, wantMilli: 6_000, haveMilli: 5_000 }]);
    expect(shortStock([{ item: tea, qtyMilli: 1_000, unit: 'box' }])).toHaveLength(1);
    // the next sale is checked against what is left
    const left = takeFromStock([tea, cup], [{ item: tea, qtyMilli: 2_000, unit: null }, { item: cup, qtyMilli: 1_000, unit: null }]);
    expect(left.map((i) => i.qtyMilli)).toEqual([3_000, 0]);
    expect(takeFromStock(left, [{ item: left[0]!, qtyMilli: 4_000, unit: null }])[0]!.qtyMilli).toBe(-1_000);
  });

  it('prints a receipt shaped like the invoice the server will make, numbered with the temporary reference', () => {
    const tea = item();
    const lines = [{ item: tea, qtyMilli: 2_000, unit: null, unitPrice: 2_500 }, { item: tea, qtyMilli: 1_000, unit: 'box' as const, unitPrice: 27_000 }];
    const r = offlineReceipt({
      key: 'k', reference: 'OFF-Counter1-0004', soldAt: '2026-11-11T09:30:00.000Z', soldOn: '2026-11-11', shift: { warehouseId: 'w', cashAccountCode: '1811' }, cashier: 'Mer',
      lines, currency: 'IQD', rateX100: 100, discount: 2_000, party: null, payments: [{ method: 'cash', amount: 20_000 }, { method: 'card', amount: 10_000 }]
    });
    expect(r).toMatchObject({ number: 'OFF-Counter1-0004', offlineRef: 'OFF-Counter1-0004', status: 'posted', subtotal: 32_000, total: 30_000, discount: 2_000, date: '2026-11-11', createdBy: 'Mer' });
    expect(r.lines.map((l) => [l.qtyMilli, l.unitQtyMilli, l.lineUnit, l.amount])).toEqual([[2_000, null, null, 5_000], [12_000, 1_000, 'box', 27_000]]);
    expect(r.payments?.map((p) => [p.method, p.amount])).toEqual([['cash', 20_000], ['card', 10_000]]);
    // what the receipt says is what the server gets: the same lines, in the same units
    expect(lines.map(posSaleLine)).toEqual([{ itemId: 'tea', qtyMilli: 2_000, unitPrice: 2_500 }, { itemId: 'tea', unit: 'box', unitQtyMilli: 1_000, unitPrice: 27_000 }]);
    // a dollar sale's base total at its rate
    expect(offlineReceipt({ ...{ key: 'k', reference: 'OFF-C-0001', soldAt: '', soldOn: '', shift: { warehouseId: 'w', cashAccountCode: '1811' }, cashier: 'Las' }, lines: [{ item: tea, qtyMilli: 1_000, unit: null, unitPrice: 200 }], currency: 'USD', rateX100: 142_000, discount: 0, party: null, payments: [] }).baseTotal).toBe(284_000);
  });

  it('keeps what it last had for the person signed in only, in memory', () => {
    forgetTill();
    rememberTill('user:u-mer', { items: [item()] });
    expect(tillCache('user:u-mer')?.items).toHaveLength(1);
    expect(tillCache('user:u-las')).toBeNull();
    expect(tillCache(null)).toBeNull();
    // another person starts afresh
    rememberTill('user:u-las', { methods: ['cash'] });
    expect(tillCache('user:u-las')).toMatchObject({ items: null, methods: ['cash'] });
    expect(tillCache('user:u-mer')).toBeNull();
    forgetTill();
  });
});

/**
 * A till on a PC with an outbox, and an office server that books a sale once per key. `answer`: 'ok'; 'lost' (the
 * server books it, but its answer never comes back: a slow link, the 12-second limit); 'down' (not reached at all);
 * 'expired' (refused until the cashier confirms selling stock past its expiry date).
 */
type Answer = 'ok' | 'lost' | 'down' | 'expired';
function till() {
  const booked: { key: string | undefined; body: SaleInput }[] = [];
  const byKey = new Map<string, number>();
  const sent: { body: SaleInput; options: SendOptions }[] = [];
  const kept: { body: SaleInput; key: string }[] = [];
  const s = {
    answer: 'ok' as Answer,
    /** the answers to the next tries, in turn (then `answer`) */
    next: [] as Answer[],
    keepFails: null as ApiError | null,
    keepFirst: false,
    held: null as HeldKey | null,
    asked: 0,
    booked, sent, kept,
    pay: (sale: SaleInput, outbox = true) => payTillSale({
      sale,
      outbox: outbox ? { held: s.held, hold: (h) => { s.held = h; }, keepFirst: s.keepFirst } : null,
      send: async (body, options) => {
        sent.push({ body, options });
        const answer = s.next.shift() ?? s.answer;
        if (answer === 'down') throw new ApiError(0, 'network', null);
        if (answer === 'expired' && !body.allowExpired) throw new ApiError(400, 'validation', [{ code: 'batch_expired' }]);
        let n = options.key ? byKey.get(options.key) : undefined;
        if (n === undefined) {
          booked.push({ key: options.key, body });
          n = booked.length;
          if (options.key) byKey.set(options.key, n);
        }
        if (answer === 'lost') throw new ApiError(0, 'network', null);
        return { invoice: n };
      },
      keep: async (body, key) => {
        if (s.keepFails) throw s.keepFails;
        kept.push({ body, key });
      },
      askExpired: async (e) => {
        s.asked += 1;
        return e instanceof ApiError && JSON.stringify(e.details).includes('batch_expired');
      }
    })
  };
  return s;
}

const cashSale = (qtyMilli = 2_000): SaleInput => ({ currency: 'IQD', discount: 0, lines: [{ itemId: 'tea', qtyMilli, unitPrice: 2_500 }] });
const creditSale = (): SaleInput => ({
  currency: 'IQD', partyId: 'c-raz', discount: 0, lines: [{ itemId: 'tea', qtyMilli: 4_000, unitPrice: 2_500 }],
  payments: [{ method: 'cash', amount: 4_000 }, { method: 'account', amount: 6_000 }]
});

describe('paying at a till on a PC with an outbox', () => {
  it('a sale on a customer\'s account waits for the answer; if none comes it may be booked, and Pay again books it once', async () => {
    const t = till();
    t.answer = 'lost';
    // the server booked it, the answer was lost: not "not booked", and nothing kept (it can't be, on account)
    expect(await t.pay(creditSale())).toEqual({ kind: 'unsure', error: null });
    expect(t.sent[0]!.options.timeoutMs).toBeUndefined();
    expect(t.held).toMatchObject({ lost: true });
    expect(t.kept).toEqual([]);
    // the link is back: Pay (F9) again sends the same key, the server answers from the first try
    t.answer = 'ok';
    expect(await t.pay(creditSale())).toEqual({ kind: 'sold', result: { invoice: 1 } });
    expect(t.sent.map((x) => x.options.key)).toEqual([t.held!.key, t.held!.key]);
    expect(t.booked).toHaveLength(1);
  });

  it('a cash sale with no answer in time is kept with the key it was sent with; sent later, it is booked once', async () => {
    const t = till();
    t.answer = 'lost';
    expect(await t.pay(cashSale())).toEqual({ kind: 'kept' });
    expect(t.sent[0]!.options).toEqual({ key: t.held!.key, timeoutMs: SALE_TIMEOUT_MS });
    expect(t.kept).toEqual([{ body: cashSale(), key: t.held!.key }]);
  });

  it('when keeping fails after a lost answer, it may be booked, and Pay again uses the same key', async () => {
    const t = till();
    t.answer = 'lost';
    t.keepFails = new ApiError(0, 'outbox_unavailable', null);
    const first = await t.pay(cashSale());
    expect(first).toMatchObject({ kind: 'unsure', error: { code: 'outbox_unavailable' } });
    const key = t.held!.key;
    t.keepFails = new ApiError(0, 'outbox_full', null);
    expect(await t.pay(cashSale())).toMatchObject({ kind: 'unsure', error: { code: 'outbox_full' } });
    t.answer = 'ok';
    expect(await t.pay(cashSale())).toEqual({ kind: 'sold', result: { invoice: 1 } });
    expect(new Set(t.sent.map((x) => x.options.key))).toEqual(new Set([key]));
    expect(t.booked).toHaveLength(1);
  });

  it('while the server is known to be away, or earlier sales wait, the sale is kept at once with its held key', async () => {
    const t = till();
    t.answer = 'lost';
    t.keepFails = new ApiError(0, 'outbox_write_failed', null);
    await t.pay(cashSale());
    const key = t.held!.key;
    t.keepFails = null;
    t.keepFirst = true;
    expect(await t.pay(cashSale())).toEqual({ kind: 'kept' });
    expect(t.kept).toEqual([{ body: cashSale(), key }]);
    expect(t.sent).toHaveLength(1);
    // on account it can't be kept: refused, and the lost try stays marked (it may be booked)
    const credit = till();
    credit.answer = 'lost';
    await credit.pay(creditSale());
    credit.keepFirst = true;
    credit.keepFails = new ApiError(400, 'validation', [{ code: 'pos_offline_on_account' }]);
    await expect(credit.pay(creditSale())).rejects.toMatchObject({ status: 400 });
    expect(credit.held).toMatchObject({ lost: true });
  });

  it('another sale gets a key of its own: a changed cart, or the same cart after the last one was cleared', async () => {
    const t = till();
    t.answer = 'down';
    t.keepFails = new ApiError(0, 'outbox_unavailable', null);
    await t.pay(cashSale(2_000));
    const first = t.held!.key;
    // the same sale with its fields in another order is the same sale
    await t.pay({ lines: [{ unitPrice: 2_500, qtyMilli: 2_000, itemId: 'tea' }], discount: 0, currency: 'IQD' } as SaleInput);
    expect(t.held!.key).toBe(first);
    // a changed cart while that try may be booked: refused, the try stays held (its warning with it), nothing is sent
    const sentBefore = t.sent.length;
    await expect(t.pay(cashSale(3_000))).rejects.toMatchObject({ code: 'changed_after_unsure' });
    expect(t.held).toMatchObject({ key: first, lost: true });
    expect(t.sent).toHaveLength(sentBefore);
    // the cashier checked and it isn't there ("I checked: it isn't there" drops the held key): a key of its own
    t.held = null;
    await t.pay(cashSale(3_000));
    expect(t.held!.key).not.toBe(first);
    // booked or kept, the page drops the key with the cart: the next customer's identical cart is a new sale
    t.answer = 'ok';
    t.held = null;
    await t.pay(cashSale(2_000));
    t.held = null;
    await t.pay(cashSale(2_000));
    expect(t.booked).toHaveLength(2);
    expect(t.booked[0]!.key).not.toBe(t.booked[1]!.key);
  });

  it('stock past its expiry date, once confirmed, is sent so on every try of that sale, without asking again', async () => {
    const t = till();
    // the server refuses, the cashier confirms, it goes again with the same key
    t.next = ['expired'];
    expect(await t.pay(cashSale())).toEqual({ kind: 'sold', result: { invoice: 1 } });
    expect(t.sent.map((x) => [x.body.allowExpired ?? false, x.options.key])).toEqual([[false, t.held!.key], [true, t.held!.key]]);

    // the confirmed try goes out and its answer is lost (and it can't be kept)
    const lost = till();
    lost.next = ['expired', 'lost'];
    lost.keepFails = new ApiError(0, 'outbox_unavailable', null);
    expect(await lost.pay(cashSale())).toMatchObject({ kind: 'unsure' });
    expect(lost.held).toMatchObject({ allowExpired: true, lost: true });
    expect(await lost.pay(cashSale())).toEqual({ kind: 'sold', result: { invoice: 1 } });
    expect(lost.asked).toBe(1);
    expect(lost.sent.at(-1)!.body.allowExpired).toBe(true);
    expect(lost.booked).toHaveLength(1);
  });

  it('without an outbox (a browser, the server PC) it sends as before 1.2: no key and no time limit', async () => {
    const t = till();
    expect(await t.pay(cashSale(), false)).toEqual({ kind: 'sold', result: { invoice: 1 } });
    expect(t.sent[0]!.options).toEqual({});
    t.answer = 'down';
    await expect(t.pay(cashSale(), false)).rejects.toMatchObject({ code: 'network' });
    expect(t.held).toBeNull();
  });
});
