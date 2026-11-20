import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorBox, Icon, useData } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';

/**
 * 2.0.0 (the product review): a paid page the plan does not include shows what it does and how to get it, instead of
 * its tabs over an empty page. The free first month, when it is still to come on this PC, starts from here; otherwise
 * the plans page.
 */
export function LockedFeature({ feature, icon }: { feature: string; icon: string }) {
  const { t } = useI18n();
  const { plan, reloadPlan } = useData();
  const [error, setError] = useState<unknown>(null);
  const what = `f_${feature}` as Key;
  const startTrial = async () => {
    try { await api.startTrial(); reloadPlan(); } catch (e) { setError(e); }
  };
  return (
    <div className="card pad stack locked-feature" style={{ maxWidth: 640, marginInline: 'auto', textAlign: 'center', alignItems: 'center' }}>
      <span className="locked-feature-icon" aria-hidden="true"><Icon name={icon} size={36} /></span>
      <h2 style={{ margin: 0 }}>{t(what)}</h2>
      <p className="muted" style={{ margin: 0 }}>{t('ux_lockedText')}</p>
      <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {plan?.trialAvailable && <button type="button" className="btn primary" onClick={() => void startTrial()}><Icon name="star" size={16} />{t('ux_lockedTrial')}</button>}
        <a className={'btn' + (plan?.trialAvailable ? '' : ' primary')} href={href('plans')}>{t('planLicense')}</a>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
