import { describe, expect, it } from 'vitest';
import type { OutboxItem } from '../src/outbox';
import type { OrderDetail } from '../src/staff/api';
import {
  addStockLine, arrivalBody, arrivalProblem, arrivalWaiting, moreThanThere, receivable, scannedQtyMilli, setStockLine, toComeOf, transferBody, transferProblem,
  wholeUnits, type StockLine
} from '../src/staff/stock';

// 1.1: stock moved between warehouses and goods received against an order, from what was scanned

const names = (en: string) => ({ ar: en, en, ku: en });
const charger = { id: 'i-1', code: 'CH1', name: names('Charger'), unit: 'piece', trackStock: true };
const cable = { id: 'i-2', code: 'CB2', name: names('Cable'), unit: 'piece', trackStock: true };

describe('moving stock between warehouses', () => {
  it('adds a scan to its line (the same item again adds up), counts a box\'s barcode as the box, and takes a line off at zero', () => {
    let lines: StockLine[] = [];
    lines = addStockLine(lines, charger, 1000);
    lines = addStockLine(lines, cable, 2000);
    lines = addStockLine(lines, charger, 12_000);
    expect(lines.map((l) => [l.item.id, l.qtyMilli])).toEqual([['i-2', 2000], ['i-1', 13_000]]);
    expect(addStockLine(lines, charger, 0)).toBe(lines);
    expect(setStockLine(lines, 'i-1', 5000).find((l) => l.item.id === 'i-1')!.qtyMilli).toBe(5000);
    expect(setStockLine(lines, 'i-1', 0).map((l) => l.item.id)).toEqual(['i-2']);
    // a scan: the item's own barcode is one; a box's barcode is the box's factor
    const item = { ...charger, barcode: '', salePrice: 1, saleCurrency: 'IQD' as const, qtyMilli: 0, units: [{ unit: 'box', factorMilli: 12_000 }] };
    expect(scannedQtyMilli({ item, unit: null })).toBe(1000);
    expect(scannedQtyMilli({ item, unit: 'box' })).toBe(12_000);
    expect(scannedQtyMilli({ item, unit: 'carton' })).toBe(1000);
    expect(wholeUnits(24_000, 12_000)).toBe(2);
    expect(wholeUnits(18_000, 12_000)).toBeNull();
    expect(wholeUnits(18_000, null)).toBeNull();
  });

  it('builds a transfer of items and quantities only, between two different warehouses, never of a service', () => {
    const lines = addStockLine(addStockLine([], charger, 4000), cable, 1000);
    const body = transferBody({ date: '2026-11-15', from: 'w-1', to: 'w-2', notes: 'From the Qasa phone app', lines });
    expect(body).toEqual({
      kind: 'transfer', date: '2026-11-15', warehouseId: 'w-1', toWarehouseId: 'w-2', notes: 'From the Qasa phone app',
      lines: [{ itemId: 'i-2', qtyMilli: 1000 }, { itemId: 'i-1', qtyMilli: 4000 }]
    });
    // the keys the office's phone link allows (no account, cost or batch)
    expect(Object.keys(body).sort()).toEqual(['date', 'kind', 'lines', 'notes', 'toWarehouseId', 'warehouseId']);
    expect(body.lines.every((l) => Object.keys(l).sort().join() === 'itemId,qtyMilli')).toBe(true);
    expect(transferProblem({ from: 'w-1', to: 'w-1', lines })).toBe('same_warehouse');
    expect(() => transferBody({ date: '2026-11-15', from: 'w-1', to: 'w-1', notes: '', lines })).toThrow(/same_warehouse/);
    expect(transferProblem({ from: 'w-1', to: 'w-2', lines: [] })).toBe('empty');
    expect(transferProblem({ from: 'w-1', to: 'w-2', lines: addStockLine([], { ...cable, trackStock: false }, 1000) })).toBe('service');
    expect(moreThanThere(5000, 4000)).toBe(true);
    expect(moreThanThere(4000, 4000)).toBe(false);
    expect(moreThanThere(1, -3000)).toBe(true);
  });
});

describe('goods received against a purchase order', () => {
  const order = (extra: Partial<OrderDetail> = {}): OrderDetail => ({
    id: 'po-1', number: 'PO-2026-0001', date: '2026-11-01', party: { id: 's-1', name: 'Raz', phone: null }, warehouse: null, currency: 'IQD', expectedDate: '2026-11-10',
    status: 'sent', overdue: true, notes: '', receipts: [],
    lines: [
      { seq: 1, itemId: 'i-1', itemCode: 'CH1', itemName: names('Charger'), unit: 'piece', qtyMilli: 24_000, receivedMilli: 0, remainingMilli: 24_000, lineUnit: 'box', unitFactorMilli: 12_000, unitQtyMilli: 2000 },
      { seq: 2, itemId: 'i-1', itemCode: 'CH1', itemName: names('Charger'), unit: 'piece', qtyMilli: 5000, receivedMilli: 2000, remainingMilli: 3000, lineUnit: null, unitFactorMilli: null, unitQtyMilli: null },
      { seq: 3, itemId: 'i-2', itemCode: 'CB2', itemName: names('Cable'), unit: 'piece', qtyMilli: 10_000, receivedMilli: 10_000, remainingMilli: 0, lineUnit: null, unitFactorMilli: null, unitQtyMilli: null }
    ],
    ...extra
  });

  it('takes what is on the order and no more than is still to come (all its lines), with what is on the list already', () => {
    expect(toComeOf(order(), 'i-1')).toBe(27_000);
    expect(toComeOf(order(), 'i-9')).toBeNull();
    expect(arrivalProblem(order(), [], 'i-1', 27_000)).toBeNull();
    expect(arrivalProblem(order(), [], 'i-9', 1000)).toEqual({ code: 'po_line_unknown' });
    expect(arrivalProblem(order(), addStockLine([], charger, 20_000), 'i-1', 8000)).toEqual({ code: 'po_over_remaining', remaining: 27_000 });
    // all of it came already
    expect(arrivalProblem(order(), [], 'i-2', 1000)).toEqual({ code: 'po_over_remaining', remaining: 0 });
  });

  it('can receive while the order is sent or partly received, something is to come and no draft receipt waits on the PC', () => {
    expect(receivable(order())).toBe('ok');
    expect(receivable(order({ status: 'partial' }))).toBe('ok');
    expect(receivable(order({ status: 'draft' }))).toBe('closed');
    expect(receivable(order({ status: 'received' }))).toBe('closed');
    expect(receivable(order({ receipts: [{ invoiceId: 'inv-1', number: null, date: '2026-11-05', status: 'draft' }] }))).toBe('pending');
    expect(receivable(order({ lines: order().lines.map((l) => ({ ...l, remainingMilli: 0 })) }))).toBe('closed');
  });

  it('is dated the day it was scanned, names a warehouse only when the order names none, and carries no price', () => {
    const lines = addStockLine([], charger, 12_000);
    expect(arrivalBody({ date: '2026-11-14', order: order(), lines, warehouseId: 'w-2' })).toEqual({ date: '2026-11-14', warehouseId: 'w-2', lines: [{ itemId: 'i-1', qtyMilli: 12_000 }] });
    expect(arrivalBody({ date: '2026-11-14', order: order({ warehouse: { id: 'w-1', code: 'W1', name: names('Main') } }), lines, warehouseId: 'w-2' }))
      .toEqual({ date: '2026-11-14', lines: [{ itemId: 'i-1', qtyMilli: 12_000 }] });
    expect(() => arrivalBody({ date: '2026-11-14', order: order(), lines: [], warehouseId: null })).toThrow();
  });

  it('has one arrival per order in the outbox: a second waits for the first to go (a refused or sent one does not count)', () => {
    const item = (extra: Partial<OutboxItem>): OutboxItem => ({ id: 'x', kind: 'arrival', target: 'po-1', body: {}, summary: { title: 'PO-2026-0001' }, createdAt: '', attempts: 0, ...extra });
    expect(arrivalWaiting([item({})], 'po-1')).toBe(true);
    expect(arrivalWaiting([item({})], 'po-2')).toBe(false);
    expect(arrivalWaiting([item({ error: 'po_receipt_pending' })], 'po-1')).toBe(false);
    expect(arrivalWaiting([item({ kind: 'transfer' })], 'po-1')).toBe(false);
    expect(arrivalWaiting([], 'po-1')).toBe(false);
  });
});
