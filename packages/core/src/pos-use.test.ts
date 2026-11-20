import { describe, expect, it } from 'vitest';
import { BUSINESS_TYPES } from './plans.ts';
import { COUNTER_BUSINESS_TYPES, isPosUse, POS_USE, posByBusiness, posShown } from './pos-use.ts';

describe('the point of sale by business type (1.5.2)', () => {
  it('shows by default only for a business that sells at a counter', () => {
    const counter = BUSINESS_TYPES.filter((b) => posByBusiness([b]));
    expect(counter).toEqual(['trade', 'market', 'mobileShop', 'autoParts', 'electricalSolar', 'pharmacy', 'clothingShop']);
    expect([...COUNTER_BUSINESS_TYPES].sort()).toEqual([...counter].sort());
    for (const b of ['realEstate', 'engineeringWorks', 'generators'] as const) expect(posByBusiness([b])).toBe(false);
    // any of several types that sells at a counter is enough
    expect(posByBusiness(['engineeringWorks', 'autoParts'])).toBe(true);
    // not said yet: as before (every company had the till)
    expect(posByBusiness(null)).toBe(true);
    expect(posByBusiness([])).toBe(true);
  });

  it('follows the business type only while auto, and the company’s own choice wins', () => {
    const works = ['engineeringWorks'] as const;
    expect(posShown({ posUse: 'auto', businessTypes: works })).toBe(false);
    // a company that has sold at the till keeps nothing by that (the owner's decision): only the switch turns it on
    expect(posShown({ posUse: 'auto', businessTypes: works, posUsed: true } as never)).toBe(false);
    expect(posShown({ posUse: 'on', businessTypes: works })).toBe(true);
    expect(posShown({ posUse: 'off', businessTypes: ['market'] })).toBe(false);
    // an office server older than 1.5.2 says nothing: the till shows, as it did
    expect(posShown({ businessTypes: works })).toBe(true);
  });

  it('knows its three states', () => {
    expect(POS_USE).toEqual(['auto', 'on', 'off']);
    for (const v of POS_USE) expect(isPosUse(v)).toBe(true);
    for (const v of ['', 'yes', null, undefined, 1, 'ON']) expect(isPosUse(v)).toBe(false);
  });
});
