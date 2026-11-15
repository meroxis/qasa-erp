import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { roundHalfUp, unitsForBusiness, UNITS, type CurrencyCode } from '@qasa/core';
import { api, ApiError, isNetworkError, newIdempotencyKey, type ItemView } from '../api.ts';
import { AmountInput, ErrorBox, Icon, Modal, QtyInput, SearchCombo, useData, useLoad, useToast, type PickOption } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { categoriesApi } from './categories-api.ts';
import { batchesApi } from './batches-api.ts';
import { BatchInFields } from './BatchFields.tsx';
import { CategoryOptions } from './CatalogPickers.tsx';
import {
  addRowKind, existingStockStep, mayAddItem, oldServerRefusal, QUICK_ITEM_LIMITS, quickAddItem, quickItemInput, quickItemStart, showsBatchFields,
  type HeldItemKey, type QuickItemFields, type SameItem
} from './item-quick-add.ts';

/**
 * The item box of a sales or purchase invoice, a quotation and a purchase order: the usual search, and for someone who
 * may add items (the stock permission) a "+" inside the box and an "Add “…” as a new item" row for a name nothing has
 * (or "Add an item with barcode …" for a scanned code found nowhere). Either opens a small form: one name, the barcode,
 * the unit, the sale price, the purchase price (for whoever sees cost) and the category. Saving adds the item the way
 * the Items page does and puts it straight on the line. An item that is already there by that name, code or barcode,
 * whatever the page's list shows, is offered instead of a second one.
 */
export function ItemPicker({ value, options, onChange, onCreated, placeholder, ariaLabel, emptyLabel, sale = false, stockOnly = false, warehouseId }: {
  value: string;
  options: PickOption[];
  onChange(id: string): void;
  /** an item was added here (or one already there was chosen in the form): the page keeps it in its list and puts it on the line */
  onCreated(item: ItemView): void;
  placeholder: string;
  ariaLabel?: string;
  emptyLabel?: string;
  /** a sale or a quotation: the form says a new item has no stock yet */
  sale?: boolean;
  /** a purchase: an item that keeps no stock can't be chosen from the form */
  stockOnly?: boolean;
  /** a sales invoice: the warehouse it sells from, where the form can enter what is on the shelf now */
  warehouseId?: string | undefined;
}) {
  const { t } = useI18n();
  const { permissions, settings } = useData();
  const allowed = mayAddItem(permissions);
  const market = !!settings?.businessTypes?.includes('market');
  // the text the form opened with; null while it is closed
  const [adding, setAdding] = useState<string | null>(null);
  const addLabel = (typed: string) => {
    const kind = addRowKind(typed, market);
    return kind === 'empty' ? t('iq_addItem') : kind === 'barcode' ? t('iq_addBarcode', { code: typed.trim() })
      : kind === 'scale' ? t('iq_addScale', { code: typed.trim() }) : t('iq_addNamed', { name: typed.trim() });
  };
  return (
    <>
      <SearchCombo
        value={value} options={options} onChange={onChange} placeholder={placeholder}
        {...(ariaLabel !== undefined ? { ariaLabel } : {})} {...(emptyLabel !== undefined ? { emptyLabel } : {})}
        {...(allowed ? { add: { title: t('iq_addItem'), label: addLabel, onAdd: (typed: string) => setAdding(typed) } } : {})}
      />
      {allowed && adding !== null && (
        <QuickItemForm typed={adding} sale={sale} stockOnly={stockOnly} warehouseId={warehouseId}
          onClose={() => setAdding(null)} onDone={(item) => { setAdding(null); onCreated(item); }} />
      )}
    </>
  );
}

/** The item's purchase price typed in the form, in IQD per base unit (a dollar price at the company rate); null: none. */
export function stockCost(fields: Pick<QuickItemFields, 'purchasePrice' | 'currency'>, rateX100: number | undefined): number | null {
  if (fields.purchasePrice === null) return null;
  if (fields.currency === 'USD') return rateX100 ? roundHalfUp((fields.purchasePrice * rateX100) / 10000) : null;
  return fields.purchasePrice;
}

/**
 * The small form itself, in a dialog (also opened by the till when a search or a scan finds nothing). `typed`: what was
 * typed or scanned (a name, or a barcode). With `warehouseId` (a sale: an invoice or the till), it also asks what is on
 * the shelf now, so the new item can be sold at once: entered as opening stock in that warehouse at the purchase price
 * (POST /api/items/:id/stock-correction, "opening"), or waiting for approval where another person approves.
 */
export function QuickItemForm({ typed, sale = false, stockOnly = false, warehouseId, onDone, onClose }: {
  typed: string;
  sale?: boolean;
  stockOnly?: boolean;
  warehouseId?: string | undefined;
  onDone(item: ItemView): void;
  onClose(): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, seesCost } = useData();
  const cost = seesCost !== false;
  const market = !!settings?.businessTypes?.includes('market');
  const [fields, setFields] = useState<QuickItemFields>(() => quickItemStart(typed, 'piece', market));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<{ field: string; text: string } | null>(null);
  const [offline, setOffline] = useState(false);
  // items already there by that name, code or barcode (the person chooses one, or adds anyway)
  const [same, setSame] = useState<SameItem[] | null>(null);
  // the item once it is made: a stock entry that failed is tried again without making the item twice
  const [made, setMade] = useState<ItemView | null>(null);
  // an item already there that was chosen instead, while its stock is being entered (or waits for an expiry date)
  const [chosen, setChosen] = useState<ItemView | null>(null);
  const [waiting, setWaiting] = useState(false);
  // the key of the last try that got no answer: the next try of the same item can't add it twice
  const held = useRef<HeldItemKey | null>(null);
  const heldStock = useRef<{ key: string; of: string } | null>(null);
  // an answer that arrives after Esc or Cancel puts nothing on the line
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => { open.current = false; };
  }, []);
  const categories = useLoad(() => categoriesApi.list({ active: 'true' }).catch(() => []), []);
  // the units of the company's trade (a market's kilogram among them), the piece first
  const units = useMemo(() => unitsForBusiness(settings?.businessTypes, ['piece', ...(market ? ['kg'] : [])]).units.filter((u) => u !== 'service'), [settings?.businessTypes, market]);
  // what is on the shelf now: on a sale, for someone who sees cost (it is entered at the purchase price)
  const asksStock = sale && !!warehouseId && cost;
  // a new item keeps expiry dates where the company does (a market, a pharmacy): what comes in names its date
  const expiryDefault = useLoad(() => (asksStock ? batchesApi.settings().then((b) => b.defaultTrackExpiry, () => false) : Promise.resolve(false)), [asksStock]);
  const dated = !!expiryDefault.data;
  const [batch, setBatch] = useState({ batchNo: '', expiry: '' });

  const set = (patch: Partial<QuickItemFields>) => { setFields((f) => ({ ...f, ...patch })); setProblem(null); setSame(null); setChosen(null); };
  /** the item the stock is entered for: the one made here, or one already there that was chosen */
  const target = made ?? chosen;
  const typedStock = () => (asksStock && fields.stockMilli !== null && fields.stockMilli > 0 ? fields.stockMilli : null);

  /**
   * "Use this one": an item already there goes on the line, with what was typed as on the shelf now entered for it in
   * the sale's warehouse first (opening stock where it has none, else a count correction; waiting where another person
   * approves). Nothing typed, or what is there already: it goes on the line as it is.
   */
  async function useExisting(item: ItemView) {
    if (busy) return;
    const typedMilli = typedStock();
    if (typedMilli === null) { onDone(item); return; }
    setChosen(item);
    setProblem(null);
    setError(null);
    setBusy(true);
    try {
      const detail = await api.item(item.id);
      const step = existingStockStep(detail.stock.find((s) => s.warehouseId === warehouseId)?.qtyMilli ?? 0, typedMilli);
      if (step.kind === 'none') { if (open.current) onDone(item); return; }
      const rate = settings?.defaultRateX100;
      const unitCost = step.reason === 'opening'
        ? stockCost(fields, rate) ?? stockCost({ purchasePrice: item.purchasePrice ?? null, currency: item.purchaseCurrency ?? 'IQD' }, rate)
        : null;
      if (step.reason === 'opening' && unitCost === null) { setProblem({ field: 'purchasePrice', text: t('iq_stockNeedsPrice') }); return; }
      if (step.adds && item.trackExpiry && !batch.expiry) { setProblem({ field: 'expiry', text: t('iq_expiryNeeded') }); return; }
      const stocked = await enterStock(item, typedMilli, unitCost, step.reason);
      if (stocked && open.current) onDone(stocked);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /**
   * The item's stock in the sale's warehouse: a new item's as opening stock at the purchase price; one already there
   * that was chosen, as opening stock too where it has none, else as a count correction at the average cost. The item
   * with it, or null (waiting for approval, or refused).
   */
  async function enterStock(item: ItemView, qtyMilli: number, unitCost: number | null, reason: 'opening' | 'found' = 'opening'): Promise<ItemView | null> {
    const input = {
      warehouseId: warehouseId!, mode: 'set' as const, qtyMilli, reason, ...(reason === 'opening' && unitCost !== null ? { unitCost } : {}), lang: i18n.lang,
      ...(item.trackBatches && batch.batchNo.trim() ? { batchNo: batch.batchNo.trim() } : {}),
      ...(item.trackExpiry && batch.expiry ? { expiry: batch.expiry } : {})
    };
    const of = JSON.stringify([item.id, input]);
    if (!heldStock.current || heldStock.current.of !== of) heldStock.current = { key: newIdempotencyKey(), of };
    try {
      const result = await api.correctStock(item.id, input, { key: heldStock.current.key });
      heldStock.current = null;
      if (!result.posted) { setWaiting(true); return null; }
      return { ...item, qtyMilli: result.item.qtyMilli, value: result.item.value };
    } catch (e) {
      // a refusal: tried again with a new key; a lost answer keeps the key (entered at most once)
      if (!isNetworkError(e) && e instanceof ApiError) heldStock.current = null;
      // an office server before 1.4.2 can't enter stock: the item (made or chosen) goes on the line, and the person is told
      if (oldServerRefusal(e)) { toast(t('iq_stockOldServer')); return item; }
      setError(e);
      return null;
    }
  }

  async function save(force: boolean) {
    if (busy) return;
    const checked = quickItemInput(fields, cost);
    if (!checked.ok) {
      setProblem({ field: checked.field, text: t(checked.code === 'name_required' ? 'qa_nameNeeded' : checked.code === 'price_required' ? 'err_price_invalid' : 'qa_tooLong') });
      return;
    }
    const stock = typedStock();
    const unitCost = stockCost(fields, settings?.defaultRateX100);
    if (stock !== null && unitCost === null) { setProblem({ field: 'purchasePrice', text: t('iq_stockNeedsPrice') }); return; }
    if (stock !== null && (made ? made.trackExpiry : dated) && !batch.expiry) { setProblem({ field: 'expiry', text: t('iq_expiryNeeded') }); return; }
    setChosen(null);
    setBusy(true);
    setError(null);
    setOffline(false);
    try {
      let item = made;
      if (!item) {
        const done = await quickAddItem(checked.input, held.current, (input, options) => api.createItem(input, options), undefined,
          { force, list: (q, options) => api.items({ q }, options) });
        if (done.status === 'offline') { held.current = done.key; setOffline(true); return; }
        if (done.status === 'same') { setSame(done.same); return; }
        held.current = null;
        item = done.item;
        setMade(item);
        toast(t('iq_added', { name: i18n.name(item.name), code: item.code }));
      }
      // the item keeps expiry dates of its own (the company's choice could not be read before): its fields show now
      if (stock !== null && item.trackExpiry && !batch.expiry) { setProblem({ field: 'expiry', text: t('iq_expiryNeeded') }); return; }
      if (stock !== null) {
        const stocked = await enterStock(item, stock, unitCost!);
        if (!stocked) return;
        item = stocked;
      }
      if (open.current) onDone(item);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); void save(false); }
  };
  const invalid = (field: string) => (problem?.field === field ? ' invalid' : '');
  const categoryName = (id: string | null) => {
    const c = id ? categories.data?.find((x) => x.id === id) : undefined;
    return c ? i18n.name(c.name) : '';
  };
  const usable = (it: ItemView) => it.active && (!stockOnly || it.trackStock);

  return (
    <Modal title={t('iq_title')} onClose={onClose}>
      <div className="stack quick-item" onKeyDown={onKey}>
        <label className="field">
          <span>{t('it_name')}</span>
          <input className={'input' + invalid('name')} autoFocus maxLength={QUICK_ITEM_LIMITS.name} value={fields.name} aria-invalid={problem?.field === 'name'}
            readOnly={!!made} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>{t('barcode')}</span>
            <input className={'input ltr' + invalid('barcode')} dir="ltr" maxLength={QUICK_ITEM_LIMITS.barcode} value={fields.barcode} readOnly={!!made}
              onChange={(e) => set({ barcode: e.target.value, scaleLabel: null })} />
          </label>
          <label className="field">
            <span>{t('unit')}</span>
            <select className="input" value={fields.unit} disabled={!!made} onChange={(e) => set({ unit: e.target.value as QuickItemFields['unit'] })}>
              {units.map((u) => <option key={u} value={u}>{i18n.name(UNITS[u])}</option>)}
            </select>
          </label>
        </div>
        {fields.scaleLabel && <span className="muted small">{t('iq_scaleHint', { p: fields.barcode })}</span>}
        <div className="row" style={{ gap: 8 }}>
          <span className="muted small">{t('iq_pricesCurrency')}</span>
          <div className="track" role="group" aria-label={t('iq_pricesCurrency')}>
            {(['IQD', 'USD'] as const).map((c: CurrencyCode) => <button key={c} type="button" aria-pressed={fields.currency === c} onClick={() => set({ currency: c })}>{c === 'IQD' ? t('iqdName') : '$'}</button>)}
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <span>{t('salePrice')} <span className="muted small">({fields.currency === 'IQD' ? t('iqdName') : '$'})</span></span>
            <div className={'row' + invalid('salePrice')} style={{ flexWrap: 'nowrap' }}>
              <AmountInput value={fields.salePrice} currency={fields.currency} onChange={(v) => set({ salePrice: v })} ariaLabel={t('salePrice')} />
            </div>
          </div>
          {cost && (
            <div className="field">
              <span>{t('it_purchasePrice')} <span className="muted small">({fields.currency === 'IQD' ? t('iqdName') : '$'})</span></span>
              <div className={'row' + invalid('purchasePrice')} style={{ flexWrap: 'nowrap' }}>
                <AmountInput value={fields.purchasePrice} currency={fields.currency} onChange={(v) => set({ purchasePrice: v })} ariaLabel={t('it_purchasePrice')} />
              </div>
            </div>
          )}
        </div>
        <span className="muted small">{t('iq_pricesHint', { u: i18n.name(UNITS[fields.unit]) })}</span>
        {(categories.data?.length ?? 0) > 0 && (
          <label className="field">
            <span>{t('iq_category')}</span>
            <select className="input" value={fields.categoryId} disabled={!!made} onChange={(e) => set({ categoryId: e.target.value })}>
              <option value="">{t('cat_none')}</option>
              <CategoryOptions list={categories.data!} />
            </select>
          </label>
        )}
        {asksStock && (
          <div className="field">
            <span>{t('iq_stockNow')}</span>
            <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
              <QtyInput value={fields.stockMilli} onChange={(v) => set({ stockMilli: v })} ariaLabel={t('iq_stockNow')} />
              <span className="muted small" style={{ whiteSpace: 'nowrap' }}>{i18n.name(UNITS[fields.unit])}</span>
            </div>
            {showsBatchFields(target, dated) && fields.stockMilli !== null && fields.stockMilli > 0 && (
              <BatchInFields item={target ?? { trackBatches: true, trackExpiry: true }}batchNo={batch.batchNo} expiry={batch.expiry} onChange={(v) => { setBatch(v); setProblem(null); }} />
            )}
            <span className="muted small">{t('iq_stockNowHint')}</span>
          </div>
        )}
        {market && (fields.unit === 'kg' || fields.unit === 'g') && !fields.scaleLabel && <span className="muted small">{t('it_scaleHint')}</span>}
        {problem && <div className="small quick-add-problem" role="alert">{problem.text}</div>}
        {same && (
          <div className="alert warn quick-add-same" role="alert">
            <div>{t('iq_sameItem')}</div>
            {typedStock() !== null && <div className="muted small">{t('iq_sameStock')}</div>}
            <ul>
              {same.map((s) => (
                <li key={s.item.id}>
                  <span className="quick-add-who">
                    <span className="ltr tree-code">{s.item.code}</span> <strong className="bidi">{i18n.name(s.item.name)}</strong>
                    {s.item.barcode && <> · <span className="ltr num">{s.item.barcode}</span></>}
                    {categoryName(s.item.categoryId) && <span className="muted small"> · {t('iq_inCategory', { c: categoryName(s.item.categoryId) })}</span>}
                    {!s.item.active && <span className="muted small"> ({t('qa_inactiveNote')})</span>}
                  </span>
                  {usable(s.item) && <button type="button" className="btn small" disabled={busy} onClick={() => void useExisting(s.item)}>{t('qa_useThis')}</button>}
                </li>
              ))}
            </ul>
            {/* the server refuses a barcode used twice: only a name or a code may be added again */}
            {!same.some((s) => s.by === 'barcode') && <div><button type="button" className="btn small" disabled={busy} onClick={() => void save(true)}>{t('qa_addAnyway')}</button></div>}
          </div>
        )}
        {offline && <div className="alert warn" role="alert">{t('qa_offline')}</div>}
        {target && !!error && <div className="alert warn" role="alert">{t('iq_stockFailed')}</div>}
        <ErrorBox error={error} />
        {sale && !asksStock && <div className="alert info small">{t('iq_noStockYet')}</div>}
        {waiting && target ? (
          <>
            <div className="alert warn" role="status">{t('iq_stockWaiting')}</div>
            <div className="row">
              <button type="button" className="btn primary" autoFocus onClick={() => onDone(target)}><Icon name="check" size={16} />{t('iq_continue')}</button>
            </div>
          </>
        ) : (
          <div className="row">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void save(false)}><Icon name="check" size={16} />{busy ? t('saving') : t('qa_add')}</button>
            <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          </div>
        )}
        <div className="muted small">{t('iq_later')}</div>
      </div>
    </Modal>
  );
}

/**
 * After an item is added (or chosen) from the form, the cursor goes on to that line's quantity, as after picking one
 * from the list: the row carries data-line={key}, its quantity box the label given.
 */
export function focusLineQty(key: number | string, qtyLabel: string): void {
  window.setTimeout(() => {
    const row = document.querySelector(`[data-line="${String(key)}"]`);
    const box = [...(row?.querySelectorAll('input') ?? [])].find((el) => el.getAttribute('aria-label') === qtyLabel);
    box?.focus();
    box?.select();
  }, 0);
}

/** A picker option for an item (the invoices' own), for an item added here before the page's list has it. */
export const withAdded = <T extends { id: string }>(list: readonly T[] | null | undefined, added: readonly T[]): T[] =>
  [...(list ?? []), ...added.filter((a) => !(list ?? []).some((x) => x.id === a.id))];
