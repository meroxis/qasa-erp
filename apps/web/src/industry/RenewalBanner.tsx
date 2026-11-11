import { useState } from 'react';
import { addDays, daysBetween, todayIso, GRACE_DAYS } from '@qasa/core';
import type { PlanStatus } from '../api.ts';
import { Icon, useData } from '../components.tsx';
import { useI18n } from '../i18n.ts';

/**
 * The licence renewal reminder on the home page (1.1), for admins: from RENEW_FROM_DAYS before the licence's last day,
 * and through its grace days after. It can be put away for DISMISS_DAYS at a time, except in the last 3 days and in
 * the grace days. "Renew" opens the customer portal's renewal for this licence in the browser (an allowed address,
 * external-links.ts in the Windows app).
 */

export const RENEW_FROM_DAYS = 14;
export const DISMISS_DAYS = 3;
const PORTAL = 'https://my.qasaerp.com/buy';
const LICENCE_ID = /^[A-Za-z0-9-]{1,40}$/;

export interface Renewal { licenceId: string; daysLeft: number; grace: boolean; graceDaysLeft: number; dismissable: boolean }

/** What to remind of today, or null. `daysLeft`: days until the last day (0 on it); in grace, the days of grace left. */
export function renewalReminder(plan: Pick<PlanStatus, 'license'> | null | undefined, today: string): Renewal | null {
  const license = plan?.license;
  if (!license?.expires || license.state === 'expired') return null;
  const daysLeft = daysBetween(today, license.expires);
  const graceEnd = addDays(license.expires, GRACE_DAYS);
  if (daysLeft > RENEW_FROM_DAYS || today > graceEnd) return null;
  const grace = daysLeft < 0;
  return {
    licenceId: license.id, daysLeft: Math.max(0, daysLeft), grace, graceDaysLeft: grace ? Math.max(0, daysBetween(today, graceEnd)) : 0,
    dismissable: !grace && daysLeft >= DISMISS_DAYS
  };
}

/** The portal page that renews this licence (the number only when it looks like one). */
export function renewUrl(licenceId: string): string {
  return LICENCE_ID.test(licenceId) ? `${PORTAL}?renew=${encodeURIComponent(licenceId)}` : PORTAL;
}

const KEY = (id: string) => `qasa.renewHidden.${id}`;
function hiddenUntil(id: string): string | null {
  try { return localStorage.getItem(KEY(id)); } catch { return null; }
}

export function RenewalBanner({ admin, today = todayIso() }: { admin: boolean; today?: string }) {
  const { t, int } = useI18n();
  const { plan } = useData();
  const r = renewalReminder(plan, today);
  const [hidden, setHidden] = useState(() => (r ? hiddenUntil(r.licenceId) : null));
  if (!admin || !r) return null;
  if (r.dismissable && hidden && today < hidden) return null;
  const hide = () => {
    const until = addDays(today, DISMISS_DAYS);
    try { localStorage.setItem(KEY(r.licenceId), until); } catch { /* shown again next time */ }
    setHidden(until);
  };
  const text = r.grace ? t('rn_grace', { n: int(r.graceDaysLeft) }) : r.daysLeft === 0 ? t('rn_today') : t('rn_days', { n: int(r.daysLeft) });
  return (
    <div className={'alert no-print plan-banner ' + (r.grace || r.daysLeft < DISMISS_DAYS ? 'bad' : 'info')} role="status">
      <Icon name="key" size={18} />
      <span style={{ flex: 1 }}><strong>{t('rn_title')}</strong> — {text}</span>
      <button type="button" className="btn primary small" onClick={() => window.open(renewUrl(r.licenceId), '_blank', 'noopener,noreferrer')}>{t('rn_renew')}</button>
      {r.dismissable && <button type="button" className="btn small ghost" onClick={hide}>{t('rn_later')}</button>}
    </div>
  );
}
