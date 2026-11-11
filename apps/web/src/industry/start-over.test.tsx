import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { I18nContext, makeI18n } from '../i18n.ts';
import { StartOverCard, StartOverDialog } from './StartOver.tsx';

const wrap = (node: ReactNode, lang: 'ar' | 'en' | 'ku' = 'en') => renderToStaticMarkup(
  <I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}>{node}</I18nContext.Provider>
);

describe('Settings → Start over with empty books', () => {
  it('shows only in the Windows app (its own bridge), never as a web page calling the server', () => {
    expect(wrap(<StartOverCard call={null} />)).toBe('');
    expect(wrap(<StartOverCard call={async () => ({ ok: true })} />)).toContain('Start over with empty books');
    // the screen has no HTTP route to call: only window.qasaDesktop.startOver
    const source = readFileSync(new URL('./StartOver.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/request\(|fetch\(|\/api\//);
  });

  it('asks for the admin password and the company name, with the warning, in each language', () => {
    for (const lang of ['ar', 'en', 'ku'] as const) {
      const i18n = makeI18n(lang, 'western', () => {}, () => {});
      const html = wrap(<StartOverDialog call={async () => ({ ok: true })} onClose={() => {}} />, lang);
      expect(html).toContain(i18n.t('so_warning'));
      expect(html).toContain('type="password"');
      expect(html).toContain(i18n.t('so_confirm'));
    }
  });
});
