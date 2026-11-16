import { describe, expect, it } from 'vitest';
import { BUSINESS_TYPES } from './plans.ts';
import { COUNTER_BUSINESS_TYPES, isPosUse, POS_USE, posByBusiness, posShown } from './pos-use.ts';

describe('the point of sale by business type (1.5.2)', () => {
  it('shows by default only for a business that sells at a counter', () => {
    const counter = BUSINESS_TYPES.filter((b) => posByBusiness([b]));
    expect(counter).toEqual(['trade', 'market', 'mobileShop', 'autoParts', 'electricalSolar', 'pharmacy']);
    expect([...COUNTER_BUSINESS_TYPES].sort()).toEqual([...counter].sort());
    for (const b of ['realEstate', 'engineeringWorks', 'generators'] as const) expect(posByBusiness([b])).toBe(false);
    // any of several types that sells at a counter is enough
    expect(posByBusiness(['engineeringWorks', 'autoParts'])).toBe(true);
    // not said yet: as before (every company had the till)
    expect(posByBusiness(null)).toBe(true);
    expect(posByBusiness([])).toBe(true);
  });

  it('keeps the till of a company that has used it, and the company’s own choice wins', () => {
    const works = ['engineeringWorks'] as const;
    expect(posShown({ posUse: 'auto', posUsed: false, businessTypes: works })).toBe(false);
    expect(posShown({ posUse: 'auto', posUsed: true, businessTypes: works })).toBe(true);
    expect(posShown({ posUse: 'on', posUsed: false, businessTypes: works })).toBe(true);
    expect(posShown({ posUse: 'off', posUsed: true, businessTypes: ['market'] })).toBe(false);
    // an office server older than 1.5.2 says nothing: the till shows, as it did
    expect(posShown({ businessTypes: works })).toBe(true);
  });

  it('knows its three states', () => {
    expect(POS_USE).toEqual(['auto', 'on', 'off']);
    for (const v of POS_USE) expect(isPosUse(v)).toBe(true);
    for (const v of ['', 'yes', null, undefined, 1, 'ON']) expect(isPosUse(v)).toBe(false);
  });
});
