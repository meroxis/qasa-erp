import { describe, expect, it } from 'vitest';
import { labelPageRule, labelRun, LABEL_SIZES } from './Labels.tsx';

describe('label sheets', () => {
  it('repeats each item as many times as asked, after the places skipped on a used sheet', () => {
    expect(labelRun([{ itemId: 'a', copies: 2 }, { itemId: 'b', copies: 1 }, { itemId: 'c', copies: 0 }], 2)).toEqual([null, null, 'a', 'a', 'b']);
  });

  it('prints one label per page on a label printer and fills A4 sheets edge to edge', () => {
    expect(labelPageRule('38x25')).toBe('@page { size: 38mm 25mm; margin: 0; }');
    expect(labelPageRule('a4_3x8')).toBe('@page { size: A4; margin: 0; }');
    for (const s of Object.values(LABEL_SIZES)) {
      if (!s.sheet) continue;
      expect(s.w * s.cols).toBeLessThanOrEqual(210);
      expect(s.h * s.rows).toBeLessThanOrEqual(297);
    }
  });
});
