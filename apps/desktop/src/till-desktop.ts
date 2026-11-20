/**
 * The till's two devices on Windows (2.0, supermarkets): the cash drawer and the customer screen.
 *
 * The cash drawer hangs off the receipt printer: sending the printer the ESC/POS "kick" (ESC p 0 25 250) opens it. It is
 * sent to the receipt printer chosen in Settings → Printers on this PC, as a raw job through Windows' own print spooler
 * (winspool's OpenPrinter / StartDocPrinter "RAW" / WritePrinter), by a fixed PowerShell script. Nothing from the page
 * crosses but the call itself: the printer name comes from printers.json and must be one Windows lists now; it reaches
 * the script in an environment variable, never in the script's text. At most one kick each 1.5 s.
 *
 * The customer screen is a second window of the app's own page (#/customer-display), on the PC's second screen when it
 * has one, full screen; without one, a normal window the cashier can move. It shows what the till sends it in the same
 * browser session (a BroadcastChannel); it has no bridge to this process and opens nothing else.
 */
import { isPrinterName, readPrinterChoices } from '@qasa/core';

/** ESC p m t1 t2: pulse pin 2 (m = 0) for 25 × 2 ms on, 250 × 2 ms off: the usual drawer kick. */
export const DRAWER_KICK = [0x1b, 0x70, 0x00, 0x19, 0xfa] as const;

/**
 * The PowerShell that writes the kick to the printer named in $env:QASA_DRAWER_PRINTER as one RAW document. Fixed
 * text: the printer's name is read from the environment, so no quote or character in it can change the script.
 */
export const DRAWER_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class QasaRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
  public static bool Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return false;
    try {
      DOCINFO d = new DOCINFO(); d.pDocName = "Qasa drawer"; d.pDataType = "RAW";
      if (StartDocPrinter(h, 1, d) == 0) return false;
      try {
        if (!StartPagePrinter(h)) return false;
        int written; bool ok = WritePrinter(h, bytes, bytes.Length, out written);
        EndPagePrinter(h);
        return ok && written == bytes.Length;
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
if ([QasaRaw]::Send($env:QASA_DRAWER_PRINTER, [byte[]](${DRAWER_KICK.join(', ')}))) { 'opened' } else { 'failed' }
`;

export type DrawerOutcome = { status: 'opened' } | { status: 'no_printer' } | { status: 'failed' } | { status: 'refused' } | { status: 'busy' };

export interface DrawerDeps {
  /** The call came from the app window's own page. */
  fromAppPage(event: { sender: unknown }): boolean;
  /** printers.json's text, or null when there is none. */
  readPrintersFile(): string | null;
  /** The printers Windows lists now (the app window's webContents.getPrintersAsync). */
  printers(): Promise<{ name: string }[]>;
  /** Runs the script with the printer's name in QASA_DRAWER_PRINTER; answers what it printed. */
  run(script: string, printer: string): Promise<string>;
  log(...parts: unknown[]): void;
  now?: () => number;
}

/** The receipt printer chosen on this PC, or null ("Ask every time", or nothing saved). */
export function receiptPrinter(printersFile: string | null): string | null {
  if (!printersFile) return null;
  try {
    const saved = JSON.parse(printersFile) as { choices?: unknown };
    const choice = readPrinterChoices(saved?.choices).receipt;
    return choice?.printer && isPrinterName(choice.printer) ? choice.printer : null;
  } catch {
    return null;
  }
}

export function drawerHandler(deps: DrawerDeps) {
  const now = deps.now ?? Date.now;
  let last = Number.NEGATIVE_INFINITY;
  let busy = false;
  return async (event: { sender: unknown }): Promise<DrawerOutcome> => {
    if (!deps.fromAppPage(event)) return { status: 'refused' };
    if (busy || now() - last < 1_500) return { status: 'busy' };
    const printer = receiptPrinter(deps.readPrintersFile());
    if (!printer) return { status: 'no_printer' };
    busy = true;
    try {
      const listed = await deps.printers().catch(() => []);
      if (!listed.some((p) => p?.name === printer)) return { status: 'no_printer' };
      const out = await deps.run(DRAWER_SCRIPT, printer);
      if (out.trim().endsWith('opened')) return { status: 'opened' };
      deps.log('cash drawer: the printer did not take the kick');
      return { status: 'failed' };
    } catch (error) {
      deps.log('cash drawer: could not open:', error);
      return { status: 'failed' };
    } finally {
      busy = false;
      last = now();
    }
  };
}

/** Where the customer screen goes: the first screen that is not the main one (full screen there), or null for none. */
export function customerScreenBounds(
  displays: readonly { id: number; bounds: { x: number; y: number; width: number; height: number } }[], primaryId: number
): { x: number; y: number; width: number; height: number } | null {
  const other = displays.find((d) => d.id !== primaryId);
  return other ? { ...other.bounds } : null;
}

/** The page the customer screen shows: the app's own origin, its #/customer-display route, nothing else. */
export function customerDisplayUrl(appOrigin: string): string {
  return `${new URL(appOrigin).origin}/#/customer-display`;
}
