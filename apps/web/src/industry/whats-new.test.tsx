import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { APP_VERSION } from '@qasa/core';
import { I18nContext, makeI18n } from '../i18n.ts';
import { bundledNotes, WhatsNewDialog } from './WhatsNew.tsx';

describe("What's new in this version", () => {
  it('has this build\'s own notes bundled (offline), picked by version', () => {
    expect(bundledNotes(APP_VERSION)).toContain('::: en');
    expect(bundledNotes('9.9.9')).toBeNull();
    expect(bundledNotes('1.1.0', { '/x/release-notes/1.1.0.md': 'a', '/x/release-notes/1.1.01.md': 'b' })).toBe('a');
  });

  it('shows them in the reader\'s language as text, never HTML', () => {
    for (const lang of ['ar', 'en', 'ku'] as const) {
      const html = renderToStaticMarkup(
        <I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}><WhatsNewDialog version={APP_VERSION} onClose={() => {}} /></I18nContext.Provider>
      );
      expect(html).not.toContain(':::');
      expect(html).toContain(lang === 'en' ? 'Before you update' : lang === 'ar' ? 'قبل التحديث' : 'پێش نوێکردنەوە');
      expect(html).not.toMatch(/<a /);
    }
  });
});
