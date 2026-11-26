import { describe, expect, it } from 'vitest';
import { IRAQI_UNIFIED_CHART } from '@qasa/core';
import { CONSIGNMENT_HELD } from './consignment.ts';
import { FUEL_STOCK_ACCOUNT } from './fuel.ts';
import { GIFT_ACCOUNT } from './gift-vouchers.ts';
import { GOLD_OWED_ACCOUNT, OLD_GOLD_ACCOUNT } from './gold.ts';
import { FEATURE_ACCOUNTS, FUEL_STOCK_STANDARD } from './feature-accounts.ts';

// The accounts features make the first time they need one (2.0). Each has a code of its own: two features sharing one
// would post into each other's account without anyone seeing it (gold's old gold and the petrol station's fuel stock
// were both 1379, gold's suppliers and the gift vouchers both 269, until the 2.0 merge).
const MADE_ON_DEMAND: Record<string, string> = {
  consignment: CONSIGNMENT_HELD, fuel: FUEL_STOCK_ACCOUNT, giftVouchers: GIFT_ACCOUNT, goldOwed: GOLD_OWED_ACCOUNT, oldGold: OLD_GOLD_ACCOUNT
};

describe('accounts made on demand', () => {
  it("each feature's helper makes the code its module names", () => {
    expect(FEATURE_ACCOUNTS.consignment.code).toBe(CONSIGNMENT_HELD);
    expect(FUEL_STOCK_STANDARD).toBe(FUEL_STOCK_ACCOUNT);
    expect(FEATURE_ACCOUNTS.giftVouchers.code).toBe(GIFT_ACCOUNT);
    expect(FEATURE_ACCOUNTS.goldOwed.code).toBe(GOLD_OWED_ACCOUNT);
    expect(FEATURE_ACCOUNTS.oldGold.code).toBe(OLD_GOLD_ACCOUNT);
  });

  it('each feature has a code no other feature uses, and none is already in the unified chart', () => {
    const codes = Object.values(MADE_ON_DEMAND);
    expect(new Set(codes).size).toBe(codes.length);
    const chart = new Set(IRAQI_UNIFIED_CHART.map((a) => a.code));
    for (const [feature, code] of Object.entries(MADE_ON_DEMAND)) expect(chart.has(code), `${feature} ${code}`).toBe(false);
  });
});
