import { describe, expect, it } from 'vitest';
import { formatAmount, formatQty, hasLeadingSign, ltrIsolate, LTR_ISOLATE_END, LTR_ISOLATE_START, stripBidiIsolates } from './index.ts';

const LRI = '\u2066';
const PDI = '\u2069';

describe('signed numbers in Arabic and Kurdish text', () => {
  it('wraps a number in a left-to-right isolate so the minus stays on the left', () => {
    expect(LTR_ISOLATE_START).toBe(LRI);
    expect(LTR_ISOLATE_END).toBe(PDI);
    expect(ltrIsolate('-2')).toBe(`${LRI}-2${PDI}`);
    expect(ltrIsolate(formatAmount(-250000, 'IQD', 'eastern'))).toBe(`${LRI}-٢٥٠٬٠٠٠${PDI}`);
  });

  it('does not wrap twice', () => {
    expect(ltrIsolate(ltrIsolate('-2'))).toBe(`${LRI}-2${PDI}`);
  });

  it('strips the marks again for text that leaves the screen', () => {
    expect(stripBidiIsolates(`${LRI}-1,250${PDI} د.ع`)).toBe('-1,250 د.ع');
    expect(stripBidiIsolates('1,250')).toBe('1,250');
  });

  it('tells a signed number from an unsigned one', () => {
    expect(hasLeadingSign(formatQty(-2000))).toBe(true);
    expect(hasLeadingSign('−3')).toBe(true);
    expect(hasLeadingSign('+3')).toBe(true);
    expect(hasLeadingSign(formatQty(2000))).toBe(false);
    expect(hasLeadingSign(formatAmount(0, 'IQD'))).toBe(false);
  });

  it('leaves the core formatters plain, for Excel and parsing', () => {
    expect(formatAmount(-2000, 'IQD')).toBe('-2,000');
    expect(formatQty(-2500)).toBe('-2.5');
  });
});
