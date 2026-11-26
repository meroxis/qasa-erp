import { BUSINESS_TYPES, isBusinessType, type BusinessType } from './plans.ts';

/**
 * What a company does (1.7): ONE main type, chosen at the start, and at most two more it also does (Settings → "My
 * company also does…"). The menu shows the pages of all of them (the union); the plan still decides what can be used.
 *
 * Before 1.7 a company ticked any number of types (`business_types`, a list). Such a company keeps every page it had:
 * its main type is the first industry it ticked (general trade when it ticked nothing else), the rest stay as extras,
 * even more than two; only adding a new extra past two is refused.
 */
export const MAX_EXTRA_BUSINESS_TYPES = 2;

export interface BusinessChoice { main: BusinessType; extras: BusinessType[] }

/** The pages to show: the main type first, then the extras, each once. */
export function businessUnion(choice: BusinessChoice): BusinessType[] {
  return [...new Set([choice.main, ...choice.extras])];
}

/**
 * A choice from what a company file keeps: `main` (1.7 on, may be missing) and `list` (every type, the main one first
 * since 1.7; before 1.7 the ticked ones in the app's own order, general trade first). Unknown names are dropped (a
 * newer app's type on an older one). null when nothing usable was ever chosen.
 */
export function choiceFromStored(main: unknown, list: unknown): BusinessChoice | null {
  const types = Array.isArray(list) ? [...new Set(list.filter(isBusinessType))] : [];
  if (isBusinessType(main)) return { main, extras: types.filter((t) => t !== main) };
  if (!types.length) return null;
  // before 1.7: the first industry ticked is what the company mainly does; general trade only when it is all there is
  const first = types.find((t) => t !== 'trade') ?? types[0]!;
  return { main: first, extras: types.filter((t) => t !== first) };
}

export type BusinessChoiceError = 'business_type_extra_is_main' | 'business_type_extra_twice' | 'business_type_too_many_extras';

/**
 * Checks a new choice against the one the company has now (`before`, null at the start). Known names only (the API's
 * schema already refuses others). Extras: no main among them, none twice, and at most two, except that extras the
 * company already had are never taken away: a company from before 1.7 with more may keep them, but not add another.
 */
export function checkBusinessChoice(next: BusinessChoice, before: BusinessChoice | null): BusinessChoiceError | null {
  if (next.extras.includes(next.main)) return 'business_type_extra_is_main';
  if (new Set(next.extras).size !== next.extras.length) return 'business_type_extra_twice';
  if (next.extras.length > MAX_EXTRA_BUSINESS_TYPES) {
    const had = new Set(before ? businessUnion(before) : []);
    if (next.extras.some((t) => !had.has(t))) return 'business_type_too_many_extras';
  }
  return null;
}

/** The types in the app's own order (for lists that should not depend on the order things were ticked). */
export function inAppOrder(types: readonly BusinessType[]): BusinessType[] {
  return BUSINESS_TYPES.filter((t) => types.includes(t));
}
