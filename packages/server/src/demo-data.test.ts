import { expect, it } from 'vitest';
import { openDatabase } from './db.ts';
import { seedDemo } from './demo-data.ts';

// The sample company's people are only Mer, Las and Raz, and its places are named after what or where they are: a
// street named after a person (the old «السليمانية — سالم», Salim Street) is a sample person too.
it('gives the demo parties neutral addresses, with no street named after a person', () => {
  const db = openDatabase(':memory:');
  seedDemo(db);
  const parties = db.prepare('SELECT name, address FROM parties ORDER BY code').all() as { name: string; address: string | null }[];
  expect(parties.length).toBeGreaterThan(3);
  expect(parties.find((p) => p.name === 'Raz')?.address).toBe('السليمانية — شارع البازار');
  for (const p of parties) expect(p.address ?? '', p.name).not.toMatch(/سالم|Salim|Salem/);
  db.close();
});

// The sample items' Kurdish names had "١٨" and "٥٥٠" while their Arabic and English names and every amount used 0–9:
// a Kurdish screen then mixed two digit styles. The digit setting decides how the app's numbers show.
it('writes the numbers in sample item names with the same digits in every language', () => {
  const db = openDatabase(':memory:');
  seedDemo(db);
  const items = db.prepare('SELECT name_ar AS ar, name_en AS en, name_ku AS ku FROM items').all() as { ar: string; en: string; ku: string }[];
  expect(items.length).toBeGreaterThan(3);
  for (const item of items) expect(`${item.ar} ${item.en} ${item.ku}`, item.en).not.toMatch(/[\u0660-\u0669\u06F0-\u06F9]/);
  db.close();
});

it('has a pharmacy sample: medicines by the strip and the box, in batches with expiry dates, sold to Mer, Las and Raz', async () => {
  const { openDatabase } = await import('./db.ts');
  const { seedDemo, seedPharmacyDemo } = await import('./demo-data.ts');
  const { batchBalance } = await import('./batches.ts');
  const db = openDatabase(':memory:');
  seedDemo(db);
  seedPharmacyDemo(db);
  const sold = db.prepare("SELECT p.name, l.unit FROM invoice_lines l JOIN invoices v ON v.id = l.invoice_id JOIN parties p ON p.id = v.party_id JOIN pharma_details d ON d.item_id = l.item_id WHERE v.status = 'posted' ORDER BY p.name, l.unit").all();
  expect(sold).toEqual([{ name: 'Las', unit: 'box' }, { name: 'Mer', unit: 'strip' }, { name: 'Raz', unit: 'box' }, { name: 'Raz', unit: 'strip' }]);
  const main = (db.prepare('SELECT id FROM warehouses LIMIT 1').get() as { id: string }).id;
  for (const item of db.prepare('SELECT item_id FROM pharma_details').all() as { item_id: string }[]) {
    const b = batchBalance(db, item.item_id, main);
    expect(b.batches).toBe(b.stock);
  }
  // the copper pipe is sold by the roll too
  expect(db.prepare("SELECT u.unit, u.factor_milli FROM item_units u JOIN items i ON i.id = u.item_id WHERE i.code = 'CU-PIPE'").all()).toEqual([{ unit: 'roll', factor_milli: 25_000 }]);
  db.close();
});
