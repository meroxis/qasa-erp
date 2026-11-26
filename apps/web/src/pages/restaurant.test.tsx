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
    expect(read('../industry/Printers.tsx')).toContain("const STRAIGHT_KINDS: readonly PrintKind[] = ['receipt', 'label', 'kitchen'];");
    expect(isKey('prn_kind_kitchen')).toBe(true);
    expect(isKey('prn_also_kitchen')).toBe(true);
    // the printer page lists the kitchen's row for a restaurant only: a shop's page keeps its six rows
    expect(printKindsFor(['restaurant'])).toContain('kitchen');
    expect(printKindsFor(['market', 'trade'])).not.toContain('kitchen');
    expect(printKindsFor(null)).toEqual(PRINT_KINDS.filter((k) => k !== 'kitchen'));
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
      type: 'order' as const, lines: [{ itemId: 'k', code: 'KEBAB', name: { ar: 'كباب', en: 'Kebab', ku: 'کەباب' }, qtyMilli: 2_000, note: 'no onion' }]
    };
    const html = renderToStaticMarkup(<I18nContext.Provider value={i18n}><TicketContent ticket={ticket} /></I18nContext.Provider>);
    expect(html).toContain('KITCHEN');
    expect(html).toContain('Table 4');
    expect(html).toContain('#12 · Ticket 2');
    expect(html).toContain('Kebab');
    expect(html).toContain('no onion');
    const cancel = renderToStaticMarkup(<I18nContext.Provider value={i18n}><TicketContent ticket={{ ...ticket, type: 'cancel', lines: [{ ...ticket.lines[0]!, reason: 'Burnt' }] }} /></I18nContext.Provider>);
    expect(cancel).toContain('CANCEL');
    expect(cancel).toContain('Cancelled: Burnt');
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
