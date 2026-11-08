import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { todayIso, toWesternDigits } from '@qasa/core';
import { ApiError } from '../api.ts';
import { EmptyState, AccountCombo, AmountInput, ErrorBox, Icon, Modal, useData, useLoad, usePageNav, useToast } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { go, href } from '../router.ts';
import {
  ampsText, generatorsApi, parseAmps, type CollectionView, type GenLine, type GenRunStatus, type GenSummary, type SubscriberInput,
  type SubscriberStatus, type SubscriberView
} from '../industry/generators-api.ts';
import { ReverseModal } from '../industry/ReverseModal.tsx';
// the 80 mm receipt styles of the point of sale (.pos-receipt …), shared by the collector's receipt
import '../pos.css';

/**
 * المولدات الأهلية (Pro): subscribers by amps on the normal or the 24-hour golden line, a monthly bill for everyone in
 * one click, the collector's screen (find → amount → receive → print), debts in months and the cut-off list.
 */

export type GenTab = 'collect' | 'subscribers' | 'months' | 'debts';
const NAV = { key: 'gen_title' as Key, group: 'gIndustry' as Key };
const STATUS_CHIP: Record<SubscriberStatus, string> = { active: 'ok', suspended: 'warn', ended: '' };
const RUN_CHIP: Record<GenRunStatus, string> = { draft: 'warn', posted: 'ok', cancelled: '' };
const COLLECTOR_KEY = 'qasa.gen.collector';
const CASH_KEY = 'qasa.gen.cash';

const remembered = (key: string, fallback: string) => {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};
const remember = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* not available */ }
};
const thisMonth = () => todayIso().slice(0, 7);
const toInt = (s: string) => {
  const n = Number(toWesternDigits(s).replace(/[,٬\s]/g, ''));
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/** An Iraqi mobile number for wa.me: 0750 123 4567 → 9647501234567. */
export function waNumber(phone: string): string | null {
  const d = toWesternDigits(phone).replace(/\D/g, '');
  if (/^07\d{9}$/.test(d)) return '964' + d.slice(1);
  if (/^9647\d{9}$/.test(d)) return d;
  if (/^7\d{9}$/.test(d)) return '964' + d;
  return null;
}

function Unavailable({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (error instanceof ApiError && error.status === 404) return <div className="alert info">{t('gen_notAvailable')}</div>;
  return <ErrorBox error={error} />;
}

function StatusChip({ status }: { status: SubscriberStatus }) {
  const { t } = useI18n();
  return <span className={'chip ' + STATUS_CHIP[status]}>{t(`gen_st_${status}`)}</span>;
}

function LineChip({ line }: { line: GenLine }) {
  const { t } = useI18n();
  return <span className={'chip ' + (line === 'golden' ? 'warn' : '')}>{t(line === 'golden' ? 'gen_golden' : 'gen_normal')}</span>;
}

/* ---------- the page ---------- */

export function Generators({ tab = 'collect' }: { tab?: GenTab }) {
  const { t } = useI18n();
  usePageNav(NAV);
  const summary = useLoad(() => generatorsApi.summary(), []);
  if (summary.error) return <Unavailable error={summary.error} />;
  const s = summary.data;
  const tabs: [GenTab, Key][] = [['collect', 'gen_tabCollect'], ['subscribers', 'gen_tabSubscribers'], ['months', 'gen_tabMonths'], ['debts', 'gen_tabDebts']];
  return (
    <div className="stack">
      {s && !s.available && <div className="alert">{t('gen_needsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      {s && <Tiles s={s} />}
      <div className="row no-print">
        <div className="track" role="tablist">
          {tabs.map(([k, label]) => (
            <a key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} className="btn" style={{ border: 'none' }}
              href={href(k === 'collect' ? 'generators' : `generators/${k}`)}>{t(label)}</a>
          ))}
        </div>
      </div>
      {tab === 'collect' && <Collect summary={s} onChange={summary.reload} />}
      {tab === 'subscribers' && <Subscribers summary={s} onChange={summary.reload} />}
      {tab === 'months' && <Months summary={s} />}
      {tab === 'debts' && <Debts summary={s} />}
    </div>
  );
}

function Tiles({ s }: { s: GenSummary }) {
  const i18n = useI18n();
  const { t } = i18n;
  const tiles = [
    { label: t('gen_tileSubscribers'), value: i18n.int(s.subscribers.active), sub: s.subscribers.suspended ? t('gen_tileSuspended', { n: i18n.int(s.subscribers.suspended) }) : '' },
    { label: t('gen_tileAmps'), value: `${i18n.digitsOf(ampsText(s.ampsX10.normal))} A`, sub: t('gen_tileGolden', { n: i18n.digitsOf(ampsText(s.ampsX10.golden)) }) },
    { label: t('gen_tileMonth', { p: i18n.digitsOf(s.period) }), value: i18n.money(s.collected, 'IQD'), sub: t('gen_tileBilled', { a: i18n.money(s.billed, 'IQD') }) },
    { label: t('gen_tileOutstanding'), value: i18n.money(s.outstanding, 'IQD'), sub: t('gen_tileOwing', { n: i18n.int(s.owing) }) }
  ];
  return (
    <div className="grid-4 no-print">
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

/* ---------- the collector's screen ---------- */

function Collect({ summary, onChange }: { summary: GenSummary | null; onChange(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<SubscriberView | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [cash, setCash] = useState(() => remembered(CASH_KEY, '1811'));
  const [collector, setCollector] = useState(() => remembered(COLLECTOR_KEY, ''));
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<CollectionView | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const found = useLoad(() => (q.trim() ? generatorsApi.subscribers({ q: q.trim() }) : Promise.resolve([] as SubscriberView[])), [q]);
  const today = useLoad(() => Promise.all([generatorsApi.collectors(date), generatorsApi.collections({ date })]), [date]);

  useEffect(() => { search.current?.focus(); }, []);

  function pick(s: SubscriberView) {
    setPicked(s);
    setAmount(s.balance > 0 ? s.balance : s.lastBill || null);
    setError(null);
  }

  async function receive() {
    if (!picked || !amount) return;
    setBusy(true);
    setError(null);
    try {
      const r = await generatorsApi.collect({ partyId: picked.partyId, date, amount, cashAccountCode: cash, collector: collector.trim() || undefined, lang: i18n.lang });
      remember(COLLECTOR_KEY, collector.trim());
      remember(CASH_KEY, cash);
      toast(t('gen_received', { a: i18n.money(r.amount, 'IQD'), n: r.name }));
      setReceipt(r);
      setPicked(null);
      setQ('');
      today.reload();
      onChange();
      search.current?.focus();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const [totals, receipts] = today.data ?? [[], []];
  return (
    <div className="stack">
      <div className="card pad stack">
        <label className="field">
          <span>{t('gen_findLabel')}</span>
          <input ref={search} className="input" style={{ fontSize: 20, padding: '12px 14px' }} value={q} placeholder={t('gen_findPlaceholder')}
            onChange={(e) => { setQ(e.target.value); setPicked(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && found.data?.length === 1) pick(found.data[0]!); }} />
        </label>
        {!picked && q.trim() && found.data && (
          found.data.length ? (
            <div className="stack" style={{ gap: 8 }}>
              {found.data.slice(0, 12).map((s) => (
                <button key={s.partyId} type="button" className="btn" style={{ justifyContent: 'space-between', padding: '12px 14px', fontSize: 16 }} onClick={() => pick(s)}>
                  <span><strong className="num ltr">{s.code}</strong> · {s.name} <span className="muted small ltr">{s.phone}</span></span>
                  <span className="num">{s.balance > 0 ? <strong>{i18n.money(s.balance, 'IQD')}</strong> : <span className="muted">{t('gen_paidUp')}</span>}</span>
                </button>
              ))}
            </div>
          ) : <div className="muted">{t('gen_noneFound')}</div>
        )}
        {picked && (
          <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <div className="row" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 20 }}>{picked.name}</strong>
              <span className="num ltr muted">{picked.code}</span>
              <LineChip line={picked.line} />
              <span className="muted">{i18n.digitsOf(ampsText(picked.ampsX10))} A</span>
              {picked.status !== 'active' && <StatusChip status={picked.status} />}
              <span className="spacer" />
              <span>{t('gen_owes')} <strong className="num">{i18n.money(picked.balance, 'IQD')}</strong>
                {picked.monthsOwed > 0 && <span className="muted small"> · {t('gen_monthsN', { n: i18n.int(picked.monthsOwed) })}</span>}</span>
            </div>
            <div className="grid-2">
              <label className="field"><span>{t('amount')}</span><AmountInput value={amount} currency="IQD" onChange={setAmount} ariaLabel={t('amount')} /></label>
              <label className="field"><span>{t('gen_collector')}</span><input className="input" value={collector} onChange={(e) => setCollector(e.target.value)} /></label>
              <label className="field"><span>{t('gen_cashAccount')}</span><AccountCombo value={cash} onChange={setCash} filter={(a) => a.code.startsWith('18')} ariaLabel={t('gen_cashAccount')} /></label>
              <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            </div>
            <ErrorBox error={error} />
            <div className="row">
              <button type="button" className="btn primary" style={{ fontSize: 18, padding: '12px 28px' }} disabled={busy || !amount} onClick={() => void receive()}>
                <Icon name="check" size={20} />{t('gen_receive')}
              </button>
              <button type="button" className="btn" onClick={() => { setPicked(null); search.current?.focus(); }}>{t('cancel')}</button>
            </div>
          </div>
        )}
      </div>

      {receipt && (
        <div className="alert info row" style={{ alignItems: 'center' }}>
          <span>{t('gen_receiptReady', { n: receipt.number ?? '' })}</span>
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={() => printReceipt()}><Icon name="printer" size={16} />{t('gen_printReceipt')}</button>
          <ReceiptPrint c={receipt} />
        </div>
      )}

      <div className="card">
        <div className="card-head row"><strong>{t('gen_todayTitle')}</strong><span className="spacer" /><span className="muted small">{i18n.date(date)}</span></div>
        {!totals.length && <div className="pad muted">{t('gen_noCollections')}</div>}
        {!!totals.length && (
          <table className="table">
            <thead><tr><th>{t('gen_collector')}</th><th>{t('gen_receipts')}</th><th className="amount">{t('amount')}</th></tr></thead>
            <tbody>
              {totals.map((c) => (
                <tr key={c.collector}><td>{c.collector || '—'}</td><td className="num">{i18n.int(c.receipts)}</td><td className="amount num"><strong>{i18n.money(c.amount, 'IQD')}</strong></td></tr>
              ))}
            </tbody>
          </table>
        )}
        {!!receipts.length && (
          <details className="pad">
            <summary>{t('gen_todayReceipts', { n: i18n.int(receipts.length) })}</summary>
            <table className="table">
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.entryId} className={r.reversed ? 'muted' : ''}>
                    <td><a className="num ltr" href={href(`entry/${r.entryId}`)}>{r.number}</a></td>
                    <td><span className="num ltr">{r.code}</span> · {r.name}</td><td>{r.collector}</td>
                    <td className="amount num">{i18n.money(r.amount, 'IQD')}{r.reversed && <span className="chip"> {t('gen_reversed')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>
      {summary && !summary.subscribers.active && <div className="muted">{t('gen_startHint')} <a href={href('generators/subscribers')}>{t('gen_tabSubscribers')}</a></div>}
    </div>
  );
}

function printReceipt() {
  document.body.classList.add('pos-printing');
  const done = () => { document.body.classList.remove('pos-printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  window.setTimeout(done, 1000);
}

/** The collector's receipt (وصل) on 80 mm paper, printed alone. */
function ReceiptPrint({ c }: { c: CollectionView }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings, plan } = useData();
  const company = settings ? i18n.name(settings.companyName) : '';
  return createPortal(
    <div className="pos-receipt-host" dir={i18n.dir} lang={i18n.lang === 'ku' ? 'ckb' : i18n.lang}>
      <div className="pos-receipt">
        <div className="pos-r-center pos-r-company"><strong>{company}</strong></div>
        <div className="pos-r-center">{t('gen_receiptTitle')}</div>
        <div className="pos-r-sep" />
        <div className="pos-r-row"><span>{t('gen_receiptNo')}</span><span className="ltr">{c.number}</span></div>
        <div className="pos-r-row"><span>{t('date')}</span><span>{i18n.date(c.date)}</span></div>
        <div className="pos-r-row"><span>{t('gen_subscriber')}</span><span><span className="ltr">{c.code}</span> {c.name}</span></div>
        {c.collector && <div className="pos-r-row"><span>{t('gen_collector')}</span><span>{c.collector}</span></div>}
        <div className="pos-r-sep" />
        <div className="pos-r-row pos-r-total"><span>{t('gen_paid')}</span><span>{i18n.money(c.amount, 'IQD')}</span></div>
        <div className="pos-r-row"><span>{t('gen_stillOwed')}</span><span>{i18n.money(Math.max(c.balance, 0), 'IQD')}</span></div>
        <div className="pos-r-sep" />
        <div className="pos-r-center small">{t('gen_receiptThanks')}</div>
        {!plan?.features.includes('noBranding') && <div className="pos-r-center small">Qasa ERP</div>}
      </div>
    </div>,
    document.body
  );
}

/* ---------- subscribers ---------- */

function Subscribers({ summary, onChange }: { summary: GenSummary | null; onChange(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<SubscriberStatus | ''>('active');
  const [area, setArea] = useState('');
  const [route, setRoute] = useState('');
  const { data, error, reload } = useLoad(() => generatorsApi.subscribers({ q: q.trim() || undefined, status: status || undefined, area: area || undefined, route: route || undefined }), [q, status, area, route]);
  const [editing, setEditing] = useState<SubscriberView | 'new' | null>(null);
  const [bulk, setBulk] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const can = !!summary?.available;

  async function setTo(s: SubscriberView, next: SubscriberStatus) {
    setActionError(null);
    try {
      await generatorsApi.setStatus(s.partyId, next);
      toast(t('saved'));
      reload();
      onChange();
    } catch (e) {
      setActionError(e);
    }
  }

  const done = () => { setEditing(null); setBulk(false); reload(); onChange(); };
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {can && <button type="button" className="btn primary" style={{ fontSize: 16, padding: '10px 20px' }} onClick={() => setEditing('new')}><Icon name="plus" size={18} />{t('gen_add')}</button>}
        {can && <button type="button" className="btn" onClick={() => setBulk(true)}><Icon name="rows" size={16} />{t('gen_addMany')}</button>}
        <span className="spacer" />
        <input className="input" style={{ maxWidth: 240 }} placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ maxWidth: 160 }} value={status} onChange={(e) => setStatus(e.target.value as SubscriberStatus | '')} aria-label={t('gen_status')}>
          <option value="">{t('gen_allStatuses')}</option>
          {(['active', 'suspended', 'ended'] as const).map((s) => <option key={s} value={s}>{t(`gen_st_${s}`)}</option>)}
        </select>
        {!!summary?.areas.length && (
          <select className="input" style={{ maxWidth: 160 }} value={area} onChange={(e) => setArea(e.target.value)} aria-label={t('gen_area')}>
            <option value="">{t('gen_allAreas')}</option>{summary.areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        {!!summary?.routes.length && (
          <select className="input" style={{ maxWidth: 140 }} value={route} onChange={(e) => setRoute(e.target.value)} aria-label={t('gen_route')}>
            <option value="">{t('gen_allRoutes')}</option>{summary.routes.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
      </div>
      <ErrorBox error={error ?? actionError} />
      <div className="card">
        {data && !data.length && <EmptyState icon="zap" title={t('es_subscribers')} text={t('es_subscribersText')} />}
        {data && !!data.length && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('code')}</th><th>{t('name')}</th><th>{t('phone')}</th><th>{t('gen_area')}</th><th>{t('gen_amps')}</th><th>{t('gen_line')}</th>
                  <th className="amount">{t('balance')}</th><th>{t('gen_status')}</th><th />
                </tr>
              </thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.partyId}>
                    <td className="num ltr">{s.code}</td>
                    <td><a href={href(`party/${s.partyId}`)}>{s.name}</a></td>
                    <td className="ltr num">{s.phone}</td>
                    <td>{[s.area, s.route].filter(Boolean).join(' · ')}</td>
                    <td className="num">{i18n.digitsOf(ampsText(s.ampsX10))}</td>
                    <td><LineChip line={s.line} /></td>
                    <td className="amount num">{s.balance > 0 ? <strong>{i18n.money(s.balance, 'IQD')}</strong> : '—'}</td>
                    <td><StatusChip status={s.status} /></td>
                    <td className="row" style={{ gap: 6, justifyContent: 'end' }}>
                      {can && <button type="button" className="btn subtle" onClick={() => setEditing(s)}>{t('gen_edit')}</button>}
                      {s.status === 'active' && <button type="button" className="btn subtle" onClick={() => void setTo(s, 'suspended')}>{t('gen_cutOff')}</button>}
                      {s.status === 'suspended' && can && <button type="button" className="btn subtle" onClick={() => void setTo(s, 'active')}>{t('gen_reconnect')}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <SubscriberModal current={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={done} />}
      {bulk && <BulkModal onClose={() => setBulk(false)} onDone={done} />}
    </div>
  );
}

function SubscriberModal({ current, onClose, onDone }: { current: SubscriberView | null; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [name, setName] = useState(current?.name ?? '');
  const [phone, setPhone] = useState(current?.phone ?? '');
  const [area, setArea] = useState(current?.area ?? '');
  const [route, setRoute] = useState(current?.route ?? '');
  const [amps, setAmps] = useState(current ? ampsText(current.ampsX10) : '5');
  const [line, setLine] = useState<GenLine>(current?.line ?? 'normal');
  const [status, setStatus] = useState<SubscriberStatus>(current?.status ?? 'active');
  const [notes, setNotes] = useState(current?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ampsX10 = parseAmps(amps);

  async function submit() {
    if (!ampsX10) return;
    setBusy(true);
    setError(null);
    const input: SubscriberInput = { name, phone, area, route, ampsX10, line, notes };
    try {
      if (current) await generatorsApi.updateSubscriber(current.partyId, { ...input, status });
      else await generatorsApi.createSubscriber(input);
      toast(t('saved'));
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={t(current ? 'gen_editTitle' : 'gen_addTitle')} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <label className="field"><span>{t('name')}</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label className="field"><span>{t('phone')}</span><input className="input ltr" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></label>
          <label className="field"><span>{t('gen_area')}</span><input className="input" value={area} onChange={(e) => setArea(e.target.value)} placeholder={t('gen_areaPlaceholder')} /></label>
          <label className="field"><span>{t('gen_route')}</span><input className="input" value={route} onChange={(e) => setRoute(e.target.value)} /></label>
          <label className="field"><span>{t('gen_amps')}</span><input className="input num" value={amps} onChange={(e) => setAmps(e.target.value)} inputMode="decimal" aria-invalid={!ampsX10} /></label>
          <div className="field">
            <span>{t('gen_line')}</span>
            <div className="track" role="radiogroup">
              {(['normal', 'golden'] as const).map((l) => (
                <button key={l} type="button" role="radio" aria-checked={line === l} aria-pressed={line === l} className="btn" style={{ border: 'none' }} onClick={() => setLine(l)}>
                  {t(l === 'golden' ? 'gen_golden' : 'gen_normal')}
                </button>
              ))}
            </div>
          </div>
          {current && (
            <label className="field"><span>{t('gen_status')}</span>
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value as SubscriberStatus)}>
                {(['active', 'suspended', 'ended'] as const).map((s) => <option key={s} value={s}>{t(`gen_st_${s}`)}</option>)}
              </select>
            </label>
          )}
          <label className="field"><span>{t('notes')}</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
        {current && <p className="muted small" style={{ margin: 0 }}>{t('gen_ampsNextMonth')}</p>}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !name.trim() || !ampsX10} onClick={() => void submit()}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** One subscriber per line: name, phone, amps, area, route (separated by tabs, commas or "|"), all on one line type. */
export function parseBulk(text: string, line: GenLine): { rows: SubscriberInput[]; bad: number[] } {
  const rows: SubscriberInput[] = [];
  const bad: number[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return;
    const [name = '', phone = '', amps = '', area = '', route = ''] = raw.split(/\t|\||،|,/).map((c) => c.trim());
    const ampsX10 = parseAmps(amps);
    if (!name || !ampsX10) { bad.push(i + 1); return; }
    rows.push({ name, ...(phone ? { phone } : {}), ampsX10, line, ...(area ? { area } : {}), ...(route ? { route } : {}) });
  });
  return { rows, bad };
}

function BulkModal({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [text, setText] = useState('');
  const [line, setLine] = useState<GenLine>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const parsed = useMemo(() => parseBulk(text, line), [text, line]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const added = await generatorsApi.createSubscribers(parsed.rows);
      toast(t('gen_addedN', { n: i18n.int(added.length) }));
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={t('gen_addMany')} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('gen_bulkHelp')}</p>
        <textarea className="input" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('gen_bulkPlaceholder')} />
        <div className="row">
          <span>{t('gen_line')}:</span>
          <select className="input" style={{ maxWidth: 200 }} value={line} onChange={(e) => setLine(e.target.value as GenLine)}>
            <option value="normal">{t('gen_normal')}</option><option value="golden">{t('gen_golden')}</option>
          </select>
          <span className="spacer" />
          <span className="muted small">{t('gen_bulkCount', { n: i18n.int(parsed.rows.length) })}</span>
        </div>
        {!!parsed.bad.length && <div className="alert">{t('gen_bulkBad', { n: i18n.digitsOf(parsed.bad.join(', ')) })}</div>}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !parsed.rows.length || !!parsed.bad.length} onClick={() => void submit()}><Icon name="check" size={16} />{t('gen_addAll')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- months ---------- */

function Months({ summary }: { summary: GenSummary | null }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { data, error } = useLoad(() => generatorsApi.runs(), []);
  const [preparing, setPreparing] = useState(false);
  const [settings, setSettings] = useState(false);
  return (
    <div className="stack">
      <div className="row">
        {summary?.available && (
          <button type="button" className="btn primary" style={{ fontSize: 16, padding: '10px 22px' }} onClick={() => setPreparing(true)}>
            <Icon name="plus" size={18} />{t('gen_billMonth')}
          </button>
        )}
        <span className="spacer" />
        {summary?.available && <button type="button" className="btn" onClick={() => setSettings(true)}><Icon name="sliders" size={16} />{t('gen_settings')}</button>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>{t('gen_monthsHelp')}</p>
      <ErrorBox error={error} />
      <div className="card">
        {data && !data.length && <div className="pad muted">{t('gen_noRuns')}</div>}
        {data && !!data.length && (
          <table className="table">
            <thead>
              <tr><th>{t('gen_month')}</th><th>{t('gen_tabSubscribers')}</th><th className="amount">{t('gen_priceNormal')}</th><th className="amount">{t('gen_priceGolden')}</th><th className="amount">{t('total')}</th><th /></tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="click" onClick={() => go(`gen-run/${r.id}`)}>
                  <td><a className="num ltr" href={href(`gen-run/${r.id}`)} onClick={(e) => e.stopPropagation()}>{i18n.digitsOf(r.period)}</a></td>
                  <td className="num">{i18n.int(r.totals.subscribers)}</td>
                  <td className="amount num">{i18n.money(r.priceNormal, 'IQD')}</td>
                  <td className="amount num">{i18n.money(r.priceGolden, 'IQD')}</td>
                  <td className="amount num"><strong>{i18n.money(r.totals.total, 'IQD')}</strong></td>
                  <td><span className={'chip ' + RUN_CHIP[r.status]}>{t(`gen_run_${r.status}`)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {preparing && <PrepareModal last={data?.[0] ?? null} onClose={() => setPreparing(false)} onDone={(id) => go(`gen-run/${id}`)} />}
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
    </div>
  );
}

function PrepareModal({ last, onClose, onDone }: { last: { priceNormal: number; priceGolden: number } | null; onClose(): void; onDone(id: string): void }) {
  const { t } = useI18n();
  const [period, setPeriod] = useState(thisMonth());
  const [date, setDate] = useState(todayIso());
  const [normal, setNormal] = useState<number | null>(last?.priceNormal ?? null);
  const [golden, setGolden] = useState<number | null>(last?.priceGolden ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    if (normal === null || golden === null) return;
    setBusy(true);
    setError(null);
    try {
      onDone((await generatorsApi.prepareRun({ period, date, priceNormal: normal, priceGolden: golden })).id);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <Modal title={t('gen_billMonth')} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('gen_billHelp')}</p>
        <div className="grid-2">
          <label className="field"><span>{t('gen_month')}</span><input className="input" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>{t('gen_priceNormal')}</span><AmountInput value={normal} currency="IQD" onChange={setNormal} ariaLabel={t('gen_priceNormal')} /></label>
          <label className="field"><span>{t('gen_priceGolden')}</span><AmountInput value={golden} currency="IQD" onChange={setGolden} ariaLabel={t('gen_priceGolden')} /></label>
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || normal === null || golden === null || !period} onClick={() => void submit()}><Icon name="check" size={16} />{t('gen_preview')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function SettingsModal({ onClose }: { onClose(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const current = useLoad(() => generatorsApi.settings(), []);
  const [account, setAccount] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const value = account ?? current.data?.revenueAccount ?? '';
  async function submit() {
    setError(null);
    try {
      await generatorsApi.updateSettings({ revenueAccount: value });
      toast(t('saved'));
      onClose();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <Modal title={t('gen_settings')} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>{t('gen_revenueAccount')}</span>
          <AccountCombo value={value} onChange={setAccount} filter={(a) => a.code.startsWith('4')} ariaLabel={t('gen_revenueAccount')} />
        </label>
        <p className="muted small" style={{ margin: 0 }}>{t('gen_revenueHelp')}</p>
        <ErrorBox error={error ?? current.error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={!value} onClick={() => void submit()}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** One month's bills: prices on the draft, then post (one journal entry for the checker and approver). */
export function GenRun({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  usePageNav(NAV);
  const { settings } = useData();
  const { data: run, error, reload } = useLoad(() => generatorsApi.run(id), [id]);
  const [normal, setNormal] = useState<number | null>(null);
  const [golden, setGolden] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [reversing, setReversing] = useState(false);
  useEffect(() => { if (run) { setNormal(run.priceNormal); setGolden(run.priceGolden); } }, [run]);
  if (error) return <Unavailable error={error} />;
  if (!run) return null;
  const company = settings ? i18n.name(settings.companyName) : '';

  async function act(fn: () => Promise<unknown>, message: Key) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      toast(t(message));
      reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  }
  const pricesChanged = normal !== run.priceNormal || golden !== run.priceGolden;

  return (
    <div className="stack">
      <div className="row no-print" style={{ flexWrap: 'wrap' }}>
        <a className="btn" href={href('generators/months')}>{t('back')}</a>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => window.print()}><Icon name="printer" size={16} />{t('print')}</button>
        {run.actions.includes('post') && (
          <button type="button" className="btn primary" disabled={busy || pricesChanged} onClick={() => void act(() => generatorsApi.postRun(run.id, i18n.lang), 'gen_posted')}>
            <Icon name="check" size={16} />{t('gen_post')}
          </button>
        )}
        {run.actions.includes('unpost') && <button type="button" className="btn" disabled={busy} onClick={() => void act(() => generatorsApi.unpostRun(run.id), 'gen_unposted')}>{t('gen_unpost')}</button>}
        {run.actions.includes('reverse') && (
          <button type="button" className="btn" disabled={busy} onClick={() => { setActionError(null); setReversing(true); }}><Icon name="undo" size={16} />{t('gen_reverse')}</button>
        )}
        {run.actions.includes('cancel') && (
          <button type="button" className="btn danger" disabled={busy} onClick={() => void (async () => {
            setBusy(true);
            try { await generatorsApi.cancelRun(run.id); toast(t('gen_cancelled')); go('generators/months'); } catch (e) { setActionError(e); setBusy(false); }
          })()}>{t('gen_cancelRun')}</button>
        )}
      </div>
      <ErrorBox error={reversing ? null : actionError} />
      {reversing && (
        <ReverseModal title={`${t('gen_reverse')} — ${i18n.digitsOf(run.period)}`} note={t('gen_reverseNote')} action={t('gen_reverse')}
          min={run.date} busy={busy} error={actionError} onClose={() => setReversing(false)}
          onReverse={(date) => void act(async () => { await generatorsApi.reverseRun(run.id, { date }); setReversing(false); }, 'gen_reversedDone')} />
      )}
      <div className="card pad stack">
        <div className="print-only company-line">{company}</div>
        <div className="row" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>{t('gen_monthTitle', { p: i18n.digitsOf(run.period) })}</h2>
          <span className={'chip ' + RUN_CHIP[run.status]}>{t(`gen_run_${run.status}`)}</span>
          {run.entry && <span className="muted">{t('gen_entry')} <a className="num ltr" href={href(`entry/${run.entry.id}`)}>{run.entry.number ?? t('gen_entryDraft')}</a></span>}
        </div>
        {run.actions.includes('edit') ? (
          <div className="grid-4 no-print" style={{ alignItems: 'end' }}>
            <label className="field"><span>{t('gen_priceNormal')}</span><AmountInput value={normal} currency="IQD" onChange={setNormal} ariaLabel={t('gen_priceNormal')} /></label>
            <label className="field"><span>{t('gen_priceGolden')}</span><AmountInput value={golden} currency="IQD" onChange={setGolden} ariaLabel={t('gen_priceGolden')} /></label>
            <div>
              <button type="button" className="btn" disabled={busy || !pricesChanged || normal === null || golden === null}
                onClick={() => void act(() => generatorsApi.updateRun(run.id, { priceNormal: normal!, priceGolden: golden! }), 'saved')}>{t('gen_applyPrices')}</button>
            </div>
          </div>
        ) : (
          <div className="muted">{t('gen_pricesLine', { n: i18n.money(run.priceNormal, 'IQD'), g: i18n.money(run.priceGolden, 'IQD') })}</div>
        )}
        <div className="totals">
          <span>{t('gen_normal')} · {i18n.digitsOf(ampsText(run.totals.ampsX10.normal))} A</span><span>{i18n.money(run.totals.amount.normal, 'IQD')}</span>
          <span>{t('gen_golden')} · {i18n.digitsOf(ampsText(run.totals.ampsX10.golden))} A</span><span>{i18n.money(run.totals.amount.golden, 'IQD')}</span>
          <strong>{t('total')} · {t('gen_subscribersN', { n: i18n.int(run.totals.subscribers) })}</strong><strong>{i18n.money(run.totals.total, 'IQD')}</strong>
        </div>
        {run.status === 'posted' && run.entry?.status !== 'approved' && <div className="alert info">{t('gen_awaitingApproval')}</div>}
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('code')}</th><th>{t('name')}</th><th>{t('gen_area')}</th><th>{t('gen_amps')}</th><th>{t('gen_line')}</th><th className="amount">{t('amount')}</th></tr></thead>
            <tbody>
              {run.bills.map((b) => (
                <tr key={b.partyId}>
                  <td className="num ltr">{b.code}</td><td>{b.name}</td><td>{[b.area, b.route].filter(Boolean).join(' · ')}</td>
                  <td className="num">{i18n.digitsOf(ampsText(b.ampsX10))}</td><td><LineChip line={b.line} /></td>
                  <td className="amount num">{i18n.money(b.amount, 'IQD')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------- debts and the cut-off list ---------- */

function Debts({ summary }: { summary: GenSummary | null }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const [minMonths, setMinMonths] = useState('0');
  const [area, setArea] = useState('');
  const [route, setRoute] = useState('');
  const min = toInt(minMonths) ?? 0;
  const { data, error } = useLoad(() => generatorsApi.debts({ minMonths: min, area: area || undefined, route: route || undefined }), [min, area, route]);
  const company = settings ? i18n.name(settings.companyName) : '';
  const total = data?.reduce((s, d) => s + d.balance, 0) ?? 0;

  const message = (s: SubscriberView) => t('gen_waText', { n: s.name, a: i18n.money(s.balance, 'IQD'), m: i18n.int(s.monthsOwed), c: company });
  return (
    <div className="stack">
      <div className="row no-print" style={{ flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6 }}><span>{t('gen_minMonths')}</span>
          <select className="input" style={{ width: 90 }} value={minMonths} onChange={(e) => setMinMonths(e.target.value)}>
            {['0', '1', '2', '3', '4', '6'].map((n) => <option key={n} value={n}>{n === '0' ? t('gen_any') : i18n.digitsOf(n)}</option>)}
          </select>
        </label>
        {!!summary?.areas.length && (
          <select className="input" style={{ maxWidth: 160 }} value={area} onChange={(e) => setArea(e.target.value)} aria-label={t('gen_area')}>
            <option value="">{t('gen_allAreas')}</option>{summary.areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        {!!summary?.routes.length && (
          <select className="input" style={{ maxWidth: 140 }} value={route} onChange={(e) => setRoute(e.target.value)} aria-label={t('gen_route')}>
            <option value="">{t('gen_allRoutes')}</option>{summary.routes.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => window.print()}><Icon name="printer" size={16} />{t(min >= 1 ? 'gen_printCutOff' : 'print')}</button>
      </div>
      <ErrorBox error={error} />
      <div className="card pad">
        <div className="print-only company-line">{company}</div>
        <div className="row" style={{ alignItems: 'baseline' }}>
          <h3 style={{ margin: 0 }}>{min >= 1 ? t('gen_cutOffTitle', { n: i18n.int(min) }) : t('gen_debtsTitle')}</h3>
          <span className="spacer" />
          <span>{t('gen_debtsTotal', { n: i18n.int(data?.length ?? 0), a: i18n.money(total, 'IQD') })}</span>
        </div>
        {data && !data.length && <div className="muted" style={{ paddingTop: 10 }}>{t('gen_noDebts')}</div>}
        {data && !!data.length && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>{t('code')}</th><th>{t('name')}</th><th>{t('phone')}</th><th>{t('gen_area')}</th><th>{t('gen_amps')}</th><th>{t('gen_months')}</th><th className="amount">{t('balance')}</th><th className="no-print" /></tr>
              </thead>
              <tbody>
                {data.map((s) => {
                  const wa = waNumber(s.phone);
                  return (
                    <tr key={s.partyId}>
                      <td className="num ltr">{s.code}</td><td>{s.name}{s.status === 'suspended' && <> <StatusChip status={s.status} /></>}</td>
                      <td className="ltr num">{s.phone}</td><td>{[s.area, s.route].filter(Boolean).join(' · ')}</td>
                      <td className="num">{i18n.digitsOf(ampsText(s.ampsX10))}</td>
                      <td className="num"><strong>{i18n.int(s.monthsOwed)}</strong></td>
                      <td className="amount num"><strong>{i18n.money(s.balance, 'IQD')}</strong></td>
                      <td className="no-print">
                        {wa && <a className="btn subtle" target="_blank" rel="noreferrer" href={`https://wa.me/${wa}?text=${encodeURIComponent(message(s))}`}><Icon name="mail" size={14} />{t('gen_remind')}</a>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
