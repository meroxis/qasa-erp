import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LABEL_LAYOUT_PAPER, LABEL_LAYOUTS } from '@qasa/core';
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

describe('the paper a chosen label printer gets', () => {
  it('is the paper of the layout picked here: A4 for a sheet, the label size for a label printer', () => {
    expect(Object.keys(LABEL_SIZES).sort()).toEqual([...LABEL_LAYOUTS].sort());
    for (const [layout, s] of Object.entries(LABEL_SIZES)) {
      expect(LABEL_LAYOUT_PAPER[layout as keyof typeof LABEL_LAYOUT_PAPER], layout).toBe(s.sheet ? 'A4' : `label${s.w}x${s.h}`);
    }
  });

  it('the Print button names the layout picked, so the saved paper does not decide it', () => {
    const page = readFileSync(new URL('./Labels.tsx', import.meta.url), 'utf8');
    expect(page).toContain("printDocument('label', { labelLayout: size })");
  });
});
