import { useEffect, useState, type ReactNode } from 'react';
import { formatAmount, todayIso } from '@qasa/core';
import { briefApi, type AgingRowView, type GroupSalesView } from '../industry/brief-api.ts';
import { ErrorBox, Icon, downloadCsv, useData, useLoad, usePageNav } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { go, href } from '../router.ts';
import { PeriodPicker } from './Reports.tsx';

/**
 * Management reports: sales by item and by customer, profit by item, who owes us and whom we owe (aged), and what
 * the stock is worth in each warehouse. From posted invoices and approved entries only, in dinars.
 */

import { reportTabsFor, type ReportTab } from './tabs.ts';
import { printDocument } from '../industry/printing.ts';
export { isReportTab, REPORT_TABS, type ReportTab } from './tabs.ts';
const TAB_LABEL: Record<ReportTab, Key> = {
  'sales-items': 'br_rSalesItems', 'sales-categories': 'rp_byCategory', 'sales-brands': 'rp_byBrand', 'sales-customers': 'br_rSalesCustomers', profit: 'br_rProfit',
  aging: 'br_rAging', 'supplier-aging': 'br_rSupplierAging', 'stock-value': 'br_rStockValue'
};


const monthStart = () => todayIso().slice(0, 8) + '01';
const qty = (i18n: I18n, milli: number) => i18n.qty(milli);

export function MoreReports({ tab: asked = 'sales-items' }: { tab?: ReportTab }) {
  const i18n = useI18n();
  const { t } = i18n;
  usePageNav({ key: 'br_reports', group: 'gAccounting' });
  // 1.4: cost and profit are not sent to someone who may not read the books (a cashier): no profit report, no stock
  // valuation, no ageing of what the company owes its suppliers (the server refuses it), and the sales reports
  // without their cost, profit and margin columns
  const books = useData().seesBooks !== false;
  const tabs = reportTabsFor(books);
  const tab: ReportTab = tabs.includes(asked) ? asked : 'sales-items';
  // a typed address of a report that is not this person's: the address is replaced too, so it never names a closed
  // report (and Back does not return to it)
  const closed = !tabs.includes(asked);
  useEffect(() => { if (closed) window.location.replace(href('reports-more/sales-items')); }, [closed]);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIso());
  const dated = tab === 'aging' || tab === 'supplier-aging' || tab === 'stock-value';

  return (
    <div className="stack">
      <div className="tabs no-print" style={{ flexWrap: 'wrap' }}>
        {tabs.map((k) => (
          <button key={k} type="button" aria-pressed={k === tab} onClick={() => go(`reports-more/${k}`)}>{t(TAB_LABEL[k])}</button>
        ))}
      </div>
      <div className="row no-print" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {dated
          ? <label className="field"><span>{t('br_asOf')}</span><input className="input" type="date" value={to} max={todayIso()} onChange={(e) => setTo(e.target.value)} /></label>
          : <PeriodPicker from={from} to={to} onFrom={setFrom} onTo={setTo} />}
        <span className="spacer" />
      </div>
      <div className="print-only"><h2>{t(TAB_LABEL[tab])}</h2><div className="small">{dated ? i18n.date(to) : `${i18n.date(from)} — ${i18n.date(to)}`}</div></div>
      {tab === 'sales-items' && <SalesByItem from={from} to={to} profit={false} />}
      {tab === 'profit' && <SalesByItem from={from} to={to} profit />}
      {tab === 'sales-categories' && <SalesByGroup by="category" from={from} to={to} />}
      {tab === 'sales-brands' && <SalesByGroup by="brand" from={from} to={to} />}
      {tab === 'sales-customers' && <SalesByCustomer from={from} to={to} />}
      {tab === 'aging' && <Aging type="customer" date={to} />}
      {tab === 'supplier-aging' && <Aging type="supplier" date={to} />}
      {tab === 'stock-value' && <StockValue date={to} />}
      <p className="small muted">{t('br_onlyPosted')}</p>
    </div>
  );
}

function Toolbar({ onCsv, disabled }: { onCsv(): void; disabled: boolean }) {
  const { t } = useI18n();
  return (
    <div className="row no-print" style={{ justifyContent: 'flex-end', gap: 8 }}>
      <button type="button" className="btn" onClick={onCsv} disabled={disabled}><Icon name="download" size={16} />{t('exportExcel')}</button>
      <button type="button" className="btn" onClick={() => void printDocument('report')} disabled={disabled}><Icon name="printer" size={16} />{t('print')}</button>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="card"><div className="table-wrap">{children}</div></div>;
}

function Empty() {
  const { t } = useI18n();
  return <p className="muted" style={{ padding: 16, margin: 0 }}>{t('noData')}</p>;
}

/**
 * Sales, cost and profit by category (each subcategory indented under its category, the category's row its total) or
 * by brand, with items that have none last. An item counts where it is now, so older invoices are in too.
 */
function SalesByGroup({ by, from, to }: { by: 'category' | 'brand'; from: string; to: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const books = useData().seesBooks !== false;
  const { data, error } = useLoad(() => briefApi.salesByGroup(by, { from, to }), [by, from, to]);
  const none = by === 'category' ? t('rp_uncategorised') : t('rp_noBrand');
  const label = (r: GroupSalesView) => (r.name ? i18n.name(r.name) : none);
  const margin = (p: number, s: number) => (s ? `${i18n.int(Math.round((p / s) * 100))}%` : '—');
  // each category's row (its total), then its own items when it also has subcategories, then each subcategory
  type Line = { key: string; name: string; sub: boolean; strong: boolean; f: { qtyMilli: number; sales: number; cost?: number; profit?: number } };
  const lines: Line[] = (data?.rows ?? []).flatMap((r) => [
    { key: r.id ?? 'none', name: label(r), sub: false, strong: r.children.length > 0, f: r.total },
    ...(r.children.length && r.sales !== 0 ? [{ key: `${r.id}-own`, name: t('rp_direct'), sub: true, strong: false, f: r }] : []),
    ...r.children.map((c) => ({ key: c.id ?? '', name: label(c), sub: true, strong: false, f: c.total }))
  ]);
  const csv = () => downloadCsv(`sales-by-${by}_${from}_${to}.csv`, [
    [by === 'category' ? t('cat_category') : t('bnd_brand'), t('br_qty'), t('br_sales'), ...(books ? [t('br_cost'), t('br_profit'), t('br_margin')] : [])],
    ...lines.map((l) => [l.sub ? `  ${l.name}` : l.name, l.f.qtyMilli / 1000, formatAmount(l.f.sales, 'IQD'),
      ...(books ? [formatAmount(l.f.cost ?? 0, 'IQD'), formatAmount(l.f.profit ?? 0, 'IQD'), margin(l.f.profit ?? 0, l.f.sales)] : [])])
  ]);
  const total = data?.total;
  return (
    <>
      <Toolbar onCsv={csv} disabled={!lines.length} />
      <ErrorBox error={error} />
      {data && (lines.length === 0 ? <Card><Empty /></Card> : (
        <Card>
          <table className="table">
            <thead><tr>
              <th>{by === 'category' ? t('cat_category') : t('bnd_brand')}</th><th className="amount">{t('br_qty')}</th><th className="amount">{t('br_sales')}</th>
              {books && <><th className="amount">{t('br_cost')}</th><th className="amount">{t('br_profit')}</th><th className="amount">{t('br_margin')}</th></>}
            </tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td style={l.sub ? { paddingInlineStart: 32 } : undefined}>{l.strong ? <strong>{l.name}</strong> : <bdi>{l.name}</bdi>}</td>
                  <td className="amount">{qty(i18n, l.f.qtyMilli)}</td>
                  <td className="amount">{i18n.money(l.f.sales, 'IQD')}</td>
                  {books && <>
                    <td className="amount">{i18n.money(l.f.cost ?? 0, 'IQD')}</td>
                    <td className="amount" style={{ color: (l.f.profit ?? 0) < 0 ? 'var(--bad, #A4271A)' : undefined }}>{i18n.money(l.f.profit ?? 0, 'IQD')}</td>
                    <td className="amount">{margin(l.f.profit ?? 0, l.f.sales)}</td>
                  </>}
                </tr>
              ))}
            </tbody>
            {total && <tfoot><tr>
              <th>{t('totals')}</th><th className="amount">{qty(i18n, total.qtyMilli)}</th><th className="amount">{i18n.money(total.sales, 'IQD')}</th>
              {books && <><th className="amount">{i18n.money(total.cost ?? 0, 'IQD')}</th><th className="amount">{i18n.money(total.profit ?? 0, 'IQD')}</th><th className="amount">{margin(total.profit ?? 0, total.sales)}</th></>}
            </tr></tfoot>}
          </table>
        </Card>
      ))}
    </>
  );
}

function SalesByItem({ from, to, profit: asked }: { from: string; to: string; profit: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  // the profit columns only for someone the server sends cost and profit to
  const books = useData().seesBooks !== false;
  const profit = asked && books;
  const { data, error } = useLoad(() => briefApi.salesByItem({ from, to }), [from, to]);
  const rows = profit ? [...(data?.rows ?? [])].sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0)) : data?.rows ?? [];
  const total = rows.reduce((s, r) => ({ sales: s.sales + r.sales, cost: s.cost + (r.cost ?? 0), profit: s.profit + (r.profit ?? 0) }), { sales: 0, cost: 0, profit: 0 });
  const margin = (p: number, s: number) => (s ? `${i18n.int(Math.round((p / s) * 100))}%` : '—');
  const csv = () => downloadCsv(`${profit ? 'profit' : 'sales'}-by-item_${from}_${to}.csv`, [
    [t('code'), t('br_item'), t('br_qty'), t('br_sales'), ...(profit ? [t('br_cost'), t('br_profit'), t('br_margin')] : [])],
    ...rows.map((r) => [r.code, i18n.name(r.name), r.qtyMilli / 1000, formatAmount(r.sales, 'IQD'), ...(profit ? [formatAmount(r.cost ?? 0, 'IQD'), formatAmount(r.profit ?? 0, 'IQD'), margin(r.profit ?? 0, r.sales)] : [])])
  ]);
  return (
    <>
      <Toolbar onCsv={csv} disabled={!rows.length} />
      <ErrorBox error={error} />
      {data && (rows.length === 0 ? <Card><Empty /></Card> : (
        <Card>
          <table className="table">
            <thead><tr>
              <th>{t('code')}</th><th>{t('br_item')}</th><th className="amount">{t('br_qty')}</th><th className="amount">{t('br_sales')}</th>
              {profit && <><th className="amount">{t('br_cost')}</th><th className="amount">{t('br_profit')}</th><th className="amount">{t('br_margin')}</th></>}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId} className="click" onClick={() => go(`item/${r.itemId}`)}>
                  <td><span className="tree-code">{i18n.digitsOf(r.code)}</span></td>
                  <td>{i18n.name(r.name)}</td>
                  <td className="amount">{qty(i18n, r.qtyMilli)}</td>
                  <td className="amount">{i18n.money(r.sales, 'IQD')}</td>
                  {profit && <>
                    <td className="amount">{i18n.money(r.cost ?? 0, 'IQD')}</td>
                    <td className="amount" style={{ color: (r.profit ?? 0) < 0 ? 'var(--bad, #A4271A)' : undefined }}>{i18n.money(r.profit ?? 0, 'IQD')}</td>
                    <td className="amount">{margin(r.profit ?? 0, r.sales)}</td>
                  </>}
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <th colSpan={3}>{t('totals')}</th><th className="amount">{i18n.money(total.sales, 'IQD')}</th>
              {profit && <><th className="amount">{i18n.money(total.cost, 'IQD')}</th><th className="amount">{i18n.money(total.profit, 'IQD')}</th><th className="amount">{margin(total.profit, total.sales)}</th></>}
            </tr></tfoot>
          </table>
        </Card>
      ))}
    </>
  );
}

function SalesByCustomer({ from, to }: { from: string; to: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { data, error } = useLoad(() => briefApi.salesByCustomer({ from, to }), [from, to]);
  const rows = data?.rows ?? [];
  const total = rows.reduce((s, r) => s + r.sales, 0);
  const csv = () => downloadCsv(`sales-by-customer_${from}_${to}.csv`, [
    [t('code'), t('br_customer'), t('br_invoices'), t('br_sales'), t('br_share')],
    ...rows.map((r) => [r.code, r.name || t('br_cashSales'), r.invoices, formatAmount(r.sales, 'IQD'), total ? `${Math.round((r.sales / total) * 100)}%` : ''])
  ]);
  return (
    <>
      <Toolbar onCsv={csv} disabled={!rows.length} />
      <ErrorBox error={error} />
      {data && (rows.length === 0 ? <Card><Empty /></Card> : (
        <Card>
          <table className="table">
            <thead><tr><th>{t('br_customer')}</th><th className="amount">{t('br_invoices')}</th><th className="amount">{t('br_sales')}</th><th style={{ width: '30%' }}>{t('br_share')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.partyId ?? 'cash'} className={r.partyId ? 'click' : undefined} onClick={() => r.partyId && go(`party/${r.partyId}`)}>
                  <td>{r.name || <span className="muted">{t('br_cashSales')}</span>} {r.code && <span className="small muted">{i18n.digitsOf(r.code)}</span>}</td>
                  <td className="amount">{i18n.int(r.invoices)}</td>
                  <td className="amount">{i18n.money(r.sales, 'IQD')}</td>
                  <td><Bar value={r.sales} max={rows[0]?.sales ?? 1} label={total ? `${i18n.int(Math.round((r.sales / total) * 100))}%` : ''} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th colSpan={2}>{t('totals')}</th><th className="amount">{i18n.money(total, 'IQD')}</th><th /></tr></tfoot>
          </table>
        </Card>
      ))}
    </>
  );
}

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--accent-soft, #DCE6FA)', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, (value / (max || 1)) * 100))}%`, background: 'var(--accent, #1D5FD1)' }} />
      </span>
      <span className="small num" style={{ minWidth: 36 }}>{label}</span>
    </span>
  );
}

const BUCKETS: Key[] = ['br_b0', 'br_b1', 'br_b2', 'br_b3'];

function Aging({ type, date }: { type: 'customer' | 'supplier'; date: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { data, error } = useLoad(() => briefApi.aging(type, date), [type, date]);
  const rows: AgingRowView[] = data?.rows ?? [];
  const sum = (n: number) => rows.reduce((s, r) => s + r.buckets[n]!, 0);
  const total = rows.reduce((s, r) => s + r.balance, 0);
  const csv = () => downloadCsv(`${type}-aging_${date}.csv`, [
    [t('code'), t(type === 'customer' ? 'br_customer' : 'br_supplier'), t('br_phone'), ...BUCKETS.map((b) => t(b)), t('br_balance'), t('br_oldest')],
    ...rows.map((r) => [r.code, r.name, r.phone, ...r.buckets.map((b) => formatAmount(b, 'IQD')), formatAmount(r.balance, 'IQD'), r.oldestDays])
  ]);
  return (
    <>
      <Toolbar onCsv={csv} disabled={!rows.length} />
      <ErrorBox error={error} />
      {data && (rows.length === 0 ? <Card><Empty /></Card> : (
        <Card>
          <table className="table">
            <thead><tr>
              <th>{t(type === 'customer' ? 'br_customer' : 'br_supplier')}</th>
              {BUCKETS.map((b) => <th key={b} className="amount">{t(b)}</th>)}
              <th className="amount">{t('br_balance')}</th><th className="amount">{t('br_oldest')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.partyId} className="click" onClick={() => go(`party/${r.partyId}`)}>
                  <td>{r.name} <span className="small muted">{i18n.digitsOf(r.code)}</span></td>
                  {r.buckets.map((b, n) => (
                    <td key={n} className="amount" style={n === 3 && b > 0 ? { color: 'var(--bad, #A4271A)', fontWeight: 600 } : undefined}>{b ? i18n.money(b, 'IQD') : '—'}</td>
                  ))}
                  <td className="amount"><strong>{i18n.money(r.balance, 'IQD')}</strong></td>
                  <td className="amount">{t('br_days', { n: i18n.int(r.oldestDays) })}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <th>{t('totals')}</th>
              {[0, 1, 2, 3].map((n) => <th key={n} className="amount">{i18n.money(sum(n), 'IQD')}</th>)}
              <th className="amount">{i18n.money(total, 'IQD')}</th><th />
            </tr></tfoot>
          </table>
          {/* (an invoice says what was received for it; this report ages the party's whole debt, oldest first) */}
          <p className="muted small" style={{ margin: '8px 16px 12px' }}>{t('br_agingRule')}</p>
        </Card>
      ))}
    </>
  );
}

function StockValue({ date }: { date: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { data, error } = useLoad(() => briefApi.stockValue(date), [date]);
  const [open, setOpen] = useState<string | null>(null);
  const total = (data?.warehouses ?? []).reduce((s, w) => s + w.value, 0);
  const csv = () => data && downloadCsv(`stock-value_${date}.csv`, [
    [t('br_warehouse'), t('code'), t('br_item'), t('br_qty'), t('br_value')],
    ...data.items.map((r) => {
      const w = data.warehouses.find((x) => x.warehouseId === r.warehouseId);
      return [w ? i18n.name(w.warehouseName) : '', r.code, i18n.name(r.name), r.qtyMilli / 1000, formatAmount(r.value, 'IQD')];
    })
  ]);
  return (
    <>
      <Toolbar onCsv={csv} disabled={!data?.items.length} />
      <ErrorBox error={error} />
      {data && (
        <Card>
          <table className="table">
            <thead><tr><th>{t('br_warehouse')}</th><th className="amount">{t('br_items')}</th><th className="amount">{t('br_value')}</th><th style={{ width: '30%' }}>{t('br_share')}</th></tr></thead>
            <tbody>
              {data.warehouses.map((w) => (
                <tr key={w.warehouseId} className="click" onClick={() => setOpen(open === w.warehouseId ? null : w.warehouseId)} aria-expanded={open === w.warehouseId}>
                  <td>{i18n.name(w.warehouseName)} <span className="small muted">{i18n.digitsOf(w.warehouseCode)}</span></td>
                  <td className="amount">{i18n.int(w.items)}</td>
                  <td className="amount">{i18n.money(w.value, 'IQD')}</td>
                  <td><Bar value={w.value} max={Math.max(1, ...data.warehouses.map((x) => x.value))} label={total ? `${i18n.int(Math.round((w.value / total) * 100))}%` : ''} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th colSpan={2}>{t('totals')}</th><th className="amount">{i18n.money(total, 'IQD')}</th><th /></tr></tfoot>
          </table>
          {open && (
            <table className="table">
              <thead><tr><th>{t('code')}</th><th>{t('br_item')}</th><th className="amount">{t('br_qty')}</th><th className="amount">{t('br_value')}</th></tr></thead>
              <tbody>
                {data.items.filter((r) => r.warehouseId === open).map((r) => (
                  <tr key={r.itemId} className="click" onClick={() => go(`item/${r.itemId}`)}>
                    <td><span className="tree-code">{i18n.digitsOf(r.code)}</span></td><td>{i18n.name(r.name)}</td>
                    <td className="amount">{qty(i18n, r.qtyMilli)}</td><td className="amount">{i18n.money(r.value, 'IQD')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}
