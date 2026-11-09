import type { InvoiceInput } from '@qasa/core';
import type { Db } from './db.ts';
import { createAccount } from './accounts.ts';
import { approveEntry, checkEntry, createJournalEntry, createVoucher } from './journal.ts';
import { updateSettings } from './settings.ts';
import { createParty } from './parties.ts';
import { createItem, listWarehouses, updateItem } from './items.ts';
import { createStockDoc, postStockDoc } from './stock-docs.ts';
import { createInvoice, postInvoice } from './invoices.ts';

/**
 * A small sample company — Meroxis — with customers, suppliers, items, invoices and vouchers.
 * Used by `npm run seed:demo` and by the demo on the website. Expects an empty, initialised database.
 */
export function seedDemo(db: Db): void {
  // Sample people are only ever Mer, Las and Raz (two people Mer and Las, never one name), and the only company is
  // Meroxis Company: Mer prepares, Las sells, Raz checks and approves. They are also the customers and suppliers.
  // the owner the demo opens as
  db.prepare("UPDATE users SET name = 'Mer', username = 'mer' WHERE username = 'admin'").run();
  const accountant = 'Mer';
  const checker = 'Raz';
  const director = 'Raz';
  const sales = 'Las';

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
  const mer = createParty(db, 'customer', { name: 'Mer', phone: '0750 445 1290', address: 'أربيل — شارع 100' }, accountant);
  const las = createParty(db, 'customer', { name: 'Las', phone: '0770 318 6642', address: 'بغداد — الكرادة' }, accountant);
  const raz = createParty(db, 'customer', { name: 'Raz', phone: '0751 902 3317', address: 'السليمانية — شارع البازار', creditLimit: 5_000_000 }, accountant);
  const lasSupply = createParty(db, 'supplier', { name: 'Las', phone: '0780 110 4455', address: 'بغداد — الشورجة' }, accountant);
  const razSupply = createParty(db, 'supplier', { name: 'Raz', phone: '0750 660 7788', address: 'أربيل — المنطقة الصناعية' }, accountant);

  const ac = createItem(db, { code: 'AC-18', name: { ar: 'مكيف سبلت 18 ألف وحدة', en: 'Split AC 18,000 BTU', ku: 'سپلیتی 18 هەزار' }, unit: 'piece', salePrice: 823_600, saleCurrency: 'IQD' }, accountant);
  const pv = createItem(db, { code: 'PV-550', barcode: '6291041500550', name: { ar: 'لوح شمسي 550 واط', en: 'Solar panel 550 W', ku: 'پانێڵی خۆر 550 وات' }, unit: 'piece', salePrice: 134_900, saleCurrency: 'IQD' }, accountant);
  const inverter = createItem(db, { code: 'INV-5K', name: { ar: 'انفرتر 5 كيلوواط', en: 'Inverter 5 kW', ku: 'ئینڤێرتەری 5 کیلۆوات' }, unit: 'piece', salePrice: 908_800, saleCurrency: 'IQD' }, accountant);
  const pipe = createItem(db, { code: 'CU-PIPE', name: { ar: 'أنبوب نحاس للتبريد', en: 'Copper pipe', ku: 'بۆری مس' }, unit: 'm', salePrice: 12_500, saleCurrency: 'IQD' }, accountant);
  const install = createItem(db, { code: 'SRV-INST', name: { ar: 'نصب وتشغيل', en: 'Installation', ku: 'دامەزراندن' }, unit: 'service', salePrice: 50_000, saleCurrency: 'IQD' }, accountant);
  const main = listWarehouses(db)[0]!.id;
  // 1.1: copper pipe is also sold by the roll of 25 m, with its own barcode and price
  updateItem(db, pipe.id, {
    code: pipe.code, name: pipe.name, unit: 'm', salePrice: 12_500, saleCurrency: 'IQD',
    units: [{ unit: 'roll', factorMilli: 25_000, barcode: '6291041500901', salePrice: 300_000 }], saleUnit: null
  }, accountant);

  function invoice(input: Omit<InvoiceInput, 'warehouseId' | 'rateX100' | 'currency'> & Partial<Pick<InvoiceInput, 'currency' | 'rateX100'>>, user: string, doPost = true) {
    const created = createInvoice(db, { warehouseId: main, currency: 'IQD', rateX100: 100, ...input }, user);
    return doPost ? postInvoice(db, created.id, user) : created;
  }
  const qty = (n: number) => n * 1000;

  // ——— purchases ———
  invoice({
    kind: 'purchase', date: '2026-09-02', partyId: lasSupply.id, payment: 'credit', discount: 300_000, notes: 'فاتورة المجهز 0932',
    lines: [{ itemId: ac.id, qtyMilli: qty(20), unitPrice: 610_000 }, { itemId: pipe.id, qtyMilli: qty(200), unitPrice: 8_000 }]
  }, accountant);
  invoice({
    kind: 'purchase', date: '2026-09-04', partyId: razSupply.id, payment: 'cash', cashAccountCode: '1831', discount: 0,
    lines: [{ itemId: pv.id, qtyMilli: qty(60), unitPrice: 98_000 }, { itemId: inverter.id, qtyMilli: qty(10), unitPrice: 690_000 }]
  }, accountant);

  post(createVoucher(db, {
    kind: 'payment', date: '2026-09-05', cashAccountCode: '1831', party: lasSupply.name,
    description: 'دفعة من حساب فاتورة الشراء PI-2026-0001', currency: 'IQD', rateX100: 100,
    items: [{ accountCode: '2611', amount: 6_000_000, partyId: lasSupply.id }]
  }, accountant).id);

  // ——— sales ———
  invoice({
    kind: 'sale', date: '2026-09-08', payment: 'cash', cashAccountCode: '1811', discount: 0,
    lines: [{ itemId: ac.id, qtyMilli: qty(1), unitPrice: 823_600 }, { itemId: install.id, qtyMilli: qty(1), unitPrice: 50_000 }]
  }, sales);
  invoice({
    kind: 'sale', date: '2026-09-12', partyId: mer.id, payment: 'credit', discount: 35_200, notes: 'مشروع فندق أربيل — المرحلة الأولى',
    lines: [
      { itemId: ac.id, qtyMilli: qty(2), unitPrice: 823_600 },
      { itemId: pv.id, qtyMilli: qty(8), unitPrice: 134_900 },
      { itemId: inverter.id, qtyMilli: qty(1), unitPrice: 908_800 }
    ]
  }, sales);
  invoice({
    kind: 'sale', date: '2026-09-18', partyId: las.id, payment: 'credit', currency: 'USD', rateX100: 142_000, discount: 0,
    lines: [{ itemId: ac.id, qtyMilli: qty(5), unitPrice: 580_00 }]
  }, sales);
  invoice({
    kind: 'sale', date: '2026-09-24', partyId: raz.id, payment: 'credit', discount: 0,
    lines: [{ itemId: pv.id, qtyMilli: qty(12), unitPrice: 134_900 }, { itemId: pipe.id, qtyMilli: qty(30), unitPrice: 12_500 }]
  }, sales);
  // a quotation-like draft, not posted yet
  invoice({
    kind: 'sale', date: '2026-09-27', partyId: mer.id, payment: 'credit', discount: 0, notes: 'المرحلة الثانية',
    lines: [{ itemId: inverter.id, qtyMilli: qty(2), unitPrice: 908_800 }, { itemId: install.id, qtyMilli: qty(2), unitPrice: 50_000 }]
  }, sales, false);

  // ——— customers paying ———
  post(createVoucher(db, {
    kind: 'receipt', date: '2026-09-20', cashAccountCode: '1811', party: mer.name,
    description: 'دفعة من حساب الفاتورة INV-2026-0002', currency: 'IQD', rateX100: 100,
    items: [{ accountCode: '1611', amount: 2_000_000, partyId: mer.id }]
  }, accountant).id);
  post(createVoucher(db, {
    kind: 'receipt', date: '2026-09-22', cashAccountCode: '1832', party: las.name,
    description: 'دفعة بالدولار — INV-2026-0003', currency: 'USD', rateX100: 142000,
    items: [{ accountCode: '1611', amount: 1_500_00, partyId: las.id }]
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
    kind: 'receipt', date: '2026-09-27', cashAccountCode: '1811', party: 'Las',
    description: 'القسط 4 من 10 — عقد INS-0091', currency: 'IQD', rateX100: 100,
    items: [{ accountCode: '1612', amount: 120_000 }]
  }, accountant);
}

/**
 * The pharmacy sample (1.1, a pharmacy company only): medicines kept in tablets and sold by the strip or the box, in
 * batches with expiry dates (one of them near its date), sold to Mer, Las and Raz. Expects seedDemo to have run.
 */
export function seedPharmacyDemo(db: Db): void {
  const user = 'Mer';
  updateSettings(db, { businessTypes: ['trade', 'pharmacy'] }, user);
  const main = listWarehouses(db)[0]!.id;
  const units = (box: number, code: string) => [
    { unit: 'strip' as const, factorMilli: 10_000, barcode: `${code}1`, salePrice: null },
    { unit: 'box' as const, factorMilli: box * 1000, barcode: `${code}2`, salePrice: null }
  ];
  const amox = createItem(db, {
    code: 'MED-AMOX', name: { ar: 'أموكسيسيلين 500 ملغ', en: 'Amoxicillin 500 mg', ku: 'ئەمۆکسیسیلین 500 ملگ' }, unit: 'capsule', salePrice: 250, saleCurrency: 'IQD',
    units: units(20, '629104170010'), saleUnit: 'strip', purchaseUnit: 'box', trackExpiry: true
  }, user);
  const para = createItem(db, {
    code: 'MED-PARA', name: { ar: 'باراسيتامول 500 ملغ', en: 'Paracetamol 500 mg', ku: 'پاراسیتامۆڵ 500 ملگ' }, unit: 'tablet', salePrice: 100, saleCurrency: 'IQD',
    units: units(100, '629104170020'), saleUnit: 'strip', purchaseUnit: 'box', trackExpiry: true
  }, user);
  const doc = createStockDoc(db, {
    kind: 'opening', date: '2026-09-01', warehouseId: main, counterAccountCode: '21', notes: 'الأدوية — أول المدة',
    lines: [
      { itemId: amox.id, qtyMilli: 200_000, unitCost: 150, batchNo: 'AMX-2611', expiry: '2026-12-31' },
      { itemId: amox.id, qtyMilli: 400_000, unitCost: 150, batchNo: 'AMX-2708', expiry: '2027-08-31' },
      { itemId: para.id, qtyMilli: 1_000_000, unitCost: 60, batchNo: 'PAR-2803', expiry: '2028-03-31' }
    ]
  }, user);
  postStockDoc(db, doc.id, user);
  // the pharmacy details (the pharmacy page shows them with Pro)
  const details = db.prepare(`INSERT INTO pharma_details (item_id, generic_name, generic_key, form, strength, manufacturer, rx_only, controlled, shelf, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`);
  const now = new Date().toISOString();
  details.run(amox.id, 'Amoxicillin', 'amoxicillin', 'capsule', '500 mg', 'Pioneer', 1, 'A-2', now);
  details.run(para.id, 'Paracetamol', 'paracetamol', 'tablet', '500 mg', 'Pioneer', 0, 'A-1', now);
  const customers = (db.prepare("SELECT id, name FROM parties WHERE type = 'customer' AND name IN ('Mer', 'Las', 'Raz')").all() as { id: string; name: string }[]);
  const byName = new Map(customers.map((c) => [c.name, c.id]));
  const sell = (name: string, date: string, lines: { itemId: string; unit: 'strip' | 'box'; unitQtyMilli: number; unitPrice: number }[]) => {
    const inv = createInvoice(db, { kind: 'sale', date, partyId: byName.get(name), warehouseId: main, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0, lines: lines.map((l) => ({ ...l, qtyMilli: 0 })) }, 'Las');
    postInvoice(db, inv.id, 'Las');
  };
  sell('Mer', '2026-09-15', [{ itemId: amox.id, unit: 'strip', unitQtyMilli: 2_000, unitPrice: 2_500 }]);
  sell('Las', '2026-09-16', [{ itemId: para.id, unit: 'box', unitQtyMilli: 1_000, unitPrice: 9_000 }]);
  sell('Raz', '2026-09-17', [{ itemId: amox.id, unit: 'box', unitQtyMilli: 1_000, unitPrice: 4_800 }, { itemId: para.id, unit: 'strip', unitQtyMilli: 3_000, unitPrice: 1_000 }]);
}
