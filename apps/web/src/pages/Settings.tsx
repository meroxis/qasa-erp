import { useEffect, useState } from 'react';
import { MONTHS, rateFromX100, todayIso, toWesternDigits, type Names, type PostingAccounts } from '@qasa/core';
import { api, ApiError, currentUser, setCurrentUser, type NetworkStatus } from '../api.ts';
import { AccountCombo, ErrorBox, useData, useLoad, useToast } from '../components.tsx';
import { isKey, useI18n } from '../i18n.ts';
import { href } from '../router.ts';

export function Settings() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, reloadSettings } = useData();
  const [name, setName] = useState<Names>({ ar: '', en: '', ku: '' });
  const [rate, setRate] = useState('');
  const [fiscal, setFiscal] = useState('01-01');
  const [user, setUser] = useState(currentUser());
  // with sign-in on, the name on vouchers is the signed-in user's
  const [signInOn, setSignInOn] = useState(false);
  useEffect(() => { api.me().then((m) => setSignInOn(m.signInRequired), () => undefined); }, []);
  const [error, setError] = useState<unknown>(null);
  const year = todayIso().slice(0, 4);
  const periods = useLoad(() => api.periods(), []);
  const audit = useLoad(() => api.audit(100), []);

  useEffect(() => {
    if (!settings) return;
    setName(settings.companyName);
    setRate(String(rateFromX100(settings.defaultRateX100)));
    setFiscal(settings.fiscalYearStart);
  }, [settings]);

  async function save() {
    setError(null);
    try {
      const r = Number(toWesternDigits(rate).replace(/[,٬\s]/g, ''));
      await api.updateSettings({ companyName: name, defaultRateX100: Math.round(r * 100), fiscalYearStart: fiscal });
      setCurrentUser(user.trim());
      await reloadSettings();
      audit.reload();
      toast(t('saved'));
    } catch (e) {
      setError(e);
    }
  }

  async function togglePeriod(period: string, locked: boolean) {
    setError(null);
    try {
      if (locked) await api.unlockPeriod(period); else await api.lockPeriod(period);
      periods.reload();
      audit.reload();
    } catch (e) {
      setError(e);
    }
  }

  const lockedSet = new Set((periods.data ?? []).map((p) => p.period));
  const actionLabel = (a: string) => (isKey('a_' + a) ? t(('a_' + a) as 'a_create') : a);
  const entityLabel = (e: string) => (isKey('e_' + e) ? t(('e_' + e) as 'e_entry') : e);

  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <div className="card pad stack">
        <h2>{t('company')}</h2>
        <div className="grid-3">
          <label className="field"><span>{t('nameAr')}</span><input className="input" dir="rtl" lang="ar" value={name.ar} onChange={(e) => setName({ ...name, ar: e.target.value })} /></label>
          <label className="field"><span>{t('nameEn')}</span><input className="input" dir="ltr" lang="en" value={name.en} onChange={(e) => setName({ ...name, en: e.target.value })} /></label>
          <label className="field"><span>{t('nameKu')}</span><input className="input" dir="rtl" lang="ckb" value={name.ku} onChange={(e) => setName({ ...name, ku: e.target.value })} /></label>
          <label className="field"><span>{t('defaultRate')} <span className="muted">({t('perUsd')})</span></span><input className="input amount" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
          <label className="field"><span>{t('fiscalStart')}</span><input className="input ltr" value={fiscal} onChange={(e) => setFiscal(e.target.value)} /></label>
          {!signInOn && <label className="field"><span>{t('yourName')}</span><input className="input" value={user} onChange={(e) => setUser(e.target.value)} /></label>}
        </div>
        <ErrorBox error={error} />
        <div><button type="button" className="btn primary" onClick={save}>{t('save')}</button></div>
      </div>

      <PostingAccountsCard />

      <OfficeNetworkCard />

      <div className="card pad stack">
        <h2>{t('periods')} — <span className="num">{i18n.digitsOf(year)}</span></h2>
        <div className="muted small">{t('periodsHelp')}</div>
        <div className="grid-4">
          {MONTHS[i18n.lang].map((m, i) => {
            const period = `${year}-${String(i + 1).padStart(2, '0')}`;
            const locked = lockedSet.has(period);
            return (
              <div key={period} className="row" style={{ justifyContent: 'space-between', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }}>
                <span>{m} {locked && <span className="chip warn">{t('locked')}</span>}</span>
                <button type="button" className="btn small" onClick={() => togglePeriod(period, locked)}>{locked ? t('unlock') : t('lock')}</button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div style={{ padding: '14px 16px 6px' }}>
          <h2>{t('auditLog')}</h2>
          <div className="muted small">{t('auditHelp')}</div>
        </div>
        <ErrorBox error={audit.error} />
        <table className="table">
          <thead><tr><th>{t('when')}</th><th>{t('who')}</th><th>{t('what')}</th></tr></thead>
          <tbody>
            {(audit.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="num small">{i18n.digitsOf(new Date(r.at).toLocaleString('en-GB'))}</td>
                <td>{r.user}</td>
                <td>{actionLabel(r.action)} · {entityLabel(r.entity)} {r.entityId && <span className="muted small ltr">{r.entityId.length > 12 ? r.entityId.slice(0, 8) : r.entityId}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Other PCs in the office working on this company file (the Pro module; absent in builds without it). */
function OfficeNetworkCard() {
  const { t, digitsOf } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [absent, setAbsent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.network().then(setStatus, (e) => {
      if (e instanceof ApiError && e.status === 404) setAbsent(true);
      else setError(e);
    });
  }, []);

  async function toggle(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.setNetwork(on));
      toast(t('saved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const address = (a: string) => (status && status.port !== 47420 ? `${a}:${status.port}` : a);
  return (
    <div className="card pad stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{t('netTitle')}</h2>
        {status && <span className={'chip ' + (status.on ? 'ok' : '')}>{status.on ? t('switchedOn') : t('switchedOff')}</span>}
      </div>
      <p className="muted" style={{ margin: 0 }}>{t('netHelp')}</p>
      {absent && <div className="alert">{t('netOfficial')}</div>}
      {status && !status.available && <div className="alert">{t('netNeedsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      {status && status.available && !status.signInRequired && <div className="alert">{t('netNeedsSignIn')} <a href={href('users')}>{t('users')}</a></div>}
      {status?.on && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="grid-2">
            <div className="field">
              <span>{t('netAddress')}</span>
              {status.addresses.length
                ? status.addresses.map((a) => <strong key={a} className="ltr num" style={{ fontSize: 18 }}>{address(a)}</strong>)
                : <span className="muted">{t('netNoAddress')}</span>}
            </div>
            <div className="field">
              <span>{t('netCode')}</span>
              <strong className="ltr num" style={{ fontSize: 22, letterSpacing: '.06em' }}>{status.code}</strong>
            </div>
          </div>
          <p style={{ margin: 0 }}>{t('netSteps')}</p>
          <p className="muted small" style={{ margin: 0 }}>{t('netFirewall')}</p>
          <p className="muted small" style={{ margin: 0 }}>{t('netSignedIn', { n: digitsOf(String(status.signedIn)) })}</p>
        </div>
      )}
      <ErrorBox error={error} />
      {status && status.available && (status.on || status.signInRequired) && (
        <div>
          <button type="button" className={'btn ' + (status.on ? '' : 'primary')} disabled={busy} onClick={() => toggle(!status.on)}>
            {status.on ? t('netTurnOff') : t('netTurnOn')}
          </button>
        </div>
      )}
    </div>
  );
}

const POSTING_FIELDS: { key: keyof PostingAccounts; root: string }[] = [
  { key: 'sales', root: '4' },
  { key: 'costOfSales', root: '3' },
  { key: 'customers', root: '16' },
  { key: 'suppliers', root: '26' },
  { key: 'cash', root: '18' }
];

/** Which accounts invoices post to (sales 42, cost of sales 35, customers 1611 …). */
function PostingAccountsCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { settings, reloadSettings } = useData();
  const [accounts, setAccounts] = useState<PostingAccounts | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (settings) setAccounts(settings.postingAccounts);
  }, [settings]);

  if (!accounts) return null;

  async function save() {
    if (!accounts) return;
    setError(null);
    try {
      await api.updateSettings({ postingAccounts: accounts });
      await reloadSettings();
      toast(t('saved'));
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="card pad stack">
      <h2>{t('postingAccounts')}</h2>
      <div className="muted small">{t('postingHelp')}</div>
      <div className="grid-3">
        {POSTING_FIELDS.map((f) => (
          <div key={f.key} className="field">
            <span>{t(`pa_${f.key}`)}</span>
            <AccountCombo value={accounts[f.key]} onChange={(code) => setAccounts({ ...accounts, [f.key]: code })} filter={(a) => a.code.startsWith(f.root)} ariaLabel={t(`pa_${f.key}`)} />
          </div>
        ))}
      </div>
      <ErrorBox error={error} />
      <div><button type="button" className="btn primary" onClick={save}>{t('save')}</button></div>
    </div>
  );
}
