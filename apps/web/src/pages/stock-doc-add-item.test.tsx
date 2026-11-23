import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openingLineOf } from './StockDocs.tsx';
import { ITEM_QUICK_TEXT as D } from '../i18n/item-quick.ts';

describe('opening stock: an item made in the item box', () => {
  const made = { id: 'it1', purchaseUnit: null, purchasePrice: 2500, purchaseCurrency: 'IQD' as const };

  it('goes on the line with its purchase price as the cost of one', () => {
    expect(openingLineOf(made, null, null)).toEqual({ itemId: 'it1', unit: null, unitCost: 2500 });
  });

  it('keeps a cost that was already typed', () => {
    expect(openingLineOf(made, null, 3000).unitCost).toBe(3000);
  });

  it('leaves a dollar price to type: the cost box is in dinars', () => {
    expect(openingLineOf({ ...made, purchaseCurrency: 'USD', purchasePrice: 175 }, null, null).unitCost).toBeNull();
    expect(openingLineOf({ ...made, purchasePrice: null }, null, null).unitCost).toBeNull();
  });

  it('takes the weight of a scanned scale label, in the base unit', () => {
    expect(openingLineOf({ ...made, purchaseUnit: 'carton' as never }, 1250, null)).toEqual({ itemId: 'it1', unit: null, unitCost: 2500, qtyMilli: 1250 });
  });

  it('uses the item box with "+" for an opening stock only, and never hands the form a warehouse (the document enters the stock, not the form)', () => {
    const source = readFileSync(new URL('./StockDocs.tsx', import.meta.url), 'utf8');
    const picker = source.slice(source.indexOf('<ItemPicker'), source.indexOf('/>', source.indexOf('<ItemPicker')));
    expect(source).toMatch(/kind === 'opening'[\s\S]{0,400}<ItemPicker/);
    expect(picker).toContain('stockOnly');
    expect(picker).not.toContain('warehouseId');
    expect(picker).not.toContain('sale');
  });

  it('tells a company with no items how to start, in each language', () => {
    for (const key of ['sd_firstOpening', 'sd_firstOpeningImport'] as const) {
      const text = D[key];
      expect(text).toHaveLength(3);
      for (const one of text) expect(one.length).toBeGreaterThan(10);
    }
    expect(D.sd_firstOpening[1]).toContain('+');
  });
});
