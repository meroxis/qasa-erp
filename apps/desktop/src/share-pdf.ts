/**
 * Sending a document on WhatsApp as a PDF, the Windows side (the free way: no WhatsApp Business API, nothing sent by
 * the app). The page asks for one fixed thing (app-preload.ts → qasaDesktop.sharePdf): "make this kind of document,
 * numbered so, into a PDF". This side prints the app window itself to a PDF (as its Print button would, with the page's
 * own paper size), keeps it in the app's own folder on this PC, and shows it selected in File Explorer so the person
 * drags it into the WhatsApp chat the page opens next. The page never names a folder or a path: the file's name is
 * made here from the kind and the document's number, after both are checked.
 *
 * The folder is in the local (not the roaming, never synced) app data. Customer documents are personal data, so PDFs
 * older than a week are deleted there, and only files this app named.
 */
import { join } from 'node:path';

export const PDF_KINDS = ['invoice', 'receipt', 'quote', 'statement', 'dayclose'] as const;
export type PdfKind = (typeof PDF_KINDS)[number];

const NAME_OF: Record<PdfKind, string> = { invoice: 'Invoice', receipt: 'Receipt', quote: 'Quotation', statement: 'Statement', dayclose: 'End-of-day' };
/** Only files named like these are ever deleted from the folder. */
const OURS = /^(Invoice|Receipt|Quotation|Statement|End-of-day)-[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.pdf$/;

export const isPdfKind = (v: unknown): v is PdfKind => typeof v === 'string' && (PDF_KINDS as readonly string[]).includes(v);

/**
 * The PDF's file name: "<Kind>-<number>.pdf". The number is the document's own (INV-2026-0001, a customer code and a
 * date): Latin letters, digits, dot, dash and underscore, 1 to 64 of them, never "..". Anything else is refused (null).
 */
export function pdfFileName(kind: unknown, ref: unknown): string | null {
  if (!isPdfKind(kind) || typeof ref !== 'string') return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(ref) || ref.includes('..')) return null;
  return `${NAME_OF[kind]}-${ref}.pdf`;
}

export type SharePdfOutcome = { status: 'saved'; name: string } | { status: 'refused' | 'busy' | 'failed' };

/** What making the PDF needs of the app window's webContents (a stand-in in the tests). */
export interface PdfTarget {
  printToPDF(options: object): Promise<Uint8Array>;
}

export interface SharePdfDeps {
  /** The app window's webContents, or null while there is no window. */
  target(): PdfTarget | null;
  /** The call came from the app window's own page (its main frame, on the app's origin). */
  fromAppPage(event: { sender: unknown }): boolean;
  /** The app's own folder for these files. */
  dir(): string;
  makeDir(dir: string): void;
  writeFile(file: string, data: Uint8Array): void;
  /** The files in the folder with the time each was last written (ms). */
  list(dir: string): { name: string; mtimeMs: number }[];
  remove(file: string): void;
  /** Opens File Explorer with the file selected. */
  reveal(file: string): void;
  log(...parts: unknown[]): void;
  now?: () => number;
  /** How long a PDF is kept (default a week). */
  keepMs?: number;
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

export function sharePdfHandlers(deps: SharePdfDeps) {
  const now = deps.now ?? Date.now;
  let busy = false;

  /** PDFs this app made that are older than the keeping time; anything else in the folder is left alone. */
  function tidy(dir: string): void {
    const limit = now() - (deps.keepMs ?? WEEK);
    let files: { name: string; mtimeMs: number }[] = [];
    try { files = deps.list(dir); } catch { return; }
    for (const f of files) {
      if (!OURS.test(f.name) || f.mtimeMs >= limit) continue;
      try { deps.remove(join(dir, f.name)); } catch (error) { deps.log('could not delete an old shared PDF:', error); }
    }
  }

  return {
    /** Makes the PDF of the app window as it prints now, keeps it, and shows it in File Explorer. */
    async save(event: { sender: unknown }, kind: unknown, ref: unknown): Promise<SharePdfOutcome> {
      const target = deps.target();
      if (!target || event.sender !== target || !deps.fromAppPage(event)) return { status: 'refused' };
      const name = pdfFileName(kind, ref);
      if (!name) return { status: 'refused' };
      if (busy) return { status: 'busy' };
      busy = true;
      try {
        const dir = deps.dir();
        deps.makeDir(dir);
        tidy(dir);
        // the page's own @page size and margins (A4 for an invoice, 80 mm for a receipt), its colours included
        const data = await target.printToPDF({ printBackground: true, preferCSSPageSize: true });
        if (!(data instanceof Uint8Array) || data.length === 0) return { status: 'failed' };
        const file = join(dir, name);
        deps.writeFile(file, data);
        deps.reveal(file);
        // the log says what was made, never the customer it is for
        deps.log(`shared PDF made: ${String(kind)}`);
        return { status: 'saved', name };
      } catch (error) {
        deps.log('could not make the PDF:', error);
        return { status: 'failed' };
      } finally {
        busy = false;
      }
    }
  };
}
