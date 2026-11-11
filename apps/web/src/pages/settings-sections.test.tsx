import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeI18n } from '../i18n.ts';
import { SETTINGS_SECTIONS, settingsSectionOf, settingsSectionsFor } from './Settings.tsx';

// Settings in sections (Windows 11 style): each section its own address, admins see the company's, the names are the
// ones the release notes and the user guide already use.
const i18n = (lang: 'ar' | 'en' | 'ku') => makeI18n(lang, 'western', () => {}, () => {});

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

  it('is a nav with aria-current on the open section, and every link into Settings opens the right section', () => {
    const page = readFileSync(new URL('./Settings.tsx', import.meta.url), 'utf8');
    expect(page).toContain('<nav className="settings-nav" aria-label={t(\'settings\')}>');
    expect(page).toContain("aria-current={s.id === shown.id ? 'page' : undefined}");
    const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
    expect(src('../industry/BackupNotice.tsx')).not.toContain("href('settings')");
    expect(src('../industry/BackupNotice.tsx')).toContain("href('settings/backups')");
    expect(src('./Home.tsx')).toContain("href('settings/company')");
    expect(src('./WebsiteApi.tsx')).toContain("href('settings/network')");
    expect(src('../App.tsx')).toContain("href('settings/display')");
    expect(src('../App.tsx')).toContain('<Settings admin={isAdmin} section={arg ?? null} />');
  });
});
