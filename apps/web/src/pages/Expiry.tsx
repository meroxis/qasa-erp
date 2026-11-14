import { useState } from 'react';
import { formatQty } from '@qasa/core';
import { api } from '../api.ts';
import { EmptyState, ErrorBox, Icon, downloadCsv, useData, useLoad, usePageNav, useToast } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { go, href } from '../router.ts';
import { batchesApi, type BatchReportRow, type ExpiryState } from '../industry/batches-api.ts';
import { printDocument } from '../industry/printing.ts';
import { unitName } from './Items.tsx';

type Tab = 'near' | 'expired' | 'all';

const STATE_CHIP: Record<Exclude<ExpiryState, null>, string> = { expired: 'bad', near: 'warn', ok: 'ok' };

/** A batch's expiry with its colour: past it (red), near it (amber), or fine. */
export function ExpiryChip({ state, expiry, i18n }: { state: ExpiryState; expiry: string | null; i18n: I18n }) {
  if (!expiry || !state) return <span className="muted">—</span>;
  return <span className={`chip ${STATE_CHIP[state]}`}><span className="num">{i18n.date(expiry)}</span> · {i18n.t(`ex_state_${state}` as Key)}</span>;
}

/**
 * الصلاحية والوجبات — batches near their expiry date, past it, and every batch's stock, with a write-off of what has
 * expired (a draft stock adjustment pinned to those batches). Route: `expiry`.
 */
export function Expiry() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  usePageNav({ key: 'ex_title', group: 'gStock' });
  const [tab, setTab] = useState<Tab>('near');
  const [warehouseId, setWarehouseId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const warehouses = useLoad(() => api.warehouses(), []);
  const report = useLoad(() => batchesApi.report({ state: tab, ...(warehouseId ? { warehouseId } : {}) }), [tab, warehouseId]);
  const rows = (report.data?.rows ?? []).filter((r) => r.qtyMilli > 0);
  // 1.4: the value of the stock is not sent to someone who may not see cost: no such column
  const cost = useData().seesCost !== false;
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);

  const batchText = (r: BatchReportRow) => r.batch || t('ex_noNumber');
  const exportCsv = () => downloadCsv(`expiry-${tab}.csv`, [
    [t('code'), t('item'), t('ex_batch'), t('ex_expiry'), t('ex_daysLeft'), t('warehouse'), t('qty'), ...(cost ? [t('stockValue')] : [])],
    ...rows.map((r) => [r.itemCode, i18n.name(r.itemName), batchText(r), r.expiry ?? '', r.daysLeft ?? '', r.warehouseCode, formatQty(r.qtyMilli), ...(cost ? [r.value ?? 0] : [])])
  ]);

  /** One draft write-off per warehouse, each line pinned to its batch; then the drafts are on the adjustments page. */
  async function writeOff() {
    if (!rows.length || !window.confirm(t('ex_writeOffHelp'))) return;
    setBusy(true);
    setError(null);
    try {
      const byWarehouse = new Map<string, { batchId: string; qtyMilli: number }[]>();
      for (const r of rows) byWarehouse.set(r.warehouseId, [...(byWarehouse.get(r.warehouseId) ?? []), { batchId: r.batchId, qtyMilli: r.qtyMilli }]);
      let last = '';
      for (const [w, list] of byWarehouse) last = (await batchesApi.writeOff({ warehouseId: w, rows: list })).id;
      toast(t('ex_writeOffMade'));
      go(byWarehouse.size === 1 ? `stock-adjustment/${last}` : 'stock-adjustments');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="muted no-print" style={{ margin: 0 }}>{t('ex_help')}</p>
      <div className="row no-print">
        <div className="tabs">
          {(['near', 'expired', 'all'] as const).map((x) => (
            <button key={x} type="button" aria-pressed={tab === x} onClick={() => setTab(x)}>{t(x === 'near' ? 'ex_near' : x === 'expired' ? 'ex_expired' : 'ex_stock')}</button>
          ))}
        </div>
        <span className="spacer" />
        {(warehouses.data?.length ?? 0) > 1 && (
          <select className="input" style={{ width: 200 }} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label={t('warehouse')}>
            <option value="">{t('allWarehouses')}</option>
            {warehouses.data!.map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
          </select>
        )}
        <button type="button" className="btn" onClick={exportCsv} disabled={!rows.length}><Icon name="download" size={16} />{t('exportExcel')}</button>
        <button type="button" className="btn" onClick={() => void printDocument('report')}><Icon name="printer" size={16} />{t('print')}</button>
        {tab === 'expired' && <button type="button" className="btn danger" disabled={busy || !rows.length} onClick={() => void writeOff()}><Icon name="x" size={16} />{t('ex_writeOff')}</button>}
      </div>
      <ErrorBox error={report.error ?? error} />
      <div className="card">
        {report.data && rows.length === 0 && <EmptyState compact icon="clock" title={t('ex_none')} text="" />}
        {rows.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>{t('item')}</th><th>{t('ex_batch')}</th><th>{t('ex_expiry')}</th><th className="amount">{t('ex_daysLeft')}</th>
                <th>{t('warehouse')}</th><th className="amount">{t('qty')}</th>{cost && <th className="amount">{t('stockValue')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.batchId}|${r.warehouseId}`} className="click" onClick={() => go(`item/${r.itemId}`)}>
                  <td><a href={href(`item/${r.itemId}`)} onClick={(e) => e.stopPropagation()}>{i18n.name(r.itemName)}</a> <span className="muted small ltr">{r.itemCode}</span></td>
                  <td className="ltr">{batchText(r)}</td>
                  <td><ExpiryChip state={r.state} expiry={r.expiry} i18n={i18n} /></td>
                  <td className="amount num">{r.daysLeft === null ? '—' : r.daysLeft < 0 ? t('ex_daysAgo', { n: -r.daysLeft }) : i18n.int(r.daysLeft)}</td>
                  <td>{i18n.name(r.warehouseName)}</td>
                  <td className="amount">{i18n.qty(r.qtyMilli)} <span className="muted small">{unitName(i18n, r.unit)}</span></td>
                  {cost && <td className="amount">{i18n.money(r.value ?? 0, 'IQD')}</td>}
                </tr>
              ))}
            </tbody>
            {cost && <tfoot><tr><td colSpan={6}>{t('total')}</td><td className="amount">{i18n.money(total, 'IQD')}</td></tr></tfoot>}
          </table>
        )}
      </div>
    </div>
  );
}
