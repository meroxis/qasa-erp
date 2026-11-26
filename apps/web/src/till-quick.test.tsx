import { describe, expect, it } from 'vitest';
import { tillSource } from './till-source.ts';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { POS_QUICK_MAX, posBigTiles, type BusinessType, type Lang } from '@qasa/core';
import type { ItemView, Settings } from './api.ts';
import { DataContext } from './components.tsx';
import { I18nContext, makeI18n } from './i18n.ts';
import { TILL_QUICK_TEXT } from './i18n/till-quick.ts';
import { QuickRow } from './pages/Pos.tsx';
import { moveQuick, quickIdsFor, quickRowItems, toggleQuick } from './pages/pos-logic.ts';
import { PosBigPicturesSetting } from './industry/PosBigPicturesSetting.tsx';
import { forgetTill, rememberTill, tillCache } from './industry/offline-till.ts';
import { may } from './may.ts';

// The till's quick buttons, for every company that uses the till (a row above the categories, one tap adds one, an
// admin edits them on the till), and its big pictures (off by default for every company, Settings → Sales and point of sale)

const render = (node: ReactNode, settings: Partial<Settings> | null, lang: Lang = 'en') => renderToStaticMarkup(
  <I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}>
    <DataContext.Provider value={{ accounts: [], settings, plan: null, online: true, permissions: ['admin'], reloadAccounts: async () => {}, reloadSettings: async () => {}, reloadPlan: async () => {} } as never}>
      {node}
    </DataContext.Provider>
  </I18nContext.Provider>
);
const company = (businessTypes: BusinessType[] | null, more: Partial<Settings> = {}): Settings => ({
  companyName: { ar: '', en: '', ku: '' }, defaultRateX100: 142_000, fiscalYearStart: '01-01', postingAccounts: {} as never,
  businessTypes, amountsShow: 'iqd', posUse: 'auto', posQuickItems: [], posBigPictures: 'auto', ...more
});
const item = (id: string, en: string, salePrice: number, over: Partial<ItemView> = {}): ItemView => ({
  id, code: id.toUpperCase(), barcode: null, name: { ar: en, en, ku: en }, unit: 'piece', salePrice, saleCurrency: 'IQD',
  trackStock: true, active: true, qtyMilli: 10_000, value: 0, hasMoves: false, units: [], saleUnit: null, purchaseUnit: null, updatedAt: null,
  trackBatches: false, trackExpiry: false, categoryId: null, brandId: null, reorderMilli: null, ...over
} as ItemView);
const bread = item('bread', 'Bread', 1_000);
const water = item('water', 'Water 1.5 L', 500);
const charger = item('charger', 'Fast charger 25 W', 25_000);
const row = (props: Partial<Parameters<typeof QuickRow>[0]>, lang: Lang = 'en') => render(
  <QuickRow items={[water, bread]} currency="IQD" priceRate={142_000} editing={false} mayEdit={false} canEdit onPick={() => {}} onEdit={() => {}} onMove={() => {}} {...props} />,
  company(['market']), lang
);

describe('the quick buttons on the till', () => {
  it('show each item with its picture (or initials), name and price, in the company’s order; a tap adds one', () => {
    const html = row({});
    expect(html).toContain('aria-label="Quick buttons"');
    expect(html.indexOf('Water 1.5 L')).toBeLessThan(html.indexOf('Bread'));
    expect(html).toContain('500');
    expect(html).toContain('1,000');
    expect(html).toContain('pos-quick-pic');
    expect(html).toContain('>B<');
    // buttons that sell, and no edit button for a cashier
    expect((html.match(/<button[^>]*class="pos-quick-btn"/g) ?? []).length).toBe(2);
    expect(html).not.toContain('Edit buttons');
    expect(html).not.toContain('pos-quick-move');
  });

  it('are not there at all for a cashier when the company has none', () => {
    expect(row({ items: [] })).toBe('');
  });

  it('offer an admin "Edit buttons" (with a hint while there are none), and refuse it while the server can’t be reached', () => {
    const empty = row({ items: [], mayEdit: true });
    expect(empty).toContain('Edit buttons');
    expect(empty).toContain('No quick buttons yet');
    const offline = row({ mayEdit: true, canEdit: false });
    expect(offline).toMatch(/<button[^>]*disabled=""[^>]*title="The quick buttons can be edited once this PC reaches the server\."/);
    // the row still sells offline, from the list last known
    expect((offline.match(/<button[^>]*class="pos-quick-btn"/g) ?? []).length).toBe(2);
  });

  it('in edit mode: Done, the hint, and arrows to move each button (none past the ends)', () => {
    const html = row({ mayEdit: true, editing: true });
    expect(html).toContain('Done');
    expect(html).toContain(`The row holds ${POS_QUICK_MAX} at most.`);
    expect(html).toContain('aria-label="Move back: Water 1.5 L" disabled=""');
    expect(html).toContain('aria-label="Move forward: Bread" disabled=""');
    expect(html).not.toContain('aria-label="Move forward: Water 1.5 L" disabled');
    // the buttons don't sell while they are being chosen
    expect(html).not.toMatch(/<button[^>]*class="pos-quick-btn"/);
  });

  it('are in Arabic and Kurdish too', () => {
    for (const [lang, i] of [['ar', 0], ['ku', 2]] as const) {
      const html = row({ mayEdit: true, items: [] }, lang);
      expect(html).toContain(TILL_QUICK_TEXT.tq_edit[i]);
      expect(html).toContain(TILL_QUICK_TEXT.tq_empty[i]);
    }
    for (const texts of Object.values(TILL_QUICK_TEXT)) {
      for (const s of texts) expect(s.trim()).not.toBe('');
      expect(new Set(texts).size).toBe(3);
    }
  });

  it('are an admin’s to edit, as the server says (Settings: admin only)', () => {
    expect(may(['admin'], 'companyDetails')).toBe(true);
    for (const p of [['pos'], ['sales', 'pos'], ['stock'], []]) expect(may(p, 'companyDetails')).toBe(false);
  });

  it('are chosen with a tap, moved with the arrows, and kept to the limit', () => {
    expect(toggleQuick([], 'bread', 24)).toEqual({ next: ['bread'], full: false });
    expect(toggleQuick(['bread', 'water'], 'bread', 24)).toEqual({ next: ['water'], full: false });
    const full = Array.from({ length: 24 }, (_, i) => `i${i}`);
    expect(toggleQuick(full, 'bread', 24)).toEqual({ next: full, full: true });
    // taking one off a full row works
    expect(toggleQuick(full, 'i3', 24).next).toHaveLength(23);
    expect(moveQuick(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveQuick(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveQuick(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveQuick(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moveQuick(['a', 'b'], 'x', 1)).toEqual(['a', 'b']);
  });

  it('show only items the till lists (one deleted or made inactive drops out quietly)', () => {
    expect(quickRowItems(['water', 'gone', 'bread'], [bread, water, charger]).map((i) => i.id)).toEqual(['water', 'bread']);
    expect(quickRowItems([], [bread])).toEqual([]);
  });

  it('work on the offline till from the list last known', () => {
    // from the settings when they came with them
    expect(quickIdsFor(['bread'], ['water'])).toEqual(['bread']);
    expect(quickIdsFor([], ['water'])).toEqual([]);
    // no settings now (the server can't be reached): the list this PC last had
    expect(quickIdsFor(undefined, ['water', 'bread'])).toEqual(['water', 'bread']);
    expect(quickIdsFor(undefined, null)).toEqual([]);
    forgetTill();
    rememberTill('u1', { items: [bread, water] });
    rememberTill('u1', { quick: ['water'] });
    expect(tillCache('u1')?.quick).toEqual(['water']);
    expect(tillCache('u1')?.items).toHaveLength(2);
    // another person never sells from it
    expect(tillCache('u2')).toBeNull();
    forgetTill();
  });

  it('come for every company that uses the till, not only a phone shop', () => {
    const pos = tillSource();
    // the row is drawn whatever the business type (the big pictures alone follow it)
    expect(pos).toMatch(/\n\s*<QuickRow items=\{quickItems\}/);
    expect(pos).not.toMatch(/\{\w+ && \(\s*<QuickRow/);
    expect(pos).toContain("className={'pos pos-v2' + (bigTiles ? ' pos-big' : '')");
  });
});

describe('big pictures on the till', () => {
  it('are off by default for every company, a phone shop too', () => {
    expect(posBigTiles(company(['mobileShop']))).toBe(false);
    expect(posBigTiles(company(['trade', 'mobileShop']))).toBe(false);
    expect(posBigTiles(company(['market']))).toBe(false);
    expect(posBigTiles(company(null))).toBe(false);
  });

  it('follow the company’s own choice over the business type', () => {
    expect(posBigTiles(company(['market'], { posBigPictures: 'on' }))).toBe(true);
    expect(posBigTiles(company(['mobileShop'], { posBigPictures: 'off' }))).toBe(false);
  });

  it('Settings → Sales and point of sale: starts on normal tiles for every company, and shows the admin’s choice', () => {
    for (const types of [['mobileShop'], ['market']] as BusinessType[][]) {
      const html = render(<PosBigPicturesSetting />, company(types));
      expect(html).toContain('Big pictures on the till');
      expect(html).toMatch(/aria-checked="true"[^>]*>(?:(?!aria-checked).)*Normal tiles/);
      expect(html).not.toContain('business type');
    }
    const chosen = render(<PosBigPicturesSetting />, company(['market'], { posBigPictures: 'on' }));
    expect(chosen).toMatch(/aria-checked="true"[^>]*>(?:(?!aria-checked).)*Big pictures</);
  });

  it('cannot be changed against an office server from before this choice', () => {
    const old = render(<PosBigPicturesSetting />, { ...company(['mobileShop']), posBigPictures: undefined });
    expect(old).toContain('aria-disabled="true"');
    expect(old).toContain('Update Qasa ERP on the office server PC');
  });

  it('is in the Sales and point of sale section, in Arabic and Kurdish too', () => {
    const settings = readFileSync(new URL('./pages/Settings.tsx', import.meta.url), 'utf8');
    expect(settings).toContain('<PosUseSetting /><PosBigPicturesSetting />');
    for (const [lang, i] of [['ar', 0], ['ku', 2]] as const) {
      const html = render(<PosBigPicturesSetting />, company(['mobileShop']), lang);
      expect(html).toContain(TILL_QUICK_TEXT.tq_bigTitle[i]);
      expect(html).toContain(TILL_QUICK_TEXT.tq_bigOn[i]);
    }
  });
});
