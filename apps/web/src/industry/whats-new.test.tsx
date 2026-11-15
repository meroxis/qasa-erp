import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { APP_VERSION, type Lang } from '@qasa/core';
import { I18nContext, makeI18n } from '../i18n.ts';
import { ReleaseNotes } from './UpdateBanner.tsx';
import { upd } from './updates.ts';
import { bundledNotes, compareVersions, notesToShow, versionsSince, WhatsNewDialog } from './WhatsNew.tsx';

const render = (lang: Lang, node: ReactElement) =>
  renderToStaticMarkup(<I18nContext.Provider value={makeI18n(lang, 'western', () => {}, () => {})}>{node}</I18nContext.Provider>);

describe("What's new in this version", () => {
  it('has this build\'s own notes bundled (offline), picked by version', () => {
    expect(bundledNotes(APP_VERSION)).toContain('::: en');
    expect(bundledNotes('9.9.9')).toBeNull();
    expect(bundledNotes('1.1.0', { '/x/release-notes/1.1.0.md': 'a', '/x/release-notes/1.1.01.md': 'b' })).toBe('a');
  });

  it('shows them in the reader\'s language as text, never HTML', () => {
    for (const lang of ['ar', 'en', 'ku'] as const) {
      const html = render(lang, <WhatsNewDialog version={APP_VERSION} onClose={() => {}} />);
      expect(html).not.toContain(':::');
      expect(html).toContain(lang === 'en' ? 'Licences from 0.1.8' : lang === 'ar' ? 'تراخيص الإصدار 0.1.8' : 'مۆڵەتەکانی وەشانی 0.1.8');
      expect(html).not.toMatch(/<a /);
      // one version: no heading of its own over its notes
      expect(html).not.toContain(`>${upd(lang, 'up_notesOf', { v: APP_VERSION })}</h4>`);
    }
  });

  it('shows one version\'s notes whole, as the update bar does, in one box', () => {
    for (const lang of ['ar', 'en', 'ku'] as const) {
      const box = render(lang, <ReleaseNotes text={bundledNotes(APP_VERSION)!} />);
      expect(box.length, lang).toBeGreaterThan(1000);
      expect(render(lang, <WhatsNewDialog version={APP_VERSION} onClose={() => {}} />), lang).toContain(box);
    }
  });
});

describe("What's new after an update that skipped versions", () => {
  const files = Object.fromEntries(
    ['1.3.0', '1.4.0', '1.4.1', '1.4.2', '1.4.10', '1.5.0-beta.1', '1.5.0-beta.2', '1.5.0'].map((v) => [`/x/release-notes/${v}.md`, `notes ${v}`])
  );

  it('orders versions as releases do', () => {
    expect(compareVersions('1.4.9', '1.4.10')).toBeLessThan(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('1.5.0-beta.2', '1.5.0')).toBeLessThan(0);
    expect(compareVersions('1.5.0', '1.5.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('1.5.0-beta.10', '1.5.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('1.5.0-beta.2', '1.4.10')).toBeGreaterThan(0);
    expect(compareVersions('1.4.2', '1.4.2')).toBe(0);
  });

  it('shows every version since the one before, newest first', () => {
    // the Microsoft Store took its copies from 1.4.0 straight to 1.4.2: they never saw the 1.4.1 notes
    expect(versionsSince('1.4.0', '1.4.2', files)).toEqual(['1.4.2', '1.4.1']);
    expect(versionsSince('1.3.0', '1.4.10', files)).toEqual(['1.4.10', '1.4.2', '1.4.1', '1.4.0']);
    expect(versionsSince('1.4.1', '1.4.2', files)).toEqual(['1.4.2']);
    // the version before has no notes of its own: still only those after it
    expect(versionsSince('1.3.5', '1.4.1', files)).toEqual(['1.4.1', '1.4.0']);
  });

  it("leaves a beta's notes to beta copies: a release's notes cover its betas", () => {
    expect(versionsSince('1.4.10', '1.5.0', files)).toEqual(['1.5.0']);
    expect(versionsSince('1.5.0-beta.1', '1.5.0', files)).toEqual(['1.5.0']);
    expect(versionsSince('1.4.2', '1.5.0-beta.2', files)).toEqual(['1.5.0-beta.2', '1.5.0-beta.1', '1.4.10']);
  });

  it('shows only this version when the one before is not known or not older', () => {
    // 'earlier': updated from before 1.1, or the record of the last version could not be read
    expect(versionsSince('earlier', '1.4.2', files)).toEqual(['1.4.2']);
    expect(versionsSince('1.4.10', '1.4.2', files)).toEqual(['1.4.2']);
    expect(versionsSince('1.4.2', '1.4.2', files)).toEqual(['1.4.2']);
    expect(versionsSince('', '1.4.2', files)).toEqual(['1.4.2']);
    // nothing bundled for it: nothing to show
    expect(versionsSince('earlier', '9.9.9', files)).toEqual([]);
  });

  it('finds the 1.4.1 notes this build carries for a PC that went from 1.4.0 to 1.4.2', () => {
    expect(versionsSince('1.4.0', '1.4.2')).toEqual(['1.4.2', '1.4.1']);
  });

  it('shows each version under its own heading, newest first, in one box, in every language', () => {
    // a line of the 1.4.2 notes, then one of the 1.4.1 notes
    const words: Record<Lang, [string, string]> = {
      en: ['Amounts in dinar and dollar', 'Cheques are for those who keep the books'],
      ar: ['المبالغ بالدينار والدولار', 'الصكوك لمن يمسك الدفاتر'],
      ku: ['بڕی پارە بە دینار و دۆلار', 'چەکەکان بۆ ئەوانەن کە دەفتەرەکان ڕادەگرن']
    };
    for (const lang of ['ar', 'en', 'ku'] as const) {
      const html = render(lang, <WhatsNewDialog version="1.4.2" versions={['1.4.2', '1.4.1']} onClose={() => {}} />);
      const newer = html.indexOf(`>${upd(lang, 'up_notesOf', { v: '1.4.2' })}</h4>`);
      const older = html.indexOf(`>${upd(lang, 'up_notesOf', { v: '1.4.1' })}</h4>`);
      expect(newer).toBeGreaterThan(-1);
      expect(older).toBeGreaterThan(newer);
      expect(html.indexOf(words[lang][0])).toBeGreaterThan(newer);
      expect(html.indexOf(words[lang][0])).toBeLessThan(older);
      expect(html.indexOf(words[lang][1])).toBeGreaterThan(older);
      expect(html).toContain(upd(lang, 'up_whatsNewTitle', { v: '1.4.2' }));
      expect(html).not.toContain(':::');
      expect(html).not.toMatch(/<a /);
      // one scroll box for all of them, so the button stays in view
      expect(html.match(/max-height:60vh/g)).toHaveLength(1);
      // both versions carry the same note for 0.1.8 licences: it shows once, under 1.4.2
      const licences = { en: 'Licences from 0.1.8', ar: 'تراخيص الإصدار 0.1.8', ku: 'مۆڵەتەکانی وەشانی 0.1.8' }[lang];
      expect(bundledNotes('1.4.1')).toContain(licences);
      expect(html.split(licences)).toHaveLength(2);
      expect(html.indexOf(licences)).toBeGreaterThan(newer);
      expect(html.indexOf(licences)).toBeLessThan(older);
    }
  });

  it('says a section once: one that a newer version already showed word for word is left out of the older ones', () => {
    const notes = (own: string) => [
      '::: en', '### Licences from 0.1.8', '- Connect this PC once in your first month.', '', own, ':::',
      '::: ar', '### تراخيص الإصدار 0.1.8', '- اربط هذا الحاسوب مرة واحدة خلال شهرك الأول.', '', own, ':::'
    ].join('\n');
    const files = {
      '/x/release-notes/1.4.0.md': notes('### New\n- Phones'),
      '/x/release-notes/1.4.1.md': notes('### Fixed\n- Printing'),
      '/x/release-notes/1.4.2.md': notes('### New\n- Amounts'),
      '/x/release-notes/1.4.3.md': notes('### New\n- Amounts')
    };
    expect(notesToShow(['1.4.2', '1.4.1', '1.4.0'], 'en', files)).toEqual([
      { v: '1.4.2', notes: '### Licences from 0.1.8\n- Connect this PC once in your first month.\n\n### New\n- Amounts' },
      { v: '1.4.1', notes: '### Fixed\n- Printing' },
      // the same heading over other points is kept
      { v: '1.4.0', notes: '### New\n- Phones' }
    ]);
    // in each language
    expect(notesToShow(['1.4.2', '1.4.1'], 'ar', files).map((n) => n.notes)).toEqual([
      '### تراخيص الإصدار 0.1.8\n- اربط هذا الحاسوب مرة واحدة خلال شهرك الأول.\n\n### New\n- Amounts', '### Fixed\n- Printing'
    ]);
    // a version alone keeps all its notes; one with nothing of its own left is not shown; one with no notes is skipped
    expect(notesToShow(['1.4.1'], 'en', files)).toEqual([{ v: '1.4.1', notes: '### Licences from 0.1.8\n- Connect this PC once in your first month.\n\n### Fixed\n- Printing' }]);
    expect(notesToShow(['1.4.3', '1.4.2'], 'en', files).map((n) => n.v)).toEqual(['1.4.3']);
    expect(notesToShow(['9.9.9', '1.4.1'], 'en', files).map((n) => n.v)).toEqual(['1.4.1']);
  });
});
