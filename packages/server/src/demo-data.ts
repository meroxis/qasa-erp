import type { InvoiceInput } from '@qasa/core';
import type { Db } from './db.ts';
import { createAccount } from './accounts.ts';
import { approveEntry, checkEntry, createJournalEntry, createVoucher } from './journal.ts';
import { updateSettings } from './settings.ts';
import { createParty } from './parties.ts';
import { createItem, listWarehouses } from './items.ts';
import { createInvoice, postInvoice } from './invoices.ts';

/**
 * A small sample company — Meroxis — with customers, suppliers, items, invoices and vouchers.
 * Used by `npm run seed:demo` and by the demo on the website. Expects an empty, initialised database.
 */
export function seedDemo(db: Db): void {
  // Sample people are only ever Mer Las and Raz: Mer Las prepares and sells, Raz checks and approves.
  // the owner the demo opens as
  db.prepare("UPDATE users SET name = 'Mer Las', username = 'merlas' WHERE username = 'admin'").run();
  const accountant = 'Mer Las';
  const checker = 'Raz';
  const director = 'Raz';
  const sales = 'Mer Las';

  updateSettings(db, {
    companyName: { ar: 'شركة ميروكسيس', en: 'Meroxis Company', ku: 'کۆمپانیای مێرۆکسیس' },
    defaultRateX100: 142000
  }, accountant);

  createAccount(db, { parentCode: '181', code: '1812', name: { ar: 'قاصة فرع بغداد', en: 'Baghdad branch safe', ku: 'قاسەی لقی بەغدا' } }, accountant);
  createAccount(db, { parentCode: '33', code: '331', name: { ar: 'الإيجارات', en: 'Rent', ku: 'کرێ' } }, accountant);
  createAccount(db, { parentCode: '33', code: '332', name: { ar: 'وقود المولدة', en: 'Generator fuel', ku: 'سووتەمەنیی مۆلیدە' } }, accountant);

  function post(id: string) {
    checkEntry(db, id, checker);
    approveEntry(db, id, director);
  }

  post(createJournalEntry(db, {
    date: '2026-01-01', description: 'القيد الافتتاحي — رأس المال وأرصدة التقسيط', currency: 'IQD', rateX100: 100,
    lines: [
      { accountCode: '1811', debit: 46_500_000, credit: 0 },
      // installments still owed from contracts made before the company started using Qasa ERP
      { accountCode: '1612', debit: 3_500_000, credit: 0 },
      { accountCode: '1831', debit: 150_000_000, credit: 0 },
      { accountCode: '21', debit: 0, credit: 200_000_000 }
    ]
  }, accountant).id);

  // ——— customers, suppliers and items ———
  const sanos = createParty(db, 'customer', { name: 'Sanos Company', phone: '0750 445 1290', address: 'أربيل — شارع 100' }, accountant);
  const rapidnet = createParty(db, 'customer', { name: 'RapidNet Ltd', phone: '0770 318 6642', address: 'بغداد — الكرادة' }, accountant);
  const raz = createParty(db, 'customer', { name: 'Raz', phone: '0751 902 3317', address: 'السليمانية — سالم', creditLimit: 5_000_000 }, accountant);
  const sanosSupply = createParty(db, 'supplier', { name: 'Sanos Company', phone: '0780 110 4455', address: 'بغداد — الشورجة' }, accountant);
  const rapidnetSupply = createParty(db, 'supplier', { name: 'RapidNet Ltd', phone: '0750 660 7788', address: 'أربيل — المنطقة الصناعية' }, accountant);

  const ac = createItem(db, { code: 'AC-18', name: { ar: 'مكيف سبلت 18 ألف وحدة', en: 'Split AC 18,000 BTU', ku: 'سپلیتی ١٨ هەزار' }, unit: 'piece', salePrice: 823_600, saleCurrency: 'IQD' }, accountant);
  const pv = createItem(db, { code: 'PV-550', barcode: '6291041500550', name: { ar: 'لوح شمسي 550 واط', en: 'Solar panel 550 W', ku: 'پانێڵی خۆر ٥٥٠ وات' }, unit: 'piece', salePrice: 134_900, saleCurrency: 'IQD' }, accountant);
  const inverter = createItem(db, { code: 'INV-5K', name: { ar: 'انفرتر 5 كيلوواط', en: 'Inverter 5 kW', ku: 'ئینڤێرتەری ٥ کیلۆوات' }, unit: 'piece', salePrice: 908_800, saleCurrency: 'IQD' }, accountant);
  const pipe = createItem(db, { code: 'CU-PIPE', name: { ar: 'أنبوب نحاس للتبريد', en: 'Copper pipe', ku: 'بۆری مس' }, unit: 'm', salePrice: 12_500, saleCurrency: 'IQD' }, accountant);
  const install = createItem(db, { code: 'SRV-INST', name: { ar: 'نصب وتشغيل', en: 'Installation', ku: 'دامەزراندن' }, unit: 'service', salePrice: 50_000, saleCurrency: 'IQD' }, accountant);
  const main = listWarehouses(db)[0]!.id;

  function invoice(input: Omit<InvoiceInput, 'warehouseId' | 'rateX100' | 'currency'> & Partial<Pick<InvoiceInput, 'currency' | 'rateX100'>>, user: string, doPost = true) {
    const created = createInvoice(db, { warehouseId: main, currency: 'IQD', rateX100: 100, ...input }, user);
    return doPost ? postInvoice(db, created.id, user) : created;
  }
  const qty = (n: number) => n * 1000;

  // ——— purchases ———
  invoice({
    kind: 'purchase', date: '2026-09-02', partyId: sanosSupply.id, payment: 'credit', discount: 300_000, notes: 'فاتورة المجهز 0932',
    lines: [{ itemId: ac.id, qtyMilli: qty(20), unitPrice: 610_000 }, { itemId: pipe.id, qtyMilli: qty(200), unitPrice: 8_000 }]
  }, accountant);
  invoice({
    kind: 'purchase', date: '2026-09-04', partyId: rapidnetSupply.id, payment: 'cash', cashAccountCode: '1831', discount: 0,
    lines: [{ itemId: pv.id, qtyMilli: qty(60), unitPrice: 98_000 }, { itemId: inverter.id, qtyMilli: qty(10), unitPrice: 690_000 }]
  }, accountant);

  post(createVoucher(db, {
    kind: 'payment', date: '2026-09-05', cashAccountCode: '1831', party: sanosSupply.name,
    description: 'دفعة من حساب فاتورة الشراء PI-2026-0001', currency: 'IQD', rateX100: 100,
    items: [{ accountCode: '2611', amount: 6_000_000, partyId: sanosSupply.id }]
  }, accountant).id);

  // ——— sales ———
  invoice({
    kind: 'sale', date: '2026-09-08', payment: 'cash', cashAccountCode: '1811', discount: 0,
    lines: [{ itemId: ac.id, qtyMilli: qty(1), unitPrice: 823_600 }, { itemId: install.id, qtyMilli: qty(1), unitPrice: 50_000 }]
  }, sales);
  invoice({
    kind: 'sale', date: '2026-09-12', partyId: sanos.id, payment: 'credit', discount: 35_200, notes: 'مشروع فندق أربيل — المرحلة الأولى',
    lines: [
      { itemId: ac.id, qtyMilli: qty(2), unitPrice: 823_600 },
      { itemId: pv.id, qtyMilli: qty(8), unitPrice: 134_900 },
      { itemId: inverter.id, qtyMilli: qty(1), unitPrice: 908_800 }
    ]
  }, sales);
  invoice({
    kind: 'sale', date: '2026-09-18', partyId: rapidnet.id, payment: 'credit', currency: 'USD', rateX100: 142_000, discount: 0,
    lines: [{ itemId: ac.id, qtyMilli: qty(5), unitPrice: 580_00 }]
  }, sales);
  invoice({
    kind: 'sale', date: '2026-09-24', partyId: raz.id, payment: 'credit', discount: 0,
    lines: [{ itemId: pv.id, qtyMilli: qty(12), unitPrice: 134_900 }, { itemId: pipe.id, qtyMilli: qty(30), unitPrice: 12_500 }]
  }, sales);
  // a quotation-like draft, not posted yet
  invoice({
    kind: 'sale', date: '2026-09-27', partyId: sanos.id, payment: 'credit', discount: 0, notes: 'المرحلة الثانية',
    lines: [{ itemId: inverter.id, qtyMilli: qty(2), unitPrice: 908_800 }, { itemId: install.id, qtyMilli: qty(2), unitPrice: 50_000 }]
  }, sales, false);

  // ——— customers paying ———
  post(createVoucher(db, {
    kind: 'receipt', date: '2026-09-20', cashAccountCode: '1811', party: sanos.name,
    description: 'دفعة من حساب الفاتورة INV-2026-0002', currency: 'IQD', rateX100: 100,
    items: [{ accountCode: '1611', amount: 2_000_000, partyId: sanos.id }]
  }, accountant).id);
  post(createVoucher(db, {
    kind: 'receipt', date: '2026-09-22', cashAccountCode: '1832', party: rapidnet.name,
    description: 'دفعة بالدولار — INV-2026-0003', currency: 'USD', rateX100: 142000,
    items: [{ accountCode: '1611', amount: 1_500_00, partyId: rapidnet.id }]
  }, accountant).id);

  // ——— expenses and installments ———
  post(createVoucher(db, {
    kind: 'payment', date: '2026-09-10', cashAccountCode: '1811', party: 'مالك مخزن بغداد',
    description: 'إيجار مخزن بغداد — أيلول', currency: 'IQD', rateX100: 100,
    items: [{ accountCode: '331', amount: 1_250_000 }]
  }, accountant).id);

  post(createVoucher(db, {
    kind: 'receipt', date: '2026-09-26', cashAccountCode: '1811', party: 'Raz',
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
    kind: 'receipt', date: '2026-09-27', cashAccountCode: '1811', party: 'Mer Las',
    description: 'القسط 4 من 10 — عقد INS-0091', currency: 'IQD', rateX100: 100,
    items: [{ accountCode: '1612', amount: 120_000 }]
  }, accountant);
}
