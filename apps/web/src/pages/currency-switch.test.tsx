import { expect, it } from 'vitest';
import { convertAmount, convertLines } from './currency-switch.ts';

it('converts prices when a quote or order changes currency, so 5,000 IQD does not become $50.00', () => {
  expect(convertAmount(5_000, 'IQD', 'USD', 142_000)).toBe(352); // $3.52
  expect(convertAmount(352, 'USD', 'IQD', 142_000)).toBe(4_998);
  expect(convertAmount(5_000, 'IQD', 'IQD', 142_000)).toBe(5_000);
  expect(convertLines([{ unitPrice: 710_000, qtyMilli: 1000 }], 'IQD', 'USD', 142_000)).toEqual([{ unitPrice: 50_000, qtyMilli: 1000 }]);
  expect(convertLines([{ unitPrice: 710_000 }], 'IQD', 'USD', undefined)).toBeNull();
});
