import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Item } from '../src/api';
import { addCount, countSessionBody } from '../src/documents';
import { featuresOf, needsNewerOffice, OFFER_OF, type Me } from '../src/roles';
import { LANGS, translate } from '../src/i18n';

// Qasa ERP 2.1: a count a shelf at a time, on several phones. What a phone puts into the warehouse's open count adds to
// what the count has for each item, when its office offers that ('countAdd'); else it is sent as phone app 1.0 sent it.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const item = (id: string): Item => ({ id, code: id.toUpperCase(), barcode: '', name: { ar: 'كابل', en: 'Cable', ku: 'کێبڵ' }, unit: 'piece', salePrice: 1000, saleCurrency: 'IQD', qtyMilli: 0 });
const me = (roles: string[], permissions: string[], offers?: string[]): Me =>
  ({ signInRequired: true, user: { id: 'u', name: 'Las', roles, permissions }, ...(offers ? { phoneLink: { v: 2, offers } } : {}) });

describe('a count a shelf at a time', () => {
  it('an item counted again on the phone adds to what its list has, and moves to the top', () => {
    let list = addCount([], item('a'), 6);
    list = addCount(list, item('b'), 2);
    list = addCount(list, item('a'), 4.5);
    expect(list.map((l) => [l.item.id, l.qty])).toEqual([['a', 10.5], ['b', 2]]);
    // fractions of a kilo stay exact
    expect(addCount(addCount([], item('c'), 0.1), item('c'), 0.2)[0]!.qty).toBe(0.3);
  });

  it('sends `add` only to an office that offers it', () => {
    const lines = [{ item: item('a'), qty: 12.5 }];
    expect(countSessionBody(lines)).toEqual({ counts: [{ itemId: 'a', countedMilli: 12_500 }] });
    expect(countSessionBody(lines, true)).toEqual({ counts: [{ itemId: 'a', countedMilli: 12_500, add: true }] });
    const screen = readFileSync(join(root, 'src/screens/items.tsx'), 'utf8');
    expect(screen).toContain("const adds = !!session && can('countAdd');");
    expect(screen).toContain('countSessionBody(lists.count, adds)');
  });

  it('who has it: whoever counts into the open count, with an office that offers it', () => {
    expect(OFFER_OF.countAdd).toBe('countAdd');
    expect(featuresOf(me(['storekeeper'], ['stock'], ['countAdd'])).has('countAdd')).toBe(true);
    expect(featuresOf(me(['storekeeper'], ['stock'], ['itemLookup'])).has('countAdd')).toBe(false);
    expect(featuresOf(me(['sales'], ['sales'], ['countAdd'])).has('countAdd')).toBe(false);
    expect(featuresOf({ signInRequired: false, user: null, phoneLink: { v: 2, offers: ['countAdd'] } }).has('countAdd')).toBe(true);
    // the owner of an office before 2.1 is told the PC needs an update for it, by name
    expect(needsNewerOffice(me(['admin'], ['admin'], ['approvals', 'rate', 'dayClose', 'expense', 'share', 'transfer', 'receive', 'itemLookup']))).toEqual(['countAdd']);
  });

  it('says so in Arabic, English and Kurdish', () => {
    for (const lang of LANGS) {
      for (const key of ['openCountAddNote', 'featCountAdd'] as const) expect(translate(lang, key).length, `${lang} ${key}`).toBeGreaterThan(10);
      expect(translate(lang, 'countedSoFar', { n: '7' })).toContain('7');
      expect(translate(lang, 'inYourList', { n: '7' })).toContain('7');
    }
  });
});
