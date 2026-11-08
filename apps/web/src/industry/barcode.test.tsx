import { describe, expect, it } from 'vitest';
import { barcodeFor, barsPath, code128Values, ean13CheckDigit, encodeCode128, encodeEan13, isEan13 } from './barcode.ts';

describe('EAN-13', () => {
  it('knows a right check digit', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(isEan13('4006381333931')).toBe(true);
    expect(isEan13('4006381333932')).toBe(false);
    expect(isEan13('400638133393')).toBe(false);
  });

  it('draws 95 modules: guards, 6 left digits, centre, 6 right digits', () => {
    const b = encodeEan13('4006381333931');
    expect(b.modules).toBe(95);
    expect(b.widths.reduce((a, c) => a + c, 0)).toBe(95);
    // start guard 101: bar 1, space 1, bar 1
    expect(b.widths.slice(0, 3)).toEqual([1, 1, 1]);
    // 30 bars in all (2 + 6×2 + 2 + 6×2 + 2... each digit has 2 bars; guards 2 + 2 + 2) and it ends on a bar
    expect(b.widths.length % 2).toBe(1);
    expect(b.widths.filter((_, i) => i % 2 === 0)).toHaveLength(30);
  });

  it('adds the check digit to 12 digits', () => {
    expect(encodeEan13('400638133393').text).toBe('4006381333931');
    expect(() => encodeEan13('4006381333932')).toThrow();
  });
});

describe('Code 128', () => {
  it('uses set B for text with the right check symbol', () => {
    // START B, "A" 33, "B" 34, "C" 35, check (104 + 33 + 68 + 105) % 103 = 1, STOP
    expect(code128Values('ABC')).toEqual([104, 33, 34, 35, 1, 106]);
  });

  it('packs an even run of digits in set C', () => {
    // START C, 12, 34, check (105 + 12 + 68) % 103 = 82, STOP
    expect(code128Values('1234')).toEqual([105, 12, 34, 82, 106]);
  });

  it('switches to C for a long number inside text', () => {
    const v = code128Values('P-12345678');
    expect(v[0]).toBe(104);
    expect(v).toContain(99);
    expect(v.at(-1)).toBe(106);
  });

  it('every symbol is 11 modules and the stop 13', () => {
    const b = encodeCode128('P-1');
    // start + 3 characters + check = 5 × 11, stop 13
    expect(b.modules).toBe(5 * 11 + 13);
  });

  it('refuses what a scanner can’t read back', () => {
    expect(() => encodeCode128('فلتر')).toThrow();
    expect(() => encodeCode128('')).toThrow();
  });
});

describe('the label barcode', () => {
  it('prefers EAN-13 and falls back to Code 128', () => {
    expect(barcodeFor('4006381333931')?.kind).toBe('ean13');
    expect(barcodeFor('P-1')?.kind).toBe('code128');
    expect(barcodeFor('  ')).toBeNull();
    expect(barcodeFor('زيت')).toBeNull();
  });

  it('draws one rectangle per bar', () => {
    expect(barsPath([1, 2, 3], 10)).toBe('M0 0h1v10h-1ZM3 0h3v10h-3Z');
  });
});

