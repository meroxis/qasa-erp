import { useState } from 'react';
import { Icon, useData, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { blankLine, DeliveryOrderForm, emptyDraft, type OrderDraft } from './DeliveryOrderForm.tsx';
import type { DeliveryOrder } from './market-extras-api.ts';

/**
 * "Send as delivery" at the till (2.0, Starter and up): the basket becomes a delivery order for a phone or WhatsApp
 * customer, with the order form to fill the address and the driver. Nothing is sold at the till: the sale is made when
 * the order is delivered (the delivery board). Mount it with the basket's lines; `onSent` empties the basket.
 *
 *   <DeliveryFromTill lines={cart.map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice }))}
 *     partyId={customerId} warehouseId={shift.warehouseId} onSent={clearCart} />
 */

export interface TillLine { itemId: string; qtyMilli: number; unitPrice: number }

/** The basket as an order to fill: its lines in base units at the till's prices, and the customer when one is picked. */
export function draftFromBasket(lines: readonly TillLine[], warehouseId: string, partyId?: string | null): OrderDraft {
  return {
    ...emptyDraft(warehouseId), partyId: partyId ?? '', payment: 'cod',
    lines: [...lines.filter((l) => l.itemId && l.qtyMilli > 0).map((l) => ({ ...blankLine(), itemId: l.itemId, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice })), blankLine()]
  };
}

export function DeliveryFromTill({ lines, warehouseId, partyId, onSent }: { lines: readonly TillLine[]; warehouseId: string; partyId?: string | null; onSent?(order: DeliveryOrder): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { plan, permissions } = useData();
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  if (!plan?.features.includes('delivery') || (permissions && !permissions.includes('sales'))) return null;
  return (
    <>
      <button type="button" className="btn" disabled={!lines.length} onClick={() => setDraft(draftFromBasket(lines, warehouseId, partyId))}>
        <Icon name="truck" size={16} />{t('mx_sendAsDelivery')}
      </button>
      {draft && (
        <DeliveryOrderForm id={null} initial={draft} onClose={() => setDraft(null)}
          onSaved={(o) => { setDraft(null); toast(t('mx_orderMade', { number: o.number })); onSent?.(o); }} />
      )}
    </>
  );
}
