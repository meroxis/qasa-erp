import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { makeI18n } from '../i18n.ts';
import { baseQty, factorOf, inUnits, salePriceFor, typedQty, unitChoices } from './units.ts';

const en = makeI18n('en', 'western', () => {}, () => {});
const med = {
  unit: 'tablet' as const,
  units: [{ unit: 'strip' as const, factorMilli: 10_000, barcode: '101', salePrice: 2_300 }, { unit: 'box' as const, factorMilli: 100_000, barcode: '', salePrice: null }]
};

it('offers the base unit first, then the item\'s other units, with their factors', () => {
  expect(unitChoices(med).map((c) => [c.unit, c.code, c.factorMilli])).toEqual([[null, 'tablet', 1000], ['strip', 'strip', 10_000], ['box', 'box', 100_000]]);
  expect(unitChoices(undefined)).toEqual([]);
  expect(factorOf(med, 'box')).toBe(100_000);
  expect(factorOf(med, null)).toBe(1000);
});

it('turns a typed quantity into the base quantity and back, refusing fractions', () => {
  expect(baseQty(med, 'strip', 3_500)).toBe(35_000);
  expect(baseQty(med, null, 2_000)).toBe(2_000);
  expect(typedQty(med, 'box', 50_000)).toBe(500);
  expect(baseQty({ units: [{ unit: 'g', factorMilli: 1, barcode: '', salePrice: null }] }, 'g', 1)).toBeNull();
});

it('prices a unit by its own price, by base × factor, or by the price list × factor', () => {
  expect(salePriceFor(med, 'strip', 250, { own: 2_300 })).toBe(2_300);
  expect(salePriceFor(med, 'box', 250)).toBe(25_000);
  expect(salePriceFor(med, 'strip', 200, { own: 2_300, fromList: true })).toBe(2_000);
  expect(salePriceFor(med, null, 250)).toBe(250);
});

it('tells stock in the item\'s units on the item card', () => {
  expect(inUnits(en, med, 342_000)).toBe('3 box 4 strip 2 tablet');
});

it('sends a line in another unit as the unit and the quantity typed, never a factor', () => {
  const invoices = readFileSync(new URL('../pages/Invoices.tsx', import.meta.url), 'utf8');
  expect(invoices).toContain('unit: r.unit, unitQtyMilli: r.qtyMilli ?? 0');
  expect(invoices).not.toMatch(/unitFactorMilli:\s*factor/);
  // the POS sends its cart lines through posSaleLine (pos-logic.ts)
  const pos = readFileSync(new URL('../pages/pos-logic.ts', import.meta.url), 'utf8');
  expect(pos).toContain('{ itemId: l.item.id, unit: l.unit, unitQtyMilli: l.qtyMilli, unitPrice: l.unitPrice, ...batch }');
  expect(pos).not.toMatch(/unitFactorMilli/);
});
