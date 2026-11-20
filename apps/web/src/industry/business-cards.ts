import { BUSINESS_FEATURE, PAID_PLAN_IDS, PLANS, type BusinessType, type PaidPlanId } from '@qasa/core';
import type { PlanStatus } from '../api.ts';
import type { Key } from '../i18n.ts';

/**
 * The cards of "What does your company mainly do?" (1.7), one entry per business type, in the order they show.
 *
 * Adding a type: one entry here (its group and the 3–5 menu pages it brings, as their menu names), the type's two
 * texts `bt_<type>` (its name) and `bt_<type>Text` (one plain line), and, if you like, a picture in BusinessArt.tsx
 * (without one the card shows its group's picture). Nothing else in the picker or the Settings page needs changing.
 */
export type BusinessGroup = 'shops' | 'services' | 'energy' | 'property';

export interface BusinessCard {
  type: BusinessType;
  group: BusinessGroup;
  /** the main menu pages the type brings or uses most, as their menu names (3 to 5) */
  pages: readonly Key[];
}

export const BUSINESS_GROUPS: readonly BusinessGroup[] = ['shops', 'services', 'energy', 'property'];

export const BUSINESS_CARDS: readonly BusinessCard[] = [
  { type: 'trade', group: 'shops', pages: ['invoices', 'purchaseInvoices', 'items', 'customers', 'br_reports'] },
  { type: 'market', group: 'shops', pages: ['pos_title', 'items', 'lb_title', 'ex_title', 'of_title'] },
  { type: 'pharmacy', group: 'shops', pages: ['phm_title', 'pos_title', 'ex_title', 'items'] },
  { type: 'mobileShop', group: 'shops', pages: ['mob_nav', 'pos_title', 'items', 'installments'] },
  { type: 'autoParts', group: 'shops', pages: ['pt_title', 'pos_title', 'items', 'purchaseInvoices'] },
  { type: 'engineeringWorks', group: 'services', pages: ['ew_jobs', 'qt_title', 'purchaseInvoices', 'br_expenses'] },
  { type: 'electricalSolar', group: 'energy', pages: ['sl_title', 'qt_title', 'items', 'installments'] },
  { type: 'generators', group: 'energy', pages: ['gen_title', 'customers', 'br_expenses'] },
  { type: 'petrolStation', group: 'energy', pages: ['ps_title', 'dc_title', 'br_expenses', 'suppliers'] },
  { type: 'realEstate', group: 'property', pages: ['re_title', 'installments', 'customers', 'invoices'] }
];

/** The card a new company is offered first: general trade fits almost everyone. */
export const SUGGESTED_TYPE: BusinessType = 'trade';

export const cardOf = (type: BusinessType): BusinessCard | undefined => BUSINESS_CARDS.find((c) => c.type === type);
export const titleKey = (type: BusinessType) => `bt_${type}` as Key;
export const lineKey = (type: BusinessType) => `bt_${type}Text` as Key;

/**
 * For search: lower case, without Arabic marks and the tatweel, and the letters Arabic and Kurdish write two ways as
 * one (ي ى ی, ك ک, ه ە ة, the alefs), so "صيدليه", "صیدلیة" and "Pharmacy" find what they should.
 */
export function searchable(text: string): string {
  return text.toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[ىی]/g, 'ي').replace(/ک/g, 'ك').replace(/[ەة]/g, 'ه').replace(/[أإآ]/g, 'ا')
    .replace(/\s+/g, ' ').trim();
}

/** The cards whose name or line (in any of the texts given: the screen's language and English) has every word typed. */
export function matchCards(cards: readonly BusinessCard[], query: string, textsOf: (card: BusinessCard) => readonly string[]): BusinessCard[] {
  const words = searchable(query).split(' ').filter(Boolean);
  if (!words.length) return [...cards];
  return cards.filter((card) => {
    const hay = searchable(textsOf(card).join(' '));
    return words.every((w) => hay.includes(w));
  });
}

/** The cheapest paid plan that has the type's pages; null for a type every plan has (general trade, market). */
export function cheapestPlanFor(type: BusinessType): PaidPlanId | null {
  const feature = BUSINESS_FEATURE[type];
  if (!feature) return null;
  return PAID_PLAN_IDS.find((id) => PLANS[id].features.includes(feature)) ?? 'business';
}

/** What the card says about the plan: every plan; in this plan; the free first month then a plan; or which plan. */
export function planLine(type: BusinessType, plan: Pick<PlanStatus, 'features' | 'source' | 'trialAvailable'> | null): { key: Key; plan: PaidPlanId | null } {
  const needs = cheapestPlanFor(type);
  const feature = BUSINESS_FEATURE[type];
  if (!feature || !needs) return { key: 'bc_planFree', plan: null };
  if (plan?.source === 'trial' || (plan?.trialAvailable && !plan.features.includes(feature))) return { key: 'bc_planTrial', plan: needs };
  if (plan?.features.includes(feature)) return { key: 'bc_planIncluded', plan: needs };
  return { key: 'bc_planNeeds', plan: needs };
}

/**
 * Arrow keys in the list of cards (one choice, as radio buttons): down and the reading direction's "next" arrow go
 * forward, up and the other back, round at the ends; Home and End to the first and last. null for any other key.
 */
export function nextIndex(current: number, key: string, count: number, rtl: boolean): number | null {
  if (count <= 0) return null;
  const forward = key === 'ArrowDown' || key === (rtl ? 'ArrowLeft' : 'ArrowRight');
  const back = key === 'ArrowUp' || key === (rtl ? 'ArrowRight' : 'ArrowLeft');
  if (forward) return (current + 1) % count;
  if (back) return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
