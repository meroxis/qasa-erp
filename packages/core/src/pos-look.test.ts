import { describe, expect, it } from 'vitest';
import { BUSINESS_TYPES } from './plans.ts';
import { isPosBigPictures, POS_QUICK_MAX, posBigTiles } from './pos-look.ts';

describe('big pictures on the till', () => {
  it('are on by the business type for a phone shop only', () => {
    for (const b of BUSINESS_TYPES) expect(posBigTiles({ posBigPictures: 'auto', businessTypes: [b] }), b).toBe(b === 'mobileShop');
    expect(posBigTiles({ posBigPictures: 'auto', businessTypes: ['trade', 'mobileShop'] })).toBe(true);
    // a company that has not said what it does, or an office server from before the choice: normal tiles
    expect(posBigTiles({ posBigPictures: 'auto', businessTypes: null })).toBe(false);
    expect(posBigTiles({ businessTypes: ['mobileShop'] })).toBe(true);
    expect(posBigTiles({})).toBe(false);
  });

  it('follow the company’s choice over the business type', () => {
    expect(posBigTiles({ posBigPictures: 'on', businessTypes: ['market'] })).toBe(true);
    expect(posBigTiles({ posBigPictures: 'on', businessTypes: null })).toBe(true);
    expect(posBigTiles({ posBigPictures: 'off', businessTypes: ['mobileShop'] })).toBe(false);
  });

  it('know their three states, and the quick buttons their limit', () => {
    for (const v of ['auto', 'on', 'off']) expect(isPosBigPictures(v)).toBe(true);
    for (const v of ['', 'big', null, undefined, 1, true]) expect(isPosBigPictures(v)).toBe(false);
    expect(POS_QUICK_MAX).toBe(24);
  });
});
