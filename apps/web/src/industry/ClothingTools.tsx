import { useEffect, useMemo, useState } from 'react';
import type { CurrencyCode } from '@qasa/core';
import { api, type InvoiceView, type ItemView } from '../api.ts';
import { ErrorBox, Icon, Modal, QtyInput, SearchCombo, useData, useLoad, useToast, type PickOption } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { clothingApi, type ColorView, type GridLine, type ModelView } from './clothing-api.ts';

/**
 * The clothing pieces other pages use (2.0): a model's size × colour grid of quantities for a purchase, a purchase
 * order or a sale; picking a size and colour of a model at the till; and an exchange at the till. They show only for
 * a company that sells clothing and has the plan (useClothingOn).
 */

export function useClothingOn(): boolean {
  const { plan, settings } = useData();
  return !!plan?.features.includes('clothingShop') && !!settings?.businessTypes?.includes('clothingShop');
}

/** A colour's dot and name. */
export function ColorName({ color }: { color: ColorView | undefined }) {
  const i18n = useI18n();
  if (!color) return <span className="muted">—</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {color.hex && <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 6, background: color.hex, border: '1px solid var(--line, #ccc)' }} />}
      {i18n.name(color.name)}
    </span>
  );
}

function useModels() {
  const i18n = useI18n();
  const { data } = useLoad(() => clothingApi.models({ active: '1' }), []);
  return (data?.models ?? []).map((m): PickOption => ({
    id: m.id, code: m.code, label: i18n.name(m.name), search: `${m.name.ar} ${m.name.en} ${m.name.ku} ${m.season ?? ''}`, hint: m.season ?? undefined
  }));
}

function useColors() {
  const { data } = useLoad(() => clothingApi.colors(), []);
  return useMemo(() => new Map((data?.colors ?? []).map((c) => [c.id, c])), [data]);
}

/** The model's columns: its colours in its order, or one column (null) for a model without colours. */
const columnsOf = (m: ModelView): (string | null)[] => (m.colorIds.length ? m.colorIds : [null]);
const variantAt = (m: ModelView, size: string, colorId: string | null) => m.variants.find((v) => v.size === size && v.colorId === colorId);

/**
 * A model's quantities typed as its grid (sizes down, colours across) and turned into lines: what a purchase brings
 * in, or a sale sells. The server gives each line its item and price.
 */
export function GridDialog({ kind, onLines, onClose }: { kind: 'sale' | 'purchase'; onLines(lines: GridLine[]): void; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const models = useModels();
  const colors = useColors();
  const [modelId, setModelId] = useState('');
  const [model, setModel] = useState<ModelView | null>(null);
  const [qty, setQty] = useState<Record<string, number | null>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setModel(null); setQty({});
    if (modelId) clothingApi.model(modelId).then(setModel, setError);
  }, [modelId]);
  const key = (size: string, colorId: string | null) => `${size}\u0000${colorId ?? ''}`;
  const total = Object.values(qty).reduce<number>((s, v) => s + (v ?? 0), 0);
  const submit = async () => {
    if (!model) return;
    setBusy(true); setError(null);
    try {
      const cells = model.variants.map((v) => ({ size: v.size, colorId: v.colorId, qtyMilli: qty[key(v.size, v.colorId)] ?? 0 })).filter((c) => c.qtyMilli > 0);
      const r = await clothingApi.lines(model.id, kind, cells);
      onLines(r.lines);
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={t('cw_gridTitle')} onClose={onClose}>
      <div className="stack">
        <SearchCombo value={modelId} options={models} onChange={setModelId} placeholder={t('cw_pickModel')} ariaLabel={t('cw_model')} />
        {model && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>{t('cw_size')}</th>{columnsOf(model).map((c) => <th key={c ?? ''} className="amount">{c ? <ColorName color={colors.get(c)} /> : t('qty')}</th>)}</tr>
              </thead>
              <tbody>
                {model.sizes.map((size) => (
                  <tr key={size}>
                    <th scope="row">{size}</th>
                    {columnsOf(model).map((c) => {
                      const v = variantAt(model, size, c);
                      return (
                        <td key={c ?? ''} style={{ minWidth: 90 }}>
                          {v ? (
                            <>
                              <QtyInput value={qty[key(size, c)] ?? null} onChange={(x) => setQty((q) => ({ ...q, [key(size, c)]: x }))} ariaLabel={`${size} ${c ? i18n.name(colors.get(c)?.name ?? { ar: '', en: '', ku: '' }) : ''}`} />
                              <div className="muted small num" style={{ textAlign: 'end' }}>{t('cw_onHand', { q: i18n.qty(v.onHandMilli) })}</div>
                            </>
                          ) : <span className="muted">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ErrorBox error={error} />
        <div className="row">
          <span className="muted">{t('cw_gridTotal', { q: i18n.qty(total) })}</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={!model || total <= 0 || busy} onClick={() => void submit()}><Icon name="plus" size={16} />{t('cw_addLines')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** "By sizes and colours": opens the grid and hands the lines to the editor (shown only for a clothing shop). */
export function ClothingGridButton({ kind, onLines }: { kind: 'sale' | 'purchase'; onLines(lines: GridLine[]): void }) {
  const { t } = useI18n();
  const on = useClothingOn();
  const [open, setOpen] = useState(false);
  if (!on) return null;
  return (
    <>
      <button type="button" className="btn small" onClick={() => setOpen(true)}><Icon name="shirt" size={15} />{t('cw_bySizes')}</button>
      {open && <GridDialog kind={kind} onLines={onLines} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Grid lines as an editor's lines in its currency: a price in another currency is left for the editor to fill. */
export function linesIn<R>(lines: GridLine[], currency: CurrencyCode, make: (l: GridLine, price: number | null) => R): R[] {
  return lines.map((l) => make(l, l.currency === currency ? l.unitPrice : null));
}

/** At the till: a model, then its size and colour (with what is on hand), and it goes on the sale. */
export function TillModelPick({ items, onPick, onClose }: { items: readonly ItemView[]; onPick(item: ItemView): void; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const models = useModels();
  const colors = useColors();
  const [modelId, setModelId] = useState('');
  const [model, setModel] = useState<ModelView | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { setModel(null); if (modelId) clothingApi.model(modelId).then(setModel, setError); }, [modelId]);
  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  return (
    <Modal title={t('cw_pickTitle')} onClose={onClose}>
      <div className="stack">
        <SearchCombo value={modelId} options={models} onChange={setModelId} placeholder={t('cw_pickModel')} ariaLabel={t('cw_model')} />
        {model && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>{t('cw_size')}</th>{columnsOf(model).map((c) => <th key={c ?? ''}>{c ? <ColorName color={colors.get(c)} /> : ''}</th>)}</tr></thead>
              <tbody>
                {model.sizes.map((size) => (
                  <tr key={size}>
                    <th scope="row">{size}</th>
                    {columnsOf(model).map((c) => {
                      const v = variantAt(model, size, c);
                      const item = v ? byId.get(v.itemId) : undefined;
                      return (
                        <td key={c ?? ''}>
                          {v && item ? (
                            <button type="button" className={`btn small${v.onHandMilli > 0 ? '' : ' ghost'}`} onClick={() => { onPick(item); onClose(); }}>
                              <span className="num">{i18n.qty(v.onHandMilli)}</span>
                            </button>
                          ) : <span className="muted">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">{t('cw_pickHint')}</p>
          </div>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

/**
 * An exchange at the till: find the receipt, choose what comes back, add what goes out, and see the difference. The
 * server books a return paid from the drawer and a new sale, so the drawer expects only the difference.
 */
export function ExchangeDialog({ shiftId, currency, items, onDone, onClose }: {
  shiftId: string; currency: CurrencyCode; items: readonly ItemView[]; onDone(): void; onClose(): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [number, setNumber] = useState('');
  const [sale, setSale] = useState<InvoiceView | null>(null);
  const [back, setBack] = useState<Record<number, number | null>>({});
  const [pick, setPick] = useState('');
  const [out, setOut] = useState<{ item: ItemView; qtyMilli: number }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [modelPick, setModelPick] = useState(false);
  const options = useMemo(() => items.map((it): PickOption => ({ id: it.id, code: it.code, label: i18n.name(it.name), search: `${it.barcode} ${it.name.ar} ${it.name.en} ${it.name.ku}` })), [items, i18n]);
  const find = async () => {
    setError(null); setSale(null); setBack({});
    try {
      const found = (await api.invoices({ kind: 'sale', status: 'posted', q: number.trim() })).find((x) => (x.number ?? '').toLowerCase() === number.trim().toLowerCase());
      if (!found) { setError(new Error(t('cw_receiptNotFound'))); return; }
      setSale(await api.invoice(found.id));
    } catch (e) { setError(e); }
  };
  const addOut = (item: ItemView) => setOut((o) => (o.some((x) => x.item.id === item.id) ? o.map((x) => (x.item.id === item.id ? { ...x, qtyMilli: x.qtyMilli + 1000 } : x)) : [...o, { item, qtyMilli: 1000 }]));
  // what comes back, at what the customer paid for it (its share of the sale's discount taken off), and what goes out
  const backValue = sale ? sale.lines.reduce((s, l) => {
    const q = back[l.lineNo] ?? 0;
    if (!q || !l.qtyMilli) return s;
    const share = sale.subtotal > 0 ? Math.round((l.amount * sale.discount) / sale.subtotal) : 0;
    return s + Math.round(((l.amount - share) * q) / l.qtyMilli);
  }, 0) : 0;
  const priceOf = (it: ItemView) => (it.saleCurrency === currency ? it.salePrice : 0);
  const outValue = out.reduce((s, x) => s + Math.round((priceOf(x.item) * x.qtyMilli) / 1000), 0);
  const difference = outValue - backValue;
  const backLines = sale ? sale.lines.filter((l) => (back[l.lineNo] ?? 0) > 0).map((l) => ({ lineNo: l.lineNo, qtyMilli: back[l.lineNo]! })) : [];
  const submit = async () => {
    if (!sale) return;
    setBusy(true); setError(null);
    try {
      const r = await clothingApi.exchange(shiftId, {
        invoiceId: sale.id, back: backLines,
        ...(out.length ? { sale: { discount: 0, ...(sale.partyId ? { partyId: sale.partyId } : {}), lines: out.map((x) => ({ itemId: x.item.id, qtyMilli: x.qtyMilli, unitPrice: priceOf(x.item) })) } } : {})
      });
      toast(r.difference >= 0 ? t('cw_exchangeTake', { a: i18n.money(r.difference, currency) }) : t('cw_exchangeGive', { a: i18n.money(-r.difference, currency) }));
      onDone();
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={t('cw_exchangeTitle')} onClose={onClose}>
      <div className="stack">
        <div className="row">
          <input className="input" value={number} onChange={(e) => setNumber(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void find(); }} placeholder={t('cw_receiptNumber')} aria-label={t('cw_receiptNumber')} />
          <button type="button" className="btn" onClick={() => void find()} disabled={!number.trim()}><Icon name="search" size={16} />{t('cw_find')}</button>
        </div>
        {sale && (
          <>
            <h3 style={{ margin: 0 }}>{t('cw_comesBack')}</h3>
            <table className="table">
              <thead><tr><th>{t('item')}</th><th className="amount">{t('cw_sold')}</th><th className="amount">{t('cw_backQty')}</th></tr></thead>
              <tbody>
                {sale.lines.map((l) => {
                  const left = l.qtyMilli - l.returnedQtyMilli;
                  return (
                    <tr key={l.lineNo}>
                      <td>{i18n.name(l.itemName)}</td>
                      <td className="amount num">{i18n.qty(left)}</td>
                      <td style={{ width: 110 }}>{left > 0 ? <QtyInput value={back[l.lineNo] ?? null} onChange={(v) => setBack((b) => ({ ...b, [l.lineNo]: v === null ? null : Math.min(v, left) }))} ariaLabel={t('cw_backQty')} /> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <h3 style={{ margin: 0 }}>{t('cw_goesOut')}</h3>
            <div className="row">
              <div style={{ flex: 1 }}><SearchCombo value={pick} options={options} onChange={(id) => { const it = items.find((x) => x.id === id); if (it) addOut(it); setPick(''); }} placeholder={t('cw_scanOrSearch')} ariaLabel={t('cw_goesOut')} /></div>
              <button type="button" className="btn" onClick={() => setModelPick(true)}><Icon name="shirt" size={16} />{t('cw_bySizes')}</button>
            </div>
            {out.length > 0 && (
              <table className="table">
                <tbody>
                  {out.map((x) => (
                    <tr key={x.item.id}>
                      <td>{i18n.name(x.item.name)}</td>
                      <td style={{ width: 110 }}><QtyInput value={x.qtyMilli} onChange={(v) => setOut((o) => o.map((y) => (y.item.id === x.item.id ? { ...y, qtyMilli: v ?? 0 } : y)).filter((y) => y.qtyMilli > 0))} ariaLabel={t('qty')} /></td>
                      <td className="amount num">{i18n.money(Math.round((priceOf(x.item) * x.qtyMilli) / 1000), currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="totals">
              <span className="muted">{t('cw_backValue')}</span><span className="num">{i18n.money(backValue, currency)}</span>
              <span className="muted">{t('cw_outValue')}</span><span className="num">{i18n.money(outValue, currency)}</span>
              <span>{difference >= 0 ? t('cw_customerPays') : t('cw_customerGets')}</span><strong className="num">{i18n.money(Math.abs(difference), currency)}</strong>
            </div>
            <p className="muted small">{t('cw_exchangeNote')}</p>
          </>
        )}
        <ErrorBox error={error} />
        <div className="row">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={!sale || backLines.length === 0 || busy} onClick={() => void submit()}><Icon name="swap" size={16} />{t('cw_exchangeDo')}</button>
        </div>
      </div>
      {modelPick && <TillModelPick items={items} onPick={addOut} onClose={() => setModelPick(false)} />}
    </Modal>
  );
}

/** The till's buttons for a clothing shop: pick by size and colour, and exchange. */
export function TillClothingButtons({ shiftId, currency, items, onPick, onExchanged, disabled, beforeExchange }: {
  shiftId: string; currency: CurrencyCode; items: readonly ItemView[]; onPick(item: ItemView): void; onExchanged(): void; disabled?: boolean;
  /** (2.0) asks a supervisor first when the till's rules ask one for refunds; false: not approved */
  beforeExchange?: () => Promise<boolean>;
}) {
  const { t } = useI18n();
  const on = useClothingOn();
  const [open, setOpen] = useState<'pick' | 'exchange' | null>(null);
  if (!on) return null;
  return (
    <>
      <button type="button" className="btn pos-touch" disabled={disabled} onClick={() => setOpen('pick')}><Icon name="shirt" size={18} />{t('cw_bySizes')}</button>
      <button type="button" className="btn pos-touch" disabled={disabled} onClick={() => void (beforeExchange ? beforeExchange() : Promise.resolve(true)).then((go) => { if (go) setOpen('exchange'); })}><Icon name="swap" size={18} />{t('cw_exchange')}</button>
      {open === 'pick' && <TillModelPick items={items} onPick={onPick} onClose={() => setOpen(null)} />}
      {open === 'exchange' && <ExchangeDialog shiftId={shiftId} currency={currency} items={items} onDone={onExchanged} onClose={() => setOpen(null)} />}
    </>
  );
}
