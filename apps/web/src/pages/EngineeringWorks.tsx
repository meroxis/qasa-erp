import { useEffect, useMemo, useState } from 'react';
import { amountInWords, formatQty, lineAmount, rateFromX100, todayIso, toBase, toWesternDigits, type CurrencyCode } from '@qasa/core';
import { api, ApiError } from '../api.ts';
import { EmptyState, AccountCombo, AmountInput, ErrorBox, Icon, Modal, QtyInput, SearchCombo, useData, useLoad, usePageNav, useToast, type PickOption } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import {
  COST_CATEGORIES, JOB_CATEGORIES, JOB_FLOW, LINE_UNITS, worksApi, type CostCategory, type JobCategory, type JobFilter, type JobInput, type JobLineInput,
  type JobStatus, type JobSummaryView, type JobView, type LinkableDocView, type LineUnit, type WorksSummaryView
} from '../industry/works-api.ts';
import { go, href } from '../router.ts';

/**
 * الأعمال الهندسية (Pro): job orders for welding, steelwork, aluminium, MDF, doors and windows — the measured quote, the
 * job's stages from measuring to installing, deposits, costs, profit, and the invoice on delivery. Routes: `works` (the
 * jobs) and `job/:id` (one job, with its printable quotation).
 */

const STATUS_CHIP: Record<JobStatus, string> = {
  quote: '', measuring: 'info', approved: 'info', fabricating: 'warn', installing: 'warn', done: 'ok', invoiced: 'ok', cancelled: 'bad'
};
const st = (s: JobStatus) => `ew_st_${s}` as Key;
const cat = (c: JobCategory) => `ew_cat_${c}` as Key;
const unitKey = (u: LineUnit) => `ew_u_${u}` as Key;
const costKey = (c: CostCategory) => `ew_c_${c}` as Key;

function JobChip({ status }: { status: JobStatus }) {
  const { t } = useI18n();
  return <span className={'chip ' + STATUS_CHIP[status]}>{t(st(status))}</span>;
}

/** IQD, and dollars beside when there are any. */
function money2(i18n: I18n, m: { IQD: number; USD: number }): string {
  return m.USD ? `${i18n.money(m.IQD, 'IQD')} · ${i18n.money(m.USD, 'USD')}` : i18n.money(m.IQD, 'IQD');
}

const isAbsent = (e: unknown) => e instanceof ApiError && e.status === 404 && !(e.details as { what?: string } | null)?.what;

function NotAvailable() {
  const { t } = useI18n();
  return <div className="alert info">{t('ew_notAvailable')}</div>;
}

/* ---------- the jobs ---------- */

export function EngineeringWorks() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [filter, setFilter] = useState<JobFilter | ''>('open');
  const [category, setCategory] = useState<JobCategory | ''>('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'board' | 'list'>('board');
  const [creating, setCreating] = useState(false);
  const [summary, setSummary] = useState<WorksSummaryView | null>(null);
  const [absent, setAbsent] = useState(false);
  const { data, error } = useLoad(
    () => worksApi.jobs({ ...(filter && view === 'list' ? { status: filter } : {}), ...(category ? { category } : {}), ...(q.trim() ? { q: q.trim() } : {}) }),
    [filter, category, q, view]
  );

  useEffect(() => {
    worksApi.summary().then(setSummary, (e) => { if (isAbsent(e)) setAbsent(true); });
  }, []);
  if (absent) return <NotAvailable />;

  const tiles = summary ? [
    { label: t('ew_tileOpen'), value: i18n.int(summary.open), sub: '' },
    { label: t('ew_tileProgress'), value: money2(i18n, summary.inProgress), sub: `${t('ew_tileCollect')}: ${money2(i18n, summary.toCollect)}` },
    { label: t('ew_tileOverdue'), value: i18n.int(summary.overdue), sub: '', bad: summary.overdue > 0 },
    { label: t('ew_tileProfit'), value: i18n.money(summary.month.profit, 'IQD'), sub: t('ew_tileBilled', { n: summary.month.jobs }), bad: summary.month.profit < 0 }
  ] : [];

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('ew_help')}</p>
      {summary && !summary.available && <div className="alert">{t('ew_needsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      {summary && (
        <div className="grid-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="card pad tile">
              <div className="label">{tile.label}</div>
              <div className="value num" style={tile.bad ? { color: 'var(--bad)' } : undefined}>{tile.value}</div>
              {tile.sub && <div className="small muted num">{tile.sub}</div>}
            </div>
          ))}
        </div>
      )}
      <div className="row">
        {summary?.available && <button type="button" className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />{t('ew_new')}</button>}
        <div className="track">
          <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}>{t('ew_board')}</button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>{t('ew_list')}</button>
        </div>
        <span className="spacer" />
        <select className="input" style={{ width: 'auto' }} aria-label={t('ew_category')} value={category} onChange={(e) => setCategory(e.target.value as JobCategory | '')}>
          <option value="">{t('ew_category')}: {t('all')}</option>
          {JOB_CATEGORIES.map((c) => <option key={c} value={c}>{t(cat(c))}</option>)}
        </select>
        <input className="input" style={{ width: 220 }} type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {view === 'list' && (
        <div className="row">
          <div className="track" role="group" aria-label={t('ew_jobs')}>
            {(['', 'open', 'overdue', ...JOB_FLOW, 'invoiced', 'cancelled'] as const).map((s) => (
              <button key={s || 'all'} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}>
                {s === '' ? t('all') : s === 'open' ? t('ew_f_open') : s === 'overdue' ? t('ew_f_overdue') : t(st(s))}
              </button>
            ))}
          </div>
        </div>
      )}
      <ErrorBox error={error && !isAbsent(error) ? error : null} />
      {data && (view === 'board' ? <Board jobs={data} /> : <div className="card table-wrap"><JobsTable jobs={data} /></div>)}
      {creating && <JobModal onClose={() => setCreating(false)} onDone={(job) => { setCreating(false); toast(t('ew_created', { n: job.number })); go(`job/${job.id}`); }} />}
    </div>
  );
}

/** The workshop board: a column per stage from the quote to done. */
function Board({ jobs }: { jobs: JobSummaryView[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!jobs.length) return <div className="card"><EmptyState icon="tool" title={t('es_jobs')} text={t('es_jobsText')} /></div>;
  return (
    <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(220px, 1fr)', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
      {JOB_FLOW.map((s) => {
        const col = jobs.filter((j) => j.status === s);
        return (
          <section key={s} className="card" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 120 }} aria-label={t(st(s))}>
            <div className="row" style={{ gap: 6 }}><JobChip status={s} /><span className="count">{i18n.int(col.length)}</span></div>
            {col.map((j) => (
              <a key={j.id} href={href(`job/${j.id}`)} className="card" style={{ padding: 10, textDecoration: 'none', color: 'inherit', display: 'block', boxShadow: 'none' }}>
                <div style={{ fontWeight: 600 }}>{j.title}</div>
                <div className="small muted">{j.party.name} · {t(cat(j.category))}</div>
                <div className="row small" style={{ marginTop: 4, gap: 6 }}>
                  <span className="ltr num muted">{j.number}</span>
                  <span className="spacer" />
                  <span className="num">{i18n.money(j.total, j.currency)}</span>
                </div>
                {j.overdue && j.dueDate && <div className="small" style={{ color: 'var(--bad)' }}>{t('ew_lateDays', { n: daysSince(j.dueDate) })}</div>}
              </a>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function daysSince(iso: string): number {
  return Math.max(0, Math.round((Date.parse(todayIso() + 'T00:00:00Z') - Date.parse(iso + 'T00:00:00Z')) / 86_400_000));
}

function JobsTable({ jobs }: { jobs: JobSummaryView[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!jobs.length) return <EmptyState icon="tool" title={t('es_jobs')} text={t('es_jobsText')} />;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{t('ew_job')}</th><th>{t('customer')}</th><th>{t('ew_work')}</th><th>{t('ew_dueDate')}</th>
          <th className="amount">{t('ew_total')}</th><th className="amount">{t('ew_remaining')}</th><th className="amount">{t('ew_profit')}</th><th />
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id} className="click" onClick={() => go(`job/${j.id}`)}>
            <td><a className="ltr num" href={href(`job/${j.id}`)} onClick={(e) => e.stopPropagation()}>{j.number}</a><div className="muted small num">{i18n.date(j.date)}</div></td>
            <td>{j.party.name}</td>
            <td>{j.title}<div className="muted small">{t(cat(j.category))}{j.site ? ` · ${j.site}` : ''}</div></td>
            <td className="num">{j.dueDate ? i18n.date(j.dueDate) : '—'}{j.overdue && j.dueDate && <div className="small" style={{ color: 'var(--bad)' }}>{t('ew_lateDays', { n: daysSince(j.dueDate) })}</div>}</td>
            <td className="amount">{i18n.money(j.total, j.currency)}</td>
            <td className="amount">{i18n.money(j.remaining, j.currency)}</td>
            <td className="amount" style={j.profit !== null && j.profit < 0 ? { color: 'var(--bad)' } : undefined}>{j.profit === null ? '—' : i18n.money(j.profit, 'IQD')}</td>
            <td><JobChip status={j.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------- new job / edit the job's details ---------- */

function useCustomers(): PickOption[] {
  const customers = useLoad(() => api.parties({ type: 'customer', active: 'true' }), []);
  return useMemo(() => (customers.data ?? []).map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone })), [customers.data]);
}

function JobModal({ job, onClose, onDone }: { job?: JobView; onClose(): void; onDone(job: JobView): void }) {
  const { t } = useI18n();
  const customers = useCustomers();
  const quoteOpen = !job || job.actions.includes('editLines');
  const [form, setForm] = useState({
    date: job?.date ?? todayIso(), partyId: job?.party.id ?? '', title: job?.title ?? '', category: job?.category ?? ('steel' as JobCategory),
    site: job?.site ?? '', currency: (job?.currency ?? 'IQD') as CurrencyCode, dueDate: job?.dueDate ?? '', assignedTo: job?.assignedTo ?? '', notes: job?.notes ?? ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body: Partial<JobInput> = {
        date: form.date, title: form.title, category: form.category, site: form.site, dueDate: form.dueDate || null, assignedTo: form.assignedTo, notes: form.notes,
        ...(quoteOpen ? { partyId: form.partyId, currency: form.currency } : {})
      };
      onDone(job ? await worksApi.update(job.id, body) : await worksApi.create({ ...(body as JobInput), lines: [], discount: 0 }));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={job ? `${t('ew_editJob')} — ${job.number}` : t('ew_new')} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>{t('ew_work')}</span><input className="input" maxLength={200} placeholder={t('ew_workPh')} value={form.title} onChange={(e) => set('title', e.target.value)} /></label>
        <div className="grid-2">
          <div className="field">
            <span>{t('customer')}</span>
            {quoteOpen
              ? <SearchCombo value={form.partyId} options={customers} onChange={(v) => set('partyId', v)} placeholder={t('ew_pickCustomer')} ariaLabel={t('customer')} />
              : <input className="input" disabled value={job?.party.name ?? ''} />}
            {!job && <span className="small muted">{t('ew_customerHint')}</span>}
          </div>
          <label className="field"><span>{t('ew_category')}</span>
            <select className="input" value={form.category} onChange={(e) => set('category', e.target.value as JobCategory)}>
              {JOB_CATEGORIES.map((c) => <option key={c} value={c}>{t(cat(c))}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('ew_site')}</span><input className="input" maxLength={300} value={form.site} onChange={(e) => set('site', e.target.value)} /></label>
          <label className="field"><span>{t('ew_assignedTo')}</span><input className="input" maxLength={200} value={form.assignedTo} onChange={(e) => set('assignedTo', e.target.value)} /></label>
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></label>
          <label className="field"><span>{t('ew_dueDate')}</span><input className="input" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></label>
          {quoteOpen && (
            <label className="field"><span>{t('currency')}</span>
              <select className="input" value={form.currency} onChange={(e) => set('currency', e.target.value as CurrencyCode)}>
                <option value="IQD">IQD</option><option value="USD">USD</option>
              </select>
            </label>
          )}
        </div>
        <label className="field"><span>{t('notes')}</span><textarea className="input" rows={2} maxLength={2000} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !form.title.trim() || (quoteOpen && !form.partyId)} onClick={() => void submit()}>{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- one job ---------- */

const JOB_NAV = { key: 'ew_jobs' as Key, group: 'gIndustry' as Key };

export function JobDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, reloadAccounts } = useData();
  usePageNav(JOB_NAV);
  const { data, error, reload } = useLoad(() => worksApi.job(id), [id]);
  const [modal, setModal] = useState<'edit' | 'deposit' | 'cost' | 'bill' | 'cancel' | null>(null);
  const [validDays, setValidDays] = useState(15);
  const [terms, setTerms] = useState('');
  const [busy, setBusy] = useState(false);
  const [moveError, setMoveError] = useState<unknown>(null);

  useEffect(() => { setTerms(t('ew_termsDefault')); }, [i18n.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return isAbsent(error) ? <NotAvailable /> : <ErrorBox error={error} />;
  if (!data) return null;
  const j = data;
  const company = settings ? i18n.name(settings.companyName) : '';
  const rate = settings?.defaultRateX100 ?? 142000;
  const estimate = toBase(j.total, j.currency, rate) - j.costs;

  const done = async (message?: string) => {
    setModal(null);
    await reloadAccounts();
    if (message) toast(message);
    reload();
  };

  async function move(to: JobStatus) {
    setBusy(true);
    setMoveError(null);
    try {
      await worksApi.move(j.id, to);
      toast(t('ew_moved', { s: t(st(to)) }));
      reload();
    } catch (e) {
      setMoveError(e);
    }
    setBusy(false);
  }

  const step = JOB_FLOW.indexOf(j.status);
  const back = step > 0 ? JOB_FLOW[step - 1]! : null;
  const forward = j.moves.filter((s) => JOB_FLOW.indexOf(s) > step);

  return (
    <div className="stack" style={{ maxWidth: 1080 }}>
      <div className="row no-print">
        <button type="button" className="btn" onClick={() => history.back()}>{t('back')}</button>
        <span className="spacer" />
        {j.actions.includes('deposit') && <button type="button" className="btn" onClick={() => setModal('deposit')}><Icon name="receipt" size={16} />{t('ew_deposit')}</button>}
        {/* a solar or electrical system is sold from its own page, which moves its panels and parts out of stock */}
        {j.actions.includes('invoice') && (j.system
          ? <a className="btn primary" href={href(`solar-system/${j.id}`)}><Icon name="invoice" size={16} />{t('sl_sell')}</a>
          : <button type="button" className="btn primary" onClick={() => setModal('bill')}><Icon name="invoice" size={16} />{t('ew_bill')}</button>)}
        {j.actions.includes('edit') && <button type="button" className="btn" onClick={() => setModal('edit')}><Icon name="edit" size={16} />{t('ew_editJob')}</button>}
        <button type="button" className="btn" onClick={() => window.print()}><Icon name="printer" size={16} />{t('ew_print')}</button>
        {j.actions.includes('cancel') && <button type="button" className="btn danger" onClick={() => setModal('cancel')}><Icon name="x" size={16} />{t('ew_cancelJob')}</button>}
      </div>

      {/* the stages, with the moves allowed from here */}
      <div className="card pad no-print stack" style={{ gap: 10 }}>
        <ol className="row" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6, flexWrap: 'wrap' }} aria-label={t('ew_job')}>
          {[...JOB_FLOW, ...(j.status === 'invoiced' || j.status === 'cancelled' ? [j.status] : [])].map((s, i) => {
            const here = s === j.status;
            const passed = j.status === 'invoiced' || (step >= 0 && i < step);
            return (
              <li key={s} aria-current={here ? 'step' : undefined} className={'chip ' + (here ? STATUS_CHIP[s] || 'info' : passed ? 'ok' : '')} style={here ? { fontWeight: 700 } : { opacity: passed || here ? 1 : 0.6 }}>
                {passed && !here && <Icon name="check" size={13} />}{t(st(s))}
              </li>
            );
          })}
        </ol>
        {(forward.length > 0 || (back && j.moves.includes(back))) && (
          <div className="row" style={{ gap: 8 }}>
            {forward.length > 0 && <span className="muted small">{t('ew_moveTo')}:</span>}
            {forward.map((s, i) => (
              <button key={s} type="button" className={'btn small' + (i === 0 ? ' primary' : '')} disabled={busy} onClick={() => void move(s)}>{t(st(s))}</button>
            ))}
            <span className="spacer" />
            {back && j.moves.includes(back) && <button type="button" className="btn small" disabled={busy} onClick={() => void move(back)}><Icon name="undo" size={14} />{t('ew_stepBack', { s: t(st(back)) })}</button>}
          </div>
        )}
        <ErrorBox error={moveError} />
      </div>

      <div className="grid-4 no-print">
        <div className="card pad tile"><div className="label">{t('ew_total')}</div><div className="value num">{i18n.money(j.total, j.currency)}</div></div>
        <div className="card pad tile"><div className="label">{t('ew_paid')}</div><div className="value num" style={{ color: 'var(--ok)' }}>{i18n.money(j.paid, j.currency)}</div><div className="small muted num">{t('ew_remaining')}: {i18n.money(j.remaining, j.currency)}</div></div>
        <div className="card pad tile"><div className="label">{t('ew_costTotal')}</div><div className="value num">{i18n.money(j.costs, 'IQD')}</div></div>
        <div className="card pad tile">
          <div className="label">{t('ew_profit')}</div>
          {j.profit === null
            ? <><div className="value num muted">—</div><div className="small muted num">{t('ew_profitLater')} · {t('ew_estimate', { a: i18n.money(estimate, 'IQD') })}</div></>
            : <><div className="value num" style={{ color: j.profit < 0 ? 'var(--bad)' : 'var(--ok)' }}>{i18n.money(j.profit, 'IQD')}</div><div className="small muted num">{t('ew_revenue')}: {i18n.money(j.revenue ?? 0, 'IQD')}</div></>}
        </div>
      </div>

      <Quotation job={j} company={company} validDays={validDays} terms={terms} onSaved={() => void done(t('saved'))} />

      <div className="card pad no-print grid-2">
        <label className="field"><span>{t('ew_validDays')}</span><input className="input num" type="number" min={1} max={365} value={validDays} onChange={(e) => setValidDays(Math.max(1, Number(e.target.value) || 1))} /></label>
        <label className="field"><span>{t('ew_terms')}</span><textarea className="input" rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} /></label>
      </div>

      <div className="grid-2 no-print" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="row" style={{ padding: '14px 16px 6px' }}>
            <h2 style={{ margin: 0 }}>{t('ew_deposits')}</h2><span className="spacer" />
            {j.actions.includes('deposit') && <button type="button" className="btn small" onClick={() => setModal('deposit')}><Icon name="plus" size={14} />{t('ew_deposit')}</button>}
          </div>
          {j.receipts.length === 0 ? <div className="pad muted small">—</div> : (
            <table className="table">
              <tbody>
                {j.receipts.map((r) => (
                  <tr key={r.entryId} className="click" onClick={() => go(`entry/${r.entryId}`)}>
                    <td><a className="ltr num" href={href(`entry/${r.entryId}`)} onClick={(e) => e.stopPropagation()}>{r.number}</a></td>
                    <td className="num">{i18n.date(r.date)}</td>
                    <td className="amount">{i18n.money(r.amount, j.currency)}</td>
                    <td>{r.reversed && <span className="chip bad">{t('reversedTag')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {j.invoice && (
            <div className="pad small" style={{ borderTop: '1px solid var(--line)' }}>
              {t('ew_billed')}: <a className="ltr num" href={href(`invoice/${j.invoice.id}`)}>{j.invoice.number}</a>
            </div>
          )}
        </div>

        <div className="card">
          <div className="row" style={{ padding: '14px 16px 6px' }}>
            <h2 style={{ margin: 0 }}>{t('ew_costs')}</h2><span className="spacer" />
            {j.actions.includes('costs') && <button type="button" className="btn small" onClick={() => setModal('cost')}><Icon name="plus" size={14} />{t('ew_addCost')}</button>}
          </div>
          {j.costLines.length === 0 ? <div className="pad muted small">{t('ew_noCosts')}</div> : (
            <table className="table">
              <tbody>
                {j.costLines.map((c) => {
                  const path = c.document.kind === 'invoice' ? `invoice/${c.document.id}` : `entry/${c.document.id}`;
                  return (
                    <tr key={c.id}>
                      <td><span className="chip">{t(costKey(c.category))}</span>{c.description && <div className="small muted">{c.description}</div>}</td>
                      <td><a className="ltr num" href={href(path)}>{c.document.number ?? '—'}</a><div className="small muted num">{i18n.date(c.document.date)}</div></td>
                      <td className="amount">
                        <span style={c.counted ? undefined : { textDecoration: 'line-through' }}>{i18n.money(c.amount, 'IQD')}</span>
                        {!c.counted && <div className="small muted">{t('ew_costNotCounted')}</div>}
                      </td>
                      <td style={{ width: 44 }}>
                        {j.actions.includes('costs') && (
                          <RemoveCost jobId={j.id} costId={c.id} onDone={() => void done(t('saved'))} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modal === 'edit' && <JobModal job={j} onClose={() => setModal(null)} onDone={() => void done(t('saved'))} />}
      {modal === 'deposit' && <DepositModal job={j} onClose={() => setModal(null)} onDone={(n) => void done(t('ew_depositDone', { n }))} />}
      {modal === 'cost' && <CostModal job={j} onClose={() => setModal(null)} onDone={() => void done(t('saved'))} />}
      {modal === 'bill' && <BillModal job={j} onClose={() => setModal(null)} onDone={() => void done(t('ew_st_invoiced'))} />}
      {modal === 'cancel' && <CancelModal job={j} onClose={() => setModal(null)} onDone={() => void done(t('ew_st_cancelled'))} />}
    </div>
  );
}

function RemoveCost({ jobId, costId, onDone }: { jobId: string; costId: string; onDone(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn icon danger" aria-label={t('ew_removeCost')} title={t('ew_removeCost')} disabled={busy}
      onClick={() => {
        setBusy(true);
        worksApi.removeCost(jobId, costId).then(onDone, () => { setBusy(false); toast(t('err_internal')); });
      }}>
      <Icon name="x" size={16} />
    </button>
  );
}

/* ---------- the quotation: lines editor on screen, عرض سعر on paper ---------- */

interface Row extends JobLineInput { key: number }
let rowKey = 0;
const toRows = (lines: JobLineInput[]): Row[] => lines.map((l) => ({ ...l, key: ++rowKey }));
const emptyRow = (): Row => ({ key: ++rowKey, description: '', unit: 'm2', qtyMilli: 0, unitPrice: 0 });

function Quotation({ job: j, company, validDays, terms, onSaved }: { job: JobView; company: string; validDays: number; terms: string; onSaved(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const editable = j.actions.includes('editLines');
  const [rows, setRows] = useState<Row[]>(() => toRows(j.lines));
  const [discount, setDiscount] = useState<number | null>(j.discount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { setRows(toRows(j.lines)); setDiscount(j.discount); }, [j]);

  const subtotal = rows.reduce((s, r) => s + lineAmount(r.qtyMilli || 0, r.unitPrice || 0), 0);
  const total = subtotal - (discount ?? 0);
  const dirty = JSON.stringify(rows.map(({ key: _k, ...r }) => r)) !== JSON.stringify(j.lines.map(({ seq: _s, amount: _a, ...r }) => r)) || (discount ?? 0) !== j.discount;
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await worksApi.update(j.id, {
        lines: rows.filter((r) => r.description.trim() || r.qtyMilli || r.unitPrice).map(({ key: _k, ...r }) => ({ ...r, qtyMilli: r.qtyMilli || 0, unitPrice: r.unitPrice || 0 })),
        discount: discount ?? 0
      });
      onSaved();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  return (
    <div className="paper">
      <div className="paper-head">
        <div style={{ flex: 1 }}>
          <div className="company-line">{company}</div>
          <div className="paper-title">{t('ew_quotation')}</div>
          <div className="no-print" style={{ marginTop: 4 }}><JobChip status={j.status} /></div>
        </div>
        <div className="paper-meta">
          <span className="muted">{t('number')}</span><strong className="ltr">{j.number}</strong>
          <span className="muted">{t('date')}</span><strong className="num">{i18n.date(j.date)}</strong>
          {j.dueDate && <><span className="muted">{t('ew_dueDate')}</span><strong className="num">{i18n.date(j.dueDate)}</strong></>}
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 12 }}>
        <div>
          <div className="muted small">{t('ew_to')}</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}><a href={href(`party/${j.party.id}`)}>{j.party.name}</a></div>
          {j.party.phone && <div className="small"><span className="ltr">{i18n.digitsOf(j.party.phone)}</span></div>}
          {j.party.address && <div className="small">{j.party.address}</div>}
        </div>
        <div>
          <div className="muted small">{t('ew_work')}</div>
          <div style={{ fontWeight: 700 }}>{j.title}</div>
          <div className="small">{t(cat(j.category))}{j.site ? ` · ${j.site}` : ''}</div>
          {j.assignedTo && <div className="small no-print muted">{t('ew_assignedTo')}: {j.assignedTo}</div>}
        </div>
      </div>

      <div className="row no-print" style={{ marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>{t('ew_lines')}</h3>
        <span className="spacer" />
        <span className="small muted">{editable ? t('ew_linesHelp') : t('ew_locked')}</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>{t('ew_description')}</th>
              <th style={{ width: 120 }}>{t('ew_unit')}</th>
              <th className="amount" style={{ width: 120 }}>{t('qty')}</th>
              <th className="amount" style={{ width: 160 }}>{t('unitPrice')}</th>
              <th className="amount">{t('amount')}</th>
              {editable && <th className="no-print" style={{ width: 44 }} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td className="muted num">{i18n.int(i + 1)}</td>
                {editable ? (
                  <>
                    <td><input className="input" maxLength={500} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} aria-label={t('ew_description')} /></td>
                    <td>
                      <select className="input" value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value as LineUnit })} aria-label={t('ew_unit')}>
                        {LINE_UNITS.map((u) => <option key={u} value={u}>{t(unitKey(u))}</option>)}
                      </select>
                    </td>
                    <td><QtyInput value={r.qtyMilli || null} onChange={(v) => update(r.key, { qtyMilli: v ?? 0 })} ariaLabel={t('qty')} /></td>
                    <td><AmountInput value={r.unitPrice || null} currency={j.currency} onChange={(v) => update(r.key, { unitPrice: v ?? 0 })} ariaLabel={t('unitPrice')} /></td>
                  </>
                ) : (
                  <>
                    <td>{r.description}</td>
                    <td>{t(unitKey(r.unit))}</td>
                    <td className="amount">{i18n.digitsOf(formatQty(r.qtyMilli))}</td>
                    <td className="amount">{i18n.money(r.unitPrice, j.currency)}</td>
                  </>
                )}
                <td className="amount">{i18n.money(lineAmount(r.qtyMilli || 0, r.unitPrice || 0), j.currency)}</td>
                {editable && (
                  <td className="no-print">
                    <button type="button" className="btn icon danger" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={t('removeLine')} title={t('removeLine')}><Icon name="x" size={16} /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ padding: '10px 0', alignItems: 'flex-start' }}>
        {editable && <button type="button" className="btn small no-print" onClick={() => setRows((rs) => [...rs, emptyRow()])}><Icon name="plus" size={15} />{t('addLine')}</button>}
        <span className="spacer" />
        <div className="totals">
          <span className="muted">{t('subtotal')}</span><strong className="num">{i18n.money(subtotal, j.currency)}</strong>
          <span className="muted">{t('discount')}</span>
          {editable ? <div className="no-print" style={{ width: 160 }}><AmountInput value={discount} currency={j.currency} onChange={setDiscount} ariaLabel={t('discount')} /></div>
            : <span className="num">{i18n.money(j.discount, j.currency)}</span>}
          <span>{t('totalDue')}</span><strong className="num" style={{ fontSize: 18 }}>{i18n.money(total, j.currency)}</strong>
          {j.paid > 0 && <><span className="muted">{t('ew_paid')}</span><span className="num">{i18n.money(j.paid, j.currency)}</span></>}
        </div>
      </div>
      {total > 0 && <div className="small"><span className="muted">{t('inWords')}: </span>{i18n.digitsOf(amountInWords(total, j.currency, i18n.lang))}</div>}
      {editable && (
        <div className="row no-print" style={{ marginTop: 10 }}>
          <ErrorBox error={error} />
          <span className="spacer" />
          <button type="button" className="btn primary" disabled={busy || !dirty} onClick={() => void save()}><Icon name="check" size={16} />{t('ew_saveLines')}</button>
        </div>
      )}

      <div className="small" style={{ marginTop: 12 }}>
        <strong>{t('ew_terms')}: </strong>{terms}
        <div>{t('ew_validity', { n: validDays })}</div>
      </div>
      {j.notes && <p className="small"><span className="muted">{t('notes')}: </span>{j.notes}</p>}
      <div className="sigs" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <div className="sig"><div className="muted small">{t('ew_sigCustomer')}</div><div className="who">{j.party.name}</div></div>
        <div className="sig done"><div className="muted small">{t('ew_sigCompany')}</div><div className="who">{j.createdBy}</div></div>
      </div>
    </div>
  );
}

/* ---------- money in, costs, billing, cancelling ---------- */

function useRate(): [string, (v: string) => void, () => number] {
  const { settings } = useData();
  const [rate, setRate] = useState(String(rateFromX100(settings?.defaultRateX100 ?? 142000)));
  return [rate, setRate, () => Math.round(Number(toWesternDigits(rate).replace(/,/g, '')) * 100)];
}

function DepositModal({ job: j, onClose, onDone }: { job: JobView; onClose(): void; onDone(number: string): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState<number | null>(null);
  const [cashAccount, setCashAccount] = useState(settings?.postingAccounts.cash ?? '');
  const [rate, setRate, rateX100] = useRate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const after = await worksApi.deposit(j.id, { date, amount: amount ?? 0, cashAccountCode: cashAccount, lang: i18n.lang, ...(j.currency === 'USD' ? { rateX100: rateX100() } : {}) });
      onDone(after.receipts[after.receipts.length - 1]?.number ?? '');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={`${t('ew_deposit')} — ${j.number}`} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('ew_depositHelp')}</p>
        <div className="grid-2">
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>{t('amount')} <span className="muted small">({t('ew_remaining')}: {i18n.money(j.remaining, j.currency)})</span></span><AmountInput value={amount} currency={j.currency} onChange={setAmount} ariaLabel={t('amount')} /></label>
          <div className="field"><span>{t('cashAccount')}</span><AccountCombo value={cashAccount} onChange={setCashAccount} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} /></div>
          {j.currency === 'USD' && <label className="field"><span>{t('exchangeRate')}</span><input className="input num ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>}
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !amount || !cashAccount} onClick={() => void submit()}><Icon name="check" size={16} />{t('ew_deposit')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function CostModal({ job: j, onClose, onDone }: { job: JobView; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [kind, setKind] = useState<'invoice' | 'entry'>('invoice');
  const [category, setCategory] = useState<CostCategory>('materials');
  const [docId, setDocId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const docs = useLoad(() => worksApi.linkable(kind), [kind]);
  const linked = new Set(j.costLines.map((c) => c.document.id));
  const options: PickOption[] = (docs.data ?? []).filter((d) => !linked.has(d.id)).map((d: LinkableDocView) => ({
    id: d.id, code: d.number ?? '', label: [d.party, d.description].filter(Boolean).join(' — ') || i18n.date(d.date),
    hint: i18n.money(d.free, 'IQD'), search: d.date
  }));
  const picked = docs.data?.find((d) => d.id === docId);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await worksApi.addCost(j.id, {
        category, ...(kind === 'invoice' ? { invoiceId: docId } : { entryId: docId }), ...(amount ? { amount } : {}), ...(description.trim() ? { description: description.trim() } : {})
      });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={`${t('ew_addCost')} — ${j.number}`} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('ew_costsHelp')}</p>
        <div className="track" role="group" aria-label={t('ew_chooseDoc')}>
          <button type="button" aria-pressed={kind === 'invoice'} onClick={() => { setKind('invoice'); setDocId(''); setCategory('materials'); }}>{t('ew_doc_invoice')}</button>
          <button type="button" aria-pressed={kind === 'entry'} onClick={() => { setKind('entry'); setDocId(''); setCategory('labour'); }}>{t('ew_doc_entry')}</button>
        </div>
        <div className="field">
          <span>{t('ew_chooseDoc')}</span>
          <SearchCombo value={docId} options={options} onChange={setDocId} placeholder={t('ew_chooseDoc')} ariaLabel={t('ew_chooseDoc')} />
          {docs.data && options.length === 0 && <span className="small muted">{t('ew_noDocs')}</span>}
          {picked && <span className="small muted num">{t('ew_free', { a: i18n.money(picked.free, 'IQD') })}</span>}
        </div>
        <div className="grid-2">
          <label className="field"><span>{t('ew_costCategory')}</span>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as CostCategory)}>
              {COST_CATEGORIES.map((c) => <option key={c} value={c}>{t(costKey(c))}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('ew_amountIqd')}</span><AmountInput value={amount} currency="IQD" onChange={setAmount} ariaLabel={t('ew_amountIqd')} /><span className="small muted">{t('ew_amountAll')}</span></label>
        </div>
        <label className="field"><span>{t('notes')}</span><input className="input" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !docId} onClick={() => void submit()}><Icon name="check" size={16} />{t('ew_addCost')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function BillModal({ job: j, onClose, onDone }: { job: JobView; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [date, setDate] = useState(todayIso());
  const [rate, setRate, rateX100] = useRate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await worksApi.invoice(j.id, { date, ...(j.currency === 'USD' ? { rateX100: rateX100() } : {}) });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={`${t('ew_bill')} — ${j.number}`} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('ew_billHelp')}</p>
        <div className="totals" style={{ maxWidth: 420 }}>
          <span className="muted">{t('ew_total')}</span><strong className="num">{i18n.money(j.total, j.currency)}</strong>
          <span className="muted">{t('ew_paid')}</span><span className="num">{i18n.money(j.paid, j.currency)}</span>
          <span className="muted">{t('ew_remaining')}</span><span className="num">{i18n.money(j.remaining, j.currency)}</span>
        </div>
        <div className="grid-2">
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {j.currency === 'USD' && <label className="field"><span>{t('exchangeRate')}</span><input className="input num ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>}
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}><Icon name="invoice" size={16} />{t('ew_bill')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function CancelModal({ job: j, onClose, onDone }: { job: JobView; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await worksApi.cancel(j.id, reason.trim());
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t('ew_cancelJob')} — ${j.number}`} onClose={onClose}>
      <div className="stack">
        {j.paid > 0 && <p style={{ margin: 0 }}>{t('ew_cancelHelp')}</p>}
        <label className="field"><span>{t('ew_cancelReason')}</span><input className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn danger" disabled={busy} onClick={() => void submit()}>{t('confirm')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}
