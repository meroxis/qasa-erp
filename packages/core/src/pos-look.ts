import type { BusinessType } from './plans.ts';

/**
 * How the till looks, kept with the company's settings so every PC of the company agrees.
 *
 * Quick buttons: a row above the till's categories, a small picture with the name and the price; one tap adds one.
 * The company's list, in its order, at most POS_QUICK_MAX items; an admin edits it on the till itself.
 *
 * Big pictures: the till's tiles with a large picture and a clear price, in three states:
 * - 'auto' (the default): on for a phone shop (business type mobileShop), where a customer points at the picture
 * - 'on': big pictures, whatever the business type
 * - 'off': the normal tiles, whatever the business type
 */
export const POS_QUICK_MAX = 24;

export const POS_BIG_PICTURES = ['auto', 'on', 'off'] as const;
export type PosBigPictures = (typeof POS_BIG_PICTURES)[number];

export function isPosBigPictures(value: unknown): value is PosBigPictures {
  return typeof value === 'string' && (POS_BIG_PICTURES as readonly string[]).includes(value);
}

/** The business types whose till has big pictures by default: a phone shop. */
export const BIG_PICTURE_BUSINESS_TYPES: readonly BusinessType[] = ['mobileShop'];

export interface PosBigPicturesInput {
  /** the company's choice; undefined from an office server from before this setting (it follows the business type) */
  posBigPictures?: PosBigPictures | null;
  businessTypes?: readonly BusinessType[] | null;
}

/** Whether the till shows big picture tiles: the company's choice, else its business type. */
export function posBigTiles(s: PosBigPicturesInput): boolean {
  if (s.posBigPictures === 'on') return true;
  if (s.posBigPictures === 'off') return false;
  return !!s.businessTypes?.some((b) => BIG_PICTURE_BUSINESS_TYPES.includes(b));
}
