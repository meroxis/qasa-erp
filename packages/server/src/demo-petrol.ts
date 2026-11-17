import type { Db } from './db.ts';
import { ownerActor } from './auth.ts';
import { approveEntry, checkEntry, getEntry } from './journal.ts';
import { planStatus } from './license.ts';
import { updateSettings, writeSetting } from './settings.ts';
import { closeShift, createDelivery, createDip, createPump, openShift, saveFuelType, saveTank, type Lang } from './fuel.ts';
import { dipLitres, todayIso, type ChartRow, type FuelShift } from '@qasa/core';

/**
 * The sample company as a petrol station, «محطة ميروكسيس» (the website demo opens it with ?petrol in the address).
 * Three fuels at sample prices, a tank for each with its calibration chart and opening stock, four pumps with two
 * nozzles each drawing from those tanks, closed shifts by Mer, Las and Raz (one a little short, one a little over) that
 * take their litres out of the tanks at cost, two tanker deliveries (one on credit, one paid from the safe), a dip of
 * the benzine tank with a small evaporation loss, and one shift open, ready for its closing readings. Expects seedDemo
 * to have run (its suppliers deliver the fuel).
 */

/** A horizontal cylinder's chart: litres at every 10 cm of a stick, from empty to full (the last row is the capacity). */
export function cylinderChart(diameterCm: number, capacityL: number): ChartRow[] {
  const r = diameterCm / 2;
  const full = Math.PI * r * r;
  const rows: ChartRow[] = [];
  for (let cm = 0; cm <= diameterCm; cm += 10) {
    const area = r * r * Math.acos((r - cm) / r) - (r - cm) * Math.sqrt(Math.max(0, 2 * r * cm - cm * cm));
    rows.push({ mm: cm * 10, milli: Math.round((capacityL * area) / full) * 1000 });
  }
  if (rows[rows.length - 1]!.mm !== diameterCm * 10) rows.push({ mm: diameterCm * 10, milli: capacityL * 1000 });
  return rows;
}

export function seedPetrolStationDemo(db: Db, lang: Lang = 'ar'): void {
  const user = 'Mer';
  // the petrol station's pages are Pro: the sample runs in the month's free trial. The website demo can't seal a trial
  // (no keys in the browser), so the sample writes its start as an unsealed one, which only a non-strict build counts
  if (!planStatus(db).features.includes('petrolStation')) writeSetting(db, 'trial_started', todayIso());
  updateSettings(db, {
    companyName: { ar: 'محطة ميروكسيس', en: 'Meroxis Fuel', ku: 'بەنزینخانەی مێرۆکسیس' },
    businessTypes: ['trade', 'petrolStation']
  }, user);
  const owner = ownerActor(db, user);
  // the checker and the approver take each entry on as usual
  const approve = (id: string | null | undefined) => {
    if (!id || getEntry(db, id).status === 'approved') return;
    checkEntry(db, id, 'Raz');
    approveEntry(db, id, 'Raz');
  };

  const regular = saveFuelType(db, null, { code: 'B-REG', name: { ar: 'بنزين عادي', en: 'Regular benzine', ku: 'بەنزینی ئاسایی' }, price: 850, sort: 1 }, owner);
  const improved = saveFuelType(db, null, { code: 'B-IMP', name: { ar: 'بنزين محسّن', en: 'Improved benzine', ku: 'بەنزینی باشکراو' }, price: 1_000, sort: 2 }, owner);
  const diesel = saveFuelType(db, null, { code: 'GASOIL', name: { ar: 'كاز (ديزل)', en: 'Diesel (gas oil)', ku: 'گازۆیل (دیزڵ)' }, price: 750, sort: 3 }, owner);

  // a tank for each fuel, with the stock in it when the station started using Qasa and what that cost per litre
  const named = (ar: string, en: string, ku: string) => (lang === 'en' ? en : lang === 'ku' ? ku : ar);
  const tank = (code: string, name: string, fuelTypeId: string, capacityL: number, diameterCm: number, openingL: number, cost: number) =>
    saveTank(db, null, {
      code, name, fuelTypeId, capacityMilli: capacityL * 1000, chart: cylinderChart(diameterCm, capacityL),
      openingMilli: openingL * 1000, openingCost: cost, openingDate: '2026-11-14', lang
    }, owner);
  const t1 = tank('T1', named('خزان البنزين العادي', 'Regular benzine tank', 'تانکی بەنزینی ئاسایی'), regular.id, 40_000, 280, 22_000, 780);
  const t2 = tank('T2', named('خزان البنزين المحسّن', 'Improved benzine tank', 'تانکی بەنزینی باشکراو'), improved.id, 30_000, 250, 15_000, 930);
  const t3 = tank('T3', named('خزان الكاز', 'Diesel tank', 'تانکی گازۆیل'), diesel.id, 50_000, 300, 30_000, 690);
  for (const t of [t1, t2, t3]) approve((db.prepare('SELECT opening_entry_id FROM fuel_tanks WHERE id = ?').get(t.id) as { opening_entry_id: string | null }).opening_entry_id);

  // four pumps, two nozzles each, with the meters as they stood when the station started using Qasa
  const tankOf = new Map([[regular.id, t1.id], [improved.id, t2.id], [diesel.id, t3.id]]);
  const layout: [string, string][] = [[regular.id, improved.id], [regular.id, improved.id], [regular.id, diesel.id], [diesel.id, diesel.id]];
  const start = [482_310_500, 377_904_250, 512_118_000, 296_457_750, 641_002_000, 158_330_500, 233_871_250, 309_515_000];
  const pumps = layout.map(([a, b], i) => createPump(db, {
    number: i + 1,
    nozzles: [{ number: 1, tankId: tankOf.get(a)!, meterMilli: start[i * 2]! }, { number: 2, tankId: tankOf.get(b)!, meterMilli: start[i * 2 + 1]! }]
  }, owner));
  const allPumps = pumps.map((p) => p.id);

  const shift = (s: { date: string; shift: FuelShift; who: string; litres: number[]; credit: number; diff: number }) => {
    const open = openShift(db, { date: s.date, shift: s.shift, attendant: s.who, pumpIds: allPumps }, owner);
    const readings = open.readings.map((r, i) => ({ nozzleId: r.nozzleId, closingMilli: r.openingMilli + Math.round(s.litres[i]! * 1000) }));
    const sales = open.readings.reduce((sum, r, i) => sum + Math.floor((Math.round(s.litres[i]! * 1000) * r.price + 500) / 1000), 0);
    approve(closeShift(db, open.id, { readings, credit: s.credit, handed: sales - s.credit + s.diff, lang }, owner).entry?.id);
  };
  const suppliers = (db.prepare("SELECT id FROM parties WHERE type = 'supplier' AND active = 1 ORDER BY code").all() as { id: string }[]).map((p) => p.id);

  // litres sold per nozzle in each closed shift (whole and part litres, as a meter shows them)
  shift({ date: '2026-11-15', shift: 'morning', who: 'Mer', litres: [612.4, 288.75, 540.1, 301.2, 498.6, 702.35, 655.0, 588.9], credit: 0, diff: 0 });
  shift({ date: '2026-11-15', shift: 'evening', who: 'Las', litres: [702.8, 344.1, 610.25, 280.6, 455.3, 820.4, 590.75, 640.2], credit: 75_000, diff: 0 });
  // the tankers of the 16th: benzine on credit from one supplier, diesel paid from the safe to the other
  if (suppliers.length) {
    const [first, second = first] = suppliers as [string, string?];
    approve(createDelivery(db, { date: '2026-11-16', tankId: t1.id, supplierId: first, noteNo: 'WS-48213', qtyMilli: 12_000_000, costPerLitre: 790, payment: 'credit', lang }, owner).entry?.id);
    approve(createDelivery(db, { date: '2026-11-16', tankId: t3.id, supplierId: second!, noteNo: 'WS-48230', qtyMilli: 10_000_000, costPerLitre: 700, payment: 'cash', lang }, owner).entry?.id);
  }
  shift({ date: '2026-11-16', shift: 'morning', who: 'Raz', litres: [580.35, 260.0, 515.6, 330.45, 470.2, 690.8, 610.4, 575.25], credit: 0, diff: -7_500 });
  shift({ date: '2026-11-16', shift: 'evening', who: 'Mer', litres: [690.2, 310.5, 600.9, 295.3, 510.75, 760.1, 625.6, 600.0], credit: 0, diff: 2_000 });
  shift({ date: '2026-11-17', shift: 'morning', who: 'Las', litres: [598.6, 275.25, 552.4, 318.8, 482.0, 715.65, 640.3, 590.45], credit: 50_000, diff: 0 });

  // between the shifts, the benzine tank is dipped: the stick reads a little under the book (about 0.3%, evaporation)
  const book = Number((db.prepare('SELECT SUM(qty_milli) AS qty FROM fuel_moves WHERE tank_id = ?').get(t1.id) as { qty: number }).qty);
  const chart = t1.chart!;
  let mm = chart[0]!.mm;
  for (let at = chart[0]!.mm; at <= chart[chart.length - 1]!.mm; at++) {
    if ((dipLitres(chart, at) ?? 0) <= book * 0.997) mm = at;
  }
  approve(createDip(db, { date: '2026-11-17', tankId: t1.id, dipMm: mm, lang }, owner).entry?.id);

  // the evening shift of today: open, its opening readings taken from the morning's closing
  openShift(db, { date: '2026-11-17', shift: 'evening', attendant: 'Raz', pumpIds: allPumps }, owner);
}
