/**
 * The till's two devices on Windows (2.0, supermarkets): the cash drawer and the customer screen.
 *
 * The cash drawer hangs off the receipt printer: sending the printer the ESC/POS "kick" (ESC p 0 25 250) opens it. It is
 * sent to the receipt printer chosen in Settings → Printers on this PC, as a raw job through Windows' own print spooler
 * (winspool's OpenPrinter / StartDocPrinter "RAW" / WritePrinter), by a fixed PowerShell script. Nothing from the page
 * crosses but the call itself: the printer name comes from printers.json and must be one Windows lists now; it reaches
 * the script in an environment variable, never in the script's text. At most one kick each 1.5 s.
 *
 * The script's C# is compiled once for each run of the app, into a file in a folder made for that run (the helper),
 * and each kick after loads it: compiling it again on every sale kept a slow till PC's drawer shut for seconds. The
 * helper is loaded only while it is still the very file that was compiled (its SHA-256, kept in memory); if it cannot
 * be made, or is not the same, the kick goes the old way (compiled in memory). A PC whose Windows policy lets
 * PowerShell do neither says so ('blocked'), instead of "check the cable".
 *
 * The customer screen is a second window of the app's own page (#/customer-display), on the PC's second screen when it
 * has one, full screen; without one, a normal window the cashier can move. It shows what the till sends it in the same
 * browser session (a BroadcastChannel); it has no bridge to this process and opens nothing else.
 */
import { isPrinterName, readPrinterChoices } from '@qasa/core';

/** ESC p m t1 t2: pulse pin 2 (m = 0) for 25 × 2 ms on, 250 × 2 ms off: the usual drawer kick. */
export const DRAWER_KICK = [0x1b, 0x70, 0x00, 0x19, 0xfa] as const;

/** The C# that sends bytes to a printer as one RAW document through Windows' own spooler. */
const DRAWER_SOURCE = `using System;
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
}`;

const KICK_LINE = `if ([QasaRaw]::Send($env:QASA_DRAWER_PRINTER, [byte[]](${DRAWER_KICK.join(', ')}))) { 'opened' } else { 'failed' }`;

/**
 * The PowerShell that writes the kick to the printer named in $env:QASA_DRAWER_PRINTER as one RAW document, compiling
 * its C# in memory (the way that needs no helper). Fixed text: the printer's name is read from the environment, so no
 * quote or character in it can change the script.
 */
export const DRAWER_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
${DRAWER_SOURCE}
"@
${KICK_LINE}
`;

/** Compiles the same C# once into the file named in $env:QASA_DRAWER_HELPER (nothing is sent to any printer). */
export const DRAWER_BUILD_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
${DRAWER_SOURCE}
"@ -OutputAssembly $env:QASA_DRAWER_HELPER
'ready'
`;

/** The kick through the helper compiled before: nothing is compiled, so the drawer opens as PowerShell starts. */
export const DRAWER_FAST_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -LiteralPath $env:QASA_DRAWER_HELPER
${KICK_LINE}
`;

/** 'blocked': Windows on this PC does not let the app run the PowerShell that opens the drawer (a policy, not a cable). */
export type DrawerOutcome = { status: 'opened' } | { status: 'no_printer' } | { status: 'failed' } | { status: 'refused' } | { status: 'busy' } | { status: 'blocked' };

export interface DrawerDeps {
  /** The call came from the app window's own page. */
  fromAppPage(event: { sender: unknown }): boolean;
  /** printers.json's text, or null when there is none. */
  readPrintersFile(): string | null;
  /** The printers Windows lists now (the app window's webContents.getPrintersAsync). */
  printers(): Promise<{ name: string }[]>;
  /**
   * Runs the script with the printer's name in QASA_DRAWER_PRINTER and, when given, the helper's file in
   * QASA_DRAWER_HELPER; answers what it printed. Fails with what PowerShell (or Windows) said, not the script's text.
   */
  run(script: string, printer: string, helper?: string): Promise<string>;
  /**
   * Where this run of the app may keep the compiled helper (a file in a folder of its own, made for this run), or null
   * for none: every kick then compiles in memory, as before.
   */
  helperFile?(): string | null;
  /** The file's SHA-256, or null when it cannot be read. */
  fileHash?(file: string): string | null;
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

/**
 * Did Windows refuse to run the script at all? What PowerShell says under a locked-down policy (Constrained Language
 * Mode: no new types; AppLocker or Software Restriction: the program itself), or powershell.exe missing or not allowed
 * to start. A printer that did not take the kick, or a script that ran out of time, is not this.
 */
export function drawerBlocked(error: unknown): boolean {
  const text = error instanceof Error ? `${(error as NodeJS.ErrnoException).code ?? ''} ${error.message}` : String(error ?? '');
  return /language mode|ConstrainedLanguage|AppLocker|group policy|blocked by|software restriction|not digitally signed|scripts is disabled|Access is denied|\b(ENOENT|EACCES|EPERM)\b/i.test(text);
}

export function drawerHandler(deps: DrawerDeps) {
  const now = deps.now ?? Date.now;
  let last = Number.NEGATIVE_INFINITY;
  let busy = false;
  // the helper of this run: the file, and its SHA-256 as it was right after it was compiled
  let helper: { file: string; hash: string } | null = null;
  let helperTried = false;
  let building: Promise<void> | null = null;

  /** Compiles the helper once for this run (a failure is not tried again: every kick goes the in-memory way). */
  const build = (): Promise<void> => {
    if (helperTried) return building ?? Promise.resolve();
    helperTried = true;
    building = (async () => {
      const file = deps.helperFile?.() ?? null;
      if (!file || !deps.fileHash) return;
      try {
        const out = await deps.run(DRAWER_BUILD_SCRIPT, '', file);
        const hash = out.trim().endsWith('ready') ? deps.fileHash(file) : null;
        if (hash) helper = { file, hash };
        else deps.log('cash drawer: the helper was not made; each kick compiles in memory');
      } catch (error) {
        deps.log('cash drawer: the helper could not be made; each kick compiles in memory:', error);
      }
    })().finally(() => { building = null; });
    return building;
  };

  /** The kick itself: through the helper while it is the file compiled, else (or if that fails to run) in memory. */
  const kick = async (printer: string): Promise<string> => {
    await build();
    if (helper) {
      const mine = helper;
      if (deps.fileHash?.(mine.file) !== mine.hash) {
        // not the file this run compiled: never loaded, never made again in this run
        helper = null;
        deps.log('cash drawer: the helper file changed; it is not used again in this run');
      } else {
        try {
          return await deps.run(DRAWER_FAST_SCRIPT, printer, mine.file);
        } catch (error) {
          helper = null;
          deps.log('cash drawer: the helper did not run; compiling in memory:', error);
        }
      }
    }
    return deps.run(DRAWER_SCRIPT, printer);
  };

  const open = async (event: { sender: unknown }): Promise<DrawerOutcome> => {
    if (!deps.fromAppPage(event)) return { status: 'refused' };
    if (busy || now() - last < 1_500) return { status: 'busy' };
    const printer = receiptPrinter(deps.readPrintersFile());
    if (!printer) return { status: 'no_printer' };
    busy = true;
    try {
      const listed = await deps.printers().catch(() => []);
      if (!listed.some((p) => p?.name === printer)) return { status: 'no_printer' };
      const out = await kick(printer);
      if (out.trim().endsWith('opened')) return { status: 'opened' };
      deps.log('cash drawer: the printer did not take the kick');
      return { status: 'failed' };
    } catch (error) {
      deps.log('cash drawer: could not open:', error);
      return { status: drawerBlocked(error) ? 'blocked' : 'failed' };
    } finally {
      busy = false;
      last = now();
    }
  };
  /**
   * Compiles the helper ahead of the first sale (the app calls it once its window is up, on a PC with a receipt
   * printer chosen), so that sale's drawer does not wait for the compiler. Sends nothing to any printer.
   */
  const prepare = async (): Promise<boolean> => {
    if (!receiptPrinter(deps.readPrintersFile())) return false;
    await build();
    return !!helper;
  };
  return Object.assign(open, { prepare });
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
