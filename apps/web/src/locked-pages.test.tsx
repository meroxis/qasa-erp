import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// 2.0.0 (the product review): a paid page the plan does not include showed its tabs over an empty page
it('shows what a paid page does and how to get it when the plan does not include it', () => {
  const pages: [string, string][] = [['Gold', 'goldShop'], ['Wholesale', 'wholesale'], ['Clothing', 'clothingShop'], ['Consignment', 'consignment'],
    ['Delivery', 'delivery'], ['PriceCheckers', 'priceChecker'], ['Offers', 'promotions']];
  for (const [page, feature] of pages) {
    const src = readFileSync(new URL(`./pages/${page}.tsx`, import.meta.url), 'utf8');
    expect(src, page).toContain(`if (plan && !plan.features.includes('${feature}')) return <LockedFeature feature="${feature}"`);
  }
});
