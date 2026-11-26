import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from './db.ts';
import { createItem, listItems, listWarehouses } from './items.ts';

// 2.0.0: a search reads the words of the items first and then the stock of those found only (a big company's search
// read the stock of all 100,000 items to show a few, bench/big-company.ts). The answer must be the same as before:
// the whole list, kept to the items whose words hold the search, with the same stock figures and in code order.

let db: Db;
let main: string;
let other: string;
const user = 'Mer';

beforeEach(() => {
  db = openDatabase(':memory:');
  main = listWarehouses(db)[0]!.id;
  // a second warehouse (the free plan has one: put in as a Pro company's would be)
  other = 'w2';
  db.prepare("INSERT INTO warehouses (id, code, name_ar, name_en, name_ku, account_code, active, created_at) VALUES ('w2', 'W2', 'م٢', 'Second', 'ک٢', '1371', 1, '2026-10-01T00:00:00Z')").run();
});

afterEach(() => db.close());

const move = (itemId: string, warehouseId: string, qtyMilli: number, value: number) =>
  db.prepare("INSERT INTO stock_moves (item_id, warehouse_id, date, qty_milli, value, source_type, source_id, created_at) VALUES (?, ?, '2026-10-01', ?, ?, 'opening', 'x', '2026-10-01T00:00:00Z')")
    .run(itemId, warehouseId, qtyMilli, value);

/** The search, and the whole list kept to the items it found: the same figures, the same order. */
function before(q: string, filters: Parameters<typeof listItems>[1] = {}, warehouses: Parameters<typeof listItems>[2] = null) {
  const found = listItems(db, { ...filters, q }, warehouses);
  const ids = new Set(found.map((i) => i.id));
  return { found, kept: listItems(db, filters, warehouses).filter((i) => ids.has(i.id)) };
}

describe('items search', () => {
  it('finds by name, code and barcode, with each item\'s stock as in the whole list', () => {
    const tea = createItem(db, { code: 'T-1', barcode: '6290000000017', name: { ar: 'شاي', en: 'Black tea', ku: 'چا' }, unit: 'piece', salePrice: 2000, saleCurrency: 'IQD' }, user);
    const sugar = createItem(db, { code: 'S-1', name: { ar: 'سكر', en: 'Sugar', ku: 'شەکر' }, unit: 'piece', salePrice: 1500, saleCurrency: 'IQD' }, user);
    const greenTea = createItem(db, { code: 'T-2', name: { ar: 'شاي أخضر', en: 'Green tea', ku: 'چای سەوز' }, unit: 'piece', salePrice: 3000, saleCurrency: 'IQD' }, user);
    move(tea.id, main, 5000, 7500);
    move(tea.id, other, 2000, 3000);
    move(greenTea.id, other, 1000, 2500);
    move(sugar.id, main, 9000, 9000);

    expect(listItems(db, { q: 'tea' }).map((i) => i.code)).toEqual(['T-1', 'T-2']);
    expect(listItems(db, { q: 'چا' }).map((i) => i.code)).toEqual(['T-1', 'T-2']);
    expect(listItems(db, { q: '6290000000017' }).map((i) => i.id)).toEqual([tea.id]);
    expect(listItems(db, { q: 's-1' }).map((i) => i.id)).toEqual([sugar.id]);
    expect(listItems(db, { q: 'nothing like it' })).toEqual([]);
    // the figures: every warehouse, one warehouse, a user's warehouses, none
    for (const [filters, warehouses] of [[{}, null], [{ warehouseId: other }, null], [{}, [main]], [{}, []], [{ active: true }, null]] as const) {
      const { found, kept } = before('tea', filters, warehouses);
      expect(found, JSON.stringify([filters, warehouses])).toEqual(kept);
    }
    expect(listItems(db, { q: 'tea' }).map((i) => [i.code, i.qtyMilli, i.value, i.hasMoves])).toEqual([['T-1', 7000, 10500, true], ['T-2', 1000, 2500, true]]);
    expect(listItems(db, { q: 'tea', warehouseId: main }).map((i) => [i.code, i.qtyMilli, i.value, i.hasMoves])).toEqual([['T-1', 5000, 7500, true], ['T-2', 0, 0, true]]);
  });

  it('keeps the code order when it finds more items than are read at once', () => {
    for (let i = 0; i < 950; i++) {
      const made = createItem(db, { code: `A-${String(950 - i).padStart(4, '0')}`, name: { ar: `مادة ${i}`, en: `Item ${i}`, ku: `کاڵا ${i}` }, unit: 'piece', salePrice: 1000, saleCurrency: 'IQD' }, user);
      if (i % 3 === 0) move(made.id, main, 1000 * i, 10 * i);
    }
    const { found, kept } = before('item');
    expect(found).toHaveLength(950);
    expect(found).toEqual(kept);
    expect(found.map((i) => i.code)).toEqual([...found.map((i) => i.code)].sort());
  });

  it('reads some items by id only, with their stock (a printed document\'s barcodes)', () => {
    const made = Array.from({ length: 5 }, (_, i) => createItem(db, { code: `B-${i}`, barcode: `629000000010${i}`, name: { ar: `م${i}`, en: `Box ${i}`, ku: `ک${i}` }, unit: 'piece', salePrice: 1000, saleCurrency: 'IQD' }, user));
    move(made[3]!.id, main, 4000, 400);
    move(made[3]!.id, other, 1000, 100);
    const some = listItems(db, { ids: [made[3]!.id, made[1]!.id] });
    expect(some.map((i) => [i.code, i.barcode, i.qtyMilli, i.value])).toEqual([['B-1', '6290000000101', 0, 0], ['B-3', '6290000000103', 5000, 500]]);
    expect(listItems(db, { ids: [made[3]!.id] }, [main]).map((i) => i.qtyMilli)).toEqual([4000]);
    expect(listItems(db, { ids: [] })).toEqual([]);
    expect(listItems(db, { ids: ['no-such-item'] })).toEqual([]);
    const all = new Map(listItems(db).map((i) => [i.id, i]));
    for (const it of some) expect(it).toEqual(all.get(it.id));
  });
});
