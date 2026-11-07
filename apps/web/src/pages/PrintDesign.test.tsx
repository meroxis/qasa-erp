import { describe, expect, it } from 'vitest';
import { checkPrintDesign, DEFAULT_PRINT_DESIGN } from '@qasa/core';
import { problemText, withLayout } from './PrintDesign.tsx';

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

  it('says what is wrong with a design file in words, with where', () => {
    const t = (k: string) => (k === 'err_pd_invalid_colour' ? 'Bad colour' : k);
    expect(problemText(t as never, { code: 'pd_invalid_colour', path: 'design.accent' })).toBe('Bad colour (design.accent)');
    expect(problemText(t as never, { code: 'something_new', path: '' })).toBe('something_new');
  });
});
