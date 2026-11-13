import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PAPER_MICRONS, PRINT_KINDS, PRINTER_PAPERS, type Lang, type PrinterChoices } from '@qasa/core';
import { I18nContext, makeI18n, type Key } from '../i18n.ts';
import { goneIn, PrintersCard, PrintersCardView, PrintTestSheet, testSheetLayout, withPrinter, type PrintersCardViewProps } from './Printers.tsx';

const LANGS: Lang[] = ['ar', 'en', 'ku'];
const wrap = (node: ReactNode, lang: Lang) => renderToStaticMarkup(
  <I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}>{node}</I18nContext.Provider>
);
const textOf = (lang: Lang, key: Key, vars?: Record<string, string>) => makeI18n(lang, 'western', () => {}, () => {}).t(key, vars);
/** React escapes text in HTML; compare with the same escaping */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const printers = [{ name: 'Office Laser', displayName: 'Office Laser' }, { name: 'Receipts', displayName: 'Receipt printer' }];
const choices: PrinterChoices = {
  receipt: { printer: 'Receipts', paper: 'receipt80', margins: 'none', copies: 2, silent: true },
  label: { printer: 'Old label printer', paper: 'label38x25', margins: 'none', copies: 1, silent: false }
};
const view = (props: Partial<PrintersCardViewProps> = {}) => (
  <PrintersCardView desktop printers={printers} choices={choices} busy={null} error={null} onChange={() => {}} onTest={() => {}} onRefresh={() => {}} {...props} />
);

describe('Settings → Printers', () => {
  it('in a browser and the website demo, says printing uses the browser’s print window, in each language', () => {
    for (const lang of LANGS) {
      // no Windows app here: the card itself decides it is the browser
      const html = wrap(<PrintersCard />, lang);
      expect(html).toContain(esc(textOf(lang, 'prn_title')));
      expect(html).toContain(esc(textOf(lang, 'prn_browser')));
      expect(html).not.toContain('<select');
    }
  });

  it('in the Windows app, lists every kind of paper with its printer, paper, margins, copies, silence and test page, in each language', () => {
    for (const lang of LANGS) {
      const html = wrap(view(), lang);
      for (const kind of PRINT_KINDS) {
        expect(html).toContain(`data-kind="${kind}"`);
        expect(html).toContain(esc(textOf(lang, `prn_kind_${kind}` as Key)));
      }
      for (const key of ['prn_title', 'prn_help', 'prn_printer', 'prn_ask', 'prn_paper', 'prn_margins', 'prn_copies', 'prn_silent', 'prn_test', 'prn_paper_receipt58', 'prn_margins_minimum'] as Key[]) {
        expect(html, `${lang} ${key}`).toContain(esc(textOf(lang, key)));
      }
      expect(html).toContain('>Receipt printer</option>');
      expect(html.split(esc(textOf(lang, 'prn_test')) + '</button>').length - 1).toBe(PRINT_KINDS.length);
      expect(html).not.toContain(esc(textOf(lang, 'prn_browser')));
    }
  });

  it('shows the saved choice: printer picked, its paper and copies, and "Print without asking" ticked', () => {
    const html = wrap(view(), 'en');
    const row = html.slice(html.indexOf('data-kind="receipt"'), html.indexOf('data-kind="label"'));
    expect(row).toMatch(/<option value="Receipts" selected="">Receipt printer<\/option>/);
    expect(row).toMatch(/<option value="receipt80" selected="">/);
    expect(row).toMatch(/<option value="2" selected="">2<\/option>/);
    expect(row).toMatch(/type="checkbox"[^>]*checked=""/);
    // copies go from 1 to 5
    expect(row).toContain('<option value="5">5</option>');
    expect(row).not.toContain('<option value="6">');
  });

  it('keeps paper, margins, copies and silence off while a kind asks every time', () => {
    const html = wrap(view(), 'en');
    const row = html.slice(html.indexOf('data-kind="invoice"'), html.indexOf('data-kind="voucher"'));
    expect(row).toMatch(/<option value="" selected="">Ask every time<\/option>/);
    // paper, copies and silence, and the three margins rectangles
    expect((row.match(/disabled=""/g) ?? []).length).toBe(6);
  });

  it('offers the margins of each kind as three rectangles on a row of their own, the saved one chosen', () => {
    for (const lang of LANGS) {
      const html = wrap(view(), lang);
      expect(html).not.toMatch(/<select[^>]*aria-label="[^"]*">\s*<option value="default"/);
      for (const kind of PRINT_KINDS) expect(html, kind).toContain(`<tr class="printers-margins" data-margins="${kind}">`);
      expect(html.split('role="radiogroup"').length - 1).toBe(PRINT_KINDS.length);
      const row = html.slice(html.indexOf('data-kind="receipt"'), html.indexOf('data-kind="label"'));
      const group = esc(`${textOf(lang, 'prn_margins')} — ${textOf(lang, 'prn_kind_receipt')}`);
      expect(row).toContain(`role="radiogroup" aria-label="${group}"`);
      expect(row.split('role="radio"').length - 1).toBe(3);
      // the receipt printer was saved with no margins: that rectangle is the chosen one, with the check mark
      expect(row.split('aria-checked="true"').length - 1).toBe(1);
      expect(row).toMatch(new RegExp(`aria-checked="true"[^>]*><span class="choice-check"[^>]*>.*?</span><span class="choice-label">${esc(textOf(lang, 'prn_margins_none'))}<`));
    }
  });

  it('says when a saved printer is gone and when Windows lists none, in each language', () => {
    for (const lang of LANGS) {
      const html = wrap(view(), lang);
      expect(html).toContain(esc(textOf(lang, 'prn_goneHelp', { p: 'Old label printer' })));
      expect(html).toContain(esc(`Old label printer — ${textOf(lang, 'prn_gone')}`));
      const empty = wrap(view({ printers: [], choices: {} }), lang);
      expect(empty).toContain(esc(textOf(lang, 'prn_none')));
    }
  });

  it('with the saved printer gone, offers only another printer: the other settings are off and it says to choose one, in each language', () => {
    for (const lang of LANGS) {
      const html = wrap(view(), lang);
      const row = html.slice(html.indexOf('data-kind="label"'), html.indexOf('data-kind="report"'));
      // paper, copies, silence and the three margins rectangles are off; the printer and the test page are not
      expect((row.match(/disabled=""/g) ?? []).length, lang).toBe(6);
      expect(row).toMatch(/<select class="input" aria-label="[^"]*"><option value="">/);
      expect(row).toContain(esc(textOf(lang, 'prn_chooseOther')));
      // a row whose printer is there keeps its settings on
      const receipt = html.slice(html.indexOf('data-kind="receipt"'), html.indexOf('data-kind="label"'));
      expect(receipt).not.toContain('disabled=""');
      expect(receipt).not.toContain(esc(textOf(lang, 'prn_chooseOther')));
    }
  });

  it('keeps the table inside a 1366 px screen: copies take little room, the paper names more', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    expect(css).toContain('.printers-table select { min-inline-size: 4.5em; }');
    expect(css).toContain('.printers-table tr.printers-kind > td:nth-child(2) select { min-inline-size: 11em; }');
    expect(css).toContain('.printers-table tr.printers-kind > td:nth-child(3) select { min-inline-size: 11.5em; }');
    expect(css).toContain('.printers-table td:first-child { min-inline-size: 10.5em; }');
    // the columns are the printer (2), the paper (3) and the copies (4), as the rules above count them
    const html = wrap(view(), 'en');
    const row = html.slice(html.indexOf('data-kind="receipt"'), html.indexOf('data-margins="receipt"'));
    const cells = row.split('<td').slice(1);
    expect(cells[1]).toContain('<option value="Receipts"');
    expect(cells[2]).toContain('<option value="receipt80"');
    expect(cells[3]).toContain('class="input num"');
  });

  it('knows a saved printer that Windows no longer lists', () => {
    expect(goneIn(choices.label, printers)).toBe('Old label printer');
    expect(goneIn(choices.receipt, printers)).toBeNull();
    expect(goneIn(null, printers)).toBeNull();
    expect(goneIn({ ...choices.receipt!, printer: null }, printers)).toBeNull();
    // while the printers are read, nothing is called gone
    expect(goneIn(choices.label, null)).toBeNull();
    expect(goneIn(choices.receipt, [])).toBe('Receipts');
  });

  it('says the printers are being read', () => {
    expect(wrap(view({ printers: null }), 'ku')).toContain(esc(textOf('ku', 'prn_loading')));
  });

  it('a first printer starts on the paper its kind usually takes; none is "Ask every time"', () => {
    expect(withPrinter('receipt', undefined, 'Receipts')).toEqual({ printer: 'Receipts', paper: 'receipt80', margins: 'default', copies: 1, silent: false });
    expect(withPrinter('label', undefined, 'Labels')!.paper).toBe('label38x25');
    expect(withPrinter('receipt', choices.receipt, 'Office Laser')).toEqual({ ...choices.receipt, printer: 'Office Laser' });
    expect(withPrinter('receipt', choices.receipt, null)).toBeNull();
  });

  it('the test page names the paper, printer and settings in the app’s language', () => {
    for (const lang of LANGS) {
      const html = wrap(<PrintTestSheet kind="receipt" choice={choices.receipt} />, lang);
      expect(html).toContain(esc(textOf(lang, 'prn_testTitle')));
      expect(html).toContain(esc(textOf(lang, 'prn_kind_receipt')));
      expect(html).toContain('Receipts');
      expect(html).toContain(esc(textOf(lang, 'prn_testBody', { w: '50', h: '20' })));
      expect(html).toContain(lang === 'en' ? 'dir="ltr"' : 'dir="rtl"');
    }
  });

  it('the test page fits each paper, with a box that fits it too', () => {
    for (const paper of PRINTER_PAPERS) {
      const l = testSheetLayout(paper);
      const size = PAPER_MICRONS[paper];
      expect(l.box.width, paper).toBeLessThanOrEqual(l.width ?? 50);
      if (l.height !== null) expect(l.box.height, paper).toBeLessThan(l.height);
      if (size) {
        // a roll or a label: narrower than the paper, with room for the printer's own edge
        expect(l.width, paper).not.toBeNull();
        expect(l.width! + 4, paper).toBeLessThanOrEqual(size.width / 1000);
        if (paper.startsWith('label')) expect(l.height! + 4, paper).toBeLessThanOrEqual(size.height / 1000);
      }
    }
    expect(testSheetLayout('label38x25').fit).toBe('label');
    expect(testSheetLayout('label50x30').fit).toBe('label');
    expect(testSheetLayout('receipt58')).toMatchObject({ width: 48, fit: 'roll' });
    expect(testSheetLayout('receipt80')).toMatchObject({ width: 72, fit: 'roll' });
    expect(testSheetLayout('A4')).toMatchObject({ width: null, box: { width: 50, height: 20 }, fit: 'page' });
  });

  it('on a small label, the test page is the label’s size with only what fits, in each language', () => {
    for (const lang of LANGS) {
      const html = wrap(<PrintTestSheet kind="label" choice={{ ...choices.label!, printer: 'Labels', paper: 'label38x25' }} />, lang);
      expect(html).toContain('data-paper="label38x25"');
      expect(html).toContain('inline-size:34mm;block-size:21mm');
      expect(html).toContain('inline-size:30mm;block-size:8mm');
      expect(html).toContain(esc(textOf(lang, 'prn_testBoxSize', { w: '30', h: '8' })));
      expect(html).toContain('Labels');
      expect(html).toContain(esc(textOf(lang, 'prn_paper_label38x25')));
      // the long lines stay off the label
      expect(html).not.toContain(esc(textOf(lang, 'prn_testBody', { w: '30', h: '8' })));
      expect(html).not.toContain('0123456789');
    }
    const fifty = wrap(<PrintTestSheet kind="label" choice={{ ...choices.label!, printer: 'Labels', paper: 'label50x30' }} />, 'en');
    expect(fifty).toContain('inline-size:46mm;block-size:26mm');
    expect(fifty).toContain('inline-size:40mm;block-size:10mm');
  });

  it('on a receipt roll, the test page is as narrow as the receipt and says the size of its box', () => {
    const html = wrap(<PrintTestSheet kind="receipt" choice={{ ...choices.receipt!, paper: 'receipt58' }} />, 'ar');
    expect(html).toContain('inline-size:48mm');
    expect(html).toContain('inline-size:40mm;block-size:15mm');
    expect(html).toContain(esc(textOf('ar', 'prn_testBody', { w: '40', h: '15' })));
  });
});
