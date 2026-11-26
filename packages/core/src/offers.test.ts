import { describe, expect, it } from 'vitest';
import { applyOffers, offerActive, offerLineRows, offerRuleErrors, type OfferLine, type OfferRule } from './offers.ts';

const base: OfferRule = {
  id: 'o1', code: 'O1', names: { ar: 'عرض', en: 'Offer', ku: 'ئۆفەر' }, kind: 'buyGet', priority: 0, exclusive: false, maxPerSale: null,
  startsOn: null, endsOn: null, weekdays: null, fromTime: null, toTime: null, branchIds: null,
  items: ['cola'], categories: [], getItems: [], getCategories: [], buyMilli: 2000, getMilli: 1000, getPercent: 100,
  bundleMilli: null, bundlePrice: null, price: null, percentOff: null
};
const ctx = { date: '2026-11-20', minutes: 600, branchId: null, currency: 'IQD' as const, rateX100: 100 };
const line = (lineNo: number, itemId: string, qtyMilli: number, price: number, categoryId: string | null = null): OfferLine =>
  ({ lineNo, itemId, categoryId, qtyMilli, amount: Math.round((qtyMilli * price) / 1000) });

describe('buy X get Y', () => {
  it('gives one free for every two bought, the cheapest units first', () => {
    const r = applyOffers([line(1, 'cola', 7000, 1000)], [base], ctx);
    expect(r.total).toBe(2000); // 7 → two sets of three
    expect(r.byLine).toEqual({ 1: 2000 });
  });
  it('gives the cheaper item when the offer covers several', () => {
    const rule = { ...base, items: [], categories: ['drinks'] };
    const r = applyOffers([line(1, 'cola', 2000, 1500, 'drinks'), line(2, 'water', 1000, 500, 'drinks')], [rule], ctx);
    expect(r.total).toBe(500);
    // the free water's 500 is spread over the set by value (2.0): the colas bought carry most of it
    expect(r.byLine[1]! + r.byLine[2]!).toBe(500);
    expect(r.byLine[1]).toBeGreaterThan(r.byLine[2]!);
  });
  it('gives other goods at a percentage, and stops at the most per sale', () => {
    const rule = { ...base, getItems: ['chips'], getPercent: 50, buyMilli: 1000, maxPerSale: 2 };
    const r = applyOffers([line(1, 'cola', 5000, 1000), line(2, 'chips', 5000, 800)], [rule], ctx);
    expect(r.total).toBe(800); // two bags at half price
  });
  it('gives nothing when there are not enough', () => {
    expect(applyOffers([line(1, 'cola', 2000, 1000)], [base], ctx).total).toBe(0);
  });
});

describe('bundles and special prices', () => {
  it('sells any three from the list for a fixed price, dearest first', () => {
    const rule: OfferRule = { ...base, kind: 'bundle', items: ['a', 'b'], bundleMilli: 3000, bundlePrice: 5000 };
    const r = applyOffers([line(1, 'a', 2000, 2000), line(2, 'b', 2000, 2500)], [rule], ctx);
    // a set of b, b, a = 7000 → 5000; one a is left over
    expect(r.total).toBe(2000);
    expect(r.byLine[1]! + r.byLine[2]!).toBe(2000);
  });
  it('skips a bundle that is not cheaper', () => {
    const rule: OfferRule = { ...base, kind: 'bundle', items: ['a'], bundleMilli: 2000, bundlePrice: 9000 };
    expect(applyOffers([line(1, 'a', 2000, 2000)], [rule], ctx).total).toBe(0);
  });
  it('gives a special price per base unit and a percentage off', () => {
    const fixed: OfferRule = { ...base, kind: 'price', price: 750, buyMilli: null };
    expect(applyOffers([line(1, 'cola', 4000, 1000)], [fixed], ctx).total).toBe(1000);
    const pct: OfferRule = { ...base, kind: 'price', percentOff: 10, items: [], categories: ['veg'] };
    expect(applyOffers([line(1, 'tomato', 1500, 2000, 'veg')], [pct], ctx).total).toBe(300);
  });
  it('takes a dollar sale\'s fixed prices at its rate', () => {
    const fixed: OfferRule = { ...base, kind: 'price', price: 1500 };
    // $1.50 a can at 1,500 IQD/$ (rateX100 150000): 1500 IQD = $1.00
    const r = applyOffers([{ lineNo: 1, itemId: 'cola', categoryId: null, qtyMilli: 2000, amount: 300 }], [fixed], { ...ctx, currency: 'USD', rateX100: 150000 });
    expect(r.total).toBe(100);
  });
});

describe('which offer wins', () => {
  it('gives each unit one offer, the higher priority first', () => {
    const low: OfferRule = { ...base, id: 'low', code: 'LOW', kind: 'price', percentOff: 10 };
    const high: OfferRule = { ...base, id: 'high', code: 'HIGH', priority: 5 };
    const r = applyOffers([line(1, 'cola', 4000, 1000)], [low, high], ctx);
    // 3 cans in the buyGet (1 free), the 4th at 10% off
    expect(r.offers).toEqual([{ offerId: 'high', discount: 1000 }, { offerId: 'low', discount: 100 }]);
    expect(offerLineRows(r)).toEqual([
      { lineNo: 1, offerId: 'high', qtyMilli: 3000, discount: 1000 },
      { lineNo: 1, offerId: 'low', qtyMilli: 1000, discount: 100 }
    ]);
  });
  it('applies an exclusive offer alone, and only when nothing else did', () => {
    const excl: OfferRule = { ...base, id: 'x', code: 'X', kind: 'price', percentOff: 50, exclusive: true, items: ['chips'] };
    const r = applyOffers([line(1, 'cola', 3000, 1000), line(2, 'chips', 1000, 1000)], [base, excl], ctx);
    expect(r.offers.map((o) => o.offerId)).toEqual(['o1']);
    const first = { ...excl, priority: 9 };
    expect(applyOffers([line(1, 'cola', 3000, 1000), line(2, 'chips', 1000, 1000)], [base, first], ctx).offers.map((o) => o.offerId)).toEqual(['x']);
  });
});

describe('when an offer is on', () => {
  it('checks dates, weekdays, hours (past midnight too) and branches', () => {
    expect(offerActive({ ...base, startsOn: '2026-11-21' }, ctx)).toBe(false);
    expect(offerActive({ ...base, endsOn: '2026-11-19' }, ctx)).toBe(false);
    expect(offerActive({ ...base, weekdays: [5] }, ctx)).toBe(true); // 20 Nov 2026 is a Friday
    expect(offerActive({ ...base, weekdays: [4] }, ctx)).toBe(false);
    expect(offerActive({ ...base, fromTime: '09:00', toTime: '11:00' }, ctx)).toBe(true);
    expect(offerActive({ ...base, fromTime: '09:00', toTime: '10:00' }, ctx)).toBe(false);
    expect(offerActive({ ...base, fromTime: '22:00', toTime: '02:00' }, { ...ctx, minutes: 60 })).toBe(true);
    expect(offerActive({ ...base, fromTime: '09:00', toTime: '11:00' }, { ...ctx, minutes: null })).toBe(false);
    expect(offerActive({ ...base, branchIds: ['b1'] }, ctx)).toBe(false);
    expect(offerActive({ ...base, branchIds: ['b1'] }, { ...ctx, branchId: 'b1' })).toBe(true);
  });
});

describe('checking an offer', () => {
  it('names what is wrong', () => {
    const { id: _id, ...rule } = base;
    expect(offerRuleErrors(rule)).toEqual([]);
    expect(offerRuleErrors({ ...rule, items: [], getPercent: 0, fromTime: '25:00', toTime: '10:00' }).map((e) => e.code))
      .toEqual(['offer_hours_invalid', 'offer_goods_required', 'offer_percent_invalid']);
    expect(offerRuleErrors({ ...rule, kind: 'price', price: 100, percentOff: 5 }).map((e) => e.code)).toEqual(['offer_price_or_percent']);
  });
});
