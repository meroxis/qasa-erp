import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { addRefusal, canPrice, cashChange, cashTender, creditPartyNote, parseScan, priceIn, priceRateFor, salePayments, tilePrice } from './pos-logic.ts';

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
  expect(parseScan('12x5', items)).toEqual({ code: '12x5', qtyMilli: 1000, exact: items[0], unit: null });
  expect(parseScan('3*a1', items)).toEqual({ code: 'a1', qtyMilli: 3000, exact: items[2], unit: null });
  expect(parseScan('2 x 628100', items)).toEqual({ code: '628100', qtyMilli: 2000, exact: items[2], unit: null });
  expect(parseScan('nothing', items).exact).toBeUndefined();
});

it('says there is no rate (not "no item with this code") and shows no price, when an item cannot be priced', () => {
  expect(addRefusal(dollarItem, 'IQD', 0)).toBe('pos_noRate');
  expect(tilePrice(dollarItem, 'IQD', 0)).toBeNull();
  expect(addRefusal(dinarItem, 'IQD', 0)).toBeNull();
  expect(tilePrice(dinarItem, 'IQD', 0)).toBe(710000);
  expect(tilePrice(dollarItem, 'IQD', 142000)).toBe(710000);
});

it('prints what was paid and the change on the receipt only when more cash was handed over than the sale', () => {
  // sale 12,500, the customer hands over 15,000
  expect(cashTender(15_000, cashChange(15_000, 12_500, []))).toEqual({ paid: 15_000, change: 2_500 });
  // the exact money, or nothing typed: the total says it all
  expect(cashTender(12_500, cashChange(12_500, 12_500, []))).toBeNull();
  expect(cashTender(null, cashChange(null, 12_500, []))).toBeNull();
  // on credit there is no change
  expect(cashTender(15_000, cashChange(15_000, 12_500, salePayments('account', 12_500) ?? []))).toBeNull();
});

it('says credit needs a customer or a supplier only once it was asked for, each in its own words', () => {
  // a new purchase invoice opens on credit with no supplier yet: nothing is said until the box was left or a save tried
  expect(creditPartyNote('purchase', 'credit', '', false)).toBeNull();
  expect(creditPartyNote('purchase', 'credit', '', true)).toBe('s14_creditNeedsSupplier');
  expect(creditPartyNote('sale', 'credit', '', true)).toBe('s14_creditNeedsCustomer');
  expect(creditPartyNote('sale', 'credit', 'p-raz', true)).toBeNull();
  expect(creditPartyNote('sale', 'cash', '', true)).toBeNull();
});

it('shows a tile\'s picture the way the Items screen does: no address that answers JSON, and nothing asked for an item without a picture', () => {
  const till = readFileSync(new URL('./Pos.tsx', import.meta.url), 'utf8');
  // GET /api/items/:id/image answers JSON (the picture as base64), so it is never an <img> address
  expect(till).not.toMatch(/src=\{`\/api\/items\//);
  expect(till).toContain('useItemPicture(item.id)');
  const pictures = readFileSync(new URL('../industry/ItemImage.tsx', import.meta.url), 'utf8');
  // one request says which items have a picture; a picture is asked for only then, once in view, and kept
  expect(pictures).toContain('if (!version || !visible) { setUrl(null); return; }');
  expect(pictures).toContain('cache.set(key, p)');
  // the receipt keeps "date time" in that order inside right-to-left text
  expect(till).toMatch(/<span className="num ltr">\{i18n\.date\(invoice\.date\)\} /);
  // on credit the customer box says to choose one, not "walk-in customer"
  expect(till).toContain("placeholder={onCredit ? t('chooseCustomer') : t('pos_walkIn')}");
});
