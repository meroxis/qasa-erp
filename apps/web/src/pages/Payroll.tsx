import { Fragment, useEffect, useState, type ChangeEvent } from 'react';
import { rateFromX100, todayIso, toWesternDigits, type CurrencyCode } from '@qasa/core';
import { ApiError } from '../api.ts';
import { EmptyState, AccountCombo, AmountInput, downloadCsv, ErrorBox, Icon, Modal, SearchCombo, useData, useLoad, usePageNav, useToast, type PickOption } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { go, href } from '../router.ts';
import {
  payrollApi, type AdvanceView, type EmployeeInput, type EmployeeView, type PayLineInput, type PayLineView, type PayrollAccounts,
  type PayrollSummary, type RunStatus, type RunView
} from '../industry/payroll-api.ts';
import { ReverseModal } from '../industry/ReverseModal.tsx';
import { printDocument } from '../industry/printing.ts';

/**
 * الرواتب (Pro, admins only): employees, a payroll sheet per month (prepared in one click, edited, posted as one journal
 * entry), advances taken back from salaries, payslips and the month's sheet to print.
 */

export type PayrollTab = 'months' | 'employees' | 'advances';
const NAV = { key: 'pay_title' as Key, group: 'gPeople' as Key };
const RUN_CHIP: Record<RunStatus, string> = { draft: 'warn', posted: 'ok', cancelled: '' };

const money2 = (i18n: I18n, m: { IQD: number; USD: number }) =>
  m.USD ? `${i18n.money(m.IQD, 'IQD')} · ${i18n.money(m.USD, 'USD')}` : i18n.money(m.IQD, 'IQD');
const thisMonth = () => todayIso().slice(0, 7);
const parseRate = (s: string) => Math.round(Number(toWesternDigits(s).replace(/,/g, '')) * 100);

export function RunChip({ status }: { status: RunStatus }) {
  const { t } = useI18n();
  return <span className={'chip ' + RUN_CHIP[status]}>{t(`pay_st_${status}`)}</span>;
}

/** The API answers 404 without the Pro module and 403 to anyone but an admin. */
function Unavailable({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (error instanceof ApiError && error.status === 404) return <div className="alert info">{t('pay_notAvailable')}</div>;
  if (error instanceof ApiError && error.status === 403) return <div className="alert info">{t('pay_adminOnly')}</div>;
  return <ErrorBox error={error} />;
}

/* ---------- the page with its three tabs ---------- */

export function Payroll({ tab = 'months' }: { tab?: PayrollTab }) {
  const i18n = useI18n();
  const { t } = i18n;
  usePageNav(NAV);
  const summary = useLoad(() => payrollApi.summary(), []);
  if (summary.error) return <Unavailable error={summary.error} />;
  const s = summary.data;

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('pay_help')}</p>
      {s && !s.available && <div className="alert">{t('pay_needsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      {s && <Tiles s={s} />}
      <div className="row">
        <div className="track" role="tablist">
          {(['months', 'employees', 'advances'] as const).map((k) => (
            <a key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} className="btn" style={{ border: 'none' }}
              href={href(k === 'months' ? 'payroll' : `payroll/${k}`)}>
              {t(k === 'months' ? 'pay_tabMonths' : k === 'employees' ? 'pay_tabEmployees' : 'pay_tabAdvances')}
            </a>
          ))}
        </div>
      </div>
      {tab === 'months' && <Months summary={s} onChange={summary.reload} />}
      {tab === 'employees' && <Employees canChange={!!s?.available} onChange={summary.reload} />}
      {tab === 'advances' && <Advances canChange={!!s?.available} onChange={summary.reload} />}
    </div>
  );
}

function Tiles({ s }: { s: PayrollSummary }) {
  const i18n = useI18n();
  const { t } = i18n;
  const tiles = [
    { label: t('pay_employeesTile'), value: i18n.int(s.employees) },
    { label: t('pay_monthlyTile'), value: money2(i18n, s.monthly) },
    { label: t('pay_advancesTile'), value: money2(i18n, s.advancesOpen) },
    { label: t('pay_lastRunTile'), value: s.lastRun ? i18n.digitsOf(s.lastRun.period) : '—', sub: s.lastRun ? t(`pay_st_${s.lastRun.status}`) : '' }
  ];
  return (
    <div className="grid-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="card pad tile">
          <div className="label">{tile.label}</div>
          <div className="value num">{tile.value}</div>
          {tile.sub && <div className="small muted">{tile.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/* ---------- months ---------- */

function Months({ summary, onChange }: { summary: PayrollSummary | null; onChange(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { data, error, reload } = useLoad(() => payrollApi.runs(), []);
  const [preparing, setPreparing] = useState(false);
  const [settings, setSettings] = useState(false);
  return (
    <div className="stack">
      <div className="row">
        {summary?.available && (
          <button type="button" className="btn primary" style={{ fontSize: 16, padding: '10px 22px' }} onClick={() => setPreparing(true)}>
            <Icon name="plus" size={18} />{t('pay_prepare')}
          </button>
        )}
        <span className="spacer" />
        {summary?.available && <button type="button" className="btn" onClick={() => setSettings(true)}><Icon name="sliders" size={16} />{t('pay_settings')}</button>}
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {data && !data.length && <div className="pad muted">{t('pay_noRuns')}</div>}
        {data && !!data.length && (
          <table className="table">
            <thead>
              <tr>
                <th>{t('pay_month')}</th><th>{t('pay_tabEmployees')}</th><th className="amount">{t('pay_gross')}</th>
                <th className="amount">{t('pay_net')}</th><th>{t('pay_entryStatus')}</th><th />
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="click" onClick={() => go(`payroll-run/${r.id}`)}>
                  <td><a className="num ltr" href={href(`payroll-run/${r.id}`)} onClick={(e) => e.stopPropagation()}>{i18n.digitsOf(r.period)}</a> <span className="muted small">{r.currency}</span></td>
                  <td className="num">{i18n.int(r.employees)}</td>
                  <td className="amount num">{i18n.money(r.totals.gross, r.currency)}</td>
                  <td className="amount num"><strong>{i18n.money(r.totals.net, r.currency)}</strong></td>
                  <td>{r.entry ? <a className="ltr num" href={href(`entry/${r.entry.id}`)} onClick={(e) => e.stopPropagation()}>{r.entry.number ?? t(`pay_st_draft`)}</a> : '—'}</td>
                  <td><RunChip status={r.status} />{r.payment && <span className="chip ok">{t('pay_paid')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {preparing && <PrepareModal onClose={() => setPreparing(false)} onDone={(id) => { onChange(); reload(); go(`payroll-run/${id}`); }} />}
      {settings && summary && <SettingsModal current={summary.settings} onClose={() => setSettings(false)} onDone={() => { setSettings(false); onChange(); }} />}
    </div>
  );
}

function PrepareModal({ onClose, onDone }: { onClose(): void; onDone(id: string): void }) {
  const { t } = useI18n();
  const [period, setPeriod] = useState(thisMonth());
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      onDone((await payrollApi.prepare({ period, currency })).id);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <Modal title={t('pay_prepareTitle')} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('pay_prepareHelp')}</p>
        <div className="grid-2">
          <label className="field"><span>{t('pay_month')}</span><input className="input" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
          <label className="field"><span>{t('currency')}</span>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}><option value="IQD">IQD</option><option value="USD">USD</option></select>
          </label>
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !period} onClick={() => void submit()}><Icon name="check" size={16} />{t('pay_prepare')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function SettingsModal({ current, onClose, onDone }: { current: PayrollSummary['settings']; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [accounts, setAccounts] = useState<PayrollAccounts>(current.accounts);
  const [rate, setRate] = useState(String(current.socialSecurityBp / 100));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof PayrollAccounts) => (code: string) => setAccounts((a) => ({ ...a, [k]: code }));
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await payrollApi.updateSettings({ accounts, socialSecurityBp: Math.round(Number(toWesternDigits(rate).replace(/,/g, '.')) * 100) });
      toast(t('pay_saved'));
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  const rows: [keyof PayrollAccounts, Key][] = [['expense', 'pay_accExpense'], ['payable', 'pay_accPayable'], ['advances', 'pay_accAdvances'], ['socialSecurity', 'pay_accSs']];
  return (
    <Modal title={t('pay_settings')} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('pay_settingsHelp')}</p>
        {rows.map(([k, label]) => (
          <div key={k} className="field"><span>{t(label)}</span><AccountCombo value={accounts[k]} onChange={set(k)} ariaLabel={t(label)} /></div>
        ))}
        <label className="field"><span>{t('pay_ssRate')}</span><input className="input num ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}><Icon name="check" size={16} />{t('pay_save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- one month ---------- */

type Editable = Required<Omit<PayLineInput, 'notes'>> & { notes: string };
const NUMBER_FIELDS = ['base', 'allowances', 'overtime', 'bonus', 'absence', 'advanceDeduction', 'socialSecurity', 'otherDeductions'] as const;
const FIELD_LABEL: Record<(typeof NUMBER_FIELDS)[number], Key> = {
  base: 'pay_baseSalary', allowances: 'pay_allowances', overtime: 'pay_overtime', bonus: 'pay_bonus', absence: 'pay_absence',
  advanceDeduction: 'pay_advance', socialSecurity: 'pay_ssShort', otherDeductions: 'pay_otherDeductions'
};
const grossOf = (l: Editable) => l.base + l.allowances + l.overtime + l.bonus - l.absence;
const netOf = (l: Editable) => grossOf(l) - l.advanceDeduction - l.socialSecurity - l.otherDeductions;
const editable = (l: PayLineView): Editable => ({
  employeeId: l.employeeId, base: l.base, allowances: l.allowances, overtime: l.overtime, bonus: l.bonus, absence: l.absence,
  advanceDeduction: l.advanceDeduction, socialSecurity: l.socialSecurity, otherDeductions: l.otherDeductions, notes: l.notes
});

export function PayrollRun({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings } = useData();
  usePageNav(NAV);
  const { data: run, error, reload } = useLoad(() => payrollApi.run(id), [id]);
  const [lines, setLines] = useState<Editable[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [modal, setModal] = useState<'post' | 'cancel' | 'pay' | 'reverse' | null>(null);
  const [print, setPrint] = useState<'sheet' | 'slips' | null>(null);

  useEffect(() => { if (run) { setLines(run.lines.map(editable)); setDirty(false); } }, [run]);
  useEffect(() => {
    if (!print) return;
    // the sheet or the slips stay drawn until the print window closes or the paper went to the printer; a print that
    // ends after another one started never clears that one
    let live = true;
    const done = () => { if (live) setPrint(null); };
    window.addEventListener('afterprint', done, { once: true });
    const timer = window.setTimeout(() => void printDocument('report').finally(done), 50);
    return () => { live = false; window.clearTimeout(timer); window.removeEventListener('afterprint', done); };
  }, [print]);

  if (error) return <Unavailable error={error} />;
  if (!run) return null;
  const canEdit = run.actions.includes('edit');
  const byId = new Map(run.lines.map((l) => [l.employeeId, l]));
  const totals = lines.reduce((s, l) => ({ gross: s.gross + grossOf(l), net: s.net + netOf(l), adv: s.adv + l.advanceDeduction, ss: s.ss + l.socialSecurity }), { gross: 0, net: 0, adv: 0, ss: 0 });

  const change = (i: number, k: keyof Editable, v: number | string) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
    setDirty(true);
  };

  async function act(fn: () => Promise<RunView>, message?: string) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      if (message) toast(message);
      setModal(null);
      reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  }

  const save = () => act(() => payrollApi.updateRun(id, { lines: lines.map(({ notes, ...l }) => ({ ...l, ...(notes ? { notes } : {}) })) }), t('pay_saved'));

  function exportCsv() {
    const head = [t('pay_code'), t('pay_name'), ...NUMBER_FIELDS.map((f) => t(FIELD_LABEL[f])), t('pay_gross'), t('pay_net')];
    const rows = run!.lines.map((l) => [l.code, l.name, ...NUMBER_FIELDS.map((f) => l[f]), l.gross, l.net]);
    downloadCsv(`payroll-${run!.period}-${run!.currency}.csv`, [head, ...rows]);
  }

  const company = settings ? i18n.name(settings.companyName) : '';

  return (
    <div className="stack">
      <div className="row no-print">
        <a className="btn" href={href('payroll')}>{t('pay_back')}</a>
        <span className="spacer" />
        {canEdit && dirty && <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}><Icon name="check" size={16} />{t('pay_save')}</button>}
        {run.actions.includes('post') && !dirty && <button type="button" className="btn primary" disabled={busy} onClick={() => setModal('post')}><Icon name="receipt" size={16} />{t('pay_post')}</button>}
        {run.actions.includes('pay') && <button type="button" className="btn primary" disabled={busy} onClick={() => setModal('pay')}><Icon name="receipt" size={16} />{t('pay_paySalaries')}</button>}
        {run.actions.includes('unpost') && <button type="button" className="btn" disabled={busy} title={t('pay_unpostHelp')} onClick={() => void act(() => payrollApi.unpost(id))}><Icon name="undo" size={16} />{t('pay_unpost')}</button>}
        {run.actions.includes('reverse') && <button type="button" className="btn" disabled={busy} onClick={() => { setActionError(null); setModal('reverse'); }}><Icon name="undo" size={16} />{t('pay_reverse')}</button>}
        <button type="button" className="btn" onClick={() => setPrint('sheet')}><Icon name="printer" size={16} />{t('pay_printSheet')}</button>
        <button type="button" className="btn" onClick={() => setPrint('slips')}><Icon name="printer" size={16} />{t('pay_printSlips')}</button>
        <button type="button" className="btn" onClick={exportCsv}><Icon name="doc" size={16} />{t('pay_exportCsv')}</button>
        {run.actions.includes('cancel') && <button type="button" className="btn danger" onClick={() => setModal('cancel')}><Icon name="undo" size={16} />{t('pay_cancelRun')}</button>}
      </div>
      <ErrorBox error={actionError} />

      {!print && (
        <>
          <div className="grid-4">
            <div className="card pad tile"><div className="label">{t('pay_month')}</div><div className="value num">{i18n.digitsOf(run.period)} <span className="small muted">{run.currency}</span></div><div><RunChip status={run.status} /></div></div>
            <div className="card pad tile"><div className="label">{t('pay_gross')}</div><div className="value num">{i18n.money(totals.gross, run.currency)}</div><div className="small muted">{t('pay_employeesCount', { n: i18n.int(lines.length) })}</div></div>
            <div className="card pad tile"><div className="label">{t('pay_deductions')}</div><div className="value num">{i18n.money(totals.gross - totals.net, run.currency)}</div><div className="small muted">{t('pay_advance')}: {i18n.money(totals.adv, run.currency)}</div></div>
            <div className="card pad tile"><div className="label">{t('pay_net')}</div><div className="value num" style={{ color: 'var(--ok)' }}>{i18n.money(totals.net, run.currency)}</div>
              {run.entry && <div className="small"><a className="ltr num" href={href(`entry/${run.entry.id}`)}>{run.entry.number ?? t('pay_st_draft')}</a></div>}
            </div>
          </div>
          {run.status === 'posted' && (run.payment
            ? <div className="alert ok">{t('pay_paid')}: <a className="ltr num" href={href(`entry/${run.payment.id}`)}>{run.payment.number}</a> · <span className="num">{i18n.date(run.payment.date)}</span></div>
            : !run.actions.includes('pay') && run.entry?.status !== 'approved' && run.entry?.status !== 'reversed' && <div className="alert info">{t('pay_waitApproval')}</div>)}
          <div className="card table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('pay_employee')}</th>
                  {NUMBER_FIELDS.map((f) => <th key={f} className="amount">{t(FIELD_LABEL[f])}</th>)}
                  <th className="amount">{t('pay_net')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const v = byId.get(l.employeeId);
                  return (
                    <tr key={l.employeeId}>
                      <td>
                        <strong>{v?.name}</strong>
                        <div className="muted small">{[v?.code, v?.jobTitle].filter(Boolean).join(' · ')}</div>
                        {!!v?.advanceRemaining && <div className="muted small num">{t('pay_advanceLeft', { a: i18n.money(v.advanceRemaining, run.currency) })}</div>}
                      </td>
                      {NUMBER_FIELDS.map((f) => (
                        <td key={f} className="amount num" style={{ minInlineSize: 110 }}>
                          {canEdit
                            ? <AmountInput value={l[f]} currency={run.currency} onChange={(v2) => change(i, f, v2 ?? 0)} ariaLabel={`${t(FIELD_LABEL[f])} — ${v?.name ?? ''}`} />
                            : (l[f] ? i18n.money(l[f], run.currency) : '—')}
                        </td>
                      ))}
                      <td className="amount num"><strong style={netOf(l) < 0 ? { color: 'var(--bad)' } : undefined}>{i18n.money(netOf(l), run.currency)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th>{t('pay_total')}</th>
                  {NUMBER_FIELDS.map((f) => <th key={f} className="amount num">{i18n.money(lines.reduce((s, l) => s + l[f], 0), run.currency)}</th>)}
                  <th className="amount num">{i18n.money(totals.net, run.currency)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {print === 'sheet' && <Sheet run={run} company={company} />}
      {print === 'slips' && run.lines.map((l, i) => <Slip key={l.employeeId} run={run} line={l} company={company} first={i === 0} />)}

      {modal === 'post' && (
        <Modal title={`${t('pay_post')} — ${i18n.digitsOf(run.period)}`} onClose={() => setModal(null)}>
          <PostForm run={run} busy={busy} defaultRate={settings?.defaultRateX100 ?? 142000}
            onPost={(rateX100) => void act(() => payrollApi.post(id, { lang: i18n.lang, ...(run.currency === 'USD' ? { rateX100 } : {}) }), t('pay_posted'))}
            onCancel={() => setModal(null)} error={actionError} />
        </Modal>
      )}
      {modal === 'pay' && (
        <Modal title={`${t('pay_paySalaries')} — ${i18n.digitsOf(run.period)}`} onClose={() => setModal(null)}>
          <PayForm run={run} busy={busy} error={actionError} onCancel={() => setModal(null)}
            onPay={(body) => void act(async () => {
              const after = await payrollApi.pay(id, { ...body, lang: i18n.lang });
              toast(t('pay_paidDone', { n: after.payment?.number ?? '' }));
              return after;
            })} />
        </Modal>
      )}
      {modal === 'cancel' && (
        <Modal title={t('pay_cancelRun')} onClose={() => setModal(null)}>
          <div className="stack">
            <p style={{ margin: 0 }}>{t('pay_cancelConfirm')}</p>
            <ErrorBox error={actionError} />
            <div className="row">
              <button type="button" className="btn danger" disabled={busy} onClick={() => void act(() => payrollApi.cancel(id), t('pay_st_cancelled'))}>{t('pay_cancelRun')}</button>
              <button type="button" className="btn" onClick={() => setModal(null)}>{t('cancel')}</button>
            </div>
          </div>
        </Modal>
      )}
      {modal === 'reverse' && (
        <ReverseModal title={`${t('pay_reverse')} — ${i18n.digitsOf(run.period)}`} note={t('pay_reverseNote')} action={t('pay_reverse')}
          min={run.date} busy={busy} error={actionError} onClose={() => setModal(null)}
          onReverse={(date) => void act(() => payrollApi.reverseRun(id, { date }), t('pay_reversedDone'))} />
      )}
    </div>
  );
}

function PostForm({ run, busy, defaultRate, onPost, onCancel, error }: {
  run: RunView; busy: boolean; defaultRate: number; onPost(rateX100: number): void; onCancel(): void; error: unknown;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [rate, setRate] = useState(String(rateFromX100(defaultRate)));
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>{t('pay_postHelp')}</p>
      <div className="totals">
        <span>{t('pay_gross')}</span><span>{i18n.money(run.totals.gross, run.currency)}</span>
        <span>{t('pay_advance')}</span><span>{i18n.money(run.totals.advanceDeduction, run.currency)}</span>
        <span>{t('pay_ssShort')}</span><span>{i18n.money(run.totals.socialSecurity, run.currency)}</span>
        <span>{t('pay_otherDeductions')}</span><span>{i18n.money(run.totals.otherDeductions, run.currency)}</span>
        <strong>{t('pay_net')}</strong><strong>{i18n.money(run.totals.net, run.currency)}</strong>
      </div>
      {run.currency === 'USD' && <label className="field"><span>{t('exchangeRate')}</span><input className="input num ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>}
      <ErrorBox error={error} />
      <div className="row">
        <button type="button" className="btn primary" disabled={busy} onClick={() => onPost(parseRate(rate))}><Icon name="check" size={16} />{t('pay_post')}</button>
        <button type="button" className="btn" onClick={onCancel}>{t('cancel')}</button>
      </div>
    </div>
  );
}

function PayForm({ run, busy, error, onPay, onCancel }: {
  run: RunView; busy: boolean; error: unknown; onPay(body: { date: string; cashAccountCode: string; rateX100?: number }): void; onCancel(): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const [date, setDate] = useState(todayIso() < run.date ? run.date : todayIso());
  const [cash, setCash] = useState(settings?.postingAccounts.cash ?? '');
  const [rate, setRate] = useState(String(rateFromX100(settings?.defaultRateX100 ?? 142000)));
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>{t('pay_payHelp')}</p>
      <div className="totals"><strong>{t('pay_net')}</strong><strong>{i18n.money(run.totals.net, run.currency)}</strong></div>
      <div className="grid-2">
        <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <div className="field"><span>{t('cashAccount')}</span><AccountCombo value={cash} onChange={setCash} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} /></div>
        {run.currency === 'USD' && <label className="field"><span>{t('exchangeRate')}</span><input className="input num ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>}
      </div>
      <ErrorBox error={error} />
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !cash || !date}
          onClick={() => onPay({ date, cashAccountCode: cash, ...(run.currency === 'USD' ? { rateX100: parseRate(rate) } : {}) })}>
          <Icon name="check" size={16} />{t('pay_paySalaries')}
        </button>
        <button type="button" className="btn" onClick={onCancel}>{t('cancel')}</button>
      </div>
    </div>
  );
}

/* ---------- printing ---------- */

function Signatures() {
  const { t } = useI18n();
  return (
    <div className="grid-4" style={{ marginBlockStart: 40, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
      {(['pay_signEmployee', 'pay_signAccountant', 'pay_signManager'] as const).map((k) => (
        <div key={k} style={{ borderBlockStart: '1px solid #000', paddingBlockStart: 6, textAlign: 'center' }} className="small">{t(k)}</div>
      ))}
    </div>
  );
}

function Sheet({ run, company }: { run: RunView; company: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <div className="paper">
      <div className="company-line">{company}</div>
      <h2 style={{ margin: '4px 0 16px' }}>{t('pay_sheetTitle', { p: i18n.digitsOf(run.period) })} <span className="muted small">{run.currency}</span></h2>
      <table className="table">
        <thead>
          <tr>
            <th>#</th><th>{t('pay_name')}</th>
            {NUMBER_FIELDS.map((f) => <th key={f} className="amount">{t(FIELD_LABEL[f])}</th>)}
            <th className="amount">{t('pay_net')}</th><th>{t('pay_signEmployee')}</th>
          </tr>
        </thead>
        <tbody>
          {run.lines.map((l, i) => (
            <tr key={l.employeeId}>
              <td className="num">{i18n.int(i + 1)}</td>
              <td>{l.name}<div className="small">{l.jobTitle}</div></td>
              {NUMBER_FIELDS.map((f) => <td key={f} className="amount num">{l[f] ? i18n.money(l[f], run.currency) : '—'}</td>)}
              <td className="amount num"><strong>{i18n.money(l.net, run.currency)}</strong></td>
              <td style={{ minInlineSize: 90 }} />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th /><th>{t('pay_total')}</th>
            {NUMBER_FIELDS.map((f) => <th key={f} className="amount num">{i18n.money(run.lines.reduce((s, l) => s + l[f], 0), run.currency)}</th>)}
            <th className="amount num">{i18n.money(run.totals.net, run.currency)}</th><th />
          </tr>
        </tfoot>
      </table>
      <div className="grid-2" style={{ marginBlockStart: 40 }}>
        {(['pay_signAccountant', 'pay_signManager'] as const).map((k) => (
          <div key={k} style={{ borderBlockStart: '1px solid #000', paddingBlockStart: 6, textAlign: 'center' }} className="small">{t(k)}</div>
        ))}
      </div>
    </div>
  );
}

function Slip({ run, line: l, company, first }: { run: RunView; line: PayLineView; company: string; first: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const m = (v: number) => i18n.money(v, run.currency);
  const earnings: [Key, number][] = [['pay_baseSalary', l.base], ['pay_allowances', l.allowances], ['pay_overtime', l.overtime], ['pay_bonus', l.bonus]];
  const deductions: [Key, number][] = [['pay_absence', l.absence], ['pay_advance', l.advanceDeduction], ['pay_ssShort', l.socialSecurity], ['pay_otherDeductions', l.otherDeductions]];
  return (
    <div className="paper" style={first ? undefined : { breakBefore: 'page', marginBlockStart: 16 }}>
      <div className="company-line">{company}</div>
      <h2 style={{ margin: '4px 0 12px' }}>{t('pay_slipTitle', { p: i18n.digitsOf(run.period) })}</h2>
      <div className="plan-facts" style={{ marginBlockEnd: 16 }}>
        <span className="muted">{t('pay_employee')}</span><strong>{l.name} <span className="num">({l.code})</span></strong>
        {l.jobTitle && <><span className="muted">{t('pay_jobTitle')}</span><span>{l.jobTitle}</span></>}
        {l.department && <><span className="muted">{t('pay_department')}</span><span>{l.department}</span></>}
      </div>
      <div className="grid-2">
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>{t('pay_earnings')}</h3>
          <div className="totals">{earnings.filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><span>{t(k)}</span><span>{m(v)}</span></Fragment>)}</div>
        </div>
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>{t('pay_deductions')}</h3>
          <div className="totals">{deductions.filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><span>{t(k)}</span><span>{m(v)}</span></Fragment>)}</div>
        </div>
      </div>
      <div className="totals" style={{ marginBlockStart: 16, fontSize: 17 }}>
        <strong>{t('pay_net')}</strong><strong>{m(l.net)}</strong>
      </div>
      {l.notes && <p className="small">{l.notes}</p>}
      <Signatures />
    </div>
  );
}

/* ---------- employees ---------- */

function Employees({ canChange, onChange }: { canChange: boolean; onChange(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [q, setQ] = useState('');
  const [showLeft, setShowLeft] = useState(false);
  const { data, error, reload } = useLoad(() => payrollApi.employees({ ...(q.trim() ? { q: q.trim() } : {}), ...(showLeft ? {} : { active: 'true' as const }) }), [q, showLeft]);
  const [editing, setEditing] = useState<EmployeeView | 'new' | null>(null);
  return (
    <div className="stack">
      <div className="row">
        {canChange && <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('pay_newEmployee')}</button>}
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} />{t('pay_showLeft')}</label>
        <span className="spacer" />
        <input className="input" style={{ width: 260 }} type="search" placeholder={t('pay_search')} aria-label={t('pay_search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {data && !data.length && <EmptyState icon="users" title={t('es_employees')} text={t('es_employeesText')} />}
        {data && !!data.length && (
          <table className="table">
            <thead>
              <tr>
                <th>{t('pay_code')}</th><th>{t('pay_name')}</th><th>{t('pay_department')}</th>
                <th className="amount">{t('pay_baseSalary')}</th><th className="amount">{t('pay_allowances')}</th><th className="amount">{t('pay_remaining')}</th><th />
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className={canChange ? 'click' : undefined} onClick={canChange ? () => setEditing(e) : undefined}>
                  <td className="num ltr">{e.code}</td>
                  <td><strong>{e.name}</strong>{e.jobTitle && <div className="muted small">{e.jobTitle}</div>}</td>
                  <td>{e.department || '—'}</td>
                  <td className="amount num">{i18n.money(e.baseSalary, e.currency)}</td>
                  <td className="amount num">{e.allowances ? i18n.money(e.allowances, e.currency) : '—'}</td>
                  <td className="amount num">{e.advanceRemaining ? i18n.money(e.advanceRemaining, e.currency) : '—'}</td>
                  <td>{!e.active && <span className="chip">{t('pay_left')}</span>}{e.socialSecurity && <span className="chip info">{t('pay_ssShort')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && <EmployeeModal employee={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); onChange(); }} />}
    </div>
  );
}

function EmployeeModal({ employee: e, onClose, onDone }: { employee: EmployeeView | null; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [v, setV] = useState<EmployeeInput>(() => e ? {
    code: e.code, name: e.name, jobTitle: e.jobTitle, department: e.department, phone: e.phone, idNumber: e.idNumber, hireDate: e.hireDate,
    endDate: e.endDate, currency: e.currency, baseSalary: e.baseSalary, allowances: e.allowances, socialSecurity: e.socialSecurity,
    bankAccount: e.bankAccount, active: e.active, notes: e.notes
  } : { name: '', currency: 'IQD', baseSalary: 0, allowances: 0, socialSecurity: false, active: true, hireDate: todayIso() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const text = (k: keyof EmployeeInput) => (ev: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [k]: ev.target.value }));
  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(message);
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  const body: EmployeeInput = { ...v, hireDate: v.hireDate || null, endDate: v.endDate || null };
  return (
    <Modal title={e ? `${t('pay_editEmployee')} — ${e.name}` : t('pay_newEmployee')} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <label className="field"><span>{t('pay_name')}</span><input className="input" maxLength={200} value={v.name} onChange={text('name')} autoFocus /></label>
          <label className="field"><span>{t('pay_code')}</span><input className="input ltr" maxLength={32} value={v.code ?? ''} onChange={text('code')} placeholder="E-0001" /></label>
          <label className="field"><span>{t('pay_jobTitle')}</span><input className="input" maxLength={200} value={v.jobTitle ?? ''} onChange={text('jobTitle')} /></label>
          <label className="field"><span>{t('pay_department')}</span><input className="input" maxLength={200} value={v.department ?? ''} onChange={text('department')} /></label>
          <label className="field"><span>{t('currency')}</span>
            <select className="input" value={v.currency} disabled={!!e?.hasHistory} onChange={(ev) => setV((x) => ({ ...x, currency: ev.target.value as CurrencyCode }))}>
              <option value="IQD">IQD</option><option value="USD">USD</option>
            </select>
          </label>
          <label className="field"><span>{t('pay_baseSalary')}</span><AmountInput value={v.baseSalary} currency={v.currency} onChange={(n) => setV((x) => ({ ...x, baseSalary: n ?? 0 }))} ariaLabel={t('pay_baseSalary')} /></label>
          <label className="field"><span>{t('pay_allowances')} <span className="muted small">{t('pay_allowancesHelp')}</span></span><AmountInput value={v.allowances ?? 0} currency={v.currency} onChange={(n) => setV((x) => ({ ...x, allowances: n ?? 0 }))} ariaLabel={t('pay_allowances')} /></label>
          <label className="field"><span>{t('phone')}</span><input className="input ltr" maxLength={50} value={v.phone ?? ''} onChange={text('phone')} /></label>
          <label className="field"><span>{t('pay_hireDate')}</span><input className="input" type="date" value={v.hireDate ?? ''} onChange={text('hireDate')} /></label>
          <label className="field"><span>{t('pay_idNumber')}</span><input className="input ltr" maxLength={50} value={v.idNumber ?? ''} onChange={text('idNumber')} /></label>
          <label className="field"><span>{t('pay_bankAccount')}</span><input className="input ltr" maxLength={100} value={v.bankAccount ?? ''} onChange={text('bankAccount')} /></label>
          {e && <label className="field"><span>{t('pay_endDate')}</span><input className="input" type="date" value={v.endDate ?? ''} onChange={text('endDate')} /></label>}
        </div>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!v.socialSecurity} onChange={(ev) => setV((x) => ({ ...x, socialSecurity: ev.target.checked }))} />{t('pay_socialSecurity')}</label>
        {e && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={v.active !== false} onChange={(ev) => setV((x) => ({ ...x, active: ev.target.checked }))} />{t('pay_active')}</label>}
        <label className="field"><span>{t('notes')}</span><textarea className="input" rows={2} maxLength={1000} value={v.notes ?? ''} onChange={text('notes')} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !v.name.trim()}
            onClick={() => void run(() => (e ? payrollApi.updateEmployee(e.id, body) : payrollApi.createEmployee(body)), t('pay_saved'))}>
            <Icon name="check" size={16} />{t('pay_save')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <span className="spacer" />
          {e && !e.hasHistory && <button type="button" className="btn danger" disabled={busy} title={t('pay_deleteHelp')} onClick={() => void run(() => payrollApi.deleteEmployee(e.id), t('pay_saved'))}>{t('pay_delete')}</button>}
        </div>
      </div>
    </Modal>
  );
}

/* ---------- advances ---------- */

function Advances({ canChange, onChange }: { canChange: boolean; onChange(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [openOnly, setOpenOnly] = useState(false);
  const { data, error, reload } = useLoad(() => payrollApi.advances(openOnly ? { open: 'true' } : {}), [openOnly]);
  const [paying, setPaying] = useState(false);
  return (
    <div className="stack">
      <div className="row">
        {canChange && <button type="button" className="btn primary" onClick={() => setPaying(true)}><Icon name="plus" size={16} />{t('pay_newAdvance')}</button>}
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />{t('pay_openOnly')}</label>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {data && !data.length && <div className="pad muted">{t('pay_noAdvances')}</div>}
        {data && !!data.length && (
          <table className="table">
            <thead>
              <tr>
                <th>{t('date')}</th><th>{t('pay_employee')}</th><th className="amount">{t('pay_advanceAmount')}</th><th className="amount">{t('pay_monthly')}</th>
                <th className="amount">{t('pay_taken')}</th><th className="amount">{t('pay_remaining')}</th><th>{t('pay_voucher')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((a: AdvanceView) => (
                <tr key={a.id}>
                  <td className="num">{i18n.date(a.date)}</td>
                  <td>{a.employeeName} <span className="muted small num">{a.employeeCode}</span></td>
                  <td className="amount num">{i18n.money(a.amount, a.currency)}</td>
                  <td className="amount num">{i18n.money(a.monthly, a.currency)}</td>
                  <td className="amount num">{i18n.money(a.taken, a.currency)}</td>
                  <td className="amount num"><strong>{i18n.money(a.remaining, a.currency)}</strong></td>
                  <td>{a.entry ? <a className="ltr num" href={href(`entry/${a.entry.id}`)}>{a.entry.number}</a> : '—'}{a.reversed && <span className="chip bad">{t('pay_reversed')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {paying && <AdvanceModal onClose={() => setPaying(false)} onDone={() => { setPaying(false); reload(); onChange(); }} />}
    </div>
  );
}

function AdvanceModal({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings } = useData();
  const { data: employees } = useLoad(() => payrollApi.employees({ active: 'true' }), []);
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState<number | null>(null);
  const [monthly, setMonthly] = useState<number | null>(null);
  const [cash, setCash] = useState(settings?.postingAccounts.cash ?? '');
  const [rate, setRate] = useState(String(rateFromX100(settings?.defaultRateX100 ?? 142000)));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const emp = employees?.find((e) => e.id === employeeId);
  const currency: CurrencyCode = emp?.currency ?? 'IQD';
  const options: PickOption[] = (employees ?? []).map((e): PickOption => ({ id: e.id, code: e.code, label: e.name, ...(e.department ? { hint: e.department } : {}), search: [e.phone, e.jobTitle].join(' ') }));
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const a = await payrollApi.payAdvance({
        employeeId, date, amount: amount ?? 0, monthly: monthly ?? 0, cashAccountCode: cash, lang: i18n.lang,
        ...(currency === 'USD' ? { rateX100: parseRate(rate) } : {}), ...(notes.trim() ? { notes } : {})
      });
      toast(t('pay_advancePaid', { n: a.entry?.number ?? '' }));
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <Modal title={t('pay_newAdvance')} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('pay_advanceHelp')}</p>
        <div className="field"><span>{t('pay_employee')}</span><SearchCombo value={employeeId} options={options} onChange={setEmployeeId} placeholder={t('pay_employee')} /></div>
        <div className="grid-2">
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <div className="field"><span>{t('cashAccount')}</span><AccountCombo value={cash} onChange={setCash} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} /></div>
          <label className="field"><span>{t('pay_advanceAmount')}</span><AmountInput value={amount} currency={currency} onChange={setAmount} ariaLabel={t('pay_advanceAmount')} /></label>
          <label className="field"><span>{t('pay_monthly')}</span><AmountInput value={monthly} currency={currency} onChange={setMonthly} ariaLabel={t('pay_monthly')} /></label>
          {currency === 'USD' && <label className="field"><span>{t('exchangeRate')}</span><input className="input num ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>}
        </div>
        <label className="field"><span>{t('notes')}</span><input className="input" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !employeeId || !amount || !monthly || !cash} onClick={() => void submit()}><Icon name="check" size={16} />{t('pay_newAdvance')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}
