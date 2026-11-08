import { describe, expect, it } from 'vitest';
import {
  checkPrinterChoice, DEFAULT_PRINTER_CHOICE, devicePrintOptions, isPrinterName, isPrintKind, MAX_PRINT_COPIES, PAPER_MICRONS, PRINT_KINDS,
  PRINTER_PAPERS, readPrinterChoices, USUAL_PAPER, type PrinterChoice
} from './printers.ts';

const ok: PrinterChoice = { printer: 'Office Laser', paper: 'A4', margins: 'default', copies: 1, silent: false };

describe('a printer choice', () => {
  it('keeps a valid choice as it is', () => {
    expect(checkPrinterChoice(ok)).toEqual(ok);
    expect(checkPrinterChoice({ ...ok, printer: null })).toEqual({ ...ok, printer: null });
    expect(checkPrinterChoice(DEFAULT_PRINTER_CHOICE)).toEqual(DEFAULT_PRINTER_CHOICE);
  });

  it('refuses anything not on the lists, and never cuts or guesses', () => {
    for (const bad of [
      null, undefined, 'A4', [], 42,
      { ...ok, paper: 'A3' }, { ...ok, paper: 'a4' }, { ...ok, margins: 'custom' },
      { ...ok, copies: 0 }, { ...ok, copies: MAX_PRINT_COPIES + 1 }, { ...ok, copies: 1.5 }, { ...ok, copies: '2' }, { ...ok, copies: Number.NaN },
      { ...ok, silent: 'yes' }, { ...ok, silent: undefined },
      { ...ok, printer: '' }, { ...ok, printer: ' Office Laser' }, { ...ok, printer: 'Office\nLaser' }, { ...ok, printer: 'x'.repeat(257) },
      { ...ok, printer: 7 }, { ...ok, printer: undefined }
    ]) expect(checkPrinterChoice(bad), JSON.stringify(bad)).toBeNull();
  });

  it('takes a printer only when Windows lists it now', () => {
    expect(checkPrinterChoice(ok, ['Office Laser', 'Receipts'])).toEqual(ok);
    expect(checkPrinterChoice(ok, ['Receipts'])).toBeNull();
    expect(checkPrinterChoice(ok, [])).toBeNull();
    // "Ask every time" needs no printer
    expect(checkPrinterChoice({ ...ok, printer: null }, [])).not.toBeNull();
  });

  it('never prints silently without a printer', () => {
    expect(checkPrinterChoice({ ...ok, printer: null, silent: true })!.silent).toBe(false);
    expect(checkPrinterChoice({ ...ok, silent: true })!.silent).toBe(true);
  });

  it('copies only the known fields', () => {
    expect(checkPrinterChoice({ ...ok, deviceName: 'Other', extra: 1 })).toEqual(ok);
  });

  it('knows its kinds and printer names', () => {
    expect(PRINT_KINDS.every(isPrintKind)).toBe(true);
    expect(isPrintKind('toString')).toBe(false);
    expect(isPrintKind('__proto__')).toBe(false);
    expect(isPrinterName('Microsoft Print to PDF')).toBe(true);
    expect(isPrinterName('\\\\office-pc\\Laser')).toBe(true);
    for (const kind of PRINT_KINDS) expect(PRINTER_PAPERS).toContain(USUAL_PAPER[kind]);
  });
});

describe('the saved choices of a PC', () => {
  it('keeps only valid kinds with valid choices', () => {
    const saved = readPrinterChoices({
      invoice: ok, receipt: { ...ok, paper: 'receipt80' }, report: { ...ok, copies: 99 }, cheque: ok, __proto__: ok, constructor: ok
    });
    expect(saved).toEqual({ invoice: ok, receipt: { ...ok, paper: 'receipt80' } });
    expect(Object.getPrototypeOf(saved)).toBe(Object.prototype);
  });

  it('reads anything else as nothing saved', () => {
    for (const bad of [null, undefined, 'x', [ok], 3]) expect(readPrinterChoices(bad)).toEqual({});
  });
});

describe('the options Electron prints with', () => {
  const printer = 'Office Laser';
  it('names the printer and passes copies and silence', () => {
    expect(devicePrintOptions({ ...ok, printer, copies: 3, silent: true })).toEqual({
      silent: true, deviceName: printer, printBackground: true, copies: 3, margins: { marginType: 'default' }, pageSize: 'A4'
    });
  });

  it('maps the margins', () => {
    expect(devicePrintOptions({ ...ok, printer, margins: 'none' }).margins).toEqual({ marginType: 'none' });
    expect(devicePrintOptions({ ...ok, printer, margins: 'minimum' }).margins).toEqual({ marginType: 'printableArea' });
  });

  it('maps A4 and A5 by name', () => {
    for (const paper of ['A4', 'A5'] as const) {
      const o = devicePrintOptions({ ...ok, printer, paper });
      expect(o.pageSize).toBe(paper);
      expect(o.usePrinterDefaultPageSize).toBeUndefined();
    }
  });

  it('"the printer’s usual paper" uses the paper set for the printer in Windows, never Electron’s A4', () => {
    const auto = devicePrintOptions({ ...ok, printer, paper: 'auto' });
    expect(auto.usePrinterDefaultPageSize).toBe(true);
    expect(auto).not.toHaveProperty('pageSize');
  });

  it('gives each receipt roll its own width in microns and a roll length, so it is never laid out on A4', () => {
    const r80 = devicePrintOptions({ ...ok, printer, paper: 'receipt80' });
    const r58 = devicePrintOptions({ ...ok, printer, paper: 'receipt58' });
    expect(r80.pageSize).toEqual({ width: 80_000, height: 297_000 });
    expect(r58.pageSize).toEqual({ width: 58_000, height: 297_000 });
    for (const o of [r80, r58]) {
      expect(o).not.toHaveProperty('usePrinterDefaultPageSize');
      const size = o.pageSize as { width: number; height: number };
      // Electron takes whole microns; a roll is longer than it is wide
      expect(Number.isInteger(size.width) && Number.isInteger(size.height)).toBe(true);
      expect(size.height).toBeGreaterThan(size.width);
    }
  });

  it('gives each label its size in microns', () => {
    expect(devicePrintOptions({ ...ok, printer, paper: 'label38x25' }).pageSize).toEqual({ width: 38_000, height: 25_000 });
    expect(devicePrintOptions({ ...ok, printer, paper: 'label50x30' }).pageSize).toEqual({ width: 50_000, height: 30_000 });
  });

  it('never passes both a page size and the printer’s own size, and never shares the size table', () => {
    for (const paper of PRINTER_PAPERS) {
      const o = devicePrintOptions({ ...ok, printer, paper });
      expect(('pageSize' in o) !== ('usePrinterDefaultPageSize' in o), paper).toBe(true);
      if (typeof o.pageSize === 'object') {
        o.pageSize.width = 1;
        expect(PAPER_MICRONS[paper]!.width).not.toBe(1);
      }
    }
  });
});
