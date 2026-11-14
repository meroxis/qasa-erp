import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Lang } from '@qasa/core';
import { ApiError, type ItemDetail, type ItemView, type Permission } from '../api.ts';
import { DataContext } from '../components.tsx';
import { I18nContext, makeI18n, type Key } from '../i18n.ts';
import { ItemPicker, QuickItemForm, withAdded } from './QuickItemForm.tsx';
import { addRowKind, itemKey, mayAddItem, QUICK_ITEM_TIMEOUT_MS, quickAddItem, quickItemInput, quickItemStart } from './item-quick-add.ts';
import { correctionDiff, correctionProblem, REASON_WAY, StockCorrection, suggestedCost } from './StockCorrection.tsx';

// 1.4.2: an item added from inside an item picker (invoices, quotations, orders, the till), and an item's stock
// corrected from its page, in Arabic, English and Kurdish.

const LANGS: Lang[] = ['ar', 'en', 'ku'];
const i18nOf = (lang: Lang) => makeI18n(lang, 'western', () => {}, () => {});
const textOf = (lang: Lang, key: Key, vars?: Record<string, string>) => i18nOf(lang).t(key, vars);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const wrap = (node: ReactNode, lang: Lang, data: { permissions?: Permission[]; seesCost?: boolean } = {}) => renderToStaticMarkup(
  <I18nContext.Provider value={i18nOf(lang)}>
    <DataContext.Provider value={{ settings: null, ...data } as never}>{node}</DataContext.Provider>
  </I18nContext.Provider>
);

const item = (over: Partial<ItemDetail> = {}): ItemDetail => ({
  id: 'i1', code: 'I-0001', barcode: '', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 2_000, saleCurrency: 'IQD',
  trackStock: true, active: true, qtyMilli: 20_000, value: 30_000, hasMoves: true, units: [], saleUnit: null, purchaseUnit: null, updatedAt: null,
  trackBatches: false, trackExpiry: false, categoryId: null, brandId: null, reorderMilli: null, purchasePrice: 1_400, purchaseCurrency: 'IQD',
  stock: [{ warehouseId: 'w1', warehouseCode: 'MAIN', warehouseName: { ar: 'الرئيسي', en: 'Main', ku: 'سەرەکی' }, qtyMilli: 20_000, value: 30_000 }],
  moves: [], ...over
});

describe('adding an item from an item picker', () => {
  it('is offered to whoever may add items on the Items page (stock), not to a cashier or a buyer alone', () => {
    expect(mayAddItem(['stock'])).toBe(true);
    expect(mayAddItem(['admin'])).toBe(true);
    expect(mayAddItem(['sales'])).toBe(false);
    expect(mayAddItem(['purchases'])).toBe(false);
    expect(mayAddItem(['sales', 'purchases'])).toBe(false);
    expect(mayAddItem(undefined)).toBe(false);
  });

  it('starts from a typed name, or from a scanned barcode (Arabic digits too) with the name still to write', () => {
    expect(quickItemStart('  Mango   juice ')).toMatchObject({ name: 'Mango juice', barcode: '', unit: 'piece' });
    expect(quickItemStart('6260000000123')).toMatchObject({ name: '', barcode: '6260000000123' });
    expect(quickItemStart('٦٢٦٠١٢٣٤')).toMatchObject({ name: '', barcode: '62601234' });
    // a short number is a name ("555"), and so is anything with a letter
    expect(quickItemStart('555')).toMatchObject({ name: '555', barcode: '' });
    expect(quickItemStart('7UP', 'kg')).toMatchObject({ name: '7UP', unit: 'kg' });
    expect(addRowKind('6260000000123')).toBe('barcode');
    expect(addRowKind('Mango')).toBe('name');
    expect(addRowKind('  ')).toBe('empty');
  });

  it('sends one name for every language, the prices in the currency picked, and the purchase price only from whoever sees cost', () => {
    const fields = { ...quickItemStart('Tomatoes', 'kg'), salePrice: 1_250, purchasePrice: 900, categoryId: 'c1' };
    const sent = quickItemInput(fields, true);
    expect(sent).toEqual({ ok: true, input: {
      name: { ar: 'Tomatoes', en: 'Tomatoes', ku: 'Tomatoes' }, unit: 'kg', salePrice: 1_250, saleCurrency: 'IQD', purchasePrice: 900, purchaseCurrency: 'IQD', categoryId: 'c1'
    } });
    const cashier = quickItemInput(fields, false);
    expect(cashier.ok && 'purchasePrice' in cashier.input).toBe(false);
    expect(quickItemInput({ ...fields, name: '  ' }, true)).toEqual({ ok: false, field: 'name', code: 'name_required' });
    expect(quickItemInput({ ...fields, salePrice: null }, true)).toEqual({ ok: false, field: 'salePrice', code: 'price_required' });
    expect(quickItemInput({ ...fields, barcode: '١٢٣٤٥' }, true)).toMatchObject({ ok: true, input: { barcode: '12345' } });
  });

  it('sends with a key and a time limit, and the same key again after a lost answer, so the item is made once', async () => {
    const input = quickItemInput({ ...quickItemStart('Tea'), salePrice: 2_000 }, true);
    if (!input.ok) throw new Error('input');
    const create = vi.fn().mockRejectedValueOnce(new ApiError(0, 'network', null)).mockResolvedValueOnce({ id: 'i9' } as ItemView);
    const first = await quickAddItem(input.input, null, create, () => 'k1');
    expect(first).toEqual({ status: 'offline', key: { key: 'k1', of: JSON.stringify(input.input) } });
    const again = await quickAddItem(input.input, first.status === 'offline' ? first.key : null, create, () => 'k2');
    expect(again).toEqual({ status: 'added', item: { id: 'i9' } });
    expect(create.mock.calls.map((c) => c[1])).toEqual([{ key: 'k1', timeoutMs: QUICK_ITEM_TIMEOUT_MS }, { key: 'k1', timeoutMs: QUICK_ITEM_TIMEOUT_MS }]);
    // anything changed: a new key
    expect(itemKey({ key: 'k1', of: 'x' }, input.input, () => 'k3').key).toBe('k3');
    // a refusal by the server is thrown as it is
    await expect(quickAddItem(input.input, null, () => Promise.reject(new ApiError(409, 'barcode_exists', null)))).rejects.toMatchObject({ code: 'barcode_exists' });
    expect(withAdded([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('shows the "+" in the item box to a stock keeper only, named in each language', () => {
    for (const lang of LANGS) {
      const picker = <ItemPicker value="" options={[]} onChange={() => {}} onCreated={() => {}} placeholder="…" />;
      const allowed = wrap(picker, lang, { permissions: ['stock'] });
      expect(allowed).toContain('class="combo-add"');
      expect(allowed).toContain(`aria-label="${esc(textOf(lang, 'iq_addItem'))}"`);
      for (const others of [['sales'], ['purchases'], []] as Permission[][]) expect(wrap(picker, lang, { permissions: others })).not.toContain('combo-add');
    }
  });

  it('names the add row by what was typed or scanned, in each language', () => {
    for (const lang of LANGS) {
      expect(textOf(lang, 'iq_addNamed', { name: 'Mango' })).toContain('Mango');
      expect(textOf(lang, 'iq_addBarcode', { code: '6260000000123' })).toContain('6260000000123');
    }
    expect(textOf('en', 'iq_addNamed', { name: 'Mango' })).toBe('Add “Mango” as a new item');
    expect(textOf('ku', 'iq_addNamed', { name: 'Mango' })).toBe('«Mango» وەک کاڵای نوێ زیاد بکە');
  });

  it('draws the small form in each language: the name or barcode it starts with, the unit, the prices, the stock note on a sale', () => {
    for (const lang of LANGS) {
      const byName = wrap(<QuickItemForm typed="Mango juice" sale onDone={() => {}} onClose={() => {}} />, lang, { permissions: ['stock'], seesCost: true });
      expect(byName).toContain(esc(textOf(lang, 'iq_title')));
      expect(byName).toContain('value="Mango juice"');
      for (const key of ['it_name', 'barcode', 'unit', 'salePrice', 'it_purchasePrice', 'iq_noStockYet', 'iq_later', 'qa_add'] as Key[]) expect(byName, key).toContain(esc(textOf(lang, key)));
      expect(byName).toContain('<option value="piece" selected="">');
      const scanned = wrap(<QuickItemForm typed="6260000000123" onDone={() => {}} onClose={() => {}} />, lang, { permissions: ['stock'], seesCost: false });
      expect(scanned).toContain('value="6260000000123"');
      // no purchase price for someone who sees no cost, and no stock note outside a sale
      expect(scanned).not.toContain(esc(textOf(lang, 'it_purchasePrice')));
      expect(scanned).not.toContain(esc(textOf(lang, 'iq_noStockYet')));
    }
  });
});

describe("correcting an item's stock", () => {
  it('works out the difference from the books and what was typed', () => {
    expect(correctionDiff('set', 'in', 25_000, 20_000)).toBe(5_000);
    expect(correctionDiff('set', 'out', 18_000, 20_000)).toBe(-2_000);
    expect(correctionDiff('change', 'in', 3_000, 20_000)).toBe(3_000);
    expect(correctionDiff('change', 'out', 3_000, 20_000)).toBe(-3_000);
    expect(correctionDiff('set', 'in', null, 20_000)).toBeNull();
  });

  it('refuses what the server refuses, before sending', () => {
    expect(REASON_WAY).toEqual({ purchase_missing: 'in', found: 'both', damaged: 'out', lost: 'out', opening: 'in', other: 'both' });
    expect(correctionProblem('found', 0, '', null)).toBe('err_correction_no_change');
    expect(correctionProblem('damaged', 1_000, '', null)).toBe('err_correction_out_only_reason');
    expect(correctionProblem('opening', -1_000, '', 5)).toBe('err_correction_in_only_reason');
    expect(correctionProblem('other', 1_000, ' ', null)).toBe('err_note_required_note');
    expect(correctionProblem('purchase_missing', 1_000, '', null)).toBe('err_line_price_invalid_unitCost');
    expect(correctionProblem('found', 1_000, '', null)).toBeNull();
    expect(correctionProblem('lost', -1_000, '', null)).toBeNull();
  });

  it('suggests the average cost while there is stock, else the purchase price (a dollar price at the company rate)', () => {
    expect(suggestedCost(item(), 142_000)).toBe(1_500);
    expect(suggestedCost(item({ qtyMilli: 0, value: 0 }), 142_000)).toBe(1_400);
    expect(suggestedCost(item({ qtyMilli: 0, value: 0, purchasePrice: 250, purchaseCurrency: 'USD' }), 142_000)).toBe(3_550);
    expect(suggestedCost(item({ qtyMilli: 0, value: 0, purchasePrice: null }), 142_000)).toBeNull();
  });

  it('draws the dialog in each language with every reason and what each does in the books', () => {
    for (const lang of LANGS) {
      for (const reason of ['purchase_missing', 'found', 'damaged', 'lost', 'opening', 'other'] as const) {
        const html = wrap(<StockCorrection item={item()} initialReason={reason} onClose={() => {}} onDone={() => {}} />, lang, { permissions: ['stock'], seesCost: true });
        expect(html).toContain(esc(textOf(lang, 'sc_title')));
        expect(html).toContain(esc(textOf(lang, 'sc_onBooks')));
        expect(html).toContain('<strong>20</strong>');
        for (const r of ['purchase_missing', 'found', 'damaged', 'lost', 'opening', 'other'] as const) expect(html).toContain(esc(textOf(lang, `sc_r_${r}`)));
        expect(html, reason).toContain(esc(textOf(lang, `sc_x_${reason}`)));
        expect(html).toContain(`<option value="${reason}" selected="">`);
      }
      // the supplier of a purchase not entered is for someone who enters purchases; the others are told why not
      const buyer = wrap(<StockCorrection item={item()} initialReason="purchase_missing" onClose={() => {}} onDone={() => {}} />, lang, { permissions: ['stock', 'purchases'] });
      expect(buyer).toContain(esc(textOf(lang, 'sc_supplier')));
      const keeper = wrap(<StockCorrection item={item()} initialReason="purchase_missing" onClose={() => {}} onDone={() => {}} />, lang, { permissions: ['stock'] });
      expect(keeper).toContain(esc(textOf(lang, 'sc_supplierNeedsPurchases')));
      expect(keeper).toContain(esc(textOf(lang, 'sc_unitCost')));
    }
  });

  it('names the documents a correction makes, in the item moves too', () => {
    for (const lang of LANGS) {
      for (const key of ['src_adjustment', 'src_adjustment_cancel', 'sc_done', 'sc_waiting', 'sc_waitingOpening', 'err_correction_no_change'] as Key[]) {
        expect(textOf(lang, key, { doc: 'ADJ-2026-0001' }), `${lang} ${key}`).not.toBe(key);
      }
    }
    expect(textOf('en', 'sc_done', { doc: 'ADJ-2026-0001' })).toBe('Stock corrected: ADJ-2026-0001');
    expect(textOf('ku', 'sc_title')).toBe('ڕاستکردنەوەی کۆگا');
  });
});
