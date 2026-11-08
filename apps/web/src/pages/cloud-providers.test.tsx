import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { makeI18n, type Key } from '../i18n.ts';
import { cloudChoices } from './cloud-providers.ts';

const LANGS = ['ar', 'en', 'ku'] as const;
const all = (key: Key, vars?: Record<string, string>) => LANGS.map((l) => makeI18n(l, 'western', () => {}, () => {}).t(key, vars));
const en = makeI18n('en', 'western', () => {}, () => {});

it('offers Google Drive when this build can sign in to it, and shows OneDrive without a client ID as coming soon', () => {
  expect(cloudChoices({ google: true, onedrive: false })).toEqual([
    { provider: 'google', state: 'connect' },
    { provider: 'onedrive', state: 'soon' }
  ]);
  expect(cloudChoices({ google: true, onedrive: true }).map((c) => c.state)).toEqual(['connect', 'connect']);
  // an answer without the field (an older server) never turns into a button that can only fail
  expect(cloudChoices({}).map((c) => c.state)).toEqual(['soon', 'soon']);
});

it('says "coming soon" in Arabic, English and Kurdish, never "not available in this build"', () => {
  const soon = all('cl_soon', { p: 'OneDrive' });
  expect(soon[1]).toBe('OneDrive: coming soon');
  expect(new Set(soon).size).toBe(3);
  for (const text of soon) expect(text).toContain('OneDrive');
  const page = readFileSync(new URL('./Settings.tsx', import.meta.url), 'utf8');
  expect(page).toContain("t('cl_soon'");
  expect(page).not.toContain('cl_notSetUp');
  expect(en.t('err_cloud_not_configured')).toMatch(/coming soon/);
});

it('tells where the copies are for the connected service only, and that Drive access is limited to the app’s own files', () => {
  for (const text of all('cl_where_google')) expect(text).toContain('Qasa ERP backups');
  for (const text of all('cl_where_onedrive')) expect(text).toContain('Apps/Qasa ERP');
  expect(en.t('cl_where_google')).toMatch(/only sees the files it made itself/);
  // the general help and the plan row promise nothing that this release can't do
  for (const text of all('cl_help')) expect(text).not.toContain('OneDrive');
  expect(en.t('f_cloudBackup')).toBe('Automatic encrypted backup to Google Drive (OneDrive coming soon)');
});
