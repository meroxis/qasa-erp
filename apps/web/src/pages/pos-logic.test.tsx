import { expect, it } from 'vitest';
import { addRefusal, canPrice, parseScan, priceIn, priceRateFor, tilePrice } from './pos-logic.ts';

const dollarItem = { saleCurrency: 'USD' as const, salePrice: 50000 }; // $500.00
const dinarItem = { saleCurrency: 'IQD' as const, salePrice: 710000 };

it('prices a dollar item in a dinar sale at the default rate, not at 1/100 or 1/1420 of its value', () => {
  const rate = priceRateFor('IQD', 100, 142000);
  expect(rate).toBe(142000);
  expect(priceIn(dollarItem, 'IQD', rate)).toBe(710000);
  // a dollar sale uses the rate typed on the register
  expect(priceIn(dinarItem, 'USD', priceRateFor('USD', 142000, 150000))).toBe(50000);
  expect(priceIn(dinarItem, 'IQD', rate)).toBe(710000);
});

it('refuses a foreign-priced item when no rate is known, instead of selling it for 0', () => {
  const rate = priceRateFor('IQD', 100, undefined);
  expect(canPrice(dollarItem, 'IQD', rate)).toBe(false);
  expect(canPrice(dinarItem, 'IQD', rate)).toBe(true);
});

it('reads an exact code that looks like "12x5" as a code, and "3*code" as a quantity', () => {
  const items = [{ code: '12x5', barcode: '' }, { code: '5', barcode: '' }, { code: 'A1', barcode: '628100' }];
  expect(parseScan('12x5', items)).toEqual({ code: '12x5', qtyMilli: 1000, exact: items[0] });
  expect(parseScan('3*a1', items)).toEqual({ code: 'a1', qtyMilli: 3000, exact: items[2] });
  expect(parseScan('2 x 628100', items)).toEqual({ code: '628100', qtyMilli: 2000, exact: items[2] });
  expect(parseScan('nothing', items).exact).toBeUndefined();
});

it('says there is no rate (not "no item with this code") and shows no price, when an item cannot be priced', () => {
  expect(addRefusal(dollarItem, 'IQD', 0)).toBe('pos_noRate');
  expect(tilePrice(dollarItem, 'IQD', 0)).toBeNull();
  expect(addRefusal(dinarItem, 'IQD', 0)).toBeNull();
  expect(tilePrice(dinarItem, 'IQD', 0)).toBe(710000);
  expect(tilePrice(dollarItem, 'IQD', 142000)).toBe(710000);
});
