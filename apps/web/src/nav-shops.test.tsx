import { describe, expect, it } from 'vitest';
import { canSee, NAV, type NavViewer } from './nav.ts';
import type { BusinessType } from '@qasa/core';

const item = (key: string) => NAV.flatMap((g) => g.items).find((i) => i.key === key)!;
const viewer = (businessTypes: BusinessType[]): NavViewer => ({ admin: true, permissions: [], businessTypes, branchLimited: false, noBooks: false, pos: true });

// 2.0.0 (the product review): an engineering works or a real estate office saw the supermarket pages
describe('the shop pages in the menu', () => {
  it('shows offers, price checkers, daily suppliers, delivery and consignment to shops only', () => {
    for (const key of ['of_title', 'mx_pcTitle', 'mx_dsTitle', 'mx_deliveryTitle', 'cg_title']) {
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

  // the third review: both pages are older than 2.0, and an upgrade hid them from companies that used them
  it('keeps "Barcode labels" and "Expiry & batches" for every company, as before 2.0 (a wholesaler, a workshop, a clothes shop)', () => {
    const every: BusinessType[][] = [[], ['wholesale'], ['goldShop'], ['clothingShop'], ['engineeringWorks'], ['realEstate'], ['pharmacy'], ['market'], ['generators']];
    for (const types of every) {
      expect(canSee(item('lb_title'), viewer(types)), `labels ${types}`).toBe(true);
      expect(canSee(item('ex_title'), viewer(types)), `expiry ${types}`).toBe(true);
    }
    expect(item('lb_title').businesses).toBeUndefined();
    expect(item('ex_title').businesses).toBeUndefined();
  });
});
