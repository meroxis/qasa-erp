import { describe, expect, it } from 'vitest';
import { BUSINESS_TYPES, LANGS, type Names } from '@qasa/core';
import { sampleLines, sampleModel, type SampleItem } from './print-model.ts';

// 1.4.1: the print designer's sample paper was a car-parts invoice ("Toyota oil filter") for every company. It now shows
// a few of the company's own items, else a neutral sample of its kind of business, in the language being previewed.
const lineName = (n: Names | string) => (typeof n === 'string' ? n : `${n.ar} ${n.en} ${n.ku}`);

describe('the print designer\'s sample paper', () => {
  it('names no brand and no car part unless the company sells car parts', () => {
    for (const type of BUSINESS_TYPES) {
      for (const lang of LANGS) {
        const model = sampleModel('sale', lang, { businessTypes: [type] });
        const text = model.lines.map((l) => lineName(l.name)).join(' ') + ' ' + model.party!.name;
        expect(text, `${type} ${lang}`).not.toMatch(/Toyota|تويوتا|تۆیۆتا/);
        if (type !== 'autoParts') expect(text, `${type} ${lang}`).not.toMatch(/oil filter|Engine oil|فلتر زيت|كراج|Garage|گەراج/i);
      }
    }
    // a company that chose no business yet gets the general trade sample
    expect(sampleModel('sale', 'en').lines.map((l) => (l.name as Names).en)).toEqual(['Extension cord, 5 m', 'Electric kettle, 1.7 L', 'Delivery']);
  });

  it('matches the sample to the company\'s first business other than general trade', () => {
    const en = (types: Parameters<typeof sampleLines>[0]) => sampleLines(types).map((l) => (l.name as Names).en);
    expect(en({ businessTypes: ['trade', 'pharmacy'] })[0]).toBe('Paracetamol 500 mg, 20 tablets');
    expect(en({ businessTypes: ['autoParts'] })[0]).toBe('Oil filter');
    expect(en({ businessTypes: ['electricalSolar'] })[0]).toBe('Solar panel, 550 W');
    expect(en({ businessTypes: ['market'] })[0]).toBe('Rice, 5 kg');
    expect(en({ businessTypes: ['trade'] })[0]).toBe('Extension cord, 5 m');
    // the car parts sample keeps its garage and parts supplier; the others a store and a supplies company
    expect(sampleModel('sale', 'en', { businessTypes: ['autoParts'] }).party!.name).toBe('Al-Jisr Garage');
    expect(sampleModel('purchase', 'en', { businessTypes: ['autoParts'] }).party!.name).toBe('Modern Spare Parts Co.');
    expect(sampleModel('sale', 'en', { businessTypes: ['pharmacy'] }).party!.name).toBe('Al-Jisr Store');
  });

  it('writes the party in the language being previewed', () => {
    expect(sampleModel('sale', 'ar').party).toMatchObject({ name: 'متجر الجسر', address: 'أربيل، شارع 60' });
    expect(sampleModel('sale', 'en').party).toMatchObject({ name: 'Al-Jisr Store', address: 'Erbil, 60 Street' });
    expect(sampleModel('sale', 'ku').party).toMatchObject({ name: 'فرۆشگای پرد', address: 'هەولێر، شەقامی 60' });
    expect(sampleModel('voucher', 'en').party!.name).toBe('Al-Jisr Store');
    for (const type of BUSINESS_TYPES) {
      for (const line of sampleLines({ businessTypes: [type] })) expect(/[ىيك]/.test((line.name as Names).ku), `${type} ${(line.name as Names).ku}`).toBe(false);
    }
  });

  it('shows up to three of the company\'s own active items priced in dinars when it has some', () => {
    const item = (id: string, en: string, salePrice: number, extra: Partial<SampleItem> = {}): SampleItem => ({
      id, code: id.toUpperCase(), barcode: '', name: { ar: en, en, ku: en }, unit: 'piece', salePrice, saleCurrency: 'IQD', active: true, ...extra
    });
    const items = [
      item('a1', 'Notebook', 2_500), item('a2', 'Old stock', 9_000, { active: false }), item('a3', 'Imported pen', 300, { saleCurrency: 'USD' }),
      item('a4', 'Free sample', 0), item('a5', 'Stapler', 6_000), item('a6', 'Ink, 1 L', 12_000, { unit: 'l' }), item('a7', 'Folder', 1_000)
    ];
    const model = sampleModel('sale', 'en', { items, businessTypes: ['autoParts'] });
    expect(model.lines.map((l) => (l.name as Names).en)).toEqual(['Notebook', 'Stapler', 'Ink, 1 L']);
    expect(model.lines.map((l) => [l.itemId, l.code, l.barcode, l.unit, l.qtyMilli, l.unitPrice, l.amount])).toEqual([
      ['a1', 'A1', null, 'piece', 2000, 2_500, 5_000], ['a5', 'A5', null, 'piece', 1000, 6_000, 6_000], ['a6', 'A6', null, 'l', 3000, 12_000, 36_000]
    ]);
    // with its own items the company's parties are the neutral ones, whatever its business
    expect(model.party!.name).toBe('Al-Jisr Store');
    // none usable: the sample of its business
    expect(sampleLines({ items: [items[1]!, items[2]!], businessTypes: ['generators'] })[0]!.code).toBe('G-5A');
  });

  it('adds up on every sample: lines, discount, total and the balances', () => {
    for (const type of BUSINESS_TYPES) {
      const m = sampleModel('sale', 'en', { businessTypes: [type] });
      expect(m.subtotal, type).toBe(m.lines.reduce((s, l) => s + l.amount, 0));
      for (const l of m.lines) expect(l.amount, type).toBe(Math.round((l.unitPrice * l.qtyMilli) / 1000));
      expect(m.total, type).toBe(m.subtotal - m.discount);
      expect(m.discount, type).toBeGreaterThan(0);
      expect(m.baseTotal, type).toBe(m.total);
      expect(m.partyBalance, type).toBe(m.previousBalance! + m.total);
    }
    // the papers the tests print keep their figures
    const general = sampleModel('sale');
    expect([general.subtotal, general.discount, general.total, general.partyBalance]).toEqual([150_000, 5_000, 145_000, 395_000]);
  });
});
