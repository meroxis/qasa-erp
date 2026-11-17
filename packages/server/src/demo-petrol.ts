import type { Db } from './db.ts';
import { ownerActor } from './auth.ts';
import { approveEntry, checkEntry } from './journal.ts';
import { planStatus } from './license.ts';
import { updateSettings, writeSetting } from './settings.ts';
import { closeShift, createPump, openShift, saveFuelType, type Lang } from './fuel.ts';
import { todayIso, type FuelShift } from '@qasa/core';

/**
 * Prototype (petrol station), for screenshots only: the sample company as a petrol station, «محطة ميروكسيس». Three
 * fuels at sample prices, four pumps with two nozzles each, a few closed shifts by Mer, Las and Raz (one of them a
 * little short, one a little over) and one shift open, ready for its closing readings. Expects seedDemo to have run.
 * The website demo opens it with ?petrol in the address.
 */
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

  const regular = saveFuelType(db, null, { code: 'B-REG', name: { ar: 'بنزين عادي', en: 'Regular benzine', ku: 'بەنزینی ئاسایی' }, price: 850, sort: 1 }, owner);
  const improved = saveFuelType(db, null, { code: 'B-IMP', name: { ar: 'بنزين محسّن', en: 'Improved benzine', ku: 'بەنزینی باشکراو' }, price: 1_000, sort: 2 }, owner);
  const diesel = saveFuelType(db, null, { code: 'GASOIL', name: { ar: 'كاز (ديزل)', en: 'Diesel (gas oil)', ku: 'گازۆیل (دیزڵ)' }, price: 750, sort: 3 }, owner);

  // four pumps, two nozzles each, with the meters as they stood when the station started using Qasa
  const layout: [string, string][] = [[regular.id, improved.id], [regular.id, improved.id], [regular.id, diesel.id], [diesel.id, diesel.id]];
  const start = [482_310_500, 377_904_250, 512_118_000, 296_457_750, 641_002_000, 158_330_500, 233_871_250, 309_515_000];
  const pumps = layout.map(([a, b], i) => createPump(db, {
    number: i + 1,
    nozzles: [{ number: 1, fuelTypeId: a, meterMilli: start[i * 2]! }, { number: 2, fuelTypeId: b, meterMilli: start[i * 2 + 1]! }]
  }, owner));
  const allPumps = pumps.map((p) => p.id);

  // litres sold per nozzle in each closed shift (whole and part litres, as a meter shows them)
  const shifts: { date: string; shift: FuelShift; who: string; litres: number[]; credit: number; diff: number }[] = [
    { date: '2026-11-15', shift: 'morning', who: 'Mer', litres: [612.4, 288.75, 540.1, 301.2, 498.6, 702.35, 655.0, 588.9], credit: 0, diff: 0 },
    { date: '2026-11-15', shift: 'evening', who: 'Las', litres: [702.8, 344.1, 610.25, 280.6, 455.3, 820.4, 590.75, 640.2], credit: 75_000, diff: 0 },
    { date: '2026-11-16', shift: 'morning', who: 'Raz', litres: [580.35, 260.0, 515.6, 330.45, 470.2, 690.8, 610.4, 575.25], credit: 0, diff: -7_500 },
    { date: '2026-11-16', shift: 'evening', who: 'Mer', litres: [690.2, 310.5, 600.9, 295.3, 510.75, 760.1, 625.6, 600.0], credit: 0, diff: 2_000 },
    { date: '2026-11-17', shift: 'morning', who: 'Las', litres: [598.6, 275.25, 552.4, 318.8, 482.0, 715.65, 640.3, 590.45], credit: 50_000, diff: 0 }
  ];
  for (const s of shifts) {
    const open = openShift(db, { date: s.date, shift: s.shift, attendant: s.who, pumpIds: allPumps }, owner);
    const readings = open.readings.map((r, i) => ({ nozzleId: r.nozzleId, closingMilli: r.openingMilli + Math.round(s.litres[i]! * 1000) }));
    const sales = open.readings.reduce((sum, r, i) => sum + Math.floor((Math.round(s.litres[i]! * 1000) * r.price + 500) / 1000), 0);
    const closed = closeShift(db, open.id, { readings, credit: s.credit, handed: sales - s.credit + s.diff, lang }, owner);
    // the checker and the approver take the shift's entry on as usual
    if (closed.entry && closed.entry.status !== 'approved') {
      checkEntry(db, closed.entry.id, 'Raz');
      approveEntry(db, closed.entry.id, 'Raz');
    }
  }
  // the evening shift of today: open, its opening readings taken from the morning's closing
  openShift(db, { date: '2026-11-17', shift: 'evening', attendant: 'Raz', pumpIds: allPumps }, owner);
}
