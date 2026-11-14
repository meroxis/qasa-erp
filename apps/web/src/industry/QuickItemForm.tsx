import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { unitsForBusiness, UNITS, type CurrencyCode } from '@qasa/core';
import { api, type ItemView } from '../api.ts';
import { AmountInput, ErrorBox, Icon, Modal, SearchCombo, useData, useLoad, useToast, type PickOption } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { categoriesApi } from './categories-api.ts';
import { CategoryOptions } from './CatalogPickers.tsx';
import { addRowKind, mayAddItem, QUICK_ITEM_LIMITS, quickAddItem, quickItemInput, quickItemStart, type HeldItemKey, type QuickItemFields } from './item-quick-add.ts';

/**
 * The item box of a sales or purchase invoice, a quotation and a purchase order: the usual search, and for someone who
 * may add items (the stock permission) a "+" inside the box and an "Add “…” as a new item" row for a name nothing has
 * (or "Add an item with barcode …" for a scanned code found nowhere). Either opens a small form: one name, the barcode,
 * the unit, the sale price, the purchase price (for whoever sees cost) and the category. Saving adds the item the way
 * the Items page does and puts it straight on the line.
 */
export function ItemPicker({ value, options, onChange, onCreated, placeholder, ariaLabel, emptyLabel, sale = false }: {
  value: string;
  options: PickOption[];
  onChange(id: string): void;
  /** an item was added here: the page adds it to its own list and puts it on the line */
  onCreated(item: ItemView): void;
  placeholder: string;
  ariaLabel?: string;
  emptyLabel?: string;
  /** a sale or a quotation: the form says a new item has no stock yet */
  sale?: boolean;
}) {
  const { t } = useI18n();
  const { permissions } = useData();
  const allowed = mayAddItem(permissions);
  // the text the form opened with; null while it is closed
  const [adding, setAdding] = useState<string | null>(null);
  const addLabel = (typed: string) => {
    const kind = addRowKind(typed);
    return kind === 'empty' ? t('iq_addItem') : kind === 'barcode' ? t('iq_addBarcode', { code: typed.trim() }) : t('iq_addNamed', { name: typed.trim() });
  };
  return (
    <>
      <SearchCombo
        value={value} options={options} onChange={onChange} placeholder={placeholder}
        {...(ariaLabel !== undefined ? { ariaLabel } : {})} {...(emptyLabel !== undefined ? { emptyLabel } : {})}
        {...(allowed ? { add: { title: t('iq_addItem'), label: addLabel, onAdd: (typed: string) => setAdding(typed) } } : {})}
      />
      {allowed && adding !== null && (
        <QuickItemForm typed={adding} sale={sale} onClose={() => setAdding(null)} onDone={(item) => { setAdding(null); onCreated(item); }} />
      )}
    </>
  );
}

/**
 * The small form itself, in a dialog (also opened by the till when a search or a scan finds nothing). `typed`: what was
 * typed or scanned (a name, or a barcode).
 */
export function QuickItemForm({ typed, sale = false, onDone, onClose }: {
  typed: string;
  sale?: boolean;
  onDone(item: ItemView): void;
  onClose(): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, seesCost } = useData();
  const cost = seesCost !== false;
  const market = !!settings?.businessTypes?.includes('market');
  const [fields, setFields] = useState<QuickItemFields>(() => quickItemStart(typed));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<{ field: string; text: string } | null>(null);
  const [offline, setOffline] = useState(false);
  // the key of the last try that got no answer: the next try of the same item can't add it twice
  const held = useRef<HeldItemKey | null>(null);
  // an answer that arrives after Esc or Cancel puts nothing on the line
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => { open.current = false; };
  }, []);
  const categories = useLoad(() => categoriesApi.list({ active: 'true' }).catch(() => []), []);
  // the units of the company's trade (a market's kilogram among them), the piece first
  const units = useMemo(() => unitsForBusiness(settings?.businessTypes, ['piece', ...(market ? ['kg'] : [])]).units.filter((u) => u !== 'service'), [settings?.businessTypes, market]);

  const set = (patch: Partial<QuickItemFields>) => { setFields((f) => ({ ...f, ...patch })); setProblem(null); };

  async function save() {
    if (busy) return;
    const checked = quickItemInput(fields, cost);
    if (!checked.ok) {
      setProblem({ field: checked.field, text: t(checked.code === 'name_required' ? 'qa_nameNeeded' : checked.code === 'price_required' ? 'err_price_invalid' : 'qa_tooLong') });
      return;
    }
    setBusy(true);
    setError(null);
    setOffline(false);
    try {
      const done = await quickAddItem(checked.input, held.current, (input, options) => api.createItem(input, options));
      if (done.status === 'offline') { held.current = done.key; setOffline(true); return; }
      held.current = null;
      toast(t('iq_added', { name: i18n.name(done.item.name), code: done.item.code }));
      if (open.current) onDone(done.item);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); void save(); }
  };
  const invalid = (field: string) => (problem?.field === field ? ' invalid' : '');
  const currencyTrack = (
    <div className="track" role="group" aria-label={t('currency')}>
      {(['IQD', 'USD'] as const).map((c: CurrencyCode) => <button key={c} type="button" aria-pressed={fields.currency === c} onClick={() => set({ currency: c })}>{c === 'IQD' ? t('iqdName') : '$'}</button>)}
    </div>
  );

  return (
    <Modal title={t('iq_title')} onClose={onClose}>
      <div className="stack quick-item" onKeyDown={onKey}>
        <label className="field">
          <span>{t('it_name')}</span>
          <input className={'input' + invalid('name')} autoFocus maxLength={QUICK_ITEM_LIMITS.name} value={fields.name} aria-invalid={problem?.field === 'name'}
            onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>{t('barcode')}</span>
            <input className={'input ltr' + invalid('barcode')} dir="ltr" maxLength={QUICK_ITEM_LIMITS.barcode} value={fields.barcode} onChange={(e) => set({ barcode: e.target.value })} />
          </label>
          <label className="field">
            <span>{t('unit')}</span>
            <select className="input" value={fields.unit} onChange={(e) => set({ unit: e.target.value as QuickItemFields['unit'] })}>
              {units.map((u) => <option key={u} value={u}>{i18n.name(UNITS[u])}</option>)}
            </select>
          </label>
        </div>
        <div className="grid-2">
          <div className="field">
            <span>{t('salePrice')}</span>
            <div className={'row' + invalid('salePrice')} style={{ flexWrap: 'nowrap' }}>
              <AmountInput value={fields.salePrice} currency={fields.currency} onChange={(v) => set({ salePrice: v })} ariaLabel={t('salePrice')} />
              {currencyTrack}
            </div>
          </div>
          {cost && (
            <div className="field">
              <span>{t('it_purchasePrice')}</span>
              <AmountInput value={fields.purchasePrice} currency={fields.currency} onChange={(v) => set({ purchasePrice: v })} ariaLabel={t('it_purchasePrice')} />
            </div>
          )}
        </div>
        <span className="muted small">{t('iq_pricesHint', { u: i18n.name(UNITS[fields.unit]) })}</span>
        {(categories.data?.length ?? 0) > 0 && (
          <label className="field">
            <span>{t('iq_category')}</span>
            <select className="input" value={fields.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              <option value="">{t('cat_none')}</option>
              <CategoryOptions list={categories.data!} />
            </select>
          </label>
        )}
        {market && (fields.unit === 'kg' || fields.unit === 'g') && <span className="muted small">{t('it_scaleHint')}</span>}
        {problem && <div className="small quick-add-problem" role="alert">{problem.text}</div>}
        {offline && <div className="alert warn" role="alert">{t('qa_offline')}</div>}
        <ErrorBox error={error} />
        {sale && <div className="alert info small">{t('iq_noStockYet')}</div>}
        <div className="row">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}><Icon name="check" size={16} />{busy ? t('saving') : t('qa_add')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
        <div className="muted small">{t('iq_later')}</div>
      </div>
    </Modal>
  );
}

/** A picker option for an item (the invoices' own), for an item added here before the page's list has it. */
export const withAdded = <T extends { id: string }>(list: readonly T[] | null | undefined, added: readonly T[]): T[] =>
  [...(list ?? []), ...added.filter((a) => !(list ?? []).some((x) => x.id === a.id))];
