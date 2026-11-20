import { describe, expect, it } from 'vitest';
import { cleanScalePrefixes, parseScaleLabel, qtyForLabelPrice } from './scale-label.ts';

/** A label with a right check digit. */
function label(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return first12 + String((10 - (sum % 10)) % 10);
}

describe('scale labels that carry the price', () => {
  it('reads a weight unless the prefix is set as a price prefix', () => {
    const code = label('220001727500');
    expect(parseScaleLabel(code)).toEqual({ prefix: '2200017', grams: 27500 });
    expect(parseScaleLabel(code, ['22'])).toEqual({ prefix: '2200017', price: 27500 });
    expect(parseScaleLabel(label('210001701250'), ['22'])).toEqual({ prefix: '2100017', grams: 1250 });
  });
  it('refuses a wrong check digit or a zero', () => {
    expect(parseScaleLabel('2200017275001', ['22'])).toBeNull();
    expect(parseScaleLabel(label('220001700000'), ['22'])).toBeNull();
  });
  it('turns a price into a quantity at the price per kg', () => {
    expect(qtyForLabelPrice(27500, 18000)).toBe(1528);
    expect(qtyForLabelPrice(9000, 18000)).toBe(500);
    expect(qtyForLabelPrice(100, 0)).toBeNull();
  });
  it('keeps clean prefixes only', () => {
    expect(cleanScalePrefixes(['22', '22', '2x', '31', 5, '29'])).toEqual(['22', '29']);
  });
});
