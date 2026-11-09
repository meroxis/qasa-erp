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
