import { describe, expect, it } from 'vitest';
import type { Item } from '../src/api';
import {
  addLine, cartCurrency, countListBody, countSessionBody, lineAmount, linesIn, orderBody, readAmount, readQty, receiptBody, saleBody, setCount, total
} from '../src/documents';

const item = (id: string, salePrice: number, saleCurrency: 'IQD' | 'USD' = 'IQD'): Item => ({
  id, code: id.toUpperCase(), barcode: '', name: { ar: 'كابل', en: 'Cable', ku: 'کێبڵ' }, unit: 'piece', salePrice, saleCurrency, qtyMilli: 0
});

describe('what the phone sends the office', () => {
  it('reads typed amounts in whole minor units: dinars whole, dollars to the cent, Arabic digits too', () => {
    expect(readAmount('250,000', 'IQD')).toBe(250_000);
    expect(readAmount('٢٥٠٠٠٠', 'IQD')).toBe(250_000);
    expect(readAmount('12.5', 'USD')).toBe(1250);
    expect(readAmount('12.505', 'USD')).toBeNull();
    expect(readAmount('1500.5', 'IQD')).toBeNull();
    expect(readAmount('0', 'IQD')).toBeNull();
    expect(readAmount('-5', 'IQD')).toBeNull();
    expect(readAmount('99999999999', 'IQD')).toBeNull();
    expect(readQty('2.5')).toBe(2.5);
    expect(readQty('0.0004')).toBeNull();
    expect(readQty('')).toBeNull();
  });

  it('adds the same item to its line, sets a count, and keeps one currency to a sale', () => {
    let cart = addLine([], item('a', 5000), 1);
    cart = addLine(cart, item('b', 1250, 'USD'), 2);
    cart = addLine(cart, item('a', 5000), 2);
    expect(cart.map((l) => [l.item.id, l.qty])).toEqual([['b', 2], ['a', 3]]);
    expect(cartCurrency(cart)).toBe('IQD');
    expect(linesIn(cart, 'IQD').map((l) => l.item.id)).toEqual(['a']);
    expect(total(linesIn(cart, 'IQD'))).toBe(15_000);
    // a third of a kilo at 1,000 a kilo: 333 dinars, never a fraction
    expect(lineAmount({ item: item('k', 1000), qty: 0.333 })).toBe(333);
    expect(setCount(setCount([], item('a', 1), 4), item('a', 1), 6).map((l) => l.qty)).toEqual([6]);
  });

  it('a sale is a draft invoice: on credit to a customer, cash from a walk-in', () => {
    const lines = [{ item: item('a', 5000), qty: 1.5 }];
    const base = { lines, currency: 'IQD' as const, date: '2026-11-11', warehouseId: 'w1', cashAccount: '1811', rateX100: 142_000, notes: 'phone' };
    expect(saleBody({ ...base, customer: { id: 'c1' } })).toEqual({
      kind: 'sale', date: '2026-11-11', warehouseId: 'w1', currency: 'IQD', rateX100: 100, payment: 'credit', partyId: 'c1', discount: 0, notes: 'phone',
      lines: [{ itemId: 'a', qtyMilli: 1500, unitPrice: 5000 }]
    });
    expect(saleBody({ ...base, customer: null, currency: 'USD' })).toMatchObject({ payment: 'cash', cashAccountCode: '1811', rateX100: 142_000 });
  });

  it('an order is a quote for the customer; a receipt is a draft voucher crediting the customer\'s account', () => {
    expect(orderBody({ lines: [{ item: item('a', 5000), qty: 2 }], currency: 'IQD', date: '2026-11-11', customer: { id: 'c1' }, notes: '', names: (i) => i.name.en })).toEqual({
      date: '2026-11-11', partyId: 'c1', currency: 'IQD', discount: 0, notes: '', lines: [{ itemId: 'a', description: 'Cable', qtyMilli: 2000, unitPrice: 5000 }]
    });
    expect(receiptBody({
      customer: { id: 'c1', name: 'Las', accountCode: '1311' }, amount: 250_000, currency: 'IQD', rateX100: 142_000, cashAccount: '1811', date: '2026-11-11',
      description: 'Received from Las — phone app', note: ' cash '
    })).toEqual({
      kind: 'receipt', date: '2026-11-11', cashAccountCode: '1811', party: 'Las', description: 'Received from Las — phone app — cash', currency: 'IQD', rateX100: 100,
      items: [{ accountCode: '1311', amount: 250_000, partyId: 'c1' }]
    });
  });

  it('a count goes into the open count as quantities in thousandths, or to the admin as a list', () => {
    const lines = [{ item: item('a', 1), qty: 12.5 }];
    expect(countSessionBody(lines)).toEqual({ counts: [{ itemId: 'a', countedMilli: 12_500 }] });
    expect(countListBody('w1', lines, (i) => i.name.ku)).toEqual({ warehouseId: 'w1', lines: [{ itemId: 'a', code: 'A', name: 'کێبڵ', qty: 12.5 }] });
  });
});
