import { describe, expect, it } from 'vitest';
import { BUSINESS_FEATURE, BUSINESS_TYPES, PLANS } from '@qasa/core';
import { NAV } from '../nav.ts';
import { WHOLESALE_TEXT } from '../i18n/wholesale.ts';
import { wholesaleTabsFor, WHOLESALE_TABS } from './Wholesale.tsx';

// Wholesale and distribution (1.8): a business type of its own, on the paid plans, with its page in the industry menu
// for companies that chose it; reps, routes and the rules are an admin's.

describe('wholesale and distribution', () => {
  it('is a business type of the paid plans, never Free', () => {
    expect(BUSINESS_TYPES).toContain('wholesale');
    expect(BUSINESS_FEATURE.wholesale).toBe('wholesale');
    expect(PLANS.free.features).not.toContain('wholesale');
    for (const plan of ['starter', 'pro', 'business'] as const) expect(PLANS[plan].features, plan).toContain('wholesale');
  });

  it('has its page in the industry menu, for a company that does wholesale', () => {
    const item = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group }))).find((i) => i.path === 'wholesale');
    expect(item).toMatchObject({ group: 'gIndustry', business: 'wholesale', key: 'ws_title' });
  });

  it('keeps reps, routes and the rules for an admin', () => {
    expect(wholesaleTabsFor(true)).toEqual([...WHOLESALE_TABS]);
    expect(wholesaleTabsFor(false)).toEqual(['day', 'orders', 'vans', 'money', 'reports']);
  });

  it('says everything in Arabic, English and Kurdish', () => {
    for (const [key, words] of Object.entries(WHOLESALE_TEXT)) {
      expect(words, key).toHaveLength(3);
      for (const w of words) expect(w.trim(), key).not.toBe('');
      // Arabic and Kurdish show no server word
      expect(words[0], key).not.toMatch(/[a-z]{3,}_/);
      expect(words[2], key).not.toMatch(/[a-z]{3,}_/);
    }
  });
});
