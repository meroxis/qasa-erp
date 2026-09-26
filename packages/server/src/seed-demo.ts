/**
 * Fills an empty database with a small sample company so the app can be tried right away:
 *   npm run seed:demo
 * It refuses to run when the database already has entries.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from './db.ts';
import { createAccount } from './accounts.ts';
import { approveEntry, checkEntry, createJournalEntry, createVoucher } from './journal.ts';
import { updateSettings } from './settings.ts';

const dataDir = resolve(process.env.QASA_DATA_DIR ?? resolve(import.meta.dirname, '../../../data'));
mkdirSync(dataDir, { recursive: true });
const db = openDatabase(resolve(dataDir, 'qasa.sqlite'));

const count = (db.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number }).n;
if (count > 0) {
  console.log('The database already has entries — demo data was not added.');
  process.exit(0);
}

const accountant = 'ديلان رستم';
const checker = 'كاوه رشيد';
const director = 'صلاح نوري';

updateSettings(db, {
  companyName: { ar: 'شركة النهرين للتجارة العامة', en: 'Nahrain General Trading Co.', ku: 'کۆمپانیای نەهرەین بۆ بازرگانیی گشتی' },
  defaultRateX100: 142000
}, accountant);

createAccount(db, { parentCode: '181', code: '1812', name: { ar: 'قاصة فرع بغداد', en: 'Baghdad branch safe', ku: 'قاسەی لقی بەغدا' } }, accountant);
createAccount(db, { parentCode: '261', code: '2611', name: { ar: 'شركة زاكروس للتجهيزات الكهربائية', en: 'Zagros Electrical Supplies', ku: 'کۆمپانیای زاگرۆس بۆ کەرەستەی کارەبا' } }, accountant);
createAccount(db, { parentCode: '33', code: '331', name: { ar: 'الإيجارات', en: 'Rent', ku: 'کرێ' } }, accountant);
createAccount(db, { parentCode: '33', code: '332', name: { ar: 'وقود المولدة', en: 'Generator fuel', ku: 'سووتەمەنیی مۆلیدە' } }, accountant);

function post(id: string) {
  checkEntry(db, id, checker);
  approveEntry(db, id, director);
}

post(createJournalEntry(db, {
  date: '2026-01-01', description: 'القيد الافتتاحي — رأس المال', currency: 'IQD', rateX100: 100,
  lines: [
    { accountCode: '1811', debit: 50_000_000, credit: 0 },
    { accountCode: '1831', debit: 150_000_000, credit: 0 },
    { accountCode: '21', debit: 0, credit: 200_000_000 }
  ]
}, accountant).id);

post(createVoucher(db, {
  kind: 'receipt', date: '2026-09-01', cashAccountCode: '1811', party: 'كاروان عمر',
  description: 'تسديد فاتورة آجلة INV-2026-00142', currency: 'IQD', rateX100: 100,
  items: [{ accountCode: '1611', amount: 1_200_000 }]
}, accountant).id);

post(createVoucher(db, {
  kind: 'payment', date: '2026-09-05', cashAccountCode: '1831', party: 'شركة زاكروس للتجهيزات الكهربائية',
  description: 'تسديد فاتورة الشراء PI-0932', currency: 'IQD', rateX100: 100,
  items: [{ accountCode: '2611', amount: 2_400_000 }]
}, accountant).id);

post(createVoucher(db, {
  kind: 'payment', date: '2026-09-10', cashAccountCode: '1811', party: 'مالك مخزن بغداد',
  description: 'إيجار مخزن بغداد — أيلول', currency: 'IQD', rateX100: 100,
  items: [{ accountCode: '331', amount: 3_500_000 }]
}, accountant).id);

post(createVoucher(db, {
  kind: 'receipt', date: '2026-09-15', cashAccountCode: '1832', party: 'تجارة علي حسين',
  description: 'دفعة بالدولار', currency: 'USD', rateX100: 142000,
  items: [{ accountCode: '1611', amount: 4_000_00 }]
}, accountant).id);

post(createVoucher(db, {
  kind: 'receipt', date: '2026-09-26', cashAccountCode: '1811', party: 'ريباز سالار',
  description: 'القسط 6 من 12 — عقد INS-0087', currency: 'IQD', rateX100: 100,
  items: [{ accountCode: '1612', amount: 375_000 }]
}, accountant).id);

// Waiting for the checker and the director:
const waiting = createVoucher(db, {
  kind: 'payment', date: '2026-09-26', cashAccountCode: '1811', party: 'محطة وقود أربيل',
  description: 'وقود المولدة', currency: 'IQD', rateX100: 100,
  items: [{ accountCode: '332', amount: 450_000 }]
}, accountant);
checkEntry(db, waiting.id, checker);

createVoucher(db, {
  kind: 'receipt', date: '2026-09-27', cashAccountCode: '1811', party: 'زينب عباس',
  description: 'القسط 4 من 10 — عقد INS-0091', currency: 'IQD', rateX100: 100,
  items: [{ accountCode: '1612', amount: 120_000 }]
}, accountant);

db.close();
console.log('Demo data added: Nahrain General Trading Co. with 8 vouchers (6 posted, 1 checked, 1 draft).');
