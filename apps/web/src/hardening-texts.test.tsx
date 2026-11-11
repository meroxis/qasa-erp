import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ApiError } from './api.ts';
import { errorMessages } from './components.tsx';
import { isKey, makeI18n, type Key } from './i18n.ts';
import { backupFailureKey } from './industry/BackupNotice.tsx';
import { controlledAction, pharmacyTabs } from './pages/Pharmacy.tsx';
import { pairingCodeLines, settingsSectionOf } from './pages/Settings.tsx';

// The 1.1 security fixes on the screens: their errors have words, a plain copy is restored only on purpose, backups
// keep running while Documents is in OneDrive, and the pharmacy shows each person only what the server lets them do.
const LANGS = ['ar', 'en', 'ku'] as const;
const all = (key: Key) => LANGS.map((l) => makeI18n(l, 'western', () => {}, () => {}).t(key));
const en = makeI18n('en', 'western', () => {}, () => {});
const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

it('has its own message, in Arabic, English and Kurdish, for every error code the security fixes added', () => {
  const codes = ['backup_not_encrypted', 'backup_password_weak', 'backup_allow_plain', 'database_ca_unsafe', 'source_not_allowed', 'source_limit'];
  expect(codes.filter((c) => !isKey(`err_${c}`))).toEqual([]);
  for (const c of codes) {
    const texts = all(`err_${c}` as Key);
    expect(new Set(texts).size, c).toBe(3);
    expect(texts[1], c).not.toBe(en.t('err_internal'));
  }
  // each reaches the screen through the usual error box, as an answer or as a field's check
  expect(errorMessages(new ApiError(409, 'backup_not_encrypted', { pick: null }), en)).toEqual([en.t('err_backup_not_encrypted')]);
  expect(errorMessages(new ApiError(409, 'database_ca_unsafe', { reason: 'names' }), en)).toEqual([en.t('err_database_ca_unsafe')]);
  expect(errorMessages(new ApiError(403, 'source_limit', { limit: 10 }), en)).toEqual([en.t('err_source_limit')]);
  expect(errorMessages(new ApiError(400, 'validation', [{ code: 'backup_password_weak' }]), en)).toEqual([en.t('err_backup_password_weak')]);
});

it('says why a backup failed in the admin\'s language, and keeps the server\'s words for a failure it has none for', () => {
  const codes = ['settings_unreadable', 'synced_needs_password', 'password_unreadable', 'copy_check', 'reopen_failed', 'disk_full', 'no_access', 'folder_missing'] as const;
  for (const code of codes) {
    expect(backupFailureKey({ lastErrorCode: code }), code).toBe(`bkErr_${code}`);
    expect(new Set(all(`bkErr_${code}` as Key)).size, code).toBe(3);
  }
  expect(backupFailureKey({ lastErrorCode: 'other' })).toBeNull();
  expect(backupFailureKey({ lastErrorCode: null })).toBeNull();
  // older servers say nothing of codes: the card shows the server's text as before
  expect(backupFailureKey({})).toBeNull();
  expect(src('./pages/Settings.tsx')).toContain("t('bkFailed', { e: backupFailureKey(status) ? t(backupFailureKey(status)!) : status.lastError })");
});

it('restores an unencrypted copy while a backup password is set only after a warning the admin confirms', () => {
  const settings = src('./pages/Settings.tsx');
  // the refusal opens the warning (never straight to a restore), and only the confirmed form sends allowPlain
  expect(settings).toContain("e.code === 'backup_not_encrypted' && !req.allowPlain");
  expect(settings).toContain('if (plainKnown) void send({ ...plain, allowPlain: true });');
  expect(settings).toContain("disabled={busy || !plainKnown}>{t('bkPlainRestore')}");
  expect(settings.match(/allowPlain: true/g)).toHaveLength(1);
  // the card is in Settings → Backups, for admins only (and the server asks for an admin too)
  expect(settings).toMatch(/case 'backups':\s+return <BackupCard \/>;/);
  expect(settingsSectionOf('backups', true)?.admin).toBe(true);
  expect(settingsSectionOf('backups', false)).toBeNull();
  for (const k of ['bkPlainTitle', 'bkPlainWarning', 'bkPlainKnown', 'bkPlainRestore'] as Key[]) expect(new Set(all(k)).size, k).toBe(3);
  const [ar, english, ku] = all('bkPlainWarning');
  expect(english).toMatch(/only if you made it yourself/);
  expect(english).toMatch(/audit log/);
  expect(ar).toContain('سجل التدقيق');
  expect(ku).toContain('تۆماری وردبینی');
});

it('tells the admin once that copies stay on this PC while Documents is synced and there is no backup password', () => {
  for (const k of ['bkLocalInstead', 'bkNoticeLocal', 'bkNoticeLocalOk'] as Key[]) expect(new Set(all(k)).size, k).toBe(3);
  for (const text of all('bkLocalInstead')) expect(text).toContain('{f}');
  expect(en.t('bkNoticeLocal')).toMatch(/backup password/);
  const bar = src('./industry/BackupNotice.tsx');
  expect(bar).toContain('api.backupLocalNoticeSeen()');
  expect(src('./api.ts')).toContain("request<BackupStatus>('POST', '/api/backup/local-notice', {})");
});

it('shows the controlled-medicines log only to someone with the sales permission, Record on unrecorded lines, Correct to an admin', () => {
  expect(pharmacyTabs(false)).not.toContain('controlled');
  expect(pharmacyTabs(true)).toContain('controlled');
  const unrecorded = { missing: true, recordedAt: null };
  const recorded = { missing: false, recordedAt: '2026-11-09T10:00:00.000Z' };
  expect(controlledAction(unrecorded, false)).toBe('record');
  expect(controlledAction(unrecorded, true)).toBe('record');
  expect(controlledAction(recorded, false)).toBeNull();
  expect(controlledAction(recorded, true)).toBe('correct');
  expect(src('./App.tsx')).toContain("<Pharmacy admin={isAdmin} sales={isAdmin || viewer.permissions.includes('sales')} />");
  for (const k of ['ph_correct', 'ph_correctTitle', 'ph_correctHelp'] as Key[]) expect(new Set(all(k)).size, k).toBe(3);
});

it('shows the 128-bit pairing code in two lines of four groups', () => {
  expect(pairingCodeLines('3F9A-1C22-7B0E-44D1-5BE0-C7A9-6D2F-1E83')).toEqual(['3F9A-1C22-7B0E-44D1', '5BE0-C7A9-6D2F-1E83']);
  expect(pairingCodeLines('3F9A-1C22-7B0E-44D1')).toEqual(['3F9A-1C22-7B0E-44D1']);
  expect(pairingCodeLines(null)).toEqual([]);
});
