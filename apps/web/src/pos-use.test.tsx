import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { posShown, type BusinessType, type Lang } from '@qasa/core';
import type { Settings } from './api.ts';
import { DataContext } from './components.tsx';
import { I18nContext, makeI18n } from './i18n.ts';
import { POS_USE_TEXT } from './i18n/pos-use.ts';
import { allPages, canSee, defaultFavourites, favourites, findPage, NAV, pageOpen, recentsFor, visibleItems, type NavViewer } from './nav.ts';
import { PosNotUsed } from './industry/PosNotUsed.tsx';
import { PosUseSetting } from './industry/PosUseSetting.tsx';

// 1.5.2: the point of sale shows only where the company sells at a counter (by business type) or where Settings → Sales
// and point of sale → Use the point of sale says so, and only to a person with the Point of sale role (or an admin)

const render = (node: ReactNode, settings: Partial<Settings> | null, lang: Lang = 'en') => renderToStaticMarkup(
  <I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}>
    <DataContext.Provider value={{ accounts: [], settings, plan: null, online: true, reloadAccounts: async () => {}, reloadSettings: async () => {}, reloadPlan: async () => {} } as never}>
      {node}
    </DataContext.Provider>
  </I18nContext.Provider>
);
const company = (businessTypes: BusinessType[], more: Partial<Settings> = {}): Settings => ({
  companyName: { ar: '', en: '', ku: '' }, defaultRateX100: 142_000, fiscalYearStart: '01-01', postingAccounts: {} as never,
  businessTypes, amountsShow: 'iqd', posUse: 'auto', ...more
});
const viewerOf = (s: Settings, admin = true): NavViewer => ({ admin, permissions: admin ? ['admin'] : ['sales', 'pos'], businessTypes: s.businessTypes ?? [], pos: posShown(s) });
const till = findPage('pos_title')!;
const salesGroup = NAV.find((g) => g.group === 'gSales')!;

describe('the till in the menu, the home page and the search', () => {
  it('shows for a market and hides for engineering works', () => {
    const market = viewerOf(company(['market']));
    const works = viewerOf(company(['engineeringWorks']));
    expect(canSee(till, market)).toBe(true);
    expect(canSee(till, works)).toBe(false);
    // the menu's Sales group and the home page's tiles (both visibleItems)
    expect(visibleItems(salesGroup.items, market).map((i) => i.key)).toContain('pos_title');
    expect(visibleItems(salesGroup.items, works).map((i) => i.key)).not.toContain('pos_title');
    expect(visibleItems(salesGroup.items, works).map((i) => i.key)).toContain('invoices');
    // the search (Ctrl+K)
    expect(allPages(market).some((p) => p.key === 'pos_title')).toBe(true);
    expect(allPages(works).some((p) => p.key === 'pos_title')).toBe(false);
    // nor among the search's recent pages, where it was opened before (records stay)
    const recent = [
      { kind: 'page' as const, label: 'Point of sale', path: 'pos', icon: 'wallet' },
      { kind: 'page' as const, label: 'Sales invoices', path: 'sales', icon: 'invoice' },
      { kind: 'party' as const, label: 'Raz', path: 'party/1', icon: 'contact' }
    ];
    expect(recentsFor(recent, works).map((r) => r.path)).toEqual(['sales', 'party/1']);
    expect(recentsFor(recent, market).map((r) => r.path)).toEqual(['pos', 'sales', 'party/1']);
    // a cashier of a company without the till does not get it either
    expect(canSee(till, viewerOf(company(['realEstate']), false))).toBe(false);
  });

  it('follows the business type and the switch only (a till used before keeps nothing)', () => {
    expect(canSee(till, viewerOf({ ...company(['engineeringWorks']), posUsed: true } as Settings))).toBe(false);
    expect(canSee(till, viewerOf(company(['engineeringWorks'], { posUse: 'on' })))).toBe(true);
    expect(canSee(till, viewerOf(company(['market'], { posUse: 'off' })))).toBe(false);
    // a viewer that says nothing (before the settings come, or an older server): as before 1.5.2
    expect(canSee(till, { admin: true, permissions: ['admin'], businessTypes: ['engineeringWorks'] })).toBe(true);
    expect(canSee(till, viewerOf(company(['engineeringWorks'], { posUse: undefined })))).toBe(true);
  });

  it('pins no hidden till by default, and still opens the till address (to say why there is none)', () => {
    expect(defaultFavourites()).toEqual(['pos_title', 'invoices', 'br_title']);
    expect(favourites('Mer', false)).toEqual(['invoices', 'customers', 'br_title']);
    expect(favourites('Mer')).toContain('pos_title');
    const works = viewerOf(company(['engineeringWorks']), false);
    for (const key of favourites('Las', false)) expect(canSee(findPage(key)!, { ...works, permissions: ['sales', 'admin'] })).toBe(true);
    // App.tsx shows PosNotUsed there, not the home page
    expect(pageOpen('pos', undefined, works)).toBe(true);
  });
});

describe('Settings → Sales and point of sale → Use the point of sale', () => {
  it('starts where the business type puts it, and says why', () => {
    const market = render(<PosUseSetting />, company(['market']));
    expect(market).toContain('Use the point of sale');
    expect(market).toMatch(/aria-checked="true"[^>]*>(?:(?!aria-checked).)*Use it/);
    expect(market).toContain('On, from the business type.');
    const works = render(<PosUseSetting />, company(['engineeringWorks']));
    expect(works).toMatch(/aria-checked="true"[^>]*>(?:(?!aria-checked).)*Don’t use it/);
    expect(works).toContain('Off, from the business type');
    expect(works).not.toContain('sold at the point of sale before');
    // where it is on, who uses it: admins and the Point of sale role
    expect(market).toContain('whoever is given the “Point of sale” role in Users');
    expect(works).not.toContain('role in Users');
    // once chosen it says no more
    const chosen = render(<PosUseSetting />, company(['engineeringWorks'], { posUse: 'on' }));
    expect(chosen).toMatch(/aria-checked="true"[^>]*>(?:(?!aria-checked).)*Use it/);
    expect(chosen).not.toContain('from the business type');
  });

  it('cannot be changed against an office server older than 1.5.2', () => {
    const old = render(<PosUseSetting />, { ...company(['engineeringWorks']), posUse: undefined });
    expect(old).toContain('aria-disabled="true"');
    expect(old).toContain('Update Qasa ERP on the office server PC');
    expect(old).toMatch(/aria-checked="true"[^>]*>(?:(?!aria-checked).)*Use it/);
  });

  it('is in Arabic and Kurdish too', () => {
    for (const [lang, i] of [['ar', 0], ['ku', 2]] as const) {
      const html = render(<PosUseSetting />, company(['engineeringWorks']), lang);
      expect(html).toContain(POS_USE_TEXT.pu_title[i]);
      expect(html).toContain(POS_USE_TEXT.pu_off[i]);
    }
    for (const texts of Object.values(POS_USE_TEXT)) for (const s of texts) expect(s.trim()).not.toBe('');
  });
});

describe('the till address where the company does not use it', () => {
  it('shows an admin the way to the setting, and anyone else the sales invoices', () => {
    const admin = render(<PosNotUsed admin />, null);
    expect(admin).toContain('This company doesn’t use the point of sale');
    expect(admin).toContain('#/settings/sales');
    expect(admin).toContain('#/sales');
    const cashier = render(<PosNotUsed admin={false} />, null);
    expect(cashier).not.toContain('#/settings/sales');
    expect(cashier).toContain('ask the admin');
  });
});
