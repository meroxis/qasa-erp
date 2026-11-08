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
