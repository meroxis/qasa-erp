import { useState } from 'react';
import { formatAmount } from '@qasa/core';
import { api } from '../api.ts';
import { ErrorBox, Icon, downloadCsv, useData, useLoad } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { go } from '../router.ts';
import { printDocument } from '../industry/printing.ts';
import { categoriesApi } from '../industry/categories-api.ts';
import { supermarketReportsApi, type SlowMode, type SlowStockRowView } from '../industry/supermarket-reports-api.ts';

/**
 * Slow sellers and dead stock (1.7): goods on the shelf that did not sell in the last days, or sell too slowly for what
 * is held, with what they tie up. The value columns only for someone who reads the books (the server leaves them out
 * for others).
 */

export const SLOW_DAYS = [30, 60, 90] as const;

/** The CSV rows of the report (the value column only when the server sent it). */
export function slowStockCsv(rows: readonly SlowStockRowView[], withValue: boolean, label: { name(r: SlowStockRowView): string; category(r: SlowStockRowView): string }, heads: string[]): (string | number)[][] {
  return [
    heads,
    ...rows.map((r) => [r.code, label.name(r), label.category(r), r.qtyMilli / 1000, ...(withValue ? [formatAmount(r.value ?? 0, 'IQD')] : []),
      r.soldMilli / 1000, r.lastSale ?? '', r.idleDays, r.coverDays ?? ''])
  ];
}

export function SlowStock({ date }: { date: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const books = useData().seesBooks !== false;
  const [mode, setMode] = useState<SlowMode>('dead');
  const [preset, setPreset] = useState<number | 'custom'>(90);
  const [custom, setCustom] = useState(120);
  const [cover, setCover] = useState(180);
  const [warehouseId, setWarehouseId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [includeNew, setIncludeNew] = useState(false);
  const days = preset === 'custom' ? Math.max(7, Math.min(730, Math.floor(custom) || 7)) : preset;
  const coverDays = Math.max(7, Math.min(3650, Math.floor(cover) || 7));

  const warehouses = useLoad(() => api.warehouses(), []);
  const categories = useLoad(() => categoriesApi.list(), []);
  const { data, error } = useLoad(
    () => supermarketReportsApi.slowStock({ date, days, mode, coverDays, warehouseId: warehouseId || undefined, categoryId: categoryId || undefined, includeNew }),
    [date, days, mode, coverDays, warehouseId, categoryId, includeNew]
  );
  const rows = data?.rows ?? [];
  const withValue = books && data?.total.value !== undefined;
  const catName = (r: SlowStockRowView) => (r.categoryName ? i18n.name(r.categoryName) : '');
  // parents first, each followed by its subcategories
  const cats = (categories.data ?? []).filter((c) => !c.parentId).flatMap((c) => [c, ...(categories.data ?? []).filter((s) => s.parentId === c.id)]);

  const csv = () => downloadCsv(`${mode === 'dead' ? 'dead-stock' : 'slow-sellers'}_${days}d_${date}.csv`, slowStockCsv(rows, withValue,
    { name: (r) => i18n.name(r.name), category: catName },
    [t('code'), t('br_item'), t('smr_category'), t('smr_onHand'), ...(withValue ? [t('smr_valueTied')] : []), t('smr_soldIn'), t('smr_lastSale'), t('smr_idle'), t('smr_coverDays')]));

  return (
    <>
      <div className="card pad stack no-print">
        <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div className="tabs" role="group" aria-label={t('smr_mode')}>
            {(['dead', 'slow'] as const).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>{t(`smr_mode_${m}`)}</button>)}
          </div>
          <label className="field"><span>{t('smr_days')}</span>
            <select className="input" value={String(preset)} onChange={(e) => setPreset(e.target.value === 'custom' ? 'custom' : Number(e.target.value))}>
              {SLOW_DAYS.map((d) => <option key={d} value={d}>{t('smr_daysN', { n: i18n.int(d) })}</option>)}
              <option value="custom">{t('smr_daysCustom')}</option>
            </select>
          </label>
          {preset === 'custom' && (
            <label className="field"><span>{t('smr_daysCount')}</span>
              <input className="input num" type="number" min={7} max={730} value={custom} style={{ width: 110 }} onChange={(e) => setCustom(Number(e.target.value))} />
            </label>
          )}
          {mode === 'slow' && (
            <label className="field"><span>{t('smr_cover')}</span>
              <input className="input num" type="number" min={7} max={3650} value={cover} style={{ width: 110 }} onChange={(e) => setCover(Number(e.target.value))} />
            </label>
          )}
          <label className="field"><span>{t('br_warehouse')}</span>
            <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">{t('smr_allWarehouses')}</option>
              {(warehouses.data ?? []).map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('smr_category')}</span>
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t('smr_allCategories')}</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.parentId ? `— ${i18n.name(c.name)}` : i18n.name(c.name)}</option>)}
            </select>
          </label>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={includeNew} onChange={(e) => setIncludeNew(e.target.checked)} />{t('smr_includeNew')}</label>
        </div>
        <p className="muted small" style={{ margin: 0 }}>{t('smr_slowHelp')}</p>
      </div>
      <div className="row no-print" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <strong>{data ? (withValue
          ? t('smr_totalTied', { n: i18n.int(data.total.items), v: i18n.money(data.total.value ?? 0, 'IQD') })
          : t('smr_totalItems', { n: i18n.int(data.total.items) })) : ''}</strong>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={csv} disabled={!rows.length}><Icon name="download" size={16} />{t('exportExcel')}</button>
          <button type="button" className="btn" onClick={() => void printDocument('report')} disabled={!rows.length}><Icon name="printer" size={16} />{t('print')}</button>
        </div>
      </div>
      <ErrorBox error={error} />
      {data && (
        <div className="card"><div className="table-wrap">
          {rows.length === 0 ? <p className="muted" style={{ padding: 16, margin: 0 }}>{t('noData')}</p> : (
            <table className="table">
              <thead><tr>
                <th>{t('code')}</th><th>{t('br_item')}</th><th>{t('smr_category')}</th><th className="amount">{t('smr_onHand')}</th>
                {withValue && <th className="amount">{t('smr_valueTied')}</th>}
                <th className="amount">{t('smr_soldIn')}</th><th>{t('smr_lastSale')}</th><th className="amount">{t('smr_idle')}</th>
                {mode === 'slow' && <th className="amount">{t('smr_coverDays')}</th>}
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.itemId} className="click" onClick={() => go(`item/${r.itemId}`)}>
                    <td><span className="tree-code">{i18n.digitsOf(r.code)}</span></td>
                    <td>{i18n.name(r.name)}</td>
                    <td>{catName(r) || <span className="muted">—</span>}</td>
                    <td className="amount">{i18n.qty(r.qtyMilli)}</td>
                    {withValue && <td className="amount">{i18n.money(r.value ?? 0, 'IQD')}</td>}
                    <td className="amount">{i18n.qty(r.soldMilli)}</td>
                    <td>{r.lastSale ? i18n.date(r.lastSale) : <span className="muted">{t('smr_never')}</span>}</td>
                    <td className="amount">{i18n.int(r.idleDays)}</td>
                    {mode === 'slow' && <td className="amount">{r.coverDays === null ? '—' : i18n.int(r.coverDays)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div></div>
      )}
    </>
  );
}
