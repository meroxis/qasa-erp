import { describe, expect, it } from 'vitest';
import type { OfferRule } from '@qasa/core';
import { isKey, makeI18n, type Key } from '../i18n.ts';
import { OFFER_TEXT } from '../i18n/offers.ts';
import { offerState, offerSummary } from '../pages/Offers.tsx';
import { tillOfferPreview } from './offers-api.ts';
import { offlineReceipt } from './offline-till.ts';
import type { ItemView } from '../api.ts';

const noop = () => {};
const en = makeI18n('en', 'western', noop, noop);

const rule: OfferRule = {
  id: 'o1', code: 'B2G1', names: { ar: 'عرض', en: 'Buy 2 get 1', ku: 'ئۆفەر' }, kind: 'buyGet', priority: 0, exclusive: false, maxPerSale: null,
  startsOn: null, endsOn: null, weekdays: null, fromTime: null, toTime: null, branchIds: null,
  items: ['cola'], categories: [], getItems: [], getCategories: [], buyMilli: 2000, getMilli: 1000, getPercent: 100,
  bundleMilli: null, bundlePrice: null, price: null, percentOff: null
};

describe('offers on the screens', () => {
  it('has every text in Arabic, English and Kurdish', () => {
    for (const [key, texts] of Object.entries(OFFER_TEXT)) {
      expect(isKey(key), key).toBe(true);
      expect(texts.every((x) => x.trim().length > 0), key).toBe(true);
    }
    for (const k of ['buyGet', 'bundle', 'price']) expect(isKey(`of_k_${k}` as Key) && isKey(`of_k_${k}_help` as Key), k).toBe(true);
  });

  it('says where an offer stands: off, ended, not yet or not at this hour, or on now', () => {
    const now = new Date(2026, 10, 20, 17, 30); // a Friday, half past five
    const on = { active: true, startsOn: '2026-11-01', endsOn: null, weekdays: null, fromTime: null, toTime: null };
    expect(offerState(on, now)).toBe('onNow');
    expect(offerState({ ...on, active: false }, now)).toBe('off');
    expect(offerState({ ...on, endsOn: '2026-11-19' }, now)).toBe('ended');
    expect(offerState({ ...on, startsOn: '2026-11-21' }, now)).toBe('scheduled');
    expect(offerState({ ...on, fromTime: '16:00', toTime: '18:00' }, now)).toBe('onNow');
    expect(offerState({ ...on, fromTime: '09:00', toTime: '11:00' }, now)).toBe('scheduled');
    expect(offerState({ ...on, weekdays: [5] }, now)).toBe('onNow');
    expect(offerState({ ...on, weekdays: [6] }, now)).toBe('scheduled');
  });

  it('says in a line what an offer gives', () => {
    expect(offerSummary(en, rule)).toBe('Buy (quantity) 2 · Get (quantity) 1');
    expect(offerSummary(en, { ...rule, kind: 'price', percentOff: 15 })).toBe('−15%');
  });

  it('previews the offers at the till as the server works them out, and the offline receipt carries them', () => {
    const cola = { id: 'cola', code: 'COLA', name: { ar: 'كولا', en: 'Cola', ku: 'کۆلا' }, unit: 'piece', units: [], trackStock: true, qtyMilli: 10_000, categoryId: null } as unknown as ItemView;
    const result = tillOfferPreview([{ itemId: 'cola', categoryId: null, qtyMilli: 3000, amount: 3_000 }], [rule], { currency: 'IQD', rateX100: 100 });
    expect(result.total).toBe(1_000);
    const receipt = offlineReceipt({
      key: 'k', reference: 'OFF-1-0001', soldAt: '2026-11-20T10:00:00.000Z', soldOn: '2026-11-20', shift: { warehouseId: 'w', cashAccountCode: '1811' }, cashier: 'Raz',
      lines: [{ item: cola, qtyMilli: 3000, unit: null, unitPrice: 1_000 }], currency: 'IQD', rateX100: 100, discount: 100, party: null, payments: [],
      offers: { result, rules: [rule] }
    });
    expect(receipt).toMatchObject({ subtotal: 3_000, discount: 1_100, offerDiscount: 1_000, total: 1_900 });
    expect(receipt.offers).toEqual([{ offerId: 'o1', code: 'B2G1', names: rule.names, discount: 1_000, lines: [{ lineNo: 1, qtyMilli: 3000, discount: 1_000 }] }]);
    expect(receipt.lines[0]!.offerDiscount).toBe(1_000);
  });
});
