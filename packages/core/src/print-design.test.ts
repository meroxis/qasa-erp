import { describe, expect, it } from 'vitest';
import { checkPrintDesign, DEFAULT_PRINT_DESIGN, DEFAULT_RECEIPT_DESIGN, designFor, LATER_PRINT_FIELDS, PRINT_FIELDS, printFieldApplies, readPrintDesignFile, type PrintDesign } from './print-design.ts';

const design = (over: Record<string, unknown> = {}) => ({ ...structuredClone(DEFAULT_PRINT_DESIGN), ...over });
const problems = (input: unknown) => {
  const r = checkPrintDesign(input);
  return 'problems' in r ? r.problems : [];
};

describe('checking a print design', () => {
  it('takes the default designs as they are', () => {
    expect(checkPrintDesign(DEFAULT_PRINT_DESIGN)).toEqual({ design: DEFAULT_PRINT_DESIGN });
    expect(checkPrintDesign(DEFAULT_RECEIPT_DESIGN)).toEqual({ design: DEFAULT_RECEIPT_DESIGN });
  });

  it('refuses unknown fields at every level, and missing ones', () => {
    expect(problems(design({ html: '<b>x</b>' }))).toContainEqual({ code: 'pd_unknown_field', path: 'html' });
    expect(problems(design({ logo: { position: 'left', heightMm: 10, src: 'http://x' } }))).toContainEqual({ code: 'pd_unknown_field', path: 'logo.src' });
    expect(problems(design({ show: { ...DEFAULT_PRINT_DESIGN.show, script: true } }))).toContainEqual({ code: 'pd_unknown_field', path: 'show.script' });
    expect(problems(design({ labels: { onload: 'x' } }))).toContainEqual({ code: 'pd_unknown_field', path: 'labels.onload' });
    const { terms: _drop, ...noTerms } = DEFAULT_PRINT_DESIGN;
    expect(problems(noTerms)).toContainEqual({ code: 'pd_missing', path: 'terms' });
    expect(problems(null)).toEqual([{ code: 'pd_not_a_design', path: '' }]);
    expect(problems([])).toEqual([{ code: 'pd_not_a_design', path: '' }]);
  });

  it('checks colours, sizes and choices', () => {
    for (const accent of ['red', '#fff', 'url(x)', '#12345g', '#1234567']) expect(problems(design({ accent }))).toContainEqual({ code: 'pd_invalid_colour', path: 'accent' });
    expect(problems(design({ fontSize: 30 }))).toContainEqual({ code: 'pd_out_of_range', path: 'fontSize' });
    expect(problems(design({ fontSize: 10.3 }))).toContainEqual({ code: 'pd_out_of_range', path: 'fontSize' });
    expect(problems(design({ fontSize: 10.5 }))).toEqual([]);
    expect(problems(design({ marginMm: -1 }))).toContainEqual({ code: 'pd_out_of_range', path: 'marginMm' });
    expect(problems(design({ logo: { position: 'top', heightMm: 10 } }))).toContainEqual({ code: 'pd_invalid', path: 'logo.position' });
    expect(problems(design({ logo: { position: 'left', heightMm: 100 } }))).toContainEqual({ code: 'pd_out_of_range', path: 'logo.heightMm' });
    expect(problems(design({ show: { ...DEFAULT_PRINT_DESIGN.show, qr: 'yes' } }))).toContainEqual({ code: 'pd_invalid', path: 'show.qr' });
    expect(problems(design({ secondLang: 'fr' }))).toContainEqual({ code: 'pd_invalid', path: 'secondLang' });
    expect(problems(design({ layout: 'receipt80' }))).toContainEqual({ code: 'pd_receipt_paper', path: 'paper' });
    expect(problems(design({ paper: '80mm' }))).toContainEqual({ code: 'pd_receipt_paper', path: 'paper' });
  });

  it('keeps text within its size, one line for headings, and drops empty names', () => {
    expect(problems(design({ terms: 'x'.repeat(1001) }))).toContainEqual({ code: 'pd_text_invalid', path: 'terms' });
    expect(problems(design({ bankDetails: 'a\u0000b' }))).toContainEqual({ code: 'pd_text_invalid', path: 'bankDetails' });
    expect(problems(design({ labels: { title: 'a\nb' } }))).toContainEqual({ code: 'pd_text_invalid', path: 'labels.title' });
    expect(problems(design({ labels: { title: 'x'.repeat(41) } }))).toContainEqual({ code: 'pd_text_invalid', path: 'labels.title' });
    const r = checkPrintDesign(design({ accent: '#ABCDEF', labels: { title: '  فاتورة  ', unit: '  ' }, terms: 'Line 1\nLine 2' }));
    expect('design' in r && r.design).toMatchObject({ accent: '#abcdef', labels: { title: 'فاتورة' }, terms: 'Line 1\nLine 2' });
  });
});

describe('which design a paper prints with', () => {
  const sale: PrintDesign = { ...DEFAULT_PRINT_DESIGN, layout: 'modern', accent: '#aa0000' };
  const quote: PrintDesign = { ...DEFAULT_PRINT_DESIGN, layout: 'compact' };

  it('uses the defaults when nothing is saved', () => {
    expect(designFor(null, 'sale')).toBe(DEFAULT_PRINT_DESIGN);
    expect(designFor({}, 'voucher')).toBe(DEFAULT_PRINT_DESIGN);
    expect(designFor({}, 'pos')).toBe(DEFAULT_RECEIPT_DESIGN);
  });

  it('prints every kind like the sale invoice unless it has its own', () => {
    const saved = { sale, quote };
    expect(designFor(saved, 'purchase')).toBe(sale);
    expect(designFor(saved, 'return')).toBe(sale);
    expect(designFor(saved, 'voucher')).toBe(sale);
    expect(designFor(saved, 'quote')).toBe(quote);
    expect(designFor(saved, 'pos')).toBe(DEFAULT_RECEIPT_DESIGN);
  });
});

describe('the parts added in 1.4', () => {
  const older = (d: PrintDesign, over: Record<string, boolean> = {}) =>
    ({ ...d, show: { ...Object.fromEntries(PRINT_FIELDS.filter((f) => !LATER_PRINT_FIELDS[f]).map((f) => [f, d.show[f]])), ...over } });

  it('reads a design saved before them as it printed then', () => {
    expect(checkPrintDesign(older(DEFAULT_PRINT_DESIGN))).toEqual({ design: DEFAULT_PRINT_DESIGN });
    expect(checkPrintDesign(older(DEFAULT_RECEIPT_DESIGN))).toEqual({ design: DEFAULT_RECEIPT_DESIGN });
    const withBalance = checkPrintDesign(older(DEFAULT_PRINT_DESIGN, { partyBalance: true }));
    expect('design' in withBalance && withBalance.design.show).toMatchObject({ partyBalance: true, previousBalance: true });
  });

  it('still refuses a part that is not a yes or no, and a part of before 1.4 that is missing', () => {
    expect(problems({ ...DEFAULT_PRINT_DESIGN, show: { ...DEFAULT_PRINT_DESIGN.show, logo: 'yes' } })).toContainEqual({ code: 'pd_invalid', path: 'show.logo' });
    const { qr: _drop, ...noQr } = DEFAULT_PRINT_DESIGN.show;
    expect(problems({ ...DEFAULT_PRINT_DESIGN, show: noQr })).toContainEqual({ code: 'pd_invalid', path: 'show.qr' });
  });

  it('knows which parts a kind of paper and a layout can print', () => {
    expect(printFieldApplies('itemCode', 'voucher', 'classic')).toBe(false);
    expect(printFieldApplies('previousBalance', 'voucher', 'ledger')).toBe(true);
    expect(printFieldApplies('qr', 'sale', 'modernLines')).toBe(true);
    expect(printFieldApplies('qr', 'quote', 'modernLines')).toBe(false);
    expect(printFieldApplies('pageNumbers', 'pos', 'receipt80')).toBe(false);
    expect(printFieldApplies('discount', 'sale', 'classic')).toBe(false);
  });
});

describe('design files', () => {
  it('reads back what was exported, and refuses anything else', () => {
    expect(readPrintDesignFile({ qasa: 'print-design', version: 1, doc: 'quote', design: DEFAULT_PRINT_DESIGN })).toEqual({ doc: 'quote', design: DEFAULT_PRINT_DESIGN });
    expect(readPrintDesignFile({ qasa: 'print-design', version: 2, doc: 'quote', design: DEFAULT_PRINT_DESIGN })).toEqual({ problems: [{ code: 'pd_not_a_design_file', path: '' }] });
    expect(readPrintDesignFile({ qasa: 'print-design', version: 1, design: { ...DEFAULT_PRINT_DESIGN, accent: 'red' } }))
      .toEqual({ problems: [{ code: 'pd_invalid_colour', path: 'design.accent' }] });
  });
});
