import { useState } from 'react';
import { daysBetween, PLAN_IDS, PLANS, TRIAL_DAYS, todayIso } from '@qasa/core';
import { api, type PlanStatus } from '../api.ts';
import { ErrorBox, Icon, useData, useToast } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';

const demo = import.meta.env.MODE === 'demo';
const CONTACT = 'mailto:info@qasaerp.com?subject=' + encodeURIComponent('Qasa ERP Pro / Business');

/** A cell of the comparison: a text, a tick or a dash, or a limit (null = unlimited). */
type Cell = Key | boolean | { limit: number | null } | { key: Key; n: number };
interface Row { label: Key; cells: [Cell, Cell, Cell]; soon?: boolean }

const { free, pro, business } = PLANS;
const ROWS: Row[] = [
  { label: 'f_core', cells: [true, true, true] },
  { label: 'f_warehouses', cells: [{ limit: free.limits.warehouses }, { limit: pro.limits.warehouses }, { limit: business.limits.warehouses }] },
  { label: 'f_branding', cells: ['v_shown', 'v_removed', 'v_removed'] },
  { label: 'f_users', cells: [{ limit: free.limits.users }, { limit: pro.limits.users }, { limit: business.limits.users }] },
  { label: 'f_network', cells: [false, true, true], soon: true },
  { label: 'f_companies', cells: [{ limit: free.limits.companies }, { limit: pro.limits.companies }, { limit: business.limits.companies }], soon: true },
  { label: 'f_roles', cells: ['v_onePerson', true, true] },
  { label: 'f_installments', cells: [false, true, true], soon: true },
  { label: 'f_payroll', cells: [false, true, true], soon: true },
  { label: 'f_finalAccounts', cells: ['v_viewOnScreen', 'v_printExcel', 'v_printExcel'] },
  { label: 'f_yearEnd', cells: [false, true, true], soon: true },
  { label: 'f_backup', cells: [false, true, true], soon: true },
  { label: 'f_branches', cells: [false, false, true], soon: true },
  { label: 'f_support', cells: ['v_supportFree', 'v_supportPro', 'v_supportBusiness'] }
];

function cellText(cell: Cell, i18n: I18n) {
  const { t } = i18n;
  if (cell === true) return <span className="yes" aria-label="✓"><Icon name="check" size={16} /></span>;
  if (cell === false) return <span className="muted" aria-label="—">—</span>;
  if (typeof cell === 'string') return t(cell);
  if ('limit' in cell) return cell.limit === null ? t('unlimited') : i18n.int(cell.limit);
  return t(cell.key, { n: cell.n });
}

export function Plans() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { plan, reloadPlan } = useData();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function act(fn: () => Promise<PlanStatus>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reloadPlan();
      toast(message);
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!plan) return null;
  const today = todayIso();
  const license = plan.license;
  const planName = (id: string) => t(`plan_${id}` as Key);

  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <div className="card pad stack">
        <div className="row">
          <h2>{t('yourPlan')}</h2>
          <span className={'chip plan-' + plan.plan}>{planName(plan.plan)}</span>
          {plan.source === 'trial' && <span className="chip info">{t('planTrialChip')}</span>}
        </div>

        {plan.source === 'trial' && plan.trialEnds && (
          <p style={{ margin: 0 }}>{t('trialEnds', { d: i18n.date(plan.trialEnds), n: daysBetween(today, plan.trialEnds) + 1 })}</p>
        )}
        {plan.source === 'free' && <p style={{ margin: 0 }}>{t('freePlanNote')}</p>}
        {plan.source === 'free' && !license && plan.trialStarted && !plan.trialActive && <div className="alert info">{t('trialEndedNote')}</div>}

        {license && (
          <>
            {license.state === 'grace' && license.expires && plan.graceEnds && (
              <div className="alert warn">{t('graceNote', { p: planName(license.plan), d: i18n.date(license.expires), g: i18n.date(plan.graceEnds) })}</div>
            )}
            {license.state === 'expired' && license.expires && (
              <div className="alert bad">{t('expiredNote', { p: planName(license.plan), d: i18n.date(license.expires) })}</div>
            )}
            <div className="plan-facts">
              <span className="muted">{t('licensedTo')}</span><strong>{license.licensee}</strong>
              <span className="muted">{t('licenseNumber')}</span><strong className="ltr">{license.id}</strong>
              <span className="muted">{t('validUntil')}</span>
              <span>
                <strong className="num">{license.expires ? i18n.date(license.expires) : t('noEndDate')}</strong>{' '}
                {license.state === 'active'
                  ? <span className="chip ok">{t('active')}</span>
                  : license.state === 'grace' ? <span className="chip warn">{t('inGrace')}</span> : <span className="chip bad">{t('ended')}</span>}
              </span>
              <span className="muted">{t('f_users')}</span><strong className="num">{plan.limits.users === null ? t('unlimited') : i18n.int(plan.limits.users)}</strong>
            </div>
          </>
        )}

        <div className="row">
          {plan.trialAvailable && (
            <button type="button" className="btn primary" disabled={busy} onClick={() => void act(() => api.startTrial(), t('trialStarted'))}>
              <Icon name="star" size={16} />{t('startTrial', { n: TRIAL_DAYS })}
            </button>
          )}
          {license && !demo && (
            <button type="button" className="btn danger" disabled={busy} onClick={() => { if (window.confirm(t('removeLicenseConfirm'))) void act(() => api.removeLicense(), t('licenseRemoved')); }}>
              {t('removeLicense')}
            </button>
          )}
        </div>
        {plan.trialAvailable && <p className="muted small" style={{ margin: 0 }}>{t('trialHelp')}</p>}
        <ErrorBox error={error} />
      </div>

      <div className="card pad stack">
        <h2>{t('activateTitle')}</h2>
        {demo ? (
          <p className="muted" style={{ margin: 0 }}>{t('demoLicenseNote')}</p>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>{t('activateHelp')}</p>
            <label className="field">
              <span>{t('licenseKey')}</span>
              <textarea className="input ltr license-key" rows={4} spellCheck={false} autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="QASA1.…" />
            </label>
            <div className="row">
              <button
                type="button" className="btn primary" disabled={busy || !key.trim()}
                onClick={() => void act(() => api.activateLicense(key), t('licenseActivated')).then((ok) => { if (ok) setKey(''); })}
              >
                {t('activate')}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div style={{ padding: '14px 16px 6px' }}><h2>{t('comparePlans')}</h2></div>
        <div className="table-wrap">
          <table className="table plans-table">
            <thead>
              <tr>
                <th />
                {PLAN_IDS.map((id) => (
                  <th key={id} className={id === plan.plan ? 'current' : undefined}>
                    {planName(id)}{id === plan.plan && <div className="small" style={{ fontWeight: 400 }}>{t('yourPlan')}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label}>
                  <td>{t(row.label)}{row.soon && <> <span className="chip">{t('soon')}</span></>}</td>
                  {row.cells.map((cell, i) => (
                    <td key={PLAN_IDS[i]} className={PLAN_IDS[i] === plan.plan ? 'current' : undefined}>{cellText(cell, i18n)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card pad stack">
        <h2>{t('getPlan')}</h2>
        <p style={{ margin: 0 }}>{t('buyHelp')}</p>
        <div className="row">
          <a className="btn primary" href={CONTACT}><Icon name="mail" size={16} />{t('emailUs')}</a>
          <span className="ltr muted">info@qasaerp.com</span>
          <span className="spacer" />
          <a className="btn ghost" href="https://qasaerp.com/#plans" target="_blank" rel="noopener noreferrer">qasaerp.com</a>
        </div>
      </div>
    </div>
  );
}
