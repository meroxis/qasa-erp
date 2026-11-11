import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { makeI18n } from '../i18n.ts';
import { labelFace } from './Labels.tsx';
import { cashChange, changeLineUnit, parseScan, tileOffer } from './pos-logic.ts';
import { draftInValue, stockAfter } from './StockAdjustments.tsx';
import { trackingInput } from './Items.tsx';
import { recordableLines } from './Pharmacy.tsx';
import { returnQtyBase } from './Invoices.tsx';
import { poQtyText } from './PurchaseOrders.tsx';
import { inUnits } from '../industry/units.ts';
import type { ItemView } from '../api.ts';

// Units, the POS and the 1.1 texts on the screens: each case is a mistake the screens once made.
const en = makeI18n('en', 'western', () => {}, () => {});
const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** A medicine kept in tablets: a strip of 10 at 2,300, a box of 100 with no price or barcode of its own. */
const med = {
  id: 'i1', code: 'M1', barcode: '6260000000101', salePrice: 250, saleCurrency: 'IQD', unit: 'tablet', saleUnit: 'strip',
  units: [{ unit: 'strip', factorMilli: 10_000, barcode: '6260000000102', salePrice: 2_300 }, { unit: 'box', factorMilli: 100_000, barcode: '', salePrice: null }]
} as unknown as ItemView;

it('no text key is defined twice: the Phones card keeps its own title and notice, a real-estate sale its own payment error', () => {
  const dir = new URL('../i18n/', import.meta.url);
  const files = [new URL('../i18n.ts', import.meta.url), ...readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => new URL(f, dir))];
  const seen = new Map<string, number>();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/^ {2}([A-Za-z_]\w*): \[/gm)) seen.set(m[1]!, (seen.get(m[1]!) ?? 0) + 1);
  expect([...seen].filter(([, n]) => n > 1).map(([k]) => k)).toEqual([]);
  expect(en.t('ph_title')).toBe('Phones (Qasa app)');
  expect(en.t('ph_needsPro')).toBe('The phone app is part of Starter, Pro and Business.');
  expect(en.t('phm_title')).toBe('Pharmacy');
  expect(en.t('err_payment_invalid')).toBe('Choose how it is paid.');
  expect(en.t('err_pos_payment_invalid')).toBe('A payment isn’t valid.');
});

it('a label for a unit without a barcode of its own carries none (never the base unit’s), and a unit barcode scans as that unit', () => {
  expect(labelFace(med, 'box')).toEqual({ barcode: '', price: 25_000 });
  const strip = labelFace(med, 'strip');
  expect(strip).toEqual({ barcode: '6260000000102', price: 2_300 });
  expect(parseScan(strip.barcode, [med]).unit).toBe('strip');
  expect(labelFace(med, null)).toEqual({ barcode: '6260000000101', price: 250 });
});

it('POS split payment: the cash handed over is compared with the cash part only', () => {
  // 25,000 paid FIB 15,000 + cash 10,000; 10,000 handed over: no change, nothing short
  expect(cashChange(10_000, 25_000, [{ method: 'fib', amount: 15_000 }, { method: 'cash', amount: 10_000 }])).toBe(0);
  expect(cashChange(20_000, 25_000, [{ method: 'fib', amount: 15_000 }, { method: 'cash', amount: 10_000 }])).toBe(10_000);
  // no cash part: nothing to give back
  expect(cashChange(5_000, 25_000, [{ method: 'fib', amount: 25_000 }])).toBeNull();
  // all cash, as before
  expect(cashChange(30_000, 25_000, [])).toBe(5_000);
  expect(cashChange(null, 25_000, [])).toBeNull();
});

it('POS: a tile shows the price of the unit a tap adds (the sale unit)', () => {
  expect(tileOffer(med, 'IQD', 142_000)).toEqual({ unit: 'strip', price: 2_300 });
  expect(tileOffer({ ...med, saleUnit: 'box' }, 'IQD', 142_000)).toEqual({ unit: 'box', price: 25_000 });
  expect(tileOffer({ ...med, saleUnit: null }, 'IQD', 142_000)).toEqual({ unit: null, price: 250 });
  expect(tileOffer({ ...med, saleCurrency: 'USD' }, 'IQD', 0).price).toBeNull();
  expect(src('./Pos.tsx')).toContain('tileOffer(it, currency, priceRate)');
});

it('POS: the unit chip merges a line into the line already in that unit, never two lines with the same item and unit', () => {
  const line = (unit: 'box' | 'strip' | null, qtyMilli: number) => ({ item: { id: 'i1' }, unit, qtyMilli, unitPrice: 0 });
  const cart = [line('box', 1_000), line(null, 2_000), { ...line(null, 1_000), item: { id: 'i2' } }];
  const merged = changeLineUnit(cart, 1, 'box', 25_000);
  expect(merged.map((l) => [l.item.id, l.unit, l.qtyMilli])).toEqual([['i1', 'box', 3_000], ['i2', null, 1_000]]);
  const moved = changeLineUnit(cart, 1, 'strip', 2_300);
  expect(moved.map((l) => [l.item.id, l.unit, l.qtyMilli, l.unitPrice])).toEqual([['i1', 'box', 1_000, 0], ['i1', 'strip', 2_000, 2_300], ['i2', null, 1_000, 0]]);
});

it('a stock adjustment line in boxes: its draft value is at the price per box, and on-hand checks are in tablets', () => {
  // 2 boxes (10 each) at 5,000 per box: 10,000, as posting values it
  expect(draftInValue({ qtyMilli: 20_000, unitCost: 5_000, lineUnit: 'box', unitQtyMilli: 2_000 })).toBe(10_000);
  expect(draftInValue({ qtyMilli: 3_000, unitCost: 500, lineUnit: null, unitQtyMilli: null })).toBe(1_500);
  expect(draftInValue({ qtyMilli: -3_000, unitCost: 500, lineUnit: null, unitQtyMilli: null })).toBeNull();
  // removing 2 boxes of 100 with 150 tablets on hand: short, and −50 after
  const item = { qtyMilli: 150_000, units: [{ unit: 'box', factorMilli: 100_000 }] } as unknown as ItemView;
  expect(stockAfter(item, { dir: 'out', qtyMilli: 2_000, unit: 'box' })).toEqual({ short: true, after: -50_000 });
  expect(stockAfter(item, { dir: 'out', qtyMilli: 1_000, unit: 'box' })).toEqual({ short: false, after: 50_000 });
  expect(stockAfter(item, { dir: 'in', qtyMilli: 3_000, unit: null })).toEqual({ short: false, after: 153_000 });
});

it('a new item shows and sends the company’s expiry setting; an unticked box is sent as it is', () => {
  expect(src('./Items.tsx')).not.toContain('useState(item?.trackExpiry ?? false)');
  // the setting is known (a pharmacy: on, the boxes ticked): what is shown is sent, ticked or unticked
  expect(trackingInput(false, true, true, true)).toEqual({ trackBatches: true, trackExpiry: true });
  expect(trackingInput(false, true, false, false)).toEqual({ trackBatches: false, trackExpiry: false });
  // not known yet: an untouched new item follows the setting on the server
  expect(trackingInput(false, false, false, false)).toEqual({});
  expect(trackingInput(true, false, false, true)).toEqual({ trackBatches: true, trackExpiry: true });
});

it('the controlled-medicine dialog saves only lines with a patient, and has nothing to save without one', () => {
  expect(recordableLines([{ patient: '' }, { patient: '  ' }])).toEqual([]);
  expect(recordableLines([{ patient: 'Mer' }, { patient: '' }, { patient: 'Las' }])).toEqual([0, 2]);
  expect(src('./Pharmacy.tsx')).toContain('disabled={ready.length === 0}');
});

it('the items list shows "no results" for a category with no items, not "add your first item"', () => {
  expect(src('./Items.tsx')).toContain('(q.trim() || warehouseId || categoryId');
});

it('a return of a line sold in boxes can be typed in tablets: one tablet of a box of 30 goes back as one tablet', () => {
  const line = { lineUnit: 'box' as const, unitFactorMilli: 30_000 };
  expect(returnQtyBase(line, 1_000, true)).toBe(1_000);
  expect(returnQtyBase(line, 1_000, false)).toBe(30_000);
  expect(returnQtyBase({ lineUnit: null, unitFactorMilli: null }, 2_000, false)).toBe(2_000);
});

it('a purchase order shows received and remaining in the unit ordered, else in the base unit with its name', () => {
  const l = { unit: 'tablet', lineUnit: 'box' as const, unitFactorMilli: 30_000 };
  expect(poQtyText(en, l, 60_000)).toBe('2 box');
  expect(poQtyText(en, l, 1_000)).toBe('1 tablet');
  expect(poQtyText(en, { unit: 'tablet', lineUnit: null, unitFactorMilli: null }, 3_000)).toBe('3 tablet');
});

it('the count sheet shows the stock in the item’s units too', () => {
  expect(inUnits(en, { unit: 'tablet', units: [{ unit: 'strip', factorMilli: 10_000 }, { unit: 'box', factorMilli: 100_000 }] }, 345_000)).toBe('3 box 4 strip 5 tablet');
  expect(src('./StockAdjustments.tsx')).toContain('inUnits(i18n, { unit: r.unit, units: r.units ?? [] }, book)');
});
