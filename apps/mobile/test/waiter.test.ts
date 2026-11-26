import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { featuresOf, needsNewerOffice, BUSINESS_FEATURES, type Me } from '../src/roles';
import { LANGS, translate } from '../src/i18n';
import { addDish, dishesBody, lineState, minutesSince, setDishCount, type DishDraft } from '../src/staff/waiter';

// Phone app 1.3, a restaurant's waiter: the tables, a table's order, dishes sent to the kitchen and what is ready taken
// to the table (an office of Qasa ERP 2.1 offers 'waiter' to restaurants only).

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const me = (roles: string[], permissions: string[], offers?: string[]): Me =>
  ({ signInRequired: true, user: { id: 'u', name: 'Raz', roles, permissions }, ...(offers ? { phoneLink: { v: 2, offers } } : {}) });
const kebab = { id: 'k', name: { ar: 'كباب', en: 'Kebab', ku: 'کەباب' } };
const tea = { id: 't', name: { ar: 'شاي', en: 'Tea', ku: 'چا' } };

describe('who gets the tables', () => {
  it('whoever takes orders at the office, when it offers them (a restaurant)', () => {
    expect(featuresOf(me(['sales'], ['sales'], ['waiter'])).has('waiter')).toBe(true);
    expect(featuresOf(me(['pos'], ['pos'], ['waiter'])).has('waiter')).toBe(true);
    expect(featuresOf(me(['storekeeper'], ['stock'], ['waiter'])).has('waiter')).toBe(false);
    // a shop's office offers none: no tables, and no word of an office update for them
    expect(featuresOf(me(['sales'], ['sales'], ['countAdd'])).has('waiter')).toBe(false);
    expect(BUSINESS_FEATURES).toContain('waiter');
    expect(needsNewerOffice(me(['admin'], ['admin'], ['countAdd']))).not.toContain('waiter');
  });
});

describe('dishes picked at the table', () => {
  it('one more of a dish picked again; one with a note stays its own line', () => {
    let list: DishDraft[] = addDish([], kebab);
    list = addDish(list, tea);
    list = addDish(list, kebab);
    expect(list.map((d) => [d.itemId, d.qtyMilli])).toEqual([['k', 2000], ['t', 1000]]);
    list = list.map((d) => (d.itemId === 'k' ? { ...d, note: 'no onion' } : d));
    list = addDish(list, kebab);
    expect(list.map((d) => [d.itemId, d.qtyMilli, d.note])).toEqual([['k', 2000, 'no onion'], ['t', 1000, ''], ['k', 1000, '']]);
    expect(setDishCount(list, 1, 0).map((d) => d.itemId)).toEqual(['k', 'k']);
    expect(setDishCount(list, 1, 3)[1]!.qtyMilli).toBe(3000);
  });

  it('sends each dish with its note (trimmed, at most 120 characters) and nothing else', () => {
    const body = dishesBody([{ itemId: 'k', name: kebab.name, qtyMilli: 2000, note: '  no onion ' }, { itemId: 't', name: tea.name, qtyMilli: 1000, note: ' ' }, { itemId: 'x', name: tea.name, qtyMilli: 1000, note: 'y'.repeat(200) }]);
    expect(body.lines[0]).toEqual({ itemId: 'k', qtyMilli: 2000, note: 'no onion' });
    expect(body.lines[1]).toEqual({ itemId: 't', qtyMilli: 1000 });
    expect(body.lines[2]!.note).toHaveLength(120);
  });

  it('says where each dish is', () => {
    const l = { voided: null, ticket: null, readyAt: null, servedAt: null };
    expect(lineState(l)).toBe('unsent');
    expect(lineState({ ...l, ticket: 1 })).toBe('cooking');
    expect(lineState({ ...l, ticket: 1, readyAt: 'x' })).toBe('ready');
    expect(lineState({ ...l, ticket: 1, readyAt: 'x', servedAt: 'y' })).toBe('served');
    expect(lineState({ ...l, ticket: 1, voided: { reason: 'r' } })).toBe('cancelled');
    expect(minutesSince('2026-11-26T18:00:00Z', Date.parse('2026-11-26T18:17:59Z'))).toBe(17);
  });
});

describe('the screens', () => {
  it('has every text of the tables in Arabic, English and Kurdish', () => {
    const source = readFileSync(join(root, 'src/screens/staff/tables.tsx'), 'utf8');
    const keys = [...new Set([...source.matchAll(/\bt\('(\w+)'/g)].map((m) => m[1]!))];
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) for (const lang of LANGS) expect(translate(lang, key as never), `${lang} ${key}`).not.toBe(key);
  });

  it('opens the tables from home, and draws both screens', () => {
    expect(readFileSync(join(root, 'src/screens/home.tsx'), 'utf8')).toContain("{ icon: 'table', label: t('rsTables'), route: { name: 'tables' }, on: can('waiter') }");
    const app = readFileSync(join(root, 'App.tsx'), 'utf8');
    expect(app).toContain("{route.name === 'tables' && <TablesScreen />}");
    expect(app).toContain("{route.name === 'tableOrder' && <TableOrderScreen key={route.id} id={route.id} />}");
  });
});
