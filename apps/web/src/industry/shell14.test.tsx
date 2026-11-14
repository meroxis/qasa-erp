import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Lang, PrinterChoices } from '@qasa/core';
import type { PartyView } from '../api.ts';
import { I18nContext, makeI18n, type Key } from '../i18n.ts';
import { SHELL14_TEXT } from '../i18n/shell14.ts';
import { dataPlaceLine, officeText, readDataPlace, type DataPlace } from './data-place.ts';
import { HeaderRateView, hasRate, perDollar } from './HeaderRate.tsx';
import { oweLines, oweTone, oweWords, type PartyTotals } from './parties-api.ts';
import { OweAmount, PartyTotalsBar, shownParties } from '../pages/Parties.tsx';
import { ClientBackupCard, ClientNetworkCard, DataPlaceCard, markRepeatedHeadings } from '../pages/Settings.tsx';
import { CloseAskView, closeAskOf } from './CloseAsk.tsx';
import { InstalledPrinters, PrintersCardView } from './Printers.tsx';
import { defaultPrinter, outcomeOf, printDocument, printersOf, suggestedChoice, suggestPrinter, type DesktopPrinters, type PrinterInfo, type PrintNotice } from './printing.ts';

const LANGS: Lang[] = ['ar', 'en', 'ku'];
const i18nOf = (lang: Lang) => makeI18n(lang, 'western', () => {}, () => {});
const wrap = (node: ReactNode, lang: Lang = 'en') => renderToStaticMarkup(<I18nContext.Provider value={i18nOf(lang)}>{node}</I18nContext.Provider>);
const textOf = (lang: Lang, key: Key, vars?: Record<string, string>) => i18nOf(lang).t(key, vars);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const party = (over: Partial<PartyView>): PartyView => ({
  id: 'p1', type: 'customer', code: 'C-0001', name: 'Mer', phone: '', address: '', accountCode: '1611', creditLimit: null, notes: '', active: true,
  balance: 0, hasEntries: true, balances: { IQD: 0, USD: 0 }, ...over
});

describe('1.4 texts', () => {
  it('has every text in Arabic, English and Kurdish', () => {
    for (const [key, value] of Object.entries(SHELL14_TEXT)) {
      expect(value.length, key).toBe(3);
      for (const text of value) expect(text.trim().length, key).toBeGreaterThan(0);
      // the same placeholders in the three languages
      const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      expect(holes(value[0]), key).toBe(holes(value[1]));
      expect(holes(value[2]), key).toBe(holes(value[1]));
    }
  });
});

describe('Customers: who owes whom, in plain words', () => {
  it('says "Owes us" for a customer who owes and "We owe him" for one who paid ahead, each currency on its own', () => {
    const mixed = party({ balance: 290_000, balances: { IQD: -10_000, USD: 20_000 } });
    expect(oweLines(mixed)).toEqual([{ side: 'advance', amount: 10_000, currency: 'IQD' }, { side: 'owes', amount: 20_000, currency: 'USD' }]);
    for (const lang of LANGS) {
      const html = wrap(<OweAmount party={mixed} />, lang);
      expect(html).toContain(esc(textOf(lang, 's14_owesUs')));
      expect(html).toContain(esc(textOf(lang, 's14_weOwe')));
      expect(html).toContain(esc(i18nOf(lang).money(20_000, 'USD')));
      expect(html).toContain(esc(i18nOf(lang).money(10_000, 'IQD')));
      // never a minus sign, a debit or a credit
      expect(html).not.toMatch(/[-−]\s?\d/);
    }
    expect(wrap(<OweAmount party={party({})} />)).toContain('—');
    expect(wrap(<OweAmount party={party({})} empty="Nothing owed" />)).toContain('Nothing owed');
  });

  it('turns the words round for a supplier: what we owe is "We owe him"', () => {
    expect(oweWords('customer', 'owes')).toBe('s14_owesUs');
    expect(oweWords('customer', 'advance')).toBe('s14_weOwe');
    expect(oweWords('supplier', 'owes')).toBe('s14_weOwe');
    expect(oweWords('supplier', 'advance')).toBe('s14_owesUs');
    expect(oweTone('customer', 'owes')).toBe('warn');
    expect(oweTone('supplier', 'owes')).toBe('bad');
    const html = wrap(<OweAmount party={party({ type: 'supplier', balance: 70_000, balances: { IQD: 70_000, USD: 0 } })} />);
    expect(html).toContain('We owe him');
    expect(html).toContain('owe-line bad');
  });

  it('shows a server without per-currency balances by its IQD total', () => {
    const old = party({ balance: 55_000 });
    delete (old as { balances?: unknown }).balances;
    expect(oweLines(old)).toEqual([{ side: 'owes', amount: 55_000, currency: 'IQD' }]);
  });

  it('puts the total above the list, per currency, with what was paid ahead only when there is any', () => {
    const totals: PartyTotals = { type: 'customer', owed: { IQD: 1_250_000, USD: 30_000 }, advance: { IQD: 0, USD: 0 }, owing: 4, advanced: 0 };
    for (const lang of LANGS) {
      const html = wrap(<PartyTotalsBar type="customer" totals={totals} />, lang);
      expect(html).toContain(esc(textOf(lang, 's14_oweCustomer')));
      expect(html).toContain(esc(i18nOf(lang).money(1_250_000, 'IQD')));
      expect(html).toContain(esc(i18nOf(lang).money(30_000, 'USD')));
      expect(html).toContain(esc(textOf(lang, 's14_owingCustomers', { n: '4' })));
      expect(html).not.toContain(esc(textOf(lang, 's14_oweCustomerAdv')));
    }
    const supplier = wrap(<PartyTotalsBar type="supplier" totals={{ type: 'supplier', owed: { IQD: 70_000, USD: 0 }, advance: { IQD: 5_000, USD: 0 }, owing: 1, advanced: 1 }} />);
    expect(supplier).toContain('You owe suppliers');
    expect(supplier).toContain('Suppliers owe you (paid ahead)');
    expect(supplier).not.toContain('$');
    const none = wrap(<PartyTotalsBar type="customer" totals={{ type: 'customer', owed: { IQD: 0, USD: 0 }, advance: { IQD: 0, USD: 0 }, owing: 0, advanced: 0 }} />);
    expect(none).toContain('No customer owes you anything.');
    // an office PC not yet on 1.4 has no totals: the list still shows
    expect(wrap(<PartyTotalsBar type="customer" totals={null} />)).toBe('');
  });

  it('filters to those who owe and sorts by the biggest debt, even when the server did neither', () => {
    const list = [
      party({ id: 'a', balance: 50_000, balances: { IQD: 50_000, USD: 0 } }),
      party({ id: 'b', balance: -25_000, balances: { IQD: -25_000, USD: 0 } }),
      party({ id: 'c', balance: 300_000, balances: { IQD: 0, USD: 20_000 } }),
      party({ id: 'd' })
    ];
    expect(shownParties(list, true, 'debt').map((p) => p.id)).toEqual(['c', 'a']);
    expect(shownParties(list, false, 'debt').map((p) => p.id)).toEqual(['c', 'a', 'd', 'b']);
    expect(shownParties(list, false, 'code').map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(list.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']); // the loaded list is left as it came
  });
});

describe('where the data is', () => {
  const here = { hostname: '127.0.0.1', host: '127.0.0.1:51000' };
  const office = { hostname: '192.168.1.20', host: '192.168.1.20:47420' };

  it('is the office PC on a connected PC, by the name the Windows app gives', () => {
    expect(readDataPlace({ role: 'client', host: '192.168.1.20', relay: false }, null, office)).toEqual({ kind: 'office', host: '192.168.1.20', relay: false });
    // through Qasa Relay the page's own address is this PC's end of the tunnel: the app's word counts, not the address
    expect(readDataPlace({ role: 'client', host: 'Qasa Relay · 12345-67890', relay: true }, null, here)).toEqual({ kind: 'office', host: 'Qasa Relay · 12345-67890', relay: true });
    expect(readDataPlace({ role: 'local' }, null, here)).toEqual({ kind: 'local' });
  });

  it('is still told on an older Windows app (its support details) and in a browser (its address)', () => {
    expect(readDataPlace(null, 'client', office)).toEqual({ kind: 'office', host: '192.168.1.20:47420', relay: false });
    expect(readDataPlace(null, 'client', here)).toEqual({ kind: 'office', host: '', relay: true });
    expect(readDataPlace(null, 'local', here)).toEqual({ kind: 'local' });
    expect(readDataPlace(null, null, office)).toEqual({ kind: 'office', host: '192.168.1.20:47420', relay: false });
    expect(readDataPlace(null, null, { hostname: 'localhost', host: 'localhost:5173' })).toEqual({ kind: 'local' });
    // a name that is not one is left out, never shown
    expect(readDataPlace({ role: 'client', host: '<b>x</b>', relay: false }, null, here)).toEqual({ kind: 'office', host: '', relay: false });
  });

  it('never says "on this PC" on a connected PC: the status line, the backup hints, the network card and About', () => {
    const place: DataPlace = { kind: 'office', host: '192.168.1.20', relay: false };
    for (const lang of LANGS) {
      const t = i18nOf(lang).t;
      const local = textOf(lang, 'localMode');
      expect(dataPlaceLine(t, { kind: 'local' })).toBe(local);
      expect(dataPlaceLine(t, null)).toBe('');
      const line = dataPlaceLine(t, place);
      expect(line).toContain('192.168.1.20');
      expect(line).not.toContain(local);
      expect(dataPlaceLine(t, { kind: 'office', host: '', relay: true })).toBe(textOf(lang, 's14_dataOfficeNoName'));
      expect(officeText(t, place, 's14_officeDown')).toContain('192.168.1.20');

      const backups = wrap(<ClientBackupCard place={place} />, lang);
      expect(backups).toContain('192.168.1.20');
      expect(backups).not.toContain('<button');
      for (const key of ['bkHelp', 'bkManual', 'bkNow', 'bkOfficial', 'bkChooseFolder'] as Key[]) expect(backups, `${lang} ${key}`).not.toContain(esc(textOf(lang, key)));

      const network = wrap(<ClientNetworkCard place={place} />, lang);
      expect(network).toContain('192.168.1.20');
      expect(network).not.toContain(esc(textOf(lang, 'netHelp')));
      expect(network).not.toContain(esc(textOf(lang, 'netOfficial')));

      const about = wrap(<DataPlaceCard place={place} />, lang);
      expect(about).toContain('192.168.1.20');
      expect(about).not.toContain(esc(local));
      expect(wrap(<DataPlaceCard place={{ kind: 'local' }} />, lang)).toContain(esc(local));
    }
    // an address keeps its own digits, whatever digits the person reads numbers in
    const eastern = makeI18n('ar', 'eastern', () => {}, () => {});
    expect(dataPlaceLine(eastern.t, place)).toContain('192.168.1.20');
    expect(wrap(<DataPlaceCard place={null} />)).toBe('');
  });

  it('names no File menu and no company file of its own in a browser on the office network: only the Windows app has them', () => {
    const place: DataPlace = { kind: 'office', host: '192.168.1.20:47420', relay: false };
    const fileMenu: Record<Lang, string> = { ar: 'قائمة «ملف»', en: 'File menu', ku: 'لیستی «فایل»' };
    for (const lang of LANGS) {
      const said = (key: Key) => esc(officeText(i18nOf(lang).t, place, key));
      // (these pages are rendered outside the Windows app: a browser is what the card takes itself to be in)
      for (const browser of [wrap(<ClientNetworkCard place={place} />, lang), wrap(<ClientNetworkCard place={place} browser />, lang)]) {
        expect(browser, lang).toContain(said('s14_netBrowser'));
        expect(browser, lang).toContain('192.168.1.20:47420');
        expect(browser, lang).not.toContain(esc(fileMenu[lang]));
        // what is set up on the office PC itself is still said, and none of its cards is offered
        expect(browser, lang).toContain(esc(textOf(lang, 's14_netClientSettings')));
        expect(browser, lang).not.toContain('<button');
      }
      const app = wrap(<ClientNetworkCard place={place} browser={false} />, lang);
      expect(app, lang).toContain(said('s14_netClient'));
      expect(app, lang).toContain(esc(fileMenu[lang]));
      expect(textOf(lang, 's14_netClient')).toContain(fileMenu[lang]);
    }
  });
});

describe('the dollar rate at the top of the window', () => {
  const board = { date: '2026-11-14', rateX100: 131_000, source: 'board' as const };

  it('reads "$1 = 1,310 IQD" and is a link to the rate board only for someone who may enter rates', () => {
    const link = wrap(<HeaderRateView rate={board} canSet />);
    expect(link).toContain('$1 = 1,310 IQD');
    expect(link).toMatch(/<a [^>]*href="#\/rates"/);
    expect(link).toContain('$100 = 131,000 IQD');
    const plain = wrap(<HeaderRateView rate={board} canSet={false} />);
    expect(plain).toContain('$1 = 1,310 IQD');
    expect(plain).not.toContain('<a ');
    // Arabic and Kurdish write the word, so the line reads in their direction
    expect(wrap(<HeaderRateView rate={board} canSet={false} />, 'ar')).toContain('1 دولار = 1,310 دينار');
    expect(wrap(<HeaderRateView rate={board} canSet={false} />, 'ku')).toContain('1 دۆلار = 1,310 دینار');
  });

  it('shows a rate per $100 that does not divide evenly, and says when it is the company’s usual rate', () => {
    expect(perDollar(i18nOf('en'), 146_550)).toBe('1,465.5');
    expect(perDollar(i18nOf('en'), 131_000)).toBe('1,310');
    expect(wrap(<HeaderRateView rate={{ date: null, rateX100: 131_000, source: 'default' }} canSet={false} />)).toContain(esc(textOf('en', 's14_rateUsual', { hundred: '$100', r: '131,000' })));
  });

  it('without a rate: a quiet "Set dollar rate" link for those who may, nothing for anyone else', () => {
    expect(hasRate(null)).toBe(false);
    expect(hasRate({ date: null, rateX100: 0, source: 'default' })).toBe(false);
    for (const lang of LANGS) {
      const html = wrap(<HeaderRateView rate={null} canSet />, lang);
      expect(html).toContain(esc(textOf(lang, 's14_rateSet')));
      expect(html).toMatch(/<a [^>]*href="#\/rates"/);
    }
    expect(wrap(<HeaderRateView rate={{ date: null, rateX100: 0, source: 'default' }} canSet={false} />)).toBe('');
  });
});

describe('Settings → Backups: the question at closing', () => {
  it('reads the app’s answer strictly, and shows the setting with its help in each language', () => {
    expect(closeAskOf({ ask: false })).toBe(false);
    expect(closeAskOf({ ask: true })).toBe(true);
    expect(closeAskOf(null)).toBeNull(); // a PC connected to an office PC: nothing shows
    expect(closeAskOf({ ask: 'yes' })).toBeNull();
    for (const lang of LANGS) {
      const html = wrap(<CloseAskView ask busy={false} onChange={() => {}} />, lang);
      expect(html).toContain(esc(textOf(lang, 's14_closeAsk')));
      expect(html).toContain(esc(textOf(lang, 's14_closeAskHelp')));
      expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
    }
    expect(wrap(<CloseAskView ask={false} busy={false} onChange={() => {}} />)).not.toMatch(/checked=""/);
  });
});

describe('Settings → Printers: this computer’s printers', () => {
  const printers: PrinterInfo[] = [
    { name: 'Office Laser', displayName: 'Office Laser', isDefault: true, state: 'ready', guess: 'page' },
    { name: 'XP-80C', displayName: 'XP-80C', state: 'offline', guess: 'receipt80' },
    { name: 'XP-58', displayName: 'XP-58', guess: 'receipt58' },
    { name: 'ZDesigner GK420t', displayName: 'ZDesigner GK420t', guess: 'label' },
    { name: 'Microsoft Print to PDF', displayName: 'Microsoft Print to PDF', guess: 'file' }
  ];
  const view = (choices: PrinterChoices = {}, list: PrinterInfo[] = printers) => (
    <PrintersCardView desktop printers={list} choices={choices} busy={null} error={null} onChange={() => {}} onTest={() => {}} onRefresh={() => {}} onUseSuggested={() => {}} />
  );

  it('keeps only real details from the app’s answer', () => {
    expect(printersOf([{ name: 'A', displayName: 'A', isDefault: true, state: 'ready', guess: 'page' }, { name: 'B', isDefault: 'yes', state: 'on fire', guess: 'toaster' }, { name: 'C', state: 'unknown' }]))
      .toEqual([{ name: 'A', displayName: 'A', isDefault: true, state: 'ready', guess: 'page' }, { name: 'B', displayName: 'B' }, { name: 'C', displayName: 'C' }]);
    expect(defaultPrinter(printers)?.name).toBe('Office Laser');
    expect(defaultPrinter([{ name: 'B', displayName: 'B' }])).toBeNull();
  });

  it('suggests the default printer for pages, a receipt printer for receipts and a label printer for labels', () => {
    expect(suggestPrinter('invoice', printers)).toEqual({ printer: 'Office Laser', paper: 'A4' });
    expect(suggestPrinter('report', printers)).toEqual({ printer: 'Office Laser', paper: 'A4' });
    // the 80 mm one is offline now: the one that is not comes first, with its own roll width
    expect(suggestPrinter('receipt', printers)).toEqual({ printer: 'XP-58', paper: 'receipt58' });
    expect(suggestPrinter('receipt', printers.filter((p) => p.name !== 'XP-58'))).toEqual({ printer: 'XP-80C', paper: 'receipt80' });
    expect(suggestPrinter('label', printers)).toEqual({ printer: 'ZDesigner GK420t', paper: 'label38x25' });
    // a printer that only saves a file is never suggested, and nothing is guessed without the app's details
    expect(suggestPrinter('invoice', [printers[4]!])).toBeNull();
    expect(suggestPrinter('invoice', [{ name: 'Old app', displayName: 'Old app' }])).toBeNull();
    // a suggestion still opens the print window: nothing prints without asking until the person says so
    expect(suggestedChoice('receipt', printers)).toEqual({ printer: 'XP-58', paper: 'receipt58', margins: 'default', copies: 1, silent: false });
    // among page printers the Windows default wins
    const two: PrinterInfo[] = [{ name: 'A', displayName: 'A', guess: 'page' }, { name: 'B', displayName: 'B', guess: 'page', isDefault: true }];
    expect(suggestPrinter('voucher', two)?.printer).toBe('B');
  });

  it('shows each printer with its default mark, state and kind, and a suggestion for each kind with none chosen, in each language', () => {
    for (const lang of LANGS) {
      const html = wrap(view(), lang);
      for (const key of ['s14_prnInstalled', 's14_prnDefault', 's14_prnReady', 's14_prnOffline', 's14_prnSuggestHelp', 's14_prnUseAll', 's14_prnUse'] as Key[]) {
        expect(html, `${lang} ${key}`).toContain(esc(textOf(lang, key)));
      }
      expect(html).toContain(esc(textOf(lang, 's14_prnLooksLike', { g: textOf(lang, 's14_prnGuess_receipt80') })));
      expect(html).toContain(esc(textOf(lang, 's14_prnSuggested', { p: 'Office Laser' })));
      expect(html).toContain(`>${esc(`Office Laser — ${textOf(lang, 's14_prnDefault')}`)}</option>`);
    }
    const tiles = wrap(<InstalledPrinters printers={printers} />);
    expect(tiles.split('data-printer="').length - 1).toBe(printers.length);
    expect(tiles).toContain('printer-tile default');
  });

  it('offers no suggestion once every kind has a printer, and none from an older app that gives no details', () => {
    const all: PrinterChoices = Object.fromEntries((['invoice', 'voucher', 'quote', 'receipt', 'label', 'report'] as const)
      .map((k) => [k, { printer: 'Office Laser', paper: 'A4', margins: 'default', copies: 1, silent: false }])) as PrinterChoices;
    const html = wrap(view(all));
    expect(html).not.toContain('Use the suggested printers');
    expect(html).not.toContain('Suggested:');
    const old = wrap(view({}, [{ name: 'Office Laser', displayName: 'Office Laser' }]));
    expect(old).not.toContain('Printers on this computer');
    expect(old).not.toContain('Suggested:');
    expect(old).toContain('>Office Laser</option>');
  });

  it('says a printer that is gone prints on the Windows default meanwhile, and that a chosen printer is offline', () => {
    const html = wrap(view({
      label: { printer: 'Old label printer', paper: 'label38x25', margins: 'none', copies: 1, silent: false },
      receipt: { printer: 'XP-80C', paper: 'receipt80', margins: 'none', copies: 1, silent: true }
    }));
    expect(html).toContain(esc(textOf('en', 's14_prnGoneDefault', { p: 'Old label printer', d: 'Office Laser' })));
    expect(html).toContain(esc(textOf('en', 's14_prnOfflineNote', { p: 'XP-80C' })));
    // without a known default, as before: the print window opens until another is chosen
    const noDefault = wrap(view({ label: { printer: 'Old label printer', paper: 'label38x25', margins: 'none', copies: 1, silent: false } }, printers.map((p) => ({ ...p, isDefault: false }))));
    expect(noDefault).toContain(esc(textOf('en', 'prn_goneHelp', { p: 'Old label printer' })));
  });

  it('tells the person when a paper went to the Windows default printer instead of the saved one', async () => {
    expect(outcomeOf({ status: 'printed', fallback: { from: 'Receipts', to: 'Office Laser' } })).toEqual({ status: 'printed', fallback: { from: 'Receipts', to: 'Office Laser' } });
    expect(outcomeOf({ status: 'printed', fallback: { from: 'Receipts', to: 7 } })).toEqual({ status: 'printed' });
    const notices: PrintNotice[] = [];
    const dialog = vi.fn();
    const desktop: DesktopPrinters = {
      list: async () => [], set: async () => null,
      get: async () => ({ receipt: { printer: 'Receipts', paper: 'receipt80', margins: 'none', copies: 1, silent: true } }),
      print: async () => ({ status: 'printed', fallback: { from: 'Receipts', to: 'Office Laser' } })
    };
    expect(await printDocument('receipt', { desktop, dialog, notify: (n) => notices.push(n), markPaper: () => {}, paint: async () => {} })).toBe('printed');
    expect(notices).toEqual([{ code: 'fallback', printer: 'Receipts', to: 'Office Laser' }]);
    expect(dialog).not.toHaveBeenCalled();
    for (const lang of LANGS) expect(textOf(lang, 's14_prn_n_fallback', { p: 'Receipts', d: 'Office Laser' })).toContain('Office Laser');
  });
});

describe('Settings: a section’s name is said once', () => {
  it('marks a card heading that only repeats the open section’s name, and unmarks it when it no longer does', () => {
    const heading = (text: string, title = false) => {
      const classes = new Set<string>(title ? ['settings-section-title'] : []);
      return {
        textContent: text,
        classes,
        classList: {
          contains: (c: string) => classes.has(c),
          toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c); }
        }
      };
    };
    const title = heading('Printers', true);
    const same = heading('  Printers ');
    const other = heading('Print design');
    const root = { querySelectorAll: (selector: string) => (selector === 'h2:not(.settings-section-title)' ? [same, other] : [title, same, other]) } as unknown as ParentNode;
    markRepeatedHeadings(root, 'Printers');
    expect(same.classes.has('settings-repeat-title')).toBe(true);
    expect(other.classes.has('settings-repeat-title')).toBe(false);
    expect(title.classes.has('settings-repeat-title')).toBe(false);
    // another language: the name changed, and so did the heading
    same.textContent = 'الطابعات';
    markRepeatedHeadings(root, 'Printers');
    expect(same.classes.has('settings-repeat-title')).toBe(false);
  });
});
