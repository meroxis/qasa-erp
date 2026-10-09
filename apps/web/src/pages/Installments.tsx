import { useEffect, useMemo, useState } from 'react';
import { amountInWords, rateFromX100, todayIso, toWesternDigits, type CurrencyCode } from '@qasa/core';
import {
  api, ApiError, type AgingBucket, type ContractState, type ContractSummaryView, type ContractView, type GuarantorInput, type GuarantorView,
  type InstallmentState, type InstallmentsSummaryView, type InvoiceSummary, type Money2, type PartyView
} from '../api.ts';
import { AccountCombo, AmountInput, ErrorBox, Icon, Modal, SearchCombo, useData, useLoad, useToast, type PickOption } from '../components.tsx';
import { useI18n, type I18n } from '../i18n.ts';
import { go, href } from '../router.ts';

/**
 * البيع بالتقسيط (Pro): contracts that schedule what a customer owes, with a guarantor, collections posted as receipt
 * vouchers, and what is overdue. The API comes with the Pro module; without it these pages say so.
 */

const STATE_CHIP: Record<ContractState, string> = { active: 'info', overdue: 'bad', paid: 'ok', cancelled: '' };
const ROW_CHIP: Record<InstallmentState, string> = { paid: 'ok', overdue: 'bad', due: 'warn', upcoming: '' };
const BUCKETS: AgingBucket[] = ['d30', 'd60', 'd90', 'over90'];

export function ContractChip({ status }: { status: ContractState }) {
  const { t } = useI18n();
  return <span className={'chip ' + STATE_CHIP[status]}>{t(`cs_${status}`)}</span>;
}

/** IQD, and dollars beside when there are any. */
function money2(i18n: I18n, m: Money2): string {
  return m.USD ? `${i18n.money(m.IQD, 'IQD')} · ${i18n.money(m.USD, 'USD')}` : i18n.money(m.IQD, 'IQD');
}

/** An Iraqi mobile number as WhatsApp wants it (9647…), or null. */
function whatsappNumber(phone: string): string | null {
  const d = toWesternDigits(phone).replace(/\D/g, '');
  if (/^9647\d{9}$/.test(d)) return d;
  if (/^07\d{9}$/.test(d)) return '964' + d.slice(1);
  if (/^7\d{9}$/.test(d)) return '964' + d;
  return null;
}

function NotAvailable() {
  const { t } = useI18n();
  return <div className="alert info">{t('insOfficial')}</div>;
}

/* ---------- list ---------- */

export function Installments() {
  const i18n = useI18n();
  const { t } = i18n;
  const [status, setStatus] = useState<ContractState | ''>('');
  const [q, setQ] = useState('');
  const [summary, setSummary] = useState<InstallmentsSummaryView | null>(null);
  const [absent, setAbsent] = useState(false);
  const { data, error } = useLoad(() => api.installments({ ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) }), [status, q]);

  useEffect(() => {
    api.installmentsSummary().then(setSummary, (e) => { if (e instanceof ApiError && e.status === 404) setAbsent(true); });
  }, []);
  if (absent) return <NotAvailable />;

  const tiles = summary ? [
    { label: t('activeContracts'), value: i18n.int(summary.active), sub: money2(i18n, summary.outstanding) },
    { label: t('dueWeek'), value: i18n.int(summary.dueThisWeek.contracts), sub: money2(i18n, summary.dueThisWeek.amount) },
    { label: t('overdueTile'), value: i18n.int(summary.overdue.contracts), sub: money2(i18n, summary.overdue.amount), bad: summary.overdue.contracts > 0 },
    { label: t('collectedMonth'), value: money2(i18n, summary.collectedThisMonth), sub: '' }
  ] : [];

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('insHelp')}</p>
      {summary && !summary.available && <div className="alert">{t('insNeedsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
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
        {summary?.available && <a className="btn primary" href={href('new-installment')}><Icon name="plus" size={16} />{t('insNew')}</a>}
        <a className="btn" href={href('guarantors')}><Icon name="idcard" size={16} />{t('guarantors')}</a>
        <a className="btn" href={href('installments-aging')}><Icon name="chart" size={16} />{t('aging')}</a>
        <span className="spacer" />
        <input className="input" style={{ width: 240 }} type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="row">
        <div className="track">
          {(['', 'active', 'overdue', 'paid', 'cancelled'] as const).map((s) => (
            <button key={s || 'all'} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s ? t(`cs_${s}`) : t('all')}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card">{data && <ContractsTable contracts={data} />}</div>
    </div>
  );
}

export function ContractsTable({ contracts }: { contracts: ContractSummaryView[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!contracts.length) return <div className="pad muted">{t('noContracts')}</div>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{t('contract')}</th><th>{t('customer')}</th><th>{t('whatSold')}</th><th>{t('nextDue')}</th>
          <th className="amount">{t('remainingAmt')}</th><th />
        </tr>
      </thead>
      <tbody>
        {contracts.map((c) => (
          <tr key={c.id} className="click" onClick={() => go(`installment/${c.id}`)}>
            <td><a className="ltr num" href={href(`installment/${c.id}`)} onClick={(e) => e.stopPropagation()}>{c.number}</a><div className="muted small num">{i18n.date(c.date)}</div></td>
            <td>{c.party.name}{c.guarantor && <div className="muted small">{t('guarantor')}: {c.guarantor.name}</div>}</td>
            <td>{c.description}</td>
            <td className="num">
              {c.next ? <>{i18n.date(c.next.dueDate)} · {i18n.money(c.next.amount, c.currency)}</> : '—'}
              {c.next && c.next.daysLate > 0 && c.status !== 'cancelled' && <div className="small" style={{ color: 'var(--bad)' }}>{t('lateDays', { n: c.next.daysLate })}</div>}
            </td>
            <td className="amount">{i18n.money(c.remaining, c.currency)}</td>
            <td><ContractChip status={c.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------- one contract (and its print) ---------- */

export function InstallmentDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, reloadAccounts } = useData();
  const { data, error, reload } = useLoad(() => api.installment(id), [id]);
  const [modal, setModal] = useState<'collect' | 'cancel' | 'edit' | null>(null);

  if (error) return error instanceof ApiError && error.status === 404 && error.code === 'not_found' && !(error.details as { what?: string } | null)?.what ? <NotAvailable /> : <ErrorBox error={error} />;
  if (!data) return null;
  const c = data;
  const company = settings ? i18n.name(settings.companyName) : '';
  const monthly = c.schedule.find((r) => r.seq === 1)?.amount ?? 0;
  const wa = whatsappNumber(c.party.phone);
  const late = c.schedule.find((r) => r.state === 'overdue') ?? c.schedule.find((r) => r.state !== 'paid');
  const reminder = wa && late && c.status !== 'cancelled' && c.status !== 'paid'
    ? `https://wa.me/${wa}?text=${encodeURIComponent(t('remindText', { company, date: i18n.date(late.dueDate), amount: i18n.money(late.amount - late.paid, c.currency), contract: c.number }))}`
    : null;

  const done = async (message?: string) => {
    setModal(null);
    await reloadAccounts();
    if (message) toast(message);
    reload();
  };

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <div className="row no-print">
        <button type="button" className="btn" onClick={() => history.back()}>{t('back')}</button>
        <span className="spacer" />
        {c.actions.includes('collect') && <button type="button" className="btn primary" onClick={() => setModal('collect')}><Icon name="receipt" size={16} />{t('collect')}</button>}
        {reminder && <a className="btn" href={reminder} target="_blank" rel="noopener noreferrer"><Icon name="mail" size={16} />{t('remind')}</a>}
        {c.actions.includes('edit') && <button type="button" className="btn" onClick={() => setModal('edit')}><Icon name="edit" size={16} />{t('editContract')}</button>}
        {c.actions.includes('cancel') && <button type="button" className="btn danger" onClick={() => setModal('cancel')}><Icon name="undo" size={16} />{t('cancelContract')}</button>}
        <button type="button" className="btn" onClick={() => window.print()}><Icon name="printer" size={16} />{t('printContract')}</button>
      </div>

      <div className="grid-4 no-print">
        <div className="card pad tile"><div className="label">{t('contractTotal')}</div><div className="value num">{i18n.money(c.total, c.currency)}</div></div>
        <div className="card pad tile"><div className="label">{t('paidAmt')}</div><div className="value num" style={{ color: 'var(--ok)' }}>{i18n.money(c.paid, c.currency)}</div></div>
        <div className="card pad tile"><div className="label">{t('remainingAmt')}</div><div className="value num">{i18n.money(c.remaining, c.currency)}</div></div>
        <div className="card pad tile"><div className="label">{t('overdueAmt')}</div><div className="value num" style={c.overdue ? { color: 'var(--bad)' } : undefined}>{i18n.money(c.overdue, c.currency)}</div></div>
      </div>

      <div className="paper">
        <div className="paper-head">
          <div style={{ flex: 1 }}>
            <div className="company-line">{company}</div>
            <div className="paper-title">{t('insTitle')}</div>
            <div style={{ marginTop: 4 }} className="no-print"><ContractChip status={c.status} /></div>
            {c.status === 'cancelled' && <div className="print-only" style={{ color: 'var(--bad)', fontWeight: 700 }}>{t('cs_cancelled')}</div>}
          </div>
          <div className="paper-meta">
            <span className="muted">{t('number')}</span><strong className="ltr">{c.number}</strong>
            <span className="muted">{t('date')}</span><strong className="num">{i18n.date(c.date)}</strong>
            {c.invoice && <><span className="muted">{t('sale')}</span><strong><a className="ltr" href={href(`invoice/${c.invoice.id}`)}>{c.invoice.number}</a></strong></>}
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: 14 }}>
          <div>
            <div className="muted small">{t('insBuyer')}</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}><a href={href(`party/${c.party.id}`)}>{c.party.name}</a></div>
            {c.party.phone && <div className="small"><span className="ltr">{i18n.digitsOf(c.party.phone)}</span></div>}
            {c.party.address && <div className="small">{c.party.address}</div>}
          </div>
          <div>
            <div className="muted small">{t('guarantor')}</div>
            {c.guarantor ? (
              <>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{c.guarantor.name}</div>
                {c.guarantor.phone && <div className="small"><span className="ltr">{i18n.digitsOf(c.guarantor.phone)}</span></div>}
                {c.guarantor.idNumber && <div className="small">{t('idNumber')}: <span className="ltr">{i18n.digitsOf(c.guarantor.idNumber)}</span></div>}
                {c.guarantor.workplace && <div className="small">{t('workplace')}: {c.guarantor.workplace}</div>}
                {c.guarantor.address && <div className="small">{c.guarantor.address}</div>}
              </>
            ) : <div className="muted">{t('noGuarantor')}</div>}
          </div>
        </div>

        <div className="stack" style={{ gap: 6, marginBottom: 14 }}>
          <div><span className="muted">{t('whatSold')}: </span><strong>{c.description}</strong></div>
          <div className="totals" style={{ maxWidth: 420 }}>
            <span className="muted">{t('contractTotal')}</span><strong className="num">{i18n.money(c.total, c.currency)}</strong>
            {c.downPayment > 0 && <><span className="muted">{t('downPayment')}</span><span className="num">{i18n.money(c.downPayment, c.currency)}</span></>}
            <span className="muted">{t('monthsCount')}</span><span className="num">{i18n.int(c.months)}</span>
            <span className="muted">{t('monthly')}</span><span className="num">{i18n.money(monthly, c.currency)}</span>
          </div>
          <div className="small"><span className="muted">{t('inWords')}: </span>{i18n.digitsOf(amountInWords(c.total, c.currency, i18n.lang))}</div>
        </div>

        <h3 style={{ margin: '4px 0 6px' }}>{t('schedule')}</h3>
        <table className="table">
          <thead>
            <tr><th style={{ width: 60 }}>{t('installmentNo')}</th><th>{t('dueDate')}</th><th className="amount">{t('amount')}</th><th className="amount no-print">{t('paidAmt')}</th><th className="no-print" /></tr>
          </thead>
          <tbody>
            {c.schedule.map((r) => (
              <tr key={r.seq}>
                <td className="num">{r.seq === 0 ? t('downPayment') : i18n.int(r.seq)}</td>
                <td className="num">{i18n.date(r.dueDate)}</td>
                <td className="amount">{i18n.money(r.amount, c.currency)}</td>
                <td className="amount no-print">{r.paid ? i18n.money(r.paid, c.currency) : '—'}</td>
                <td className="no-print">
                  {c.status !== 'cancelled' && <span className={'chip ' + ROW_CHIP[r.state]}>{t(`is_${r.state}`)}</span>}
                  {r.state === 'overdue' && <span className="small" style={{ color: 'var(--bad)', marginInlineStart: 6 }}>{t('lateDays', { n: r.daysLate })}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="small" style={{ marginBottom: 6 }}>{t('insAgreement')}</p>
        {c.guarantor && (
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', marginTop: 8 }}>
            <strong>{t('insPledgeTitle')}</strong>
            <p className="small" style={{ margin: '4px 0 0' }}>{t('insPledge')}</p>
          </div>
        )}
        {c.notes && <p className="small"><span className="muted">{t('notes')}: </span>{c.notes}</p>}

        <div className="sigs" style={{ gridTemplateColumns: `repeat(${c.guarantor ? 3 : 2}, minmax(0, 1fr))` }}>
          <div className="sig"><div className="muted small">{t('sigBuyer')}</div><div className="who">{c.party.name}</div></div>
          {c.guarantor && <div className="sig"><div className="muted small">{t('sigGuarantor')}</div><div className="who">{c.guarantor.name}</div></div>}
          <div className="sig done"><div className="muted small">{t('sigCompany')}</div><div className="who">{c.createdBy}</div></div>
        </div>
      </div>

      {c.receipts.length > 0 && (
        <div className="card no-print">
          <div style={{ padding: '14px 16px 6px' }}><h2>{t('receiptsTitle')}</h2></div>
          <table className="table">
            <tbody>
              {c.receipts.map((r) => (
                <tr key={r.entryId} className="click" onClick={() => go(`entry/${r.entryId}`)}>
                  <td><a className="ltr num" href={href(`entry/${r.entryId}`)} onClick={(e) => e.stopPropagation()}>{r.number}</a></td>
                  <td className="num">{i18n.date(r.date)}</td>
                  <td className="amount">{i18n.money(r.amount, c.currency)}</td>
                  <td>{r.reversed && <span className="chip bad">{t('reversedTag')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === 'collect' && <CollectModal contract={c} onClose={() => setModal(null)} onDone={(n) => void done(t('collected', { n }))} />}
      {modal === 'edit' && <EditModal contract={c} onClose={() => setModal(null)} onDone={() => void done(t('saved'))} />}
      {modal === 'cancel' && <CancelModal contract={c} onClose={() => setModal(null)} onDone={() => void done(t('cs_cancelled'))} />}
    </div>
  );
}

function CollectModal({ contract: c, onClose, onDone }: { contract: ContractView; onClose(): void; onDone(number: string): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState<number | null>(c.next?.amount ?? c.remaining);
  const [cashAccount, setCashAccount] = useState(settings?.postingAccounts.cash ?? '');
  const [rate, setRate] = useState(String(rateFromX100(settings?.defaultRateX100 ?? 142000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const rateX100 = Math.round(Number(toWesternDigits(rate).replace(/,/g, '')) * 100);
      const after = await api.collectInstallment(c.id, {
        date, amount: amount ?? 0, cashAccountCode: cashAccount, lang: i18n.lang, ...(c.currency === 'USD' ? { rateX100 } : {})
      });
      onDone(after.receipts[after.receipts.length - 1]?.number ?? '');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={`${t('collect')} — ${c.number}`} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('collectHelp')}</p>
        <div className="grid-2">
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>{t('amount')} <span className="muted small">({t('remainingAmt')}: {i18n.money(c.remaining, c.currency)})</span></span><AmountInput value={amount} currency={c.currency} onChange={setAmount} ariaLabel={t('amount')} /></label>
          <div className="field"><span>{t('cashAccount')}</span><AccountCombo value={cashAccount} onChange={setCashAccount} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} /></div>
          {c.currency === 'USD' && <label className="field"><span>{t('exchangeRate')}</span><input className="input num ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>}
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !amount || !cashAccount} onClick={() => void submit()}><Icon name="check" size={16} />{t('collect')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function EditModal({ contract: c, onClose, onDone }: { contract: ContractView; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const guarantors = useLoad(() => api.guarantors(), []);
  const [description, setDescription] = useState(c.description);
  const [guarantorId, setGuarantorId] = useState(c.guarantor?.id ?? '');
  const [notes, setNotes] = useState(c.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const options: PickOption[] = (guarantors.data ?? []).map((g) => ({ id: g.id, code: '', label: g.name, search: `${g.phone} ${g.idNumber}` }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.updateInstallment(c.id, { description, guarantorId: guarantorId || null, notes });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={`${t('editContract')} — ${c.number}`} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('editContractHelp')}</p>
        <label className="field"><span>{t('whatSold')}</span><input className="input" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <div className="field"><span>{t('guarantor')}</span><SearchCombo value={guarantorId} options={options} onChange={setGuarantorId} placeholder={t('guarantor')} emptyLabel={t('noGuarantor')} /></div>
        <label className="field"><span>{t('notes')}</span><textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function CancelModal({ contract: c, onClose, onDone }: { contract: ContractView; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.cancelInstallment(c.id, reason.trim());
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t('cancelContract')} — ${c.number}`} onClose={onClose}>
      <div className="stack">
        <p style={{ margin: 0 }}>{t('cancelContractHelp')}</p>
        <label className="field"><span>{t('cancelReason')}</span><input className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn danger" disabled={busy} onClick={() => void submit()}>{t('confirm')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- new contract ---------- */

const nextMonth = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

export function InstallmentEditor({ invoiceId: fromInvoice }: { invoiceId?: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const toast = useToast();
  const [summary, setSummary] = useState<InstallmentsSummaryView | null>(null);
  const [absent, setAbsent] = useState(false);
  const customers = useLoad(() => api.parties({ type: 'customer', active: 'true' }), []);
  const guarantors = useLoad(() => api.guarantors().catch(() => [] as GuarantorView[]), []);
  const [partyId, setPartyId] = useState('');
  const [source, setSource] = useState<'invoice' | 'balance'>('invoice');
  const [invoiceId, setInvoiceId] = useState(fromInvoice ?? '');
  const [sales, setSales] = useState<InvoiceSummary[]>([]);
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  const [total, setTotal] = useState<number | null>(null);
  const [down, setDown] = useState<number | null>(0);
  const [collectDown, setCollectDown] = useState(true);
  const [cashAccount, setCashAccount] = useState(settings?.postingAccounts.cash ?? '');
  const [months, setMonths] = useState('12');
  const [firstDue, setFirstDue] = useState(nextMonth(todayIso()));
  const [guarantorMode, setGuarantorMode] = useState<'new' | 'existing' | 'none'>('new');
  const [guarantorId, setGuarantorId] = useState('');
  const [g, setG] = useState<GuarantorInput>({ name: '', phone: '', idNumber: '', address: '', workplace: '' });
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<{ seq: number; dueDate: string; amount: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.installmentsSummary().then(setSummary, (e) => { if (e instanceof ApiError && e.status === 404) setAbsent(true); });
  }, []);
  useEffect(() => { if (!cashAccount && settings) setCashAccount(settings.postingAccounts.cash); }, [settings, cashAccount]);

  // from an invoice: its customer, currency, amount, date and what was sold
  useEffect(() => {
    if (!fromInvoice) return;
    api.invoice(fromInvoice).then((v) => {
      setPartyId(v.partyId ?? '');
      setCurrency(v.currency);
      setTotal(v.total);
      if (v.date > todayIso()) setDate(v.date);
      setDescription(v.lines.map((l) => i18n.name(l.itemName)).join(i18n.lang === 'en' ? ', ' : '، '));
    }, setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromInvoice]);

  // the customer's posted credit sales, to choose from
  useEffect(() => {
    if (!partyId || source !== 'invoice') { setSales([]); return; }
    api.invoices({ kind: 'sale', status: 'posted', partyId }).then((list) => setSales(list.filter((v) => v.payment === 'credit')), () => setSales([]));
  }, [partyId, source]);

  function pickInvoice(id: string) {
    setInvoiceId(id);
    const v = sales.find((s) => s.id === id);
    if (!v) return;
    setCurrency(v.currency);
    setTotal(v.total);
    api.invoice(id).then((full) => setDescription(full.lines.map((l) => i18n.name(l.itemName)).join(i18n.lang === 'en' ? ', ' : '، ')), () => undefined);
  }

  const monthsN = Number(toWesternDigits(months)) || 0;
  const terms = useMemo(() => ({ date, firstDue, total: total ?? 0, downPayment: down ?? 0, months: monthsN, currency }), [date, firstDue, total, down, monthsN, currency]);
  useEffect(() => {
    if (!terms.total || !terms.months) { setPreview(null); return; }
    const timer = window.setTimeout(() => {
      api.previewInstallments(terms).then(setPreview, () => setPreview(null));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [terms]);

  if (absent) return <NotAvailable />;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createInstallment({
        ...terms, partyId, description, lang: i18n.lang,
        ...(source === 'invoice' && invoiceId ? { invoiceId } : {}),
        ...(guarantorMode === 'existing' && guarantorId ? { guarantorId } : {}),
        ...(guarantorMode === 'new' ? { guarantor: g } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...((down ?? 0) > 0 && collectDown ? { downPaymentCashAccount: cashAccount } : {}),
        ...(currency === 'USD' && settings ? { rateX100: settings.defaultRateX100 } : {})
      });
      toast(created.number);
      go(`installment/${created.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const customerOptions: PickOption[] = (customers.data ?? []).map((p: PartyView) => ({ id: p.id, code: p.code, label: p.name, search: p.phone }));
  const guarantorOptions: PickOption[] = (guarantors.data ?? []).map((x) => ({ id: x.id, code: '', label: x.name, search: `${x.phone} ${x.idNumber}` }));
  const saleOptions: PickOption[] = sales.map((v) => ({ id: v.id, code: v.number ?? '', label: i18n.date(v.date), hint: i18n.money(v.total, v.currency) }));

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      {summary && !summary.available && <div className="alert">{t('insNeedsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      <div className="card pad stack">
        <div className="grid-2">
          <div className="field"><span>{t('customer')}</span><SearchCombo value={partyId} options={customerOptions} onChange={(id) => { setPartyId(id); setInvoiceId(''); }} placeholder={t('customer')} /></div>
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <div className="field">
          <span>{t('scheduleSource')}</span>
          <div className="track">
            <button type="button" aria-pressed={source === 'invoice'} onClick={() => setSource('invoice')}>{t('fromInvoice')}</button>
            <button type="button" aria-pressed={source === 'balance'} onClick={() => { setSource('balance'); setInvoiceId(''); }}>{t('fromBalance')}</button>
          </div>
        </div>
        {source === 'invoice' && partyId && (
          sales.length ? <div className="field"><span>{t('chooseInvoice')}</span><SearchCombo value={invoiceId} options={saleOptions} onChange={pickInvoice} placeholder={t('chooseInvoice')} /></div>
            : <div className="muted small">{t('noCreditSales')}</div>
        )}
        {source === 'balance' && <div className="muted small">{t('fromBalanceHelp')}</div>}
        <label className="field"><span>{t('whatSold')}</span><input className="input" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <div className="grid-3">
          <label className="field">
            <span>{t('currency')}</span>
            <select className="input" value={currency} disabled={source === 'invoice' && !!invoiceId} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
              <option value="IQD">IQD</option><option value="USD">USD</option>
            </select>
          </label>
          <label className="field"><span>{t('contractTotal')}</span><AmountInput value={total} currency={currency} onChange={setTotal} ariaLabel={t('contractTotal')} /></label>
          <label className="field"><span>{t('downPayment')}</span><AmountInput value={down} currency={currency} onChange={setDown} ariaLabel={t('downPayment')} /></label>
          <label className="field"><span>{t('monthsCount')}</span><input className="input num ltr" inputMode="numeric" maxLength={3} value={months} onChange={(e) => setMonths(toWesternDigits(e.target.value).replace(/\D/g, ''))} /></label>
          <label className="field"><span>{t('firstDue')}</span><input className="input" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></label>
        </div>
        {(down ?? 0) > 0 && (
          <div className="row">
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={collectDown} onChange={(e) => setCollectDown(e.target.checked)} /> {t('collectDownNow')}</label>
            {collectDown && <div style={{ minWidth: 280 }}><AccountCombo value={cashAccount} onChange={setCashAccount} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} /></div>}
          </div>
        )}
      </div>

      <div className="card pad stack">
        <h2>{t('guarantor')}</h2>
        <div className="track">
          <button type="button" aria-pressed={guarantorMode === 'new'} onClick={() => setGuarantorMode('new')}>{t('newGuarantor')}</button>
          <button type="button" aria-pressed={guarantorMode === 'existing'} onClick={() => setGuarantorMode('existing')}>{t('guarantors')}</button>
          <button type="button" aria-pressed={guarantorMode === 'none'} onClick={() => setGuarantorMode('none')}>{t('noGuarantor')}</button>
        </div>
        {guarantorMode === 'existing' && <SearchCombo value={guarantorId} options={guarantorOptions} onChange={setGuarantorId} placeholder={t('guarantor')} />}
        {guarantorMode === 'new' && <GuarantorFields value={g} onChange={setG} />}
        <label className="field"><span>{t('notes')}</span><textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>

      {preview && (
        <div className="card">
          <div style={{ padding: '14px 16px 6px' }}><h2>{t('preview')}</h2></div>
          <table className="table">
            <tbody>
              {preview.map((r) => (
                <tr key={r.seq}>
                  <td className="num" style={{ width: 120 }}>{r.seq === 0 ? t('downPayment') : i18n.int(r.seq)}</td>
                  <td className="num">{i18n.date(r.dueDate)}</td>
                  <td className="amount">{i18n.money(r.amount, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ErrorBox error={error} />
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !partyId || !total} onClick={() => void submit()}><Icon name="check" size={16} />{t('createContract')}</button>
        <button type="button" className="btn" onClick={() => history.back()}>{t('cancel')}</button>
      </div>
    </div>
  );
}

function GuarantorFields({ value, onChange }: { value: GuarantorInput; onChange(v: GuarantorInput): void }) {
  const { t } = useI18n();
  const set = (k: keyof GuarantorInput) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid-2">
      <label className="field"><span>{t('guarantorName')}</span><input className="input" maxLength={200} value={value.name} onChange={set('name')} /></label>
      <label className="field"><span>{t('phone')}</span><input className="input ltr" maxLength={50} value={value.phone ?? ''} onChange={set('phone')} /></label>
      <label className="field"><span>{t('idNumber')}</span><input className="input ltr" maxLength={50} value={value.idNumber ?? ''} onChange={set('idNumber')} /></label>
      <label className="field"><span>{t('workplace')}</span><input className="input" maxLength={200} value={value.workplace ?? ''} onChange={set('workplace')} /></label>
      <label className="field" style={{ gridColumn: '1 / -1' }}><span>{t('address')}</span><input className="input" maxLength={300} value={value.address ?? ''} onChange={set('address')} /></label>
    </div>
  );
}

/* ---------- guarantors ---------- */

export function Guarantors() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api.guarantors(), []);
  const [editing, setEditing] = useState<GuarantorView | 'new' | null>(null);
  const [form, setForm] = useState<GuarantorInput>({ name: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);

  if (error instanceof ApiError && error.status === 404) return <NotAvailable />;

  function open(g: GuarantorView | 'new') {
    setEditing(g);
    setFormError(null);
    setForm(g === 'new' ? { name: '' } : { name: g.name, phone: g.phone, idNumber: g.idNumber, address: g.address, workplace: g.workplace, notes: g.notes });
  }

  async function save() {
    setBusy(true);
    setFormError(null);
    try {
      if (editing === 'new') await api.createGuarantor(form);
      else if (editing) await api.updateGuarantor(editing.id, form);
      toast(t('saved'));
      setEditing(null);
      reload();
    } catch (e) {
      setFormError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove(g: GuarantorView) {
    if (!window.confirm(t('confirmDelete'))) return;
    setBusy(true);
    try {
      await api.deleteGuarantor(g.id);
      setEditing(null);
      reload();
    } catch (e) {
      setFormError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="btn primary" onClick={() => open('new')}><Icon name="plus" size={16} />{t('newGuarantor')}</button>
        <a className="btn" href={href('installments')}>{t('installments')}</a>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {data && (
          <table className="table">
            <thead>
              <tr><th>{t('name')}</th><th>{t('phone')}</th><th>{t('idNumber')}</th><th>{t('workplace')}</th><th className="amount">{t('standsFor')}</th></tr>
            </thead>
            <tbody>
              {data.map((g) => (
                <tr key={g.id} className="click" onClick={() => open(g)}>
                  <td>{g.name}</td>
                  <td><span className="ltr">{i18n.digitsOf(g.phone)}</span></td>
                  <td><span className="ltr">{i18n.digitsOf(g.idNumber)}</span></td>
                  <td>{g.workplace}</td>
                  <td className="amount">{g.contracts ? <>{t('contractsN', { n: g.contracts })} · {money2(i18n, g.exposure)}</> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <Modal title={editing === 'new' ? t('newGuarantor') : editing.name} onClose={() => setEditing(null)}>
          <div className="stack">
            <GuarantorFields value={form} onChange={setForm} />
            <label className="field"><span>{t('notes')}</span><textarea className="input" rows={2} maxLength={1000} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            <ErrorBox error={formError} />
            <div className="row">
              <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{t('save')}</button>
              {editing !== 'new' && editing.contracts === 0 && <button type="button" className="btn danger" disabled={busy} onClick={() => void remove(editing)}>{t('actDelete')}</button>}
              <button type="button" className="btn" onClick={() => setEditing(null)}>{t('cancel')}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------- aging ---------- */

export function InstallmentsAging() {
  const i18n = useI18n();
  const { t } = i18n;
  const { data, error } = useLoad(() => api.installmentsAging(), []);
  if (error instanceof ApiError && error.status === 404) return <NotAvailable />;
  return (
    <div className="stack">
      <div className="row no-print">
        <a className="btn" href={href('installments')}>{t('installments')}</a>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => window.print()}><Icon name="printer" size={16} />{t('print')}</button>
      </div>
      <ErrorBox error={error} />
      {data && (
        <div className="card">
          {data.rows.length === 0 ? <div className="pad muted">{t('noOverdue')}</div> : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('contract')}</th><th>{t('customer')}</th><th>{t('guarantor')}</th>
                  {BUCKETS.map((b) => <th key={b} className="amount">{t(`ag_${b}`)}</th>)}
                  <th className="amount">{t('overdueAmt')}</th><th className="amount">{t('oldestLate')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.contract.id} className="click" onClick={() => go(`installment/${r.contract.id}`)}>
                    <td><a className="ltr num" href={href(`installment/${r.contract.id}`)} onClick={(e) => e.stopPropagation()}>{r.contract.number}</a></td>
                    <td>{r.contract.party.name}{r.contract.party.phone && <div className="muted small ltr">{i18n.digitsOf(r.contract.party.phone)}</div>}</td>
                    <td>{r.contract.guarantor?.name ?? '—'}</td>
                    {BUCKETS.map((b) => <td key={b} className="amount">{r.buckets[b] ? i18n.money(r.buckets[b], r.contract.currency) : '—'}</td>)}
                    <td className="amount"><strong>{i18n.money(r.total, r.contract.currency)}</strong></td>
                    <td className="amount">{t('lateDays', { n: r.oldestDays })}</td>
                  </tr>
                ))}
                {(['IQD', 'USD'] as const).filter((cur) => BUCKETS.some((b) => data.totals[cur][b])).map((cur) => (
                  <tr key={cur} className="total-row">
                    <td colSpan={3}><strong>{t('total')} ({cur})</strong></td>
                    {BUCKETS.map((b) => <td key={b} className="amount"><strong>{i18n.money(data.totals[cur][b], cur)}</strong></td>)}
                    <td className="amount"><strong>{i18n.money(BUCKETS.reduce((s, b) => s + data.totals[cur][b], 0), cur)}</strong></td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
