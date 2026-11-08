import { useMemo, useState } from 'react';
import { todayIso, toWesternDigits } from '@qasa/core';
import { AccountCombo, ErrorBox, Icon, Modal, useData, useLoad, usePageNav, useToast } from '../components.tsx';
import { useI18n, type I18n } from '../i18n.ts';
import { fxApi, type FxRateView, type FxRevaluation } from '../industry/fx-api.ts';
import { go, href } from '../router.ts';

/**
 * سعر الدولار: the rate board. In Iraq the dollar is quoted per $100 ("146,500"), which is exactly how the app stores
 * rates (IQD per 1 USD × 100), so the number typed is the number kept.
 */

const NAV = { key: 'fx_title' as const, group: 'gAccounting' as const };

/** "146,500" or "١٤٦٬٥٠٠" → 146500; null when it isn't a whole positive number. */
function parseRate(text: string): number | null {
  const clean = toWesternDigits(text).replace(/[,\s٬]/g, '');
  if (!/^\d+$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const rateText = (i18n: I18n, rateX100: number) => i18n.int(rateX100);

export function Rates({ tab = 'rates' }: { tab?: 'rates' | 'revaluation' }) {
  const { t } = useI18n();
  usePageNav(NAV);
  return (
    <div className="stack">
      <div className="tabs" role="group">
        <button type="button" aria-pressed={tab === 'rates'} onClick={() => go('rates')}>{t('fx_tabRates')}</button>
        <button type="button" aria-pressed={tab === 'revaluation'} onClick={() => go('rates/revaluation')}>{t('fx_tabRevaluation')}</button>
      </div>
      {tab === 'rates' ? <Board /> : <Revaluation />}
    </div>
  );
}

function Board() {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings, reloadSettings } = useData();
  const toast = useToast();
  const [days, setDays] = useState(30);
  const history = useLoad(() => fxApi.rates({ days }), [days]);
  const latest = useLoad(() => fxApi.rates(), []);
  const all = latest.data ?? [];
  const newest = all[0];
  const previous = all[1];
  const [date, setDate] = useState(todayIso());
  const [rate, setRate] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState<FxRateView | null>(null);
  const parsed = parseRate(rate);
  const today = todayIso();
  const hasToday = newest?.date === today;

  async function save(value: number) {
    setBusy(true);
    setError(null);
    try {
      await fxApi.setRate({ date, rateX100: value, ...(source.trim() ? { source: source.trim() } : {}) });
      toast(t('saved'));
      setRate('');
      history.reload();
      latest.reload();
      reloadSettings();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const change = newest && previous ? newest.rateX100 - previous.rateX100 : null;

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('fx_help')}</p>
      <div className="grid-4">
        <div className="card pad tile">
          <div className="label">{t('fx_today')}</div>
          <div className="value num">{hasToday && newest ? rateText(i18n, newest.rateX100) : '—'}</div>
          <div className="small muted">{hasToday ? t('fx_perDollar') : t('fx_noRateYet')}</div>
        </div>
        <div className="card pad tile">
          <div className="label">{t('fx_change')}</div>
          <div className="value num" style={change ? { color: change > 0 ? 'var(--ok)' : 'var(--bad)' } : undefined}>
            {change === null ? '—' : `${change > 0 ? '▲ ' : change < 0 ? '▼ ' : ''}${i18n.int(Math.abs(change))}`}
          </div>
          <div className="small muted">{previous ? i18n.date(previous.date) : ''}</div>
        </div>
        <div className="card pad tile">
          <div className="label">{t('fx_defaultRate')}</div>
          <div className="value num">{settings ? rateText(i18n, settings.defaultRateX100) : '—'}</div>
          <div className="small muted">{t('fx_perDollar')}</div>
        </div>
      </div>

      <div className="card pad stack">
        <div className="grid-2">
          <label className="field"><span>{t('date')}</span><input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field">
            <span>{t('fx_rateInput')}</span>
            <input className="input num ltr" inputMode="numeric" placeholder="146,500" aria-invalid={rate !== '' && parsed === null}
              value={rate} onChange={(e) => setRate(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && parsed) void save(parsed); }} />
          </label>
          <label className="field"><span>{t('fx_source')}</span><input className="input" placeholder={t('fx_sourceHint')} value={source} onChange={(e) => setSource(e.target.value)} /></label>
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || parsed === null} onClick={() => parsed && void save(parsed)}><Icon name="check" size={16} />{t('fx_saveRate')}</button>
          {newest && <button type="button" className="btn" disabled={busy} onClick={() => void save(newest.rateX100)}>{t('fx_sameAsYesterday')} ({rateText(i18n, newest.rateX100)})</button>}
        </div>
      </div>

      <div className="card pad stack">
        <div className="row">
          <strong>{t('fx_history')}</strong>
          <span className="spacer" />
          <div className="track">
            {[30, 90, 365].map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{t(d === 30 ? 'fx_days30' : d === 90 ? 'fx_days90' : 'fx_days365')}</button>
            ))}
          </div>
        </div>
        <ErrorBox error={history.error} />
        {history.data && (history.data.length ? (
          <>
            <RateChart rates={history.data} i18n={i18n} />
            <table className="table">
              <thead><tr><th>{t('date')}</th><th className="num">{t('exchangeRate')}</th><th>{t('fx_source')}</th><th>{t('fx_enteredBy')}</th><th /></tr></thead>
              <tbody>
                {history.data.map((r) => (
                  <tr key={r.date}>
                    <td>{i18n.date(r.date)}</td>
                    <td className="num">{rateText(i18n, r.rateX100)}</td>
                    <td>{r.source ?? ''}</td>
                    <td>{r.createdBy}</td>
                    <td className="num"><button type="button" className="btn subtle icon" aria-label={t('actDelete')} title={t('actDelete')} onClick={() => setDeleting(r)}><Icon name="x" size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : <p className="muted">{t('fx_noHistory')}</p>)}
      </div>
      {deleting && (
        <DeleteRate rate={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); history.reload(); latest.reload(); reloadSettings(); }} />
      )}
    </div>
  );
}

function DeleteRate({ rate, onClose, onDone }: { rate: FxRateView; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal title={t('fx_deleteConfirm')} onClose={onClose}>
      <div className="stack">
        <p>{i18n.date(rate.date)} — <span className="num">{rateText(i18n, rate.rateX100)}</span></p>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn danger" onClick={() => { fxApi.deleteRate(rate.date).then(onDone, setError); }}><Icon name="x" size={16} />{t('actDelete')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** A plain line chart, oldest to newest left to right (time reads that way in every language). */
function RateChart({ rates, i18n }: { rates: FxRateView[]; i18n: I18n }) {
  const points = useMemo(() => [...rates].sort((a, b) => a.date.localeCompare(b.date)), [rates]);
  const W = 640, H = 160, P = 8;
  const min = Math.min(...points.map((p) => p.rateX100));
  const max = Math.max(...points.map((p) => p.rateX100));
  const span = max - min || 1;
  const x = (i: number) => (points.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (points.length - 1));
  const y = (v: number) => H - P - ((v - min) * (H - 2 * P)) / span;
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.rateX100).toFixed(1)}`).join(' ');
  return (
    <figure style={{ margin: 0 }} dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${i18n.t('fx_chart')}: ${i18n.int(min)} – ${i18n.int(max)}`} preserveAspectRatio="none">
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {points.map((p, i) => <circle key={p.date} cx={x(i)} cy={y(p.rateX100)} r="3" fill="var(--accent)"><title>{`${i18n.date(p.date)}: ${i18n.int(p.rateX100)}`}</title></circle>)}
      </svg>
      <figcaption className="row small muted num">
        <span>{i18n.date(points[0]!.date)}</span>
        <span className="spacer" />
        <span>{i18n.int(min)} – {i18n.int(max)}</span>
        <span className="spacer" />
        <span>{i18n.date(points[points.length - 1]!.date)}</span>
      </figcaption>
    </figure>
  );
}

function Revaluation() {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const toast = useToast();
  const [date, setDate] = useState(todayIso());
  const [other, setOther] = useState('');
  const otherRate = parseRate(other);
  const report = useLoad(() => fxApi.revaluation({ date, ...(otherRate ? { rateX100: otherRate } : {}) }), [date, otherRate]);
  const [gainAccount, setGainAccount] = useState('49');
  const [lossAccount, setLossAccount] = useState('39');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [entryId, setEntryId] = useState<string | null>(null);

  async function post(r: FxRevaluation) {
    setBusy(true);
    setError(null);
    try {
      const entry = await fxApi.postRevaluation({ date: r.date, rateX100: r.rateX100, gainAccount, lossAccount, lang });
      setEntryId(entry.id);
      toast(t('fx_posted'));
      report.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const r = report.data;
  const toPost = r ? r.rows.filter((x) => !x.mixed && x.difference !== 0).length : 0;
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('fx_revalHelp')}</p>
      <div className="card pad">
        <div className="grid-2">
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>{t('fx_otherRate')}</span><input className="input num ltr" inputMode="numeric" placeholder={r ? i18n.int(r.rateX100) : ''} value={other} onChange={(e) => setOther(e.target.value)} /></label>
        </div>
        {r && (
          <p className="small muted" style={{ marginBlockEnd: 0 }}>
            {t('fx_atRate')} <strong className="num">{rateText(i18n, r.rateX100)}</strong> {t('fx_perDollar')} — {r.rateSource === 'given' ? t('fx_otherRate') : r.rateSource === 'board' ? t('fx_rateFromBoard') : t('fx_rateDefault')}
          </p>
        )}
      </div>
      <ErrorBox error={report.error} />
      {r && (r.rows.length ? (
        <>
          <div className="grid-4">
            <div className="card pad tile"><div className="label">{t('fx_gains')}</div><div className="value num" style={{ color: 'var(--ok)' }}>{i18n.money(r.gains, 'IQD')}</div></div>
            <div className="card pad tile"><div className="label">{t('fx_losses')}</div><div className="value num" style={r.losses ? { color: 'var(--bad)' } : undefined}>{i18n.money(r.losses, 'IQD')}</div></div>
            <div className="card pad tile"><div className="label">{t('fx_net')}</div><div className="value num">{i18n.money(r.net, 'IQD')}</div></div>
          </div>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('account')}</th><th className="num">{t('fx_balanceUsd')}</th><th className="num">{t('fx_inBooks')}</th>
                  <th className="num">{t('fx_atToday')}</th><th className="num">{t('fx_difference')}</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row) => (
                  <tr key={`${row.accountCode}|${row.partyId ?? ''}`} className={row.mixed ? 'muted' : undefined}>
                    <td>
                      <span className="num">{row.accountCode}</span> — {i18n.name(row.accountName)}
                      {row.partyName && <div className="small bidi">{row.partyName}</div>}
                      {row.mixed && <div className="small" title={t('fx_mixedHelp')}><span className="chip warn">{t('fx_mixed')}</span> {t('fx_mixedHelp')}</div>}
                    </td>
                    <td className="num">{i18n.money(row.usd, 'USD')}</td>
                    <td className="num">{i18n.money(row.carried, 'IQD')}</td>
                    <td className="num">{i18n.money(row.revalued, 'IQD')}</td>
                    <td className="num" style={row.difference ? { color: row.difference > 0 ? 'var(--ok)' : 'var(--bad)' } : undefined}>
                      {row.difference > 0 ? '+' : ''}{i18n.money(row.difference, 'IQD')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card pad stack">
            <strong>{t('fx_post')}</strong>
            <p className="small muted" style={{ margin: 0 }}>{t('fx_postHelp')}</p>
            <div className="grid-2">
              <div className="field"><span>{t('fx_gainAccount')}</span><AccountCombo value={gainAccount} onChange={setGainAccount} filter={(a) => a.code.startsWith('4')} ariaLabel={t('fx_gainAccount')} /></div>
              <div className="field"><span>{t('fx_lossAccount')}</span><AccountCombo value={lossAccount} onChange={setLossAccount} filter={(a) => a.code.startsWith('3')} ariaLabel={t('fx_lossAccount')} /></div>
            </div>
            <ErrorBox error={error} />
            <div className="row">
              <button type="button" className="btn primary" disabled={busy || toPost === 0} onClick={() => void post(r)}><Icon name="check" size={16} />{t('fx_post')}</button>
              {entryId && <a className="btn" href={href(`entry/${entryId}`)}>{t('fx_openEntry')}</a>}
            </div>
          </div>
        </>
      ) : <div className="card pad muted">{t('fx_nothing')}</div>)}
    </div>
  );
}
