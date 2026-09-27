import { useState } from 'react';
import { formatQty, roundHalfUp, UNITS, type CurrencyCode, type Names, type UnitCode } from '@qasa/core';
import { api, type ItemInput, type ItemView, type WarehouseView } from '../api.ts';
import { AmountInput, ErrorBox, Icon, Modal, downloadCsv, useData, useLoad, useToast } from '../components.tsx';
import { useI18n, type I18n, isKey, type Key } from '../i18n.ts';
import { go, href } from '../router.ts';

export function qtyText(i18n: I18n, milli: number): string {
  return formatQty(milli, i18n.digits === 'eastern' && i18n.lang !== 'en' ? 'eastern' : 'western');
}

export function unitName(i18n: I18n, unit: UnitCode): string {
  return i18n.name(UNITS[unit]);
}

/** Average cost per unit in IQD, from a stock quantity (thousandths) and its value. */
export function averageCost(qtyMilli: number, value: number): number {
  return qtyMilli > 0 ? roundHalfUp((value * 1000) / qtyMilli) : 0;
}

/** المواد والمخزون */
export function Items() {
  const i18n = useI18n();
  const { t } = i18n;
  const [tab, setTab] = useState<'items' | 'warehouses'>('items');
  const [q, setQ] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [editing, setEditing] = useState<ItemView | 'new' | null>(null);
  const [newWarehouse, setNewWarehouse] = useState(false);
  const items = useLoad(() => api.items({ q: q.trim(), warehouseId }), [q, warehouseId]);
  const warehouses = useLoad(() => api.warehouses(), []);
  const totalValue = (items.data ?? []).reduce((s, it) => s + it.value, 0);

  const exportCsv = () => downloadCsv('items.csv', [
    [t('code'), t('name'), t('unit'), t('available'), t('avgCost'), t('stockValue'), t('salePrice')],
    ...(items.data ?? []).map((it) => [it.code, i18n.name(it.name), unitName(i18n, it.unit), formatQty(it.qtyMilli), averageCost(it.qtyMilli, it.value), it.value, it.salePrice])
  ]);

  return (
    <div className="stack">
      <div className="tabs">
        <button type="button" aria-pressed={tab === 'items'} onClick={() => setTab('items')}>{t('items')}</button>
        <button type="button" aria-pressed={tab === 'warehouses'} onClick={() => setTab('warehouses')}>{t('warehouses')}</button>
      </div>

      {tab === 'items' && (
        <>
          <div className="row">
            <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('newItem')}</button>
            <a className="btn" href={href('new-invoice/purchase')}><Icon name="invoice" size={16} />{t('newPurchase')}</a>
            <span className="spacer" />
            {(warehouses.data?.length ?? 0) > 1 && (
              <select className="input" style={{ width: 200 }} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label={t('warehouse')}>
                <option value="">{t('allWarehouses')}</option>
                {warehouses.data!.map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
              </select>
            )}
            <input className="input" style={{ width: 240 }} type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" className="btn" onClick={exportCsv}><Icon name="download" size={16} />{t('exportExcel')}</button>
          </div>
          <ErrorBox error={items.error} />
          <div className="card">
            {items.data && items.data.length === 0 && <p className="muted" style={{ padding: '14px 16px', margin: 0 }}>{t('noItems')}</p>}
            {items.data && items.data.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 100 }}>{t('code')}</th>
                    <th>{t('item')}</th>
                    <th className="amount">{t('available')}</th>
                    <th className="amount">{t('avgCost')}</th>
                    <th className="amount">{t('stockValue')}</th>
                    <th className="amount">{t('salePrice')}</th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {items.data.map((it) => (
                    <tr key={it.id} className="click" onClick={() => go(`item/${it.id}`)}>
                      <td><span className="tree-code">{it.code}</span></td>
                      <td>
                        <strong>{i18n.name(it.name)}</strong>
                        {!it.active && <span className="chip" style={{ marginInlineStart: 8 }}>{t('inactive')}</span>}
                        {it.barcode && <div className="muted small ltr">{it.barcode}</div>}
                      </td>
                      <td className="amount">
                        {it.trackStock
                          ? <span style={{ color: it.qtyMilli <= 0 ? 'var(--bad)' : undefined }}>{qtyText(i18n, it.qtyMilli)} <span className="muted small">{unitName(i18n, it.unit)}</span></span>
                          : <span className="muted small">{unitName(i18n, it.unit)}</span>}
                      </td>
                      <td className="amount">{it.trackStock && it.qtyMilli > 0 ? i18n.money(averageCost(it.qtyMilli, it.value), 'IQD') : ''}</td>
                      <td className="amount">{it.trackStock ? i18n.money(it.value, 'IQD') : ''}</td>
                      <td className="amount">{i18n.money(it.salePrice, it.saleCurrency)}</td>
                      <td>
                        <button type="button" className="btn icon ghost" title={t('actEdit')} aria-label={t('actEdit')} onClick={(e) => { e.stopPropagation(); setEditing(it); }}>
                          <Icon name="edit" size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td /><td>{t('total')}</td><td /><td /><td className="amount">{i18n.money(totalValue, 'IQD')}</td><td /><td /></tr>
                </tfoot>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'warehouses' && (
        <>
          <div className="row">
            <button type="button" className="btn primary" onClick={() => setNewWarehouse(true)}><Icon name="plus" size={16} />{t('newWarehouse')}</button>
          </div>
          <ErrorBox error={warehouses.error} />
          <div className="card">
            {warehouses.data && (
              <table className="table">
                <thead><tr><th style={{ width: 100 }}>{t('code')}</th><th>{t('warehouse')}</th><th>{t('linkedAccount')}</th><th className="amount">{t('stockValue')}</th></tr></thead>
                <tbody>
                  {warehouses.data.map((w: WarehouseView) => (
                    <tr key={w.id}>
                      <td><span className="tree-code">{w.code}</span></td>
                      <td>{i18n.name(w.name)}</td>
                      <td><a href={href(`statement/${w.accountCode}`)} className="ltr">{w.accountCode}</a></td>
                      <td className="amount">{i18n.money(w.value, 'IQD')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {editing && <ItemForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); items.reload(); }} />}
      {newWarehouse && <WarehouseForm onClose={() => setNewWarehouse(false)} onSaved={() => { setNewWarehouse(false); warehouses.reload(); }} />}
    </div>
  );
}

export function ItemForm({ item, onClose, onSaved }: { item: ItemView | null; onClose(): void; onSaved(item: ItemView): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [code, setCode] = useState(item?.code ?? '');
  const [barcode, setBarcode] = useState(item?.barcode ?? '');
  const [name, setName] = useState<Names>(item?.name ?? { ar: '', en: '', ku: '' });
  const [unit, setUnit] = useState<UnitCode>(item?.unit ?? 'piece');
  const [salePrice, setSalePrice] = useState<number | null>(item?.salePrice ?? null);
  const [saleCurrency, setSaleCurrency] = useState<CurrencyCode>(item?.saleCurrency ?? 'IQD');
  const [trackStock, setTrackStock] = useState(item?.trackStock ?? true);
  const [active, setActive] = useState(item?.active ?? true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const input: ItemInput = { name, unit, salePrice: salePrice ?? 0, saleCurrency, trackStock: unit !== 'service' && trackStock, active };
    if (code.trim()) input.code = code.trim();
    if (barcode.trim()) input.barcode = barcode.trim();
    try {
      const saved = item ? await api.updateItem(item.id, input) : await api.createItem(input);
      toast(t('saved'));
      onSaved(saved);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={item ? `${item.code} — ${i18n.name(item.name)}` : t('newItem')} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>{t('nameAr')}</span><input className="input" lang="ar" dir="rtl" value={name.ar} onChange={(e) => setName({ ...name, ar: e.target.value })} autoFocus /></label>
        <label className="field"><span>{t('nameKu')}</span><input className="input" lang="ckb" dir="rtl" value={name.ku} onChange={(e) => setName({ ...name, ku: e.target.value })} /></label>
        <label className="field"><span>{t('nameEn')}</span><input className="input" lang="en" dir="ltr" value={name.en} onChange={(e) => setName({ ...name, en: e.target.value })} /></label>
        <div className="grid-2">
          <label className="field"><span>{t('code')}</span><input className="input ltr" value={code} placeholder="I-0001" onChange={(e) => setCode(e.target.value)} /></label>
          <label className="field"><span>{t('barcode')}</span><input className="input ltr" value={barcode} onChange={(e) => setBarcode(e.target.value)} /></label>
          <label className="field">
            <span>{t('unit')}</span>
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value as UnitCode)}>
              {(Object.keys(UNITS) as UnitCode[]).map((u) => <option key={u} value={u}>{unitName(i18n, u)}</option>)}
            </select>
          </label>
          <div className="field">
            <span>{t('salePrice')}</span>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <AmountInput value={salePrice} currency={saleCurrency} onChange={setSalePrice} ariaLabel={t('salePrice')} />
              <div className="track">
                {(['IQD', 'USD'] as const).map((c) => <button key={c} type="button" aria-pressed={saleCurrency === c} onClick={() => setSaleCurrency(c)}>{c === 'IQD' ? t('iqdName') : '$'}</button>)}
              </div>
            </div>
          </div>
        </div>
        {unit !== 'service' && (
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={trackStock} disabled={item?.hasMoves} onChange={(e) => setTrackStock(e.target.checked)} />{t('trackStock')}</label>
        )}
        {item && <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('active')}</label>}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy} onClick={save}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function WarehouseForm({ onClose, onSaved }: { onClose(): void; onSaved(): void }) {
  const { t } = useI18n();
  const { reloadAccounts } = useData();
  const [code, setCode] = useState('');
  const [name, setName] = useState<Names>({ ar: '', en: '', ku: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.createWarehouse({ code, name });
      await reloadAccounts();
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('newWarehouse')} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>{t('code')}</span><input className="input ltr" value={code} placeholder="ERBIL" onChange={(e) => setCode(e.target.value)} autoFocus /></label>
        <label className="field"><span>{t('nameAr')}</span><input className="input" lang="ar" dir="rtl" value={name.ar} onChange={(e) => setName({ ...name, ar: e.target.value })} /></label>
        <label className="field"><span>{t('nameKu')}</span><input className="input" lang="ckb" dir="rtl" value={name.ku} onChange={(e) => setName({ ...name, ku: e.target.value })} /></label>
        <label className="field"><span>{t('nameEn')}</span><input className="input" lang="en" dir="ltr" value={name.en} onChange={(e) => setName({ ...name, en: e.target.value })} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy} onClick={save}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** بطاقة المادة — stock per warehouse and every move. */
export function ItemDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [editing, setEditing] = useState(false);
  const { data, error, reload } = useLoad(() => api.item(id), [id]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const it = data;
  const sourceKey = (s: string) => (isKey(`src_${s}`) ? (`src_${s}` as Key) : null);
  // opening stock and transfers open their stock document; everything else came from an invoice or a return
  const sourcePath = (s: string, id: string) => (s.startsWith('opening') || s.startsWith('transfer') ? `stock-doc/${id}` : `invoice/${id}`);

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <div className="row no-print">
        <button type="button" className="btn" onClick={() => history.back()}>{t('back')}</button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={16} />{t('actEdit')}</button>
        <button type="button" className="btn" onClick={() => window.print()}><Icon name="printer" size={16} />{t('print')}</button>
      </div>

      <div className="grid-4">
        <div className="card pad tile" style={{ gridColumn: 'span 2' }}>
          <div className="label"><span className="ltr">{it.code}</span>{it.barcode && <> · <span className="ltr">{it.barcode}</span></>}</div>
          <div className="value" style={{ fontSize: 20 }}>{i18n.name(it.name)}</div>
          <div className="muted small">{t('salePrice')}: {i18n.money(it.salePrice, it.saleCurrency)} / {unitName(i18n, it.unit)}</div>
        </div>
        <div className="card pad tile">
          <div className="label">{t('available')}</div>
          <div className="value num">{it.trackStock ? qtyText(i18n, it.qtyMilli) : '—'} <span className="small muted">{unitName(i18n, it.unit)}</span></div>
        </div>
        <div className="card pad tile">
          <div className="label">{t('avgCost')}</div>
          <div className="value num" style={{ fontSize: 18 }}>{it.trackStock ? i18n.money(averageCost(it.qtyMilli, it.value), 'IQD') : '—'}</div>
          {it.trackStock && <div className="muted small">{t('stockValue')}: {i18n.money(it.value, 'IQD')}</div>}
        </div>
      </div>

      {it.stock.length > 1 && (
        <div className="card">
          <div style={{ padding: '12px 16px' }}><h2>{t('warehouses')}</h2></div>
          <table className="table">
            <thead><tr><th>{t('warehouse')}</th><th className="amount">{t('available')}</th><th className="amount">{t('stockValue')}</th></tr></thead>
            <tbody>
              {it.stock.map((s) => (
                <tr key={s.warehouseId}><td>{i18n.name(s.warehouseName)}</td><td className="amount">{qtyText(i18n, s.qtyMilli)}</td><td className="amount">{i18n.money(s.value, 'IQD')}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div style={{ padding: '12px 16px' }}><h2>{t('moves')}</h2></div>
        {it.moves.length === 0 ? <p className="muted" style={{ padding: '0 16px 14px', margin: 0 }}>{t('noStockMoves')}</p> : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('date')}</th><th>{t('colType')}</th><th>{t('number')}</th>
                {it.stock.length > 1 && <th>{t('warehouse')}</th>}
                <th className="amount">{t('movesIn')}</th><th className="amount">{t('movesOut')}</th><th className="amount">{t('balance')}</th><th className="amount">{t('moveValue')}</th>
              </tr>
            </thead>
            <tbody>
              {it.moves.map((m) => {
                const key = sourceKey(m.sourceType);
                return (
                  <tr key={m.id} className={m.sourceId ? 'click' : ''} onClick={() => m.sourceId && go(sourcePath(m.sourceType, m.sourceId))}>
                    <td className="num">{i18n.date(m.date)}</td>
                    <td>{key ? t(key) : m.sourceType}</td>
                    <td><span className="ltr num">{m.sourceNumber ?? ''}</span></td>
                    {it.stock.length > 1 && <td className="ltr">{m.warehouseCode}</td>}
                    <td className="amount">{m.qtyMilli > 0 ? qtyText(i18n, m.qtyMilli) : ''}</td>
                    <td className="amount">{m.qtyMilli < 0 ? qtyText(i18n, -m.qtyMilli) : ''}</td>
                    <td className="amount">{qtyText(i18n, m.balanceQtyMilli)}</td>
                    <td className="amount">{i18n.money(Math.abs(m.value), 'IQD')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && <ItemForm item={it} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </div>
  );
}
