import { useEffect, useMemo, useState } from 'react';
import { isLang, type Lang } from '@qasa/core';
import { api } from '../api.ts';
import { AmountInput, ErrorBox, Icon, LANGUAGE_NAMES, Modal, QtyInput, SearchCombo, useLoad, type PickOption } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { deliveryApi, type DeliveryLineInput, type DeliveryOrder, type DeliveryOrderInput, type DeliveryPayment, type DeliveryPreview } from './market-extras-api.ts';

/**
 * The delivery order form (طلب توصيل): who it is for (a customer of the company's, or only a name, phone and address),
 * the goods at their sale prices, the fee, how it is paid and who drives it. The total below is the server's: the
 * goods, what the offers on now take off, and the fee. Used by the delivery board, and by the till to send the basket
 * out as an order (DeliveryFromTill).
 */

export interface DraftLine { key: number; itemId: string; qtyMilli: number | null; unitPrice: number | null }

let nextKey = 1;
export const blankLine = (): DraftLine => ({ key: nextKey++, itemId: '', qtyMilli: 1000, unitPrice: null });

export interface OrderDraft {
  partyId: string; customerName: string; phone: string; address: string; area: string; notes: string; lang: Lang | ''; warehouseId: string;
  payment: DeliveryPayment; fee: number | null; driverId: string; lines: DraftLine[];
}

export const emptyDraft = (warehouseId = ''): OrderDraft => ({
  partyId: '', customerName: '', phone: '', address: '', area: '', notes: '', lang: '', warehouseId, payment: 'cod', fee: 0, driverId: '', lines: [blankLine()]
});

export function draftOf(o: DeliveryOrder): OrderDraft {
  return {
    partyId: o.partyId ?? '', customerName: o.customerName, phone: o.phone, address: o.address, area: o.area, notes: o.notes, lang: o.lang ?? '',
    warehouseId: o.warehouseId, payment: o.payment, fee: o.fee, driverId: o.driverId ?? '',
    lines: o.lines.map((l) => ({ key: nextKey++, itemId: l.itemId, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice }))
  };
}

/** The lines the server takes: filled ones only, in base units at the price typed. */
export function linesOf(lines: readonly DraftLine[]): DeliveryLineInput[] {
  return lines.filter((l) => l.itemId && (l.qtyMilli ?? 0) > 0 && l.unitPrice !== null).map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli!, unitPrice: l.unitPrice! }));
}

export function inputOf(d: OrderDraft): DeliveryOrderInput {
  return {
    partyId: d.partyId || null, customerName: d.customerName.trim(), phone: d.phone.trim(), address: d.address.trim(), area: d.area.trim(), notes: d.notes.trim(),
    lang: d.lang || null, warehouseId: d.warehouseId, payment: d.payment, fee: d.fee ?? 0, driverId: d.driverId || null, lines: linesOf(d.lines)
  };
}

export function DeliveryOrderForm({ id, initial, onClose, onSaved }: { id: string | null; initial: OrderDraft; onClose(): void; onSaved(order: DeliveryOrder): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [d, setD] = useState<OrderDraft>(initial);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<DeliveryPreview | null>(null);
  const items = useLoad(() => api.items({ active: 'true' }), []);
  const customers = useLoad(() => api.parties({ type: 'customer', active: 'true' }), []);
  const warehouses = useLoad(() => api.warehouses(), []);
  const drivers = useLoad(() => deliveryApi.drivers(), []);
  const set = (patch: Partial<OrderDraft>) => setD((x) => ({ ...x, ...patch }));

  // the first warehouse when none was given
  useEffect(() => {
    if (!d.warehouseId && warehouses.data?.length) set({ warehouseId: warehouses.data.find((w) => w.active)?.id ?? '' });
  }, [warehouses.data, d.warehouseId]);

  const itemOptions = useMemo((): PickOption[] => (items.data ?? []).filter((it) => it.unit !== 'service').map((it) => ({
    id: it.id, code: it.code, label: i18n.name(it.name), search: `${it.barcode} ${it.name.ar} ${it.name.en} ${it.name.ku}`
  })), [items.data, i18n]);
  const customerOptions = useMemo((): PickOption[] => (customers.data ?? []).map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone })), [customers.data]);

  // the server's total, asked again a moment after the goods or the fee change
  const sent = JSON.stringify({ w: d.warehouseId, f: d.fee, l: linesOf(d.lines) });
  useEffect(() => {
    if (!d.warehouseId) return;
    const timer = setTimeout(() => {
      deliveryApi.preview({ warehouseId: d.warehouseId, fee: d.fee ?? 0, lines: linesOf(d.lines) }).then(setPreview, () => setPreview(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [sent]);

  function pickCustomer(partyId: string) {
    const p = customers.data?.find((x) => x.id === partyId);
    if (!p) { set({ partyId: '', payment: 'cod' }); return; }
    const lang = (p as { lang?: string | null }).lang;
    set({ partyId, customerName: p.name, phone: p.phone || d.phone, address: p.address || d.address, lang: lang && isLang(lang) ? lang : d.lang });
  }

  function setLine(key: number, patch: Partial<DraftLine>) {
    setD((x) => {
      const lines = x.lines.map((l) => (l.key === key ? { ...l, ...patch } : l));
      // a new empty line once the last one has an item, as the invoice screen does
      return { ...x, lines: lines[lines.length - 1]?.itemId ? [...lines, blankLine()] : lines };
    });
  }

  function pickItem(key: number, itemId: string) {
    const it = items.data?.find((x) => x.id === itemId);
    // the sale price in dinars (a dollar-priced item is priced at the company's rate by whoever takes the order)
    setLine(key, { itemId, unitPrice: it && it.saleCurrency === 'IQD' ? it.salePrice : null });
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const input = inputOf(d);
      const saved = id ? await deliveryApi.update(id, input) : await deliveryApi.create(input);
      onSaved(saved);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const activeWarehouses = (warehouses.data ?? []).filter((w) => w.active);
  return (
    <Modal title={t(id ? 'mx_editOrder' : 'mx_newOrder')} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <label className="field"><span>{t('mx_customer')}</span>
            <SearchCombo value={d.partyId} options={customerOptions} onChange={pickCustomer} placeholder={t('mx_customerPick')} ariaLabel={t('mx_customer')} emptyLabel={t('mx_customerNew')} />
          </label>
          <label className="field"><span>{t('mx_name')}</span><input className="input" value={d.customerName} maxLength={200} onChange={(e) => set({ customerName: e.target.value })} /></label>
          <label className="field"><span>{t('mx_phone')}</span><input className="input ltr" inputMode="tel" value={d.phone} maxLength={40} onChange={(e) => set({ phone: e.target.value })} /></label>
          <label className="field"><span>{t('mx_area')}</span><input className="input" value={d.area} maxLength={120} onChange={(e) => set({ area: e.target.value })} /></label>
        </div>
        <label className="field"><span>{t('mx_address')}</span><textarea className="input" rows={2} value={d.address} maxLength={500} onChange={(e) => set({ address: e.target.value })} /></label>

        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead><tr><th>{t('item')}</th><th className="num">{t('qty')}</th><th className="num">{t('mx_price')}</th><th className="num">{t('mx_lineTotal')}</th><th /></tr></thead>
            <tbody>
              {d.lines.map((l, index) => {
                const offer = preview?.byLine[linesOf(d.lines.slice(0, index + 1)).length] ?? 0;
                const amount = l.qtyMilli !== null && l.unitPrice !== null ? Math.round((l.qtyMilli * l.unitPrice) / 1000) : null;
                return (
                  <tr key={l.key}>
                    <td style={{ minWidth: 220 }}><SearchCombo value={l.itemId} options={itemOptions} onChange={(v) => pickItem(l.key, v)} placeholder={t('chooseItem')} ariaLabel={t('item')} /></td>
                    <td style={{ width: 110 }}><QtyInput value={l.qtyMilli} onChange={(v) => setLine(l.key, { qtyMilli: v })} ariaLabel={t('qty')} /></td>
                    <td style={{ width: 140 }}><AmountInput value={l.unitPrice} currency="IQD" onChange={(v) => setLine(l.key, { unitPrice: v })} ariaLabel={t('mx_price')} /></td>
                    <td className="num">
                      {amount !== null && l.itemId ? i18n.money(amount, 'IQD') : ''}
                      {offer > 0 && l.itemId && <div className="small" style={{ color: 'var(--ok)' }}>−{i18n.money(offer, 'IQD')}</div>}
                    </td>
                    <td>
                      {l.itemId && (
                        <button type="button" className="btn small" aria-label={t('actDelete')} onClick={() => setD((x) => ({ ...x, lines: x.lines.filter((y) => y.key !== l.key) }))}>
                          <Icon name="x" size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid-2">
          <label className="field"><span>{t('mx_fee')}</span><AmountInput value={d.fee} currency="IQD" onChange={(v) => set({ fee: v })} ariaLabel={t('mx_fee')} /></label>
          <label className="field"><span>{t('mx_payment')}</span>
            <select className="input" value={d.payment} onChange={(e) => set({ payment: e.target.value as DeliveryPayment })}>
              <option value="cod">{t('mx_pay_cod')}</option>
              <option value="account" disabled={!d.partyId}>{t('mx_pay_account')}</option>
            </select>
          </label>
          <label className="field"><span>{t('mx_driver')}</span>
            <select className="input" value={d.driverId} onChange={(e) => set({ driverId: e.target.value })}>
              <option value="">{t('mx_driverLater')}</option>
              {(drivers.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('mx_lang')}</span>
            <select className="input" value={d.lang} onChange={(e) => set({ lang: e.target.value as Lang | '' })}>
              <option value="">{t('mx_langApp')}</option>
              {LANGUAGE_NAMES.map(([l, name]) => <option key={l} value={l}>{name}</option>)}
            </select>
          </label>
          {activeWarehouses.length > 1 && (
            <label className="field"><span>{t('warehouse')}</span>
              <select className="input" value={d.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}>
                {activeWarehouses.map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
              </select>
            </label>
          )}
        </div>
        <label className="field"><span>{t('notes')}</span><input className="input" value={d.notes} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} /></label>

        {preview && (
          <dl className="totals" aria-live="polite" style={{ marginInlineStart: 'auto' }}>
            <dt>{t('mx_goods')}</dt><dd className="num">{i18n.money(preview.subtotal, 'IQD')}</dd>
            {preview.offerDiscount > 0 && <><dt>{t('mx_offers')}</dt><dd className="num" style={{ color: 'var(--ok)' }}>−{i18n.money(preview.offerDiscount, 'IQD')}</dd></>}
            <dt>{t('mx_fee')}</dt><dd className="num">{i18n.money(preview.fee, 'IQD')}</dd>
            <dt><strong>{t('mx_toPay')}</strong></dt><dd className="num"><strong>{i18n.money(preview.total, 'IQD')}</strong></dd>
          </dl>
        )}
        <ErrorBox error={error ?? items.error ?? customers.error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={busy || !linesOf(d.lines).length || !d.customerName.trim() || !d.address.trim()} onClick={() => void save()}>
            <Icon name="check" size={16} />{t('save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
