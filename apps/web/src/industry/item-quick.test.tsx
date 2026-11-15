import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Lang } from '@qasa/core';
import { ApiError, type ItemDetail, type ItemView, type Permission } from '../api.ts';
import { DataContext } from '../components.tsx';
import { I18nContext, makeI18n, type Key } from '../i18n.ts';
import { ItemPicker, QuickItemForm, withAdded } from './QuickItemForm.tsx';
import {
  addRowKind, anyItemMatches, existingStockStep, itemKey, labelQtyFor, mayAddItem, oldServerRefusal, showsBatchFields, QUICK_ITEM_TIMEOUT_MS, quickAddItem, quickItemInput,
  quickItemStart, sameItems, sameSearch, typedForForm
} from './item-quick-add.ts';
import {
  correctionDiff, correctionProblem, correctionReasons, noAverageRefusal, outcomeUnknown, purchaseCost, REASON_WAY, sendCorrection, startingCost, StockCorrection,
  StockCorrectionFor, warehouseAverage
} from './StockCorrection.tsx';
import { stockCost } from './QuickItemForm.tsx';

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

  it("starts a market's scale label as the weighed item it is for: the label's first seven digits, in kilograms", () => {
    // 2100017 01250 3: item 2100017, 1.250 kg
    expect(quickItemStart('2100017012503', 'piece', true)).toMatchObject({ name: '', barcode: '2100017', unit: 'kg', scaleLabel: '2100017012503' });
    expect(quickItemStart('٢١٠٠٠١٧٠١٢٥٠٣', 'piece', true)).toMatchObject({ barcode: '2100017', unit: 'kg' });
    expect(addRowKind('2100017012503', true)).toBe('scale');
    // not a market, or not a label (a wrong check digit): the whole code, as any barcode
    expect(quickItemStart('2100017012503')).toMatchObject({ barcode: '2100017012503', unit: 'piece', scaleLabel: null });
    expect(quickItemStart('2100017012504', 'piece', true)).toMatchObject({ barcode: '2100017012504', unit: 'piece', scaleLabel: null });
    expect(addRowKind('2100017012503')).toBe('barcode');
  });

  it("gives the weight of a scale's label for the line, for the label's own weighed item only (1.4.2 review)", () => {
    // 2100017 01250 3: item 2100017, 1.250 kg
    const label = quickItemStart('2100017012503', 'piece', true);
    const tomato = { barcode: label.barcode, unit: label.unit };
    expect(labelQtyFor(label.scaleLabel, tomato)).toBe(1_250);
    expect(labelQtyFor(label.scaleLabel, { ...tomato, unit: 'g' })).toBe(1_250_000);
    // another item (its barcode changed in the form, or another one chosen), one not weighed, or no label: none
    expect(labelQtyFor(label.scaleLabel, { ...tomato, barcode: '2100018' })).toBeNull();
    expect(labelQtyFor(label.scaleLabel, { ...tomato, unit: 'piece' })).toBeNull();
    expect(labelQtyFor(null, tomato)).toBeNull();
    expect(labelQtyFor(quickItemStart('2100017012503').scaleLabel, tomato)).toBeNull();
  });

  it('opens the form with a name as it was typed (its own digits), and a scan in western digits', () => {
    expect(typedForForm(' چای لیپتۆن ١٠٠ ')).toBe('چای لیپتۆن ١٠٠');
    expect(typedForForm('٦٢٦٠١٢٣٤')).toBe('62601234');
  });

  it('finds an item already there by its name (any language, letter forms and digits aside), code or barcode, whatever the page shows', () => {
    const tea = { id: 't', code: 'I-0007', barcode: '6260000000123', name: { ar: 'شاي ليبتون ١٠٠', en: 'Lipton tea 100', ku: 'چای لیپتۆن ١٠٠' }, active: true } as ItemView;
    const old = { id: 'o', code: 'I-0002', barcode: '', name: { ar: 'Lipton tea 100', en: 'Lipton tea 100', ku: 'Lipton tea 100' }, active: false } as ItemView;
    const other = { id: 'x', code: 'I-0009', barcode: '', name: { ar: 'Mango', en: 'Mango', ku: 'Mango' }, active: true } as ItemView;
    expect(sameItems([old, other, tea], { name: '  lipton   TEA 100 ', barcode: '' }).map((s) => [s.item.id, s.by])).toEqual([['t', 'name'], ['o', 'name']]);
    expect(sameItems([old, other, tea], { name: 'چای لیپتون 100', barcode: '' }).map((s) => s.item.id)).toEqual(['t']);
    expect(sameItems([old, other, tea], { name: 'شاي ليبتون 100', barcode: '' }).map((s) => s.item.id)).toEqual(['t']);
    expect(sameItems([other, tea], { name: 'Something', barcode: '٦٢٦٠٠٠٠٠٠٠١٢٣' })).toEqual([{ item: tea, by: 'barcode' }]);
    expect(sameItems([other, tea], { name: 'i-0009', barcode: '' })).toEqual([{ item: other, by: 'code' }]);
    expect(sameItems([other, tea], { name: 'Lipton', barcode: '' })).toEqual([]);
    // the server is asked by the longest word without digits
    expect(sameSearch({ name: 'Lipton tea 100', barcode: '' })).toBe('lipton');
    expect(sameSearch({ name: '555', barcode: '' })).toBe('');
  });

  it('asks for the items already there before adding, offers them instead, and adds anyway when told to', async () => {
    const input = quickItemInput({ ...quickItemStart('Lipton tea 100'), salePrice: 2_500 }, true);
    if (!input.ok) throw new Error('input');
    const tea = { id: 't', code: 'I-0007', barcode: '', name: { ar: 'Lipton tea 100', en: 'Lipton tea 100', ku: 'Lipton tea 100' }, active: true } as ItemView;
    const list = vi.fn().mockResolvedValue([tea]);
    const create = vi.fn().mockResolvedValue({ id: 'new' } as ItemView);
    expect(await quickAddItem(input.input, null, create, () => 'k1', { force: false, list })).toEqual({ status: 'same', same: [{ item: tea, by: 'name' }] });
    expect(list).toHaveBeenCalledWith('lipton', { timeoutMs: QUICK_ITEM_TIMEOUT_MS });
    expect(create).not.toHaveBeenCalled();
    expect(await quickAddItem(input.input, null, create, () => 'k1', { force: true, list })).toEqual({ status: 'added', item: { id: 'new' } });
    // an add sent again with its held key is answered by the server (it may be made already), not stopped by the list
    list.mockClear();
    const heldKey = { ...itemKey(null, input.input, () => 'k2'), sent: true };
    expect(await quickAddItem(input.input, heldKey, create, () => 'k3', { force: false, list })).toMatchObject({ status: 'added' });
    expect(list).not.toHaveBeenCalled();
    // the list can't be read: the link is down, as for the add itself
    const down = vi.fn().mockRejectedValue(new ApiError(0, 'network', null));
    expect(await quickAddItem(input.input, null, create, () => 'k4', { force: false, list: down })).toMatchObject({ status: 'offline' });
  });

  it('looks for the items already there again when only that look failed: the add never went out (1.4.2 review)', async () => {
    const input = quickItemInput({ ...quickItemStart('Lipton tea 100'), salePrice: 2_500 }, true);
    if (!input.ok) throw new Error('input');
    const tea = { id: 't', code: 'I-0007', barcode: '', name: { ar: 'Lipton tea 100', en: 'Lipton tea 100', ku: 'Lipton tea 100' }, active: true } as ItemView;
    const list = vi.fn().mockRejectedValueOnce(new ApiError(0, 'network', null)).mockResolvedValueOnce([tea]).mockResolvedValue([]);
    const create = vi.fn().mockRejectedValueOnce(new ApiError(0, 'network', null)).mockResolvedValue({ id: 'new' } as ItemView);
    const check = { force: false, list };
    // the look fails before anything is added: held, but marked as never sent
    const first = await quickAddItem(input.input, null, create, () => 'k1', check);
    expect(first).toEqual({ status: 'offline', key: { key: 'k1', of: JSON.stringify(input.input), sent: false } });
    expect(create).not.toHaveBeenCalled();
    // the next try looks again, and finds the item someone else added meanwhile instead of adding a second one
    const held = first.status === 'offline' ? first.key : null;
    expect(await quickAddItem(input.input, held, create, () => 'k2', check)).toEqual({ status: 'same', same: [{ item: tea, by: 'name' }] });
    expect(list).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
    // nothing there: the add goes out with the key held all along; its answer is lost, so it may be made already
    const lost = await quickAddItem(input.input, held, create, () => 'k3', check);
    expect(lost).toEqual({ status: 'offline', key: { key: 'k1', of: JSON.stringify(input.input), sent: true } });
    expect(list).toHaveBeenCalledTimes(3);
    // so the next try sends that key again without looking first: the server answers it, never adding the item twice
    expect(await quickAddItem(input.input, lost.status === 'offline' ? lost.key : null, create, () => 'k4', check)).toEqual({ status: 'added', item: { id: 'new' } });
    expect(list).toHaveBeenCalledTimes(3);
    expect(create.mock.calls.map((c) => c[1].key)).toEqual(['k1', 'k1']);
  });

  it("offers the till's add only when nothing in the whole list matches, whatever category is chosen", () => {
    const keys = ['i-0001 6260000000123 شاي tea چا', 'i-0002 lipton tea 100'];
    expect(anyItemMatches('tea', keys)).toBe(true);
    expect(anyItemMatches('Lipton  TEA', keys)).toBe(true);
    expect(anyItemMatches('coffee', keys)).toBe(false);
    expect(anyItemMatches('  ', keys)).toBe(false);
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
    expect(first).toEqual({ status: 'offline', key: { key: 'k1', of: JSON.stringify(input.input), sent: true } });
    const again = await quickAddItem(input.input, first.status === 'offline' ? first.key : null, create, () => 'k2');
    expect(again).toEqual({ status: 'added', item: { id: 'i9' } });
    expect(create.mock.calls.map((c) => c[1])).toEqual([{ key: 'k1', timeoutMs: QUICK_ITEM_TIMEOUT_MS }, { key: 'k1', timeoutMs: QUICK_ITEM_TIMEOUT_MS }]);
    // anything changed: a new key, not sent yet
    expect(itemKey({ key: 'k1', of: 'x', sent: true }, input.input, () => 'k3')).toEqual({ key: 'k3', of: JSON.stringify(input.input), sent: false });
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
      // the currency switch is for both prices, and each price says its currency
      expect(byName).toContain(esc(textOf(lang, 'iq_pricesCurrency')));
      // a sale with a warehouse (an invoice, the till) asks what is on the shelf now, instead of the note
      const till = wrap(<QuickItemForm typed="Mango juice" sale warehouseId="w1" onDone={() => {}} onClose={() => {}} />, lang, { permissions: ['stock'], seesCost: true });
      expect(till).toContain(esc(textOf(lang, 'iq_stockNow')));
      expect(till).toContain(esc(textOf(lang, 'iq_stockNowHint')));
      expect(till).not.toContain(esc(textOf(lang, 'iq_noStockYet')));
      expect(byName).not.toContain(esc(textOf(lang, 'iq_stockNow')));
      for (const key of ['iq_stockWaiting', 'iq_stockFailed', 'iq_stockNeedsPrice', 'iq_sameItem', 'iq_addScale', 'iq_scaleHint', 'pos_noItemNamed', 'err_barcode_scale_label'] as Key[]) {
        expect(textOf(lang, key, { code: '2100017012503', p: '2100017', n: 'x' }), lang + ' ' + key).not.toBe(key);
      }
    }
    expect(textOf('en', 'pos_noItemNamed', { n: 'Lipton tea' })).toBe('No item matches “Lipton tea”');
  });

  it('enters the stock typed at the purchase price, a dollar price at the company rate', () => {
    expect(stockCost({ purchasePrice: 1_800, currency: 'IQD' }, 142_000)).toBe(1_800);
    expect(stockCost({ purchasePrice: 150, currency: 'USD' }, 142_000)).toBe(2_130);
    expect(stockCost({ purchasePrice: null, currency: 'IQD' }, 142_000)).toBeNull();
    expect(stockCost({ purchasePrice: 150, currency: 'USD' }, undefined)).toBeNull();
  });

  it("shows the batch and expiry fields by the item's own settings once it is made, so a failed settings read never blocks its stock", () => {
    // before the item is made: the company's choice (false when it could not be read)
    expect(showsBatchFields(null, true)).toBe(true);
    expect(showsBatchFields(null, false)).toBe(false);
    // made (or chosen): its own settings, whatever the company's choice said
    expect(showsBatchFields({ trackBatches: true, trackExpiry: true }, false)).toBe(true);
    expect(showsBatchFields({ trackBatches: true, trackExpiry: false }, false)).toBe(true);
    expect(showsBatchFields({ trackBatches: false, trackExpiry: false }, true)).toBe(false);
  });

  it('enters the stock typed for an item already there that was chosen instead: opening stock where it has none, else a count', () => {
    // nothing typed, 0, or what the warehouse holds already: nothing changes
    expect(existingStockStep(5_000, null)).toEqual({ kind: 'none' });
    expect(existingStockStep(5_000, 0)).toEqual({ kind: 'none' });
    expect(existingStockStep(5_000, 5_000)).toEqual({ kind: 'none' });
    // none in the sale's warehouse: opening stock at the purchase price
    expect(existingStockStep(0, 12_000)).toEqual({ kind: 'enter', reason: 'opening', adds: true });
    // some there: a count correction either way
    expect(existingStockStep(5_000, 12_000)).toEqual({ kind: 'enter', reason: 'found', adds: true });
    expect(existingStockStep(5_000, 3_000)).toEqual({ kind: 'enter', reason: 'found', adds: false });
    for (const lang of LANGS) expect(textOf(lang, 'iq_sameStock'), lang).not.toBe('iq_sameStock');
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
    // a surplus with no cost is valued at the warehouse's average: none there, a cost is asked
    expect(correctionProblem('found', 1_000, '', null, { average: null })).toBe('err_line_price_invalid_unitCost');
    expect(correctionProblem('found', 1_000, '', null, { average: 1_500 })).toBeNull();
    // a purchase not entered names its supplier or its safe
    expect(correctionProblem('purchase_missing', 1_000, '', 1_400, { paidBy: false })).toBe('err_purchase_how_required');
    expect(correctionProblem('purchase_missing', 1_000, '', 1_400, { paidBy: true })).toBeNull();
  });

  it('sends a correction whose answer was lost again only as it was, with its key, whatever the form says now (1.4.2 review)', async () => {
    const counted = { warehouseId: 'w1', mode: 'set' as const, qtyMilli: 25_000, reason: 'found' as const, lang: 'en' as const };
    const result = { document: { type: 'adjustment' as const, id: 'a1', number: 'ADJ-2026-0001', status: 'posted' }, posted: true, diffMilli: 5_000, item: item() };
    const send = vi.fn().mockRejectedValueOnce(new ApiError(0, 'network', null)).mockResolvedValueOnce(result);
    const first = await sendCorrection(null, 'i1', counted, send, () => 'k1');
    expect(first).toMatchObject({ status: 'unsure', held: { key: 'k1', itemId: 'i1', input: counted } });
    // the form was changed since (another count, another reason): the request held goes again, not the changed one
    const changed = { ...counted, qtyMilli: 30_000, reason: 'other' as const, note: 'x' };
    expect(await sendCorrection(first.status === 'unsure' ? first.held : null, 'i1', changed, send, () => 'k2')).toEqual({ status: 'done', result });
    expect(send.mock.calls).toEqual([['i1', counted, { key: 'k1' }], ['i1', counted, { key: 'k1' }]]);
    // no answer, or the server failed on its way: unknown, held. A refusal: nothing was made, let go
    expect(outcomeUnknown(new ApiError(0, 'network', null))).toBe(true);
    expect(outcomeUnknown(new ApiError(503, 'database_unavailable', null))).toBe(true);
    expect(outcomeUnknown(new Error('?'))).toBe(true);
    expect(outcomeUnknown(new ApiError(400, 'validation', null))).toBe(false);
    expect(outcomeUnknown(new ApiError(409, 'idempotency_key_reused', null))).toBe(false);
    const refusal = new ApiError(400, 'validation', [{ code: 'correction_no_change' }]);
    expect(await sendCorrection(null, 'i1', counted, vi.fn().mockRejectedValue(refusal), () => 'k3')).toEqual({ status: 'refused', error: refusal });
    // the notes of the correction dialog and of the new-item form's stock name the button that sends it again
    for (const lang of LANGS) {
      for (const key of ['sc_unsure', 'sc_tryAgain', 'iq_stockUnsure'] as Key[]) expect(textOf(lang, key), `${lang} ${key}`).not.toBe(key);
      expect(textOf(lang, 'sc_unsure'), lang).toContain(textOf(lang, 'sc_tryAgain'));
      expect(textOf(lang, 'iq_stockUnsure'), lang).toContain(textOf(lang, 'sc_tryAgain'));
    }
  });

  it("values a surplus at the chosen warehouse's own average (left to the server), and a purchase at the purchase price", () => {
    const two = item({
      qtyMilli: 30_000, value: 60_000,
      stock: [
        { warehouseId: 'w1', warehouseCode: 'MAIN', warehouseName: { ar: 'الرئيسي', en: 'Main', ku: 'سەرەکی' }, qtyMilli: 20_000, value: 30_000 },
        { warehouseId: 'w2', warehouseCode: 'B', warehouseName: { ar: 'ب', en: 'B', ku: 'ب' }, qtyMilli: 10_000, value: 30_000 }
      ]
    });
    expect(warehouseAverage(two, 'w1')).toBe(1_500);
    expect(warehouseAverage(two, 'w2')).toBe(3_000);
    expect(warehouseAverage(two, 'w3')).toBeNull();
    expect(purchaseCost(item(), 142_000)).toBe(1_400);
    expect(purchaseCost(item({ purchasePrice: 250, purchaseCurrency: 'USD' }), 142_000)).toBe(3_550);
    expect(purchaseCost(item({ purchasePrice: null }), 142_000)).toBeNull();
    // a count or other: empty while the warehouse holds some (the server uses its average); else the purchase price
    expect(startingCost('found', 3_000, 1_400)).toBeNull();
    expect(startingCost('other', null, 1_400)).toBe(1_400);
    // a purchase or opening stock: the purchase price, else the warehouse's average
    expect(startingCost('purchase_missing', 3_000, 1_400)).toBe(1_400);
    expect(startingCost('opening', 3_000, null)).toBe(3_000);
    expect(startingCost('damaged', 3_000, 1_400)).toBeNull();
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
      // a purchase not entered is a purchase invoice, on credit or in cash, for someone who enters purchases
      const buyer = wrap(<StockCorrection item={item()} initialReason="purchase_missing" onClose={() => {}} onDone={() => {}} />, lang, { permissions: ['stock', 'purchases'] });
      for (const key of ['sc_howPaid', 'sc_howCredit', 'sc_howCash', 'sc_supplier', 'sc_x_purchase_missing', 'sc_unitCost', 'sc_costPrice'] as Key[]) expect(buyer, key).toContain(esc(textOf(lang, key)));
      // its cost starts at the purchase price
      expect(buyer).toContain('value="1,400"');
      // the others are told who enters it, and can't save it
      const keeper = wrap(<StockCorrection item={item()} initialReason="purchase_missing" onClose={() => {}} onDone={() => {}} />, lang, { permissions: ['stock'] });
      expect(keeper).toContain(esc(textOf(lang, 'sc_purchaseNeedsPurchases')));
      expect(keeper).not.toContain(esc(textOf(lang, 'sc_unitCost')));
      expect(keeper).toMatch(/<button type="button" class="btn primary" disabled="">/);
      // a count: the cost is left empty, with this warehouse's average shown in the box and said under it
      const found = wrap(<StockCorrection item={item()} initialReason="found" onClose={() => {}} onDone={() => {}} />, lang, { permissions: ['stock'] });
      expect(found).toContain('placeholder="1,500"');
      expect(found).toContain(esc(textOf(lang, 'sc_costAverage')));
      // damaged goes one way: no direction to pick
      const damaged = wrap(<StockCorrection item={item()} initialReason="damaged" onClose={() => {}} onDone={() => {}} />, lang, { permissions: ['stock'] });
      expect(damaged).not.toContain(esc(textOf(lang, 'adj_direction')));
      // opened from the Items list: a titled dialog while the item loads
      const loading = wrap(<StockCorrectionFor itemId="i1" onClose={() => {}} onDone={() => {}} />, lang, { permissions: ['stock'] });
      expect(loading).toContain(esc(textOf(lang, 'sc_title')));
      expect(loading).toContain(esc(textOf(lang, 'sc_loading')));
    }
    expect(textOf('en', 'sc_x_supplier')).toBe('A credit purchase invoice is made: you owe the supplier this amount.');
    expect(textOf('en', 'sc_x_opening')).toContain('goods you had when you started (capital)');
  });

  it('lets someone who corrects stock but sees no cost (a storekeeper) save a count at the average, with no cost to type', () => {
    // the server sends them no stock value, so there is no average on this PC: it is left to the server
    const hidden = item({ value: undefined, purchasePrice: null, stock: [{ warehouseId: 'w1', warehouseCode: 'MAIN', warehouseName: { ar: 'الرئيسي', en: 'Main', ku: 'سەرەکی' }, qtyMilli: 20_000 }] as ItemDetail['stock'] });
    expect(warehouseAverage(hidden, 'w1')).toBeNull();
    expect(correctionProblem('found', 1_000, '', null, {})).toBeNull();
    expect(correctionProblem('other', 1_000, 'shelf', null, {})).toBeNull();
    // a purchase or opening stock is entered at its price, by someone who sees cost
    expect(correctionReasons(true)).toEqual(['purchase_missing', 'found', 'damaged', 'lost', 'opening', 'other']);
    expect(correctionReasons(false)).toEqual(['found', 'damaged', 'lost', 'other']);
    // the server's refusal when the warehouse has no average is told as who can enter it
    expect(noAverageRefusal(new ApiError(400, 'validation', [{ code: 'adj_cost_required', line: 1 }]))).toBe(true);
    expect(noAverageRefusal(new ApiError(400, 'validation', [{ code: 'note_required', field: 'note' }]))).toBe(false);
    expect(noAverageRefusal(new Error('x'))).toBe(false);
    for (const lang of LANGS) {
      for (const reason of ['found', 'other', 'opening', 'purchase_missing'] as const) {
        const html = wrap(<StockCorrection item={hidden} initialReason={reason} onClose={() => {}} onDone={() => {}} />, lang, { permissions: ['stock', 'purchases'], seesCost: false });
        expect(html, `${lang} ${reason}`).not.toContain(esc(textOf(lang, 'sc_unitCost')));
        expect(html).not.toContain('<option value="opening"');
        expect(html).not.toContain('<option value="purchase_missing"');
        // a reason they are not offered opens as a count
        expect(html).toContain(`<option value="${reason === 'other' ? 'other' : 'found'}" selected="">`);
        expect(html).not.toMatch(/<button type="button" class="btn primary" disabled="">/);
      }
      expect(textOf(lang, 'sc_noAverageNoCost')).not.toBe('sc_noAverageNoCost');
    }
    expect(textOf('en', 'sc_noAverageNoCost')).toBe('This warehouse holds none of it, so it has no average cost there: someone who sees costs enters it.');
  });

  it('tells an office server before 1.4.2 (no stock correction there) from a record that is missing', () => {
    // Fastify's own answer for an address it doesn't know, as a 1.4.1 office server gives it
    expect(oldServerRefusal(new ApiError(404, 'Not Found', null))).toBe(true);
    // an item that is gone, a refusal, a lost answer: not the old server
    expect(oldServerRefusal(new ApiError(404, 'not_found', { what: 'item' }))).toBe(false);
    expect(oldServerRefusal(new ApiError(400, 'validation', []))).toBe(false);
    expect(oldServerRefusal(new TypeError('Failed to fetch'))).toBe(false);
    for (const lang of LANGS) {
      for (const key of ['sc_oldServer', 'iq_stockOldServer'] as Key[]) {
        expect(textOf(lang, key), `${lang} ${key}`).not.toBe(key);
        expect(textOf(lang, key)).toContain('1.4.2');
      }
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
