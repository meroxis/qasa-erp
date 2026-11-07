import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { todayIso, type CurrencyCode } from '@qasa/core';
import { api, ApiError } from '../api.ts';
import { AmountInput, ErrorBox, Icon, Modal, SearchCombo, useLoad, useToast, type PickOption } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { OPEN_STAGES, pipelineApi, type DealInput, type DealView, type PipelineSummaryView, type Stage } from '../industry/pipeline-api.ts';
import { quotesApi } from '../industry/quotes-api.ts';
import { href } from '../router.ts';

/**
 * متابعة المبيعات (Pro): the sales pipeline as a board — a column per stage from lead to negotiating, cards you drag (or
 * move with the arrows) from one to the next, and won or lost to close them. Route: `pipeline`.
 */

const stageKey = (s: Stage) => `pl_st_${s}` as Key;
const STAGE_CHIP: Record<Stage, string> = { lead: '', contacted: 'info', quoted: 'info', negotiating: 'warn', won: 'ok', lost: 'bad' };

function money2(i18n: I18n, m: { IQD: number; USD: number }): string {
  if (!m.IQD && !m.USD) return i18n.money(0, 'IQD');
  return [m.IQD ? i18n.money(m.IQD, 'IQD') : '', m.USD ? i18n.money(m.USD, 'USD') : ''].filter(Boolean).join(' · ');
}

const isAbsent = (e: unknown) => e instanceof ApiError && e.status === 404 && !(e.details as { what?: string } | null)?.what;

export function Pipeline() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [view, setView] = useState<'open' | 'won' | 'lost'>('open');
  const [owner, setOwner] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<DealView | 'new' | null>(null);
  const [closing, setClosing] = useState<{ deal: DealView; outcome: 'won' | 'lost' } | null>(null);
  const [summary, setSummary] = useState<PipelineSummaryView | null>(null);
  const [absent, setAbsent] = useState(false);
  const [moveError, setMoveError] = useState<unknown>(null);
  const deals = useLoad(() => pipelineApi.deals({ stage: view, ...(owner ? { owner } : {}), ...(q.trim() ? { q: q.trim() } : {}) }), [view, owner, q]);
  const loadSummary = () => pipelineApi.summary().then(setSummary, (e) => { if (isAbsent(e)) setAbsent(true); });
  useEffect(() => { void loadSummary(); }, []);
  const refresh = () => { deals.reload(); void loadSummary(); };

  if (absent) return <div className="alert info">{t('pl_notAvailable')}</div>;

  async function move(d: DealView, stage: Stage) {
    if (stage === d.stage) return;
    setMoveError(null);
    try {
      await pipelineApi.move(d.id, stage);
      toast(t('pl_moved', { s: t(stageKey(stage)) }));
      refresh();
    } catch (e) {
      setMoveError(e);
    }
  }

  const s = summary;
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('pl_help')}</p>
      {s && !s.available && <div className="alert">{t('pl_needsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      {s && (
        <div className="grid-4">
          <div className="card pad tile"><div className="label">{t('pl_tileOpen')}</div><div className="value num">{i18n.int(s.open)}</div><div className="small muted num">{money2(i18n, s.openValue)}</div></div>
          <div className="card pad tile"><div className="label">{t('pl_tileLate')}</div><div className="value num" style={s.late ? { color: 'var(--bad)' } : undefined}>{i18n.int(s.late)}</div></div>
          <div className="card pad tile"><div className="label">{t('pl_tileWon')}</div><div className="value num">{i18n.int(s.month.won)}</div><div className="small muted num">{money2(i18n, s.month.wonValue)}</div></div>
          <div className="card pad tile"><div className="label">{t('pl_tileRate')}</div><div className="value num">{s.month.winRate === null ? '—' : `${i18n.int(s.month.winRate)}%`}</div>
            <div className="small muted num">{t('pl_wonLost', { w: i18n.int(s.month.won), l: i18n.int(s.month.lost) })}</div></div>
        </div>
      )}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {s?.available && <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('pl_new')}</button>}
        <div className="track" role="group" aria-label={t('pl_title')}>
          <button type="button" aria-pressed={view === 'open'} onClick={() => setView('open')}>{t('pl_board')}</button>
          <button type="button" aria-pressed={view === 'won'} onClick={() => setView('won')}>{t(stageKey('won'))}</button>
          <button type="button" aria-pressed={view === 'lost'} onClick={() => setView('lost')}>{t(stageKey('lost'))}</button>
        </div>
        <span className="spacer" />
        {!!s?.owners.length && (
          <select className="input" style={{ width: 'auto' }} aria-label={t('pl_owner')} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{t('pl_owner')}: {t('all')}</option>
            {s.owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        <input className="input" style={{ width: 220 }} type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox error={moveError ?? (deals.error && !isAbsent(deals.error) ? deals.error : null)} />
      {deals.data && (view === 'open'
        ? <Board deals={deals.data} onOpen={setEditing} onMove={(d, st) => void move(d, st)} onClose={(deal, outcome) => setClosing({ deal, outcome })} />
        : <ClosedList deals={deals.data} onOpen={setEditing} />)}
      {editing && <DealModal deal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={(msg) => { setEditing(null); toast(msg); refresh(); }} onCloseDeal={(deal, outcome) => { setEditing(null); setClosing({ deal, outcome }); }} />}
      {closing && <CloseModal deal={closing.deal} outcome={closing.outcome} onClose={() => setClosing(null)} onDone={() => { const o = closing.outcome; setClosing(null); toast(t(o === 'won' ? 'pl_wonToast' : 'pl_lostToast')); refresh(); }} />}
    </div>
  );
}

function Board({ deals, onOpen, onMove, onClose }: { deals: DealView[]; onOpen(d: DealView): void; onMove(d: DealView, s: Stage): void; onClose(d: DealView, o: 'won' | 'lost'): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [over, setOver] = useState<Stage | null>(null);
  const byId = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);
  const drop = (e: DragEvent, stage: Stage) => {
    e.preventDefault();
    setOver(null);
    const d = byId.get(e.dataTransfer.getData('text/plain'));
    if (d) onMove(d, stage);
  };
  if (!deals.length) return <div className="card pad muted">{t('pl_none')}</div>;
  const prevOf = (s: Stage) => OPEN_STAGES[OPEN_STAGES.indexOf(s) - 1];
  const nextOf = (s: Stage) => OPEN_STAGES[OPEN_STAGES.indexOf(s) + 1];
  return (
    <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(240px, 1fr)', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
      {OPEN_STAGES.map((stage) => {
        const col = deals.filter((d) => d.stage === stage);
        const total = col.reduce((m, d) => ({ ...m, [d.currency]: m[d.currency] + d.value }), { IQD: 0, USD: 0 } as Record<CurrencyCode, number>);
        return (
          <section key={stage} aria-label={t(stageKey(stage))} className="card"
            onDragOver={(e) => { e.preventDefault(); setOver(stage); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, stage)}
            style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 160, outline: over === stage ? '2px dashed var(--accent)' : undefined }}>
            <div className="row" style={{ gap: 6 }}>
              <span className={'chip ' + STAGE_CHIP[stage]}>{t(stageKey(stage))}</span><span className="count">{i18n.int(col.length)}</span>
              <span className="spacer" /><span className="small muted num">{money2(i18n, total)}</span>
            </div>
            {col.map((d) => {
              const prev = prevOf(d.stage);
              const next = nextOf(d.stage);
              return (
                <article key={d.id} className="card" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', d.id)}
                  style={{ padding: 10, boxShadow: 'none', cursor: 'grab', borderColor: d.late ? 'var(--bad)' : undefined }}>
                  <button type="button" onClick={() => onOpen(d)} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
                    <div style={{ fontWeight: 600 }}>{d.title}</div>
                    <div className="small muted">{d.name}{d.phone ? <> · <span className="ltr">{i18n.digitsOf(d.phone)}</span></> : null}</div>
                    <div className="num" style={{ marginTop: 4 }}>{i18n.money(d.value, d.currency)}</div>
                    {d.nextStep && (
                      <div className="small" style={{ marginTop: 4, color: d.late ? 'var(--bad)' : undefined }}>
                        <Icon name="cal" size={13} /> {d.nextStep}{d.nextDate ? ` · ${i18n.date(d.nextDate)}` : ''}
                      </div>
                    )}
                    {d.owner && <div className="small muted">{t('pl_owner')}: {d.owner}</div>}
                    {d.quote && <div className="small muted ltr">{d.quote.number}</div>}
                  </button>
                  {d.actions.includes('move') && (
                    <div className="row" style={{ gap: 4, marginTop: 6 }}>
                      {prev && <button type="button" className="btn icon small" onClick={() => onMove(d, prev)} aria-label={t('pl_moveTo', { s: t(stageKey(prev)) })} title={t('pl_moveTo', { s: t(stageKey(prev)) })}><span aria-hidden="true">{i18n.dir === 'rtl' ? '›' : '‹'}</span></button>}
                      {next && <button type="button" className="btn icon small" onClick={() => onMove(d, next)} aria-label={t('pl_moveTo', { s: t(stageKey(next)) })} title={t('pl_moveTo', { s: t(stageKey(next)) })}><span aria-hidden="true">{i18n.dir === 'rtl' ? '‹' : '›'}</span></button>}
                      <span className="spacer" />
                      <button type="button" className="btn small" onClick={() => onClose(d, 'won')}>{t('pl_win')}</button>
                      <button type="button" className="btn small" onClick={() => onClose(d, 'lost')}>{t('pl_lose')}</button>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function ClosedList({ deals, onOpen }: { deals: DealView[]; onOpen(d: DealView): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!deals.length) return <div className="card pad muted">{t('pl_none')}</div>;
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead><tr><th>{t('pl_deal')}</th><th>{t('customer')}</th><th>{t('pl_closed')}</th><th className="amount">{t('pl_value')}</th><th>{t('pl_reason')}</th></tr></thead>
        <tbody>
          {deals.map((d) => (
            <tr key={d.id} className="click" onClick={() => onOpen(d)}>
              <td>{d.title}</td><td>{d.name}</td><td className="num">{d.closedAt ? i18n.date(d.closedAt) : '—'}</td>
              <td className="amount">{i18n.money(d.value, d.currency)}</td><td>{d.lostReason || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DealModal({ deal, onClose, onDone, onCloseDeal }: { deal: DealView | null; onClose(): void; onDone(msg: string): void; onCloseDeal(d: DealView, o: 'won' | 'lost'): void }) {
  const { t } = useI18n();
  const customersLoad = useLoad(() => api.parties({ type: 'customer', active: 'true' }), []);
  const customers: PickOption[] = useMemo(() => (customersLoad.data ?? []).map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone })), [customersLoad.data]);
  const quotesLoad = useLoad(() => quotesApi.list({}), []);
  const quotes: PickOption[] = useMemo(() => (quotesLoad.data ?? []).filter((q) => q.status !== 'cancelled').map((q) => ({ id: q.id, code: q.number, label: q.customerName, search: q.number })), [quotesLoad.data]);
  const [form, setForm] = useState({
    title: deal?.title ?? '', partyId: deal?.party?.id ?? '', contactName: deal?.contactName ?? '', phone: deal?.party ? '' : deal?.phone ?? '',
    source: deal?.source ?? '', currency: (deal?.currency ?? 'IQD') as CurrencyCode, value: deal?.value ?? (null as number | null),
    expectedDate: deal?.expectedDate ?? '', nextStep: deal?.nextStep ?? '', nextDate: deal?.nextDate ?? todayIso(), owner: deal?.owner ?? '',
    quoteId: deal?.quote?.id ?? '', notes: deal?.notes ?? ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const editable = !deal || deal.actions.includes('edit');

  async function save() {
    setBusy(true);
    setError(null);
    const body: DealInput = {
      title: form.title, partyId: form.partyId || null, contactName: form.contactName, phone: form.phone, source: form.source, currency: form.currency,
      value: form.value ?? 0, expectedDate: form.expectedDate || null, nextStep: form.nextStep, nextDate: form.nextDate || null, owner: form.owner,
      quoteId: form.quoteId || null, notes: form.notes
    };
    try {
      if (deal) await pipelineApi.update(deal.id, body);
      else await pipelineApi.create(body);
      onDone(deal ? t('saved') : t('pl_created'));
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }
  async function act(kind: 'reopen' | 'delete') {
    if (!deal) return;
    if (kind === 'delete' && !window.confirm(t('pl_deleteConfirm', { n: deal.title }))) return;
    setBusy(true);
    try {
      if (kind === 'reopen') await pipelineApi.reopen(deal.id);
      else await pipelineApi.remove(deal.id);
      onDone(t(kind === 'reopen' ? 'pl_reopened' : 'pl_deleted'));
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  return (
    <Modal title={deal ? deal.title : t('pl_new')} onClose={onClose}>
      <div className="stack">
        {deal && <div className="row" style={{ gap: 6 }}><span className={'chip ' + STAGE_CHIP[deal.stage]}>{t(stageKey(deal.stage))}</span>{deal.lostReason && <span className="small muted">{deal.lostReason}</span>}</div>}
        <label className="field"><span>{t('pl_titleField')}</span><input className="input" maxLength={200} value={form.title} disabled={!editable} onChange={(e) => set('title', e.target.value)} placeholder={t('pl_titleHint')} /></label>
        <div className="grid-2">
          <label className="field"><span>{t('customer')}</span><SearchCombo value={form.partyId} options={customers} onChange={(v) => set('partyId', v)} placeholder={t('pl_customerHint')} ariaLabel={t('customer')} emptyLabel={t('pl_noCustomer')} /></label>
          <label className="field"><span>{t('pl_contact')}</span><input className="input" maxLength={200} value={form.contactName} onChange={(e) => set('contactName', e.target.value)} /></label>
          <label className="field"><span>{t('phone')}</span><input className="input ltr" maxLength={50} value={form.phone} onChange={(e) => set('phone', e.target.value)} /></label>
          <label className="field"><span>{t('pl_source')}</span>
            <input className="input" list="pl-sources" maxLength={100} value={form.source} onChange={(e) => set('source', e.target.value)} />
            <datalist id="pl-sources">{(['pl_src_walkin', 'pl_src_phone', 'pl_src_facebook', 'pl_src_instagram', 'pl_src_whatsapp', 'pl_src_referral'] as Key[]).map((k) => <option key={k} value={t(k)} />)}</datalist>
          </label>
          <label className="field"><span>{t('currency')}</span>
            <select className="input" value={form.currency} onChange={(e) => set('currency', e.target.value as CurrencyCode)}><option value="IQD">IQD</option><option value="USD">USD</option></select>
          </label>
          <label className="field"><span>{t('pl_value')}</span><AmountInput value={form.value} currency={form.currency} onChange={(v) => set('value', v)} ariaLabel={t('pl_value')} /></label>
          <label className="field"><span>{t('pl_nextStep')}</span><input className="input" maxLength={300} value={form.nextStep} onChange={(e) => set('nextStep', e.target.value)} placeholder={t('pl_nextStepHint')} /></label>
          <label className="field"><span>{t('pl_nextDate')}</span><input className="input num" type="date" value={form.nextDate} onChange={(e) => set('nextDate', e.target.value)} /></label>
          <label className="field"><span>{t('pl_owner')}</span><input className="input" maxLength={100} value={form.owner} onChange={(e) => set('owner', e.target.value)} /></label>
          <label className="field"><span>{t('pl_expected')}</span><input className="input num" type="date" value={form.expectedDate} onChange={(e) => set('expectedDate', e.target.value)} /></label>
          <label className="field"><span>{t('pl_quote')}</span><SearchCombo value={form.quoteId} options={quotes} onChange={(v) => set('quoteId', v)} placeholder={t('pl_quoteHint')} ariaLabel={t('pl_quote')} emptyLabel={t('pl_noQuote')} /></label>
          {deal?.quote && <div className="field"><span>&nbsp;</span><a className="ltr" href={href(`quote/${deal.quote.id}`)}>{deal.quote.number}</a></div>}
        </div>
        <label className="field"><span>{t('notes')}</span><textarea className="input" rows={2} maxLength={2000} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {deal?.actions.includes('delete') && <button type="button" className="btn danger" disabled={busy} onClick={() => void act('delete')}><Icon name="x" size={16} />{t('pl_delete')}</button>}
          {deal?.actions.includes('reopen') && <button type="button" className="btn" disabled={busy} onClick={() => void act('reopen')}><Icon name="undo" size={16} />{t('pl_reopen')}</button>}
          {deal?.actions.includes('win') && <button type="button" className="btn" disabled={busy} onClick={() => onCloseDeal(deal, 'won')}>{t('pl_win')}</button>}
          {deal?.actions.includes('lose') && <button type="button" className="btn" disabled={busy} onClick={() => onCloseDeal(deal, 'lost')}>{t('pl_lose')}</button>}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t('back')}</button>
          {editable && <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}><Icon name="check" size={16} />{t('save')}</button>}
        </div>
      </div>
    </Modal>
  );
}

function CloseModal({ deal, outcome, onClose, onDone }: { deal: DealView; outcome: 'won' | 'lost'; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [value, setValue] = useState<number | null>(deal.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (outcome === 'won') await pipelineApi.won(deal.id, { value: value ?? 0 });
      else await pipelineApi.lost(deal.id, reason);
      onDone();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }
  return (
    <Modal title={`${t(outcome === 'won' ? 'pl_win' : 'pl_lose')} — ${deal.title}`} onClose={onClose}>
      <div className="stack">
        {outcome === 'won'
          ? <label className="field"><span>{t('pl_finalValue')}</span><AmountInput value={value} currency={deal.currency} onChange={setValue} ariaLabel={t('pl_finalValue')} /></label>
          : (
            <label className="field"><span>{t('pl_reason')}</span>
              <input className="input" list="pl-reasons" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              <datalist id="pl-reasons">{(['pl_why_price', 'pl_why_competitor', 'pl_why_budget', 'pl_why_noreply', 'pl_why_later'] as Key[]).map((k) => <option key={k} value={t(k)} />)}</datalist>
            </label>
          )}
        {outcome === 'won' && !deal.quote && <p className="small muted" style={{ margin: 0 }}>{t('pl_wonHelp')} <a href={href('new-quote')}>{t('qt_new')}</a></p>}
        <ErrorBox error={error} />
        <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>{t('back')}</button>
          <button type="button" className={'btn ' + (outcome === 'won' ? 'primary' : 'danger')} disabled={busy} onClick={() => void submit()}><Icon name="check" size={16} />{t(outcome === 'won' ? 'pl_win' : 'pl_lose')}</button></div>
      </div>
    </Modal>
  );
}
