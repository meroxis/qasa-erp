import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { BUSINESS_FEATURE, BUSINESS_TYPES, PLANS, SIZE_SCALES, cleanSizes, gridOrder } from '@qasa/core';
import { CLOTHING_TEXT } from '../i18n/clothing.ts';
import { isKey } from '../i18n.ts';
import { linesIn } from '../industry/ClothingTools.tsx';
import { clearQueuedLabels, queueLabels, queuedLabels } from '../industry/label-queue.ts';
import { NAV } from '../nav.ts';

// Clothing and shoes (2.0) in the app: its texts in the three languages (one for every refusal the server gives), the
// business type and its plan, the grid's lines in an editor's currency, and the labels handed to the Labels page.

const entries = Object.entries(CLOTHING_TEXT) as [string, readonly [string, string, string]][];
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('texts', () => {
  it('has every text in the three languages, with the same placeholders, and Kurdish with the accountants\' words', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
    for (const [key, [ar, en, ku]] of entries) {
      for (const text of [ar, en, ku]) expect(text.trim(), key).not.toBe('');
      expect(placeholders(ar), key).toBe(placeholders(en));
      expect(placeholders(ku), key).toBe(placeholders(en));
      if (/\bpost(s|ed|ing)?\b/i.test(en)) expect(ku, key).toMatch(/پۆست/);
      if (/\bshift\b/i.test(en)) expect(ku, key).toMatch(/شەفت/);
    }
  });

  it('says every refusal the server\'s clothing gives, and every text the pages ask for is there', () => {
    const server = read('../../../../packages/server/src/clothing.ts');
    const codes = new Set([...server.matchAll(/(?:conflict\(|code: )'(cl_[a-z_]+)'/g)].map((m) => m[1]!));
    expect(codes.size).toBeGreaterThan(8);
    for (const code of codes) expect(isKey(`err_${code}`), code).toBe(true);
    for (const file of ['./Clothing.tsx', '../industry/ClothingTools.tsx']) {
      for (const m of read(file).matchAll(/(?:\bt|head)\('([a-zA-Z0-9_]+)'/g)) expect(isKey(m[1]!), `${file}: ${m[1]}`).toBe(true);
    }
  });
});

describe('the business type', () => {
  it('is a business type of its own, on Starter, Pro and Business, never Free, with a menu page', () => {
    expect(BUSINESS_TYPES).toContain('clothingShop');
    expect(BUSINESS_FEATURE.clothingShop).toBe('clothingShop');
    expect(PLANS.free.features).not.toContain('clothingShop');
    for (const p of ['starter', 'pro', 'business'] as const) expect(PLANS[p].features, p).toContain('clothingShop');
    const page = NAV.flatMap((g) => g.items).find((i) => i.path === 'clothing');
    expect(page).toMatchObject({ key: 'cw_title', business: 'clothingShop' });
  });

  it('starts sizes from the shop\'s scales, each written the one way', () => {
    expect(SIZE_SCALES.find((s) => s.id === 'letters')?.sizes).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']);
    expect(cleanSizes([' xl', 'XL', '42.5', '0-3m'])).toEqual(['XL', '42.5', '0-3M']);
    expect(cleanSizes(['<b>'])).toBeNull();
    const cells = [{ size: 'L', colorId: 'w' }, { size: 'S', colorId: 'b' }, { size: 'L', colorId: 'b' }];
    expect(gridOrder(cells, ['S', 'L'], ['b', 'w'])).toEqual([{ size: 'S', colorId: 'b' }, { size: 'L', colorId: 'b' }, { size: 'L', colorId: 'w' }]);
  });
});

describe('the grid on a document', () => {
  it('keeps a price in the editor\'s currency, and leaves one in another currency to fill', () => {
    const line = { itemId: 'a', code: 'A', name: { ar: 'a', en: 'a', ku: 'a' }, size: 'M', colorId: null, qtyMilli: 2_000, unitPrice: 25_000, currency: 'IQD' as const };
    expect(linesIn([line], 'IQD', (l, price) => ({ itemId: l.itemId, price }))).toEqual([{ itemId: 'a', price: 25_000 }]);
    expect(linesIn([line], 'USD', (l, price) => ({ itemId: l.itemId, price }))).toEqual([{ itemId: 'a', price: null }]);
  });
});

describe('labels handed to the Labels page', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(), key: () => null, length: 0
    } as Storage;
  });

  it('keeps the rows until the page has shown them, with no row of none and at most 500 copies', () => {
    queueLabels([{ itemId: 'a', copies: 3 }, { itemId: 'b', copies: 0 }, { itemId: 'c', copies: 9_999 }]);
    expect(queuedLabels()).toEqual([{ itemId: 'a', copies: 3 }, { itemId: 'c', copies: 500 }]);
    // read twice (a page drawn twice) gives the same rows
    expect(queuedLabels()).toHaveLength(2);
    clearQueuedLabels();
    expect(queuedLabels()).toEqual([]);
  });
});
