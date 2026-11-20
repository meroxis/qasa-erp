import { describe, expect, it } from 'vitest';
import { BUSINESS_FEATURE, BUSINESS_TYPES, PLANS } from '@qasa/core';
import { GOLD_TABS, goldTabs } from './Gold.tsx';
import { NAV } from '../nav.ts';
import { ACTIONS } from '../may.ts';

describe('the gold shop pages', () => {
  it('is a business type of its own, on the paid plans and never Free', () => {
    expect(BUSINESS_TYPES).toContain('goldShop');
    expect(BUSINESS_FEATURE.goldShop).toBe('goldShop');
    expect(PLANS.free.features).not.toContain('goldShop');
    for (const plan of ['starter', 'pro', 'business'] as const) expect(PLANS[plan].features, plan).toContain('goldShop');
  });

  it('shows the board and the pieces to everyone, and the gold at cost only to those who see the books', () => {
    expect(goldTabs(true)).toEqual([...GOLD_TABS]);
    expect(goldTabs(false)).toEqual(['board', 'pieces']);
  });

  it('has its menu entry for gold shops only, and asks the server’s own permissions', () => {
    const entry = NAV.flatMap((g) => g.items).find((i) => i.path === 'gold');
    expect(entry).toMatchObject({ business: 'goldShop', key: 'gd_title' });
    expect(ACTIONS.goldBoard.needs).toBe('sales');
    expect(ACTIONS.goldPiece.needs).toBe('stock');
    expect(ACTIONS.goldDoc.needs).toBe('purchases');
  });
});
