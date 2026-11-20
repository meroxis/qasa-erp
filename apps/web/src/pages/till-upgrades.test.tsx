import { beforeEach, describe, expect, it } from 'vitest';
import { cashPartOf, changeInDinars, parseScan, splitPayments, usdWorth } from './pos-logic.ts';
import { findByScaleBarcode } from '../industry/scale-barcode.ts';
import { clearHeld, heldOn, HELD_MAX, holdBasket, setThisTill, takeHeld, thisTill } from '../industry/till.ts';
import { TILL_TEXT } from '../i18n/till.ts';

/** A label with a right check digit. */
function label(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return first12 + String((10 - (sum % 10)) % 10);
}

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(), key: () => null, length: 0
  } as Storage;
});

describe('card and wallets at the till', () => {
  it('pays the rest in cash, refuses parts past what is due', () => {
    expect(splitPayments(25_000, {})).toBeUndefined();
    expect(splitPayments(25_000, { card: null, fib: 0 })).toBeUndefined();
    expect(splitPayments(25_000, { card: 10_000 })).toEqual([{ method: 'cash', amount: 15_000 }, { method: 'card', amount: 10_000 }]);
    expect(splitPayments(25_000, { card: 15_000, qi: 10_000 })).toEqual([{ method: 'card', amount: 15_000 }, { method: 'qi', amount: 10_000 }]);
    expect(splitPayments(25_000, { card: 30_000 })).toBeNull();
    expect(splitPayments(25_000, { card: 1, fib: 1, zaincash: 1, qi: 1 })).toBeNull();
    expect(cashPartOf(25_000, splitPayments(25_000, { card: 10_000 }) ?? undefined)).toBe(15_000);
    expect(cashPartOf(25_000, undefined)).toBe(25_000);
  });
});

describe('dollar notes on a dinar sale', () => {
  it('works out the dollars’ dinars and the change in dinars', () => {
    expect(usdWorth(2000, 142_000)).toBe(28_400);
    expect(changeInDinars(25_000, 0, 2000, 142_000)).toBe(3_400);
    expect(changeInDinars(25_000, 5_000, 1000, 142_000)).toBe(-5_800);
    expect(changeInDinars(25_000, 30_000, 0, 142_000)).toBe(5_000);
  });
});

describe('scale labels that carry the price', () => {
  const meat = { id: 'm', code: 'MEAT', barcode: '2200017', unit: 'kg' as const, salePrice: 18_000, saleCurrency: 'IQD' as const };
  it('reads the price as a quantity at the price per kg, only for the prefixes set', () => {
    const code = label('220001727000');
    expect(findByScaleBarcode(code, [meat], ['22'])).toEqual({ item: meat, qtyMilli: 1500, price: 27_000 });
    expect(findByScaleBarcode(code, [meat])).toEqual({ item: meat, qtyMilli: 27_000 });
    expect(findByScaleBarcode(code, [{ ...meat, saleCurrency: 'USD' as const }], ['22'])).toBeNull();
    expect(parseScan(code, [meat], ['22'])).toMatchObject({ qtyMilli: 1500, exact: meat });
  });
});

describe('held baskets', () => {
  const basket = (shiftId: string) => ({ shiftId, currency: 'IQD' as const, rateText: '1420', partyId: '', discount: 500, total: 4_500, lines: [{ itemId: 'tea', qtyMilli: 2000, unit: null, unitPrice: 2_500 }] });
  it('holds and gives back baskets of a shift, and clears them at closing', () => {
    const a = holdBasket(basket('s1'))!;
    holdBasket(basket('s1'));
    holdBasket(basket('s2'));
    expect(heldOn('s1')).toHaveLength(2);
    expect(takeHeld('s2', a.id)).toBeNull();
    expect(takeHeld('s1', a.id)).toMatchObject({ discount: 500, lines: [{ itemId: 'tea' }] });
    expect(heldOn('s1')).toHaveLength(1);
    expect(clearHeld('s1')).toBe(1);
    expect(heldOn('s1')).toHaveLength(0);
    expect(heldOn('s2')).toHaveLength(1);
    expect(holdBasket({ ...basket('s3'), lines: [] })).toBeNull();
  });
  it('keeps at most HELD_MAX on a shift', () => {
    for (let i = 0; i < HELD_MAX; i++) expect(holdBasket(basket('s9'))).not.toBeNull();
    expect(holdBasket(basket('s9'))).toBeNull();
  });
  it('remembers the till of this PC', () => {
    expect(thisTill()).toBe('');
    setThisTill('t1');
    expect(thisTill()).toBe('t1');
    setThisTill('');
    expect(thisTill()).toBe('');
  });
});

describe('the till’s words', () => {
  it('has Arabic, English and Kurdish for every text', () => {
    for (const [key, v] of Object.entries(TILL_TEXT)) {
      expect(v, key).toHaveLength(3);
      for (const s of v) expect(s.trim(), key).not.toBe('');
    }
  });
});
