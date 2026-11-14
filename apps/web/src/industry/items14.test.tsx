import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUSINESS_TYPES, BUSINESS_UNITS, BUSINESS_STARTER_TRADE, UNIT_CODES, unitsForBusiness } from '@qasa/core';
import { isKey } from '../i18n.ts';
import { ITEMS14_TEXT } from '../i18n/items14.ts';
import { itemMargin } from '../pages/Items.tsx';
import { parseScan } from '../pages/pos-logic.ts';
import { namesDiffer, sameName, shownLang, withOneName } from './names.ts';
import { findByScaleBarcode, parseScaleBarcode } from './scale-barcode.ts';

describe('one name', () => {
  it('writes the text typed to all three languages', () => {
    expect(withOneName({ ar: '', en: '', ku: '' }, 'Cola 330 ml', null)).toEqual({ ar: 'Cola 330 ml', en: 'Cola 330 ml', ku: 'Cola 330 ml' });
    expect(sameName('شاي')).toEqual({ ar: 'شاي', en: 'شاي', ku: 'شاي' });
  });

  it('knows a record that keeps a text per language, and changes only the one shown', () => {
    const tea = { ar: 'شاي', en: 'Tea', ku: 'چا' };
    expect(namesDiffer(tea)).toBe(true);
    expect(namesDiffer({ ar: 'شاي', en: '', ku: ' ' })).toBe(false);
    expect(namesDiffer(sameName('Tea'))).toBe(false);
    expect(shownLang(tea, 'ku')).toBe('ku');
    expect(shownLang({ ar: 'شاي', en: '', ku: '' }, 'en')).toBe('ar');
    expect(withOneName(tea, 'Black tea', 'en')).toEqual({ ar: 'شاي', en: 'Black tea', ku: 'چا' });
  });
});

describe('units by business type', () => {
  it('offers a pharmacy its units, a market its own, and every unit to general trade', () => {
    expect(unitsForBusiness(['pharmacy']).units.slice(0, 4)).toEqual(['tablet', 'capsule', 'strip', 'box']);
    expect(unitsForBusiness(['pharmacy']).narrowed).toBe(true);
    expect(unitsForBusiness(['market']).units).toEqual(expect.arrayContaining(['piece', 'kg', 'carton', 'pack']));
    expect(unitsForBusiness(['market']).units).not.toContain('tablet');
    expect(unitsForBusiness(['engineeringWorks']).units).toEqual(expect.arrayContaining(['ton', 'm', 'm2', 'bag']));
    for (const types of [['trade'], [], null, undefined] as const) {
      expect(unitsForBusiness(types)).toEqual({ units: [...UNIT_CODES], narrowed: false });
    }
  });

  it('general trade beside another type adds nothing; two types give both lists once', () => {
    expect(unitsForBusiness(['trade', 'pharmacy']).units).toEqual(unitsForBusiness(['pharmacy']).units);
    const both = unitsForBusiness(['market', 'pharmacy']).units;
    expect(new Set(both).size).toBe(both.length);
    expect(both).toEqual(expect.arrayContaining(['kg', 'tablet']));
  });

  it('always keeps a unit the company uses already, and shows all when asked', () => {
    const offer = unitsForBusiness(['pharmacy'], ['ton', 'tablet', 'nonsense']);
    expect(offer.units).toContain('ton');
    expect(offer.units).not.toContain('nonsense');
    expect(offer.units.filter((u) => u === 'tablet')).toHaveLength(1);
    expect(unitsForBusiness(null, ['ton']).units).toEqual([...UNIT_CODES]);
  });

  it('every list holds real units, once each', () => {
    for (const type of BUSINESS_TYPES) {
      const list = BUSINESS_UNITS[type];
      if (!list) continue;
      expect(new Set(list).size, type).toBe(list.length);
      for (const u of list) expect(UNIT_CODES, type).toContain(u);
    }
  });
});

describe('the market', () => {
  it('is a business type with its name in three languages and the grocery starter list', () => {
    expect(BUSINESS_TYPES).toContain('market');
    expect(BUSINESS_STARTER_TRADE.market).toBe('grocery');
    expect(isKey('bt_market') && isKey('bt_marketText')).toBe(true);
    expect(readFileSync(new URL('../pages/BusinessType.tsx', import.meta.url), 'utf8')).toContain("market: { icon: 'receipt', title: 'bt_market', text: 'bt_marketText' }");
  });

  // 21 00017 01250 + check digit 3
  const LABEL = '2100017012503';
  const tomato = { code: 'I-0001', barcode: '2100017', unit: 'kg' as const, units: [] };
  const cola = { code: 'I-0002', barcode: '6260001000003', unit: 'piece' as const, units: [] };

  it('reads a scale label: the item by its first seven digits, the weight in grams', () => {
    expect(parseScaleBarcode(LABEL)).toEqual({ prefix: '2100017', grams: 1250 });
    // a wrong check digit, a code that does not start with 2, a zero weight, anything not 13 digits
    expect(parseScaleBarcode('2100017012507')).toBeNull();
    expect(parseScaleBarcode('6260001000003')).toBeNull();
    expect(parseScaleBarcode('2100017000005')).toBeNull();
    expect(parseScaleBarcode('21000170125')).toBeNull();
    expect(parseScaleBarcode('21000170125o6')).toBeNull();
    expect(findByScaleBarcode(LABEL, [cola, tomato])).toEqual({ item: tomato, qtyMilli: 1250 });
    expect(findByScaleBarcode(LABEL, [{ ...tomato, unit: 'g' as const }])?.qtyMilli).toBe(1_250_000);
    // an item counted in pieces is never weighed
    expect(findByScaleBarcode(LABEL, [{ ...tomato, unit: 'piece' as const }])).toBeNull();
  });

  it('the till sells the weight on the label, and an item whose barcode is the whole label wins', () => {
    expect(parseScan(LABEL, [cola, tomato])).toEqual({ code: LABEL, qtyMilli: 1250, exact: tomato, unit: null });
    const whole = { code: 'I-0003', barcode: LABEL, unit: 'piece' as const, units: [] };
    expect(parseScan(LABEL, [tomato, whole])).toEqual({ code: LABEL, qtyMilli: 1000, exact: whole, unit: null });
    expect(parseScan('6260001000003', [cola, tomato])).toMatchObject({ exact: cola, qtyMilli: 1000 });
    expect(parseScan('2100099012507', [cola, tomato]).exact).toBeUndefined();
  });
});

describe('the item form', () => {
  it('works out the profit on one unit, in the sale currency', () => {
    expect(itemMargin(400, 'IQD', 500, 'IQD', 142_000)).toEqual({ amount: 100, percent: 25 });
    expect(itemMargin(500, 'IQD', 400, 'IQD', 142_000)).toEqual({ amount: -100, percent: -20 });
    // bought for $1.00 at 1,420 dinars a dollar, sold for 2,000 dinars
    expect(itemMargin(100, 'USD', 2_000, 'IQD', 142_000)).toEqual({ amount: 580, percent: 40.8 });
    // bought for 1,420 dinars, sold for $1.50
    expect(itemMargin(1_420, 'IQD', 150, 'USD', 142_000)).toEqual({ amount: 50, percent: 50 });
    expect(itemMargin(100, 'USD', 2_000, 'IQD', undefined)).toBeNull();
    expect(itemMargin(null, 'IQD', 500, 'IQD', 142_000)).toBeNull();
    expect(itemMargin(0, 'IQD', 500, 'IQD', 142_000)).toBeNull();
  });

  const form = readFileSync(new URL('../pages/Items.tsx', import.meta.url), 'utf8');
  const itemForm = form.slice(form.indexOf('export function ItemForm'), form.indexOf('function Categories'));

  it('asks for one name, not three, for an item, a category and a warehouse', () => {
    expect(itemForm).toContain("<NameField label={t('it_name')}");
    expect(form.match(/<NameField /g)).toHaveLength(3);
    for (const key of ['nameAr', 'nameKu', 'nameEn']) expect(form).not.toContain(`t('${key}')`);
  });

  it('shows the chosen unit in a full-width field and says what was added, not in a squeezed table', () => {
    const units = itemForm.slice(itemForm.indexOf("t('un_other')"), itemForm.indexOf("t('un_saleUnit')"));
    expect(units).not.toContain('<table');
    expect(units).toContain("t('un_equals'");
    expect(units).toContain("t('un_choose')");
    // a unit half written stops the save instead of being dropped
    expect(itemForm).toContain('setUnitsProblem(true); return;');
  });

  it('has the purchase price before the sale price, and a picture for a new item', () => {
    expect(itemForm.indexOf("t('it_purchasePrice')")).toBeGreaterThan(0);
    expect(itemForm.indexOf("<span>{t('it_purchasePrice')}</span>")).toBeLessThan(itemForm.indexOf("<span>{t('salePrice')}</span>"));
    expect(itemForm).toContain('<NewItemPicture value={picture} onChange={setPicture} />');
    expect(itemForm).toContain('await saveItemPicture(saved.id, picture.data)');
  });

  it('has every new text in Arabic, English and Kurdish', () => {
    for (const [key, text] of Object.entries(ITEMS14_TEXT)) {
      expect(text, key).toHaveLength(3);
      for (const one of text) expect(one.trim().length, key).toBeGreaterThan(0);
    }
  });
});
