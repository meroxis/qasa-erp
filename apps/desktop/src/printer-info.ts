/**
 * What Windows knows about this PC's printers that Electron's list leaves out (1.4, Settings → Printers): which one is
 * the Windows default, whether each is ready or offline, and what kind it looks like (a receipt roll, labels, a page).
 *
 * Windows is asked with one fixed command (Get-CimInstance Win32_Printer), started by its full path with fixed
 * arguments: nothing the page or a file says is ever part of it, and no shell runs. When that fails (PowerShell is
 * turned off on this PC), the default alone is read from the registry with reg.exe, the same way. Every answer is
 * checked before use; without one, the printers simply show no state and no default.
 */
import { isPrinterName } from '@qasa/core';

export type PrinterState = 'ready' | 'offline' | 'unknown';
/** receipt: a thermal roll (80 or 58 mm); label: a label printer; page: A4 and the like; file: saves a file (PDF, XPS) */
export type PrinterGuess = 'receipt80' | 'receipt58' | 'label' | 'page' | 'file';

export interface WindowsPrinter {
  name: string;
  isDefault: boolean;
  state: PrinterState;
  /** the driver's name and paper names, for the guess only */
  driver: string;
  papers: string[];
}

/** Starts a program of Windows by its full path with fixed arguments; resolves with what it printed. */
export type RunFixed = (file: string, args: readonly string[]) => Promise<string>;

/** The one command sent to PowerShell. A constant: never built from anything. */
export const PRINTERS_COMMAND =
  '$ErrorActionPreference=\'Stop\';[Console]::OutputEncoding=[Text.Encoding]::UTF8;'
  + '@(Get-CimInstance -ClassName Win32_Printer | Select-Object Name,Default,WorkOffline,PrinterStatus,DriverName,PrinterPaperNames) | ConvertTo-Json -Compress -Depth 3';
export const POWERSHELL_ARGS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PRINTERS_COMMAND] as const;
export const DEFAULT_PRINTER_KEY = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows';
export const REG_ARGS = ['query', DEFAULT_PRINTER_KEY, '/v', 'Device'] as const;

/** Windows' own folder (never a name looked up on the PATH). */
export function windowsDir(env: Record<string, string | undefined> = process.env): string {
  const root = env.SystemRoot ?? env.windir ?? '';
  return /^[A-Za-z]:\\[^<>"|?*\r\n]{1,100}$/.test(root) ? root : 'C:\\Windows';
}
export const powershellPath = (env?: Record<string, string | undefined>) => `${windowsDir(env)}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
export const regPath = (env?: Record<string, string | undefined>) => `${windowsDir(env)}\\System32\\reg.exe`;

const MAX_PRINTERS = 100;

/** Win32_Printer's rows as PowerShell printed them (JSON): only well-formed printers stay. */
export function parseWindowsPrinters(text: string): WindowsPrinter[] {
  let rows: unknown;
  try { rows = JSON.parse(text.replace(/^\uFEFF/, '').trim()); } catch { return []; }
  const list = Array.isArray(rows) ? rows : rows && typeof rows === 'object' ? [rows] : [];
  const out: WindowsPrinter[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (!isPrinterName(r.Name) || out.some((p) => p.name === r.Name)) continue;
    // PrinterStatus: 3 idle, 4 printing, 5 warming up are ready; 7 is offline; the rest says nothing sure
    const status = typeof r.PrinterStatus === 'number' ? r.PrinterStatus : 0;
    const state: PrinterState = r.WorkOffline === true || status === 7 ? 'offline' : status === 3 || status === 4 || status === 5 ? 'ready' : 'unknown';
    const papers = Array.isArray(r.PrinterPaperNames) ? r.PrinterPaperNames.filter((p): p is string => typeof p === 'string').slice(0, 200).map((p) => p.slice(0, 80)) : [];
    out.push({ name: r.Name, isDefault: r.Default === true, state, driver: typeof r.DriverName === 'string' ? r.DriverName.slice(0, 200) : '', papers });
    if (out.length >= MAX_PRINTERS) break;
  }
  return out;
}

/** The default printer's name in reg.exe's answer ("Device    REG_SZ    Name,winspool,Ne01:"), or null. */
export function parseDefaultDevice(text: string): string | null {
  const line = text.split(/\r?\n/).find((l) => /^\s*Device\s+REG_SZ\s+/i.test(l));
  if (!line) return null;
  const value = line.replace(/^\s*Device\s+REG_SZ\s+/i, '').trim();
  // the name is everything before ",<driver>,<port>" (a name may hold commas itself)
  const name = value.replace(/,[^,]*,[^,]*$/, '').trim();
  return isPrinterName(name) ? name : null;
}

const RECEIPT = /\b(pos|thermal|receipt|tm-?[tmu]\d|tsp\d|rp-?\d{2,3}|rongta|bixolon|srp-?\d|xp-?(58|76|80|n160|q\d{2,3})|zj-?\d|gp-?(58|80|l80|u80)|ocpp-?\d|80\s?mm|58\s?mm|80c\b|58c\b)/i;
const NARROW = /\b(58\s?mm|xp-?58|gp-?58|pos-?58|zj-?58|58c)\b/i;
const LABEL = /\b(label|barcode|zebra|zd\d{3}|zt\d{3}|gk\d{3}|gx\d{3}|tsc|ttp-?\d|godex|dymo|ql-?\d{3,4}|xp-?(3\d\d|4\d\d|d?4\d{3}|dt\d+)|gp-?(1\d{3}|2\d{3}|3\d{3})|argox|datamax|honeywell\s?pc\d)/i;
const FILE = /\b(pdf|xps|onenote|fax|document writer|send to|print to file|anydesk|snagit)\b/i;
const ROLL_PAPER = /\b(80\s?(\(72(\.\d)?\))?\s?(mm)?\s?[x×*]\s?\d|72\s?mm|roll paper|receipt)/i;
const NARROW_PAPER = /\b(58\s?(\(48\))?\s?(mm)?\s?[x×*]\s?\d|48\s?mm)/i;

/**
 * What a printer looks like, from its names, its driver and the paper names the driver offers. A suggestion only:
 * the person chooses. A file printer first (a "PDF" in a name is never a roll), then labels, then rolls, else a page.
 */
export function guessPrinter(p: { name: string; displayName?: string; description?: string; driver?: string; papers?: readonly string[] }): PrinterGuess {
  const names = [p.name, p.displayName ?? '', p.description ?? '', p.driver ?? ''].join(' | ');
  if (FILE.test(names)) return 'file';
  if (LABEL.test(names)) return 'label';
  const papers = (p.papers ?? []).join(' | ');
  const hasPagePaper = /\bA4\b|\bletter\b/i.test(papers);
  if (RECEIPT.test(names) || (!hasPagePaper && (ROLL_PAPER.test(papers) || NARROW_PAPER.test(papers)))) {
    return NARROW.test(names) || (NARROW_PAPER.test(papers) && !ROLL_PAPER.test(papers)) ? 'receipt58' : 'receipt80';
  }
  return 'page';
}

/**
 * Asks Windows once: every printer with its default mark and state, or (PowerShell refused) only which one is the
 * default, or nothing. Never throws.
 */
export async function readWindowsPrinters(run: RunFixed, log: (...parts: unknown[]) => void = () => {}, env?: Record<string, string | undefined>): Promise<WindowsPrinter[]> {
  try {
    const list = parseWindowsPrinters(await run(powershellPath(env), POWERSHELL_ARGS));
    if (list.length > 0) return list;
  } catch (error) {
    log('could not ask Windows about its printers:', error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200));
  }
  try {
    const name = parseDefaultDevice(await run(regPath(env), REG_ARGS));
    return name ? [{ name, isDefault: true, state: 'unknown', driver: '', papers: [] }] : [];
  } catch (error) {
    log('could not read the default printer:', error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200));
    return [];
  }
}

/** The same answer for a few seconds: opening Settings → Printers and printing ask in a row. */
export function cachedPrinters(read: () => Promise<WindowsPrinter[]>, keepMs = 15_000, now: () => number = Date.now): (fresh?: boolean) => Promise<WindowsPrinter[]> {
  let at = Number.NEGATIVE_INFINITY;
  let last: Promise<WindowsPrinter[]> | null = null;
  return (fresh = false) => {
    if (!last || fresh || now() - at > keepMs) {
      at = now();
      last = read().catch(() => []);
    }
    return last;
  };
}
