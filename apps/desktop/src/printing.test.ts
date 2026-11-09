import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { printingHandlers, type PrintTarget } from './printing.ts';

/** The app window's webContents, as printing uses it: its printers, and print() answering as asked. */
function fakeWindow(printers: { name: string; displayName?: string }[] = [{ name: 'Office Laser', displayName: 'Office Laser' }, { name: 'Receipts', displayName: 'Receipt printer' }]) {
  const target = {
    printers,
    answer: [true, ''] as [boolean, string],
    getPrintersAsync: vi.fn(async () => target.printers),
    print: vi.fn((_options: object, callback: (success: boolean, failureReason: string) => void) => { callback(...target.answer); })
  };
  return target;
}

/** silentGapMs: the gap between silent prints (0 here unless a test checks it); the clock is the test's own. */
function setup(options: { file?: string | null; appPage?: boolean; target?: PrintTarget | null; silentGapMs?: number } = {}) {
  const win = fakeWindow();
  let file: string | null = options.file ?? null;
  const writes: string[] = [];
  const clock = { now: 1_000_000 };
  const handlers = printingHandlers({
    target: () => (options.target !== undefined ? options.target : win),
    fromAppPage: () => options.appPage ?? true,
    readFile: () => file,
    writeFile: (text) => { file = text; writes.push(text); },
    log: () => {},
    timeoutMs: 1000,
    silentGapMs: options.silentGapMs ?? 0,
    now: () => clock.now
  });
  return { win, handlers, writes, clock, file: () => file, event: { sender: options.target !== undefined ? options.target : win } };
}

const choice = { printer: 'Receipts', paper: 'receipt80', margins: 'none', copies: 2, silent: true };
const saved = (choices: object) => JSON.stringify({ version: 1, choices });

describe('who may ask', () => {
  it('answers only the app window’s own page', async () => {
    const { handlers, win } = setup({ appPage: false });
    expect(await handlers.list({ sender: win })).toBeNull();
    expect(handlers.get({ sender: win })).toBeNull();
    expect(await handlers.set({ sender: win }, 'receipt', choice)).toBeNull();
    expect(await handlers.print({ sender: win }, 'receipt')).toEqual({ status: 'refused' });
    expect(win.print).not.toHaveBeenCalled();
  });

  it('never prints another window, even one that passes the page check', async () => {
    const { handlers, win } = setup({ file: saved({ receipt: choice }) });
    const other = fakeWindow();
    expect(await handlers.print({ sender: other }, 'receipt')).toEqual({ status: 'refused' });
    expect(other.print).not.toHaveBeenCalled();
    expect(win.print).not.toHaveBeenCalled();
  });

  it('does nothing without a window', async () => {
    const { handlers } = setup({ target: null });
    expect(await handlers.print({ sender: null }, 'receipt')).toEqual({ status: 'refused' });
  });
});

describe('the printers and the saved choices', () => {
  it('lists the printers Windows has, without duplicates or names that are not names', async () => {
    const { handlers, win, event } = setup();
    win.printers = [{ name: 'Office Laser', displayName: 'Office Laser' }, { name: 'Office Laser' }, { name: '' }, { name: 'Bad\u0000name' }, { name: 'Receipts', displayName: '  ' }];
    expect(await handlers.list(event)).toEqual([{ name: 'Office Laser', displayName: 'Office Laser' }, { name: 'Receipts', displayName: 'Receipts' }]);
  });

  it('saves a valid choice for a kind and reads it back', async () => {
    const { handlers, event, writes } = setup();
    expect(await handlers.set(event, 'receipt', choice)).toEqual({ receipt: choice });
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!).choices).toEqual({ receipt: choice });
    expect(handlers.get(event)).toEqual({ receipt: choice });
  });

  it('refuses an unknown kind, a printer Windows does not list, and any value off the lists', async () => {
    const { handlers, event, writes } = setup();
    for (const [kind, value] of [
      ['cheque', choice], ['__proto__', choice], [7, choice],
      ['receipt', { ...choice, printer: 'Someone else’s printer' }],
      ['receipt', { ...choice, paper: 'A0' }], ['receipt', { ...choice, margins: 'custom' }],
      ['receipt', { ...choice, copies: 6 }], ['receipt', { ...choice, copies: 0 }], ['receipt', { ...choice, silent: 1 }],
      ['receipt', 'Receipts'], ['receipt', undefined]
    ] as [unknown, unknown][]) {
      expect(await handlers.set(event, kind, value), JSON.stringify([kind, value])).toBeNull();
    }
    expect(writes).toHaveLength(0);
  });

  it('puts a kind back to "Ask every time"', async () => {
    const { handlers, event } = setup({ file: saved({ receipt: choice, invoice: { ...choice, printer: 'Office Laser', paper: 'A4' } }) });
    expect(await handlers.set(event, 'receipt', null)).toEqual({ invoice: { ...choice, printer: 'Office Laser', paper: 'A4' } });
  });

  it('reads a damaged or edited file as what is valid in it', () => {
    expect(setup({ file: '{not json' }).handlers.get({ sender: null })).toBeNull(); // no window: refused
    const damaged = setup({ file: '{not json' });
    expect(damaged.handlers.get(damaged.event)).toEqual({});
    const edited = setup({ file: saved({ receipt: { ...choice, copies: 500 }, invoice: { ...choice, printer: 'Office Laser' } }) });
    expect(edited.handlers.get(edited.event)).toEqual({ invoice: { ...choice, printer: 'Office Laser' } });
  });
});

describe('printing', () => {
  it('asks when nothing is saved for the kind, or "Ask every time" is', async () => {
    const { handlers, event, win } = setup({ file: saved({ invoice: { ...choice, printer: null, silent: false } }) });
    expect(await handlers.print(event, 'receipt')).toEqual({ status: 'ask' });
    expect(await handlers.print(event, 'invoice')).toEqual({ status: 'ask' });
    expect(win.print).not.toHaveBeenCalled();
  });

  it('prints labels on the paper of the layout picked on the labels page, with the saved printer', async () => {
    const label = { printer: 'Office Laser', paper: 'label38x25', margins: 'none', copies: 1, silent: true };
    const { handlers, event, win } = setup({ file: saved({ label, receipt: choice }) });
    expect(await handlers.print(event, 'label', 'a4_3x8')).toEqual({ status: 'printed' });
    expect(win.print.mock.calls[0]![0]).toEqual({
      silent: true, deviceName: 'Office Laser', printBackground: true, copies: 1, margins: { marginType: 'none' }, pageSize: 'A4'
    });
    expect(await handlers.print(event, 'label', '50x30')).toEqual({ status: 'printed' });
    expect(win.print.mock.calls[1]![0]).toMatchObject({ deviceName: 'Office Laser', pageSize: { width: 50_000, height: 30_000 } });
    // without a layout, the saved paper
    expect(await handlers.print(event, 'label')).toEqual({ status: 'printed' });
    expect(win.print.mock.calls[2]![0]).toMatchObject({ pageSize: { width: 38_000, height: 25_000 } });
    // anything that is not a layout, or a layout for another kind, is refused
    for (const [kind, layout] of [['label', 'A4'], ['label', '__proto__'], ['label', 7], ['label', null], ['receipt', 'a4_3x8']] as const) {
      expect(await handlers.print(event, kind, layout), `${kind} ${String(layout)}`).toEqual({ status: 'refused' });
    }
    expect(win.print).toHaveBeenCalledTimes(3);
  });

  it('prints the app window with the saved choice', async () => {
    const { handlers, event, win } = setup({ file: saved({ receipt: choice }) });
    expect(await handlers.print(event, 'receipt')).toEqual({ status: 'printed' });
    expect(win.print).toHaveBeenCalledTimes(1);
    expect(win.print.mock.calls[0]![0]).toEqual({
      silent: true, deviceName: 'Receipts', printBackground: true, copies: 2, margins: { marginType: 'none' }, pageSize: { width: 80_000, height: 297_000 }
    });
  });

  it('says when Windows lists no printer, or the saved one is gone', async () => {
    const none = setup({ file: saved({ receipt: choice }) });
    none.win.printers = [];
    expect(await none.handlers.print(none.event, 'receipt')).toEqual({ status: 'noPrinters' });
    const gone = setup({ file: saved({ receipt: choice }) });
    gone.win.printers = [{ name: 'Office Laser' }];
    expect(await gone.handlers.print(gone.event, 'receipt')).toEqual({ status: 'missing', printer: 'Receipts' });
    expect(none.win.print).not.toHaveBeenCalled();
    expect(gone.win.print).not.toHaveBeenCalled();
  });

  it('reports a printer that fails (offline, no paper) apart from a cancelled print', async () => {
    const { handlers, event, win } = setup({ file: saved({ receipt: choice }) });
    win.answer = [false, 'Print job failed'];
    expect(await handlers.print(event, 'receipt')).toEqual({ status: 'failed', reason: 'printer' });
    win.answer = [false, 'cancelled'];
    expect(await handlers.print(event, 'receipt')).toEqual({ status: 'failed', reason: 'cancelled' });
    win.print.mockImplementationOnce(() => { throw new Error('printer offline'); });
    expect(await handlers.print(event, 'receipt')).toEqual({ status: 'failed', reason: 'printer' });
  });

  it('gives up on a printer that never answers', async () => {
    vi.useFakeTimers();
    try {
      const { handlers, event, win } = setup({ file: saved({ receipt: choice }) });
      win.print.mockImplementationOnce(() => {});
      const pending = handlers.print(event, 'receipt');
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toEqual({ status: 'failed', reason: 'printer' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits as long as the person needs in the Windows print window, and holds the next print until it closes', async () => {
    vi.useFakeTimers();
    try {
      const { handlers, event, win } = setup({ file: saved({ receipt: { ...choice, silent: false } }) });
      let finish: (success: boolean, reason: string) => void = () => {};
      win.print.mockImplementationOnce((_o, callback) => { finish = callback; });
      const first = handlers.print(event, 'receipt');
      await vi.waitFor(() => expect(win.print).toHaveBeenCalledTimes(1));
      expect(win.print.mock.calls[0]![0]).toMatchObject({ silent: false });
      // ten minutes with the print window open: not a failure, and still one paper at a time
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      let settled = false;
      void first.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      expect(await handlers.print(event, 'receipt')).toEqual({ status: 'busy' });
      expect(win.print).toHaveBeenCalledTimes(1);
      finish(true, '');
      expect(await first).toEqual({ status: 'printed' });
      expect(await handlers.print(event, 'receipt')).toEqual({ status: 'printed' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets go of the print lock when the page is gone while the Windows print window is open', async () => {
    const cases: [string, unknown[]][] = [
      ['destroyed', []],
      ['render-process-gone', [{}, { reason: 'crashed' }]],
      ['did-start-navigation', [{ isMainFrame: true, isSameDocument: false, url: 'qasa://app/' }]]
    ];
    for (const [event, args] of cases) {
      const { handlers, event: from, win } = setup({ file: saved({ receipt: { ...choice, silent: false } }) });
      const emitter = new EventEmitter();
      Object.assign(win, { on: emitter.on.bind(emitter), removeListener: emitter.removeListener.bind(emitter) });
      // the print window never answers: the page that asked was closed, crashed or reloaded
      win.print.mockImplementationOnce(() => {});
      const first = handlers.print(from, 'receipt');
      await vi.waitFor(() => expect(win.print).toHaveBeenCalledTimes(1));
      expect(await handlers.print(from, 'receipt'), event).toEqual({ status: 'busy' });
      // a change of route inside the page is no new page: still busy
      emitter.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
      expect(await handlers.print(from, 'receipt'), event).toEqual({ status: 'busy' });
      emitter.emit(event, ...args);
      expect(await first, event).toEqual({ status: 'failed', reason: 'cancelled' });
      expect(await handlers.print(from, 'receipt'), event).toEqual({ status: 'printed' });
      // nothing is left listening once the prints are over
      for (const name of ['destroyed', 'render-process-gone', 'did-start-navigation']) expect(emitter.listenerCount(name), name).toBe(0);
    }
  });

  it('leaves at least 1.5 seconds between prints without the print window, so a page can’t flood the printer', async () => {
    const { event, win, clock } = setup();
    // the Windows app's own default gap
    const app = printingHandlers({
      target: () => win, fromAppPage: () => true, readFile: () => saved({ receipt: choice }), writeFile: () => {}, log: () => {},
      now: () => clock.now
    });
    expect(await app.print(event, 'receipt')).toEqual({ status: 'printed' });
    clock.now += 1_499;
    expect(await app.print(event, 'receipt')).toEqual({ status: 'busy' });
    for (let i = 0; i < 20; i++) expect(await app.print(event, 'receipt')).toEqual({ status: 'busy' });
    expect(win.print).toHaveBeenCalledTimes(1);
    clock.now += 1;
    expect(await app.print(event, 'receipt')).toEqual({ status: 'printed' });
    expect(win.print).toHaveBeenCalledTimes(2);
    // the gap counts from the end of a print, and a failed print counts too
    win.answer = [false, 'Print job failed'];
    clock.now += 5_000;
    expect(await app.print(event, 'receipt')).toEqual({ status: 'failed', reason: 'printer' });
    clock.now += 1_000;
    expect(await app.print(event, 'receipt')).toEqual({ status: 'busy' });
  });

  it('does not hold back prints that open the print window', async () => {
    const { event, win, clock } = setup();
    const file = saved({ receipt: choice, invoice: { ...choice, printer: 'Office Laser', paper: 'A4', silent: false } });
    const app = printingHandlers({
      target: () => win, fromAppPage: () => true, readFile: () => file, writeFile: () => {}, log: () => {}, now: () => clock.now
    });
    expect(await app.print(event, 'receipt')).toEqual({ status: 'printed' });
    // the person answers each print window, so those are never too fast
    expect(await app.print(event, 'invoice')).toEqual({ status: 'printed' });
    expect(await app.print(event, 'invoice')).toEqual({ status: 'printed' });
    expect(await app.print(event, 'receipt')).toEqual({ status: 'busy' });
  });

  it('sends one paper at a time', async () => {
    const { handlers, event, win } = setup({ file: saved({ receipt: choice }) });
    let finish: () => void = () => {};
    win.print.mockImplementationOnce((_o, callback) => { finish = () => callback(true, ''); });
    const first = handlers.print(event, 'receipt');
    await vi.waitFor(() => expect(win.print).toHaveBeenCalledTimes(1));
    expect(await handlers.print(event, 'receipt')).toEqual({ status: 'busy' });
    finish();
    expect(await first).toEqual({ status: 'printed' });
    expect(await handlers.print(event, 'receipt')).toEqual({ status: 'printed' });
  });

  it('refuses a kind that is not one', async () => {
    const { handlers, event, win } = setup({ file: saved({ receipt: choice }) });
    for (const kind of ['cheque', '', null, { kind: 'receipt' }, ['receipt']]) expect(await handlers.print(event, kind)).toEqual({ status: 'refused' });
    expect(win.print).not.toHaveBeenCalled();
  });
});
