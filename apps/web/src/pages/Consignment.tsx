import { useMemo, useState } from 'react';
import { todayIso, type CurrencyCode } from '@qasa/core';
import { api } from '../api.ts';
import { AmountInput, ErrorBox, Icon, InvoiceStatusChip, Modal, QtyInput, SearchCombo, useData, useLoad, usePageNav, useToast, type PickOption } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';
import { qtyText, unitName } from './Items.tsx';
import { parseRateText } from '../industry/quick-voucher.ts';
import {
  consignmentApi, type ConsignmentDoc, type ConsignmentDocKind, type ConsignmentItem, type ConsignmentStatement, type Settlement
} from '../industry/consignment-api.ts';
import { LockedFeature } from '../industry/LockedFeature.tsx';
import { Paper, PrintPart, PrintPartButton } from '../industry/PrintPart.tsx';
import { shareStatement } from '../share.ts';

/**
 * بضاعة الأمانة — goods on consignment (sale-or-return). Route: consignment/<tab> (suppliers, items, docs, settlements).
 * The server keeps the books: receipts and returns post at once at the agreed cost; a settlement waits for approval.
 */

export const CONSIGNMENT_TABS = ['suppliers', 'items', 'docs', 'settlements'] as const;
export type ConsignmentTab = (typeof CONSIGNMENT_TABS)[number];
const TAB_KEYS: Record<ConsignmentTab, Key> = { suppliers: 'cg_tabSuppliers', items: 'cg_tabItems', docs: 'cg_tabDocs', settlements: 'cg_tabSettlements' };

function useSuppliers() {
  const parties = useLoad(() => api.parties({ type: 'supplier', active: 'true' }), []);
  return (parties.data ?? []).map((p): PickOption => ({ id: p.id, code: p.code, label: p.name, search: p.phone ?? '' }));
}

/** 2.0.0: without the plan, what the page does and how to get it (LockedFeature), not its tabs over an empty page. */
export function Consignment(props: { tab?: ConsignmentTab }) {
  const { plan } = useData();
  if (plan && !plan.features.includes('consignment')) return <LockedFeature feature="consignment" icon="truck" />;
  return <ConsignmentPage {...props} />;
}

function ConsignmentPage({ tab = 'suppliers' }: { tab?: ConsignmentTab }) {
  const { t } = useI18n();
  usePageNav({ key: 'cg_title', group: 'gPurchases' });
  const { plan } = useData();
  const available = !!plan?.features.includes('consignment');
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('cg_help')}</p>
      {!available && <div className="alert">{t('cg_planHint')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      <div className="row no-print" style={{ flexWrap: 'wrap' }}>
        <div className="track" role="tablist">
          {CONSIGNMENT_TABS.map((x) => (
            <a key={x} role="tab" aria-selected={tab === x} aria-pressed={tab === x} className="btn" style={{ border: 'none' }}
              href={href(x === 'suppliers' ? 'consignment' : `consignment/${x}`)}>{t(TAB_KEYS[x])}</a>
          ))}
        </div>
      </div>
      {tab === 'suppliers' && <SuppliersTab />}
      {tab === 'items' && <ItemsTab available={available} />}
      {tab === 'docs' && <DocsTab available={available} />}
      {tab === 'settlements' && <SettlementsTab available={available} />}
    </div>
  );
}

// ——— suppliers and their statement ———

function SuppliersTab() {
  const i18n = useI18n();
  const { t } = i18n;
  const { data, error } = useLoad(() => consignmentApi.overview(), []);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <ErrorBox error={error} />
      <div className="card">
        {data && (data.suppliers.length === 0 ? <p className="muted" style={{ padding: '14px 16px', margin: 0 }}>{t('cg_noSuppliers')}</p> : (
          <table className="table">
            <thead><tr><th>{t('supplier')}</th><th className="amount">{t('cg_itemCount')}</th><th className="amount">{t('cg_unsettled')}</th><th /></tr></thead>
            <tbody>
              {data.suppliers.map((s) => (
                <tr key={s.supplierId}>
                  <td>{s.supplierName}</td>
                  <td className="amount num">{s.items}</td>
                  <td className="amount num">{[s.unsettled.IQD ? i18n.money(s.unsettled.IQD, 'IQD') : '', s.unsettled.USD ? i18n.money(s.unsettled.USD, 'USD') : ''].filter(Boolean).join(' · ') || '—'}</td>
                  <td><button type="button" className="btn" onClick={() => setOpen(s.supplierId)}>{t('cg_statement')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      {open && <StatementModal supplierId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function StatementModal({ supplierId, onClose }: { supplierId: string; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const company = settings ? i18n.name(settings.companyName) : '';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(todayIso());
  const { data, error } = useLoad(() => consignmentApi.statement(supplierId, { ...(from ? { from } : {}), ...(to ? { to } : {}) }), [supplierId, from, to]);
  return (
    <Modal title={data ? `${t('cg_statement')} — ${data.supplierName}` : t('cg_statement')} onClose={onClose}>
      <div className="row">
        <label className="field"><span>{t('from')}</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>{t('to')}</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <ErrorBox error={error} />
      {data && (
        <div className="row" style={{ gap: 8 }}>
          <PrintPartButton id="cg-statement" />
          <button type="button" className="btn small" onClick={() => shareStatement(i18n, company, { name: data.supplierName, balance: data.balance, currency: 'IQD', date: data.to })}><Icon name="mail" size={14} />WhatsApp</button>
        </div>
      )}
      {data && <StatementBody st={data} />}
      {data && (
        <PrintPart id="cg-statement">
          <Paper company={company} title={`${t('ux_consStatement')} — ${data.supplierName}`} sub={`${data.from ? i18n.date(data.from) + ' — ' : ''}${i18n.date(data.to)}`}>
            <StatementBody st={data} />
          </Paper>
        </PrintPart>
      )}
    </Modal>
  );
}

function StatementBody({ st }: { st: ConsignmentStatement }) {
  const i18n = useI18n();
  const { t } = i18n;
  const currencies = (['IQD', 'USD'] as const).filter((c) => st.items.some((it) => it.currency === c));
  return (
    <div className="stack">
      <table className="table">
        <thead>
          <tr>
            <th>{t('item')}</th><th className="amount">{t('cg_received')}</th><th className="amount">{t('cg_returned')}</th>
            <th className="amount">{t('cg_sold')}</th><th className="amount">{t('cg_onHand')}</th><th className="amount">{t('cg_unsettled')}</th>
          </tr>
        </thead>
        <tbody>
          {st.items.map((it) => (
            <tr key={it.itemId}>
              <td>{it.itemCode} · {i18n.name(it.itemName)}</td>
              <td className="amount num">{qtyText(i18n, it.receivedMilli)}</td>
              <td className="amount num">{qtyText(i18n, it.returnedMilli)}</td>
              <td className="amount num">{qtyText(i18n, it.soldMilli)}</td>
              <td className="amount num">{qtyText(i18n, it.onHandMilli)} <span className="muted small">{unitName(i18n, it.unit)}</span></td>
              <td className="amount num">{i18n.money(it.soldAmount, it.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small" style={{ margin: 0 }}>{t('cg_soldNote')}</p>
      {currencies.map((c) => {
        const x = st.totals[c];
        return (
          <div key={c} className="card" style={{ padding: '10px 14px' }}>
            <div className="totals"><span>{t('cg_received')}</span><strong className="num">{i18n.money(x.received, c)}</strong></div>
            <div className="totals"><span>{t('cg_returned')}</span><strong className="num">{i18n.money(x.returned, c)}</strong></div>
            <div className="totals"><span>{t('cg_sold')}</span><strong className="num">{i18n.money(x.sold, c)}</strong></div>
            <div className="totals"><span>{t('cg_onHand')}</span><strong className="num">{i18n.money(x.onHand, c)}</strong></div>
            <div className="totals"><span>{t('cg_settled')}</span><strong className="num">{i18n.money(x.settled, c)}</strong></div>
            {x.waiting > 0 && <div className="totals"><span>{t('cg_waiting')}</span><strong className="num">{i18n.money(x.waiting, c)}</strong></div>}
            <div className="totals"><span>{t('cg_unsettled')}</span><strong className="num">{i18n.money(x.unsettled, c)}</strong></div>
          </div>
        );
      })}
      <div className="totals"><span>{t('cg_paid')}</span><strong className="num">{i18n.money(st.paid, 'IQD')}</strong></div>
      <div className="totals"><span>{t('cg_balance')}</span><strong className="num">{i18n.money(st.balance, 'IQD')}</strong></div>
    </div>
  );
}

// ——— items on consignment ———

function ItemsTab({ available }: { available: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { data, error, reload } = useLoad(() => consignmentApi.items({ all: '1' }), []);
  const [editing, setEditing] = useState<ConsignmentItem | 'new' | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const end = async (it: ConsignmentItem) => {
    if (!window.confirm(t('cg_endConfirm'))) return;
    setFailure(null);
    try { await consignmentApi.endItem(it.itemId); toast(t('saved')); reload(); } catch (e) { setFailure(e); }
  };
  return (
    <>
      <div className="row">
        {available && <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('cg_addItem')}</button>}
      </div>
      <ErrorBox error={error ?? failure} />
      <div className="card">
        {data && (
          <table className="table">
            <thead>
              <tr><th>{t('item')}</th><th>{t('supplier')}</th><th className="amount">{t('cg_agreedCost')}</th><th className="amount">{t('cg_onHand')}</th><th /></tr>
            </thead>
            <tbody>
              {data.map((it) => (
                <tr key={it.itemId} className={it.active ? '' : 'muted'}>
                  <td>{it.itemCode} · {i18n.name(it.itemName)}{!it.active && <span className="chip"> {t('cg_ended')}</span>}</td>
                  <td>{it.supplierName}</td>
                  <td className="amount num">{i18n.money(it.unitCost, it.currency)}</td>
                  <td className="amount num">{qtyText(i18n, it.onHandMilli)} <span className="muted small">{unitName(i18n, it.unit)}</span></td>
                  <td className="row" style={{ justifyContent: 'flex-end' }}>
                    {available && <button type="button" className="btn" onClick={() => setEditing(it)}>{t('cg_editTerms')}</button>}
                    {it.active && <button type="button" className="btn" onClick={() => void end(it)}>{t('cg_endItem')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && <TermsModal item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function TermsModal({ item, onClose, onSaved }: { item: ConsignmentItem | null; onClose(): void; onSaved(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const suppliers = useSuppliers();
  const items = useLoad(() => api.items({ active: 'true' }), []);
  const [itemId, setItemId] = useState(item?.itemId ?? '');
  const [supplierId, setSupplierId] = useState(item?.supplierId ?? '');
  const [currency, setCurrency] = useState<CurrencyCode>(item?.currency ?? 'IQD');
  const [cost, setCost] = useState<number | null>(item?.unitCost ?? null);
  const [error, setError] = useState<unknown>(null);
  const itemOptions: PickOption[] = (items.data ?? []).filter((it) => it.trackStock).map((it) => ({
    id: it.id, code: it.code, label: i18n.name(it.name), search: `${it.name.ar} ${it.name.en} ${it.name.ku} ${it.barcode}`
  }));
  const save = async () => {
    setError(null);
    try {
      await consignmentApi.setItem(itemId, { supplierId, currency, unitCost: cost ?? 0 });
      toast(t('saved'));
      onSaved();
    } catch (e) { setError(e); }
  };
  return (
    <Modal title={item ? t('cg_editTerms') : t('cg_addItem')} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>{t('item')}</span>
          {item ? <strong>{item.itemCode} · {i18n.name(item.itemName)}</strong>
            : <SearchCombo value={itemId} options={itemOptions} onChange={setItemId} placeholder={t('chooseItem')} ariaLabel={t('item')} />}
        </label>
        <label className="field"><span>{t('supplier')}</span>
          <SearchCombo value={supplierId} options={suppliers} onChange={setSupplierId} placeholder={t('chooseSupplier')} ariaLabel={t('supplier')} />
        </label>
        <div className="row">
          <label className="field"><span>{t('currency')}</span>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
              <option value="IQD">{t('iqdName')}</option><option value="USD">{t('usdName')}</option>
            </select>
          </label>
          <label className="field"><span>{t('cg_agreedCost')}</span>
            <AmountInput value={cost} currency={currency} onChange={setCost} ariaLabel={t('cg_agreedCost')} />
          </label>
        </div>
        <p className="muted small" style={{ margin: 0 }}>{t('cg_agreedCostHelp')}</p>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={!itemId || !supplierId || cost === null} onClick={() => void save()}>{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

// ——— receipts and returns ———

function DocsTab({ available }: { available: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { data, error, reload } = useLoad(() => consignmentApi.docs(), []);
  const [making, setMaking] = useState<ConsignmentDocKind | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <p className="muted" style={{ margin: 0 }}>{t('cg_docHelp')}</p>
      {available && (
        <div className="row">
          <button type="button" className="btn primary" onClick={() => setMaking('receipt')}><Icon name="plus" size={16} />{t('cg_newReceipt')}</button>
          <button type="button" className="btn" onClick={() => setMaking('return')}><Icon name="undo" size={16} />{t('cg_newReturn')}</button>
        </div>
      )}
      <ErrorBox error={error} />
      <div className="card">
        {data && (data.length === 0 ? <p className="muted" style={{ padding: '14px 16px', margin: 0 }}>{t('cg_noDocs')}</p> : (
          <table className="table">
            <thead><tr><th>{t('colNumber')}</th><th>{t('colDate')}</th><th /><th>{t('supplier')}</th><th>{t('colStatus')}</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => setOpen(d.id)}>
                  <td className="num">{d.number ?? '—'}</td><td className="num">{d.date}</td><td>{t(d.kind === 'receipt' ? 'cg_kind_receipt' : 'cg_kind_return')}</td>
                  <td>{d.supplierName}</td><td><InvoiceStatusChip status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      {making && <DocEditor kind={making} onClose={() => setMaking(null)} onSaved={(id) => { setMaking(null); setOpen(id); reload(); }} />}
      {open && <DocModal id={open} onClose={() => { setOpen(null); reload(); }} />}
    </>
  );
}

interface Row { key: number; itemId: string; qtyMilli: number | null; unitCost: number | null; batchNo: string; expiry: string }
let rowKey = 0;
const emptyRow = (): Row => ({ key: ++rowKey, itemId: '', qtyMilli: null, unitCost: null, batchNo: '', expiry: '' });

function DocEditor({ kind, onClose, onSaved }: { kind: ConsignmentDocKind; onClose(): void; onSaved(id: string): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const suppliers = useSuppliers();
  const warehouses = useLoad(() => api.warehouses(), []);
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [rate, setRate] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [error, setError] = useState<unknown>(null);
  const items = useLoad(() => (supplierId ? consignmentApi.items({ supplierId }) : Promise.resolve([] as ConsignmentItem[])), [supplierId]);
  const byId = useMemo(() => new Map((items.data ?? []).map((it) => [it.itemId, it])), [items.data]);
  const options: PickOption[] = (items.data ?? []).map((it) => ({ id: it.itemId, code: it.itemCode, label: i18n.name(it.itemName), hint: `${qtyText(i18n, it.onHandMilli)} ${unitName(i18n, it.unit)}` }));
  const currency: CurrencyCode = rows.map((r) => byId.get(r.itemId)?.currency).find(Boolean) ?? 'IQD';
  const wh = warehouseId || (warehouses.data ?? []).find((w) => w.active)?.id || '';
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => {
    const next = rs.map((r) => (r.key === key ? { ...r, ...patch } : r));
    return next[next.length - 1]?.itemId ? [...next, emptyRow()] : next;
  });
  const save = async () => {
    setError(null);
    const rateX100 = currency === 'USD' ? parseRateText(rate || String((settings?.defaultRateX100 ?? 0) / 100)) ?? 0 : undefined;
    try {
      const doc = await consignmentApi.createDoc({
        kind, date, supplierId, warehouseId: wh, ...(rateX100 ? { rateX100 } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}),
        lines: rows.filter((r) => r.itemId && r.qtyMilli).map((r) => ({
          itemId: r.itemId, qtyMilli: r.qtyMilli!, ...(kind === 'receipt' && r.unitCost !== null ? { unitCost: r.unitCost } : {}),
          ...(kind === 'receipt' && r.batchNo.trim() ? { batchNo: r.batchNo.trim() } : {}), ...(kind === 'receipt' && r.expiry ? { expiry: r.expiry } : {})
        }))
      });
      onSaved(doc.id);
    } catch (e) { setError(e); }
  };
  return (
    <Modal title={t(kind === 'receipt' ? 'cg_newReceipt' : 'cg_newReturn')} onClose={onClose}>
      <div className="stack">
        <div className="row">
          <label className="field"><span>{t('supplier')}</span>
            <SearchCombo value={supplierId} options={suppliers} onChange={(v) => { setSupplierId(v); setRows([emptyRow()]); }} placeholder={t('chooseSupplier')} ariaLabel={t('supplier')} />
          </label>
          <label className="field"><span>{t('warehouse')}</span>
            <select className="input" value={wh} onChange={(e) => setWarehouseId(e.target.value)}>
              {(warehouses.data ?? []).filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {currency === 'USD' && (
            <label className="field"><span>{t('cg_rate')}</span>
              <input className="input num ltr" inputMode="numeric" value={rate || (settings ? String(settings.defaultRateX100 / 100) : '')} onChange={(e) => setRate(e.target.value)} />
            </label>
          )}
        </div>
        {supplierId && <p className="muted small" style={{ margin: 0 }}>{t('cg_itemsOfSupplier')}</p>}
        <table className="table">
          <thead>
            <tr>
              <th>{t('item')}</th><th className="amount">{t('qty')}</th>
              {kind === 'receipt' && <th className="amount">{t('cg_agreedCost')}</th>}
              {kind === 'receipt' && <th>{t('ex_batchNo')}</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const it = byId.get(r.itemId);
              return (
                <tr key={r.key}>
                  <td><SearchCombo value={r.itemId} options={options} onChange={(v) => update(r.key, { itemId: v })} placeholder={t('chooseItem')} ariaLabel={t('item')} /></td>
                  <td><QtyInput value={r.qtyMilli} onChange={(v) => update(r.key, { qtyMilli: v })} ariaLabel={t('qty')} /></td>
                  {kind === 'receipt' && (
                    <td><AmountInput value={r.unitCost} currency={it?.currency ?? currency} placeholder={it ? i18n.money(it.unitCost, it.currency) : ''} onChange={(v) => update(r.key, { unitCost: v })} ariaLabel={t('cg_agreedCost')} /></td>
                  )}
                  {kind === 'receipt' && (
                    <td className="row">
                      <input className="input" style={{ width: 110 }} value={r.batchNo} onChange={(e) => update(r.key, { batchNo: e.target.value })} aria-label={t('ex_batchNo')} />
                      <input className="input" type="date" value={r.expiry} onChange={(e) => update(r.key, { expiry: e.target.value })} aria-label={t('ex_expiry')} />
                    </td>
                  )}
                  <td>{r.itemId && <button type="button" className="btn icon" aria-label={t('removeLine')} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><Icon name="x" size={14} /></button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <label className="field"><span>{t('notes')}</span><input className="input" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={!supplierId || !rows.some((r) => r.itemId && r.qtyMilli)} onClick={() => void save()}>{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function DocModal({ id, onClose }: { id: string; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { data, error, reload } = useLoad(() => consignmentApi.doc(id), [id]);
  const [failure, setFailure] = useState<unknown>(null);
  const act = async (fn: () => Promise<unknown>, done: Key) => {
    setFailure(null);
    try { await fn(); toast(t(done)); reload(); } catch (e) { setFailure(e); }
  };
  const remove = async (doc: ConsignmentDoc) => {
    setFailure(null);
    try { await consignmentApi.deleteDoc(doc.id); toast(t('a_delete')); onClose(); } catch (e) { setFailure(e); }
  };
  return (
    <Modal title={data ? `${t(data.kind === 'receipt' ? 'cg_kind_receipt' : 'cg_kind_return')} ${data.number ?? ''}` : t('cg_title')} onClose={onClose}>
      <ErrorBox error={error ?? failure} />
      {data && (
        <div className="stack">
          <div className="row"><InvoiceStatusChip status={data.status} /><span>{data.supplierName}</span><span className="muted">{i18n.name(data.warehouseName)} · {data.date}</span></div>
          <table className="table">
            <thead><tr><th>{t('item')}</th><th className="amount">{t('qty')}</th><th className="amount">{t('amount')}</th></tr></thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.seq}>
                  <td>{l.itemCode} · {i18n.name(l.itemName)}{l.batchNo ? <span className="muted small"> · {l.batchNo}</span> : null}</td>
                  <td className="amount num">{qtyText(i18n, l.qtyMilli)} <span className="muted small">{unitName(i18n, l.unit)}</span></td>
                  <td className="amount num">{l.amount !== null ? i18n.money(l.amount, data.currency) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="totals"><span>{t('total')}</span><strong className="num">{i18n.money(data.total, data.currency)}</strong></div>
          <div className="row">
            {data.actions.includes('post') && <button type="button" className="btn primary" onClick={() => void act(() => consignmentApi.postDoc(data.id, i18n.lang), 'a_post')}>{t('cg_post')}</button>}
            {data.actions.includes('delete') && <button type="button" className="btn" onClick={() => void remove(data)}>{t('removeLine')}</button>}
            {data.actions.includes('cancel') && <button type="button" className="btn" onClick={() => void act(() => consignmentApi.cancelDoc(data.id), 'a_cancel')}>{t('cg_cancelDoc')}</button>}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ——— settlements ———

const STATE_KEYS: Record<Settlement['entryState'], Key> = {
  draft: 'cg_state_draft', checked: 'cg_state_checked', approved: 'cg_state_approved', reversed: 'cg_state_reversed', none: 'cg_state_none'
};

function SettlementsTab({ available }: { available: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings } = useData();
  const suppliers = useSuppliers();
  const { data, error, reload } = useLoad(() => consignmentApi.settlements(), []);
  const [supplierId, setSupplierId] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  const [date, setDate] = useState(todayIso());
  const [rate, setRate] = useState('');
  const [failure, setFailure] = useState<unknown>(null);
  const preview = useLoad(() => (supplierId ? consignmentApi.preview({ supplierId, currency, date }) : Promise.resolve(null)), [supplierId, currency, date, data]);
  const settle = async () => {
    setFailure(null);
    const rateX100 = currency === 'USD' ? parseRateText(rate || String((settings?.defaultRateX100 ?? 0) / 100)) ?? 0 : undefined;
    try {
      await consignmentApi.settle({ supplierId, currency, date, lang: i18n.lang, ...(rateX100 ? { rateX100 } : {}) });
      toast(t('saved'));
      reload();
    } catch (e) { setFailure(e); }
  };
  const takeBack = async (s: Settlement) => {
    if (!window.confirm(t('cg_cancelSettlementHelp'))) return;
    setFailure(null);
    try { await consignmentApi.cancelSettlement(s.id); toast(t('saved')); reload(); } catch (e) { setFailure(e); }
  };
  return (
    <>
      {available && (
        <div className="card" style={{ padding: '12px 16px' }}>
          <p className="muted" style={{ marginTop: 0 }}>{t('cg_settleHelp')}</p>
          <div className="row">
            <label className="field"><span>{t('supplier')}</span>
              <SearchCombo value={supplierId} options={suppliers} onChange={setSupplierId} placeholder={t('chooseSupplier')} ariaLabel={t('supplier')} />
            </label>
            <label className="field"><span>{t('currency')}</span>
              <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}><option value="IQD">{t('iqdName')}</option><option value="USD">{t('usdName')}</option></select>
            </label>
            <label className="field"><span>{t('to')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            {currency === 'USD' && (
              <label className="field"><span>{t('cg_rate')}</span>
                <input className="input num ltr" inputMode="numeric" value={rate || (settings ? String(settings.defaultRateX100 / 100) : '')} onChange={(e) => setRate(e.target.value)} />
              </label>
            )}
          </div>
          {preview.data && (preview.data.lines.length === 0 ? <p className="muted">{t('cg_nothingToSettle')}</p> : (
            <>
              <table className="table">
                <thead><tr><th>{t('item')}</th><th className="amount">{t('cg_sold')}</th><th className="amount">{t('amount')}</th></tr></thead>
                <tbody>
                  {preview.data.lines.map((l) => (
                    <tr key={l.itemId}>
                      <td>{l.itemCode} · {i18n.name(l.itemName)}</td>
                      <td className="amount num">{qtyText(i18n, l.qtyMilli)} <span className="muted small">{unitName(i18n, l.unit)}</span></td>
                      <td className="amount num">{i18n.money(l.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="totals"><span>{t('cg_preview')}</span><strong className="num">{i18n.money(preview.data.amount, currency)}</strong></div>
              <button type="button" className="btn primary" disabled={preview.data.amount <= 0} onClick={() => void settle()}>{t('cg_settle')}</button>
            </>
          ))}
        </div>
      )}
      <ErrorBox error={error ?? failure ?? preview.error} />
      <div className="card">
        {data && (data.length === 0 ? <p className="muted" style={{ padding: '14px 16px', margin: 0 }}>{t('cg_noSettlements')}</p> : (
          <table className="table">
            <thead><tr><th>{t('colNumber')}</th><th>{t('colDate')}</th><th>{t('supplier')}</th><th className="amount">{t('amount')}</th><th>{t('colStatus')}</th><th /></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td className="num">{s.number}</td><td className="num">{s.date}</td><td>{s.supplierName}</td>
                  <td className="amount num">{i18n.money(s.amount, s.currency)}</td>
                  <td>{t(STATE_KEYS[s.status === 'cancelled' && s.entryState !== 'reversed' ? 'none' : s.entryState])}</td>
                  <td>{s.status === 'open' && available && <button type="button" className="btn" onClick={() => void takeBack(s)}>{t('cg_cancelSettlement')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </>
  );
}
