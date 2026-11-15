import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Lang } from '@qasa/core';
import { DataContext, DisplayContext } from './components.tsx';
import { I18nContext, makeI18n } from './i18n.ts';
import { foldAnswer, PhoneBellView, PhoneNotifySetting, type Shown } from './industry/PhoneActivity.tsx';
import { docRoute, freshItems, noticeFor, pollDelay, whatToTell, type PhoneActivityAnswer, type PhoneActivityItem } from './industry/phone-activity.ts';
import { DisplaySettings } from './pages/Settings.tsx';

// 1.5: work from phones at the office PCs: the header's "From phones" with its count and list, the Windows notices
// (one per arrival, a burst as one), and "Notify me of work from phones" on this PC.

const i18n = (lang: Lang = 'en') => makeI18n(lang, 'western', () => {}, () => {});
const words = (lang: Lang = 'en') => {
  const w = i18n(lang);
  return [w.t, (a: number, c: 'IQD' | 'USD') => w.money(a, c), (n: number) => w.int(n)] as const;
};
const item = (id: number, more: Partial<PhoneActivityItem> = {}): PhoneActivityItem =>
  ({ id, at: '2026-11-15T09:30:00.000Z', kind: 'sale', phone: 'Mer phone', user: 'Mer', doc: `doc-${id}`, ...more });
const wrap = (node: ReactNode, lang: Lang = 'en', modules?: string[]) => renderToStaticMarkup(
  <I18nContext.Provider value={i18n(lang)}>
    <DisplayContext.Provider value={{ theme: 'light', density: 'comfortable', setTheme: () => {}, setDensity: () => {} }}>
      {modules ? <DataContext.Provider value={{ modules } as never}>{node}</DataContext.Provider> : node}
    </DisplayContext.Provider>
  </I18nContext.Provider>
);

describe('what a notice says and opens', () => {
  it('opens the document each kind is, and the phones list for a count from phone app 1.0', () => {
    expect(docRoute(item(1))).toBe('invoice/doc-1');
    expect(docRoute(item(1, { kind: 'order' }))).toBe('quote/doc-1');
    expect(docRoute(item(1, { kind: 'receipt' }))).toBe('entry/doc-1');
    expect(docRoute(item(1, { kind: 'expense' }))).toBe('entry/doc-1');
    expect(docRoute(item(1, { kind: 'transfer' }))).toBe('stock-doc/doc-1');
    expect(docRoute(item(1, { kind: 'received' }))).toBe('purchase-order/doc-1');
    expect(docRoute(item(1, { kind: 'count' }))).toBe('stock-count');
    expect(docRoute(item(1, { kind: 'count', doc: null }))).toBe('settings/network');
    expect(docRoute(item(1, { doc: null }))).toBe('');
  });

  it('says who, what and how much for one, and gathers several into one notice that opens the list', () => {
    const one = noticeFor([item(7, { amount: 250_000, currency: 'IQD' })], ...words());
    expect(one).toEqual({ title: `Mer · Draft sale from a phone · ${i18n().money(250_000, 'IQD')}`, body: 'on Mer phone', route: 'invoice/doc-7' });
    // no amount for someone who does not see the figures; the phone's name when it has no user (no sign-in)
    expect(noticeFor([item(8, { kind: 'receipt', user: null })], ...words())!.title).toBe('Mer phone · Receipt voucher from a phone');
    const burst = noticeFor([item(1), item(2, { kind: 'order', user: 'Raz' }), item(3, { kind: 'count', user: 'Las' }), item(4, { kind: 'expense' })], ...words());
    expect(burst).toEqual({ title: '4 new from phones', body: 'Mer · Expense — Las · Stock count — Raz · Order …', route: '' });
    expect(noticeFor([], ...words())).toBeNull();
    // in Arabic and Kurdish, with the app's own words
    expect(noticeFor([item(9)], ...words('ar'))!.title).toBe('Mer · مسودة بيع من الهاتف');
    expect(noticeFor([item(9, { kind: 'receipt' })], ...words('ku'))!.title).toBe('Mer · سەنەدی وەرگرتن لە مۆبایلەوە');
  });

  it('tells only what is newer than what was told on this PC and what the person has seen; nothing the first time or when off', () => {
    const items = [item(30), item(20), item(10)];
    expect(freshItems(items, 10, 0).map((i) => i.id)).toEqual([20, 30]);
    expect(freshItems(items, 10, 25).map((i) => i.id)).toEqual([30]);
    const answer: PhoneActivityAnswer = { on: true, last: 31, seen: 0, unseen: 3, items, waiting: null };
    expect(whatToTell(answer, null, true, ...words())).toEqual({ toldUpTo: 31, notice: null });
    expect(whatToTell(answer, 20, true, ...words())).toMatchObject({ toldUpTo: 31, notice: { route: 'invoice/doc-30' } });
    expect(whatToTell(answer, 5, true, ...words())!.notice!.title).toBe('3 new from phones');
    expect(whatToTell(answer, 20, false, ...words())).toEqual({ toldUpTo: 31, notice: null });
    expect(whatToTell(answer, 40, true, ...words())).toEqual({ toldUpTo: 40, notice: null });
    // "nothing new" (no list): nothing changes
    expect(whatToTell({ on: true, last: 31, seen: 0, waiting: null }, 20, true, ...words())).toBeNull();
  });

  it('asks every 20 seconds in view, a minute hidden, five minutes with no phone, and backs off after failures', () => {
    expect(pollDelay({ hidden: false, on: true, failures: 0 })).toBe(20_000);
    expect(pollDelay({ hidden: true, on: true, failures: 0 })).toBe(60_000);
    expect(pollDelay({ hidden: false, on: false, failures: 0 })).toBe(300_000);
    expect(pollDelay({ hidden: false, on: true, failures: 1 })).toBe(40_000);
    expect(pollDelay({ hidden: false, on: true, failures: 9 })).toBe(300_000);
  });
});

describe('the header\'s "From phones"', () => {
  const shown = (more: Partial<Shown> = {}): Shown => ({ on: true, last: 50, seen: 15, unseen: 2, items: [item(20, { amount: 10_000, currency: 'IQD' }), item(10, { kind: 'transfer', user: 'Las' })], waiting: null, ...more });

  it('shows how many are new (and waiting for approval) on the phone button, and the list when open', () => {
    const closed = wrap(<PhoneBellView shown={shown({ waiting: 3 })} open={false} setOpen={() => {}} />);
    expect(closed).toContain('<span class="phone-bell-count" aria-hidden="true">5</span>');
    expect(closed).toContain('aria-label="From phones: 5 new"');
    expect(closed).not.toContain('phone-menu');
    const open = wrap(<PhoneBellView shown={shown({ waiting: 1 })} open setOpen={() => {}} />);
    expect(open).toContain('1 voucher waiting for your approval');
    expect(open).toContain('href="#/entries"');
    expect(open).toContain(`Mer · Draft sale from a phone · ${i18n().money(10_000, 'IQD')}`);
    expect(open).toContain('Las · Transfer from a phone');
    expect(open).toContain('on Mer phone');
    // what is new to this person stands out
    expect(open.split('menu-item phone-row new').length - 1).toBe(1);
  });

  it('has no count when nothing is new, says so when the list is empty, and is not there with no phone and nothing waiting', () => {
    expect(wrap(<PhoneBellView shown={shown({ unseen: 0 })} open={false} setOpen={() => {}} />)).not.toContain('phone-bell-count');
    expect(wrap(<PhoneBellView shown={shown({ items: [], unseen: 0 })} open setOpen={() => {}} />)).toContain('Nothing new from phones.');
    expect(wrap(<PhoneBellView shown={shown({ on: false, items: [], unseen: 0 })} open={false} setOpen={() => {}} />)).toBe('');
    expect(wrap(<PhoneBellView shown={shown({ on: false, items: [], unseen: 0, waiting: 2 })} open={false} setOpen={() => {}} />)).toContain('phone-bell-count');
    expect(wrap(<PhoneBellView shown={shown()} open setOpen={() => {}} />, 'ku')).toContain('لە مۆبایلەکانەوە');
  });

  it('keeps its list when the office says nothing changed, and its count no higher than what is still unseen', () => {
    const before = shown({ seen: 5, unseen: 2 });
    expect(foldAnswer(before, { on: true, last: 50, seen: 5, waiting: 1 })).toMatchObject({ unseen: 2, items: before.items, waiting: 1 });
    // seen on another PC since: the count follows
    expect(foldAnswer(before, { on: true, last: 50, seen: 20, waiting: null }).unseen).toBe(0);
    expect(foldAnswer(before, { on: true, last: 60, seen: 15, unseen: 1, items: [item(55)], waiting: null })).toMatchObject({ unseen: 1, last: 60 });
  });
});

describe('"Notify me of work from phones"', () => {
  it('is in Language and display where the build brings work from phones, on unless switched off on this PC', () => {
    const html = wrap(<PhoneNotifySetting />);
    expect(html).toContain('Notify me of work from phones');
    expect(html).toMatch(/aria-checked="true"[^]*?choice-label">On</);
    // (the display section reads the window: a bare one stands for it here)
    const w = globalThis as unknown as { window?: unknown };
    w.window = {};
    try {
      expect(wrap(<DisplaySettings />, 'en', ['phoneActivity'])).toContain('Notify me of work from phones');
      expect(wrap(<DisplaySettings />, 'en', ['phones'])).not.toContain('Notify me of work from phones');
      expect(wrap(<DisplaySettings />, 'ar', ['phoneActivity'])).toContain('أعلمني بعمل الهواتف');
    } finally {
      delete w.window;
    }
  });
});
