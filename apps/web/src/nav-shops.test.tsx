import { describe, expect, it } from 'vitest';
import { canSee, NAV, type NavViewer } from './nav.ts';
import type { BusinessType } from '@qasa/core';

const item = (key: string) => NAV.flatMap((g) => g.items).find((i) => i.key === key)!;
const viewer = (businessTypes: BusinessType[]): NavViewer => ({ admin: true, permissions: [], businessTypes, branchLimited: false, noBooks: false, pos: true });

// 2.0.0 (the product review): an engineering works or a real estate office saw the supermarket pages
describe('the shop pages in the menu', () => {
  it('shows offers, labels, price checkers, daily suppliers and expiry to shops only', () => {
    for (const key of ['of_title', 'lb_title', 'mx_pcTitle', 'mx_dsTitle', 'ex_title', 'mx_deliveryTitle', 'cg_title']) {
      expect(canSee(item(key), viewer(['market'])), key).toBe(true);
      expect(canSee(item(key), viewer(['engineeringWorks'])), key).toBe(false);
      expect(canSee(item(key), viewer(['realEstate'])), key).toBe(false);
    }
    // a company that has not said what it does still sees them, and an extra type is enough
    expect(canSee(item('of_title'), viewer([]))).toBe(true);
    expect(canSee(item('of_title'), viewer(['engineeringWorks', 'trade']))).toBe(true);
  });

  it('keeps debt reminders for every business that sells on credit', () => {
    for (const b of ['engineeringWorks', 'realEstate', 'wholesale', 'goldShop'] as const) expect(canSee(item('mx_rmTitle'), viewer([b])), b).toBe(true);
  });

  it('labels for gold and wholesale too; expiry for grocers and pharmacies', () => {
    expect(canSee(item('lb_title'), viewer(['goldShop']))).toBe(true);
    expect(canSee(item('lb_title'), viewer(['wholesale']))).toBe(true);
    expect(canSee(item('ex_title'), viewer(['pharmacy']))).toBe(true);
    expect(canSee(item('ex_title'), viewer(['clothingShop']))).toBe(false);
  });
});
