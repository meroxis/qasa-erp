import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BUSINESS_TYPES } from '@qasa/core';
import { DataContext } from '../components.tsx';
import { I18nContext, isKey, makeI18n } from '../i18n.ts';
import { BUSINESS_CARDS, BUSINESS_GROUPS, cheapestPlanFor, matchCards, nextIndex, planLine, searchable, SUGGESTED_TYPE } from '../industry/business-cards.ts';

const updateSettings = vi.fn((patch: unknown) => Promise.resolve(patch));
vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  api: { updateSettings: (p: unknown) => updateSettings(p), startTrial: () => new Promise(() => {}) }
}));
vi.mock('../industry/LegalPanel.tsx', () => ({ AgreeLine: () => null }));

const { BusinessTypeChooser, BusinessTypePage, choiceOf, saveBusinessChoice } = await import('./BusinessType.tsx');

const plan = { features: [], source: 'free', trialAvailable: true };
const wrap = (node: ReactNode, settings: object, lang: 'ar' | 'en' | 'ku' = 'en') => renderToStaticMarkup(
  <I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}>
    <DataContext.Provider value={{ settings, plan, reloadSettings: () => {}, reloadPlan: () => {} } as never}>{node}</DataContext.Provider>
  </I18nContext.Provider>
);

describe('the business cards', () => {
  it('has one card for every business type, each in a group, with its name, line and 3 to 5 menu pages in three languages', () => {
    expect(BUSINESS_CARDS.map((c) => c.type).sort()).toEqual([...BUSINESS_TYPES].sort());
    for (const c of BUSINESS_CARDS) {
      expect(BUSINESS_GROUPS).toContain(c.group);
      expect(c.pages.length, c.type).toBeGreaterThanOrEqual(3);
      expect(c.pages.length, c.type).toBeLessThanOrEqual(5);
      for (const key of [`bt_${c.type}`, `bt_${c.type}Text`, ...c.pages]) expect(isKey(key), key).toBe(true);
    }
    expect(SUGGESTED_TYPE).toBe('trade');
  });

  it('finds a card by any word, in the screen’s language or English, whichever way Arabic and Kurdish letters are written', () => {
    expect(searchable('صيدليّة')).toBe(searchable('صیدلیه'));
    const ar = makeI18n('ar', 'western', () => {}, () => {});
    const en = makeI18n('en', 'western', () => {}, () => {});
    const texts = (c: (typeof BUSINESS_CARDS)[number]) => [ar.t(`bt_${c.type}` as never), ar.t(`bt_${c.type}Text` as never), en.t(`bt_${c.type}` as never)];
    expect(matchCards(BUSINESS_CARDS, 'صيدليه', texts).map((c) => c.type)).toEqual(['pharmacy']);
    expect(matchCards(BUSINESS_CARDS, 'PHARMACY', texts).map((c) => c.type)).toEqual(['pharmacy']);
    expect(matchCards(BUSINESS_CARDS, '  ', texts)).toHaveLength(BUSINESS_CARDS.length);
    expect(matchCards(BUSINESS_CARDS, 'zzz', texts)).toEqual([]);
  });

  it('moves with the arrows the way the screen reads, round at the ends, and jumps with Home and End', () => {
    expect(nextIndex(0, 'ArrowRight', 4, false)).toBe(1);
    expect(nextIndex(0, 'ArrowLeft', 4, true)).toBe(1);
    expect(nextIndex(0, 'ArrowUp', 4, false)).toBe(3);
    expect(nextIndex(3, 'ArrowDown', 4, true)).toBe(0);
    expect(nextIndex(2, 'Home', 4, false)).toBe(0);
    expect(nextIndex(0, 'End', 4, false)).toBe(3);
    expect(nextIndex(1, 'a', 4, false)).toBeNull();
  });

  it('says which plan a type needs: every plan, the free first month, the plan it has, or the one to get', () => {
    expect(planLine('trade', null)).toEqual({ key: 'bc_planFree', plan: null });
    expect(planLine('market', null).key).toBe('bc_planFree');
    const needs = cheapestPlanFor('pharmacy');
    expect(needs).toBe('starter');
    expect(planLine('pharmacy', { features: [], source: 'free', trialAvailable: true })).toEqual({ key: 'bc_planTrial', plan: 'starter' });
    expect(planLine('pharmacy', { features: ['pharmacy'], source: 'trial', trialAvailable: false }).key).toBe('bc_planTrial');
    expect(planLine('pharmacy', { features: ['pharmacy'], source: 'license', trialAvailable: false }).key).toBe('bc_planIncluded');
    expect(planLine('pharmacy', { features: [], source: 'free', trialAvailable: false }).key).toBe('bc_planNeeds');
  });
});

describe('“What does your company mainly do?”', () => {
  it('is one choice: radio cards, general trade chosen and suggested first, its pages and plan shown, one big Start', () => {
    const html = wrap(<BusinessTypeChooser first />, { businessTypes: null, businessType: null, businessTypesExtra: [] });
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(BUSINESS_CARDS.length);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    // only the chosen card takes Tab (the others are reached with the arrows)
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('Most companies start here');
    expect(html).toContain('Start: Trading &amp; shops');
    expect(html).toContain('In every plan, Free too.');
    expect(html).not.toContain('type="checkbox"');
    // grouped, with a search box
    for (const g of ['Shops &amp; trade', 'Services &amp; projects', 'Energy', 'Property']) expect(html).toContain(g);
    expect(html).toContain('type="search"');
  });

  it('speaks Arabic and Kurdish too', () => {
    expect(wrap(<BusinessTypeChooser first />, { businessTypes: null }, 'ar')).toContain('ما العمل الرئيسي لشركتك؟');
    expect(wrap(<BusinessTypeChooser first />, { businessTypes: null }, 'ku')).toContain('کاری سەرەکیی کۆمپانیاکەت چییە؟');
  });
});

describe('System → Business type', () => {
  it('shows the main type with Change, and “My company also does…” off until the company has extras', () => {
    const off = wrap(<BusinessTypePage />, { businessTypes: ['pharmacy'], businessType: 'pharmacy', businessTypesExtra: [] });
    expect(off).toContain('Your main kind of work');
    expect(off).toContain('>Change<');
    expect(off).toContain('My company also does…');
    expect(off).toMatch(/role="switch"(?![^>]*checked)/);
    const on = wrap(<BusinessTypePage />, { businessTypes: ['pharmacy', 'market'], businessType: 'pharmacy', businessTypesExtra: ['market'] });
    expect(on).toMatch(/role="switch"[^>]*checked/);
    // the main one is not offered again, the extra is pressed
    expect(on.match(/class="biz-mini( on)?"/g)).toHaveLength(BUSINESS_CARDS.length - 1);
    expect(on).toContain('aria-pressed="true"');
  });

  it('keeps a company from before 1.7 with more than two extras, and says so gently', () => {
    const html = wrap(<BusinessTypePage />, { businessTypes: ['mobileShop', 'trade', 'autoParts', 'electricalSolar'], businessType: 'mobileShop', businessTypesExtra: ['trade', 'autoParts', 'electricalSolar'] });
    expect(html).toContain('they all stay');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(3);
  });
});

describe('saving the choice', () => {
  it('sends the main type (and extras when given) to a 1.7 server, and the list to an older one', async () => {
    updateSettings.mockClear();
    await saveBusinessChoice({ businessTypes: null, businessType: null, businessTypesExtra: [] } as never, 'market');
    expect(updateSettings).toHaveBeenLastCalledWith({ businessType: 'market' });
    await saveBusinessChoice({ businessTypes: ['market'], businessType: 'market', businessTypesExtra: [] } as never, 'market', ['pharmacy']);
    expect(updateSettings).toHaveBeenLastCalledWith({ businessType: 'market', businessTypesExtra: ['pharmacy'] });
    // an office server not updated yet: no businessType in its settings
    await saveBusinessChoice({ businessTypes: ['trade', 'pharmacy'] } as never, 'market');
    expect(updateSettings).toHaveBeenLastCalledWith({ businessTypes: ['market', 'trade', 'pharmacy'] });
  });

  it('reads an older server’s list the same way the server does: its first industry is the main type', () => {
    expect(choiceOf({ businessTypes: ['trade', 'pharmacy'] } as never)).toEqual({ main: 'pharmacy', extras: ['trade'] });
    expect(choiceOf({ businessTypes: null } as never)).toEqual({ main: null, extras: [] });
  });
});
