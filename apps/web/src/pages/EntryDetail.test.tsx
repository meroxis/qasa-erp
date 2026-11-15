import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataContext } from '../components.tsx';
import { I18nContext, isKey, makeI18n, type Key } from '../i18n.ts';
import type { EntryView } from '../api.ts';
import { EntryDetail, ReceiptPhoto } from './EntryDetail.tsx';

// 1.5: a voucher with the photo of its paper receipt (an expense recorded on the phone app) shows the photo on its page.

/** What the server has answered, by the name of the call; anything else never answers. */
const { now, answering } = vi.hoisted(() => {
  const now = { answers: {} as Record<string, unknown> };
  const answering = () => new Proxy({}, {
    get: (_, name: string) => () => (name in now.answers ? Object.assign(Promise.resolve(now.answers[name]), { answer: now.answers[name] }) : new Promise(() => {}))
  });
  return { now, answering };
});
vi.mock('../api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api.ts')>()), api: answering() }));
// a page rendered once shows what was loaded: useLoad gives an answer above at once, and nothing for any other call
vi.mock('../components.tsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components.tsx')>()),
  useLoad: (load: () => Promise<unknown>) => {
    let data: unknown = null;
    try {
      const asked = load() as Promise<unknown> & { answer?: unknown };
      void Promise.resolve(asked).catch(() => {});
      if (asked && 'answer' in asked) data = asked.answer;
    } catch { /* a call that cannot be made here: not loaded */ }
    return { data, error: null, loading: data === null, reload: () => {} };
  }
}));

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

function render(node: ReactNode, lang: 'ar' | 'en' | 'ku' = 'en') {
  const i18n = makeI18n(lang, 'western', () => {}, () => {});
  return {
    html: renderToStaticMarkup(
      <I18nContext.Provider value={i18n}>
        <DataContext.Provider value={{ accounts: [], settings: null, plan: null, online: true, seesBooks: true, reloadAccounts: async () => {}, reloadSettings: async () => {}, reloadPlan: async () => {} } as never}>
          {node}
        </DataContext.Provider>
      </I18nContext.Provider>
    ),
    t: (key: Key, vars?: Record<string, string | number>) => esc(i18n.t(key, vars))
  };
}

const voucher = (extra: Partial<EntryView> = {}): EntryView => ({
  id: 'e-1', type: 'payment', number: null, date: '2026-11-15', description: 'Generator diesel', party: null, currency: 'IQD', rateX100: 100, status: 'draft',
  cashAccountCode: '1811', reversesId: null, reversedById: null, preparedBy: 'Las', preparedById: 'u-2', preparedAt: '2026-11-15T08:00:00Z',
  checkedBy: null, checkedAt: null, approvedBy: null, approvedAt: null, total: 75_000, baseTotal: 75_000, approval: null,
  lines: [
    { lineNo: 1, accountCode: '3211', accountName: { ar: 'وقود', en: 'Fuel', ku: 'سووتەمەنی' }, debit: 75_000, credit: 0, baseDebit: 75_000, baseCredit: 0, description: 'Generator diesel', partyId: null, partyName: null },
    { lineNo: 2, accountCode: '1811', accountName: { ar: 'الصندوق', en: 'Main safe', ku: 'قاسە' }, debit: 0, credit: 75_000, baseDebit: 0, baseCredit: 75_000, description: 'Generator diesel', partyId: null, partyName: null }
  ],
  actions: ['edit', 'delete', 'check'], invoiceId: null, stockDocId: null, image: null, ...extra
});

beforeEach(() => { now.answers = {}; });

describe('the photo of a voucher\'s receipt on its page', () => {
  it('shows the photo, a way to see it whole, and who added it, when the voucher has one', () => {
    now.answers = { entry: voucher({ image: { bytes: 182_331, createdBy: 'Las', createdAt: '2026-11-15T08:00:01Z' } }), entryImage: PHOTO };
    const { html, t } = render(<EntryDetail id="e-1" />);
    expect(html).toContain(t('rp_title'));
    expect(html).toContain(`src="${PHOTO}"`);
    expect(html).toContain(t('rp_open'));
    expect(html).toContain(t('rp_by', { u: 'Las' }));
    expect(html).toContain('max-height:220px');
    // the voucher's own words are still there
    expect(html).toContain('Generator diesel');
  });

  it('shows nothing of a photo for a voucher without one, or from a server before 1.5', () => {
    now.answers = { entry: voucher(), entryImage: PHOTO };
    const { html, t } = render(<EntryDetail id="e-1" />);
    expect(html).toContain('Generator diesel');
    expect(html).not.toContain(t('rp_title'));
    expect(html).not.toContain('data:image/jpeg');
    const old = voucher();
    delete (old as Partial<EntryView>).image;
    now.answers = { entry: old };
    expect(render(<EntryDetail id="e-1" />).html).not.toContain(t('rp_title'));
  });

  it('names who added it in each language, and shows no picture until the photo has come', () => {
    for (const lang of ['ar', 'en', 'ku'] as const) {
      now.answers = {};
      const waiting = render(<ReceiptPhoto id="e-1" image={{ bytes: 10, createdBy: 'Raz', createdAt: '2026-11-15T08:00:01Z' }} />, lang);
      expect(waiting.html, lang).toContain(waiting.t('rp_by', { u: 'Raz' }));
      expect(waiting.html, lang).toContain(waiting.t('rp_title'));
      expect(waiting.html, lang).not.toContain('<img');
      now.answers = { entryImage: PHOTO };
      expect(render(<ReceiptPhoto id="e-1" image={{ bytes: 10, createdBy: 'Raz', createdAt: '2026-11-15T08:00:01Z' }} />, lang).html, lang).toContain(`src="${PHOTO}"`);
    }
  });

  it('has its words in Arabic, English and Kurdish, and the audit log\'s word for a photo added', () => {
    for (const key of ['rp_title', 'rp_open', 'rp_by', 'rp_failed', 'a_attach_photo', 'err_photo_invalid', 'err_photo_too_large', 'err_po_over_remaining', 'err_po_line_unknown']) {
      expect(isKey(key), key).toBe(true);
      const texts = (['ar', 'en', 'ku'] as const).map((l) => makeI18n(l, 'western', () => {}, () => {}).t(key as Key));
      expect(new Set(texts).size, key).toBe(3);
    }
  });
});
