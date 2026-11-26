import { describe, expect, it } from 'vitest';
import { cashToTake, roundCash, ROUNDING_MODES, ROUNDING_STEPS } from './cash-rounding.ts';

describe('the cash the till takes (the till and the server call the same function)', () => {
  it('is the rounded cash, but never nothing for a sale that is worth something', () => {
    expect(cashToTake(2_300, { step: 250, mode: 'nearest' })).toBe(2_250);
    expect(cashToTake(2_300, { step: 250, mode: 'up' })).toBe(2_500);
    expect(cashToTake(2_300, { step: 1000, mode: 'down' })).toBe(2_000);
    expect(cashToTake(100, { step: 250, mode: 'down' })).toBe(100);
    expect(cashToTake(100, { step: 250, mode: 'nearest' })).toBe(100);
    expect(cashToTake(0, { step: 250, mode: 'up' })).toBe(0);
    expect(cashToTake(2_300, null)).toBe(2_300);
  });

  it('differs from the plain rounding only where that would leave no cash at all', () => {
    for (const step of ROUNDING_STEPS) for (const mode of ROUNDING_MODES) for (const due of [1, 124, 125, 249, 250, 499, 750, 2_300, 99_999]) {
      const rounded = roundCash(due, { step, mode });
      expect(cashToTake(due, { step, mode })).toBe(rounded > 0 ? rounded : due);
    }
  });
});
