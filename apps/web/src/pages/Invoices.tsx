import { useEffect, useMemo, useState } from 'react';
import {
  amountInWords, invoiceTotals, lineAmount, rateFromX100, roundHalfUp, toBase, todayIso, toWesternDigits,
  type CurrencyCode, type InvoiceDocKind, type InvoiceInput, type InvoiceKind, type InvoiceStatus, type PaymentMode
} from '@qasa/core';
import { api, ApiError, type InvoiceView, type ItemView } from '../api.ts';
import {
  AccountCombo, AmountInput, ErrorBox, Icon, InvoiceStatusChip, Modal, QtyInput, SearchCombo, useData, useLoad, useToast, type PickOption
} from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { go, href } from '../router.ts';
import { InvoicesTable } from './Parties.tsx';
import { averageCost, qtyText, unitName } from './Items.tsx';

const STATUSES: (InvoiceStatus | '')[] = ['', 'draft', 'posted', 'cancelled'];

const isReturnKind = (kind: InvoiceDocKind) => kind === 'sale_return' || kind === 'purchase_return';

/** فواتير المبيعات / فواتير الشراء / المردودات */
export function Invoices({ kind }: { kind: InvoiceDocKind }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const [q, setQ] = useState('');
  const { data, error } = useLoad(() => api.invoices({ kind, status, q: q.trim() }), [kind, status, q]);
  return (
    <div className="stack">
      <div className="row">
        {isReturnKind(kind) ? <span className="muted">{t('returnsHelp')}</span> : (
          <>
            <a className="btn primary" href={href(`new-invoice/${kind}`)}><Icon name="plus" size={16} />{kind === 'sale' ? t('newSale') : t('newPurchase')}</a>
            <a className="btn" href={href(kind === 'sale' ? 'customers' : 'suppliers')}>{kind === 'sale' ? t('customers') : t('suppliers')}</a>
          </>
        )}
        <span className="spacer" />
        <input className="input" style={{ width: 240 }} type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="row">
        <div className="track">
          {STATUSES.filter((s) => !isReturnKind(kind) || s !== 'draft').map((s) => <button key={s || 'all'} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s ? t(s) : t('all')}</button>)}
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card">{data && <InvoicesTable invoices={data} />}</div>
    </div>
  );
}

/* ---------- editor ---------- */

interface Row { key: number; itemId: string; qtyMilli: number | null; unitPrice: number | null; description: string }
let rowKey = 1;
const emptyRow = (): Row => ({ key: rowKey++, itemId: '', qtyMilli: 1000, unitPrice: null, description: '' });

function parseRate(text: string): number | null {
  const s = toWesternDigits(text).replace(/[,٬\s]/g, '').replace('٫', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const value = Math.round(Number(s) * 100);
  return value > 0 ? value : null;
}

/** A price in one currency shown in another, at the invoice rate. */
function convert(amount: number, from: CurrencyCode, to: CurrencyCode, rateX100: number): number {
  if (from === to) return amount;
  return from === 'USD' ? toBase(amount, 'USD', rateX100) : roundHalfUp((amount * 10000) / rateX100);
}

export function InvoiceEditor({ kind: initialKind, id, partyId: initialParty }: { kind?: InvoiceKind; id?: string; partyId?: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, reloadAccounts } = useData();
  const [kind, setKind] = useState<InvoiceKind>(initialKind ?? 'sale');
  const [savedId, setSavedId] = useState<string | undefined>(id);
  const [ready, setReady] = useState(!id);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [date, setDate] = useState(todayIso());
  const [partyId, setPartyId] = useState(initialParty ?? '');
  const [warehouseId, setWarehouseId] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  const [rateText, setRateText] = useState('');
  const [payment, setPayment] = useState<PaymentMode>(initialParty || initialKind === 'purchase' ? 'credit' : 'cash');
  const [cashAccount, setCashAccount] = useState('');
  const [discount, setDiscount] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>(() => [emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const partyType = kind === 'sale' ? 'customer' : 'supplier';
  const parties = useLoad(() => api.parties({ type: partyType, active: 'true' }), [partyType]);
  const warehouses = useLoad(() => api.warehouses(), []);
  const items = useLoad(() => api.items({ active: 'true', ...(warehouseId ? { warehouseId } : {}) }), [warehouseId]);

  useEffect(() => {
    if (id) return;
    if (!rateText && settings) setRateText(String(rateFromX100(settings.defaultRateX100)));
    if (!cashAccount && settings) setCashAccount(settings.postingAccounts.cash);
  }, [id, settings, rateText, cashAccount]);

  useEffect(() => {
    if (!warehouseId && warehouses.data?.[0]) setWarehouseId(warehouses.data.find((w) => w.active)?.id ?? warehouses.data[0].id);
  }, [warehouses.data, warehouseId]);

  useEffect(() => {
    if (!id) return;
    api.invoice(id).then((v: InvoiceView) => {
      if (!v.actions.includes('edit') || isReturnKind(v.kind)) { go(`invoice/${v.id}`); return; }
      setKind(v.kind as InvoiceKind);
      setDate(v.date);
      setPartyId(v.partyId ?? '');
      setWarehouseId(v.warehouseId);
      setCurrency(v.currency);
      setRateText(String(rateFromX100(v.currency === 'USD' ? v.rateX100 : settings?.defaultRateX100 ?? 142000)));
      setPayment(v.payment);
      setCashAccount(v.cashAccountCode ?? settings?.postingAccounts.cash ?? '');
      setDiscount(v.discount || null);
      setNotes(v.notes);
      setRows(v.lines.map((l) => ({ key: rowKey++, itemId: l.itemId, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, description: l.description })));
      setReady(true);
    }, setLoadError);
    // settings only fills blanks; loading once is enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const rateX100 = currency === 'USD' ? parseRate(rateText) : 100;
  const itemById = useMemo(() => new Map((items.data ?? []).map((it) => [it.id, it])), [items.data]);
  const lines = rows.filter((r) => r.itemId || r.unitPrice);
  const totals = invoiceTotals(lines.map((r) => ({ qtyMilli: r.qtyMilli ?? 0, unitPrice: r.unitPrice ?? 0 })), discount ?? 0);

  const partyOptions: PickOption[] = (parties.data ?? []).map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone, hint: p.balance ? i18n.money(p.balance, 'IQD') : '' }));
  const itemOptions: PickOption[] = (items.data ?? [])
    .filter((it) => kind === 'sale' || it.trackStock)
    .map((it) => ({
      id: it.id, code: it.code, label: i18n.name(it.name), search: `${it.name.ar} ${it.name.en} ${it.name.ku} ${it.barcode}`,
      hint: it.trackStock ? `${qtyText(i18n, it.qtyMilli)} ${unitName(i18n, it.unit)}` : unitName(i18n, it.unit)
    }));

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [emptyRow()]));

  function pickItem(key: number, itemId: string) {
    const it: ItemView | undefined = itemById.get(itemId);
    let price: number | null = null;
    if (it && rateX100) {
      price = kind === 'sale'
        ? convert(it.salePrice, it.saleCurrency, currency, rateX100)
        : it.qtyMilli > 0 ? convert(averageCost(it.qtyMilli, it.value), 'IQD', currency, rateX100) : null;
    }
    setRows((rs) => {
      const next = rs.map((r) => (r.key === key ? { ...r, itemId, unitPrice: price ?? r.unitPrice } : r));
      return next[next.length - 1]?.itemId ? [...next, emptyRow()] : next;
    });
  }

  function input(): InvoiceInput | null {
    if (!rateX100) {
      setError(new ApiError(400, 'validation', [{ code: 'rate_invalid' }]));
      return null;
    }
    return {
      kind, date, warehouseId, currency, rateX100, payment, discount: discount ?? 0, notes,
      ...(partyId ? { partyId } : {}),
      ...(payment === 'cash' ? { cashAccountCode: cashAccount } : {}),
      lines: lines.map((r) => ({ itemId: r.itemId, qtyMilli: r.qtyMilli ?? 0, unitPrice: r.unitPrice ?? 0, ...(r.description.trim() ? { description: r.description.trim() } : {}) }))
    };
  }

  async function save(post: boolean) {
    const body = input();
    if (!body) return;
    if (post && !window.confirm(t('postConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      const saved = savedId ? await api.updateInvoice(savedId, body) : await api.createInvoice(body);
      setSavedId(saved.id);
      if (post) {
        await api.postInvoice(saved.id);
        await reloadAccounts();
        toast(t('a_post'));
      } else {
        toast(t('saved'));
      }
      go(`invoice/${saved.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <ErrorBox error={loadError} />;
  if (!ready) return null;

  return (
    <div className="stack" style={{ maxWidth: 1180 }}>
      <div className="card pad stack">
        <h2 style={{ fontSize: 18 }}>{savedId ? `${t('editTitle')} — ${t(kind)}` : t(kind)}</h2>
        <div className="grid-3">
          <div className="field">
            <span>{kind === 'sale' ? t('customer') : t('supplier')}</span>
            <SearchCombo value={partyId} options={partyOptions} onChange={(v) => { setPartyId(v); if (!v) setPayment('cash'); }}
              placeholder={kind === 'sale' ? t('chooseCustomer') : t('chooseSupplier')} {...(kind === 'sale' ? { emptyLabel: t('walkIn') } : {})} />
          </div>
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field">
            <span>{t('warehouse')}</span>
            <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {(warehouses.data ?? []).filter((w) => w.active || w.id === warehouseId).map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
            </select>
          </label>
          <div className="field">
            <span>{t('paymentMode')}</span>
            <div className="track" style={{ alignSelf: 'flex-start' }}>
              <button type="button" aria-pressed={payment === 'cash'} onClick={() => setPayment('cash')}>{t('payCash')}</button>
              <button type="button" aria-pressed={payment === 'credit'} onClick={() => setPayment('credit')}>{t('payCredit')}</button>
            </div>
          </div>
          {payment === 'cash' ? (
            <div className="field">
              <span>{t('cashAccount')}</span>
              <AccountCombo value={cashAccount} onChange={setCashAccount} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} />
            </div>
          ) : <div />}
          <div className="field">
            <span>{t('currency')}</span>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <div className="track">
                {(['IQD', 'USD'] as const).map((c) => <button key={c} type="button" aria-pressed={currency === c} onClick={() => setCurrency(c)}>{c === 'IQD' ? t('iqdName') : t('usdName')}</button>)}
              </div>
              {currency === 'USD' && (
                <input className={'input amount' + (rateX100 ? '' : ' invalid')} style={{ width: 120 }} inputMode="decimal" aria-label={t('rate')} title={t('perUsd')} value={rateText} onChange={(e) => setRateText(e.target.value)} />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ padding: '14px 16px 8px' }}><h2>{t('invoiceLines')}</h2></div>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th style={{ width: '36%' }}>{t('item')}</th>
              <th className="amount" style={{ width: 120 }}>{t('qty')}</th>
              <th className="amount" style={{ width: 170 }}>{t('unitPrice')}</th>
              <th className="amount">{t('amount')}</th>
              <th>{t('lineNote')}</th>
              <th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const it = itemById.get(r.itemId);
              const short = kind === 'sale' && it?.trackStock && (r.qtyMilli ?? 0) > it.qtyMilli;
              return (
                <tr key={r.key}>
                  <td className="muted num">{i18n.int(i + 1)}</td>
                  <td>
                    <SearchCombo value={r.itemId} options={itemOptions} onChange={(v) => pickItem(r.key, v)} placeholder={t('chooseItem')} ariaLabel={t('item')} />
                    {short && <div className="small" style={{ color: 'var(--bad)', marginTop: 3 }}>{t('available')}: {qtyText(i18n, it.qtyMilli)}</div>}
                  </td>
                  <td>
                    <QtyInput value={r.qtyMilli} onChange={(v) => update(r.key, { qtyMilli: v })} ariaLabel={t('qty')} />
                    {it && <div className="muted small" style={{ textAlign: 'end', marginTop: 2 }}>{unitName(i18n, it.unit)}</div>}
                  </td>
                  <td><AmountInput value={r.unitPrice} currency={currency} onChange={(v) => update(r.key, { unitPrice: v })} ariaLabel={t('unitPrice')} /></td>
                  <td className="amount">{r.itemId ? i18n.money(invoiceTotals([{ qtyMilli: r.qtyMilli ?? 0, unitPrice: r.unitPrice ?? 0 }], 0).subtotal, currency) : ''}</td>
                  <td><input className="input" value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} aria-label={t('lineNote')} /></td>
                  <td><button type="button" className="btn icon danger" onClick={() => remove(r.key)} aria-label={t('removeLine')} title={t('removeLine')}><Icon name="x" size={16} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row" style={{ padding: '10px 16px 14px', alignItems: 'flex-start' }}>
          <button type="button" className="btn small" onClick={() => setRows((rs) => [...rs, emptyRow()])}><Icon name="plus" size={15} />{t('addLine')}</button>
          <span className="spacer" />
          <div className="totals">
            <span className="muted">{t('subtotal')}</span><strong className="num">{i18n.money(totals.subtotal, currency)}</strong>
            <span className="muted">{t('discount')}</span><div style={{ width: 170 }}><AmountInput value={discount} currency={currency} onChange={setDiscount} ariaLabel={t('discount')} /></div>
            <span>{t('totalDue')}</span><strong className="num" style={{ fontSize: 18 }}>{i18n.money(totals.total, currency)}</strong>
            {currency === 'USD' && rateX100 && <><span className="muted small">{t('iqdEquivalent')}</span><span className="num small">{i18n.money(toBase(totals.total, 'USD', rateX100), 'IQD')}</span></>}
          </div>
        </div>
      </div>

      {totals.total > 0 && (
        <div className="card pad">
          <div className="muted small">{t('inWords')}</div>
          <div className="words">{i18n.digitsOf(amountInWords(totals.total, currency, i18n.lang))}</div>
        </div>
      )}

      <label className="field"><span>{t('notes')}</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

      <ErrorBox error={error} />
      <div className="row">
        <button type="button" className="btn primary" onClick={() => save(true)} disabled={busy}><Icon name="check" size={16} />{t('actPost')}</button>
        <button type="button" className="btn" onClick={() => save(false)} disabled={busy}>{busy ? t('saving') : t('saveDraft')}</button>
        <button type="button" className="btn" onClick={() => history.back()}>{t('cancel')}</button>
      </div>
    </div>
  );
}

/* ---------- view & print ---------- */

export function InvoiceDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, plan, reloadAccounts } = useData();
  const { data, error, reload } = useLoad(() => api.invoice(id), [id]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [cancelling, setCancelling] = useState(false);
  const [returning, setReturning] = useState(false);
  const [cancelDate, setCancelDate] = useState(todayIso());

  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const v = data;
  const company = settings ? i18n.name(settings.companyName) : '';
  const totalCost = v.lines.reduce((s, l) => s + (l.cost ?? 0), 0);
  const isRet = isReturnKind(v.kind);
  const saleSide = v.kind === 'sale' || v.kind === 'sale_return';

  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await reloadAccounts();
      toast(message);
      setCancelling(false);
      reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t('confirmDelete'))) return;
    setBusy(true);
    try {
      await api.deleteInvoice(id);
      toast(t('a_delete'));
      go(saleSide ? 'sales' : 'purchases');
    } catch (e) {
      setActionError(e);
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <div className="row no-print">
        <button type="button" className="btn" onClick={() => history.back()}>{t('back')}</button>
        <span className="spacer" />
        {v.actions.includes('edit') && <a className="btn" href={href(`edit-invoice/${v.id}`)}>{t('actEdit')}</a>}
        {v.actions.includes('delete') && <button type="button" className="btn danger" disabled={busy} onClick={remove}>{t('actDelete')}</button>}
        {v.actions.includes('post') && (
          <button type="button" className="btn primary" disabled={busy} onClick={() => { if (window.confirm(t('postConfirm'))) void act(() => api.postInvoice(id), t('a_post')); }}>
            <Icon name="check" size={16} />{t('actPost')}
          </button>
        )}
        {v.actions.includes('return') && <button type="button" className="btn" disabled={busy} onClick={() => setReturning(true)}><Icon name="undo" size={16} />{t('actReturnItems')}</button>}
        {v.actions.includes('cancel') && <button type="button" className="btn danger" disabled={busy} onClick={() => setCancelling(true)}><Icon name="undo" size={16} />{t('actCancelInvoice')}</button>}
        <button type="button" className="btn" onClick={() => window.print()}><Icon name="printer" size={16} />{t('print')}</button>
      </div>
      <ErrorBox error={cancelling ? null : actionError} />
      {v.status === 'posted' && <div className="alert info no-print">{t('invoicePostedNote')}</div>}
      {v.status === 'posted' && !isRet && v.returns.some((r) => r.status === 'posted') && <div className="alert warn no-print">{t('hasReturnsNote')}</div>}

      <div className="paper invoice">
        <div className="paper-head">
          <div style={{ flex: 1 }}>
            <div className="company-line">{company}</div>
            <div className="paper-title">{t(v.kind)}</div>
            <div style={{ marginTop: 4 }} className="no-print"><InvoiceStatusChip status={v.status} /></div>
            {v.status === 'cancelled' && <div className="print-only" style={{ color: 'var(--bad)', fontWeight: 700 }}>{t('cancelled')}</div>}
          </div>
          <div className="paper-meta">
            <span className="muted">{t('number')}</span><strong className="ltr">{v.number ?? t('draft')}</strong>
            <span className="muted">{t('date')}</span><strong className="num">{i18n.date(v.date)}</strong>
            {isRet && v.returnOf && <><span className="muted">{t('returnFrom')}</span><strong><a className="ltr" href={href(`invoice/${v.returnOf}`)}>{v.returnOfNumber}</a></strong></>}
            <span className="muted">{t('paymentMode')}</span><strong>{isRet ? (v.payment === 'cash' ? t('refundCash') : t('refundCredit')) : v.payment === 'cash' ? t('payCash') : t('payCredit')}</strong>
            {v.currency === 'USD' && <><span className="muted">{t('exchangeRate')}</span><strong className="num">{i18n.digitsOf(String(rateFromX100(v.rateX100)))}</strong></>}
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: 14 }}>
          <div>
            <div className="muted small">{v.kind === 'sale' ? t('billTo') : saleSide ? t('customer') : t('supplier')}</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{v.partyName ?? t('walkIn')}</div>
            {v.partyPhone && <div className="small"><span className="ltr">{i18n.digitsOf(v.partyPhone)}</span></div>}
            {v.partyAddress && <div className="small">{v.partyAddress}</div>}
          </div>
          <div>
            <div className="muted small">{t('warehouse')}</div>
            <div>{i18n.name(v.warehouseName)}</div>
            {v.cashAccountName && <><div className="muted small" style={{ marginTop: 4 }}>{t('cashAccount')}</div><div>{i18n.name(v.cashAccountName)}</div></>}
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th><th style={{ width: 90 }}>{t('code')}</th><th>{t('item')}</th>
              <th className="amount">{t('qty')}</th><th className="amount">{t('unitPrice')}</th><th className="amount">{t('amount')}</th>
            </tr>
          </thead>
          <tbody>
            {v.lines.map((l) => (
              <tr key={l.lineNo}>
                <td className="num">{i18n.int(l.lineNo)}</td>
                <td><span className="ltr">{l.itemCode}</span></td>
                <td>{i18n.name(l.itemName)}{l.description && <div className="muted small">{l.description}</div>}</td>
                <td className="amount">
                  {qtyText(i18n, l.qtyMilli)} <span className="muted small">{unitName(i18n, l.unit)}</span>
                  {l.returnedQtyMilli > 0 && <div className="small no-print" style={{ color: 'var(--warn)' }}>{t('returnedQty')}: {qtyText(i18n, l.returnedQtyMilli)}</div>}
                </td>
                <td className="amount">{i18n.money(l.unitPrice, v.currency)}</td>
                <td className="amount">{i18n.money(l.amount, v.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="row" style={{ alignItems: 'flex-start', marginTop: 12 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="muted small">{t('inWords')}</div>
            <div className="words">{i18n.digitsOf(amountInWords(v.total, v.currency, i18n.lang))}</div>
            {v.notes && <p className="small" style={{ marginBottom: 0 }}><span className="muted">{t('notes')}: </span>{v.notes}</p>}
          </div>
          <div className="totals">
            <span className="muted">{t('subtotal')}</span><span className="num">{i18n.money(v.subtotal, v.currency)}</span>
            {v.discount > 0 && <><span className="muted">{t('discount')}</span><span className="num">− {i18n.money(v.discount, v.currency)}</span></>}
            <span style={{ fontWeight: 700 }}>{t('totalDue')}</span><strong className="num" style={{ fontSize: 18 }}>{i18n.money(v.total, v.currency)}</strong>
            {v.currency === 'USD' && <><span className="muted small">{t('iqdEquivalent')}</span><span className="num small">{i18n.money(v.baseTotal, 'IQD')}</span></>}
          </div>
        </div>

        <div className="sigs" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div className="sig done"><div className="muted small">{t('preparedBy')}</div><div className="who">{v.createdBy}</div></div>
          <div className="sig"><div className="muted small">{saleSide ? t('customer') : t('supplier')}</div><div className="who">&nbsp;</div></div>
        </div>
        {/* Required on Free by the license (NOTICE, additional term 1); Pro and Business remove it. */}
        {!plan?.features.includes('noBranding') && <div className="made-with">{t('madeWith')} · <span className="ltr">qasaerp.com</span></div>}
      </div>

      {(v.entryId || v.cancelEntryId) && (
        <div className="card pad no-print row">
          {v.entryId && <span>{t('postingEntry')}: <a href={href(`entry/${v.entryId}`)} className="ltr">{v.entryNumber}</a></span>}
          {v.cancelEntryId && <span>· {t('cancelEntry')}: <a href={href(`entry/${v.cancelEntryId}`)} className="ltr">{v.cancelEntryNumber}</a></span>}
          {v.kind === 'sale' && v.status === 'posted' && totalCost > 0 && (
            <span className="muted">· {t('costOfGoods')}: {i18n.money(totalCost, 'IQD')}</span>
          )}
        </div>
      )}

      {v.returns.length > 0 && (
        <div className="card no-print">
          <div style={{ padding: '14px 16px 6px' }}><h2>{t('returnsOfInvoice')}</h2></div>
          <table className="table">
            <tbody>
              {v.returns.map((r) => (
                <tr key={r.id} className="click" onClick={() => go(`invoice/${r.id}`)}>
                  <td><a className="ltr num" href={href(`invoice/${r.id}`)} onClick={(e) => e.stopPropagation()}>{r.number}</a></td>
                  <td className="num">{i18n.date(r.date)}</td>
                  <td className="amount">{i18n.money(r.total, v.currency)}</td>
                  <td><InvoiceStatusChip status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {returning && <ReturnModal invoice={v} onClose={() => setReturning(false)} />}

      {cancelling && (
        <Modal title={t('cancelTitle')} onClose={() => setCancelling(false)}>
          <div className="stack">
            <p style={{ margin: 0 }}>{t('cancelHelp')}</p>
            <label className="field"><span>{t('cancelDate')}</span><input className="input" type="date" value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} /></label>
            <ErrorBox error={actionError} />
            <div className="row">
              <button type="button" className="btn danger" disabled={busy} onClick={() => act(() => api.cancelInvoice(id, cancelDate), t('a_cancel'))}>{t('confirm')}</button>
              <button type="button" className="btn" onClick={() => setCancelling(false)}>{t('cancel')}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Takes goods back from a posted invoice (مردودات): pick the quantities, how the money goes back, and post. */
function ReturnModal({ invoice: v, onClose }: { invoice: InvoiceView; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, reloadAccounts } = useData();
  const today = todayIso();
  const [date, setDate] = useState(today < v.date ? v.date : today);
  const [payment, setPayment] = useState<PaymentMode>(v.partyId ? 'credit' : 'cash');
  const [cashAccount, setCashAccount] = useState(v.cashAccountCode ?? settings?.postingAccounts.cash ?? '');
  const [notes, setNotes] = useState('');
  const [qty, setQty] = useState<Record<number, number | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const lines = v.lines.map((l) => ({ ...l, left: l.qtyMilli - l.returnedQtyMilli })).filter((l) => l.left > 0);
  const chosen = lines.filter((l) => (qty[l.lineNo] ?? 0) > 0);
  const gross = chosen.reduce((sum, l) => sum + lineAmount(qty[l.lineNo]!, l.unitPrice), 0);

  async function submit() {
    if (chosen.length === 0) { setError(new ApiError(400, 'validation', [{ code: 'lines_required' }])); return; }
    if (!window.confirm(t('returnConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      const ret = await api.createReturn(v.id, {
        date, payment, lines: chosen.map((l) => ({ lineNo: l.lineNo, qtyMilli: qty[l.lineNo]! })),
        ...(payment === 'cash' ? { cashAccountCode: cashAccount } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {})
      });
      await reloadAccounts();
      toast(t('a_post'));
      go(`invoice/${ret.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={t('returnTitle', { n: v.number ?? '' })} onClose={onClose}>
      <div className="stack return-modal">
        <table className="table">
          <thead>
            <tr><th>{t('item')}</th><th className="amount">{t('qty')}</th><th className="amount">{t('canReturn')}</th><th className="amount" style={{ width: 130 }}>{t('returnQty')}</th></tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.lineNo}>
                <td>{i18n.name(l.itemName)}<div className="muted small">{i18n.money(l.unitPrice, v.currency)}</div></td>
                <td className="amount">{qtyText(i18n, l.qtyMilli)}</td>
                <td className="amount">{qtyText(i18n, l.left)}</td>
                <td><QtyInput value={qty[l.lineNo] ?? null} onChange={(value) => setQty((q) => ({ ...q, [l.lineNo]: value }))} ariaLabel={t('returnQty')} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid-2">
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} min={v.date} onChange={(e) => setDate(e.target.value)} /></label>
          <div className="field">
            <span>{t('paymentMode')}</span>
            <div className="track" style={{ alignSelf: 'flex-start' }}>
              {v.partyId && <button type="button" aria-pressed={payment === 'credit'} onClick={() => setPayment('credit')}>{t('refundCredit')}</button>}
              <button type="button" aria-pressed={payment === 'cash'} onClick={() => setPayment('cash')}>{t('refundCash')}</button>
            </div>
          </div>
          {payment === 'cash' && (
            <div className="field"><span>{t('cashAccount')}</span><AccountCombo value={cashAccount} onChange={setCashAccount} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} /></div>
          )}
          <label className="field"><span>{t('notes')}</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
        {gross > 0 && (
          <div className="muted">
            {t('subtotal')}: <strong className="num">{i18n.money(gross, v.currency)}</strong>
            {v.discount > 0 && <> · {t('discount')}</>}
          </div>
        )}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}><Icon name="undo" size={16} />{t('returnPost')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}
