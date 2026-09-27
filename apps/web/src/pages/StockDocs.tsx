import { useEffect, useMemo, useState } from 'react';
import { lineAmount, todayIso } from '@qasa/core';
import { api, type StockDocInput, type StockDocKind, type StockDocView } from '../api.ts';
import {
  AccountCombo, AmountInput, ErrorBox, Icon, InvoiceStatusChip, Modal, QtyInput, SearchCombo, useData, useLoad, useToast, type PickOption
} from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { go, href } from '../router.ts';
import { averageCost, qtyText, unitName } from './Items.tsx';

const kindKey = (kind: StockDocKind) => (kind === 'opening' ? 'opening_stock' : 'transfer');

/** حركات المخزن — opening stock and transfers between warehouses */
export function StockDocs() {
  const i18n = useI18n();
  const { t } = i18n;
  const [kind, setKind] = useState<StockDocKind | ''>('');
  const { data, error } = useLoad(() => api.stockDocs(kind ? { kind } : {}), [kind]);
  const warehouses = useLoad(() => api.warehouses(), []);
  const canTransfer = (warehouses.data ?? []).filter((w) => w.active).length >= 2;

  return (
    <div className="stack">
      <div className="row">
        <a className="btn primary" href={href('new-stock-doc/opening')}><Icon name="plus" size={16} />{t('newOpeningStock')}</a>
        {canTransfer
          ? <a className="btn" href={href('new-stock-doc/transfer')}><Icon name="swap" size={16} />{t('newTransfer')}</a>
          : warehouses.data && <a className="btn" href={href('plans')} title={t('transferNeedsTwo')}><Icon name="swap" size={16} />{t('newTransfer')} <span className="chip plan-pro">Pro</span></a>}
        <span className="spacer" />
        <div className="track">
          {(['', 'opening', 'transfer'] as const).map((k) => (
            <button key={k || 'all'} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{k ? t(kindKey(k)) : t('all')}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {data && (data.length === 0 ? <p className="muted" style={{ padding: '14px 16px', margin: 0 }}>{t('noStockDocs')}</p> : (
          <table className="table">
            <thead>
              <tr><th>{t('colNumber')}</th><th>{t('colType')}</th><th>{t('colDate')}</th><th>{t('warehouse')}</th><th className="amount">{t('moveValue')}</th><th>{t('colStatus')}</th></tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} className="click" onClick={() => go(`stock-doc/${d.id}`)}>
                  <td>{d.number ? <a href={href(`stock-doc/${d.id}`)} className="ltr num" onClick={(e) => e.stopPropagation()}>{d.number}</a> : <span className="muted">{t('draft')}</span>}</td>
                  <td>{t(kindKey(d.kind))}</td>
                  <td className="num">{i18n.date(d.date)}</td>
                  <td>{i18n.name(d.warehouseName)}{d.toWarehouseName && <> ← {i18n.name(d.toWarehouseName)}</>}</td>
                  <td className="amount">{i18n.money(d.totalValue, 'IQD')}</td>
                  <td><InvoiceStatusChip status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}

interface Row { key: number; itemId: string; qtyMilli: number | null; unitCost: number | null }
let rowKey = 1;
const emptyRow = (): Row => ({ key: rowKey++, itemId: '', qtyMilli: 1000, unitCost: null });

export function StockDocEditor({ kind: initialKind, id }: { kind?: StockDocKind; id?: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { reloadAccounts } = useData();
  const [kind, setKind] = useState<StockDocKind>(initialKind ?? 'opening');
  const [savedId, setSavedId] = useState<string | undefined>(id);
  const [ready, setReady] = useState(!id);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [date, setDate] = useState(todayIso());
  const [warehouseId, setWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [counterAccount, setCounterAccount] = useState('21');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>(() => [emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const warehouses = useLoad(() => api.warehouses(), []);
  const items = useLoad(() => api.items({ active: 'true', ...(warehouseId ? { warehouseId } : {}) }), [warehouseId]);
  const active = (warehouses.data ?? []).filter((w) => w.active);

  useEffect(() => {
    if (warehouseId || !active[0]) return;
    setWarehouseId(active[0].id);
    if (!toWarehouseId && active[1]) setToWarehouseId(active[1].id);
  }, [active, warehouseId, toWarehouseId]);

  useEffect(() => {
    if (!id) return;
    api.stockDoc(id).then((d: StockDocView) => {
      if (!d.actions.includes('edit')) { go(`stock-doc/${d.id}`); return; }
      setKind(d.kind);
      setDate(d.date);
      setWarehouseId(d.warehouseId);
      setToWarehouseId(d.toWarehouseId ?? '');
      setCounterAccount(d.counterAccountCode ?? '21');
      setNotes(d.notes);
      setRows(d.lines.map((l) => ({ key: rowKey++, itemId: l.itemId, qtyMilli: l.qtyMilli, unitCost: l.unitCost })));
      setReady(true);
    }, setLoadError);
  }, [id]);

  const itemById = useMemo(() => new Map((items.data ?? []).map((it) => [it.id, it])), [items.data]);
  const itemOptions: PickOption[] = (items.data ?? []).filter((it) => it.trackStock).map((it) => ({
    id: it.id, code: it.code, label: i18n.name(it.name), search: `${it.name.ar} ${it.name.en} ${it.name.ku} ${it.barcode}`,
    hint: `${qtyText(i18n, it.qtyMilli)} ${unitName(i18n, it.unit)}`
  }));
  const lines = rows.filter((r) => r.itemId);
  const total = kind === 'opening' ? lines.reduce((sum, r) => sum + lineAmount(r.qtyMilli ?? 0, r.unitCost ?? 0), 0) : 0;

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [emptyRow()]));
  function pickItem(key: number, itemId: string) {
    setRows((rs) => {
      const next = rs.map((r) => (r.key === key ? { ...r, itemId } : r));
      return next[next.length - 1]?.itemId ? [...next, emptyRow()] : next;
    });
  }

  function input(): StockDocInput {
    return {
      kind, date, warehouseId, notes,
      ...(kind === 'transfer' ? { toWarehouseId } : { counterAccountCode: counterAccount }),
      lines: lines.map((r) => ({ itemId: r.itemId, qtyMilli: r.qtyMilli ?? 0, ...(kind === 'opening' ? { unitCost: r.unitCost ?? -1 } : {}) }))
    };
  }

  async function save(post: boolean) {
    if (post && !window.confirm(t('docPostConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      const body = input();
      const saved = savedId ? await api.updateStockDoc(savedId, body) : await api.createStockDoc(body);
      setSavedId(saved.id);
      if (post) {
        await api.postStockDoc(saved.id);
        await reloadAccounts();
        toast(t('a_post'));
      } else {
        toast(t('saved'));
      }
      go(`stock-doc/${saved.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <ErrorBox error={loadError} />;
  if (!ready) return null;

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <div className="card pad stack">
        <h2 style={{ fontSize: 18 }}>{savedId ? `${t('editTitle')} — ${t(kindKey(kind))}` : t(kindKey(kind))}</h2>
        <p className="muted" style={{ margin: 0 }}>{kind === 'opening' ? t('openingHelp') : t('transferHelp')}</p>
        <div className="grid-3">
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field">
            <span>{kind === 'transfer' ? t('fromWarehouse') : t('warehouse')}</span>
            <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {active.map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
            </select>
          </label>
          {kind === 'transfer' ? (
            <label className="field">
              <span>{t('toWarehouse')}</span>
              <select className="input" value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>
                {active.filter((w) => w.id !== warehouseId).map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
              </select>
            </label>
          ) : (
            <div className="field">
              <span>{t('counterAccount')}</span>
              <AccountCombo value={counterAccount} onChange={setCounterAccount} filter={(a) => !a.code.startsWith('13')} ariaLabel={t('counterAccount')} />
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div style={{ padding: '14px 16px 8px' }}><h2>{t('invoiceLines')}</h2></div>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th style={{ width: '40%' }}>{t('item')}</th>
              <th className="amount" style={{ width: 140 }}>{t('qty')}</th>
              {kind === 'opening' ? <th className="amount" style={{ width: 180 }}>{t('unitCost')}</th> : <th className="amount">{t('avgCost')}</th>}
              <th className="amount">{t('moveValue')}</th>
              <th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const it = itemById.get(r.itemId);
              const short = kind === 'transfer' && it && (r.qtyMilli ?? 0) > it.qtyMilli;
              const avg = it ? averageCost(it.qtyMilli, it.value) : 0;
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
                  {kind === 'opening'
                    ? <td><AmountInput value={r.unitCost} currency="IQD" onChange={(v) => update(r.key, { unitCost: v })} ariaLabel={t('unitCost')} /></td>
                    : <td className="amount muted">{it ? i18n.money(avg, 'IQD') : ''}</td>}
                  <td className="amount">
                    {r.itemId ? i18n.money(kind === 'opening' ? lineAmount(r.qtyMilli ?? 0, r.unitCost ?? 0) : lineAmount(r.qtyMilli ?? 0, avg), 'IQD') : ''}
                  </td>
                  <td><button type="button" className="btn icon danger" onClick={() => remove(r.key)} aria-label={t('removeLine')} title={t('removeLine')}><Icon name="x" size={16} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row" style={{ padding: '10px 16px 14px' }}>
          <button type="button" className="btn small" onClick={() => setRows((rs) => [...rs, emptyRow()])}><Icon name="plus" size={15} />{t('addLine')}</button>
          <span className="spacer" />
          {kind === 'opening' && <div className="totals"><span>{t('totalDue')}</span><strong className="num" style={{ fontSize: 18 }}>{i18n.money(total, 'IQD')}</strong></div>}
        </div>
      </div>

      <label className="field"><span>{t('notes')}</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

      <ErrorBox error={error} />
      <div className="row">
        <button type="button" className="btn primary" onClick={() => save(true)} disabled={busy}><Icon name="check" size={16} />{t('actPostDoc')}</button>
        <button type="button" className="btn" onClick={() => save(false)} disabled={busy}>{busy ? t('saving') : t('saveDraft')}</button>
        <button type="button" className="btn" onClick={() => history.back()}>{t('cancel')}</button>
      </div>
    </div>
  );
}

export function StockDocDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, reloadAccounts } = useData();
  const { data, error, reload } = useLoad(() => api.stockDoc(id), [id]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelDate, setCancelDate] = useState(todayIso());

  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const d = data;
  const company = settings ? i18n.name(settings.companyName) : '';

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
      await api.deleteStockDoc(id);
      toast(t('a_delete'));
      go('stock-docs');
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
        {d.actions.includes('edit') && <a className="btn" href={href(`edit-stock-doc/${d.id}`)}>{t('actEdit')}</a>}
        {d.actions.includes('delete') && <button type="button" className="btn danger" disabled={busy} onClick={remove}>{t('actDelete')}</button>}
        {d.actions.includes('post') && (
          <button type="button" className="btn primary" disabled={busy} onClick={() => { if (window.confirm(t('docPostConfirm'))) void act(() => api.postStockDoc(id), t('a_post')); }}>
            <Icon name="check" size={16} />{t('actPostDoc')}
          </button>
        )}
        {d.actions.includes('cancel') && <button type="button" className="btn danger" disabled={busy} onClick={() => setCancelling(true)}><Icon name="undo" size={16} />{t('actCancelDoc')}</button>}
        <button type="button" className="btn" onClick={() => window.print()}><Icon name="printer" size={16} />{t('print')}</button>
      </div>
      <ErrorBox error={cancelling ? null : actionError} />
      {d.status === 'posted' && <div className="alert info no-print">{t('docPostedNote')}</div>}

      <div className="paper">
        <div className="paper-head">
          <div style={{ flex: 1 }}>
            <div className="company-line">{company}</div>
            <div className="paper-title">{t(kindKey(d.kind))}</div>
            <div style={{ marginTop: 4 }} className="no-print"><InvoiceStatusChip status={d.status} /></div>
            {d.status === 'cancelled' && <div className="print-only" style={{ color: 'var(--bad)', fontWeight: 700 }}>{t('cancelled')}</div>}
          </div>
          <div className="paper-meta">
            <span className="muted">{t('number')}</span><strong className="ltr">{d.number ?? t('draft')}</strong>
            <span className="muted">{t('date')}</span><strong className="num">{i18n.date(d.date)}</strong>
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: 14 }}>
          <div>
            <div className="muted small">{d.kind === 'transfer' ? t('fromWarehouse') : t('warehouse')}</div>
            <div style={{ fontWeight: 700 }}>{i18n.name(d.warehouseName)}</div>
          </div>
          <div>
            {d.kind === 'transfer' && d.toWarehouseName && <><div className="muted small">{t('toWarehouse')}</div><div style={{ fontWeight: 700 }}>{i18n.name(d.toWarehouseName)}</div></>}
            {d.kind === 'opening' && d.counterAccountCode && (
              <><div className="muted small">{t('counterAccount')}</div><div><span className="tree-code">{d.counterAccountCode}</span> {d.counterAccountName ? i18n.name(d.counterAccountName) : ''}</div></>
            )}
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th><th style={{ width: 90 }}>{t('code')}</th><th>{t('item')}</th>
              <th className="amount">{t('qty')}</th>{d.kind === 'opening' && <th className="amount">{t('unitCost')}</th>}<th className="amount">{t('moveValue')}</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.lineNo}>
                <td className="num">{i18n.int(l.lineNo)}</td>
                <td><span className="ltr">{l.itemCode}</span></td>
                <td>{i18n.name(l.itemName)}</td>
                <td className="amount">{qtyText(i18n, l.qtyMilli)} <span className="muted small">{unitName(i18n, l.unit)}</span></td>
                {d.kind === 'opening' && <td className="amount">{i18n.money(l.unitCost ?? 0, 'IQD')}</td>}
                <td className="amount">{l.value !== null ? i18n.money(l.value, 'IQD') : d.kind === 'opening' ? i18n.money(lineAmount(l.qtyMilli, l.unitCost ?? 0), 'IQD') : ''}</td>
              </tr>
            ))}
          </tbody>
          {(d.status !== 'draft' || d.kind === 'opening') && (
            <tfoot><tr><td colSpan={d.kind === 'opening' ? 5 : 4}>{t('totals')}</td><td className="amount">{i18n.money(d.totalValue, 'IQD')}</td></tr></tfoot>
          )}
        </table>
        {d.notes && <p className="small"><span className="muted">{t('notes')}: </span>{d.notes}</p>}
        <div className="sigs" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div className="sig done"><div className="muted small">{t('preparedBy')}</div><div className="who">{d.createdBy}</div></div>
          <div className="sig"><div className="muted small">{t('warehouse')}</div><div className="who">&nbsp;</div></div>
        </div>
      </div>

      {(d.entryId || d.cancelEntryId) && (
        <div className="card pad no-print row">
          {d.entryId && <span>{t('postingEntry')}: <a href={href(`entry/${d.entryId}`)} className="ltr">{d.entryNumber}</a></span>}
          {d.cancelEntryId && <span>· {t('cancelEntry')}: <a href={href(`entry/${d.cancelEntryId}`)} className="ltr">{d.cancelEntryNumber}</a></span>}
        </div>
      )}

      {cancelling && (
        <Modal title={t('cancelDocTitle')} onClose={() => setCancelling(false)}>
          <div className="stack">
            <p style={{ margin: 0 }}>{t('cancelDocHelp')}</p>
            <label className="field"><span>{t('cancelDate')}</span><input className="input" type="date" value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} /></label>
            <ErrorBox error={actionError} />
            <div className="row">
              <button type="button" className="btn danger" disabled={busy} onClick={() => act(() => api.cancelStockDoc(id, cancelDate), t('a_cancel'))}>{t('confirm')}</button>
              <button type="button" className="btn" onClick={() => setCancelling(false)}>{t('cancel')}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
