import { useEffect, useMemo, useState } from 'react';
import { fromBaseQty, isUnit, lineAmount, rateFromX100, todayIso, toWesternDigits, type CurrencyCode } from '@qasa/core';
import { api } from '../api.ts';
import { EmptyState, AmountInput, ErrorBox, Icon, Modal, QtyInput, SearchCombo, useData, useLoad, useMay, usePageNav, useToast, type PickOption } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import {
  PO_STATUSES, purchasingApi, type PoInput, type PoMove, type PoStatus, type PoSummaryView, type PoView, type ReorderGroup
} from '../industry/purchasing-api.ts';
import { go, href } from '../router.ts';
import { PartyPicker } from '../industry/PartyPicker.tsx';
import { useRatePrefill } from '../industry/fx-prefill.ts';
import { convertLines } from './currency-switch.ts';
import { UnitPicker } from '../industry/UnitPicker.tsx';
import { baseQty, unitLabel, type LineUnit } from '../industry/units.ts';
import type { PoLineView } from '../industry/purchasing-api.ts';
import { printDocument } from '../industry/printing.ts';

/**
 * أوامر الشراء — purchase orders. Routes: `purchase-orders` (list + reorder suggestions), `new-purchase-order`,
 * `edit-purchase-order/:id` and `purchase-order/:id` (one order, printable on A4, with send / receive / cancel).
 */

const STATUS_CHIP: Record<PoStatus, string> = { draft: '', sent: 'info', partial: 'warn', received: 'ok', cancelled: 'bad' };
const st = (s: PoStatus) => `po_st_${s}` as Key;

/**
 * A base quantity of a purchase order line in the unit it was ordered in (2 boxes), as the ordered column shows it;
 * in the item's base unit, named, when it is not a whole number of thousandths of that unit (25 tablets of a box of 10).
 */
export function poQtyText(i18n: I18n, l: Pick<PoLineView, 'unit' | 'lineUnit' | 'unitFactorMilli'>, baseMilli: number): string {
  const inUnit = l.lineUnit && l.unitFactorMilli ? fromBaseQty(baseMilli, l.unitFactorMilli) : null;
  if (l.lineUnit && inUnit !== null) return `${i18n.qty(inUnit)} ${unitLabel(i18n, l.lineUnit)}`;
  return isUnit(l.unit) ? `${i18n.qty(baseMilli)} ${unitLabel(i18n, l.unit)}` : i18n.qty(baseMilli);
}

export function PoChip({ status, overdue }: { status: PoStatus; overdue?: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <span className={'chip ' + STATUS_CHIP[status]}>{t(st(status))}</span>
      {overdue && <span className="chip bad" style={{ marginInlineStart: 4 }}>{t('po_overdue')}</span>}
    </>
  );
}

/** A suggestion handed from the reorder tab to a new order whose supplier isn't known yet. */
let prefill: { currency: CurrencyCode; lines: { itemId: string; qtyMilli: number; unitPrice: number }[] } | null = null;

/* ---------- the list ---------- */

export function PurchaseOrders() {
  const mayOrder = useMay()('purchaseOrder');
  const i18n = useI18n();
  const { t } = i18n;
  usePageNav({ key: 'po_title', group: 'gPurchases' });
  const [tab, setTab] = useState<'orders' | 'suggest'>('orders');
  const [status, setStatus] = useState<PoStatus | 'open' | ''>('open');
  const [q, setQ] = useState('');
  const { data, error } = useLoad(() => purchasingApi.list({ ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) }), [status, q]);
  const tiles = useLoad(() => purchasingApi.summary(), []).data;

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('po_help')}</p>
      {tiles && (
        <div className="grid-4">
          <div className="card pad tile"><div className="label">{t('po_tileOpen')}</div><div className="value num">{i18n.int(tiles.open)}</div></div>
          <div className="card pad tile"><div className="label">{t('po_tilePartial')}</div><div className="value num">{i18n.int(tiles.partial)}</div></div>
          <div className="card pad tile"><div className="label">{t('po_tileOverdue')}</div><div className="value num" style={tiles.overdue ? { color: 'var(--bad)' } : undefined}>{i18n.int(tiles.overdue)}</div></div>
          <div className="card pad tile"><div className="label">{t('po_tileDraft')}</div><div className="value num">{i18n.int(tiles.draft)}</div></div>
        </div>
      )}
      <div className="row">
        <div className="track" role="tablist" aria-label={t('po_title')}>
          <button type="button" role="tab" aria-selected={tab === 'orders'} aria-pressed={tab === 'orders'} onClick={() => setTab('orders')}>{t('po_tabOrders')}</button>
          <button type="button" role="tab" aria-selected={tab === 'suggest'} aria-pressed={tab === 'suggest'} onClick={() => setTab('suggest')}>{t('po_tabSuggest')}</button>
        </div>
        <span className="spacer" />
        {mayOrder && <a className="btn primary" href={href('new-purchase-order')}><Icon name="plus" size={16} />{t('po_new')}</a>}
      </div>
      {tab === 'orders' ? (
        <>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="track" role="group" aria-label={t('po_title')}>
              {(['open', '', ...PO_STATUSES] as const).map((x) => (
                <button key={x || 'all'} type="button" aria-pressed={status === x} onClick={() => setStatus(x)}>
                  {x === '' ? t('all') : x === 'open' ? t('po_f_open') : t(st(x))}
                </button>
              ))}
            </div>
            <span className="spacer" />
            <input className="input" style={{ width: 240 }} type="search" placeholder={t('po_searchHint')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ErrorBox error={error} />
          {data && <div className="card table-wrap"><OrdersTable orders={data} /></div>}
        </>
      ) : <Suggestions />}
    </div>
  );
}

function OrdersTable({ orders }: { orders: PoSummaryView[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!orders.length) return <EmptyState icon="cart" title={t('po_none')} text={t('po_noneText')} />;
  // 1.4: orders reach someone who may not read the books without their prices: no total column then
  const priced = orders.some((x) => x.total !== undefined);
  return (
    <table className="table">
      <thead>
        <tr><th>{t('number')}</th><th>{t('supplier')}</th><th>{t('po_expected')}</th>{priced && <th className="amount">{t('total')}</th>}<th /></tr>
      </thead>
      <tbody>
        {orders.map((x) => (
          <tr key={x.id} className="click" onClick={() => go(`purchase-order/${x.id}`)}>
            <td><a className="ltr num" href={href(`purchase-order/${x.id}`)} onClick={(e) => e.stopPropagation()}>{x.number}</a><div className="muted small num">{i18n.date(x.date)}</div></td>
            <td>{x.partyName}</td>
            <td className="num">{x.expectedDate ? i18n.date(x.expectedDate) : '—'}</td>
            {priced && <td className="amount">{i18n.money(x.total, x.currency)}</td>}
            <td><PoChip status={x.status} overdue={x.overdue} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Suggestions() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { data, error } = useLoad(() => purchasingApi.suggest(), []);
  const mayOrder = useMay()('purchaseOrder');
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<unknown>(null);

  async function make(g: ReorderGroup) {
    const lines = g.lines.map((l) => ({ itemId: l.itemId, qtyMilli: l.suggestMilli, unitPrice: l.lastPrice ?? 0 }));
    if (!g.party) {
      prefill = { currency: g.currency, lines };
      go('new-purchase-order');
      return;
    }
    setBusy(true);
    setActError(null);
    try {
      const po = await purchasingApi.create({ date: todayIso(), partyId: g.party.id, currency: g.currency, lines });
      toast(t('po_created', { n: po.number }));
      go(`edit-purchase-order/${po.id}`);
    } catch (e) {
      setActError(e);
    }
    setBusy(false);
  }

  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>{t('po_suggestHelp')}</p>
      <ErrorBox error={actError} />
      {!data.length && <div className="card"><EmptyState icon="check" title={t('po_suggestNone')} text="" compact /></div>}
      {data.map((g) => (
        <div key={`${g.party?.id ?? ''}|${g.currency}`} className="card pad stack" style={{ gap: 8 }}>
          <div className="row">
            <h3 style={{ margin: 0 }}>{g.party ? g.party.name : t('po_unknownSupplier')}</h3>
            <span className="chip">{g.currency}</span>
            <span className="spacer" />
            {mayOrder && <button type="button" className="btn small primary" disabled={busy} onClick={() => void make(g)}><Icon name="cart" size={15} />{t('po_makeOrder')}</button>}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>{t('item')}</th><th className="amount">{t('po_onHand')}</th><th className="amount">{t('po_reorderAt')}</th><th className="amount">{t('po_onOrder')}</th><th className="amount">{t('po_suggestQty')}</th>{g.lines.some((l) => l.lastPrice !== undefined) && <th className="amount">{t('po_lastPrice')}</th>}</tr>
              </thead>
              <tbody>
                {g.lines.map((l) => (
                  <tr key={l.itemId}>
                    <td>{i18n.name(l.itemName)} <span className="muted small ltr">{l.itemCode}</span></td>
                    <td className="amount">{i18n.qty(l.onHandMilli)}</td>
                    <td className="amount">{l.reorderMilli === null ? '—' : i18n.qty(l.reorderMilli)}</td>
                    <td className="amount">{l.onOrderMilli ? i18n.qty(l.onOrderMilli) : '—'}</td>
                    <td className="amount"><strong>{i18n.qty(l.suggestMilli)}</strong></td>
                    {l.lastPrice !== undefined && <td className="amount">{l.lastPrice === null ? '—' : i18n.money(l.lastPrice, g.currency)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- writing an order ---------- */

/** qtyMilli: as typed in the line's unit (null: the base unit); unitPrice: per that unit. */
interface Row { key: number; itemId: string; qtyMilli: number; unitPrice: number; unit?: LineUnit }
let rowKey = 0;
const emptyRow = (): Row => ({ key: ++rowKey, itemId: '', qtyMilli: 1000, unitPrice: 0 });

export function PurchaseOrderEditor({ id }: { id?: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  usePageNav({ key: 'po_title', group: 'gPurchases', title: id ? 'po_edit' : 'po_new' });
  const existing = useLoad(() => (id ? purchasingApi.get(id) : Promise.resolve(null)), [id]);
  const suppliersLoad = useLoad(() => api.parties({ type: 'supplier', active: 'true' }), []);
  const suppliers: PickOption[] = useMemo(() => (suppliersLoad.data ?? []).map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone ?? '' })), [suppliersLoad.data]);
  const warehouses = (useLoad(() => api.warehouses(), []).data ?? []).filter((w) => w.active);
  const itemsLoad = useLoad(() => api.items({ active: 'true' }), []);
  const items = itemsLoad.data ?? [];
  const itemOptions: PickOption[] = useMemo(() => items.map((it) => ({
    id: it.id, code: it.code, label: i18n.name(it.name), search: `${it.name.ar} ${it.name.en} ${it.name.ku} ${it.barcode ?? ''}`
  })), [items, i18n]);

  const { settings } = useData();
  const [form, setForm] = useState({ date: todayIso(), partyId: '', warehouseId: '', currency: 'IQD' as CurrencyCode, expectedDate: '', notes: '' });
  const [rows, setRows] = useState<Row[]>(() => [emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (id || !prefill) return;
    const p = prefill;
    prefill = null;
    setForm((f) => ({ ...f, currency: p.currency }));
    setRows(p.lines.map((l) => ({ key: ++rowKey, ...l })));
  }, [id]);
  useEffect(() => {
    const x = existing.data;
    if (!x) return;
    setForm({ date: x.date, partyId: x.party.id, warehouseId: x.warehouse?.id ?? '', currency: x.currency, expectedDate: x.expectedDate ?? '', notes: x.notes });
    setRows(x.lines.map((l) => ({ key: ++rowKey, itemId: l.itemId, qtyMilli: l.lineUnit && l.unitQtyMilli !== null ? l.unitQtyMilli : l.qtyMilli, unitPrice: l.unitPrice, unit: l.lineUnit })));
  }, [existing.data]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  /** Another currency converts the prices at the default rate (or, with no rate, clears them after asking). */
  const changeCurrency = (next: CurrencyCode) => {
    if (next === form.currency) return;
    const converted = convertLines(rows, form.currency, next, settings?.defaultRateX100);
    if (converted) setRows(converted);
    else {
      if (rows.some((r) => r.unitPrice) && !window.confirm(t('qt_currencyClears'))) return;
      setRows((rs) => rs.map((r) => ({ ...r, unitPrice: 0 })));
    }
    set('currency', next);
  };
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + lineAmount(r.qtyMilli || 0, r.unitPrice || 0), 0);

  async function save() {
    setBusy(true);
    setError(null);
    const input: PoInput = {
      date: form.date, partyId: form.partyId, warehouseId: form.warehouseId || null, currency: form.currency,
      expectedDate: form.expectedDate || null, notes: form.notes,
      lines: rows.filter((r) => r.itemId || r.unitPrice).map(({ key: _k, unit, ...r }) => (unit
        ? { itemId: r.itemId, unit, unitQtyMilli: r.qtyMilli || 0, qtyMilli: baseQty(items.find((it) => it.id === r.itemId), unit, r.qtyMilli || 0) ?? 0, unitPrice: r.unitPrice || 0 }
        : { itemId: r.itemId, qtyMilli: r.qtyMilli || 0, unitPrice: r.unitPrice || 0 }))
    };
    try {
      const saved = id ? await purchasingApi.update(id, input) : await purchasingApi.create(input);
      toast(id ? t('saved') : t('po_created', { n: saved.number }));
      go(`purchase-order/${saved.id}`);
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  if (id && existing.error) return <ErrorBox error={existing.error} />;
  if (id && !existing.data) return null;
  if (existing.data && !existing.data.actions.includes('edit')) return <div className="alert">{t('po_locked')} <a href={href(`purchase-order/${id}`)} className="ltr">{existing.data.number}</a></div>;

  return (
    <div className="stack" style={{ maxWidth: 1080 }}>
      <div className="card pad grid-2">
        <div className="field"><span>{t('supplier')}</span><PartyPicker type="supplier" value={form.partyId} options={suppliers} onChange={(v) => set('partyId', v)} onCreated={() => suppliersLoad.reload()} placeholder={t('po_pickSupplier')} ariaLabel={t('supplier')} /></div>
        <label className="field"><span>{t('currency')}</span>
          <select className="input" value={form.currency} onChange={(e) => changeCurrency(e.target.value as CurrencyCode)}>
            <option value="IQD">IQD</option><option value="USD">USD</option>
          </select>
        </label>
        <label className="field"><span>{t('date')}</span><input className="input num" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></label>
        <label className="field"><span>{t('po_expected')}</span><input className="input num" type="date" value={form.expectedDate} onChange={(e) => set('expectedDate', e.target.value)} /></label>
        <label className="field"><span>{t('warehouse')}</span>
          <select className="input" value={form.warehouseId} onChange={(e) => set('warehouseId', e.target.value)}>
            <option value="">{t('po_anyWarehouse')}</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
          </select>
        </label>
      </div>

      <div className="card pad">
        <h3 style={{ margin: '0 0 6px' }}>{t('po_lines')}</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th><th>{t('item')}</th>
                <th className="amount" style={{ width: 120 }}>{t('qty')}</th><th className="amount" style={{ width: 170 }}>{t('unitPrice')}</th>
                <th className="amount">{t('amount')}</th><th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td className="muted num">{i18n.int(i + 1)}</td>
                  <td><SearchCombo value={r.itemId} options={itemOptions} onChange={(v) => update(r.key, { itemId: v, unit: items.find((it) => it.id === v)?.purchaseUnit ?? null })} placeholder={t('po_pickItem')} ariaLabel={t('item')} /></td>
                  <td>
                    <QtyInput value={r.qtyMilli || null} onChange={(v) => update(r.key, { qtyMilli: v ?? 0 })} ariaLabel={t('qty')} />
                    <UnitPicker item={items.find((it) => it.id === r.itemId)} value={r.unit ?? null} onChange={(unit) => update(r.key, { unit })} />
                  </td>
                  <td><AmountInput value={r.unitPrice || null} currency={form.currency} onChange={(v) => update(r.key, { unitPrice: v ?? 0 })} ariaLabel={t('unitPrice')} /></td>
                  <td className="amount">{i18n.money(lineAmount(r.qtyMilli || 0, r.unitPrice || 0), form.currency)}</td>
                  <td><button type="button" className="btn icon danger" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [emptyRow()]))} aria-label={t('removeLine')} title={t('removeLine')}><Icon name="x" size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ paddingTop: 10 }}>
          <button type="button" className="btn small" onClick={() => setRows((rs) => [...rs, emptyRow()])}><Icon name="plus" size={15} />{t('addLine')}</button>
          <span className="spacer" />
          <span className="muted">{t('total')}</span><strong className="num" style={{ fontSize: 18 }}>{i18n.money(total, form.currency)}</strong>
        </div>
      </div>

      <div className="card pad">
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

/* ---------- one order ---------- */

export function PurchaseOrderDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings } = useData();
  const mayOrder = useMay()('purchaseOrder');
  usePageNav({ key: 'po_title', group: 'gPurchases' });
  const { data: x, error, reload } = useLoad(() => purchasingApi.get(id), [id]);
  const [modal, setModal] = useState<'receive' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<unknown>(null);

  if (error) return <ErrorBox error={error} />;
  if (!x) return null;
  const company = settings ? i18n.name(settings.companyName) : '';
  const can = (a: string) => mayOrder && x.actions.includes(a as never);
  const pending = x.receipts.find((r) => r.status === 'draft');

  async function move(action: PoMove) {
    setBusy(true);
    setActError(null);
    try {
      const after = await purchasingApi.move(id, action);
      toast(t('po_moved', { s: t(st(after.status)) }));
      reload();
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
        {can('receive') && <button type="button" className="btn primary" disabled={busy} onClick={() => setModal('receive')}><Icon name="truck" size={16} />{t('po_receive')}</button>}
        {can('send') && <button type="button" className="btn" disabled={busy} onClick={() => void move('send')}><Icon name="check" size={16} />{t('po_markSent')}</button>}
        {can('reopen') && <button type="button" className="btn" disabled={busy} onClick={() => void move('reopen')}><Icon name="undo" size={16} />{t('po_reopen')}</button>}
        {can('edit') && <a className="btn" href={href(`edit-purchase-order/${id}`)}><Icon name="edit" size={16} />{t('po_edit')}</a>}
        <button type="button" className="btn" onClick={() => void printDocument('quote')}><Icon name="printer" size={16} />{t('print')}</button>
        {can('cancel') && <button type="button" className="btn danger" disabled={busy} onClick={() => setModal('cancel')}><Icon name="x" size={16} />{t('po_cancel')}</button>}
      </div>
      <ErrorBox error={actError} />
      {pending && (
        <div className="alert info no-print">{t('po_pendingHelp')} <a href={href(`invoice/${pending.invoiceId}`)}>{t('po_draftInvoice')}</a></div>
      )}
      <Paper order={x} company={company} />
      {x.receipts.length > 0 && (
        <div className="card pad no-print">
          <h3 style={{ margin: '0 0 6px' }}>{t('po_receipts')}</h3>
          <table className="table">
            <tbody>
              {x.receipts.map((r) => (
                <tr key={r.invoiceId} className="click" onClick={() => go(`invoice/${r.invoiceId}`)}>
                  <td><a className="ltr num" href={href(`invoice/${r.invoiceId}`)} onClick={(e) => e.stopPropagation()}>{r.number ?? t('po_draftInvoice')}</a></td>
                  <td className="num">{i18n.date(r.date)}</td>
                  {x.total !== undefined && <td className="amount">{i18n.money(r.total, x.currency)}</td>}
                  <td><span className={'chip ' + (r.status === 'posted' ? 'ok' : r.status === 'cancelled' ? 'bad' : '')}>{t(r.status === 'posted' ? 'po_st_received' : r.status === 'cancelled' ? 'po_st_cancelled' : 'po_st_draft')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal === 'receive' && <ReceiveModal order={x} onClose={() => setModal(null)} onDone={(invoiceId) => { setModal(null); toast(t('po_receiveDone')); go(`invoice/${invoiceId}`); }} />}
      {modal === 'cancel' && <CancelModal order={x} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    </div>
  );
}

/** أمر شراء on A4: company, supplier, delivery warehouse, lines with what came and what is to come, signatures. */
function Paper({ order: x, company }: { order: PoView; company: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const showProgress = x.status === 'partial' || x.status === 'received';
  return (
    <div className="paper">
      <div className="paper-head">
        <div style={{ flex: 1 }}>
          <div className="company-line">{company}</div>
          <div className="paper-title">{t('po_order')}</div>
          <div className="no-print" style={{ marginTop: 4 }}><PoChip status={x.status} overdue={x.overdue} /></div>
        </div>
        <div className="paper-meta">
          <span className="muted">{t('number')}</span><strong className="ltr">{x.number}</strong>
          <span className="muted">{t('date')}</span><strong className="num">{i18n.date(x.date)}</strong>
          {x.expectedDate && <><span className="muted">{t('po_expected')}</span><strong className="num">{i18n.date(x.expectedDate)}</strong></>}
        </div>
      </div>
      <div className="grid-2" style={{ marginBottom: 12 }}>
        <div>
          <div className="muted small">{t('po_to')}</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}><a href={href(`party/${x.party.id}`)}>{x.party.name}</a></div>
          {x.party.phone && <div className="small"><span className="ltr">{i18n.digitsOf(x.party.phone)}</span></div>}
          {x.party.address && <div className="small">{x.party.address}</div>}
        </div>
        {x.warehouse && (
          <div>
            <div className="muted small">{t('po_deliverTo')}</div>
            <div style={{ fontWeight: 600 }}>{i18n.name(x.warehouse.name)}</div>
          </div>
        )}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th><th>{t('item')}</th>
              <th className="amount" style={{ width: 100 }}>{t('po_ordered')}</th>
              {showProgress && <><th className="amount no-print" style={{ width: 100 }}>{t('po_received')}</th><th className="amount no-print" style={{ width: 100 }}>{t('po_remaining')}</th></>}
              {x.total !== undefined && <><th className="amount" style={{ width: 150 }}>{t('unitPrice')}</th><th className="amount">{t('amount')}</th></>}
            </tr>
          </thead>
          <tbody>
            {x.lines.map((l) => (
              <tr key={l.seq}>
                <td className="muted num">{i18n.int(l.seq)}</td>
                <td>{i18n.name(l.itemName)}<span className="muted small ltr" style={{ marginInlineStart: 6 }}>{l.itemCode}</span></td>
                <td className="amount">{l.lineUnit && l.unitQtyMilli !== null ? `${i18n.qty(l.unitQtyMilli)} ${unitLabel(i18n, l.lineUnit)}` : i18n.qty(l.qtyMilli)}</td>
                {showProgress && <>
                  <td className="amount no-print">{poQtyText(i18n, l, l.receivedMilli)}</td>
                  <td className="amount no-print" style={l.remainingMilli ? { color: 'var(--warn)' } : undefined}>{poQtyText(i18n, l, l.remainingMilli)}</td>
                </>}
                {x.total !== undefined && <><td className="amount">{i18n.money(l.unitPrice, x.currency)}</td>
                <td className="amount">{i18n.money(l.amount, x.currency)}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ padding: '10px 0' }}>
        <span className="spacer" />
        {x.total !== undefined && <div className="totals"><span>{t('total')}</span><strong className="num" style={{ fontSize: 18 }}>{i18n.money(x.total, x.currency)}</strong></div>}
      </div>
      {x.notes && <p className="small" style={{ whiteSpace: 'pre-line' }}><span className="muted">{t('notes')}: </span>{x.notes}</p>}
      <div className="sigs" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <div className="sig"><div className="muted small">{t('po_sigSupplier')}</div><div className="who">{x.party.name}</div></div>
        <div className="sig done"><div className="muted small">{t('po_sigCompany')}</div><div className="who">{x.createdBy}</div></div>
      </div>
    </div>
  );
}

function ReceiveModal({ order: x, onClose, onDone }: { order: PoView; onClose(): void; onDone(invoiceId: string): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const warehouses = (useLoad(() => api.warehouses(), []).data ?? []).filter((w) => w.active);
  const [date, setDate] = useState(todayIso() < x.date ? x.date : todayIso());
  const [warehouseId, setWarehouseId] = useState(x.warehouse?.id ?? '');
  const [rate, setRate] = useState(String(rateFromX100(settings?.defaultRateX100 ?? 142000)));
  // dollars: the rate board's rate for the chosen date, until a rate is typed
  const ratePrefill = useRatePrefill({ active: true, currency: x.currency, date, setRateText: setRate });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await purchasingApi.receive(x.id, {
        date, warehouseId: warehouseId || null,
        ...(x.currency === 'USD' ? { rateX100: Math.round(Number(toWesternDigits(rate).replace(/,/g, '')) * 100) } : {})
      });
      onDone(r.invoiceId);
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }
  return (
    <Modal title={t('po_receive')} onClose={onClose}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{t('po_receiveHelp')}</p>
        <label className="field"><span>{t('date')}</span><input className="input num" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field"><span>{t('warehouse')}</span>
          <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">{t('po_anyWarehouse')}</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
          </select>
        </label>
        {x.currency === 'USD' && <label className="field"><span>{t('rate')}</span><input className="input num" inputMode="decimal" value={rate} onChange={(e) => { ratePrefill.typed(); setRate(e.target.value); }} /></label>}
        <ErrorBox error={error} />
        <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}><Icon name="truck" size={16} />{t('po_receive')}</button></div>
      </div>
    </Modal>
  );
}

function CancelModal({ order: x, onClose, onDone }: { order: PoView; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit() {
    setBusy(true);
    try {
      await purchasingApi.move(x.id, 'cancel', reason.trim() || undefined);
      onDone();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }
  return (
    <Modal title={t('po_cancel')} onClose={onClose}>
      <div className="stack">
        <p style={{ margin: 0 }}>{t('po_cancelHelp', { n: x.number })}</p>
        <label className="field"><span>{t('po_reason')}</span><input className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>{t('back')}</button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => void submit()}><Icon name="x" size={16} />{t('po_cancel')}</button></div>
      </div>
    </Modal>
  );
}
