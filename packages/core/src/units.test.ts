import { describe, expect, it } from 'vitest';
import {
  formatInUnits, fromBaseQty, invoiceTotals, isUnit, priceListUnitPrice, splitInUnits, toBaseQty, UNIT_CODES, UNITS, unitPrice, validateInvoice,
  validateItemUnits, type InvoiceInput
} from './index.ts';

// a medicine kept in tablets: a strip is 10 tablets, a box 10 strips
const TABLET_UNITS = [{ unit: 'strip' as const, factorMilli: 10_000 }, { unit: 'box' as const, factorMilli: 100_000 }];

describe('units with conversions', () => {
  it('has the new units in Arabic, English and Kurdish, one list for the API', () => {
    for (const code of ['ton', 'g', 'bag', 'm2', 'dozen', 'pack', 'strip', 'tablet', 'capsule', 'bottle', 'tube', 'ampoule', 'vial', 'sachet', 'roll', 'pair']) {
      expect(isUnit(code)).toBe(true);
      const names = UNITS[code as keyof typeof UNITS];
      expect(names.ar && names.en && names.ku).toBeTruthy();
    }
    expect(UNIT_CODES).toHaveLength(24);
    expect(isUnit('toString')).toBe(false);
  });

  it('turns boxes, strips and tablets into tablets and back', () => {
    expect(toBaseQty(2000, 100_000)).toBe(200_000); // 2 boxes = 200 tablets
    expect(toBaseQty(3000, 10_000)).toBe(30_000); // 3 strips = 30 tablets
    expect(fromBaseQty(200_000, 100_000)).toBe(2000);
    expect(fromBaseQty(10_000, 10_000)).toBe(1000);
    expect(fromBaseQty(5_000, 10_000)).toBe(500); // half a strip
  });

  it('takes a gram of an item kept in kilograms (factor 1)', () => {
    expect(toBaseQty(250_000, 1)).toBe(250); // 250 g = 0.25 kg
    expect(toBaseQty(1000, 1)).toBe(1); // 1 g = 0.001 kg
  });

  it('refuses a quantity that is no whole number of thousandths of the base unit', () => {
    expect(toBaseQty(1, 1)).toBeNull(); // 0.001 g of a kg item
    expect(toBaseQty(333, 3_000)).toBe(999);
    expect(toBaseQty(1, 333)).toBeNull();
    expect(toBaseQty(Number.MAX_SAFE_INTEGER, 1_000_000_000)).toBeNull();
    expect(toBaseQty(1000, 0)).toBeNull();
    expect(fromBaseQty(1, 3_000)).toBeNull();
  });

  it('prices a unit by its own price, or the base price times the factor, rounded half up', () => {
    expect(unitPrice({ price: 250 }, { factorMilli: 10_000 })).toBe(2_500);
    expect(unitPrice({ price: 250 }, { factorMilli: 10_000, salePrice: 2_300 })).toBe(2_300);
    expect(unitPrice({ price: 333 }, { factorMilli: 1_500 })).toBe(500); // 499.5 → 500
    expect(unitPrice({ price: 100 }, { factorMilli: 10_000, salePrice: null })).toBe(1_000);
  });

  it('applies a customer price list (per base unit) to another unit', () => {
    expect(priceListUnitPrice(240, 100_000)).toBe(24_000);
    expect(priceListUnitPrice(5, 1_500)).toBe(8); // 7.5 → 8
  });

  it('checks the units of an item', () => {
    const base = { unit: 'tablet', barcode: '111' };
    expect(validateItemUnits(base, TABLET_UNITS)).toEqual([]);
    expect(validateItemUnits(base, [{ unit: 'tablet', factorMilli: 1000 }])).toEqual([{ code: 'unit_is_base', unit: 'tablet' }]);
    expect(validateItemUnits(base, [{ unit: 'box', factorMilli: 1000 }, { unit: 'box', factorMilli: 2000 }])).toEqual([{ code: 'unit_repeated', unit: 'box' }]);
    expect(validateItemUnits(base, [{ unit: 'box', factorMilli: 0 }])).toEqual([{ code: 'unit_factor_invalid', unit: 'box' }]);
    expect(validateItemUnits(base, [{ unit: 'box', factorMilli: 1_000_000_001 }])).toEqual([{ code: 'unit_factor_invalid', unit: 'box' }]);
    expect(validateItemUnits(base, [{ unit: 'nope' as never, factorMilli: 1000 }])).toEqual([{ code: 'unit_invalid', unit: 'nope' }]);
    expect(validateItemUnits(base, [{ unit: 'service', factorMilli: 1000 }])).toEqual([{ code: 'unit_invalid', unit: 'service' }]);
    expect(validateItemUnits(base, [{ unit: 'box', factorMilli: 1000, barcode: '111' }])).toEqual([{ code: 'unit_barcode_repeated', unit: 'box' }]);
    expect(validateItemUnits(base, [{ unit: 'box', factorMilli: 1000, barcode: '9' }, { unit: 'strip', factorMilli: 10, barcode: '9' }]))
      .toEqual([{ code: 'unit_barcode_repeated', unit: 'strip' }]);
    expect(validateItemUnits(base, [{ unit: 'box', factorMilli: 1000, salePrice: -1 }])).toEqual([{ code: 'unit_price_invalid', unit: 'box' }]);
    const eleven = UNIT_CODES.filter((u) => u !== 'tablet' && u !== 'service').slice(0, 11).map((unit) => ({ unit, factorMilli: 1000 }));
    expect(validateItemUnits(base, eleven)).toContainEqual({ code: 'units_too_many' });
    expect(validateItemUnits({ ...base, saleUnit: 'box', purchaseUnit: 'tablet' }, TABLET_UNITS)).toEqual([]);
    expect(validateItemUnits({ ...base, saleUnit: 'carton', purchaseUnit: 'pair' }, TABLET_UNITS)).toEqual([{ code: 'sale_unit_invalid' }, { code: 'purchase_unit_invalid' }]);
  });

  it('tells a quantity in the largest units first, for the item card', () => {
    expect(splitInUnits(342_000, 'tablet', TABLET_UNITS)).toEqual([
      { unit: 'box', qtyMilli: 3000 }, { unit: 'strip', qtyMilli: 4000 }, { unit: 'tablet', qtyMilli: 2000 }
    ]);
    expect(splitInUnits(0, 'tablet', TABLET_UNITS)).toEqual([{ unit: 'tablet', qtyMilli: 0 }]);
    expect(splitInUnits(-12_000, 'tablet', TABLET_UNITS)).toEqual([{ unit: 'strip', qtyMilli: -1000 }, { unit: 'tablet', qtyMilli: -2000 }]);
    expect(splitInUnits(2_500, 'kg', [{ unit: 'g', factorMilli: 1 }])).toEqual([{ unit: 'kg', qtyMilli: 2_500 }]);
    expect(formatInUnits(342_000, 'tablet', TABLET_UNITS, 'en')).toBe('3 box 4 strip 2 tablet');
    expect(formatInUnits(100_000, 'tablet', TABLET_UNITS, 'ar')).toBe('1 علبة');
  });

  it('totals mixed lines: a line in a unit is priced by the quantity typed in it', () => {
    const lines = [
      { qtyMilli: 35_000, unitPrice: 2_500, unit: 'strip' as const, unitQtyMilli: 3_500, unitFactorMilli: 10_000 }, // 3.5 strips
      { qtyMilli: 5_000, unitPrice: 250 } // 5 tablets
    ];
    expect(invoiceTotals(lines, 100)).toEqual({ lineAmounts: [8_750, 1_250], subtotal: 10_000, discount: 100, total: 9_900 });
    const input: InvoiceInput = {
      kind: 'sale', date: '2026-11-09', warehouseId: 'w', currency: 'IQD', rateX100: 100, payment: 'cash', cashAccountCode: '181', discount: 0,
      lines: lines.map((l) => ({ itemId: 'x', ...l }))
    };
    expect(validateInvoice(input)).toEqual([]);
    expect(validateInvoice({ ...input, lines: [{ itemId: 'x', qtyMilli: 30_000, unitPrice: 1, unit: 'strip', unitQtyMilli: 3_500, unitFactorMilli: 10_000 }] }))
      .toEqual([{ code: 'unit_qty_fraction', line: 1 }]);
    expect(validateInvoice({ ...input, lines: [{ itemId: 'x', qtyMilli: 0, unitPrice: 1, unit: 'strip', unitQtyMilli: 0, unitFactorMilli: 10_000 }] }))
      .toContainEqual({ code: 'line_qty_invalid', line: 1 });
  });
});
