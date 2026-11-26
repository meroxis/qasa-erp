import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { initDatabase, type Db } from './db.ts';
import { seedDemo, seedPharmacyDemo } from './demo-data.ts';
import { seedClothingDemo, seedGoldDemo, seedMarketDemo, seedRestaurantDemo, seedWholesaleDemo, startDemoMonth } from './demo-samples.ts';
import { planStatus } from './license.ts';
import { getSettings } from './settings.ts';

function fresh(): Db {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  db.exec('PRAGMA foreign_keys = ON');
  initDatabase(db);
  seedDemo(db);
  return db;
}
const count = (db: Db, sql: string) => Number((db.prepare(sql).get() as { n: number }).n);

// 2.0.0: the website demo shows the new business types, in the free first month (a demo on the Free plan showed every
// new page as "needs a plan")
describe('the website demo samples of 2.0', () => {
  it('runs every demo in the free first month', () => {
    const db = fresh();
    startDemoMonth(db);
    expect(planStatus(db).source).toBe('trial');
    expect(planStatus(db).features).toEqual(expect.arrayContaining(['promotions', 'multiTill', 'goldShop', 'wholesale', 'clothingShop']));
  });

  it('?market: groceries with barcodes, weighed produce, two tills, two offers and a gift voucher on an open shift', () => {
    const db = fresh();
    seedMarketDemo(db);
    expect(getSettings(db).businessType).toBe('market');
    expect(count(db, "SELECT COUNT(*) AS n FROM items WHERE barcode LIKE '21%' AND unit = 'kg'")).toBe(3);
    expect(count(db, 'SELECT COUNT(*) AS n FROM pos_tills WHERE active = 1')).toBe(2);
    expect(count(db, 'SELECT COUNT(*) AS n FROM offers')).toBe(2);
    expect(count(db, 'SELECT COUNT(*) AS n FROM gift_vouchers')).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM pos_shifts WHERE status = 'open'")).toBe(1);
  });

  it('?gold: today’s board and pieces priced from it', () => {
    const db = fresh();
    seedGoldDemo(db);
    expect(getSettings(db).businessType).toBe('goldShop');
    expect(count(db, 'SELECT COUNT(*) AS n FROM gold_items')).toBe(5);
    expect(count(db, "SELECT COUNT(*) AS n FROM items i JOIN gold_items g ON g.item_id = i.id WHERE i.sale_price > 0")).toBe(5);
  });

  it('?wholesale: a rep with a van, a route for today and an order waiting', () => {
    const db = fresh();
    seedWholesaleDemo(db);
    expect(getSettings(db).businessType).toBe('wholesale');
    expect(count(db, 'SELECT COUNT(*) AS n FROM ws_reps')).toBe(1);
    expect(count(db, 'SELECT COUNT(*) AS n FROM ws_route_stops')).toBe(3);
    expect(count(db, 'SELECT COUNT(*) AS n FROM ws_orders')).toBe(1);
  });

  it('?clothing: two models in sizes and colours, in stock', () => {
    const db = fresh();
    seedClothingDemo(db);
    expect(getSettings(db).businessType).toBe('clothingShop');
    expect(count(db, 'SELECT COUNT(*) AS n FROM cl_models')).toBe(2);
    expect(count(db, 'SELECT COUNT(*) AS n FROM cl_variants')).toBe(12);
  });

  it('?restaurant (2.1): a menu, a hall and a family section, two tables eating', () => {
    const db = fresh();
    seedRestaurantDemo(db);
    expect(getSettings(db).businessType).toBe('restaurant');
    expect(count(db, 'SELECT COUNT(*) AS n FROM rs_tables')).toBe(14);
    expect(count(db, "SELECT COUNT(*) AS n FROM rs_orders WHERE status = 'open'")).toBe(2);
    expect(count(db, 'SELECT COUNT(*) AS n FROM rs_order_lines WHERE ticket IS NULL')).toBe(0);
  });

  it('?pharmacy: the pharmacy sample', () => {
    const db = fresh();
    startDemoMonth(db);
    seedPharmacyDemo(db);
    expect(count(db, 'SELECT COUNT(*) AS n FROM pharma_details')).toBe(2);
  });
});
