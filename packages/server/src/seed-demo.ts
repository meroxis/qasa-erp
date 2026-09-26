/**
 * Fills an empty database with a small sample company so the app can be tried right away:
 *   npm run seed:demo
 * It refuses to run when the database already has entries.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from './db.ts';
import { seedDemo } from './demo-data.ts';

const dataDir = resolve(process.env.QASA_DATA_DIR ?? resolve(import.meta.dirname, '../../../data'));
mkdirSync(dataDir, { recursive: true });
const db = openDatabase(resolve(dataDir, 'qasa.sqlite'));

const count = (db.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number }).n;
if (count > 0) {
  console.log('The database already has entries — demo data was not added.');
  process.exit(0);
}

seedDemo(db);
db.close();
console.log('Demo data added: Nahrain General Trading Co. — 3 customers, 2 suppliers, 5 items, 6 posted invoices + 1 draft, 8 vouchers.');
