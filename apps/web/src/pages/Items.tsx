import { useEffect, useRef, useState } from 'react';
import { formatQty, MAX_ITEM_UNITS, roundHalfUp, UNITS, unitsForBusiness, type CurrencyCode, type Names, type UnitCode } from '@qasa/core';
import { api, type ItemInput, type ItemView, type WarehouseView } from '../api.ts';
import { EmptyState, AmountInput, ErrorBox, Icon, Modal, QtyInput, downloadCsv, useData, useLandHome, useLoad, useMay, useToast } from '../components.tsx';
import { inUnits } from '../industry/units.ts';
import { batchesApi } from '../industry/batches-api.ts';
import { brandLabel, brandsApi, categoriesApi, categoryLabel, type BrandView, type CategoryView } from '../industry/categories-api.ts';
import { BrandForm, BrandPicker, CategoryOptions, countryName, StarterListButton } from '../industry/CatalogPickers.tsx';
import { ReorderList } from '../industry/ReorderList.tsx';
import { ExpiryChip } from './Expiry.tsx';
import { useI18n, type I18n, isKey, type Key } from '../i18n.ts';
import { go, href } from '../router.ts';
import { ImagePicker, ItemImage, NewItemPicture, saveItemPicture, type PreparedPicture } from '../industry/ItemImage.tsx';
import { NameField } from '../industry/NameField.tsx';
import { WholesalePriceField } from '../industry/WholesalePriceField.tsx';
import { printDocument } from '../industry/printing.ts';

/**
 * What an item form sends for batches and expiry dates. What the form shows is sent, once it knows the company's
 * setting (an edited item, or a new one after the setting loaded); before that, a new item left unticked follows the
 * setting on the server.
 */
export function trackingInput(existing: boolean, defaultsKnown: boolean, trackBatches: boolean, trackExpiry: boolean): { trackBatches?: boolean; trackExpiry?: boolean } {
  if (existing || defaultsKnown || trackBatches || trackExpiry) return { trackBatches: trackBatches || trackExpiry, trackExpiry };
  return {};
}

export function qtyText(i18n: I18n, milli: number): string {
  return i18n.qty(milli);
}

export function unitName(i18n: I18n, unit: UnitCode): string {
  return i18n.name(UNITS[unit]);
}

/** Average cost per unit in IQD, from a stock quantity (thousandths) and its value. */
export function averageCost(qtyMilli: number, value: number): number {
  return qtyMilli > 0 ? roundHalfUp((value * 1000) / qtyMilli) : 0;
}

/** المواد والمخزون */
export function Items({ tab: initialTab }: { tab?: 'reorder' } = {}) {
  const i18n = useI18n();
  const { t } = i18n;
  // the warehouse account's statement is the company's books: no link for someone limited to branches
  const books = useData().companyBooks !== false;
  // 1.4: the average cost and the stock value are not sent to someone who may not see cost (a cashier): no such columns
  const cost = useData().seesCost !== false;
  // buttons only for what this person may do (may.ts): items need the stock permission, warehouses an admin
  const can = useMay();
  const toast = useToast();
  const [tab, setTab] = useState<'items' | 'warehouses' | 'categories' | 'brands' | 'reorder'>(initialTab ?? 'items');
  const [q, setQ] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [editing, setEditing] = useState<ItemView | 'new' | null>(null);
  const [newWarehouse, setNewWarehouse] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkError, setBulkError] = useState<unknown>(null);
  const items = useLoad(() => api.items({ q: q.trim(), warehouseId, ...(categoryId ? { categoryId } : {}), ...(brandId ? { brandId } : {}) }), [q, warehouseId, categoryId, brandId]);
  const warehouses = useLoad(() => api.warehouses(), []);
  const categories = useLoad(() => categoriesApi.list(), []);
  const brands = useLoad(() => brandsApi.list(), []);
  const brandById = new Map((brands.data ?? []).map((b) => [b.id, b]));
  const catText = (id: string | null) => categoryLabel(categories.data ?? [], id, i18n.name);
  const totalValue = (items.data ?? []).reduce((s, it) => s + (it.value ?? 0), 0);

  const exportCsv = () => downloadCsv('items.csv', [
    [t('code'), t('name'), t('unit'), t('available'), ...(cost ? [t('avgCost'), t('stockValue')] : []), t('salePrice'), t('cat_category'), t('bnd_brand')],
    ...(items.data ?? []).map((it) => [it.code, i18n.name(it.name), unitName(i18n, it.unit), formatQty(it.qtyMilli),
      ...(cost ? [averageCost(it.qtyMilli, it.value ?? 0), it.value ?? 0] : []), it.salePrice,
      catText(it.categoryId), it.brandId ? brandById.get(it.brandId)?.name ?? '' : ''])
  ]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function setCategoryForSelected() {
    setBulkError(null);
    try {
      const r = await categoriesApi.setForItems([...selected], bulkCategory === 'none' ? null : bulkCategory);
      toast(t('cat_updated', { n: r.updated }));
      setSelected(new Set());
      items.reload();
      categories.reload();
    } catch (e) {
      setBulkError(e);
    }
  }

  return (
    <div className="stack">
      <div className="tabs">
        <button type="button" aria-pressed={tab === 'items'} onClick={() => setTab('items')}>{t('items')}</button>
        <button type="button" aria-pressed={tab === 'warehouses'} onClick={() => setTab('warehouses')}>{t('warehouses')}</button>
        <button type="button" aria-pressed={tab === 'categories'} onClick={() => setTab('categories')}>{t('cat_title')}</button>
        <button type="button" aria-pressed={tab === 'brands'} onClick={() => setTab('brands')}>{t('bnd_title')}</button>
        <button type="button" aria-pressed={tab === 'reorder'} onClick={() => setTab('reorder')}>{t('ro_title')}</button>
      </div>
      {tab === 'reorder' && <ReorderList />}

      {tab === 'categories' && <Categories list={categories.data ?? []} error={categories.error} onChanged={() => { categories.reload(); brands.reload(); items.reload(); }} />}
      {tab === 'brands' && <Brands list={brands.data ?? []} error={brands.error} onChanged={() => { brands.reload(); categories.reload(); items.reload(); }} />}

      {tab === 'items' && (
        <>
          <div className="row">
            {can('item') && <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('newItem')}</button>}
            {can('purchase') && <a className="btn" href={href('new-invoice/purchase')}><Icon name="invoice" size={16} />{t('newPurchase')}</a>}
            {can('importPage') && <a className="btn" href={href('import')}><Icon name="upload" size={16} />{t('importExcel')}</a>}
            <span className="spacer" />
            {(warehouses.data?.length ?? 0) > 1 && (
              <select className="input" style={{ width: 200 }} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label={t('warehouse')}>
                <option value="">{t('allWarehouses')}</option>
                {warehouses.data!.map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
              </select>
            )}
            {(categories.data?.length ?? 0) > 0 && (
              <select className="input" style={{ width: 180 }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label={t('cat_category')}>
                <option value="">{t('cat_all')}</option>
                <option value="none">{t('cat_none')}</option>
                {categories.data!.map((c) => <option key={c.id} value={c.id}>{catText(c.id)}</option>)}
              </select>
            )}
            {(brands.data?.length ?? 0) > 0 && (
              <select className="input" style={{ width: 160 }} value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-label={t('bnd_brand')}>
                <option value="">{t('bnd_all')}</option>
                <option value="none">{t('bnd_none')}</option>
                {brands.data!.map((b) => <option key={b.id} value={b.id}>{brandLabel(b, i18n.lang)}</option>)}
              </select>
            )}
            <input className="input" style={{ width: 240 }} type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" className="btn" onClick={exportCsv}><Icon name="download" size={16} />{t('exportExcel')}</button>
          </div>
          {selected.size > 0 && can('item') && (
            <div className="card pad row">
              <span>{t('cat_setFor', { n: selected.size })}</span>
              <select className="input" style={{ width: 200 }} value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} aria-label={t('cat_category')}>
                <option value="" />
                <option value="none">{t('cat_none')}</option>
                <CategoryOptions list={categories.data ?? []} />
              </select>
              <button type="button" className="btn primary" disabled={!bulkCategory} onClick={() => void setCategoryForSelected()}>{t('cat_set')}</button>
              <button type="button" className="btn" onClick={() => setSelected(new Set())}>{t('cancel')}</button>
              <ErrorBox error={bulkError} />
            </div>
          )}
          <ErrorBox error={items.error} />
          <div className="card">
            {items.data && items.data.length === 0 && (q.trim() || warehouseId || categoryId || brandId
              ? <EmptyState compact icon="search" title={t('es_search')} text={t('es_searchText')} />
              : <EmptyState icon="box" title={t('es_items')} text={t('es_itemsText')} {...(can('item') ? { action: { label: t('newItem'), icon: 'plus', onClick: () => setEditing('new') } } : {})} {...(can('importPage') ? { secondary: { label: t('importExcel'), icon: 'upload', href: href('import') } } : {})} />)}
            {items.data && items.data.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }} />
                    <th style={{ width: 100 }}>{t('code')}</th>
                    <th>{t('item')}</th>
                    <th className="amount">{t('available')}</th>
                    {cost && <th className="amount">{t('avgCost')}</th>}
                    {cost && <th className="amount">{t('stockValue')}</th>}
                    <th className="amount">{t('salePrice')}</th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {items.data.map((it) => (
                    <tr key={it.id} className="click" onClick={() => go(`item/${it.id}`)}>
                      <td onClick={(e) => e.stopPropagation()}>{can('item') && <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} aria-label={it.code} />}</td>
                      <td><span className="tree-code">{it.code}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <ItemImage itemId={it.id} name={i18n.name(it.name)} size={36} />
                          <div>
                            <strong>{i18n.name(it.name)}</strong>
                            {!it.active && <span className="chip" style={{ marginInlineStart: 8 }}>{t('inactive')}</span>}
                            {it.barcode && <div className="muted small ltr">{it.barcode}</div>}
                            {(it.categoryId || it.brandId) && (
                              <div className="muted small">{[catText(it.categoryId), brandLabel(it.brandId ? brandById.get(it.brandId) : undefined, i18n.lang)].filter(Boolean).join(' · ')}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="amount">
                        {it.trackStock
                          ? <span style={{ color: it.qtyMilli <= 0 ? 'var(--bad)' : undefined }}>{qtyText(i18n, it.qtyMilli)} <span className="muted small">{unitName(i18n, it.unit)}</span></span>
                          : <span className="muted small">{unitName(i18n, it.unit)}</span>}
                        {it.trackStock && it.units.length > 0 && it.qtyMilli > 0 && <div className="muted small">{inUnits(i18n, it, it.qtyMilli)}</div>}
                      </td>
                      {cost && <td className="amount">{it.trackStock && it.qtyMilli > 0 ? i18n.money(averageCost(it.qtyMilli, it.value ?? 0), 'IQD') : ''}</td>}
                      {cost && <td className="amount">{it.trackStock ? i18n.money(it.value ?? 0, 'IQD') : ''}</td>}
                      <td className="amount">{i18n.money(it.salePrice, it.saleCurrency)}</td>
                      <td>
                        {can('item') && (
                          <button type="button" className="btn icon ghost" title={t('actEdit')} aria-label={t('actEdit')} onClick={(e) => { e.stopPropagation(); setEditing(it); }}>
                            <Icon name="edit" size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {cost && (
                  <tfoot>
                    <tr><td /><td /><td>{t('total')}</td><td /><td /><td className="amount">{i18n.money(totalValue, 'IQD')}</td><td /><td /></tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'warehouses' && (
        <>
          {can('warehouse') && (
            <div className="row">
              <button type="button" className="btn primary" onClick={() => setNewWarehouse(true)}><Icon name="plus" size={16} />{t('newWarehouse')}</button>
            </div>
          )}
          <ErrorBox error={warehouses.error} />
          <div className="card">
            {warehouses.data && (
              <table className="table">
                <thead><tr><th style={{ width: 100 }}>{t('code')}</th><th>{t('warehouse')}</th><th>{t('linkedAccount')}</th>{cost && <th className="amount">{t('stockValue')}</th>}</tr></thead>
                <tbody>
                  {warehouses.data.map((w: WarehouseView) => (
                    <tr key={w.id}>
                      <td><span className="tree-code">{w.code}</span></td>
                      <td>{i18n.name(w.name)}</td>
                      <td>{books ? <a href={href(`statement/${w.accountCode}`)} className="ltr">{w.accountCode}</a> : <span className="ltr">{w.accountCode}</span>}</td>
                      {cost && <td className="amount">{i18n.money(w.value ?? 0, 'IQD')}</td>}
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

interface UnitRow { key: number; unit: UnitCode | ''; factorMilli: number | null; barcode: string; salePrice: number | null }
let unitKey = 1;

/** A unit row nothing was written in: it is left out when saving. */
const emptyRow = (u: UnitRow) => !u.unit && u.factorMilli === null && !u.barcode.trim() && u.salePrice === null;
/** A unit row that can be saved: its unit chosen and how many base units it holds written. */
const completeRow = (u: UnitRow) => !!u.unit && u.factorMilli !== null && u.factorMilli > 0;

/**
 * The profit on one base unit: the sale price less the purchase price, with the purchase price taken to the sale
 * currency at the company's rate when the two differ. null when either is missing or it cannot be converted.
 */
export function itemMargin(
  purchase: number | null, purchaseCurrency: CurrencyCode, sale: number | null, saleCurrency: CurrencyCode, rateX100: number | undefined
): { amount: number; percent: number } | null {
  if (purchase === null || sale === null || purchase <= 0) return null;
  let cost = purchase;
  if (purchaseCurrency !== saleCurrency) {
    if (!rateX100) return null;
    // IQD is kept in dinars, USD in cents
    cost = saleCurrency === 'USD' ? roundHalfUp((purchase * 10000) / rateX100) : roundHalfUp((purchase * rateX100) / 10000);
  }
  if (cost <= 0) return null;
  const amount = sale - cost;
  return { amount, percent: Math.round((amount * 1000) / cost) / 10 };
}

function CurrencyTrack({ value, onChange }: { value: CurrencyCode; onChange(c: CurrencyCode): void }) {
  const { t } = useI18n();
  return (
    <div className="track">
      {(['IQD', 'USD'] as const).map((c) => <button key={c} type="button" aria-pressed={value === c} onClick={() => onChange(c)}>{c === 'IQD' ? t('iqdName') : '$'}</button>)}
    </div>
  );
}

export function ItemForm({ item, onClose, onSaved }: { item: ItemView | null; onClose(): void; onSaved(item: ItemView): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, permissions } = useData();
  const [code, setCode] = useState(item?.code ?? '');
  const [barcode, setBarcode] = useState(item?.barcode ?? '');
  const [name, setName] = useState<Names>(item?.name ?? { ar: '', en: '', ku: '' });
  const [unit, setUnit] = useState<UnitCode>(item?.unit ?? 'piece');
  const [salePrice, setSalePrice] = useState<number | null>(item?.salePrice ?? null);
  const [saleCurrency, setSaleCurrency] = useState<CurrencyCode>(item?.saleCurrency ?? 'IQD');
  // the purchase price is for those who buy or keep the stock: the server leaves it out for anyone else, and the form
  // then neither shows nor sends it (what is written stays)
  const seesCost = item ? item.purchasePrice !== undefined : !permissions || permissions.some((p) => p === 'admin' || p === 'stock' || p === 'purchases');
  const [purchasePrice, setPurchasePrice] = useState<number | null>(item?.purchasePrice ?? null);
  const [purchaseCurrency, setPurchaseCurrency] = useState<CurrencyCode>(item?.purchaseCurrency ?? item?.saleCurrency ?? 'IQD');
  const purchaseCurrencyTouched = useRef(item?.purchasePrice !== null && item?.purchasePrice !== undefined);
  const [picture, setPicture] = useState<PreparedPicture | null>(null);
  const [trackStock, setTrackStock] = useState(item?.trackStock ?? true);
  const [active, setActive] = useState(item?.active ?? true);
  const [units, setUnits] = useState<UnitRow[]>(() => (item?.units ?? []).map((u) => ({ key: unitKey++, unit: u.unit, factorMilli: u.factorMilli, barcode: u.barcode, salePrice: u.salePrice })));
  const [trackBatches, setTrackBatches] = useState(item?.trackBatches ?? false);
  const [trackExpiry, setTrackExpiry] = useState(item ? item.trackExpiry : false);
  // a new item starts from the company's setting for expiry dates (a pharmacy has it on), shown as it will be saved
  const [defaultsKnown, setDefaultsKnown] = useState(!!item);
  const trackingTouched = useRef(false);
  useEffect(() => {
    if (item) return;
    let alive = true;
    batchesApi.settings().then((s) => {
      if (!alive) return;
      if (!trackingTouched.current && s.defaultTrackExpiry) { setTrackExpiry(true); setTrackBatches(true); }
      setDefaultsKnown(true);
    }, () => {});
    return () => { alive = false; };
  }, [item]);
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? '');
  const [brandId, setBrandId] = useState(item?.brandId ?? '');
  const [reorderMilli, setReorderMilli] = useState<number | null>(item?.reorderMilli ?? null);
  const categories = useLoad(() => categoriesApi.list(), []);
  const [saleUnit, setSaleUnit] = useState<UnitCode | ''>(item?.saleUnit ?? '');
  const [purchaseUnit, setPurchaseUnit] = useState<UnitCode | ''>(item?.purchaseUnit ?? '');
  const [error, setError] = useState<unknown>(null);
  const [unitsProblem, setUnitsProblem] = useState(false);
  const [busy, setBusy] = useState(false);
  const listed = units.filter(completeRow);

  // the units offered: those of the company's trade, with every unit its items use already and what this form holds;
  // "show all units" lists the rest
  const used = useLoad(() => api.usedUnits().catch(() => [] as UnitCode[]), []);
  const [allUnits, setAllUnits] = useState(false);
  const offer = unitsForBusiness(allUnits ? null : settings?.businessTypes, [...(used.data ?? []), unit, ...units.map((u) => u.unit)]);
  const narrowed = unitsForBusiness(settings?.businessTypes).narrowed;
  const market = !!settings?.businessTypes?.includes('market');

  const setRow = (key: number, patch: Partial<UnitRow>) => { setUnitsProblem(false); setUnits((us) => us.map((x) => (x.key === key ? { ...x, ...patch } : x))); };
  const margin = seesCost ? itemMargin(purchasePrice, purchaseCurrency, salePrice, saleCurrency, settings?.defaultRateX100) : null;

  async function save() {
    setError(null);
    // a unit half written is said, not dropped in silence
    if (unit !== 'service' && units.some((u) => !emptyRow(u) && !completeRow(u))) { setUnitsProblem(true); return; }
    setBusy(true);
    const input: ItemInput = {
      name, unit, salePrice: salePrice ?? 0, saleCurrency, trackStock: unit !== 'service' && trackStock, active,
      units: unit === 'service' ? [] : listed.map((u) => ({ unit: u.unit as UnitCode, factorMilli: u.factorMilli ?? 0, barcode: u.barcode.trim(), salePrice: u.salePrice })),
      // a default unit that is no longer listed falls back to the base unit
      saleUnit: saleUnit && listed.some((u) => u.unit === saleUnit) ? saleUnit : null,
      purchaseUnit: purchaseUnit && listed.some((u) => u.unit === purchaseUnit) ? purchaseUnit : null,
      categoryId: categoryId || null,
      brandId: brandId || null,
      reorderMilli: unit !== 'service' && trackStock ? reorderMilli : null,
      ...(seesCost ? { purchasePrice, purchaseCurrency: purchasePrice === null ? null : purchaseCurrency } : {}),
      ...trackingInput(!!item, defaultsKnown, trackBatches, trackExpiry)
    };
    if (code.trim()) input.code = code.trim();
    if (barcode.trim()) input.barcode = barcode.trim();
    try {
      const saved = item ? await api.updateItem(item.id, input) : await api.createItem(input);
      let pictureSaved = true;
      if (!item && picture) {
        // the item exists now; a picture that fails leaves it saved, and can be added from its page
        try { await saveItemPicture(saved.id, picture.data); } catch { pictureSaved = false; }
      }
      toast(pictureSaved ? t('saved') : t('it_pictureNotSaved'));
      onSaved(saved);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const unitOptions = (keep: UnitCode | '', except: (c: UnitCode) => boolean) =>
    offer.units.filter((c) => c === keep || !except(c)).map((c) => <option key={c} value={c}>{unitName(i18n, c)}</option>);
  const showAllLink = narrowed && (
    <div><button type="button" className="btn small ghost" onClick={() => setAllUnits((v) => !v)}>{allUnits ? t('un_showMine') : t('un_showAll')}</button></div>
  );

  return (
    <Modal title={item ? `${item.code} — ${i18n.name(item.name)}` : t('newItem')} onClose={onClose}>
      <div className="stack item-form">
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          {item
            ? <div style={{ inlineSize: 128, flexShrink: 0 }}><ImagePicker itemId={item.id} name={i18n.name(item.name)} size={104} /></div>
            : <NewItemPicture value={picture} onChange={setPicture} />}
          <div className="stack" style={{ flex: '1 1 260px', minInlineSize: 0 }}>
            <NameField label={t('it_name')} value={name} onChange={setName} autoFocus />
            <div className="grid-2">
              <label className="field"><span>{t('code')}</span><input className="input ltr" value={code} placeholder="I-0001" maxLength={24} onChange={(e) => setCode(e.target.value)} /></label>
              <label className="field"><span>{t('barcode')}</span><input className="input ltr" value={barcode} maxLength={64} onChange={(e) => setBarcode(e.target.value)} /></label>
            </div>
          </div>
        </div>
        <div className="grid-2">
          {seesCost && (
            <div className="field">
              <span>{t('it_purchasePrice')}</span>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <AmountInput value={purchasePrice} currency={purchaseCurrency} onChange={setPurchasePrice} ariaLabel={t('it_purchasePrice')} />
                <CurrencyTrack value={purchaseCurrency} onChange={(c) => { purchaseCurrencyTouched.current = true; setPurchaseCurrency(c); }} />
              </div>
            </div>
          )}
          <div className="field">
            <span>{t('salePrice')}</span>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <AmountInput value={salePrice} currency={saleCurrency} onChange={setSalePrice} ariaLabel={t('salePrice')} />
              {/* until a purchase currency is chosen it follows the sale currency */}
              <CurrencyTrack value={saleCurrency} onChange={(c) => { setSaleCurrency(c); if (!purchaseCurrencyTouched.current && purchasePrice === null) setPurchaseCurrency(c); }} />
            </div>
            {margin && (
              <span className="small" style={{ color: margin.amount < 0 ? 'var(--bad)' : 'var(--ink-2)' }}>
                {t(margin.amount < 0 ? 'it_marginLoss' : 'it_margin', { a: i18n.money(Math.abs(margin.amount), saleCurrency), p: i18n.digitsOf(String(Math.abs(margin.percent))) })}
              </span>
            )}
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="field">
              <span>{t('unit')}</span>
              <select className="input" value={unit} onChange={(e) => setUnit(e.target.value as UnitCode)}>
                {unitOptions(unit, () => false)}
              </select>
            </label>
            {showAllLink}
          </div>
          {(categories.data?.length ?? 0) > 0 && (
            <label className="field">
              <span>{t('cat_category')}</span>
              <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">{t('cat_none')}</option>
                <CategoryOptions list={categories.data!} keep={categoryId} />
              </select>
            </label>
          )}
          <div className="field"><span>{t('bnd_brand')}</span><BrandPicker value={brandId} onChange={setBrandId} /></div>
          {unit !== 'service' && trackStock && (
            <div className="field">
              <span>{t('ro_minimum')}</span>
              <QtyInput value={reorderMilli} onChange={setReorderMilli} ariaLabel={t('ro_minimum')} />
            </div>
          )}
        </div>
        {market && (unit === 'kg' || unit === 'g') && <span className="muted small">{t('it_scaleHint')}</span>}
        {unit !== 'service' && (
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={trackStock} disabled={item?.hasMoves} onChange={(e) => setTrackStock(e.target.checked)} />{t('trackStock')}</label>
        )}
        {unit !== 'service' && trackStock && (
          <div className="stack" style={{ gap: 4 }}>
            <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={trackBatches || trackExpiry} disabled={trackExpiry} onChange={(e) => { trackingTouched.current = true; setTrackBatches(e.target.checked); }} />{t('ex_trackBatches')}</label>
            <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={trackExpiry} onChange={(e) => { trackingTouched.current = true; setTrackExpiry(e.target.checked); }} />{t('ex_trackExpiry')}</label>
            <span className="muted small">{t('ex_trackHelp')}</span>
          </div>
        )}
        {unit !== 'service' && (
          <fieldset className="card pad stack" style={{ gap: 12, minInlineSize: 0 }}>
            <legend className="small"><strong>{t('un_other')}</strong></legend>
            <p className="muted small" style={{ margin: 0 }}>{t('un_baseHelp')}</p>
            {/* what is added so far, said in words: "1 carton = 12 piece" */}
            {listed.length > 0 && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} aria-label={t('un_added')}>
                {listed.map((u) => (
                  <span key={u.key} className="chip">
                    {t('un_equals', { u: unitName(i18n, u.unit as UnitCode), q: i18n.digitsOf(formatQty(u.factorMilli ?? 0)), b: unitName(i18n, unit) })}
                  </span>
                ))}
              </div>
            )}
            {units.map((u) => (
              <div key={u.key} className="stack" style={{ gap: 8, paddingBlockStart: 12, borderBlockStart: '1px solid var(--line)' }}>
                <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-end', gap: 8 }}>
                  <label className="field" style={{ flex: '1 1 0' }}>
                    <span>{t('unit')}</span>
                    <select className="input" value={u.unit} onChange={(e) => setRow(u.key, { unit: e.target.value as UnitCode | '' })}>
                      <option value="">{t('un_choose')}</option>
                      {unitOptions(u.unit, (c) => c === unit || c === 'service' || units.some((x) => x.key !== u.key && x.unit === c))}
                    </select>
                  </label>
                  <div className="field" style={{ flex: '1 1 0' }}>
                    <span>{t('un_holds')}</span>
                    <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                      <QtyInput value={u.factorMilli} onChange={(v) => setRow(u.key, { factorMilli: v })} ariaLabel={t('un_holds')} />
                      <span className="muted small" style={{ whiteSpace: 'nowrap' }}>{unitName(i18n, unit)}</span>
                    </div>
                  </div>
                  <button type="button" className="btn icon danger" title={t('un_remove')} aria-label={t('un_remove')} onClick={() => { setUnitsProblem(false); setUnits((us) => us.filter((x) => x.key !== u.key)); }}><Icon name="x" size={16} /></button>
                </div>
                <div className="grid-2">
                  <label className="field"><span>{t('barcode')}</span><input className="input ltr" value={u.barcode} maxLength={64} onChange={(e) => setRow(u.key, { barcode: e.target.value })} /></label>
                  <div className="field">
                    <span>{t('un_ownPrice')}</span>
                    <AmountInput value={u.salePrice} currency={saleCurrency} ariaLabel={t('un_ownPrice')} onChange={(v) => setRow(u.key, { salePrice: v })} />
                    <span className="muted small">{t('un_ownPriceHint')}</span>
                  </div>
                </div>
              </div>
            ))}
            {unitsProblem && <div className="alert bad" role="alert">{t('un_incomplete', { b: unitName(i18n, unit) })}</div>}
            <div className="row">
              {units.length < MAX_ITEM_UNITS && <button type="button" className="btn small" onClick={() => setUnits((us) => [...us, { key: unitKey++, unit: '', factorMilli: null, barcode: '', salePrice: null }])}><Icon name="plus" size={15} />{t('un_add')}</button>}
            </div>
            {listed.length > 0 && (
              <div className="grid-2">
                <label className="field">
                  <span>{t('un_saleUnit')}</span>
                  <select className="input" value={saleUnit && listed.some((u) => u.unit === saleUnit) ? saleUnit : ''} onChange={(e) => setSaleUnit(e.target.value as UnitCode | '')}>
                    <option value="">{unitName(i18n, unit)}</option>
                    {listed.map((u) => <option key={u.key} value={u.unit}>{unitName(i18n, u.unit as UnitCode)}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>{t('un_purchaseUnit')}</span>
                  <select className="input" value={purchaseUnit && listed.some((u) => u.unit === purchaseUnit) ? purchaseUnit : ''} onChange={(e) => setPurchaseUnit(e.target.value as UnitCode | '')}>
                    <option value="">{unitName(i18n, unit)}</option>
                    {listed.map((u) => <option key={u.key} value={u.unit}>{unitName(i18n, u.unit as UnitCode)}</option>)}
                  </select>
                </label>
              </div>
            )}
          </fieldset>
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

/** The categories tab: add, rename, order, switch off; a category nothing uses can be deleted. */
function Categories({ list, error, onChanged }: { list: CategoryView[]; error: unknown; onChanged(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [editing, setEditing] = useState<CategoryView | { parentId: string } | 'new' | null>(null);
  const can = useMay();
  const [actionError, setActionError] = useState<unknown>(null);
  async function act(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setActionError(e);
    }
  }
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('cat_help')}</p>
      {can('item') && <div className="row"><button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('cat_new')}</button></div>}
      <StarterListButton onAdded={onChanged} />
      <ErrorBox error={error ?? actionError} />
      <div className="card">
        {list.length === 0 ? <EmptyState compact icon="tag" title={t('cat_title')} text={t('cat_help')} /> : (
          <table className="table">
            <thead><tr><th style={{ width: 90 }}>{t('code')}</th><th>{t('name')}</th><th className="amount">{t('cat_order')}</th><th className="amount">{t('cat_items')}</th><th /></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td><span className="tree-code">{c.code}</span></td>
                  {/* a subcategory sits under its category, indented on the reading side (start: right in Arabic and Kurdish) */}
                  <td style={c.parentId ? { paddingInlineStart: 32 } : undefined}>
                    {c.parentId ? <span className="muted" aria-hidden="true">{i18n.lang === 'en' ? '└ ' : '┘ '}</span> : null}
                    {c.parentId ? i18n.name(c.name) : <strong>{i18n.name(c.name)}</strong>}
                    {!c.active && <span className="chip" style={{ marginInlineStart: 8 }}>{t('inactive')}</span>}
                    {c.children > 0 && <span className="muted small" style={{ marginInlineStart: 8 }}>{t('cat_subs')}: {i18n.int(c.children)}</span>}
                  </td>
                  <td className="amount num">{i18n.int(c.sort)}</td>
                  <td className="amount num">{i18n.int(c.items)}</td>
                  <td className="row" style={{ justifyContent: 'flex-end', gap: 4, ...(can('item') ? {} : { display: 'none' }) }}>
                    {!c.parentId && c.active && <button type="button" className="btn small" onClick={() => setEditing({ parentId: c.id })}><Icon name="plus" size={14} />{t('cat_newSub')}</button>}
                    <button type="button" className="btn small" onClick={() => setEditing(c)}><Icon name="edit" size={14} />{t('actEdit')}</button>
                    <button type="button" className="btn small" onClick={() => void act(() => categoriesApi.update(c.id, { code: c.code, name: c.name, sort: c.sort, active: !c.active }))}>{c.active ? t('cat_deactivate') : t('cat_activate')}</button>
                    {c.items === 0 && c.children === 0 && <button type="button" className="btn small danger" aria-label={t('actDelete')} onClick={() => void act(() => categoriesApi.remove(c.id))}><Icon name="x" size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <CategoryForm category={editing === 'new' || !('id' in editing) ? null : editing} parentId={editing !== 'new' && !('id' in editing) ? editing.parentId : null} list={list}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
      )}
    </div>
  );
}

function CategoryForm({ category, parentId: newParent, list, onClose, onSaved }: {
  category: CategoryView | null; parentId: string | null; list: CategoryView[]; onClose(): void; onSaved(): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [parentId, setParentId] = useState(category?.parentId ?? newParent ?? '');
  // a parent is an active top-level category other than this one; a category with subcategories stays at the top
  const parents = list.filter((c) => !c.parentId && c.id !== category?.id && (c.active || c.id === category?.parentId));
  const toast = useToast();
  const [code, setCode] = useState(category?.code ?? '');
  const [name, setName] = useState<Names>(category?.name ?? { ar: '', en: '', ku: '' });
  const [sort, setSort] = useState(category?.sort ?? 0);
  const [reorderMilli, setReorderMilli] = useState<number | null>(category?.reorderMilli ?? null);
  const [error, setError] = useState<unknown>(null);
  async function save() {
    setError(null);
    try {
      const input = { ...(code.trim() ? { code: code.trim() } : {}), name, ...(category ? { sort } : {}), parentId: parentId || null, reorderMilli };
      if (category) await categoriesApi.update(category.id, input);
      else await categoriesApi.create(input);
      toast(t('cat_saved'));
      onSaved();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <Modal title={category ? `${category.code}` : newParent ? t('cat_newSub') : t('cat_new')} onClose={onClose}>
      <div className="stack">
        {!(category && category.children > 0) && (
          <label className="field">
            <span>{t('cat_parent')}</span>
            <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">{t('cat_topLevel')}</option>
              {parents.map((c) => <option key={c.id} value={c.id}>{i18n.name(c.name)}</option>)}
            </select>
          </label>
        )}
        <NameField label={t('name')} value={name} onChange={setName} autoFocus />
        <div className="grid-2">
          <label className="field"><span>{t('code')}</span><input className="input ltr" value={code} placeholder="C001" maxLength={24} onChange={(e) => setCode(e.target.value)} /></label>
          {category && <label className="field"><span>{t('cat_order')}</span><input className="input num" type="number" min={0} max={100000} value={sort} onChange={(e) => setSort(Math.max(0, Math.floor(Number(e.target.value)) || 0))} /></label>}
          <div className="field">
            <span>{t('ro_categoryMinimum')}</span>
            <QtyInput value={reorderMilli} onChange={setReorderMilli} ariaLabel={t('ro_categoryMinimum')} />
            <span className="muted small">{t('ro_categoryHelp')}</span>
          </div>
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" onClick={() => void save()}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** The brands tab: add, rename, country of origin, order, switch off; a brand no item has can be deleted. */
function Brands({ list, error, onChanged }: { list: BrandView[]; error: unknown; onChanged(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [editing, setEditing] = useState<BrandView | 'new' | null>(null);
  const can = useMay();
  const [actionError, setActionError] = useState<unknown>(null);
  async function act(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setActionError(e);
    }
  }
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('bnd_help')}</p>
      {can('item') && <div className="row"><button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('bnd_new')}</button></div>}
      <StarterListButton onAdded={onChanged} />
      <ErrorBox error={error ?? actionError} />
      <div className="card">
        {list.length === 0 ? <EmptyState compact icon="tag" title={t('bnd_title')} text={t('bnd_help')} /> : (
          <table className="table">
            <thead><tr><th>{t('bnd_name')}</th><th>{t('bnd_country')}</th><th className="amount">{t('cat_order')}</th><th className="amount">{t('cat_items')}</th><th /></tr></thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.id}>
                  <td>
                    <bdi>{b.name}</bdi>
                    {(i18n.lang === 'ar' ? b.nameAr : i18n.lang === 'ku' ? b.nameKu : '') && <span className="muted" style={{ marginInlineStart: 8 }}>{brandLabel(b, i18n.lang)}</span>}
                    {b.code && <span className="tree-code" style={{ marginInlineStart: 8 }}>{b.code}</span>}
                    {!b.active && <span className="chip" style={{ marginInlineStart: 8 }}>{t('inactive')}</span>}
                  </td>
                  <td>{countryName(i18n.lang, b.country)}</td>
                  <td className="amount num">{i18n.int(b.sort)}</td>
                  <td className="amount num">{i18n.int(b.items)}</td>
                  <td className="row" style={{ justifyContent: 'flex-end', gap: 4, ...(can('item') ? {} : { display: 'none' }) }}>
                    <button type="button" className="btn small" onClick={() => setEditing(b)}><Icon name="edit" size={14} />{t('actEdit')}</button>
                    <button type="button" className="btn small" onClick={() => void act(() => brandsApi.update(b.id, { name: b.name, active: !b.active }))}>{b.active ? t('cat_deactivate') : t('cat_activate')}</button>
                    {b.items === 0 && <button type="button" className="btn small danger" aria-label={t('actDelete')} onClick={() => void act(() => brandsApi.remove(b.id))}><Icon name="x" size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && <BrandForm brand={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
    </div>
  );
}

/** The item card's batches: each batch with its expiry (coloured by how near it is) and its quantity per warehouse. */
function ItemBatches({ itemId }: { itemId: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { data } = useLoad(() => batchesApi.ofItem(itemId), [itemId]);
  const rows = (data ?? []).filter((b) => b.qtyMilli !== 0);
  return (
    <div className="card">
      <div style={{ padding: '12px 16px' }}><h2>{t('ex_title')}</h2></div>
      {rows.length === 0 ? <p className="muted" style={{ padding: '0 16px 14px', margin: 0 }}>{t('ex_none')}</p> : (
        <table className="table">
          <thead><tr><th>{t('ex_batch')}</th><th>{t('ex_expiry')}</th><th>{t('warehouse')}</th><th className="amount">{t('qty')}</th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={`${b.batchId}|${b.warehouseId}`}>
                <td className="ltr">{b.batch || t('ex_noNumber')}</td>
                <td><ExpiryChip state={b.state} expiry={b.expiry} i18n={i18n} /></td>
                <td>{i18n.name(b.warehouseName)}</td>
                <td className="amount">{i18n.qty(b.qtyMilli)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
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
        <NameField label={t('name')} value={name} onChange={setName} />
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
  const can = useMay();
  const { seesBooks } = useData();
  const { data, error, reload } = useLoad(() => api.item(id), [id]);
  if (useLandHome(error)) return null;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const it = data;
  // 1.4: no value on the item: it was not sent (a cashier), so no average cost tile and no value columns
  const cost = it.value !== undefined;
  const sourceKey = (s: string) => (isKey(`src_${s}`) ? (`src_${s}` as Key) : null);
  // opening stock and transfers open their stock document; everything else came from an invoice or a return
  const sourcePath = (s: string, id: string) => (s.startsWith('opening') || s.startsWith('transfer') ? `stock-doc/${id}` : `invoice/${id}`);
  // a move opens its document for someone who may open it: the purchases and the stock documents are not a cashier's
  // (those addresses land on the home page), their own sales and sales returns are
  const opens = (s: string) => seesBooks !== false || s.startsWith('sale');

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <div className="row no-print">
        <button type="button" className="btn" onClick={() => history.back()}>{t('back')}</button>
        <span className="spacer" />
        {can('item') && <button type="button" className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={16} />{t('actEdit')}</button>}
        <button type="button" className="btn" onClick={() => void printDocument('report')}><Icon name="printer" size={16} />{t('print')}</button>
      </div>

      <div className="grid-4">
        <div className="card pad tile" style={{ gridColumn: 'span 2', flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <ImagePicker itemId={it.id} name={i18n.name(it.name)} canEdit={can('item')} />
          <div className="stack" style={{ gap: 6, minWidth: 0 }}>
            <div className="label"><span className="ltr">{it.code}</span>{it.barcode && <> · <span className="ltr">{it.barcode}</span></>}</div>
            <div className="value" style={{ fontSize: 20, whiteSpace: 'normal' }}>{i18n.name(it.name)}</div>
            <div className="muted small">{t('salePrice')}: {i18n.money(it.salePrice, it.saleCurrency)} / {unitName(i18n, it.unit)}</div>
          </div>
        </div>
        <div className="card pad tile">
          <div className="label">{t('available')}</div>
          <div className="value num">{it.trackStock ? qtyText(i18n, it.qtyMilli) : '—'} <span className="small muted">{unitName(i18n, it.unit)}</span></div>
          {it.trackStock && it.units.length > 0 && it.qtyMilli > 0 && <div className="muted small">{inUnits(i18n, it, it.qtyMilli)}</div>}
        </div>
        {cost && it.value !== undefined && (
          <div className="card pad tile">
            <div className="label">{t('avgCost')}</div>
            <div className="value num" style={{ fontSize: 18 }}>{it.trackStock ? i18n.money(averageCost(it.qtyMilli, it.value), 'IQD') : '—'}</div>
            {it.trackStock && <div className="muted small">{t('stockValue')}: {i18n.money(it.value, 'IQD')}</div>}
          </div>
        )}
      </div>

      <div className="no-print"><WholesalePriceField itemId={it.id} /></div>

      {it.trackBatches && <ItemBatches itemId={it.id} />}

      {it.stock.length > 1 && (
        <div className="card">
          <div style={{ padding: '12px 16px' }}><h2>{t('warehouses')}</h2></div>
          <table className="table">
            <thead><tr><th>{t('warehouse')}</th><th className="amount">{t('available')}</th>{cost && <th className="amount">{t('stockValue')}</th>}</tr></thead>
            <tbody>
              {it.stock.map((s) => (
                <tr key={s.warehouseId}><td>{i18n.name(s.warehouseName)}</td><td className="amount">{qtyText(i18n, s.qtyMilli)}</td>{cost && <td className="amount">{i18n.money(s.value ?? 0, 'IQD')}</td>}</tr>
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
                <th className="amount">{t('movesIn')}</th><th className="amount">{t('movesOut')}</th><th className="amount">{t('balance')}</th>{cost && <th className="amount">{t('moveValue')}</th>}
              </tr>
            </thead>
            <tbody>
              {it.moves.map((m) => {
                const key = sourceKey(m.sourceType);
                return (
                  <tr key={m.id} className={m.sourceId && opens(m.sourceType) ? 'click' : ''} onClick={() => m.sourceId && opens(m.sourceType) && go(sourcePath(m.sourceType, m.sourceId))}>
                    <td className="num">{i18n.date(m.date)}</td>
                    <td>{key ? t(key) : m.sourceType}</td>
                    <td><span className="ltr num">{m.sourceNumber ?? ''}</span></td>
                    {it.stock.length > 1 && <td className="ltr">{m.warehouseCode}</td>}
                    <td className="amount">{m.qtyMilli > 0 ? qtyText(i18n, m.qtyMilli) : ''}</td>
                    <td className="amount">{m.qtyMilli < 0 ? qtyText(i18n, -m.qtyMilli) : ''}</td>
                    <td className="amount">{qtyText(i18n, m.balanceQtyMilli)}</td>
                    {cost && <td className="amount">{i18n.money(Math.abs(m.value ?? 0), 'IQD')}</td>}
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
