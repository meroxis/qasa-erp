/**
 * Printers (Windows app, Settings → Printers): for each kind of paper, which printer of this PC it goes to, on what
 * paper, with what margins and how many copies, and whether it prints without asking. The choices belong to the PC,
 * not to the company: they are kept by the Windows app next to its language and appearance, never in the company file.
 *
 * Both sides use these checks: the page before it saves, and the Windows app's main process (which trusts nothing the
 * page sends) before it saves and again before it prints.
 */

/** The kinds of paper a printer can be chosen for. Each print button in the app belongs to one of them. */
export const PRINT_KINDS = ['invoice', 'voucher', 'quote', 'receipt', 'label', 'report'] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];

/**
 * Paper sizes: the printer's own paper ('auto', as the paper's design asks), A4 and A5, the two receipt rolls and the
 * label sizes of the barcode labels page (an A4 label sheet is A4).
 */
export const PRINTER_PAPERS = ['auto', 'A4', 'A5', 'receipt80', 'receipt58', 'label38x25', 'label50x30'] as const;
export type PrinterPaper = (typeof PRINTER_PAPERS)[number];

/** default: the printer's usual margins; none: edge to edge; minimum: as close to the edge as the printer can print. */
export const PRINTER_MARGINS = ['default', 'none', 'minimum'] as const;
export type PrinterMargins = (typeof PRINTER_MARGINS)[number];

export const MAX_PRINT_COPIES = 5;
/** Windows printer names are at most 220 characters; anything longer isn't one. */
export const MAX_PRINTER_NAME = 256;

export interface PrinterChoice {
  /** the printer's Windows name; null = ask every time (the print window opens, as before) */
  printer: string | null;
  paper: PrinterPaper;
  margins: PrinterMargins;
  /** 1 to MAX_PRINT_COPIES */
  copies: number;
  /** print straight to the printer, without the print window (only with a printer chosen) */
  silent: boolean;
}

export type PrinterChoices = Partial<Record<PrintKind, PrinterChoice>>;

export const DEFAULT_PRINTER_CHOICE: PrinterChoice = { printer: null, paper: 'auto', margins: 'default', copies: 1, silent: false };

/** The paper a kind usually takes, offered first when a printer is chosen for it. */
export const USUAL_PAPER: Record<PrintKind, PrinterPaper> = {
  invoice: 'A4', voucher: 'A4', quote: 'A4', receipt: 'receipt80', label: 'label38x25', report: 'A4'
};

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

export const isPrintKind = (v: unknown): v is PrintKind => oneOf(PRINT_KINDS, v);

/** A printer name as Windows gives it: text, not empty, not too long, no control characters. */
export function isPrinterName(v: unknown): v is string {
  // eslint-disable-next-line no-control-regex
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_PRINTER_NAME && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);
}

/**
 * A choice for one kind, checked field by field; null when anything is wrong (nothing is guessed or cut to fit).
 * With `printers` (the names Windows lists now) the printer must be one of them. Without a printer, the choice
 * never prints silently.
 */
export function checkPrinterChoice(input: unknown, printers?: readonly string[]): PrinterChoice | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const c = input as Record<string, unknown>;
  const printer = c.printer === null ? null : isPrinterName(c.printer) ? c.printer : undefined;
  if (printer === undefined) return null;
  if (printer !== null && printers && !printers.includes(printer)) return null;
  if (!oneOf(PRINTER_PAPERS, c.paper) || !oneOf(PRINTER_MARGINS, c.margins)) return null;
  if (typeof c.copies !== 'number' || !Number.isInteger(c.copies) || c.copies < 1 || c.copies > MAX_PRINT_COPIES) return null;
  if (typeof c.silent !== 'boolean') return null;
  return { printer, paper: c.paper, margins: c.margins, copies: c.copies, silent: printer !== null && c.silent };
}

/** The saved choices as read back from the PC (a file anyone could have edited): only the valid kinds and choices stay. */
export function readPrinterChoices(input: unknown): PrinterChoices {
  const out: PrinterChoices = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const kind of PRINT_KINDS) {
    if (!Object.prototype.hasOwnProperty.call(input, kind)) continue;
    const choice = checkPrinterChoice((input as Record<string, unknown>)[kind]);
    if (choice) out[kind] = choice;
  }
  return out;
}

/**
 * Paper sizes in microns, as Electron takes a custom page size. A receipt roll has no end, so it gets the length its
 * printer drivers usually offer (80 × 297 mm, 58 × 297 mm): a long receipt goes on to the next length. Without a size
 * of its own, Electron would lay the receipt out on A4.
 */
export const PAPER_MICRONS: Readonly<Partial<Record<PrinterPaper, { readonly width: number; readonly height: number }>>> = {
  receipt80: { width: 80_000, height: 297_000 },
  receipt58: { width: 58_000, height: 297_000 },
  label38x25: { width: 38_000, height: 25_000 },
  label50x30: { width: 50_000, height: 30_000 }
};

/** What Electron's webContents.print takes, from a saved choice with a printer. */
export interface DevicePrintOptions {
  silent: boolean;
  deviceName: string;
  printBackground: true;
  copies: number;
  margins: { marginType: 'default' | 'none' | 'printableArea' };
  pageSize?: 'A4' | 'A5' | { width: number; height: number };
  usePrinterDefaultPageSize?: true;
}

/**
 * The print options for a choice: A4 and A5 by name, the rolls and labels by their size in microns, and "the
 * printer's usual paper" as the printer has it set in Windows (never Electron's own A4). The page draws the receipt as
 * wide as the roll while it prints (data-print-paper on the page).
 */
export function devicePrintOptions(choice: PrinterChoice & { printer: string }): DevicePrintOptions {
  const options: DevicePrintOptions = {
    silent: choice.silent,
    deviceName: choice.printer,
    printBackground: true,
    copies: choice.copies,
    margins: { marginType: choice.margins === 'minimum' ? 'printableArea' : choice.margins }
  };
  const size = PAPER_MICRONS[choice.paper];
  if (choice.paper === 'A4' || choice.paper === 'A5') options.pageSize = choice.paper;
  else if (size) options.pageSize = { width: size.width, height: size.height };
  else options.usePrinterDefaultPageSize = true;
  return options;
}

/**
 * What asking the Windows app to print came to:
 *   printed     it went to the printer
 *   ask         no printer chosen for this kind ("Ask every time"): the page opens the print window
 *   noPrinters  Windows lists no printer on this PC: the print window opens, and the page says so
 *   missing     the chosen printer is gone (removed or renamed): the print window opens, and the page says so
 *   failed      the printer did not take it (offline, out of paper, a driver error): the page says so
 *   busy        another paper is still being sent
 *   refused     the request wasn't from the app's own page, or wasn't valid
 */
export type PrintOutcome =
  | { status: 'printed' }
  | { status: 'ask' }
  | { status: 'noPrinters' }
  | { status: 'missing'; printer: string }
  | { status: 'failed'; reason: 'cancelled' | 'printer' }
  | { status: 'busy' }
  | { status: 'refused' };

/** A printer as the Settings card lists it. */
export interface PrinterEntry { name: string; displayName: string }
