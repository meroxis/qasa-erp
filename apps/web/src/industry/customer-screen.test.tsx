import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { closeCustomerScreen, customerScreenState, kickDrawer, openCustomerScreen } from './till.ts';

afterEach(() => { vi.unstubAllGlobals(); });

/** The Windows app's bridge (app-preload.ts, qasaDesktop.till), with a customer screen that opens and closes. */
function desktop(over: Record<string, unknown> = {}) {
  const win = { open: false, waiting: false };
  const till = {
    openDrawer: vi.fn(async () => ({ status: 'opened' })),
    customerDisplay: vi.fn(async (open: boolean) => { win.open = open; win.waiting = false; return open; }),
    customerDisplayState: vi.fn(async () => ({ ...win })),
    ...over
  };
  vi.stubGlobal('window', { qasaDesktop: { till } });
  return { till, win };
}

describe('the customer screen from the till and Settings (the third review: nothing closed it)', () => {
  it('is opened, seen as open and closed through the Windows app', async () => {
    const { till, win } = desktop();
    expect(await customerScreenState()).toEqual({ open: false, waiting: false });
    expect(await openCustomerScreen()).toBe(true);
    expect(await customerScreenState()).toEqual({ open: true, waiting: false });
    // its screen unplugged: the app hides it (never over the till) and says so
    win.waiting = true;
    expect(await customerScreenState()).toEqual({ open: true, waiting: true });
    await closeCustomerScreen();
    expect(till.customerDisplay).toHaveBeenLastCalledWith(false);
    expect(await customerScreenState()).toEqual({ open: false, waiting: false });
  });

  it('reads an older Windows app (no state call) and a bridge that fails as "not open", and never throws', async () => {
    desktop({ customerDisplayState: undefined });
    expect(await customerScreenState()).toEqual({ open: false, waiting: false });
    desktop({ customerDisplayState: vi.fn(async () => { throw new Error('gone'); }), customerDisplay: vi.fn(async () => { throw new Error('gone'); }) });
    expect(await customerScreenState()).toEqual({ open: false, waiting: false });
    expect(await openCustomerScreen()).toBe(false);
    await expect(closeCustomerScreen()).resolves.toBeUndefined();
  });

  it('in a browser, closes the window this page opened for the customer', async () => {
    const popup = { closed: false, close: vi.fn(() => { popup.closed = true; }) };
    const open = vi.fn(() => popup);
    vi.stubGlobal('window', { open });
    vi.stubGlobal('location', { pathname: '/' });
    expect(await customerScreenState()).toEqual({ open: false, waiting: false });
    expect(await openCustomerScreen()).toBe(true);
    expect(open).toHaveBeenCalledWith('/#/customer-display', 'qasa-customer-display', 'popup,width=900,height=600');
    expect(await customerScreenState()).toEqual({ open: true, waiting: false });
    await closeCustomerScreen();
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(await customerScreenState()).toEqual({ open: false, waiting: false });
    // a pop-up the browser blocked
    open.mockReturnValueOnce(null as never);
    expect(await openCustomerScreen()).toBe(false);
  });
});

describe('the cash drawer\'s answer', () => {
  it('passes "blocked" (Windows policy) on to the till, apart from a printer that failed', async () => {
    desktop({ openDrawer: vi.fn(async () => ({ status: 'blocked' })) });
    expect(await kickDrawer()).toBe('blocked');
    desktop({ openDrawer: vi.fn(async () => ({ status: 'something new' })) });
    expect(await kickDrawer()).toBe('failed');
  });
});

describe('the customer screen card in Settings → Tills', () => {
  it('offers Open and Close, in the three languages', async () => {
    const { CustomerScreenCard } = await import('./CustomerScreenControl.tsx');
    const { I18nContext, makeI18n } = await import('../i18n.ts');
    const words = { ar: ['فتح', 'إغلاق'], en: ['Open', 'Close'], ku: ['کردنەوە', 'داخستن'] } as const;
    for (const lang of ['ar', 'en', 'ku'] as const) {
      const html = renderToStaticMarkup(<I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}><CustomerScreenCard /></I18nContext.Provider>);
      expect(html).toContain('data-setting="pos-customer-screen"');
      expect(html.match(/<button/g), lang).toHaveLength(2);
      for (const word of words[lang]) expect(html, lang).toContain(`>${word}</button>`);
      // nothing open yet: Close is disabled
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>/);
    }
  });
});
