import {
  checkPrinterChoice, choiceForPrint, isPrintKind, isPrinterName, readPrinterChoices, type LabelLayout,
  type PrinterChoice, type PrinterChoices, type PrinterEntry, type PrintKind, type PrintOutcome
} from '@qasa/core';

/**
 * Every Print button goes through printDocument(kind). In the Windows app, with a printer chosen for that kind of
 * paper (Settings → Printers), the app prints this window to it; otherwise, and in a browser or the website demo, the
 * print window opens as it always has (window.print). When the chosen printer is gone or fails, the page says so.
 */

/** The Windows app's printer calls (apps/desktop/src/app-preload.ts). Answers are checked here before use. */
export interface DesktopPrinters {
  list(): Promise<unknown>;
  get(): Promise<unknown>;
  set(kind: string, choice: PrinterChoice | null): Promise<unknown>;
  /** labels may name the layout picked on the labels page: its paper is used instead of the saved one */
  print(kind: string, layout?: string): Promise<unknown>;
}

export function desktopPrinters(): DesktopPrinters | null {
  if (typeof window === 'undefined') return null;
  const p = (window as unknown as { qasaDesktop?: { printers?: Partial<DesktopPrinters> } }).qasaDesktop?.printers;
  if (!p || typeof p.list !== 'function' || typeof p.get !== 'function' || typeof p.set !== 'function' || typeof p.print !== 'function') return null;
  return p as DesktopPrinters;
}

/** The printers in an answer from the app (anything that isn't one is left out). */
export function printersOf(value: unknown): PrinterEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is PrinterEntry => !!p && typeof p === 'object' && isPrinterName((p as PrinterEntry).name))
    .map((p) => ({ name: p.name, displayName: typeof p.displayName === 'string' && p.displayName ? p.displayName : p.name }));
}

const OUTCOMES = ['printed', 'ask', 'noPrinters', 'missing', 'failed', 'busy', 'refused'] as const;

/** The app's answer to a print, or null when it isn't one. */
export function outcomeOf(value: unknown): PrintOutcome | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as { status?: unknown; printer?: unknown; reason?: unknown };
  if (!(OUTCOMES as readonly unknown[]).includes(o.status)) return null;
  if (o.status === 'missing') return { status: 'missing', printer: typeof o.printer === 'string' ? o.printer : '' };
  if (o.status === 'failed') return { status: 'failed', reason: o.reason === 'cancelled' ? 'cancelled' : 'printer' };
  return { status: o.status } as PrintOutcome;
}

/** What a Print button tells the person (PrintNotices shows it). */
export type PrintNotice = { code: 'missing' | 'failed'; printer: string } | { code: 'noPrinters' | 'busy' };
export const PRINT_NOTICE_EVENT = 'qasa:print-notice';

function noticePage(notice: PrintNotice): void {
  try { window.dispatchEvent(new CustomEvent(PRINT_NOTICE_EVENT, { detail: notice })); } catch { /* no page */ }
}

/** The receipt and labels are drawn for the chosen paper while it prints (html[data-print-paper], pos.css). */
function markPaper(paper: string | null): void {
  try {
    const root = document.documentElement;
    if (paper) root.dataset.printPaper = paper; else delete root.dataset.printPaper;
  } catch { /* no page */ }
}

/**
 * Resolves once the page has drawn what was just put on it (a notice), so it shows before the print window: while
 * that window is open the page stops and draws nothing. A frame, then a short pause; and never longer than a second,
 * since a hidden window gets no frames.
 */
export function afterPaint(pauseMs = 120): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    setTimeout(finish, 1_000);
    try {
      if (typeof requestAnimationFrame === 'function') { requestAnimationFrame(() => { setTimeout(finish, pauseMs); }); return; }
    } catch { /* no frames here */ }
    setTimeout(finish, pauseMs);
  });
}

/**
 * Resolves once nothing has been waiting on the server for a moment (true), or after `maxMs` at the latest (false). A
 * paper put on the page a moment ago (the invoice just posted) still asks for its design, its QR code or the customer's
 * balance: it is printed once those have arrived, and without them rather than never.
 */
export async function whenQuiet(pending: () => number, opts: { quietMs?: number; maxMs?: number; stepMs?: number; wait?: (ms: number) => Promise<void> } = {}): Promise<boolean> {
  const quietMs = opts.quietMs ?? 150;
  const maxMs = opts.maxMs ?? 6_000;
  const stepMs = opts.stepMs ?? 50;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  let quiet = 0;
  for (let waited = 0; waited < maxMs; waited += stepMs) {
    quiet = pending() > 0 ? 0 : quiet + stepMs;
    if (quiet > quietMs) return true;
    await wait(stepMs);
  }
  return false;
}

export interface PrintEnv {
  desktop: DesktopPrinters | null;
  /** the print window (window.print) */
  dialog(): void;
  notify(notice: PrintNotice): void;
  markPaper(paper: string | null): void;
  /** waits until the notice is on the screen (afterPaint) */
  paint(): Promise<void>;
}

/**
 * printed: it went to the chosen printer; dialog: the print window opened; failed: it did not print (the page said
 * why, or the person cancelled); busy: another paper is still being sent.
 */
export type PrintResult = 'printed' | 'dialog' | 'failed' | 'busy';

export async function printDocument(kind: PrintKind, env: Partial<PrintEnv> & { labelLayout?: LabelLayout } = {}): Promise<PrintResult> {
  const desktop = env.desktop !== undefined ? env.desktop : desktopPrinters();
  const dialog = env.dialog ?? (() => window.print());
  const notify = env.notify ?? noticePage;
  const mark = env.markPaper ?? markPaper;
  const paint = env.paint ?? afterPaint;
  /** says why the print window opens, and lets that show before the window stops the page */
  const tellThenDialog = async (notice: PrintNotice) => {
    notify(notice);
    try { await paint(); } catch { /* print anyway */ }
    dialog();
  };
  if (!desktop || !isPrintKind(kind)) {
    dialog();
    return 'dialog';
  }
  let choice: PrinterChoice | undefined;
  try {
    choice = readPrinterChoices(await desktop.get())[kind];
  } catch {
    choice = undefined;
  }
  // labels print on the paper of the layout picked on the labels page (A4 sheets on A4), with the saved printer
  const layout = kind === 'label' ? env.labelLayout : undefined;
  if (choice?.printer) mark(choiceForPrint(kind, choice, layout).paper);
  try {
    let outcome: PrintOutcome | null;
    try {
      outcome = outcomeOf(await (layout ? desktop.print(kind, layout) : desktop.print(kind)));
    } catch {
      outcome = null;
    }
    switch (outcome?.status) {
      case 'printed':
        return 'printed';
      case 'busy':
        notify({ code: 'busy' });
        return 'busy';
      case 'noPrinters':
        await tellThenDialog({ code: 'noPrinters' });
        return 'dialog';
      case 'missing':
        await tellThenDialog({ code: 'missing', printer: outcome.printer || choice?.printer || '' });
        return 'dialog';
      case 'failed':
        if (outcome.reason === 'cancelled') return 'failed';
        // the print window opens too, so the paper can still go to another printer
        await tellThenDialog({ code: 'failed', printer: choice?.printer ?? '' });
        return 'failed';
      default:
        // "Ask every time", an app without printer choices, or an answer that isn't one: as before
        dialog();
        return 'dialog';
    }
  } finally {
    mark(null);
  }
}

/** What printAlone needs of the page (a stand-in in the tests). */
export interface AlonePage {
  addClass(name: string): void;
  removeClass(name: string): void;
  onAfterPrint(listener: () => void): void;
  offAfterPrint(listener: () => void): void;
  later(run: () => void, ms: number): void;
}

const browserPage: AlonePage = {
  addClass: (name) => document.body.classList.add(name),
  removeClass: (name) => document.body.classList.remove(name),
  onAfterPrint: (listener) => window.addEventListener('afterprint', listener),
  offAfterPrint: (listener) => window.removeEventListener('afterprint', listener),
  later: (run, ms) => { window.setTimeout(run, ms); }
};

/** how many prints still need each class, per page */
const holding = new WeakMap<AlonePage, Map<string, number>>();

/**
 * Prints one part of the page alone (the POS receipt, the generator receipt, the printer test page): `bodyClass` on
 * <body> shows only that part on paper. The class comes off when the print window closes (afterprint), or a second
 * after the paper went to the printer, whichever is first; while another print with the same class is still on its
 * way, it stays on.
 */
export async function printAlone(kind: PrintKind, bodyClass: string, env: Partial<PrintEnv> & { page?: AlonePage } = {}): Promise<PrintResult> {
  const page = env.page ?? browserPage;
  let counts = holding.get(page);
  if (!counts) holding.set(page, (counts = new Map()));
  const held = counts;
  held.set(bodyClass, (held.get(bodyClass) ?? 0) + 1);
  page.addClass(bodyClass);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    page.offAfterPrint(release);
    const left = (held.get(bodyClass) ?? 1) - 1;
    if (left > 0) { held.set(bodyClass, left); return; }
    held.delete(bodyClass);
    page.removeClass(bodyClass);
  };
  page.onAfterPrint(release);
  try {
    return await printDocument(kind, env);
  } finally {
    page.later(release, 1_000);
  }
}

/** The app's saved choices, checked (an older app or a refusal gives none). */
export async function savedChoices(desktop: DesktopPrinters): Promise<PrinterChoices> {
  try {
    return readPrinterChoices(await desktop.get());
  } catch {
    return {};
  }
}

/** Saves one kind's choice; the choices as saved, or null when the app refused or could not save. */
export async function saveChoice(desktop: DesktopPrinters, kind: PrintKind, choice: PrinterChoice | null, printers: readonly string[]): Promise<PrinterChoices | null> {
  if (choice !== null && !checkPrinterChoice(choice, printers)) return null;
  try {
    const answer = await desktop.set(kind, choice);
    return answer && typeof answer === 'object' ? readPrinterChoices(answer) : null;
  } catch {
    return null;
  }
}
