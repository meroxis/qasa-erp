import { useEffect, useState } from 'react';
import { daysBetween, PLAN_IDS, PLAN_PRICE_IQD, PLANS, TRIAL_DAYS, todayIso, type Feature } from '@qasa/core';
import { api, request, type PlanStatus } from '../api.ts';
import { ErrorBox, Icon, useBuildHas, useData, useToast } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { AgreeLine } from '../industry/LegalPanel.tsx';

const demo = import.meta.env.MODE === 'demo';
const CONTACT = 'mailto:info@qasaerp.com?subject=' + encodeURIComponent('Qasa ERP Starter / Pro / Business');
/** The customer portal in the app's language, at its buy page (it asks the customer to sign in first). */
const PORTAL = (lang: string) => `https://my.qasaerp.com/lang/${lang}?back=/buy`;

/** A cell of the comparison: a text, a tick or a dash, a limit (null = unlimited), or a year's price in dinars. */
type Cell = Key | boolean | { limit: number | null } | { key: Key; n: number } | { price: number };
/** One cell per plan, in the order of PLAN_IDS: Free, Starter, Pro, Business. */
type Cells = [Cell, Cell, Cell, Cell];
interface Row { label: Key; cells: Cells; soon?: boolean }

const { free, starter, pro, business } = PLANS;
/** A tick for each plan that has the feature, read from the plans themselves (so the table can't say otherwise). */
const has = (feature: Feature): Cells => [free, starter, pro, business].map((p) => p.features.includes(feature)) as Cells;
const limits = (name: keyof typeof free.limits): Cells => [free, starter, pro, business].map((p) => ({ limit: p.limits[name] })) as Cells;
const ALL: Cells = [true, true, true, true];
/** The plan comparison table (exported for its test). */
export const ROWS: Row[] = [
  { label: 'f_price', cells: ['plan_free', { price: PLAN_PRICE_IQD.starter }, { price: PLAN_PRICE_IQD.pro }, { price: PLAN_PRICE_IQD.business }] },
  { label: 'f_core', cells: ALL },
  { label: 'f_warehouses', cells: limits('warehouses') },
  { label: 'f_branding', cells: ['v_shown', 'v_removed', 'v_removed', 'v_removed'] },
  { label: 'f_users', cells: limits('users') },
  // Starter: on the office's own network only
  { label: 'f_network', cells: has('officeNetwork') },
  // Qasa Relay needs an activated Pro or Business licence (the free month leaves it out, as its label says)
  { label: 'f_relay', cells: has('relay') },
  { label: 'f_companies', cells: limits('companies') },
  { label: 'f_roles', cells: ['v_onePerson', true, true, true] },
  { label: 'f_quotes', cells: ALL },
  { label: 'f_pos', cells: ALL },
  { label: 'f_installments', cells: has('installments') },
  { label: 'f_pipeline', cells: has('pipeline') },
  // the phone app is not in 1.0: shown as coming, never as included
  { label: 'f_phoneApp', cells: has('phoneApp'), soon: true },
  { label: 'f_websiteApi', cells: has('websiteApi') },
  { label: 'f_cloudBackup', cells: has('cloudBackup') },
  { label: 'f_bankReconciliation', cells: has('bankReconciliation') },
  { label: 'f_payroll', cells: has('payroll') },
  { label: 'f_finalAccounts', cells: ['v_viewOnScreen', 'v_printExcel', 'v_printExcel', 'v_printExcel'] },
  { label: 'f_yearEnd', cells: has('finalAccountsExport') },
  { label: 'f_backup', cells: has('autoBackup') },
  { label: 'f_dbServer', cells: has('databaseServer') },
  { label: 'f_mobileShop', cells: has('mobileShop') },
  { label: 'f_autoParts', cells: has('autoParts') },
  { label: 'f_pharmacy', cells: has('pharmacy') },
  { label: 'f_loyalty', cells: has('loyalty') },
  { label: 'f_companyLogo', cells: has('companyLogo') },
  { label: 'f_engineeringWorks', cells: has('engineeringWorks') },
  { label: 'f_electricalSolar', cells: has('electricalSolar') },
  { label: 'f_generators', cells: has('generators') },
  { label: 'f_realEstate', cells: has('realEstate') },
  { label: 'f_branches', cells: has('branches') },
  // the online edition (in the browser) is not in 1.0 yet: the plan table must not promise it as included. Working from
  // anywhere on the office network is Qasa Relay (f_relay), on Pro and Business.
  { label: 'f_online', cells: has('onlineEdition'), soon: true },
  { label: 'f_support', cells: ['v_supportFree', 'v_supportPro', 'v_supportPro', 'v_supportBusiness'] }
];

function cellText(cell: Cell, i18n: I18n) {
  const { t } = i18n;
  if (cell === true) return <span className="yes" aria-label="✓"><Icon name="check" size={16} /></span>;
  if (cell === false) return <span className="muted" aria-label="—">—</span>;
  if (typeof cell === 'string') return t(cell);
  if ('limit' in cell) return cell.limit === null ? t('unlimited') : i18n.int(cell.limit);
  if ('price' in cell) return <span className="num">{t('v_priceYear', { n: i18n.int(cell.price) })}</span>;
  return t(cell.key, { n: cell.n });
}

/** Where the licence stands on this PC: activated (until when offline), waiting for activation, or stopped and why. */
function ActivationNote({ plan, busy, act }: { plan: PlanStatus; busy: boolean; act(fn: () => Promise<PlanStatus>, message: string): Promise<boolean> }) {
  const i18n = useI18n();
  const { t } = i18n;
  const a = plan.activation;
  const activate = () => void act(() => request<PlanStatus>('POST', '/api/plan/activate', {}), t('ac_activated'));
  const check = () => void act(() => request<PlanStatus>('POST', '/api/plan/check', {}), t('ac_checked'));
  const planName = t(`plan_${plan.license?.plan ?? 'pro'}` as Key);
  if (a.state === 'active') {
    return (
      <div className="row" style={{ gap: 8 }}>
        <span className="chip ok">{t('ac_active')}</span>
        {a.offlineUntil && <span className="muted small">{t('ac_activeHelp', { d: i18n.date(a.offlineUntil) })}</span>}
        {a.lastChecked && <span className="muted small">{t('ac_lastChecked')}: <span className="num">{i18n.date(a.lastChecked.slice(0, 10))}</span></span>}
      </div>
    );
  }
  if (a.state === 'needs_activation') {
    return (
      <div className="alert info stack">
        <span>{a.inGrace && a.graceUntil ? t('ac_needsGrace', { d: i18n.date(a.graceUntil) }) : t('ac_needs')}</span>
        <AgreeLine paid />
        <div><button type="button" className="btn primary" disabled={busy} onClick={activate}>{t('ac_activateNow')}</button></div>
      </div>
    );
  }
  if (a.state === 'revoked') {
    const reason = a.revokedReason === 'released' ? 'ac_revoked_released' : a.revokedReason === 'unknown' ? 'ac_revoked_unknown' : 'ac_revoked_revoked';
    return (
      <div className="alert bad stack">
        <span>{t(reason)}</span>
        {a.revokedReason === 'released' && <div><button type="button" className="btn" disabled={busy} onClick={activate}>{t('ac_activateNow')}</button></div>}
      </div>
    );
  }
  return (
    <div className="alert warn stack">
      <span>{a.state === 'clock' ? t('ac_clock') : t('ac_stale', { p: planName })}</span>
      <div><button type="button" className="btn primary" disabled={busy} onClick={check}>{t('ac_checkNow')}</button></div>
    </div>
  );
}

/** What the Pro module's own licence check says (GET /api/pro/licence-check; missing in builds without Pro). */
export interface ProLicenceCheck { heldBack: boolean; reason: string | null }

/**
 * The note for a Pro module that holds its features back on this PC: the app's files changed, this PC couldn't be
 * confirmed (its Windows id unreadable, or the licence addon missing or not the one we published), or a licence to
 * check in.
 */
export function proHeldKey(check: ProLicenceCheck | null): Key | null {
  if (!check?.heldBack) return null;
  if (check.reason === 'integrity') return 'ac_proHeldFiles';
  return check.reason === 'machine' || check.reason === 'addon' ? 'ac_proHeldPc' : 'ac_proHeld';
}

/**
 * The official Windows app's Pro module checks the licence for itself; when it can't confirm it on this PC, its pages
 * pause (the data stays) and this says why, with the way back.
 */
function ProHeldNote({ plan, busy, act }: { plan: PlanStatus; busy: boolean; act(fn: () => Promise<PlanStatus>, message: string): Promise<boolean> }) {
  const { t } = useI18n();
  const [check, setCheck] = useState<ProLicenceCheck | null>(null);
  // (a build without the Pro module has no such check to ask for)
  const served = useBuildHas('pro');
  useEffect(() => {
    if (demo || plan.plan === 'free' || !served) {
      setCheck(null);
      return;
    }
    let live = true;
    request<ProLicenceCheck>('GET', '/api/pro/licence-check').then((c) => { if (live) setCheck(c); }, () => { if (live) setCheck(null); });
    return () => { live = false; };
  }, [plan, served]);
  const key = proHeldKey(check);
  if (!key) return null;
  return (
    <div className="alert warn stack" role="status">
      <span>{t(key)}</span>
      {key === 'ac_proHeld' && plan.license && (
        <div><button type="button" className="btn primary" disabled={busy} onClick={() => void act(() => request<PlanStatus>('POST', '/api/plan/check', {}), t('ac_checked'))}>{t('ac_checkNow')}</button></div>
      )}
    </div>
  );
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

        {license && plan.activation.required && (
          <ActivationNote plan={plan} busy={busy} act={act} />
        )}
        <ProHeldNote plan={plan} busy={busy} act={act} />

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
          {license && !demo && plan.activation.required && plan.activation.state === 'active' && (
            <button type="button" className="btn" disabled={busy} onClick={() => { if (window.confirm(t('ac_moveConfirm'))) void act(() => request<PlanStatus>('POST', '/api/plan/deactivate', {}), t('ac_moved')); }}>
              {t('ac_moveToPc')}
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
                onClick={() => void act(async () => {
                  // the key, then (in the official app) its activation on this PC, online, in one go
                  const entered = await api.activateLicense(key);
                  return entered.activation.required ? request<PlanStatus>('POST', '/api/plan/activate', {}) : entered;
                }, t('licenseActivated')).then((ok) => { if (ok) setKey(''); })}
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
          <a className="btn primary" href={PORTAL(i18n.lang)} target="_blank" rel="noopener noreferrer"><Icon name="cart" size={16} />{t('buyOnline')}</a>
          <span className="ltr muted">my.qasaerp.com</span>
          <span className="spacer" />
          <a className="btn ghost" href={CONTACT}><Icon name="mail" size={16} />{t('emailUs')}</a>
        </div>
      </div>
    </div>
  );
}
