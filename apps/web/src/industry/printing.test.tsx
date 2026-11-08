import { describe, expect, it, vi } from 'vitest';
import {
  afterPaint, desktopPrinters, outcomeOf, printAlone, printDocument, printersOf, saveChoice, type AlonePage, type DesktopPrinters, type PrintNotice
} from './printing.ts';

const receipt = { printer: 'Receipts', paper: 'receipt58', margins: 'none', copies: 1, silent: true } as const;

function windowsApp(answer: unknown, saved: unknown = { receipt }) {
  const desktop: DesktopPrinters = {
    list: vi.fn(async () => [{ name: 'Receipts', displayName: 'Receipts' }]),
    get: vi.fn(async () => saved),
    set: vi.fn(async () => saved),
    print: vi.fn(async () => (answer instanceof Error ? Promise.reject(answer) : answer))
  };
  /** what happened, in order: a notice, the page drawn, the print window */
  const steps: string[] = [];
  const dialog = vi.fn(() => { steps.push('dialog'); });
  const notices: PrintNotice[] = [];
  const papers: (string | null)[] = [];
  const paint = vi.fn(async () => { steps.push('paint'); });
  const run = (kind: Parameters<typeof printDocument>[0] = 'receipt') =>
    printDocument(kind, { desktop, dialog, paint, notify: (n) => { steps.push('notice'); notices.push(n); }, markPaper: (p) => papers.push(p) });
  return { desktop, dialog, notices, papers, paint, steps, run };
}

describe('printDocument', () => {
  it('opens the print window in a browser and the website demo, as before', async () => {
    const dialog = vi.fn();
    expect(await printDocument('invoice', { desktop: null, dialog })).toBe('dialog');
    expect(dialog).toHaveBeenCalledTimes(1);
  });

  it('prints to the chosen printer in the Windows app, without the print window', async () => {
    const app = windowsApp({ status: 'printed' });
    expect(await app.run()).toBe('printed');
    expect(app.desktop.print).toHaveBeenCalledWith('receipt');
    expect(app.dialog).not.toHaveBeenCalled();
    expect(app.notices).toEqual([]);
    // the receipt is drawn for the 58 mm roll while it prints, then back
    expect(app.papers).toEqual(['receipt58', null]);
  });

  it('opens the print window for "Ask every time", with nothing to say', async () => {
    const app = windowsApp({ status: 'ask' }, {});
    expect(await app.run('invoice')).toBe('dialog');
    expect(app.dialog).toHaveBeenCalledTimes(1);
    expect(app.notices).toEqual([]);
    expect(app.papers).toEqual([null]);
  });

  it('falls back to the print window and says so when the printer is gone or Windows has none', async () => {
    const gone = windowsApp({ status: 'missing', printer: 'Receipts' });
    expect(await gone.run()).toBe('dialog');
    expect(gone.dialog).toHaveBeenCalledTimes(1);
    expect(gone.notices).toEqual([{ code: 'missing', printer: 'Receipts' }]);
    const none = windowsApp({ status: 'noPrinters' });
    expect(await none.run()).toBe('dialog');
    expect(none.dialog).toHaveBeenCalledTimes(1);
    expect(none.notices).toEqual([{ code: 'noPrinters' }]);
  });

  it('says a printer failed (offline, no paper) and still offers the print window', async () => {
    const app = windowsApp({ status: 'failed', reason: 'printer' });
    expect(await app.run()).toBe('failed');
    expect(app.notices).toEqual([{ code: 'failed', printer: 'Receipts' }]);
    expect(app.dialog).toHaveBeenCalledTimes(1);
  });

  it('says nothing more when the person cancelled', async () => {
    const app = windowsApp({ status: 'failed', reason: 'cancelled' });
    expect(await app.run()).toBe('failed');
    expect(app.notices).toEqual([]);
    expect(app.dialog).not.toHaveBeenCalled();
  });

  it('asks to wait while another paper is being sent', async () => {
    const app = windowsApp({ status: 'busy' });
    expect(await app.run()).toBe('busy');
    expect(app.notices).toEqual([{ code: 'busy' }]);
    expect(app.dialog).not.toHaveBeenCalled();
  });

  it('opens the print window on a refusal, an error or an answer that is not one', async () => {
    for (const answer of [{ status: 'refused' }, null, undefined, 'printed', { status: 'done' }, new Error('ipc gone')]) {
      const app = windowsApp(answer);
      expect(await app.run(), String(answer)).toBe('dialog');
      expect(app.dialog).toHaveBeenCalledTimes(1);
      expect(app.papers.at(-1)).toBeNull();
    }
  });

  it('lets the notice show before the print window stops the page', async () => {
    for (const answer of [{ status: 'missing', printer: 'Receipts' }, { status: 'noPrinters' }, { status: 'failed', reason: 'printer' }]) {
      const app = windowsApp(answer);
      let drawn: () => void = () => {};
      app.paint.mockImplementationOnce(() => new Promise<void>((resolve) => { app.steps.push('paint'); drawn = resolve; }));
      const pending = app.run();
      await vi.waitFor(() => expect(app.steps).toEqual(['notice', 'paint']));
      // the page hasn't drawn the notice yet: no print window
      await new Promise((r) => setTimeout(r, 0));
      expect(app.dialog, JSON.stringify(answer)).not.toHaveBeenCalled();
      drawn();
      await pending;
      expect(app.steps).toEqual(['notice', 'paint', 'dialog']);
      // the paper stays marked until the print window is done
      expect(app.papers).toEqual(['receipt58', null]);
    }
  });

  it('opens the print window at once when there is nothing to say', async () => {
    for (const app of [windowsApp({ status: 'ask' }, {}), windowsApp({ status: 'refused' })]) {
      await app.run();
      expect(app.steps).toEqual(['dialog']);
    }
  });

  it('still opens the print window when waiting for the page fails', async () => {
    const app = windowsApp({ status: 'noPrinters' });
    app.paint.mockRejectedValueOnce(new Error('no page'));
    expect(await app.run()).toBe('dialog');
    expect(app.dialog).toHaveBeenCalledTimes(1);
  });

  it('opens the print window for a kind that is not one, without asking the app', async () => {
    const app = windowsApp({ status: 'printed' });
    expect(await app.run('cheque' as never)).toBe('dialog');
    expect(app.desktop.print).not.toHaveBeenCalled();
  });
});

describe('waiting for the page to draw', () => {
  it('waits for a frame, then a short pause', async () => {
    vi.useFakeTimers();
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => { frames.push(run); return frames.length; });
    try {
      let done = false;
      void afterPaint(100).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(500);
      expect(done).toBe(false); // no frame yet
      frames.shift()!();
      await vi.advanceTimersByTimeAsync(99);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('never waits more than a second, even in a hidden window that gets no frames', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', () => 1);
    try {
      let done = false;
      void afterPaint().then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

/** A page for printAlone: its body classes, its afterprint listeners and its timers. */
function fakePage() {
  const classes = new Set<string>();
  const listeners = new Set<() => void>();
  const timers: (() => void)[] = [];
  const page: AlonePage = {
    addClass: (name) => { classes.add(name); },
    removeClass: (name) => { classes.delete(name); },
    onAfterPrint: (l) => { listeners.add(l); },
    offAfterPrint: (l) => { listeners.delete(l); },
    later: (run) => { timers.push(run); }
  };
  return {
    page, classes, listeners,
    afterprint: () => { for (const l of [...listeners]) l(); },
    runTimers: () => { while (timers.length) timers.shift()!(); }
  };
}

describe('printing one part of the page alone', () => {
  it('shows only that part while the print window is open, and puts the page back when it closes', async () => {
    const p = fakePage();
    const app = windowsApp({ status: 'missing', printer: 'Receipts' });
    let inPrint = false;
    const result = await printAlone('receipt', 'pos-printing', {
      desktop: app.desktop, paint: async () => {}, notify: () => {}, markPaper: () => {}, page: p.page,
      dialog: () => { inPrint = p.classes.has('pos-printing'); p.afterprint(); }
    });
    expect(result).toBe('dialog');
    expect(inPrint).toBe(true);
    expect(p.classes.size).toBe(0);
    expect(p.listeners.size).toBe(0);
    p.runTimers(); // the late clean-up changes nothing
    expect(p.classes.size).toBe(0);
  });

  it('puts the page back after the paper went to the printer, with no print window', async () => {
    const p = fakePage();
    const app = windowsApp({ status: 'printed' });
    await printAlone('receipt', 'pos-printing', { desktop: app.desktop, dialog: app.dialog, markPaper: () => {}, page: p.page });
    expect(p.classes.has('pos-printing')).toBe(true);
    p.runTimers();
    expect(p.classes.size).toBe(0);
    expect(p.listeners.size).toBe(0);
  });

  it('keeps the part shown while another print of it is still on its way', async () => {
    const p = fakePage();
    let sent: (v: unknown) => void = () => {};
    const slow: DesktopPrinters = { ...windowsApp(null).desktop, print: vi.fn(() => new Promise((resolve) => { sent = resolve; })) };
    const env = { desktop: slow, dialog: () => {}, markPaper: () => {}, notify: () => {}, page: p.page };
    const first = printAlone('receipt', 'pos-printing', env);
    await vi.waitFor(() => expect(slow.print).toHaveBeenCalledTimes(1));
    // a second press while the first is still sent: the Windows app says busy at once
    const busy: DesktopPrinters = { ...slow, print: vi.fn(async () => ({ status: 'busy' })) };
    expect(await printAlone('receipt', 'pos-printing', { ...env, desktop: busy })).toBe('busy');
    p.runTimers();
    expect(p.classes.has('pos-printing')).toBe(true);
    sent({ status: 'printed' });
    expect(await first).toBe('printed');
    p.runTimers();
    expect(p.classes.size).toBe(0);
  });
});

describe('answers from the Windows app', () => {
  it('reads outcomes strictly', () => {
    expect(outcomeOf({ status: 'missing' })).toEqual({ status: 'missing', printer: '' });
    expect(outcomeOf({ status: 'failed', reason: 'weird' })).toEqual({ status: 'failed', reason: 'printer' });
    expect(outcomeOf({ status: 'printed', extra: 1 })).toEqual({ status: 'printed' });
    expect(outcomeOf({ status: 'toString' })).toBeNull();
  });

  it('keeps only printers with real names', () => {
    expect(printersOf([{ name: 'A', displayName: 'Printer A' }, { name: '' }, null, 'B', { name: 'C' }])).toEqual([
      { name: 'A', displayName: 'Printer A' }, { name: 'C', displayName: 'C' }
    ]);
    expect(printersOf(null)).toEqual([]);
  });

  it('finds the bridge only when all four calls are there', () => {
    vi.stubGlobal('window', { qasaDesktop: { setLanguage() {}, printers: { list() {}, get() {}, set() {} } } });
    expect(desktopPrinters()).toBeNull();
    vi.stubGlobal('window', { qasaDesktop: { setLanguage() {}, printers: { list() {}, get() {}, set() {}, print() {} } } });
    expect(desktopPrinters()).not.toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('saving a choice', () => {
  it('checks the choice before the app sees it, and reads back what the app saved', async () => {
    const app = windowsApp({ status: 'printed' });
    expect(await saveChoice(app.desktop, 'receipt', { ...receipt, copies: 9 } as never, ['Receipts'])).toBeNull();
    expect(await saveChoice(app.desktop, 'receipt', { ...receipt, printer: 'Elsewhere' }, ['Receipts'])).toBeNull();
    expect(app.desktop.set).not.toHaveBeenCalled();
    expect(await saveChoice(app.desktop, 'receipt', receipt, ['Receipts'])).toEqual({ receipt });
    expect(await saveChoice(app.desktop, 'receipt', null, [])).toEqual({ receipt });
    expect(app.desktop.set).toHaveBeenCalledTimes(2);
  });

  it('reports a refusal as not saved', async () => {
    const app = windowsApp({ status: 'printed' });
    (app.desktop.set as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    expect(await saveChoice(app.desktop, 'receipt', receipt, ['Receipts'])).toBeNull();
  });
});
