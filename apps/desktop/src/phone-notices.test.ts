import { describe, expect, it, vi } from 'vitest';
import { NOTICE_GAP_MS, phoneNoticeHandler, phoneNoticeOf, type PhoneNotice } from './phone-notices.ts';

// 1.5: work from phones as Windows notifications, from the app window's own page only, with plain text and one of the
// app's own pages to open; a click brings the window forward and opens it.

function setup(fromApp = true) {
  let now = 1_000_000;
  const shown: { notice: PhoneNotice; click(): void }[] = [];
  const open = vi.fn();
  const handler = phoneNoticeHandler({
    fromAppPage: () => fromApp, supported: () => true,
    show: (notice, click) => { shown.push({ notice, click }); },
    open, now: () => now, log: () => {}
  });
  return { handler, shown, open, later: (ms: number) => { now += ms; } };
}

describe('a notice of work from phones', () => {
  it('shows what the page asked for, and a click opens its page in the app window', () => {
    const s = setup();
    expect(s.handler({}, { title: 'Mer · Draft sale from a phone · 250,000 IQD', body: 'on Mer phone', route: 'invoice/abc-1' })).toBe(true);
    expect(s.shown[0]!.notice).toEqual({ title: 'Mer · Draft sale from a phone · 250,000 IQD', body: 'on Mer phone', route: 'invoice/abc-1' });
    s.shown[0]!.click();
    expect(s.open).toHaveBeenCalledWith('invoice/abc-1');
  });

  it('is refused from anything but the app page, and shown at most once every few seconds', () => {
    expect(setup(false).handler({}, { title: 'x', body: '', route: '' })).toBe(false);
    const s = setup();
    expect(s.handler({}, { title: '3 new from phones', body: '', route: '' })).toBe(true);
    expect(s.handler({}, { title: 'again', body: '', route: '' })).toBe(false);
    s.later(NOTICE_GAP_MS);
    expect(s.handler({}, { title: 'again', body: '', route: '' })).toBe(true);
  });

  it('takes plain text, cut short, and opens only the app\'s own pages of such work', () => {
    expect(phoneNoticeOf({ title: 'Mer‮\n·\u0007 sale', body: 'x'.repeat(500), route: 'entry/e-1' })).toEqual({ title: 'Mer · sale', body: 'x'.repeat(240), route: 'entry/e-1' });
    for (const route of ['stock-count', 'settings/network', 'entries', 'quote/q-1', 'stock-doc/s-1', 'purchase-order/p-1', '']) {
      expect(phoneNoticeOf({ title: 't', body: '', route }), route).not.toBeNull();
    }
    for (const route of ['https://example.com', '../users', 'users', 'invoice/../x', 'invoice/a b', 'invoice/', 'settings/backups', 'javascript:alert(1)']) {
      expect(phoneNoticeOf({ title: 't', body: '', route }), route).toBeNull();
    }
    for (const bad of [null, 'text', [], { title: '', body: '', route: '' }, { title: 1, body: '', route: '' }, { title: 't', body: '' }]) expect(phoneNoticeOf(bad)).toBeNull();
  });
});
