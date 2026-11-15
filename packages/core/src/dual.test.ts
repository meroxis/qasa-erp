import { describe, expect, it } from 'vitest';
import { AMOUNTS_SHOW, dualLines, fromBase, isAmountsShow, usableRate } from './dual.ts';

const RATE = 131000; // 1,310 dinars a dollar

describe('the choice', () => {
  it('has three values, dinar only first (the default)', () => {
    expect(AMOUNTS_SHOW).toEqual(['iqd', 'iqd_usd', 'usd_iqd']);
    for (const v of AMOUNTS_SHOW) expect(isAmountsShow(v)).toBe(true);
    for (const v of ['IQD', 'usd', '', null, undefined, 1, ['iqd']]) expect(isAmountsShow(v)).toBe(false);
  });
});

describe('dinars in dollars', () => {
  it('rounds to the nearest cent, half away from zero', () => {
    expect(fromBase(1_310_000, RATE)).toBe(100_000); // $1,000.00
    expect(fromBase(1_000_000, RATE)).toBe(76_336); // 763.358… → $763.36
    expect(fromBase(655, RATE)).toBe(50); // 0.5 dollars exactly
    expect(fromBase(6.55, RATE)).toBe(1); // half a cent goes up
    expect(fromBase(-1_000_000, RATE)).toBe(-76_336);
    expect(fromBase(-6.55, RATE)).toBe(-1);
    expect(fromBase(0, RATE)).toBe(0);
  });

  it('works with a rate that has a fraction (1,465.50)', () => {
    expect(fromBase(146_550, 146_550)).toBe(10_000);
  });

  it('only converts with a whole positive rate', () => {
    for (const r of [RATE, 1]) expect(usableRate(r)).toBe(true);
    for (const r of [0, -131000, 1.5, Number.NaN, null, undefined]) expect(usableRate(r)).toBe(false);
  });
});

describe('what an amount shows', () => {
  const dinars = { IQD: 1_310_000, USD: 0 };
  const dollars = { IQD: 0, USD: 50_000 };
  const both = { IQD: 655_000, USD: 50_000 };

  it('dinar only: the real amounts, as before, whatever the rate', () => {
    expect(dualLines(dinars, 'iqd', RATE)).toEqual({ first: [{ amount: 1_310_000, currency: 'IQD', approx: false }], second: null });
    expect(dualLines(dollars, 'iqd', RATE).first).toEqual([{ amount: 50_000, currency: 'USD', approx: false }]);
    expect(dualLines(both, 'iqd', RATE).first.map((l) => l.currency)).toEqual(['IQD', 'USD']);
    expect(dualLines({ IQD: 0, USD: 0 }, 'iqd', RATE).first).toEqual([{ amount: 0, currency: 'IQD', approx: false }]);
  });

  it('dinar and dollar: the dinars, and ≈ their dollars under them', () => {
    expect(dualLines(dinars, 'iqd_usd', RATE)).toEqual({
      first: [{ amount: 1_310_000, currency: 'IQD', approx: false }],
      second: { amount: 100_000, currency: 'USD', approx: true }
    });
  });

  it('dollar and dinar: ≈ the dollars first, the real dinars under them', () => {
    expect(dualLines(dinars, 'usd_iqd', RATE)).toEqual({
      first: [{ amount: 100_000, currency: 'USD', approx: true }],
      second: { amount: 1_310_000, currency: 'IQD', approx: false }
    });
  });

  it('real dollars stay dollars, on top in both orders, and are converted once, to dinars', () => {
    for (const show of ['usd_iqd', 'iqd_usd'] as const) {
      expect(dualLines(dollars, show, RATE)).toEqual({
        first: [{ amount: 50_000, currency: 'USD', approx: false }],
        second: { amount: 655_000, currency: 'IQD', approx: true }
      });
    }
  });

  it('a safe with both: the two real amounts, and ≈ the whole in the other currency', () => {
    expect(dualLines(both, 'iqd_usd', RATE)).toEqual({
      first: [{ amount: 655_000, currency: 'IQD', approx: false }, { amount: 50_000, currency: 'USD', approx: false }],
      second: { amount: 100_000, currency: 'USD', approx: true }
    });
    expect(dualLines(both, 'usd_iqd', RATE)).toEqual({
      first: [{ amount: 50_000, currency: 'USD', approx: false }, { amount: 655_000, currency: 'IQD', approx: false }],
      second: { amount: 1_310_000, currency: 'IQD', approx: true }
    });
  });

  it('keeps the sign of a negative amount (a loss, a difference)', () => {
    expect(dualLines({ IQD: -1_000_000, USD: 0 }, 'iqd_usd', RATE).second).toEqual({ amount: -76_336, currency: 'USD', approx: true });
    expect(dualLines({ IQD: 0, USD: -50_000 }, 'usd_iqd', RATE).second).toEqual({ amount: -655_000, currency: 'IQD', approx: true });
    // a dinar shortage and a dollar surplus: the whole is what they come to together
    expect(dualLines({ IQD: -1_310_000, USD: 50_000 }, 'iqd_usd', RATE).second).toEqual({ amount: -50_000, currency: 'USD', approx: true });
  });

  it('without a rate: only the stored currency, nothing converted', () => {
    for (const rate of [null, undefined, 0, -5, 1.5]) {
      expect(dualLines(dinars, 'iqd_usd', rate)).toEqual({ first: [{ amount: 1_310_000, currency: 'IQD', approx: false }], second: null });
      expect(dualLines(dinars, 'usd_iqd', rate)).toEqual({ first: [{ amount: 1_310_000, currency: 'IQD', approx: false }], second: null });
      expect(dualLines(dollars, 'usd_iqd', rate).second).toBeNull();
    }
  });

  it('shows zero as zero, with no "≈ $0.00" under it', () => {
    for (const show of ['iqd_usd', 'usd_iqd'] as const) {
      expect(dualLines({ IQD: 0, USD: 0 }, show, RATE)).toEqual({ first: [{ amount: 0, currency: 'IQD', approx: false }], second: null });
    }
  });
});
