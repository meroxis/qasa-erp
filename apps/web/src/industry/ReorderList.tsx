import { useState } from 'react';
import { formatQty, type Names, type UnitCode } from '@qasa/core';
import { api, qs, request } from '../api.ts';
import { EmptyState, ErrorBox, Icon, downloadCsv, useLoad } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { go, href } from '../router.ts';
import { brandLabel, brandsApi, categoriesApi, categoryLabel } from './categories-api.ts';
import { printDocument } from './printing.ts';

/** Low stock (1.1): items at or below their minimum quantity, their own or their category's. */
export interface ReorderRowView {
  itemId: string; code: string; name: Names; unit: UnitCode; qtyMilli: number; reorderMilli: number;
  levelFrom: 'item' | 'category'; categoryId: string | null; brandId: string | null;
}

export const reorderApi = {
  list: (f: { warehouseId?: string } = {}) => request<ReorderRowView[]>('GET', '/api/stock/reorder' + qs(f))
};

/** The home page's line: how many items are at or below their minimum, linking to the list. Nothing when none. */
export function ReorderHomeNote() {
  const { t, int } = useI18n();
  const { data } = useLoad(() => reorderApi.list(), []);
  if (!data?.length) return null;
  return (
    <a href={href('items/reorder')} className="alert info no-print" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
      <Icon name="box" size={18} />
      <span style={{ flex: 1 }}><strong>{t('ro_title')}</strong> — {t('ro_count', { n: int(data.length) })}</span>
      <Icon name="chevron" size={16} />
    </a>
  );
}

/** The reorder list: grouped by category, then brand; a warehouse can be picked; export and print as the other lists. */
export function ReorderList() {
  const i18n = useI18n();
  const { t } = i18n;
  const [warehouseId, setWarehouseId] = useState('');
  const rows = useLoad(() => reorderApi.list(warehouseId ? { warehouseId } : {}), [warehouseId]);
  const warehouses = useLoad(() => api.warehouses(), []);
  const categories = useLoad(() => categoriesApi.list(), []);
  const brands = useLoad(() => brandsApi.list(), []);
  const cat = (id: string | null) => (id ? categoryLabel(categories.data ?? [], id, i18n.name) : t('rp_uncategorised'));
  const brand = (id: string | null) => (id ? brandLabel((brands.data ?? []).find((b) => b.id === id), i18n.lang) : t('rp_noBrand'));
  const list = rows.data ?? [];
  // groups in the order the server sorted them (category, then brand)
  const groups: { key: string; title: string; rows: ReorderRowView[] }[] = [];
  for (const r of list) {
    const key = `${r.categoryId ?? ''}|${r.brandId ?? ''}`;
    const last = groups.at(-1);
    if (last?.key === key) last.rows.push(r);
    else groups.push({ key, title: `${cat(r.categoryId)} · ${brand(r.brandId)}`, rows: [r] });
  }
  const csv = () => downloadCsv('reorder.csv', [
    [t('cat_category'), t('bnd_brand'), t('code'), t('item'), t('available'), t('ro_minimum'), t('ro_short')],
    ...list.map((r) => [cat(r.categoryId), brand(r.brandId), r.code, i18n.name(r.name), formatQty(r.qtyMilli), formatQty(r.reorderMilli), formatQty(Math.max(0, r.reorderMilli - r.qtyMilli))])
  ]);
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('ro_help')}</p>
      <div className="row no-print">
        {(warehouses.data?.length ?? 0) > 1 && (
          <select className="input" style={{ width: 200 }} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label={t('warehouse')}>
            <option value="">{t('allWarehouses')}</option>
            {warehouses.data!.map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
          </select>
        )}
        <span className="spacer" />
        <button type="button" className="btn" disabled={!list.length} onClick={csv}><Icon name="download" size={16} />{t('exportExcel')}</button>
        <button type="button" className="btn" disabled={!list.length} onClick={() => void printDocument('report')}><Icon name="printer" size={16} />{t('print')}</button>
      </div>
      <div className="print-only"><h2>{t('ro_title')}</h2></div>
      <ErrorBox error={rows.error} />
      <div className="card">
        {rows.data && list.length === 0 && <EmptyState compact icon="box" title={t('ro_title')} text={t('ro_none')} />}
        {list.length > 0 && (
          <table className="table">
            <thead><tr><th style={{ width: 100 }}>{t('code')}</th><th>{t('item')}</th><th className="amount">{t('available')}</th><th className="amount">{t('ro_minimum')}</th><th className="amount">{t('ro_short')}</th></tr></thead>
            {groups.map((g) => (
              <tbody key={g.key}>
                <tr><th colSpan={5} style={{ textAlign: 'start' }}><bdi>{g.title}</bdi></th></tr>
                {g.rows.map((r) => (
                  <tr key={r.itemId} className="click" onClick={() => go(`item/${r.itemId}`)}>
                    <td><span className="tree-code">{r.code}</span></td>
                    <td>{i18n.name(r.name)}</td>
                    <td className="amount" style={{ color: r.qtyMilli <= 0 ? 'var(--bad)' : undefined }}>{i18n.qty(r.qtyMilli)}</td>
                    <td className="amount">{i18n.qty(r.reorderMilli)}{r.levelFrom === 'category' && <span className="muted small"> ({t('cat_category')})</span>}</td>
                    <td className="amount">{i18n.qty(Math.max(0, r.reorderMilli - r.qtyMilli))}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        )}
      </div>
    </div>
  );
}
