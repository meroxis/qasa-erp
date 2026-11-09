import { describe, expect, it } from 'vitest';
import { makeI18n } from './i18n.ts';
import { csvCell } from './components.tsx';

const LRI = '\u2066';
const PDI = '\u2069';
const noop = () => {};
const ar = makeI18n('ar', 'western', noop, noop);
const ku = makeI18n('ku', 'western', noop, noop);
const en = makeI18n('en', 'western', noop, noop);
const arEastern = makeI18n('ar', 'eastern', noop, noop);

// Without an isolate, Arabic and Kurdish screens show -2 as "2-": the bidi algorithm moves the minus to the right.
describe('negative numbers in Arabic and Kurdish', () => {
  it('keeps the minus with the digits in amounts, the dinar abbreviation where it was', () => {
    expect(ar.money(-2000, 'IQD')).toBe(`${LRI}-2,000${PDI} د.ع`);
    expect(ku.money(-2000, 'IQD')).toBe(`${LRI}-2,000${PDI} د.ع`);
    expect(arEastern.money(-2000, 'IQD')).toBe(`${LRI}-٢٬٠٠٠${PDI} د.ع`);
    expect(ar.money(-250, 'USD')).toBe(`${LRI}$-2.50${PDI}`);
  });

  it('leaves positive amounts and English as they were', () => {
    expect(ar.money(2000, 'IQD')).toBe('2,000 د.ع');
    expect(ar.money(250, 'USD')).toBe('$2.50');
    expect(en.money(-2000, 'IQD')).toBe('-2,000 IQD');
    expect(en.money(-250, 'USD')).toBe('$-2.50');
  });

  it('shows a stock count difference as -2 and +3', () => {
    expect(ar.qty(-2000, { plus: true })).toBe(`${LRI}-2${PDI}`);
    expect(ku.qty(3000, { plus: true })).toBe(`${LRI}+3${PDI}`);
    expect(ku.qty(0, { plus: true })).toBe('0');
    expect(arEastern.qty(-2500)).toBe(`${LRI}-٢٫٥${PDI}`);
    expect(en.qty(-2000, { plus: true })).toBe('-2');
    expect(en.qty(3000, { plus: true })).toBe('+3');
  });

  it('isolates signed whole numbers and signed amounts', () => {
    expect(ar.int(-5)).toBe(`${LRI}-5${PDI}`);
    expect(ar.int(5)).toBe('5');
    expect(ku.money(1500, 'IQD', { plus: true })).toBe(`${LRI}+1,500${PDI} د.ع`);
    expect(ar.ltr('-12%')).toBe(`${LRI}-12%${PDI}`);
    expect(en.ltr('-12%')).toBe('-12%');
  });

  it('keeps the marks out of Excel files, so negative amounts stay numbers', () => {
    expect(csvCell(ar.qty(-2000))).toBe('-2');
    expect(csvCell(ar.int(-1250))).toBe('"-1,250"');
  });
});
