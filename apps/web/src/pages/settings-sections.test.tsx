import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nContext, makeI18n } from '../i18n.ts';
import { Settings, SETTINGS_SECTIONS, SettingsGrid, settingsSectionOf, settingsSectionsFor } from './Settings.tsx';

// Settings in sections: #/settings is a grid of rectangles, each section opens alone at its own address, admins see
// the company's, and the names are the ones the release notes and the user guide already use.
const i18n = (lang: 'ar' | 'en' | 'ku') => makeI18n(lang, 'western', () => {}, () => {});
const wrap = (node: ReactNode, lang: 'ar' | 'en' | 'ku' = 'en') => renderToStaticMarkup(<I18nContext.Provider value={i18n(lang)}>{node}</I18nContext.Provider>);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
/** The sections of the rectangles in a page, in order. */
const tiles = (html: string) => [...html.matchAll(/<a class="settings-tile" data-section="([a-z]+)" href="([^"]*)"/g)].map((m) => ({ id: m[1]!, href: m[2]! }));
/** Runs with a browser window that is not the Windows app (the cards of Language and display look at it). */
function inBrowser<T>(run: () => T): T {
  const w = globalThis as unknown as { window?: unknown };
  w.window = {};
  try { return run(); } finally { delete w.window; }
}

describe('Settings sections', () => {
  it('shows everyone their own sections, and admins the company sections too', () => {
    // outside the Windows app (here) Updates, Companies and Start over are left out
    expect(settingsSectionsFor(false).map((s) => s.id)).toEqual(['display', 'printers', 'usage', 'about']);
    expect(settingsSectionsFor(true).map((s) => s.id)).toEqual(SETTINGS_SECTIONS.map((s) => s.id).filter((id) => id !== 'companies' && id !== 'updates'));
    expect(SETTINGS_SECTIONS.find((s) => s.id === 'companies')?.when?.()).toBe(false);
    expect(SETTINGS_SECTIONS.find((s) => s.id === 'updates')?.when?.()).toBe(false);
    // in the Windows app they are there
    const w = globalThis as unknown as { window?: unknown };
    w.window = { qasaUpdates: {}, qasaDesktop: { startOver: () => {} }, location: { origin: 'http://127.0.0.1:4417' } };
    try {
      expect(settingsSectionsFor(false).map((s) => s.id)).toEqual(['display', 'printers', 'usage', 'updates', 'about']);
      expect(settingsSectionsFor(true).map((s) => s.id)).toEqual(SETTINGS_SECTIONS.map((s) => s.id));
    } finally {
      delete w.window;
    }
    expect(new Set(SETTINGS_SECTIONS.map((s) => s.id)).size).toBe(SETTINGS_SECTIONS.length);
  });

  it('opens a section from its address, and none for an unknown name, a page elsewhere or an admin section', () => {
    expect(settingsSectionOf('backups', true)?.id).toBe('backups');
    expect(settingsSectionOf('backups', false)).toBeNull();
    expect(settingsSectionOf('printers', false)?.id).toBe('printers');
    expect(settingsSectionOf('nothing', true)).toBeNull();
    expect(settingsSectionOf(undefined, true)).toBeNull();
    // Users is its own page: the entry links there
    expect(settingsSectionOf('users', true)).toBeNull();
    expect(SETTINGS_SECTIONS.find((s) => s.id === 'users')?.page).toBe('users');
  });

  it('keeps the names the release notes and the guide use, in Arabic, English and Kurdish', () => {
    const en = i18n('en');
    const name = (id: string) => en.t(SETTINGS_SECTIONS.find((s) => s.id === id)!.name);
    expect(name('display')).toBe('Language and display');
    expect(name('printers')).toBe('Printers');
    expect(name('backups')).toBe('Backups');
    expect(name('loyalty')).toBe('Loyalty points');
    expect(name('network')).toBe('Office network');
    expect(name('users')).toBe('Users');
    expect(name('updates')).toBe('Updates');
    expect(name('about')).toMatch(/About/);
    expect(en.t('ss_networkHelp')).toMatch(/phones/);
    expect(en.t('ss_networkHelp')).toMatch(/database/);
    for (const s of SETTINGS_SECTIONS) {
      for (const key of [s.name, s.help]) {
        const texts = (['ar', 'en', 'ku'] as const).map((l) => i18n(l).t(key));
        for (const text of texts) expect(text.trim(), key).not.toBe('');
        expect(new Set(texts).size, key).toBe(3);
      }
    }
  });

  it('shows #/settings as a grid of rectangles only: exactly the sections a non-admin and an admin may see', () => {
    const forUser = wrap(<Settings admin={false} />);
    expect(tiles(forUser).map((x) => x.id)).toEqual(['display', 'printers', 'usage', 'about']);
    expect(tiles(forUser).map((x) => x.id)).toEqual(settingsSectionsFor(false).map((s) => s.id));
    const forAdmin = wrap(<Settings admin section={null} />);
    expect(tiles(forAdmin).map((x) => x.id)).toEqual(settingsSectionsFor(true).map((s) => s.id));
    expect(tiles(forAdmin).map((x) => x.id)).toEqual(['display', 'company', 'periods', 'sales', 'loyalty', 'printers', 'backups', 'network', 'users', 'usage', 'about']);
    for (const html of [forUser, forAdmin]) {
      // the grid alone: a nav of rectangles, no section beside it, no Back link, no list at the side
      expect(html.startsWith('<nav class="settings-grid" aria-label="Settings">')).toBe(true);
      expect(html.endsWith('</nav>')).toBe(true);
      expect(html).not.toContain('settings-back');
      expect(html).not.toContain('settings-section');
      expect(html).not.toContain('role="radiogroup"');
    }
    // each rectangle: the section's icon in the Home tiles' soft square, its name and its one help line
    const en = i18n('en');
    for (const s of settingsSectionsFor(true)) {
      expect(forAdmin, s.id).toMatch(new RegExp(`data-section="${s.id}"[^>]*><span class="launch-ico"><svg[^>]*>.*?</svg></span><span class="settings-tile-text"><strong>${esc(en.t(s.name))}</strong><span>${esc(en.t(s.help))}</span></span></a>`));
    }
    // a section opens at its own address; Users still opens the Users page
    expect(tiles(forAdmin).find((x) => x.id === 'backups')?.href).toBe('#/settings/backups');
    expect(tiles(forAdmin).find((x) => x.id === 'users')?.href).toBe('#/users');
    expect(forUser).not.toContain('#/users');
    // the same grid in Arabic and Kurdish, by its own names
    for (const lang of ['ar', 'ku'] as const) {
      const html = wrap(<SettingsGrid admin />, lang);
      expect(tiles(html)).toHaveLength(settingsSectionsFor(true).length);
      expect(html).toContain(`<strong>${esc(i18n(lang).t('bkTitle'))}</strong>`);
    }
  });

  it('opens a section address as that section alone, under the Back link and its name', () => {
    for (const lang of ['ar', 'en', 'ku'] as const) {
      const t = i18n(lang).t;
      const html = inBrowser(() => wrap(<Settings admin section="display" />, lang));
      expect(html.startsWith('<section class="settings-section stack" data-section="display" aria-labelledby="settings-section-title">')).toBe(true);
      // the way back to the grid, then the section's name, then its own content
      expect(html).toMatch(new RegExp(`^<section[^>]*><a class="settings-back" href="#/settings"><svg[^>]*>.*?</svg>${esc(t('settings'))}</a><h2 id="settings-section-title" class="settings-section-title">${esc(t('displayTitle'))}</h2>`));
      expect(html.split(esc(t('displayTitle'))).length - 1, lang).toBe(1 + 1); // the title, and the name of the group of settings for screen readers
      expect(html).toContain(esc(t('languageHelp')));
      // alone: no grid, no list of the other sections
      expect(html).not.toContain('settings-grid');
      expect(html).not.toContain('settings-tile');
      expect(html).not.toContain(esc(t('ss_printersHelp')));
      expect(html).not.toContain('#/settings/');
    }
    // someone who is not an admin may open their own sections, and gets the grid for an admin's or an unknown address
    expect(inBrowser(() => wrap(<Settings admin={false} section="display" />))).toContain('data-section="display" aria-labelledby');
    for (const address of ['backups', 'company', 'nothing', 'users']) {
      const html = wrap(<Settings admin={false} section={address} />);
      expect(tiles(html).map((x) => x.id), address).toEqual(['display', 'printers', 'usage', 'about']);
      expect(html, address).not.toContain('settings-back');
    }
  });

  it('has no list at the side at any window width, and keeps a comfortable reading width', () => {
    const page = readFileSync(new URL('./Settings.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    for (const gone of ['settings-nav', 'settings-layout', 'settings-entry', 'settings-wrap', 'has-section']) {
      expect(page, gone).not.toContain(gone);
      expect(css, gone).not.toContain(gone);
    }
    expect(css).toMatch(/\.settings-grid \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(240px, 1fr\)\);/);
    expect(css).toMatch(/\.settings-tile \{[^}]*min-block-size: 104px;[^}]*border: 1px solid var\(--line\); border-radius: var\(--r-card\); background: var\(--surface\); box-shadow: var\(--shadow-card\);/);
    expect(css).toMatch(/\.settings-tile-text > strong \{ font-size: 16px; font-weight: 600;/);
    expect(css).toMatch(/\.settings-tile-text > span \{ font-size: 13px;/);
    expect(css).toMatch(/\.settings-section \{ max-inline-size: 920px; \}/);
    // the page starts at its top when a section opens or closes
    expect(page).toContain("useEffect(() => { document.querySelector('main.content')?.scrollTo?.({ top: 0 }); }, [opened]);");
  });

  it('opens the right section from every link into Settings', () => {
    const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
    expect(src('../industry/BackupNotice.tsx')).not.toContain("href('settings')");
    expect(src('../industry/BackupNotice.tsx')).toContain("href('settings/backups')");
    expect(src('./Home.tsx')).toContain("href('settings/company')");
    expect(src('./WebsiteApi.tsx')).toContain("href('settings/network')");
    expect(src('../App.tsx')).toContain("href('settings/display')");
    expect(src('../App.tsx')).toContain('<Settings admin={isAdmin} section={arg ?? null} />');
  });
});
