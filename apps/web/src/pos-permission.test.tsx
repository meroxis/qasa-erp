import { describe, expect, it } from 'vitest';
import { ROLES, type Permission } from './api.ts';
import { makeI18n } from './i18n.ts';
import { may } from './may.ts';
import { allPages, canSee, findPage, NAV, pageOpen, visibleItems, type NavViewer } from './nav.ts';

// 1.5.2: the till is a permission of its own, the Point of sale role, given per person by an admin; the sales role alone
// no longer reaches it (the owner's decision, 2026-11-17: nobody gets it by an update)

const till = findPage('pos_title')!;
const salesGroup = NAV.find((g) => g.group === 'gSales')!;
const person = (permissions: Permission[], more: Partial<NavViewer> = {}): NavViewer =>
  ({ admin: permissions.includes('admin'), permissions, businessTypes: ['market'], noBooks: !permissions.includes('admin'), pos: true, ...more });

describe('the Point of sale role in Users', () => {
  it('is offered next to Sales, with its words in Arabic, English and Kurdish', () => {
    expect(ROLES).toEqual(['admin', 'preparer', 'checker', 'approver', 'sales', 'pos', 'purchasing', 'storekeeper', 'viewer']);
    const words = (lang: 'ar' | 'en' | 'ku') => { const { t } = makeI18n(lang, 'western', () => {}, () => {}); return [t('role_pos'), t('roleHelp_pos')]; };
    expect(words('en')).toEqual(['Point of sale', 'Sells at the point of sale: opens a shift, sells and closes it, without cost or profit']);
    // the till's own words (i18n/pos.ts pos_title)
    expect(words('ar')[0]).toBe('نقطة البيع (الكاشير)');
    expect(words('ku')[0]).toBe('خاڵی فرۆشتن (کاشێر)');
    for (const lang of ['ar', 'ku'] as const) {
      const { t } = makeI18n(lang, 'western', () => {}, () => {});
      expect(t('role_pos')).toBe(t('pos_title'));
      expect(words(lang)[1]).not.toBe(words('en')[1]);
    }
  });
});

describe('the till for each person, in a company that uses it', () => {
  it('shows to sales + pos, pos alone and an admin; not to the sales role alone', () => {
    for (const [perms, sees] of [[['sales'], false], [['sales', 'pos'], true], [['pos'], true], [['admin'], true], [['stock'], false], [[], false]] as const) {
      const v = person([...perms]);
      expect(canSee(till, v), perms.join('+')).toBe(sees);
      // the menu's Sales group and the home page's tiles, the search, the address (#/pos)
      expect(visibleItems(salesGroup.items, v).some((i) => i.key === 'pos_title'), perms.join('+')).toBe(sees);
      expect(allPages(v).some((p) => p.key === 'pos_title'), perms.join('+')).toBe(sees);
      expect(pageOpen('pos', undefined, v), perms.join('+')).toBe(sees);
      expect(may(v.permissions, 'till'), perms.join('+')).toBe(sees);
    }
    // sales alone keeps its sales invoices and customers
    expect(visibleItems(salesGroup.items, person(['sales'])).map((i) => i.key)).toEqual(expect.arrayContaining(['invoices', 'customers']));
    // pos alone sells at the till only: no sales invoice
    expect(may(['pos'], 'sale')).toBe(false);
  });

  it('needs the company switch too: a person with pos in a company that does not use the till sees none', () => {
    expect(canSee(till, person(['sales', 'pos'], { pos: false }))).toBe(false);
    expect(canSee(till, person(['admin'], { pos: false }))).toBe(false);
  });

  it('opens a shift report (X or Z) for whoever the server lets read the shift, the sales role alone too', () => {
    // a cashier's old shifts (the end-of-day close links them) and the books' people: the server answers for each shift
    for (const perms of [['sales'], ['pos'], ['entries.prepare'], ['admin']] as Permission[][]) {
      expect(pageOpen('pos-shift', 'some-id', person(perms)), perms.join('+')).toBe(true);
    }
  });
});
