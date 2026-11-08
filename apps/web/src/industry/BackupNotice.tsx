import { useEffect, useState } from 'react';
import { api, type BackupStatus } from '../api.ts';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';

export type BackupNoticeKey = 'bkNoticePlan' | 'bkNoticeOff' | 'bkNoticeOld' | 'bkNoticeFailed';

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
  if (!key) return null;
  return (
    <div className={'alert plan-banner no-print ' + (key === 'bkNoticeFailed' ? 'bad' : 'warn')} role="status" style={{ marginBottom: 14 }}>
      <span>{t(key)}</span>
      <a href={href('settings')}>{t('bkNoticeOpen')}</a>
    </div>
  );
}
