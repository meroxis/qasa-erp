import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Lang } from '@qasa/core';
import { ApiError, type PartyView, type Permission } from '../api.ts';
import { COMBO_ADD_ROW, comboRows, DataContext, SearchCombo, type PickOption } from '../components.tsx';
import { I18nContext, makeI18n, type Key } from '../i18n.ts';
import { PartyPicker, QuickPartyForm } from './PartyPicker.tsx';
import { mayAddParty, phoneDigits, QUICK_ADD_TIMEOUT_MS, quickAddParty, quickKey, quickPartyInput, sameParties } from './party-quick-add.ts';

const LANGS: Lang[] = ['ar', 'en', 'ku'];
const i18nOf = (lang: Lang) => makeI18n(lang, 'western', () => {}, () => {});
const textOf = (lang: Lang, key: Key, vars?: Record<string, string>) => i18nOf(lang).t(key, vars);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const wrap = (node: ReactNode, lang: Lang, permissions?: Permission[]) => renderToStaticMarkup(
  <I18nContext.Provider value={i18nOf(lang)}>
    <DataContext.Provider value={{ permissions } as never}>{node}</DataContext.Provider>
  </I18nContext.Provider>
);

const party = (over: Partial<PartyView>): PartyView => ({
  id: 'p1', type: 'customer', code: 'C-0001', name: 'Mer', phone: '', address: '', accountCode: '1612', creditLimit: null, notes: '',
  active: true, balance: 0, hasEntries: false, ...over
});
const mer = party({ id: 'p1', code: 'C-0001', name: 'Mer', phone: '0750 123 4567' });
const las = party({ id: 'p2', code: 'C-0002', name: 'Las', phone: '0770 555 0101' });
const raz = party({ id: 'p3', code: 'S-0001', type: 'supplier', name: 'Raz', phone: '0750 123 4567' });
const options: PickOption[] = [mer, las].map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone }));

describe('the rows of a picker that can add', () => {
  const label = (typed: string) => (typed ? `Add “${typed}”` : 'Add new');

  it('puts "add what I typed" first when the text matches nobody, so Enter picks it', () => {
    const rows = comboRows(options, 'Raz', { canAdd: true, addLabel: label });
    expect(rows).toEqual([{ id: COMBO_ADD_ROW, code: '', label: 'Add “Raz”' }]);
  });

  it('keeps the matches first and the add row last when someone matches, and leaves it out for an exact name', () => {
    const some = comboRows([...options, { id: 'p4', code: 'C-0004', label: 'Mer wholesale' }], 'mer w', { canAdd: true, addLabel: label });
    expect(some.map((r) => r.id)).toEqual(['p4', COMBO_ADD_ROW]);
    // the very name is there already: nothing to add (the "+" in the box still opens the form)
    expect(comboRows(options, ' MER ', { canAdd: true, addLabel: label }).map((r) => r.id)).toEqual(['p1']);
  });

  it('offers a plain "add new" at the end while nothing is typed, after the walk-in choice and everyone', () => {
    const rows = comboRows(options, '', { canAdd: true, addLabel: label, emptyLabel: 'Walk-in' });
    expect(rows.map((r) => r.id)).toEqual(['', 'p1', 'p2', COMBO_ADD_ROW]);
    expect(rows.at(-1)!.label).toBe('Add new');
  });

  it('never shows an add row to someone who may not add, and finds people by phone as before', () => {
    expect(comboRows(options, 'Raz')).toEqual([]);
    expect(comboRows(options, '0770').map((r) => r.id)).toEqual(['p2']);
    expect(comboRows(options, '', { emptyLabel: 'Walk-in' }).map((r) => r.id)).toEqual(['', 'p1', 'p2']);
  });
});

describe('who may add from a picker', () => {
  it('follows the server\'s rule: sales adds customers, purchasing adds suppliers', () => {
    expect(mayAddParty(['sales'], 'customer')).toBe(true);
    expect(mayAddParty(['sales'], 'supplier')).toBe(false);
    expect(mayAddParty(['purchases'], 'supplier')).toBe(true);
    expect(mayAddParty(['purchases'], 'customer')).toBe(false);
    expect(mayAddParty(['entries.prepare', 'stock'], 'customer')).toBe(false);
    expect(mayAddParty([], 'customer')).toBe(false);
    // not known yet: hidden
    expect(mayAddParty(undefined, 'customer')).toBe(false);
  });

  it('shows the "+" inside the box only to someone who may, named in each language', () => {
    for (const lang of LANGS) {
      const picker = <PartyPicker type="customer" value="" options={options} onChange={() => {}} placeholder="…" />;
      const allowed = wrap(picker, lang, ['sales']);
      expect(allowed).toContain('class="combo-add"');
      expect(allowed).toContain(`aria-label="${esc(textOf(lang, 'qa_addCustomer'))}"`);
      // not a tab stop: Tab goes from the box to the next field
      expect(allowed).toMatch(/class="combo-add" tabindex="-1"/);
      for (const others of [['purchases'], ['stock'], []] as Permission[][]) expect(wrap(picker, lang, others)).not.toContain('combo-add');
      const supplier = wrap(<PartyPicker type="supplier" value="" options={[]} onChange={() => {}} placeholder="…" />, lang, ['purchases']);
      expect(supplier).toContain(`aria-label="${esc(textOf(lang, 'qa_addSupplier'))}"`);
    }
  });

  it('leaves a plain picker (items, accounts) without a "+"', () => {
    expect(wrap(<SearchCombo value="" options={options} onChange={() => {}} placeholder="…" />, 'en', ['sales'])).not.toContain('combo-add');
  });
});

describe('the small form under the box', () => {
  it('starts with the typed name, asks for the phone and the city, and the price list for a customer only', () => {
    for (const lang of LANGS) {
      const html = wrap(<QuickPartyForm type="customer" name="Las" onDone={() => {}} onClose={() => {}} />, lang);
      expect(html).toContain('value="Las"');
      for (const key of ['qa_addCustomer', 'name', 'phone', 'qa_city', 'prl_title', 'prl_retail', 'prl_wholesale', 'qa_add', 'cancel', 'qa_laterCustomer'] as Key[]) {
        expect(html, `${lang} ${key}`).toContain(esc(textOf(lang, key)));
      }
      // the phone is written left to right in every language
      expect(html).toMatch(/<input class="input ltr" dir="ltr" inputMode="tel"/i);
      const supplier = wrap(<QuickPartyForm type="supplier" name="" onDone={() => {}} onClose={() => {}} />, lang);
      expect(supplier).toContain(esc(textOf(lang, 'qa_addSupplier')));
      expect(supplier).toContain(esc(textOf(lang, 'qa_laterSupplier')));
      expect(supplier).not.toContain(esc(textOf(lang, 'prl_title')));
    }
  });

  it('writes typed text as text, never as markup', () => {
    const html = wrap(<QuickPartyForm type="customer" name={'<img src=x onerror=alert(1)>'} onDone={() => {}} onClose={() => {}} />, 'en');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('what the form sends', () => {
  it('needs only the name; the rest is left out when empty', () => {
    expect(quickPartyInput({ name: '  Las  ', phone: '', city: '' })).toEqual({ ok: true, input: { name: 'Las' } });
    expect(quickPartyInput({ name: 'Las   of   Erbil', phone: ' 0750 123 4567 ', city: ' Erbil ' }))
      .toEqual({ ok: true, input: { name: 'Las of Erbil', phone: '0750 123 4567', address: 'Erbil' } });
  });

  it('refuses an empty name and anything longer than the server takes', () => {
    expect(quickPartyInput({ name: '   ', phone: '0750', city: '' })).toEqual({ ok: false, field: 'name', code: 'name_required' });
    expect(quickPartyInput({ name: 'x'.repeat(201), phone: '', city: '' })).toMatchObject({ ok: false, field: 'name', code: 'too_long' });
    expect(quickPartyInput({ name: 'Las', phone: '1'.repeat(51), city: '' })).toMatchObject({ ok: false, field: 'phone' });
    expect(quickPartyInput({ name: 'Las', phone: '', city: 'x'.repeat(301) })).toMatchObject({ ok: false, field: 'city' });
  });
});

describe('someone who is already there', () => {
  it('is found by the same phone however it is written, and by the same name whatever the letter case or spaces', () => {
    const all = [mer, las, raz];
    // +964 750…, 0750… and Arabic digits are one number
    for (const phone of ['+964 750 123 4567', '07501234567', '٠٧٥٠ ١٢٣ ٤٥٦٧']) {
      expect(sameParties(all, 'customer', { name: 'Someone new', phone })).toEqual([{ party: mer, samePhone: true, sameName: false }]);
    }
    expect(sameParties(all, 'customer', { name: '  las ' })).toEqual([{ party: las, samePhone: false, sameName: true }]);
    expect(phoneDigits('0750 123 4567')).toBe('9647501234567');
  });

  it('looks only among the same kind: a supplier with a customer\'s phone is not that customer', () => {
    expect(sameParties([mer, las, raz], 'supplier', { name: 'New', phone: '0750 123 4567' }).map((s) => s.party.id)).toEqual(['p3']);
    expect(sameParties([raz], 'customer', { name: 'Raz', phone: '0750 123 4567' })).toEqual([]);
  });

  it('finds nobody for a new name and phone, and never matches on an empty or very short phone', () => {
    expect(sameParties([mer, las], 'customer', { name: 'Raz', phone: '0771 000 0000' })).toEqual([]);
    expect(sameParties([party({ id: 'p5', name: 'Raz', phone: '' })], 'customer', { name: 'Las', phone: '' })).toEqual([]);
    expect(sameParties([party({ id: 'p6', name: 'Raz', phone: '12' })], 'customer', { name: 'Las', phone: '12' })).toEqual([]);
  });

  it('lists the same phone first, and someone switched off too (they are named, not offered)', () => {
    const off = party({ id: 'p7', code: 'C-0007', name: 'Las', active: false });
    const found = sameParties([off, las, mer], 'customer', { name: 'Las', phone: '0750 123 4567' });
    expect(found.map((s) => s.party.id)).toEqual(['p1', 'p2', 'p7']);
  });
});

describe('adding through the server', () => {
  const made = party({ id: 'new', code: 'C-0003', name: 'Raz' });
  const network = () => new ApiError(0, 'network', null);

  it('adds a new person with the Customers page\'s own request, sent with a key and a time limit', async () => {
    const create = vi.fn(async () => made);
    const done = await quickAddParty('customer', { name: 'Raz', phone: '0771 000 0000' }, {}, { list: async () => [mer, las], create, makeKey: () => 'key-1' });
    expect(done).toEqual({ status: 'added', party: made, key: null });
    expect(create).toHaveBeenCalledWith('customer', { name: 'Raz', phone: '0771 000 0000' }, { key: 'key-1', timeoutMs: QUICK_ADD_TIMEOUT_MS });
  });

  it('sends nothing when someone the same is there, until the person says "add anyway"', async () => {
    const create = vi.fn(async () => made);
    const deps = { list: async () => [mer, las], create, makeKey: () => 'key-1' };
    const first = await quickAddParty('customer', { name: 'Mer' }, {}, deps);
    expect(first).toMatchObject({ status: 'same', same: [{ party: mer, sameName: true }] });
    expect(create).not.toHaveBeenCalled();
    expect((await quickAddParty('customer', { name: 'Mer' }, { force: true }, deps)).status).toBe('added');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('keeps the key of a try that got no answer: the next try can\'t add the same person twice', async () => {
    const keys = ['key-1', 'key-2', 'key-3'];
    const makeKey = () => keys.shift()!;
    const create = vi.fn<(type: string, input: unknown, options: { key?: string }) => Promise<PartyView>>(async () => { throw network(); });
    const deps = { list: async () => [] as PartyView[], create, makeKey };
    const lost = await quickAddParty('customer', { name: 'Raz' }, {}, deps);
    expect(lost).toEqual({ status: 'offline', key: { key: 'key-1', of: expect.any(String) } });
    create.mockResolvedValueOnce(made);
    const again = await quickAddParty('customer', { name: 'Raz' }, { held: lost.key }, deps);
    expect(again.status).toBe('added');
    expect(create.mock.calls.map((c) => c[2].key)).toEqual(['key-1', 'key-1']);
    // another name is another person: a key of its own
    expect(quickKey(lost.key, 'customer', { name: 'Las' }, makeKey).key).toBe('key-2');
    expect(quickKey(lost.key, 'supplier', { name: 'Raz' }, makeKey).key).toBe('key-3');
  });

  it('says the server can\'t be reached when even the look for the same person fails, and adds nothing', async () => {
    const create = vi.fn(async () => made);
    const done = await quickAddParty('customer', { name: 'Raz' }, {}, { list: async () => { throw network(); }, create, makeKey: () => 'key-1' });
    expect(done.status).toBe('offline');
    expect(create).not.toHaveBeenCalled();
  });

  it('passes the server\'s refusal on as it is (no permission, a rule)', async () => {
    const forbidden = new ApiError(403, 'forbidden', { need: 'sales' });
    await expect(quickAddParty('customer', { name: 'Raz' }, {}, { list: async () => [], create: async () => { throw forbidden; } })).rejects.toBe(forbidden);
    await expect(quickAddParty('customer', { name: 'Raz' }, {}, { list: async () => { throw forbidden; }, create: async () => made })).rejects.toBe(forbidden);
  });
});
