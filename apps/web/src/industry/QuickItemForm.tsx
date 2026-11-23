import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { roundHalfUp, unitsForBusiness, UNITS, type CurrencyCode } from '@qasa/core';
import { api, type ItemView, type StockCorrectionInput } from '../api.ts';
import { AmountInput, ErrorBox, Icon, Modal, QtyInput, SearchCombo, useData, useLoad, useToast, type PickOption } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { categoriesApi } from './categories-api.ts';
import { batchesApi } from './batches-api.ts';
import { BatchInFields } from './BatchFields.tsx';
import { CategoryOptions } from './CatalogPickers.tsx';
import {
  addRowKind, existingStockStep, labelQtyFor, mayAddItem, oldServerRefusal, QUICK_ITEM_LIMITS, quickAddItem, quickItemInput, quickItemStart, showsBatchFields,
  type HeldItemKey, type QuickItemFields, type SameItem
} from './item-quick-add.ts';
import { sendCorrection, type HeldCorrection } from './StockCorrection.tsx';
import { NewItemPicture, saveItemPicture, type PreparedPicture } from './ItemImage.tsx';
import { ProductLookupPanel } from './ProductLookup.tsx';

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
  /**
   * an item was added here (or one already there was chosen in the form): the page keeps it in its list and puts it on
   * the line, with `qtyMilli` as its quantity when a scale's label was scanned for it (its weight, in the item's base
   * unit; null: the line's usual quantity)
   */
  onCreated(item: ItemView, qtyMilli: number | null): void;
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
          onClose={() => setAdding(null)} onDone={(item, qtyMilli) => { setAdding(null); onCreated(item, qtyMilli); }} />
      )}
    </>
  );
}

/** A stock entry whose try got no answer (StockCorrection's HeldCorrection), and the item it is for: made here, or chosen. */
interface HeldStock { request: HeldCorrection; item: ItemView }

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
  /** the item made (or one already there that was chosen), and the weight a scale's label scanned for it puts on the line (null: none) */
  onDone(item: ItemView, qtyMilli: number | null): void;
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
  // a stock entry whose try got no answer may be entered already: until the server answers it, the form is that very
  // request, locked, and "Try again" sends it once more with its key (entered once, or answered from the first try)
  const [heldStock, setHeldStock] = useState<HeldStock | null>(null);
  // one try at a time, also when a button is pressed twice before the form has drawn "saving"
  const running = useRef(false);
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
  // 2.0: the new item's picture: found by its barcode (when the company has that on), or a photo or a file
  const [picture, setPicture] = useState<PreparedPicture | null>(null);

  const set = (patch: Partial<QuickItemFields>) => { setFields((f) => ({ ...f, ...patch })); setProblem(null); setSame(null); setChosen(null); };
  /** the item the stock is entered for: the one made here, or one already there that was chosen */
  const target = made ?? chosen;
  const typedStock = () => (asksStock && fields.stockMilli !== null && fields.stockMilli > 0 ? fields.stockMilli : null);
  /** the item goes on the line, with the weight of the scale's label scanned for it (its own weighed item only) */
  const done = (item: ItemView) => onDone(item, labelQtyFor(fields.scaleLabel, item));

  /**
   * "Use this one": an item already there goes on the line, with what was typed as on the shelf now entered for it in
   * the sale's warehouse first (opening stock where it has none, else a count correction; waiting where another person
   * approves). Nothing typed, or what is there already: it goes on the line as it is.
   */
  async function useExisting(item: ItemView) {
    if (busy || running.current || heldStock) return;
    const typedMilli = typedStock();
    if (typedMilli === null) { done(item); return; }
    running.current = true;
    setChosen(item);
    setProblem(null);
    setError(null);
    setBusy(true);
    try {
      const detail = await api.item(item.id);
      const step = existingStockStep(detail.stock.find((s) => s.warehouseId === warehouseId)?.qtyMilli ?? 0, typedMilli);
      if (step.kind === 'none') { if (open.current) done(item); return; }
      const rate = settings?.defaultRateX100;
      const unitCost = step.reason === 'opening'
        ? stockCost(fields, rate) ?? stockCost({ purchasePrice: item.purchasePrice ?? null, currency: item.purchaseCurrency ?? 'IQD' }, rate)
        : null;
      if (step.reason === 'opening' && unitCost === null) { setProblem({ field: 'purchasePrice', text: t('iq_stockNeedsPrice') }); return; }
      if (step.adds && item.trackExpiry && !batch.expiry) { setProblem({ field: 'expiry', text: t('iq_expiryNeeded') }); return; }
      const stocked = await enterStock(item, stockRequest(item, typedMilli, unitCost, step.reason), null);
      if (stocked && open.current) done(stocked);
    } catch (e) {
      setError(e);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  /**
   * What is sent for the item's stock in the sale's warehouse: a new item's as opening stock at the purchase price; one
   * already there that was chosen, as opening stock too where it has none, else as a count correction at the average
   * cost.
   */
  function stockRequest(item: ItemView, qtyMilli: number, unitCost: number | null, reason: 'opening' | 'found' = 'opening'): StockCorrectionInput {
    return {
      warehouseId: warehouseId!, mode: 'set', qtyMilli, reason, ...(reason === 'opening' && unitCost !== null ? { unitCost } : {}), lang: i18n.lang,
      ...(item.trackBatches && batch.batchNo.trim() ? { batchNo: batch.batchNo.trim() } : {}),
      ...(item.trackExpiry && batch.expiry ? { expiry: batch.expiry } : {})
    };
  }

  /**
   * Enters the item's stock so that it is entered once (sendCorrection): `held`, an entry whose answer was lost, goes
   * again as it was sent, with its key. The item with its stock, or null: waiting for approval, refused (nothing was
   * entered: the form is free again), or no answer (held: the form is locked until the server answers it). An office
   * server before 1.4.2 (no stock correction there) refuses it too: the item goes on the line as it is, the person told
   * that the stock typed was not entered.
   */
  async function enterStock(item: ItemView, input: StockCorrectionInput, held: HeldCorrection | null): Promise<ItemView | null> {
    const sent = await sendCorrection(held, item.id, input, (id, body, options) => api.correctStock(id, body, options));
    if (sent.status !== 'done') {
      setHeldStock(sent.status === 'unsure' ? { request: sent.held, item } : null);
      // an office server before 1.4.2 can't enter stock: the item (made or chosen) goes on the line, and the person is told
      if (sent.status === 'refused' && oldServerRefusal(sent.error)) { toast(t('iq_stockOldServer')); return item; }
      setError(sent.error);
      return null;
    }
    setHeldStock(null);
    if (!sent.result.posted) { setWaiting(true); return null; }
    return { ...item, qtyMilli: sent.result.item.qtyMilli, value: sent.result.item.value };
  }

  /** "Try again" on a stock entry whose answer was lost: that very request, with its key, for the item it was for. */
  async function retryStock(held: HeldStock) {
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const stocked = await enterStock(held.item, held.request.input, held.request);
      if (stocked && open.current) done(stocked);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function save(force: boolean) {
    if (busy || running.current) return;
    // a stock entry held (its answer was lost) goes again as it was sent, whatever the form says now
    if (heldStock) { await retryStock(heldStock); return; }
    const checked = quickItemInput(fields, cost);
    if (!checked.ok) {
      setProblem({ field: checked.field, text: t(checked.code === 'name_required' ? 'qa_nameNeeded' : checked.code === 'price_required' ? 'err_price_invalid' : 'qa_tooLong') });
      return;
    }
    const stock = typedStock();
    const unitCost = stockCost(fields, settings?.defaultRateX100);
    if (stock !== null && unitCost === null) { setProblem({ field: 'purchasePrice', text: t('iq_stockNeedsPrice') }); return; }
    if (stock !== null && (made ? made.trackExpiry : dated) && !batch.expiry) { setProblem({ field: 'expiry', text: t('iq_expiryNeeded') }); return; }
    running.current = true;
    setChosen(null);
    setBusy(true);
    setError(null);
    setOffline(false);
    try {
      let item = made;
      if (!item) {
        const added = await quickAddItem(checked.input, held.current, (input, options) => api.createItem(input, options), undefined,
          { force, list: (q, options) => api.items({ q }, options) });
        if (added.status === 'offline') { held.current = added.key; setOffline(true); return; }
        if (added.status === 'same') { setSame(added.same); return; }
        held.current = null;
        item = added.item;
        setMade(item);
        let pictureSaved = true;
        if (picture) {
          // the item exists now; a picture that fails leaves it added, and can be added from its page
          try { await saveItemPicture(item.id, picture.data, picture.lookupBarcode); } catch { pictureSaved = false; }
        }
        toast(pictureSaved ? t('iq_added', { name: i18n.name(item.name), code: item.code }) : t('it_pictureNotSaved'));
      }
      // the item keeps expiry dates of its own (the company's choice could not be read before): its fields show now
      if (stock !== null && item.trackExpiry && !batch.expiry) { setProblem({ field: 'expiry', text: t('iq_expiryNeeded') }); return; }
      if (stock !== null) {
        const stocked = await enterStock(item, stockRequest(item, stock, unitCost), null);
        if (!stocked) return;
        item = stocked;
      }
      if (open.current) done(item);
    } catch (e) {
      setError(e);
    } finally {
      running.current = false;
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
        {/* a stock entry held (its answer was lost): nothing here can change until the server answers that very entry */}
        <fieldset disabled={!!heldStock} style={{ display: 'contents' }}>
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
          {!made && (
            <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <NewItemPicture value={picture} onChange={setPicture} size={64} />
              <div style={{ flex: '1 1 auto', minInlineSize: 0 }}>
                <ProductLookupPanel barcode={fields.barcode} picture={picture} onPicture={setPicture} onName={(n) => set({ name: n.text.slice(0, QUICK_ITEM_LIMITS.name) })} />
              </div>
            </div>
          )}
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
        </fieldset>
        {offline && <div className="alert warn" role="alert">{t('qa_offline')}</div>}
        {/* maybe entered, maybe not; or refused for an item made here (one chosen instead was not added: the reason says it) */}
        {heldStock ? <div className="alert warn" role="alert">{t('iq_stockUnsure')}</div>
          : made && !!error && <div className="alert warn" role="alert">{t('iq_stockFailed')}</div>}
        <ErrorBox error={error} />
        {sale && !asksStock && <div className="alert info small">{t('iq_noStockYet')}</div>}
        {waiting && target ? (
          <>
            <div className="alert warn" role="status">{t('iq_stockWaiting')}</div>
            <div className="row">
              <button type="button" className="btn primary" autoFocus onClick={() => done(target)}><Icon name="check" size={16} />{t('iq_continue')}</button>
            </div>
          </>
        ) : (
          <div className="row">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void save(false)}>
              <Icon name="check" size={16} />{busy ? t('saving') : heldStock ? t('sc_tryAgain') : t('qa_add')}
            </button>
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
