import { randomUUID } from 'node:crypto';
import { todayIso } from '@qasa/core';
import type { Db } from './db.ts';
import { ownerActor } from './auth.ts';
import { createAccount } from './accounts.ts';
import { planStatus } from './license.ts';
import { updateSettings, writeSetting } from './settings.ts';
import { createItem, createWarehouse, listWarehouses } from './items.ts';
import { createStockDoc, postStockDoc } from './stock-docs.ts';
import { createCategory } from './categories.ts';
import { createTill } from './pos-tills.ts';
import { openShift } from './pos.ts';
import { createOffer } from './offers.ts';
import { sellGiftVoucher } from './gift-vouchers.ts';
import { setBoard, setGoldItem } from './gold.ts';
import { moveVan, saveRep, setRouteDay, createOrder } from './wholesale.ts';
import { createModel, listColors, saveColor } from './clothing.ts';
import { addLines, openOrder, quickRoom, sendToKitchen } from './restaurant.ts';

/**
 * The website demo's samples for the business types of 2.0 (apps/web/src/demo/backend.ts): ?market, ?gold, ?wholesale and
 * ?clothing (2.1: and ?restaurant). Each expects seedDemo to have run (the people Mer, Las and Raz, the warehouse and the safes) and turns the
 * sample company into that business, with enough in it to try the pages. The paid pages run in the free first month
 * (startDemoMonth), as the petrol station's sample does.
 */

/** The free first month in the website demo: the browser can't seal a trial, so its start is written unsealed (only a non-strict build counts it). */
export function startDemoMonth(db: Db): void {
  if (planStatus(db).source !== 'trial') writeSetting(db, 'trial_started', todayIso());
}

const user = 'Mer';
const main = (db: Db) => listWarehouses(db)[0]!.id;
/** the sample company's own items (air conditioners, cables…) stay in its books but leave the lists of another business */
const retireSampleItems = (db: Db) => { db.prepare('UPDATE items SET active = 0').run(); };
const n3 = (ar: string, en: string, ku: string) => ({ ar, en, ku });

function opening(db: Db, warehouseId: string, notes: string, lines: { itemId: string; qtyMilli: number; unitCost: number }[]): void {
  const doc = createStockDoc(db, { kind: 'opening', date: '2026-09-01', warehouseId, counterAccountCode: '21', notes, lines }, user);
  postStockDoc(db, doc.id, user);
}

/** ?market: a supermarket. Barcoded groceries, fruit and vegetables sold by weight (scale labels 21…), two tills, two offers and a gift voucher sold on Till 1's open shift. */
export function seedMarketDemo(db: Db): void {
  startDemoMonth(db);
  retireSampleItems(db);
  updateSettings(db, { companyName: n3('ميروكسيس ماركت', 'Meroxis Market', 'مێرۆکسیس مارکێت'), businessTypes: ['market'] }, user);
  db.prepare('UPDATE item_categories SET active = 0').run();
  const groceries = createCategory(db, { name: n3('مواد غذائية', 'Groceries', 'خۆراک') }, user).id;
  const drinks = createCategory(db, { name: n3('مشروبات', 'Drinks', 'خواردنەوە') }, user).id;
  const produce = createCategory(db, { name: n3('خضار وفواكه', 'Fruit and vegetables', 'میوە و سەوزە') }, user).id;
  const rows: { code: string; barcode: string; name: [string, string, string]; unit: 'piece' | 'kg'; price: number; cost: number; qty: number; cat: string }[] = [
    { code: 'RICE5', barcode: '6260000000011', name: ['رز 5 كغ', 'Rice 5 kg', 'برنج 5 کیلۆ'], unit: 'piece', price: 12_500, cost: 10_000, qty: 60, cat: groceries },
    { code: 'TEA500', barcode: '6260000000028', name: ['شاي 500 غرام', 'Tea 500 g', 'چا 500 گرام'], unit: 'piece', price: 6_000, cost: 4_500, qty: 80, cat: groceries },
    { code: 'SUGAR1', barcode: '6260000000035', name: ['سكر 1 كغ', 'Sugar 1 kg', 'شەکر 1 کیلۆ'], unit: 'piece', price: 1_500, cost: 1_100, qty: 120, cat: groceries },
    { code: 'OIL1', barcode: '6260000000042', name: ['زيت 1 لتر', 'Cooking oil 1 L', 'ڕۆن 1 لیتر'], unit: 'piece', price: 3_000, cost: 2_300, qty: 70, cat: groceries },
    { code: 'MILK1', barcode: '6260000000059', name: ['حليب 1 لتر', 'Milk 1 L', 'شیر 1 لیتر'], unit: 'piece', price: 2_000, cost: 1_500, qty: 90, cat: drinks },
    { code: 'WATER6', barcode: '6260000000066', name: ['ماء 6 قناني', 'Water, 6 bottles', 'ئاو، 6 بوتڵ'], unit: 'piece', price: 2_500, cost: 1_800, qty: 100, cat: drinks },
    { code: 'COLA', barcode: '6260000000073', name: ['كولا 330 مل', 'Cola 330 ml', 'کۆلا 330 مل'], unit: 'piece', price: 750, cost: 500, qty: 200, cat: drinks },
    { code: 'TOMATO', barcode: '2100017', name: ['طماطة', 'Tomatoes', 'تەماتە'], unit: 'kg', price: 1_250, cost: 900, qty: 150, cat: produce },
    { code: 'BANANA', barcode: '2100024', name: ['موز', 'Bananas', 'مۆز'], unit: 'kg', price: 2_000, cost: 1_500, qty: 100, cat: produce },
    { code: 'CUCUMBER', barcode: '2100031', name: ['خيار', 'Cucumbers', 'خەیار'], unit: 'kg', price: 1_000, cost: 700, qty: 80, cat: produce }
  ];
  const made = rows.map((r) => ({ r, item: createItem(db, {
    code: r.code, barcode: r.barcode, name: n3(...r.name), unit: r.unit, salePrice: r.price, saleCurrency: 'IQD', categoryId: r.cat, trackExpiry: false
  }, user) }));
  const warehouseId = main(db);
  opening(db, warehouseId, 'الماركت — أول المدة', made.map(({ r, item }) => ({ itemId: item.id, qtyMilli: r.qty * 1000, unitCost: r.cost })));
  updateSettings(db, { posQuickItems: made.filter(({ r }) => r.cat === produce || r.code === 'COLA').map(({ item }) => item.id) }, user);
  const id = (code: string) => made.find(({ r }) => r.code === code)!.item.id;

  // two offers: tea, buy 2 get 1 free; 10% off drinks every evening from 6 to 9 (a happy hour)
  const offer = { priority: 10, exclusive: false, maxPerSale: null, startsOn: null, endsOn: null, weekdays: null, fromTime: null, toTime: null, branchIds: null,
    items: [] as string[], categories: [] as string[], getItems: [] as string[], getCategories: [] as string[], buyMilli: null, getMilli: null, getPercent: null,
    bundleMilli: null, bundlePrice: null, price: null, percentOff: null };
  createOffer(db, { ...offer, code: 'TEA-3FOR2', names: n3('شاي: اشترِ 2 والثالث مجاناً', 'Tea: buy 2, get 1 free', 'چا: 2 بکڕە، یەکێک بەخۆڕایی'), kind: 'buyGet',
    items: [id('TEA500')], buyMilli: 2000, getMilli: 1000, getPercent: 100 }, user);
  createOffer(db, { ...offer, code: 'DRINKS-EVE', names: n3('مشروبات المساء: خصم 10٪', 'Evening drinks: 10% off', 'خواردنەوەی ئێوارە: 10٪ داشکاندن'), kind: 'price',
    categories: [drinks], fromTime: '18:00', toTime: '21:00', percentOff: 10, priority: 5 }, user);

  // two tills, each with its own safe; Till 1 has an open shift with a gift voucher sold on it
  const till1 = createTill(db, { name: 'Till 1', cashAccountCode: '1811', warehouseId, drawer: 'off', customerDisplay: true }, user);
  createTill(db, { name: 'Till 2', cashAccountCode: '1812', warehouseId, drawer: 'off', customerDisplay: false }, user);
  const owner = ownerActor(db, user);
  const shift = openShift(db, { tillId: till1.id, register: till1.name, cashAccountCode: '1811', warehouseId, openingCash: 100_000 }, owner);
  sellGiftVoucher(db, { id: shift.id, cashAccount: '1811' }, { amount: 25_000 }, { id: owner.id, name: owner.name });
}

/** ?gold: a gold shop. Today's board (dinars a gram for 24, 21 and 18 karat) and five pieces in stock, priced from it. */
export function seedGoldDemo(db: Db): void {
  startDemoMonth(db);
  retireSampleItems(db);
  updateSettings(db, { companyName: n3('ميروكسيس للذهب', 'Meroxis Gold', 'زێڕی مێرۆکسیس'), businessTypes: ['goldShop'] }, user);
  db.prepare('UPDATE item_categories SET active = 0').run();
  const owner = ownerActor(db, user);
  const rings = createCategory(db, { name: n3('خواتم', 'Rings', 'ئەنگوستیلە') }, user).id;
  const bracelets = createCategory(db, { name: n3('أساور', 'Bracelets', 'بازن') }, user).id;
  const sets = createCategory(db, { name: n3('أطقم وقلائد', 'Sets and necklaces', 'سێت و ملوانکە') }, user).id;
  setBoard(db, { date: todayIso(), currency: 'IQD', prices: [
    { karat: 24, buyPerGram: 140_000, sellPerGram: 145_000 },
    { karat: 21, buyPerGram: 122_000, sellPerGram: 127_000 },
    { karat: 18, buyPerGram: 104_000, sellPerGram: 109_000 }
  ] }, owner);
  const pieces: { code: string; name: [string, string, string]; cat: string; karat: 18 | 21 | 24; mg: number; making: 'gram' | 'piece'; amount: number; cost: number }[] = [
    { code: 'R21-01', name: ['خاتم عيار 21', 'Ring, 21 karat', 'ئەنگوستیلەی 21 قیرات'], cat: rings, karat: 21, mg: 4_500, making: 'piece', amount: 15_000, cost: 540_000 },
    { code: 'R18-02', name: ['خاتم عيار 18 بفص', 'Ring with a stone, 18 karat', 'ئەنگوستیلەی بەردار، 18 قیرات'], cat: rings, karat: 18, mg: 3_200, making: 'piece', amount: 25_000, cost: 330_000 },
    { code: 'B21-01', name: ['سوار عيار 21', 'Bracelet, 21 karat', 'بازنی 21 قیرات'], cat: bracelets, karat: 21, mg: 12_000, making: 'gram', amount: 8_000, cost: 1_450_000 },
    { code: 'N18-01', name: ['قلادة عيار 18', 'Necklace, 18 karat', 'ملوانکەی 18 قیرات'], cat: sets, karat: 18, mg: 8_000, making: 'gram', amount: 10_000, cost: 840_000 },
    { code: 'G24-05', name: ['ليرة ذهب 24 (5 غرام)', 'Gold coin 24k (5 g)', 'لیرەی زێڕ 24 (5 گرام)'], cat: sets, karat: 24, mg: 5_000, making: 'piece', amount: 5_000, cost: 700_000 }
  ];
  const made = pieces.map((p) => ({ p, item: createItem(db, { code: p.code, name: n3(...p.name), unit: 'piece', salePrice: 0, saleCurrency: 'IQD', categoryId: p.cat }, user) }));
  opening(db, main(db), 'محل الذهب — أول المدة', made.map(({ p, item }) => ({ itemId: item.id, qtyMilli: 1000, unitCost: p.cost })));
  for (const { p, item } of made) setGoldItem(db, item.id, { weightMg: p.mg, karat: p.karat, makingKind: p.making, makingAmount: p.amount }, owner);
}

/** ?wholesale: a distributor. Las is a sales rep with a van loaded from the main warehouse, today's route (Mer, Las and Raz's shops) and an order waiting for the office. */
export function seedWholesaleDemo(db: Db): void {
  startDemoMonth(db);
  retireSampleItems(db);
  updateSettings(db, { companyName: n3('ميروكسيس للتوزيع', 'Meroxis Distribution', 'دابەشکردنی مێرۆکسیس'), businessTypes: ['wholesale'] }, user);
  const owner = ownerActor(db, user);
  const warehouseId = main(db);
  const items = [
    { code: 'W-RICE', name: n3('رز 25 كغ (كيس)', 'Rice 25 kg (sack)', 'برنج 25 کیلۆ (گوونی)'), price: 52_000, cost: 46_000, qty: 200 },
    { code: 'W-OIL', name: n3('زيت 18 لتر (تنكة)', 'Cooking oil 18 L (tin)', 'ڕۆن 18 لیتر (تەنەکە)'), price: 38_000, cost: 33_000, qty: 150 },
    { code: 'W-TEA', name: n3('شاي كارتون 20 علبة', 'Tea, carton of 20', 'چا، کارتۆنی 20 قوتوو'), price: 95_000, cost: 84_000, qty: 80 }
  ].map((r) => ({ r, item: createItem(db, { code: r.code, name: r.name, unit: 'piece', salePrice: r.price, saleCurrency: 'IQD' }, user) }));
  opening(db, warehouseId, 'المخزن — أول المدة', items.map(({ r, item }) => ({ itemId: item.id, qtyMilli: r.qty * 1000, unitCost: r.cost })));
  // the rep: Las, a user of their own (sales), with a van and a cash account under 181
  const repUser = randomUUID();
  db.prepare("INSERT INTO users (id, username, name, password_hash, roles, active, created_at) VALUES (?, 'las', 'Las', NULL, '[\"sales\"]', 1, ?)").run(repUser, new Date().toISOString());
  const van = createWarehouse(db, { code: 'VAN1', name: n3('سيارة لاس', 'Las’s van', 'ئۆتۆمبێلی لاس') }, user);
  createAccount(db, { parentCode: '181', code: '1813', name: n3('نقد المندوب لاس', 'Rep cash, Las', 'نەقدی نوێنەر لاس') }, user);
  const rep = saveRep(db, null, { userId: repUser, name: 'Las', warehouseId: van.id, loadWarehouseId: warehouseId, cashAccount: '1813' }, owner);
  const shops = db.prepare("SELECT id FROM parties WHERE type = 'customer' AND name IN ('Mer', 'Las', 'Raz') ORDER BY name").all() as { id: string }[];
  setRouteDay(db, rep.id, new Date().getDay(), shops.map((s) => s.id), owner);
  moveVan(db, rep.id, { direction: 'load', date: todayIso(), lines: items.map(({ item }) => ({ itemId: item.id, qtyMilli: 10_000 })) }, owner);
  if (shops[0]) createOrder(db, { partyId: shops[0].id, date: todayIso(), repId: rep.id, currency: 'IQD', rateX100: 100,
    lines: [{ itemId: items[0]!.item.id, qtyMilli: 3_000, unitPrice: 52_000 }, { itemId: items[2]!.item.id, qtyMilli: 1_000, unitPrice: 95_000 }] }, owner);
}

/** ?clothing: a clothes shop. Two models in sizes and colours, every variant with its own barcode, some in stock. */
export function seedClothingDemo(db: Db): void {
  startDemoMonth(db);
  retireSampleItems(db);
  updateSettings(db, { companyName: n3('ميروكسيس للأزياء', 'Meroxis Fashion', 'جلوبەرگی مێرۆکسیس'), businessTypes: ['clothingShop'] }, user);
  const owner = ownerActor(db, user);
  const color = (code: string, name: [string, string, string], hex: string) =>
    listColors(db).find((c) => c.code === code)?.id ?? saveColor(db, null, { code, name: n3(...name), hex }, user).id;
  const black = color('BLK', ['أسود', 'Black', 'ڕەش'], '#111111');
  const white = color('WHT', ['أبيض', 'White', 'سپی'], '#f5f5f5');
  const blue = color('BLU', ['أزرق', 'Blue', 'شین'], '#1d4ed8');
  const shirt = createModel(db, { code: 'POLO', name: n3('قميص بولو', 'Polo shirt', 'کراسی پۆلۆ'), sizes: ['S', 'M', 'L', 'XL'], colorIds: [black, white],
    season: '2026', salePrice: 25_000, saleCurrency: 'IQD', purchasePrice: 15_000, purchaseCurrency: 'IQD' }, owner);
  const jeans = createModel(db, { code: 'JEANS', name: n3('بنطلون جينز', 'Jeans', 'پانتۆڵی جینز'), sizes: ['30', '32', '34', '36'], colorIds: [blue],
    season: '2026', salePrice: 35_000, saleCurrency: 'IQD', purchasePrice: 22_000, purchaseCurrency: 'IQD' }, owner);
  const lines = [
    ...shirt.variants.map((v, i) => ({ itemId: v.itemId, qtyMilli: ((i % 4) + 2) * 1000, unitCost: 15_000 })),
    ...jeans.variants.map((v, i) => ({ itemId: v.itemId, qtyMilli: (i + 1) * 1000, unitCost: 22_000 }))
  ];
  opening(db, main(db), 'المحل — أول المدة', lines);
}

/** ?restaurant (2.1): a restaurant. A menu by course and drink, a hall of 10 tables and a family section of 4, and two tables eating. */
export function seedRestaurantDemo(db: Db): void {
  startDemoMonth(db);
  retireSampleItems(db);
  updateSettings(db, { companyName: n3('مطعم ميروكسيس', 'Meroxis Restaurant', 'چێشتخانەی مێرۆکسیس'), businessTypes: ['restaurant'] }, user);
  const owner = ownerActor(db, user);
  db.prepare('UPDATE item_categories SET active = 0').run();
  const grill = createCategory(db, { name: n3('مشويات', 'Grills', 'برژاو') }, user).id;
  const mains = createCategory(db, { name: n3('أطباق رئيسية', 'Main dishes', 'خواردنی سەرەکی') }, user).id;
  const drinks = createCategory(db, { name: n3('مشروبات', 'Drinks', 'خواردنەوە') }, user).id;
  const sweets = createCategory(db, { name: n3('حلويات', 'Desserts', 'شیرینی') }, user).id;
  const dish = (code: string, name: [string, string, string], price: number, categoryId: string) =>
    createItem(db, { code, name: n3(...name), unit: 'piece', salePrice: price, saleCurrency: 'IQD', trackStock: false, categoryId }, user).id;
  const kebab = dish('KEBAB', ['كباب لحم', 'Lamb kebab', 'کەبابی گۆشت'], 12_000, grill);
  const tikka = dish('TIKKA', ['تكة دجاج', 'Chicken tikka', 'تکەی مریشک'], 10_000, grill);
  dish('QUZI', ['قوزي', 'Quzi', 'قوزی'], 18_000, mains);
  dish('DOLMA', ['دولمة', 'Dolma', 'دۆڵمە'], 9_000, mains);
  const tea = dish('TEA', ['شاي', 'Tea', 'چا'], 1_000, drinks);
  dish('DOW', ['لبن', 'Yoghurt drink', 'دۆ'], 1_500, drinks);
  dish('KUNAFA', ['كنافة', 'Kunafa', 'کونافە'], 5_000, sweets);
  const room = quickRoom(db, { tables: 10, family: 4 }, owner);
  const eat = (tableName: string, guests: number, lines: { itemId: string; qtyMilli: number; note?: string }[]) => {
    const table = room.tables.find((t) => t.name === tableName)!;
    const order = openOrder(db, { kind: 'table', tableId: table.id, guests }, owner);
    addLines(db, order.id, lines, owner);
    sendToKitchen(db, order.id, owner);
  };
  eat('3', 4, [{ itemId: kebab, qtyMilli: 2_000, note: 'بدون بصل' }, { itemId: tikka, qtyMilli: 1_000 }, { itemId: tea, qtyMilli: 4_000 }]);
  eat('F2', 6, [{ itemId: kebab, qtyMilli: 3_000 }, { itemId: tea, qtyMilli: 6_000 }]);
}
