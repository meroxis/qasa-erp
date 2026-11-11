import { describe, expect, it } from 'vitest';
import type { ItemView } from '../api.ts';
import { posSaleLine } from '../pages/pos-logic.ts';
import {
  baseQtyOf, forgetTill, offlineMethods, offlineReceipt, offlineRefusal, rememberTill, shortStock, takeFromStock, tillCache
} from './offline-till.ts';

const item = (over: Partial<ItemView> = {}): ItemView => ({
  id: 'tea', code: 'TEA', barcode: '6260000000017', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 2_500, saleCurrency: 'IQD',
  trackStock: true, active: true, qtyMilli: 5_000, value: 0, hasMoves: true, units: [{ unit: 'box', factorMilli: 12_000, barcode: '6260000000024', salePrice: 27_000 }],
  saleUnit: null, purchaseUnit: null, updatedAt: null, trackBatches: false, trackExpiry: false, categoryId: null, brandId: null, reorderMilli: null, ...over
});

describe('the offline till', () => {
  it('sells for cash, by card and by wallet, never on a customer\'s account', () => {
    expect(offlineMethods(['cash', 'card', 'fib', 'account'])).toEqual(['cash', 'card', 'fib']);
    expect(offlineRefusal({ payments: [{ method: 'cash', amount: 1 }, { method: 'card', amount: 2 }] })).toBeNull();
    expect(offlineRefusal({})).toBeNull();
    expect(offlineRefusal({ payments: [{ method: 'cash', amount: 1 }, { method: 'account', amount: 2 }] })).toBe('pos_offline_on_account');
  });

  it('checks a sale against the stock last known (boxes counted in pieces), says what is short, and does not block it', () => {
    const tea = item();
    const cup = item({ id: 'cup', code: 'CUP', trackStock: false, qtyMilli: 0, units: [] });
    expect(baseQtyOf({ item: tea, qtyMilli: 1_000, unit: 'box' })).toBe(12_000);
    expect(baseQtyOf({ item: tea, qtyMilli: 2_000, unit: null })).toBe(2_000);
    expect(shortStock([{ item: tea, qtyMilli: 3_000, unit: null }, { item: cup, qtyMilli: 9_000, unit: null }])).toEqual([]);
    expect(shortStock([{ item: tea, qtyMilli: 3_000, unit: null }, { item: tea, qtyMilli: 3_000, unit: null }]))
      .toEqual([{ itemId: 'tea', code: 'TEA', name: tea.name, wantMilli: 6_000, haveMilli: 5_000 }]);
    expect(shortStock([{ item: tea, qtyMilli: 1_000, unit: 'box' }])).toHaveLength(1);
    // the next sale is checked against what is left
    const left = takeFromStock([tea, cup], [{ item: tea, qtyMilli: 2_000, unit: null }, { item: cup, qtyMilli: 1_000, unit: null }]);
    expect(left.map((i) => i.qtyMilli)).toEqual([3_000, 0]);
    expect(takeFromStock(left, [{ item: left[0]!, qtyMilli: 4_000, unit: null }])[0]!.qtyMilli).toBe(-1_000);
  });

  it('prints a receipt shaped like the invoice the server will make, numbered with the temporary reference', () => {
    const tea = item();
    const lines = [{ item: tea, qtyMilli: 2_000, unit: null, unitPrice: 2_500 }, { item: tea, qtyMilli: 1_000, unit: 'box' as const, unitPrice: 27_000 }];
    const r = offlineReceipt({
      key: 'k', reference: 'OFF-Counter1-0004', soldAt: '2026-11-11T09:30:00.000Z', soldOn: '2026-11-11', shift: { warehouseId: 'w', cashAccountCode: '1811' }, cashier: 'Mer',
      lines, currency: 'IQD', rateX100: 100, discount: 2_000, party: null, payments: [{ method: 'cash', amount: 20_000 }, { method: 'card', amount: 10_000 }]
    });
    expect(r).toMatchObject({ number: 'OFF-Counter1-0004', offlineRef: 'OFF-Counter1-0004', status: 'posted', subtotal: 32_000, total: 30_000, discount: 2_000, date: '2026-11-11', createdBy: 'Mer' });
    expect(r.lines.map((l) => [l.qtyMilli, l.unitQtyMilli, l.lineUnit, l.amount])).toEqual([[2_000, null, null, 5_000], [12_000, 1_000, 'box', 27_000]]);
    expect(r.payments?.map((p) => [p.method, p.amount])).toEqual([['cash', 20_000], ['card', 10_000]]);
    // what the receipt says is what the server gets: the same lines, in the same units
    expect(lines.map(posSaleLine)).toEqual([{ itemId: 'tea', qtyMilli: 2_000, unitPrice: 2_500 }, { itemId: 'tea', unit: 'box', unitQtyMilli: 1_000, unitPrice: 27_000 }]);
    // a dollar sale's base total at its rate
    expect(offlineReceipt({ ...{ key: 'k', reference: 'OFF-C-0001', soldAt: '', soldOn: '', shift: { warehouseId: 'w', cashAccountCode: '1811' }, cashier: 'Las' }, lines: [{ item: tea, qtyMilli: 1_000, unit: null, unitPrice: 200 }], currency: 'USD', rateX100: 142_000, discount: 0, party: null, payments: [] }).baseTotal).toBe(284_000);
  });

  it('keeps what it last had for the person signed in only, in memory', () => {
    forgetTill();
    rememberTill('user:u-mer', { items: [item()] });
    expect(tillCache('user:u-mer')?.items).toHaveLength(1);
    expect(tillCache('user:u-las')).toBeNull();
    expect(tillCache(null)).toBeNull();
    // another person starts afresh
    rememberTill('user:u-las', { methods: ['cash'] });
    expect(tillCache('user:u-las')).toMatchObject({ items: null, methods: ['cash'] });
    expect(tillCache('user:u-mer')).toBeNull();
    forgetTill();
  });
});
