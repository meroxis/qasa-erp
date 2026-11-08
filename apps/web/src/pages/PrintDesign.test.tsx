import { describe, expect, it } from 'vitest';
import { checkPrintDesign, DEFAULT_PRINT_DESIGN, PRINT_FIELDS } from '@qasa/core';
import { LABEL_TEXT } from '../i18n/labels.ts';
import { DESIGNER_FIELDS, problemText, withLayout } from './PrintDesign.tsx';

describe('the print designer', () => {
  it('moves the thermal receipt onto 80 mm paper and back to A4, always as a design the server accepts', () => {
    const receipt = withLayout(DEFAULT_PRINT_DESIGN, 'receipt80');
    expect(receipt).toMatchObject({ layout: 'receipt80', paper: '80mm' });
    expect(receipt.marginMm).toBeLessThanOrEqual(5);
    expect('design' in checkPrintDesign(receipt)).toBe(true);
    const back = withLayout(receipt, 'modern');
    expect(back).toMatchObject({ layout: 'modern', paper: 'A4', marginMm: DEFAULT_PRINT_DESIGN.marginMm });
    expect('design' in checkPrintDesign(back)).toBe(true);
    expect(withLayout({ ...DEFAULT_PRINT_DESIGN, paper: 'A5' }, 'compact').paper).toBe('A5');
  });

  it('offers no discount column (lines have no discount of their own), yet still accepts a design saved with one', () => {
    expect(DESIGNER_FIELDS).not.toContain('discount');
    expect(DESIGNER_FIELDS).toEqual(PRINT_FIELDS.filter((f) => f !== 'discount'));
    const older = { ...DEFAULT_PRINT_DESIGN, show: { ...DEFAULT_PRINT_DESIGN.show, discount: true } };
    expect('design' in checkPrintDesign(older)).toBe(true);
  });

  it('has a label for each field it offers, and none for a field it does not', () => {
    const labels = Object.keys(LABEL_TEXT).filter((k) => k.startsWith('pd_f_')).map((k) => k.slice('pd_f_'.length)).sort();
    expect(labels).toEqual([...DESIGNER_FIELDS].sort());
  });

  it('says what is wrong with a design file in words, with where', () => {
    const t = (k: string) => (k === 'err_pd_invalid_colour' ? 'Bad colour' : k);
    expect(problemText(t as never, { code: 'pd_invalid_colour', path: 'design.accent' })).toBe('Bad colour (design.accent)');
    expect(problemText(t as never, { code: 'something_new', path: '' })).toBe('something_new');
  });
});
