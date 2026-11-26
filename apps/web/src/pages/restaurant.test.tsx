import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BUSINESS_FEATURE, BUSINESS_TYPES, PLANS, PRINT_KINDS, USUAL_PAPER, posByBusiness } from '@qasa/core';
import { RESTAURANT_TEXT } from '../i18n/restaurant.ts';
import { I18nContext, isKey, makeI18n } from '../i18n.ts';
import { NAV } from '../nav.ts';
import { BUSINESS_CARDS } from '../industry/business-cards.ts';
import { printKindsFor } from '../industry/Printers.tsx';
import { dinarPriceOf, nextTableName, TicketContent } from './Restaurant.tsx';

// Restaurants and cafés (2.1) in the app: the texts in the three languages (one for every refusal the server gives),
// the business type and its plan, the kitchen's own printer, and what the page works out by itself.

const entries = Object.entries(RESTAURANT_TEXT) as [string, readonly [string, string, string]][];
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('texts', () => {
  it('has every text in the three languages, with the same placeholders', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
    for (const [key, [ar, en, ku]] of entries) {
      for (const text of [ar, en, ku]) expect(text.trim(), key).not.toBe('');
      if (key.endsWith('__one')) continue;
      expect(placeholders(ar), key).toBe(placeholders(en));
      expect(placeholders(ku), key).toBe(placeholders(en));
      if (/\bshift\b/i.test(en)) expect(ku, key).toMatch(/شەفت/);
    }
  });

  it('says every refusal the server\'s restaurant gives, and every text the page asks for is there', () => {
    const server = read('../../../../packages/server/src/restaurant.ts');
    const codes = new Set([...server.matchAll(/(?:conflict\(|code: )'(rs_[a-z_]+)'/g)].map((m) => m[1]!));
    expect(codes.size).toBeGreaterThan(12);
    for (const code of codes) expect(isKey(`err_${code}`), code).toBe(true);
    for (const m of read('./Restaurant.tsx').matchAll(/\bt\('([a-zA-Z0-9_]+)'/g)) expect(isKey(m[1]!), m[1]).toBe(true);
  });
});

describe('the business type', () => {
  it('is a business type of its own, on Starter, Pro and Business, never Free, with a menu page, a card and the till', () => {
    expect(BUSINESS_TYPES).toContain('restaurant');
    expect(BUSINESS_FEATURE.restaurant).toBe('restaurant');
    expect(PLANS.free.features).not.toContain('restaurant');
    for (const p of ['starter', 'pro', 'business'] as const) expect(PLANS[p].features, p).toContain('restaurant');
    expect(NAV.flatMap((g) => g.items).find((i) => i.path === 'restaurant')).toMatchObject({ key: 'rs_restaurant', business: 'restaurant', match: ['restaurant', 'restaurant-order'] });
    expect(BUSINESS_CARDS.find((c) => c.type === 'restaurant')?.pages[0]).toBe('rs_restaurant');
    // a café sells at a counter too
    expect(posByBusiness(['restaurant'])).toBe(true);
  });

  it('prints kitchen tickets on a printer of their own, on a receipt roll, without the print window', () => {
    expect(PRINT_KINDS).toContain('kitchen');
    expect(USUAL_PAPER.kitchen).toBe('receipt80');
    expect(isKey('prn_kind_kitchen')).toBe(true);
    expect(isKey('prn_also_kitchen')).toBe(true);
    // the printer page lists the kitchen's row for a restaurant only: a shop's page keeps its six rows
    expect(printKindsFor(['restaurant'])).toContain('kitchen');
    expect(printKindsFor(['market', 'trade'])).not.toContain('kitchen');
    expect(printKindsFor(null)).toEqual(['invoice', 'voucher', 'quote', 'receipt', 'label', 'report']);
  });
});

describe('the page', () => {
  it('names the next table after the highest one', () => {
    expect(nextTableName([])).toBe('1');
    expect(nextTableName([{ name: '1' }, { name: '9' }, { name: '3' }])).toBe('10');
    expect(nextTableName([{ name: 'F1' }, { name: 'F2' }])).toBe('F3');
    expect(nextTableName([{ name: 'Window' }])).toBe('2');
  });

  it('prices a dollar item in dinars at the company rate, as the server does', () => {
    expect(dinarPriceOf({ salePrice: 12_000, saleCurrency: 'IQD' }, 142_000)).toBe(12_000);
    expect(dinarPriceOf({ salePrice: 500, saleCurrency: 'USD' }, 142_000)).toBe(7_100);
  });

  it('draws a kitchen ticket: where, which ticket, each dish with its note, and a cancel ticket says so', () => {
    const i18n = makeI18n('en', 'western', () => {}, () => {});
    const ticket = {
      orderId: 'o', number: '12', ticket: 2, kind: 'table' as const, tableName: '4', areaName: null, guests: 3, by: 'Las', at: '2026-11-26T18:30:00Z', notes: null,
      station: 'kitchen' as const, type: 'order' as const, lines: [{ itemId: 'k', code: 'KEBAB', name: { ar: 'كباب', en: 'Kebab', ku: 'کەباب' }, qtyMilli: 2_000, note: 'no onion' }]
    };
    const html = renderToStaticMarkup(<I18nContext.Provider value={i18n}><TicketContent ticket={ticket} /></I18nContext.Provider>);
    expect(html).toContain('KITCHEN');
    expect(html).toContain('Table 4');
    expect(html).toContain('#12 · Ticket 2');
    expect(html).toContain('Kebab');
    expect(html).toContain('no onion');
    const cancel = renderToStaticMarkup(<I18nContext.Provider value={i18n}><TicketContent ticket={{ ...ticket, type: 'cancel', lines: [{ ...ticket.lines[0]!, reason: 'Burnt' }] }} /></I18nContext.Provider>);
    expect(cancel).toContain('CANCEL · KITCHEN');
    expect(cancel).toContain('Cancelled: Burnt');
    // 2.1: each station's ticket says whose it is
    const grill = renderToStaticMarkup(<I18nContext.Provider value={i18n}><TicketContent ticket={{ ...ticket, station: 'grill' }} /></I18nContext.Provider>);
    expect(grill).toContain('GRILL');
    expect(grill).not.toContain('KITCHEN');
  });
});

describe('amounts typed', () => {
  it('reads dinars in Western, Arabic and Persian digits, with separators', async () => {
    const { wholeDinars } = await import('./Restaurant.tsx');
    expect(wholeDinars('25,000')).toBe(25_000);
    expect(wholeDinars('٢٥٠٠٠')).toBe(25_000);
    expect(wholeDinars('۱۰۰۰')).toBe(1_000);
    expect(wholeDinars('')).toBe(0);
  });
});

describe('the kitchen side (2.1): stations, the kitchen screen and recipes', () => {
  it('names every station in three languages, and each has a printer of its own for a restaurant only', async () => {
    const { stationKey } = await import('./Kitchen.tsx');
    const { RS_STATIONS } = await import('@qasa/core');
    for (const s of RS_STATIONS) {
      expect(isKey(stationKey(s))).toBe(true);
      expect(PRINT_KINDS).toContain(s);
      expect(USUAL_PAPER[s]).toBe('receipt80');
      expect(isKey(`prn_kind_${s}`)).toBe(true);
      expect(isKey(`prn_also_${s}`)).toBe(true);
      expect(printKindsFor(['restaurant'])).toContain(s);
      expect(printKindsFor(['market'])).not.toContain(s);
    }
    expect(read('../industry/Printers.tsx')).toContain("const STRAIGHT_KINDS: readonly PrintKind[] = ['receipt', 'label', 'kitchen', 'grill', 'bar'];");
  });

  it('turns a ticket amber, then red, as it waits; counts minutes from when it was sent', async () => {
    const { lateness, minutesAgo, LATE_MINUTES, VERY_LATE_MINUTES } = await import('./Kitchen.tsx');
    expect([lateness(0), lateness(LATE_MINUTES), lateness(VERY_LATE_MINUTES)]).toEqual(['', 'late', 'very-late']);
    const now = Date.parse('2026-11-26T18:30:00Z');
    expect(minutesAgo('2026-11-26T18:12:30Z', now)).toBe(17);
    expect(minutesAgo('2026-11-26T18:31:00Z', now)).toBe(0);
  });

  it('reads what a dish takes of an ingredient, in its unit, and the profit of a plate', async () => {
    const { marginOf, partMilli } = await import('./Kitchen.tsx');
    expect(partMilli('0.25')).toBe(250);
    expect(partMilli('٢')).toBe(2_000);
    expect(partMilli('0')).toBeNull();
    expect(partMilli('a')).toBeNull();
    expect(marginOf(12_000, 5_500)).toBe(54);
    expect(marginOf(12_000, null)).toBeNull();
    expect(marginOf(0, 100)).toBeNull();
  });

  it('puts the kitchen screen and the recipes in the menu for restaurants, with their texts', () => {
    const items = NAV.flatMap((g) => g.items);
    for (const key of ['rs_kitchenScreen', 'rs_recipes'] as const) {
      const item = items.find((i) => i.key === key);
      expect(item?.business).toBe('restaurant');
      expect(isKey(key)).toBe(true);
    }
    for (const key of Object.keys(RESTAURANT_TEXT)) {
      const words = RESTAURANT_TEXT[key as keyof typeof RESTAURANT_TEXT];
      expect(words.every((w) => w.trim().length > 0), key).toBe(true);
    }
  });
});
