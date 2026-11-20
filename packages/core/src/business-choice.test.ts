import { describe, expect, it } from 'vitest';
import { businessUnion, checkBusinessChoice, choiceFromStored, MAX_EXTRA_BUSINESS_TYPES } from './business-choice.ts';

describe('one main business type, and what the company also does (1.7)', () => {
  it('reads a 1.7 company file: the main type, and the rest of the list as extras', () => {
    expect(choiceFromStored('pharmacy', ['pharmacy', 'market'])).toEqual({ main: 'pharmacy', extras: ['market'] });
    expect(choiceFromStored('market', ['market'])).toEqual({ main: 'market', extras: [] });
  });

  it('reads a company from before 1.7 (a list, general trade first) without hiding any page it had', () => {
    // the first industry ticked is the main one; general trade stays among the extras, so the till still shows
    expect(choiceFromStored(null, ['trade', 'pharmacy'])).toEqual({ main: 'pharmacy', extras: ['trade'] });
    expect(choiceFromStored(undefined, ['trade'])).toEqual({ main: 'trade', extras: [] });
    // more than two other types stay as they were
    const many = choiceFromStored(null, ['trade', 'mobileShop', 'autoParts', 'electricalSolar', 'generators'])!;
    expect(many.main).toBe('mobileShop');
    expect(businessUnion(many).sort()).toEqual(['autoParts', 'electricalSolar', 'generators', 'mobileShop', 'trade']);
  });

  it('has nothing until something known was chosen, and drops names it does not know (a newer app’s type)', () => {
    expect(choiceFromStored(null, null)).toBeNull();
    expect(choiceFromStored(null, [])).toBeNull();
    expect(choiceFromStored('bakery', ['bakery', 'market'])).toEqual({ main: 'market', extras: [] });
    expect(choiceFromStored(null, ['market', 'market', 'bakery'])).toEqual({ main: 'market', extras: [] });
  });

  it('shows the main type’s pages first, each type once', () => {
    expect(businessUnion({ main: 'pharmacy', extras: ['market', 'pharmacy'] })).toEqual(['pharmacy', 'market']);
  });

  it('allows up to two extras, never the main one, never twice', () => {
    expect(MAX_EXTRA_BUSINESS_TYPES).toBe(2);
    expect(checkBusinessChoice({ main: 'market', extras: ['pharmacy', 'mobileShop'] }, null)).toBeNull();
    expect(checkBusinessChoice({ main: 'market', extras: ['market'] }, null)).toBe('business_type_extra_is_main');
    expect(checkBusinessChoice({ main: 'market', extras: ['pharmacy', 'pharmacy'] }, null)).toBe('business_type_extra_twice');
    expect(checkBusinessChoice({ main: 'market', extras: ['pharmacy', 'mobileShop', 'autoParts'] }, null)).toBe('business_type_too_many_extras');
  });

  it('lets a company from before 1.7 keep more than two, but not add a new one to them', () => {
    const before = { main: 'mobileShop', extras: ['trade', 'autoParts', 'electricalSolar'] } as const;
    const had = { main: before.main, extras: [...before.extras] };
    expect(checkBusinessChoice(had, had)).toBeNull();
    expect(checkBusinessChoice({ main: 'mobileShop', extras: ['trade', 'autoParts'] }, had)).toBeNull();
    expect(checkBusinessChoice({ main: 'mobileShop', extras: ['trade', 'autoParts', 'generators'] }, had)).toBe('business_type_too_many_extras');
    // a new main type keeps the old ones as they were
    expect(checkBusinessChoice({ main: 'autoParts', extras: ['trade', 'electricalSolar', 'mobileShop'] }, had)).toBeNull();
  });
});
