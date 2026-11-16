import type { BusinessType } from './plans.ts';

/**
 * Whether a company uses the point of sale (the till) (1.5.2). Not every company sells at a counter: an engineering
 * works, a real-estate office or a generator owner bills by invoice, and a till in the menu is only in their way.
 *
 * Kept with the company's settings (so every PC of the company agrees), in three states:
 * - 'auto' (the default): follow the business type, and keep the till for a company that has used it
 * - 'on': shown, whatever the business type
 * - 'off': hidden, whatever the business type (the company's own choice in Settings → Sales and point of sale)
 */
export const POS_USE = ['auto', 'on', 'off'] as const;
export type PosUse = (typeof POS_USE)[number];

export function isPosUse(value: unknown): value is PosUse {
  return typeof value === 'string' && (POS_USE as readonly string[]).includes(value);
}

/**
 * The business types that sell at a counter, so the till shows for them by default: general trade and shops, a market
 * or supermarket, a pharmacy, a phone shop, a car-parts shop, an electrical and solar shop. Not: real estate,
 * engineering works, generators (they bill by invoice or by subscription).
 */
export const COUNTER_BUSINESS_TYPES: readonly BusinessType[] = ['trade', 'market', 'pharmacy', 'mobileShop', 'autoParts', 'electricalSolar'];

/**
 * Whether the till shows by default for these business types: when any of them sells at a counter. A company that has
 * not said what it does yet (null or none) keeps it, as every company had it before.
 */
export function posByBusiness(businessTypes: readonly BusinessType[] | null | undefined): boolean {
  if (!businessTypes || businessTypes.length === 0) return true;
  return businessTypes.some((b) => COUNTER_BUSINESS_TYPES.includes(b));
}

export interface PosUseInput {
  /** the company's choice; undefined from an office server older than 1.5.2 (the till shows, as it always did) */
  posUse?: PosUse | null;
  /** whether the company ever opened a till shift (so has sold at it): such a company keeps the till */
  posUsed?: boolean | null;
  businessTypes?: readonly BusinessType[] | null;
}

/** Whether the company's menu, home page and search show the point of sale. */
export function posShown(s: PosUseInput): boolean {
  if (s.posUse === 'on') return true;
  if (s.posUse === 'off') return false;
  if (s.posUse === undefined || s.posUse === null) return true;
  return !!s.posUsed || posByBusiness(s.businessTypes);
}
