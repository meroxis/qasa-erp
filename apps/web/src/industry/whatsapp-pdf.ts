import { toWesternDigits, type PrintKind } from '@qasa/core';
import { afterPaint } from './printing.ts';

/**
 * Sending a document on WhatsApp as a PDF, the page's side (the free way: no WhatsApp Business API). In the Windows app
 * the page asks the app to print this window to a PDF in the app's own folder (apps/desktop/src/share-pdf.ts), which
 * shows the file in File Explorer; then it opens WhatsApp (wa.me, the app's usual safe link) with the message ready.
 * The person drags the file into the chat and presses Send: nothing is ever sent by Qasa. In a browser the person
 * prints to PDF and attaches it the same way.
 */

export const SHARE_KINDS = ['invoice', 'receipt', 'quote', 'statement', 'dayclose'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

/** The paper each kind prints on (Settings → Printers), for the print window in a browser. */
export const PRINT_KIND_OF: Record<ShareKind, PrintKind> = { invoice: 'invoice', receipt: 'receipt', quote: 'quote', statement: 'report', dayclose: 'report' };

/** While the PDF is made: the dialog and the notices stay off the paper (styles.css). */
export const PDF_CLASS = 'pdf-making';

/**
 * A document's number as the file name's part the app accepts: Latin letters, digits, dot, dash and underscore, at most
 * 64 ("INV-2026-0001"; Arabic-Indic digits become Western ones; anything else becomes a dash).
 */
export function pdfRef(text: string): string {
  const clean = toWesternDigits(text.normalize('NFKC'))
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 64)
    .replace(/[^A-Za-z0-9]+$/, '');
  return clean || 'document';
}

export type PdfOutcome = { status: 'saved'; name: string } | { status: 'failed' | 'busy' | 'refused' };

/** The app's answer, checked: anything that isn't one counts as failed. */
export function pdfOutcomeOf(value: unknown): PdfOutcome {
  const v = value as { status?: unknown; name?: unknown } | null;
  if (v && v.status === 'saved' && typeof v.name === 'string' && /^[\w.-]{1,100}\.pdf$/.test(v.name)) return { status: 'saved', name: v.name };
  if (v && (v.status === 'busy' || v.status === 'refused')) return { status: v.status };
  return { status: 'failed' };
}

export interface DesktopShare { sharePdf(kind: string, ref: string): Promise<unknown> }

/** The Windows app's call (app-preload.ts), or null in a browser and in apps older than 1.2. */
export function desktopShare(): DesktopShare | null {
  if (typeof window === 'undefined') return null;
  const d = (window as unknown as { qasaDesktop?: { sharePdf?: unknown } }).qasaDesktop;
  return d && typeof d.sharePdf === 'function' ? (d as DesktopShare) : null;
}

export interface PdfPage {
  addClass(name: string): void;
  removeClass(name: string): void;
  paint(): Promise<void>;
}

const browserPage: PdfPage = {
  addClass: (name) => document.body.classList.add(name),
  removeClass: (name) => document.body.classList.remove(name),
  paint: () => afterPaint()
};

/**
 * Makes the PDF of this window as it prints: the dialog is kept off the paper, and `bodyClass` (the POS receipt's
 * "pos-printing") puts only that part on it. Null when this is no Windows app.
 */
export async function makePdf(kind: ShareKind, ref: string, opts: { bodyClass?: string | undefined; desktop?: DesktopShare | null; page?: PdfPage } = {}): Promise<PdfOutcome | null> {
  const desktop = opts.desktop !== undefined ? opts.desktop : desktopShare();
  if (!desktop) return null;
  const page = opts.page ?? browserPage;
  const classes = [PDF_CLASS, ...(opts.bodyClass ? [opts.bodyClass] : [])];
  for (const c of classes) page.addClass(c);
  try {
    // the page draws itself without the dialog before it is printed
    try { await page.paint(); } catch { /* print anyway */ }
    return pdfOutcomeOf(await desktop.sharePdf(kind, pdfRef(ref)));
  } catch {
    return { status: 'failed' };
  } finally {
    for (const c of classes) page.removeClass(c);
  }
}
