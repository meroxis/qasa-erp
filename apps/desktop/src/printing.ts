/**
 * Settings → Printers, the Windows side: the printers of this PC, the choice saved for each kind of paper
 * (printers.json in the app's own folder: this PC's, not the company's), and printing the app window with it.
 *
 * The page asks through four fixed calls (app-preload.ts → qasaDesktop.printers) and decides nothing here: it names a
 * kind of paper, and this side looks up what was saved for it, checks the printer is still one Windows lists, and
 * prints the app window, never another one. Every value from the page or from the file is checked again.
 */
import {
  checkPrinterChoice, devicePrintOptions, isPrintKind, isPrinterName, readPrinterChoices,
  type PrinterChoice, type PrinterChoices, type PrinterEntry, type PrintOutcome
} from '@qasa/core';

/** What printing needs of the app window's webContents (a stand-in in the tests). */
export interface PrintTarget {
  getPrintersAsync(): Promise<{ name: string; displayName?: string }[]>;
  print(options: object, callback: (success: boolean, failureReason: string) => void): void;
}

export interface PrintingDeps {
  /** The app window's webContents, or null while there is no window. */
  target(): PrintTarget | null;
  /** The call came from the app window's own page (its main frame, on the app's origin). */
  fromAppPage(event: { sender: unknown }): boolean;
  /** printers.json's text, or null when there is none. */
  readFile(): string | null;
  writeFile(text: string): void;
  log(...parts: unknown[]): void;
  /**
   * How long a print without the print window may take before it counts as failed (default 2 minutes). With the
   * Windows print window open there is no limit: the person may take their time, and the print ends when they do.
   */
  timeoutMs?: number;
  /** The least time from the end of one print without the print window to the start of the next (default 1.5 s). */
  silentGapMs?: number;
  /** The time now, in milliseconds (a stand-in in the tests). */
  now?: () => number;
}

/** The events of the app window's webContents that end a print: its page is gone (closed, crashed) or another loads. */
export interface PrintTargetEvents {
  on(event: string, listener: (...args: never[]) => void): unknown;
  removeListener(event: string, listener: (...args: never[]) => void): unknown;
}

/**
 * Calls `gone` once when the page that asked to print can no longer be waiting for it: the webContents is destroyed,
 * its renderer is gone (a crash), or its main frame starts loading another document (a reload). The Windows print
 * window may then never answer, and the next print must not wait for it for ever. Answers the way to stop watching.
 */
export function watchPrintTarget(target: unknown, gone: (why: string) => void): () => void {
  const t = target as Partial<PrintTargetEvents> | null;
  if (!t || typeof t.on !== 'function' || typeof t.removeListener !== 'function') return () => {};
  const emitter = t as PrintTargetEvents;
  let done = false;
  const once = (why: string) => { if (!done) { done = true; stop(); gone(why); } };
  const onDestroyed = () => once('destroyed');
  const onGone = () => once('render-process-gone');
  // a change of route inside the page (the same document) is no new page; a reload or another document is
  const onNavigation = (details?: { isMainFrame?: unknown; isSameDocument?: unknown }) => {
    if (details && (details.isMainFrame === false || details.isSameDocument === true)) return;
    once('navigation');
  };
  const listeners: [string, (...args: never[]) => void][] = [['destroyed', onDestroyed], ['render-process-gone', onGone], ['did-start-navigation', onNavigation]];
  function stop(): void {
    for (const [event, fn] of listeners) emitter.removeListener(event, fn);
  }
  for (const [event, fn] of listeners) emitter.on(event, fn);
  return () => { done = true; stop(); };
}

/** No PC has more printers than this; a longer list is cut. */
const MAX_PRINTERS = 100;

export function printingHandlers(deps: PrintingDeps) {
  const now = deps.now ?? Date.now;
  const silentGap = deps.silentGapMs ?? 1_500;
  let busy = false;
  /** when the last print without the print window ended; a page that keeps asking can't flood the printer */
  let lastSilent = Number.NEGATIVE_INFINITY;

  /** The call is the app window's own page, and that page is the one that would be printed. */
  const allowed = (event: { sender: unknown }): boolean => {
    const target = deps.target();
    return !!target && event.sender === target && deps.fromAppPage(event);
  };

  const read = (): PrinterChoices => {
    try {
      const text = deps.readFile();
      if (!text) return {};
      const saved = JSON.parse(text) as { choices?: unknown };
      return readPrinterChoices(saved?.choices);
    } catch {
      return {};
    }
  };

  async function printers(target: PrintTarget): Promise<PrinterEntry[]> {
    const list = await target.getPrintersAsync();
    const out: PrinterEntry[] = [];
    for (const p of Array.isArray(list) ? list : []) {
      if (!p || !isPrinterName(p.name)) continue;
      const shown = typeof p.displayName === 'string' && p.displayName.trim() ? p.displayName.trim().slice(0, 256) : p.name;
      if (!out.some((o) => o.name === p.name)) out.push({ name: p.name, displayName: shown });
      if (out.length >= MAX_PRINTERS) break;
    }
    return out;
  }

  return {
    /** The printers Windows lists now; null when the call isn't the app's page. */
    async list(event: { sender: unknown }): Promise<PrinterEntry[] | null> {
      if (!allowed(event)) return null;
      try {
        return await printers(deps.target()!);
      } catch (error) {
        deps.log('could not list the printers:', error);
        return [];
      }
    },

    /** What is saved for each kind of paper. */
    get(event: { sender: unknown }): PrinterChoices | null {
      if (!allowed(event)) return null;
      return read();
    },

    /**
     * Saves one kind's choice (null: back to "Ask every time"). A printer must be one Windows lists now. Answers the
     * saved choices, or null when refused.
     */
    async set(event: { sender: unknown }, kind: unknown, choice: unknown): Promise<PrinterChoices | null> {
      if (!allowed(event) || !isPrintKind(kind)) return null;
      const next = { ...read() };
      if (choice === null) {
        delete next[kind];
      } else {
        let names: string[];
        try {
          names = (await printers(deps.target()!)).map((p) => p.name);
        } catch (error) {
          deps.log('could not list the printers:', error);
          names = [];
        }
        const checked = checkPrinterChoice(choice, names);
        if (!checked) return null;
        next[kind] = checked;
      }
      try {
        deps.writeFile(JSON.stringify({ version: 1, choices: next, at: new Date().toISOString() }));
      } catch (error) {
        deps.log('could not save the printers:', error);
        return null;
      }
      return next;
    },

    /** Prints the app window for one kind of paper, as saved for it. */
    async print(event: { sender: unknown }, kind: unknown): Promise<PrintOutcome> {
      if (!allowed(event) || !isPrintKind(kind)) return { status: 'refused' };
      const saved: PrinterChoice | undefined = read()[kind];
      if (!saved || saved.printer === null) return { status: 'ask' };
      if (busy) return { status: 'busy' };
      if (saved.silent && now() - lastSilent < silentGap) return { status: 'busy' };
      busy = true;
      let sentSilently = false;
      try {
        const target = deps.target()!;
        let names: string[];
        try {
          names = (await printers(target)).map((p) => p.name);
        } catch (error) {
          deps.log('could not list the printers:', error);
          names = [];
        }
        if (names.length === 0) return { status: 'noPrinters' };
        // the printer must still be one Windows lists, and every value is checked again before it reaches the driver
        const choice = checkPrinterChoice(saved, names);
        if (!choice || choice.printer === null) return { status: 'missing', printer: saved.printer };
        const options = devicePrintOptions({ ...choice, printer: choice.printer });
        sentSilently = options.silent;
        let unwatch = () => {};
        const outcome = await new Promise<PrintOutcome>((resolve) => {
          // only a print without the print window can hang unseen; with the window open, the person decides when it ends
          // (and the next print waits for that: the lock is held until the window closes)
          const timer = options.silent ? setTimeout(() => resolve({ status: 'failed', reason: 'printer' }), deps.timeoutMs ?? 120_000) : undefined;
          (timer as { unref?: () => void } | undefined)?.unref?.();
          // ... or until the page that asked is gone (closed, crashed, reloaded): its print window may never answer
          unwatch = watchPrintTarget(target, (why) => {
            clearTimeout(timer);
            deps.log(`printing (${kind}) ended: the app page is gone (${why})`);
            resolve({ status: 'failed', reason: 'cancelled' });
          });
          try {
            target.print(options, (success, failureReason) => {
              clearTimeout(timer);
              if (success) return resolve({ status: 'printed' });
              resolve({ status: 'failed', reason: /cancel/i.test(String(failureReason ?? '')) ? 'cancelled' : 'printer' });
              if (!/cancel/i.test(String(failureReason ?? ''))) deps.log(`printing (${kind}) failed:`, String(failureReason ?? '').slice(0, 200));
            });
          } catch (error) {
            clearTimeout(timer);
            deps.log(`printing (${kind}) failed:`, error);
            resolve({ status: 'failed', reason: 'printer' });
          }
        });
        unwatch();
        return outcome;
      } finally {
        if (sentSilently) lastSilent = now();
        busy = false;
      }
    }
  };
}
