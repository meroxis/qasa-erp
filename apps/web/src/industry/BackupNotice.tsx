import { useEffect, useState } from 'react';
import { api, type BackupStatus } from '../api.ts';
import { isKey, useI18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';

export type BackupNoticeKey = 'bkNoticePlan' | 'bkNoticeOff' | 'bkNoticeOld' | 'bkNoticeFailed';

/**
 * Why the last copy failed, in the admin's language: the words for its code, or what the server kept (a Windows error
 * the app has no words for).
 */
export function backupFailureKey(status: Pick<BackupStatus, 'lastErrorCode'> | null): Key | null {
  const code = status?.lastErrorCode;
  if (!code || code === 'other') return null;
  const key = `bkErr_${code}`;
  return isKey(key) ? key : null;
}

/** The text an admin sees when backups need them (see backupNotice in the Pro module), or null. */
export function backupNoticeKey(status: Pick<BackupStatus, 'notice'> | null): BackupNoticeKey | null {
  switch (status?.notice) {
    case 'plan': return 'bkNoticePlan';
    case 'off': return 'bkNoticeOff';
    case 'old': return 'bkNoticeOld';
    case 'failed': return 'bkNoticeFailed';
    default: return null;
  }
}

/**
 * A bar for admins when automatic backups have stopped (the plan has none, a trial ended, or they were turned off and
 * nothing was saved for 3 days), when the last copy failed, or when the last copy is old. Absent without the Pro
 * module (404) and anywhere the backup settings can't be read; Settings shows the details and "Save a backup now".
 */
export function BackupNoticeBar({ admin, page }: { admin: boolean; page: string | null | undefined }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  useEffect(() => {
    if (!admin) return;
    let live = true;
    // read again when the admin comes back from Settings, where a copy may just have been saved
    api.backup().then((s) => { if (live) setStatus(s); }, () => { if (live) setStatus(null); });
    return () => { live = false; };
  }, [admin, page === 'settings']);
  const key = admin && page !== 'settings' ? backupNoticeKey(status) : null;
  // told once: copies kept on this PC because Documents is synced and there is no backup password
  const local = admin && !!status?.localNotice;
  const seen = () => { api.backupLocalNoticeSeen().then(setStatus, () => setStatus((s) => (s ? { ...s, localNotice: false } : s))); };
  const needs = key && (
    <div className={'alert plan-banner no-print ' + (key === 'bkNoticeFailed' ? 'bad' : 'warn')} role="status" style={{ marginBottom: 14 }}>
      <span>{t(key)}</span>
      <a href={href('settings/backups')}>{t('bkNoticeOpen')}</a>
    </div>
  );
  const kept = local && (
    <div className="alert plan-banner no-print info" role="status" style={{ marginBottom: 14 }}>
      <span>{t('bkNoticeLocal')}</span>
      <span className="row" style={{ gap: 8 }}>
        {page !== 'settings' && <a href={href('settings/backups')}>{t('bkNoticeOpen')}</a>}
        <button type="button" className="btn small" onClick={seen}>{t('bkNoticeLocalOk')}</button>
      </span>
    </div>
  );
  if (needs && kept) return <>{needs}{kept}</>;
  return needs || kept || null;
}
