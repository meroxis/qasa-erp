import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pdfFileName, sharePdfHandlers, type PdfTarget, type SharePdfDeps } from './share-pdf.ts';

// Send on WhatsApp as a PDF, the Windows side: the page names a kind and a number; the file, its folder and what is
// printed are this side's.
const DIR = join('C:', 'Users', 'Mer', 'AppData', 'Local', 'Qasa ERP', 'Shared PDFs');
const DAY = 24 * 60 * 60 * 1000;

function setup(over: Partial<SharePdfDeps> = {}, pdf: () => Promise<Uint8Array> = async () => new Uint8Array([37, 80, 68, 70])) {
  const target: PdfTarget = { printToPDF: (options) => { calls.push(options); return pdf(); } };
  const calls: object[] = [];
  const written = new Map<string, Uint8Array>();
  const removed: string[] = [];
  const revealed: string[] = [];
  const logs: string[] = [];
  const files = [
    { name: 'Invoice-INV-2026-0001.pdf', mtimeMs: 1_000 * DAY - 8 * DAY },
    { name: 'Receipt-INV-2026-0002.pdf', mtimeMs: 1_000 * DAY - DAY },
    { name: 'notes.pdf', mtimeMs: 0 },
    { name: 'Invoice-..-secret.pdf', mtimeMs: 0 }
  ];
  const deps: SharePdfDeps = {
    target: () => target,
    fromAppPage: () => true,
    dir: () => DIR,
    makeDir: () => {},
    writeFile: (file, data) => { written.set(file, data); },
    list: () => files,
    remove: (file) => { removed.push(file); },
    reveal: (file) => { revealed.push(file); },
    log: (...parts) => { logs.push(parts.map(String).join(' ')); },
    now: () => 1_000 * DAY,
    ...over
  };
  return { handlers: sharePdfHandlers(deps), target, calls, written, removed, revealed, logs };
}

describe('the PDF a document is sent on WhatsApp as', () => {
  it('is named from its kind and number, never a path the page chose', () => {
    expect(pdfFileName('invoice', 'INV-2026-0001')).toBe('Invoice-INV-2026-0001.pdf');
    expect(pdfFileName('statement', 'C0001_2026-11-11')).toBe('Statement-C0001_2026-11-11.pdf');
    expect(pdfFileName('dayclose', '2026-11-11')).toBe('End-of-day-2026-11-11.pdf');
    for (const bad of ['../../Windows/x', '..', 'a/b', 'a\\b', 'C:x', '', ' INV', 'INV 1', 'فاتورة', 'x'.repeat(65), 'a..b']) expect(pdfFileName('invoice', bad), bad).toBeNull();
    expect(pdfFileName('script', 'INV-1')).toBeNull();
    expect(pdfFileName('invoice', 12)).toBeNull();
  });

  it('prints the app window at the page\'s own paper size, keeps it in the app\'s folder and shows it in File Explorer', async () => {
    const s = setup();
    const out = await s.handlers.save({ sender: s.target }, 'invoice', 'INV-2026-0007');
    expect(out).toEqual({ status: 'saved', name: 'Invoice-INV-2026-0007.pdf' });
    expect(s.calls).toEqual([{ printBackground: true, preferCSSPageSize: true }]);
    const file = join(DIR, 'Invoice-INV-2026-0007.pdf');
    expect([...s.written.keys()]).toEqual([file]);
    expect(s.revealed).toEqual([file]);
    // the log names the kind only: no customer, no number
    expect(s.logs).toEqual(['shared PDF made: invoice']);
  });

  it('deletes its own PDFs older than a week, and nothing else in the folder', async () => {
    const s = setup();
    await s.handlers.save({ sender: s.target }, 'receipt', 'INV-2026-0003');
    expect(s.removed).toEqual([join(DIR, 'Invoice-INV-2026-0001.pdf')]);
  });

  it('refuses another window, a page that isn\'t the app\'s, an unknown kind or a bad number, and one at a time', async () => {
    const s = setup();
    expect(await s.handlers.save({ sender: {} }, 'invoice', 'INV-1')).toEqual({ status: 'refused' });
    expect(await s.handlers.save({ sender: s.target }, 'invoice', '../INV-1')).toEqual({ status: 'refused' });
    expect(await s.handlers.save({ sender: s.target }, 'exe', 'INV-1')).toEqual({ status: 'refused' });
    const other = setup({ fromAppPage: () => false });
    expect(await other.handlers.save({ sender: other.target }, 'invoice', 'INV-1')).toEqual({ status: 'refused' });
    expect(s.written.size + other.written.size).toBe(0);

    let finish: (data: Uint8Array) => void = () => {};
    const slow = setup({}, () => new Promise((resolve) => { finish = resolve; }));
    const first = slow.handlers.save({ sender: slow.target }, 'invoice', 'INV-1');
    expect(await slow.handlers.save({ sender: slow.target }, 'invoice', 'INV-2')).toEqual({ status: 'busy' });
    finish(new Uint8Array([1]));
    expect(await first).toMatchObject({ status: 'saved' });
  });

  it('says it failed when no PDF came out, and writes nothing', async () => {
    const empty = setup({}, async () => new Uint8Array());
    expect(await empty.handlers.save({ sender: empty.target }, 'quote', 'QT-1')).toEqual({ status: 'failed' });
    const broken = setup({}, async () => { throw new Error('printing failed'); });
    expect(await broken.handlers.save({ sender: broken.target }, 'quote', 'QT-1')).toEqual({ status: 'failed' });
    expect(empty.written.size + broken.written.size).toBe(0);
    expect(broken.revealed).toEqual([]);
  });
});
