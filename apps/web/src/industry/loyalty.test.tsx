import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOYALTY_KINDS } from '@qasa/core';
import { isKey, makeI18n } from '../i18n.ts';
import { loyaltyKindLabel, loyaltyLines, redeemRange, wholeOf } from './Loyalty.tsx';

const noop = () => {};
const en = makeI18n('en', 'western', noop, noop);
const ar = makeI18n('ar', 'western', noop, noop);
const ku = makeI18n('ku', 'eastern', noop, noop);
const rules = { on: true, pointValue: 10, minRedeem: 100, maxRedeemPercent: 50 };

describe('loyalty points on the screens', () => {
  it('offers points only within the limits, on dinar sales, while points are on', () => {
    expect(redeemRange(20_000, 5_000, rules, 'IQD')).toEqual({ min: 100, max: 1_000 });
    expect(redeemRange(20_000, 318, rules, 'IQD')).toEqual({ min: 100, max: 318 });
    // fewer than the fewest at once: nothing to offer
    expect(redeemRange(20_000, 80, rules, 'IQD')).toBeNull();
    expect(redeemRange(1_000, 5_000, rules, 'IQD')).toBeNull();
    expect(redeemRange(20_000, 5_000, rules, 'USD')).toBeNull();
    expect(redeemRange(20_000, 5_000, { ...rules, on: false }, 'IQD')).toBeNull();
  });

  it('reads whole numbers typed in any digits, and nothing else', () => {
    expect(wholeOf('1,250')).toBe(1250);
    expect(wholeOf('١٢٥٠')).toBe(1250);
    expect(wholeOf('-30')).toBe(-30);
    for (const bad of ['', '1.5', '12a', '1e3', '9999999999999']) expect(wholeOf(bad), bad).toBeNull();
  });

  it('names every kind of movement in the three languages', () => {
    for (const i18n of [en, ar, ku]) {
      for (const kind of [...LOYALTY_KINDS, 'expire' as const]) expect(loyaltyKindLabel(i18n, kind)).toBeTruthy();
    }
    expect(loyaltyKindLabel(en, 'return_redeem')).toBe('Given back with a return');
  });

  it('prints what a sale used and earned and the balance, and what a return gave back and took', () => {
    expect(loyaltyLines(en, { earned: 18, redeemed: 200, value: 2_000, balance: 318 })).toEqual([
      ['Points used', '200 (−2,000 IQD)'], ['Points earned', '18'], ['Points balance now', '318']
    ]);
    expect(loyaltyLines(en, { earned: -8, redeemed: -100, value: 1_005, balance: 410 })).toEqual([
      ['Points given back', '100 (1,005 IQD)'], ['Points taken back', '8'], ['Points balance now', '410']
    ]);
    expect(loyaltyLines(en, null)).toEqual([]);
    expect(loyaltyLines(ar, { earned: 5, redeemed: 0, value: 0, balance: 5 })[0]![0]).toBe('نقاط مكتسبة');
  });

  it('has a message for every refusal the server gives about points', () => {
    const server = readFileSync(new URL('../../../../packages/server/src/loyalty.ts', import.meta.url), 'utf8');
    const codes = new Set([...server.matchAll(/code: '(loyalty_[a-z_]+)'/g), ...server.matchAll(/conflict\('(loyalty_[a-z_]+)'/g)].map((m) => m[1]!));
    expect(codes.size).toBeGreaterThanOrEqual(7);
    for (const code of codes) expect(isKey(`err_${code}`), code).toBe(true);
    expect(isKey('err_plan_limit_loyalty')).toBe(true);
    expect(isKey('err_loyalty_moves_are_permanent')).toBe(true);
  });
});
