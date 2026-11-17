import type { BusinessType } from './plans.ts';

/**
 * How the till looks, kept with the company's settings so every PC of the company agrees.
 *
 * Quick buttons: a row above the till's categories, a small picture with the name and the price; one tap adds one.
 * The company's list, in its order, at most POS_QUICK_MAX items; an admin edits it on the till itself.
 *
 * Big pictures: the till's tiles with a large picture and a clear price, in three states:
 * - 'auto' (the default, nobody has chosen yet): the normal tiles, for every company and business type
 * - 'on': big pictures, whatever the business type
 * - 'off': the normal tiles, whatever the business type
 */
export const POS_QUICK_MAX = 24;

export const POS_BIG_PICTURES = ['auto', 'on', 'off'] as const;
export type PosBigPictures = (typeof POS_BIG_PICTURES)[number];

export function isPosBigPictures(value: unknown): value is PosBigPictures {
  return typeof value === 'string' && (POS_BIG_PICTURES as readonly string[]).includes(value);
}

export interface PosBigPicturesInput {
  /** the company's choice; undefined from an office server from before this setting (normal tiles) */
  posBigPictures?: PosBigPictures | null;
  businessTypes?: readonly BusinessType[] | null;
}

/** Whether the till shows big picture tiles: only once an admin has turned them on; off by default for every company. */
export function posBigTiles(s: PosBigPicturesInput): boolean {
  return s.posBigPictures === 'on';
}
