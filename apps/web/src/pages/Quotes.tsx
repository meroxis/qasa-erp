import { useEffect, useMemo, useState } from 'react';
import { amountInWords, formatQty, lineAmount, rateFromX100, todayIso, toWesternDigits, type CurrencyCode } from '@qasa/core';
import { api } from '../api.ts';
import { EmptyState, AmountInput, ErrorBox, Icon, Modal, QtyInput, SearchCombo, useData, useLoad, usePageNav, useToast, type PickOption } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import {
  QUOTE_STATUSES, quotesApi, type QuoteInput, type QuoteLineInput, type QuoteMove, type QuoteStatus, type QuoteSummaryView, type QuoteView
} from '../industry/quotes-api.ts';
import { go, href } from '../router.ts';
import { useRatePrefill } from '../industry/fx-prefill.ts';
import { convertAmount, convertLines } from './currency-switch.ts';
import { quoteMessage, WhatsAppButton } from '../industry/WhatsAppShare.tsx';
import { DesignedPrint } from '../industry/PrintDocument.tsx';
import { quoteModel } from '../industry/print-model.ts';
import { printDocument } from '../industry/printing.ts';

/**
 * عروض الأسعار — quotations, on every plan. Routes: `quotes` (the list), `new-quote`, `edit-quote/:id`, and `quote/:id`
 * (one quote, printable on A4, with its next steps: send, accept or reject, turn into a sale invoice).
 */

const STATUS_CHIP: Record<QuoteStatus, string> = { draft: '', sent: 'info', accepted: 'ok', rejected: 'bad', invoiced: 'ok', cancelled: 'bad' };
const st = (s: QuoteStatus) => `qt_st_${s}` as Key;

export function QuoteChip({ status, expired }: { status: QuoteStatus; expired?: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <span className={'chip ' + STATUS_CHIP[status]}>{t(st(status))}</span>
      {expired && <span className="chip warn" style={{ marginInlineStart: 4 }}>{t('qt_expired')}</span>}
    </>
  );
}

function money2(i18n: I18n, m: { IQD: number; USD: number }): string {
  return m.USD ? `${i18n.money(m.IQD, 'IQD')} · ${i18n.money(m.USD, 'USD')}` : i18n.money(m.IQD, 'IQD');
}

const addDays = (iso: string, days: number) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);

/* ---------- the list ---------- */

export function Quotes() {
  const i18n = useI18n();
  const { t } = i18n;
  const [status, setStatus] = useState<QuoteStatus | 'open' | ''>('open');
  const [q, setQ] = useState('');
  const { data, error } = useLoad(() => quotesApi.list({ ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) }), [status, q]);
  const summary = useLoad(() => quotesApi.summary(), []);
  const s = summary.data;

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('qt_help')}</p>
      {s && (
        <div className="grid-4">
          <div className="card pad tile"><div className="label">{t('qt_tileOpen')}</div><div className="value num">{i18n.int(s.open)}</div><div className="small muted num">{money2(i18n, s.openValue)}</div></div>
          <div className="card pad tile"><div className="label">{t('qt_tileExpired')}</div><div className="value num" style={s.expired ? { color: 'var(--warn)' } : undefined}>{i18n.int(s.expired)}</div></div>
          <div className="card pad tile"><div className="label">{t('qt_tileMonth')}</div><div className="value num">{i18n.int(s.quotedThisMonth)}</div></div>
          <div className="card pad tile"><div className="label">{t('qt_tileAccepted')}</div><div className="value num">{i18n.int(s.acceptedThisMonth)}</div>
            {s.quotedThisMonth > 0 && <div className="small muted num">{i18n.int(Math.round((s.acceptedThisMonth / s.quotedThisMonth) * 100))}%</div>}</div>
        </div>
      )}
      <div className="row">
        <a className="btn primary" href={href('new-quote')}><Icon name="plus" size={16} />{t('qt_new')}</a>
        <span className="spacer" />
        <input className="input" style={{ width: 240 }} type="search" placeholder={t('qt_searchHint')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="row">
        <div className="track" role="group" aria-label={t('qt_title')}>
          {(['open', '', ...QUOTE_STATUSES] as const).map((x) => (
            <button key={x || 'all'} type="button" aria-pressed={status === x} onClick={() => setStatus(x)}>
              {x === '' ? t('all') : x === 'open' ? t('qt_f_open') : t(st(x))}
            </button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />
      {data && <div className="card table-wrap"><QuotesTable quotes={data} /></div>}
    </div>
  );
}

function QuotesTable({ quotes }: { quotes: QuoteSummaryView[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!quotes.length) return <EmptyState icon="invoice" title={t('es_quotes')} text={t('es_quotesText')} />;
  return (
    <table className="table">
      <thead>
        <tr><th>{t('number')}</th><th>{t('customer')}</th><th>{t('validUntil')}</th><th className="amount">{t('total')}</th><th /></tr>
      </thead>
      <tbody>
        {quotes.map((x) => (
          <tr key={x.id} className="click" onClick={() => go(`quote/${x.id}`)}>
            <td><a className="ltr num" href={href(`quote/${x.id}`)} onClick={(e) => e.stopPropagation()}>{x.number}</a><div className="muted small num">{i18n.date(x.date)}</div></td>
            <td>{x.customerName}{!x.party && <div className="muted small">{t('qt_prospect')}</div>}</td>
            <td className="num">{x.validUntil ? i18n.date(x.validUntil) : '—'}</td>
            <td className="amount">{i18n.money(x.total, x.currency)}</td>
            <td><QuoteChip status={x.status} expired={x.expired} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------- writing a quote ---------- */

interface Row extends QuoteLineInput { key: number }
let rowKey = 0;
const emptyRow = (): Row => ({ key: ++rowKey, itemId: null, description: '', qtyMilli: 1000, unitPrice: 0 });

function useCustomers(): PickOption[] {
  const customers = useLoad(() => api.parties({ type: 'customer', active: 'true' }), []);
  return useMemo(() => (customers.data ?? []).map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone })), [customers.data]);
}

export function QuoteEditor({ id }: { id?: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  usePageNav({ key: 'qt_title', group: 'gSales', title: id ? 'qt_edit' : 'qt_new' });
  const existing = useLoad(() => (id ? quotesApi.get(id) : Promise.resolve(null)), [id]);
  const customers = useCustomers();
  const itemsLoad = useLoad(() => api.items({ active: 'true' }), []);
  const items = itemsLoad.data ?? [];
  const itemOptions: PickOption[] = useMemo(() => items.map((it) => ({
    id: it.id, code: it.code, label: i18n.name(it.name), search: `${it.name.ar} ${it.name.en} ${it.name.ku} ${it.barcode ?? ''}`
  })), [items, i18n]);

  const { settings } = useData();
  const [prospect, setProspect] = useState(false);
  const [form, setForm] = useState({ date: todayIso(), validUntil: addDays(todayIso(), 15), partyId: '', customerName: '', currency: 'IQD' as CurrencyCode, notes: '', terms: '' });
  const [rows, setRows] = useState<Row[]>(() => [emptyRow()]);
  const [discount, setDiscount] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const x = existing.data;
    if (!x) return;
    setProspect(!x.party);
    setForm({ date: x.date, validUntil: x.validUntil ?? '', partyId: x.party?.id ?? '', customerName: x.party ? '' : x.customerName, currency: x.currency, notes: x.notes, terms: x.terms });
    setRows(x.lines.map((l) => ({ key: ++rowKey, itemId: l.itemId, description: l.description, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice })));
    setDiscount(x.discount);
  }, [existing.data]);
  useEffect(() => { if (!id) setForm((f) => (f.terms ? f : { ...f, terms: t('qt_termsDefault') })); }, [id, i18n.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  /** Another currency converts the prices and the discount at the default rate (or, with no rate, clears them after asking). */
  const changeCurrency = (next: CurrencyCode) => {
    if (next === form.currency) return;
    const rate = settings?.defaultRateX100;
    const converted = convertLines(rows, form.currency, next, rate);
    if (converted) {
      setRows(converted);
      setDiscount((d) => convertAmount(d ?? 0, form.currency, next, rate!));
    } else {
      if (rows.some((r) => r.unitPrice) && !window.confirm(t('qt_currencyClears'))) return;
      setRows((rs) => rs.map((r) => ({ ...r, unitPrice: 0 })));
      setDiscount(0);
    }
    set('currency', next);
  };
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const pickItem = (key: number, itemId: string) => {
    const it = items.find((x) => x.id === itemId);
    update(key, { itemId: itemId || null, ...(it ? { description: i18n.name(it.name), ...(it.saleCurrency === form.currency && it.salePrice ? { unitPrice: it.salePrice } : {}) } : {}) });
  };
  const subtotal = rows.reduce((s, r) => s + lineAmount(r.qtyMilli || 0, r.unitPrice || 0), 0);

  async function save() {
    setBusy(true);
    setError(null);
    const input: QuoteInput = {
      date: form.date, validUntil: form.validUntil || null, currency: form.currency, discount: discount ?? 0, notes: form.notes, terms: form.terms,
      ...(prospect ? { partyId: null, customerName: form.customerName } : { partyId: form.partyId || null }),
      lines: rows.filter((r) => r.itemId || r.description.trim() || r.unitPrice).map(({ key: _k, ...r }) => ({ ...r, qtyMilli: r.qtyMilli || 0, unitPrice: r.unitPrice || 0 }))
    };
    try {
      const saved = id ? await quotesApi.update(id, input) : await quotesApi.create(input);
      toast(id ? t('saved') : t('qt_created', { n: saved.number }));
      go(`quote/${saved.id}`);
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  if (id && existing.error) return <ErrorBox error={existing.error} />;
  if (id && !existing.data) return null;
  if (existing.data && !existing.data.actions.includes('edit')) return <div className="alert">{t('qt_locked')} <a href={href(`quote/${id}`)}>{existing.data.number}</a></div>;

  return (
    <div className="stack" style={{ maxWidth: 1080 }}>
      <div className="card pad stack" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <div className="track" role="group" aria-label={t('customer')}>
            <button type="button" aria-pressed={!prospect} onClick={() => setProspect(false)}>{t('qt_existing')}</button>
            <button type="button" aria-pressed={prospect} onClick={() => setProspect(true)}>{t('qt_newPerson')}</button>
          </div>
        </div>
        <div className="grid-2">
          {prospect ? (
            <label className="field"><span>{t('qt_personName')}</span><input className="input" maxLength={200} value={form.customerName} onChange={(e) => set('customerName', e.target.value)} /></label>
          ) : (
            <label className="field"><span>{t('customer')}</span><SearchCombo value={form.partyId} options={customers} onChange={(v) => set('partyId', v)} placeholder={t('qt_pickCustomer')} ariaLabel={t('customer')} /></label>
          )}
          <label className="field"><span>{t('currency')}</span>
            <select className="input" value={form.currency} onChange={(e) => changeCurrency(e.target.value as CurrencyCode)}>
              <option value="IQD">IQD — {t('qt_dinar')}</option><option value="USD">USD — {t('qt_dollar')}</option>
            </select>
          </label>
          <label className="field"><span>{t('date')}</span><input className="input num" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></label>
          <label className="field"><span>{t('validUntil')}</span><input className="input num" type="date" value={form.validUntil} onChange={(e) => set('validUntil', e.target.value)} /></label>
        </div>
      </div>

      <div className="card pad">
        <div className="row" style={{ marginBottom: 6 }}><h3 style={{ margin: 0 }}>{t('qt_lines')}</h3><span className="spacer" /><span className="small muted">{t('qt_linesHelp')}</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th><th style={{ width: 240 }}>{t('item')}</th><th>{t('description')}</th>
                <th className="amount" style={{ width: 110 }}>{t('qty')}</th><th className="amount" style={{ width: 160 }}>{t('unitPrice')}</th>
                <th className="amount">{t('amount')}</th><th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td className="muted num">{i18n.int(i + 1)}</td>
                  <td><SearchCombo value={r.itemId ?? ''} options={itemOptions} onChange={(v) => pickItem(r.key, v)} placeholder={t('qt_freeText')} ariaLabel={t('item')} emptyLabel={t('qt_freeText')} /></td>
                  <td><input className="input" maxLength={500} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} aria-label={t('description')} /></td>
                  <td><QtyInput value={r.qtyMilli || null} onChange={(v) => update(r.key, { qtyMilli: v ?? 0 })} ariaLabel={t('qty')} /></td>
                  <td><AmountInput value={r.unitPrice || null} currency={form.currency} onChange={(v) => update(r.key, { unitPrice: v ?? 0 })} ariaLabel={t('unitPrice')} /></td>
                  <td className="amount">{i18n.money(lineAmount(r.qtyMilli || 0, r.unitPrice || 0), form.currency)}</td>
                  <td><button type="button" className="btn icon danger" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [emptyRow()]))} aria-label={t('removeLine')} title={t('removeLine')}><Icon name="x" size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ paddingTop: 10, alignItems: 'flex-start' }}>
          <button type="button" className="btn small" onClick={() => setRows((rs) => [...rs, emptyRow()])}><Icon name="plus" size={15} />{t('addLine')}</button>
          <span className="spacer" />
          <div className="totals">
            <span className="muted">{t('subtotal')}</span><strong className="num">{i18n.money(subtotal, form.currency)}</strong>
            <span className="muted">{t('discount')}</span><div style={{ width: 160 }}><AmountInput value={discount} currency={form.currency} onChange={setDiscount} ariaLabel={t('discount')} /></div>
            <span>{t('totalDue')}</span><strong className="num" style={{ fontSize: 18 }}>{i18n.money(Math.max(0, subtotal - (discount ?? 0)), form.currency)}</strong>
          </div>
        </div>
      </div>

      <div className="card pad grid-2">
        <label className="field"><span>{t('qt_terms')}</span><textarea className="input" rows={3} maxLength={2000} value={form.terms} onChange={(e) => set('terms', e.target.value)} /></label>
        <label className="field"><span>{t('notes')}</span><textarea className="input" rows={3} maxLength={2000} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      </div>

      <ErrorBox error={error} />
      <div className="row">
        <button type="button" className="btn" onClick={() => history.back()}>{t('back')}</button>
        <span className="spacer" />
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}><Icon name="check" size={16} />{t('save')}</button>
      </div>
    </div>
  );
}

/* ---------- one quote ---------- */

export function QuoteDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings } = useData();
  usePageNav({ key: 'qt_title', group: 'gSales' });
  const { data: x, error, reload } = useLoad(() => quotesApi.get(id), [id]);
  const [modal, setModal] = useState<'convert' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<unknown>(null);

  if (error) return <ErrorBox error={error} />;
  if (!x) return null;
  const company = settings ? i18n.name(settings.companyName) : '';
  const can = (a: string) => x.actions.includes(a as never);

  async function move(action: QuoteMove) {
    setBusy(true);
    setActError(null);
    try {
      await quotesApi.move(id, action);
      toast(t('qt_moved', { s: t(st(action === 'send' ? 'sent' : action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'draft')) }));
      reload();
    } catch (e) {
      setActError(e);
    }
    setBusy(false);
  }
  async function duplicate() {
    setBusy(true);
    try {
      const copy = await quotesApi.duplicate(id);
      toast(t('qt_created', { n: copy.number }));
      go(`quote/${copy.id}`);
    } catch (e) {
      setActError(e);
    }
    setBusy(false);
  }

  return (
    <div className="stack" style={{ maxWidth: 1080 }}>
      <div className="row no-print" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={() => history.back()}>{t('back')}</button>
        <span className="spacer" />
        {can('convert') && <button type="button" className="btn primary" disabled={busy} onClick={() => setModal('convert')}><Icon name="invoice" size={16} />{t('qt_convert')}</button>}
        {can('send') && <button type="button" className="btn" disabled={busy} onClick={() => void move('send')}><Icon name="check" size={16} />{t('qt_markSent')}</button>}
        {can('accept') && <button type="button" className="btn" disabled={busy} onClick={() => void move('accept')}><Icon name="check" size={16} />{t('qt_accept')}</button>}
        {can('reject') && <button type="button" className="btn" disabled={busy} onClick={() => void move('reject')}><Icon name="x" size={16} />{t('qt_reject')}</button>}
        {can('reopen') && <button type="button" className="btn" disabled={busy} onClick={() => void move('reopen')}><Icon name="undo" size={16} />{t('qt_reopen')}</button>}
        {can('edit') && <a className="btn" href={href(`edit-quote/${id}`)}><Icon name="edit" size={16} />{t('qt_edit')}</a>}
        {can('duplicate') && <button type="button" className="btn" disabled={busy} onClick={() => void duplicate()}><Icon name="doc" size={16} />{t('qt_duplicate')}</button>}
        {x.status !== 'cancelled' && <WhatsAppButton phone={x.party?.phone} text={quoteMessage(i18n, company, { ...x, customerName: x.party?.name ?? x.customerName })} />}
        <button type="button" className="btn" onClick={() => void printDocument('quote')}><Icon name="printer" size={16} />{t('print')}</button>
        {can('cancel') && <button type="button" className="btn danger" disabled={busy} onClick={() => setModal('cancel')}><Icon name="x" size={16} />{t('qt_cancel')}</button>}
      </div>
      <ErrorBox error={actError} />
      {x.invoice && (
        <div className="alert info no-print">{t('qt_invoicedAs')} <a href={href(`invoice/${x.invoice.id}`)} className="ltr">{x.invoice.number ?? t('qt_draftInvoice')}</a></div>
      )}
      {x.expired && <div className="alert no-print">{t('qt_expiredHelp')}</div>}
      <DesignedPrint model={quoteModel(x)} />
      <div className="no-print"><Paper quote={x} company={company} /></div>
      {modal === 'convert' && <ConvertModal quote={x} onClose={() => setModal(null)} onDone={() => { setModal(null); toast(t('qt_converted')); reload(); }} />}
      {modal === 'cancel' && <CancelModal quote={x} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    </div>
  );
}

/** عرض سعر on A4: company, customer, lines, totals in figures and words, terms, signatures. */
function Paper({ quote: x, company }: { quote: QuoteView; company: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <div className="paper">
      <div className="paper-head">
        <div style={{ flex: 1 }}>
          <div className="company-line">{company}</div>
          <div className="paper-title">{t('qt_quotation')}</div>
          <div className="no-print" style={{ marginTop: 4 }}><QuoteChip status={x.status} expired={x.expired} /></div>
        </div>
        <div className="paper-meta">
          <span className="muted">{t('number')}</span><strong className="ltr">{x.number}</strong>
          <span className="muted">{t('date')}</span><strong className="num">{i18n.date(x.date)}</strong>
          {x.validUntil && <><span className="muted">{t('validUntil')}</span><strong className="num">{i18n.date(x.validUntil)}</strong></>}
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div className="muted small">{t('qt_to')}</div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{x.party ? <a href={href(`party/${x.party.id}`)}>{x.party.name}</a> : x.customerName}</div>
        {x.party?.phone && <div className="small"><span className="ltr">{i18n.digitsOf(x.party.phone)}</span></div>}
        {x.party?.address && <div className="small">{x.party.address}</div>}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th style={{ width: 36 }}>#</th><th>{t('description')}</th><th className="amount" style={{ width: 110 }}>{t('qty')}</th><th className="amount" style={{ width: 160 }}>{t('unitPrice')}</th><th className="amount">{t('amount')}</th></tr>
          </thead>
          <tbody>
            {x.lines.map((l) => (
              <tr key={l.seq}>
                <td className="muted num">{i18n.int(l.seq)}</td>
                <td>{l.description}{l.itemCode && <span className="muted small ltr" style={{ marginInlineStart: 6 }}>{l.itemCode}</span>}</td>
                <td className="amount">{i18n.digitsOf(formatQty(l.qtyMilli))}</td>
                <td className="amount">{i18n.money(l.unitPrice, x.currency)}</td>
                <td className="amount">{i18n.money(l.amount, x.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ padding: '10px 0' }}>
        <span className="spacer" />
        <div className="totals">
          <span className="muted">{t('subtotal')}</span><strong className="num">{i18n.money(x.subtotal, x.currency)}</strong>
          {x.discount > 0 && <><span className="muted">{t('discount')}</span><span className="num">{i18n.money(x.discount, x.currency)}</span></>}
          <span>{t('totalDue')}</span><strong className="num" style={{ fontSize: 18 }}>{i18n.money(x.total, x.currency)}</strong>
        </div>
      </div>
      {x.total > 0 && <div className="small"><span className="muted">{t('inWords')}: </span>{i18n.digitsOf(amountInWords(x.total, x.currency, i18n.lang))}</div>}
      {x.terms && <div className="small" style={{ marginTop: 12, whiteSpace: 'pre-line' }}><strong>{t('qt_terms')}: </strong>{x.terms}</div>}
      {x.notes && <p className="small" style={{ whiteSpace: 'pre-line' }}><span className="muted">{t('notes')}: </span>{x.notes}</p>}
      <div className="sigs" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <div className="sig"><div className="muted small">{t('qt_sigCustomer')}</div><div className="who">{x.customerName}</div></div>
        <div className="sig done"><div className="muted small">{t('qt_sigCompany')}</div><div className="who">{x.createdBy}</div></div>
      </div>
    </div>
  );
}

function ConvertModal({ quote: x, onClose, onDone }: { quote: QuoteView; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const { settings } = useData();
  const [date, setDate] = useState(todayIso() < x.date ? x.date : todayIso());
  const [rate, setRate] = useState(String(rateFromX100(settings?.defaultRateX100 ?? 142000)));
  // dollars: the rate board's rate for the chosen date, until a rate is typed
  const ratePrefill = useRatePrefill({ active: true, currency: x.currency, date, setRateText: setRate });
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await quotesApi.convert(x.id, {
        date,
        ...(x.currency === 'USD' ? { rateX100: Math.round(Number(toWesternDigits(rate).replace(/,/g, '')) * 100) } : {}),
        ...(!x.party ? { customer: { name: x.customerName, ...(phone.trim() ? { phone: phone.trim() } : {}) } } : {})
      });
      onDone();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }
  return (
    <Modal title={t('qt_convert')} onClose={onClose}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{t('qt_convertHelp')}</p>
        <label className="field"><span>{t('date')}</span><input className="input num" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {x.currency === 'USD' && <label className="field"><span>{t('rate')}</span><input className="input num" inputMode="decimal" value={rate} onChange={(e) => { ratePrefill.typed(); setRate(e.target.value); }} /></label>}
        {!x.party && (
          <>
            <div className="alert info">{t('qt_becomesCustomer', { n: x.customerName })}</div>
            <label className="field"><span>{t('phone')}</span><input className="input ltr" maxLength={50} value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          </>
        )}
        <ErrorBox error={error} />
        <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}><Icon name="invoice" size={16} />{t('qt_convert')}</button></div>
      </div>
    </Modal>
  );
}

function CancelModal({ quote: x, onClose, onDone }: { quote: QuoteView; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    setBusy(true);
    try {
      await quotesApi.move(x.id, 'cancel', reason.trim() || undefined);
      onDone();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }
  return (
    <Modal title={t('qt_cancel')} onClose={onClose}>
      <div className="stack">
        <p style={{ margin: 0 }}>{t('qt_cancelHelp', { n: x.number })}</p>
        <label className="field"><span>{t('qt_reason')}</span><input className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>{t('back')}</button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => void submit()}><Icon name="x" size={16} />{t('qt_cancel')}</button></div>
      </div>
    </Modal>
  );
}
