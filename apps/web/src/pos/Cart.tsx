import { memo, useEffect, useRef } from 'react';
import type { CurrencyCode } from '@qasa/core';
import { Icon } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { BatchPick } from '../industry/BatchFields.tsx';
import { RxTick } from '../industry/PharmacyPrompts.tsx';
import { unitLabel } from '../industry/units.ts';
import { CartName } from './CartName.tsx';
import { lineKey, lineTotal, type CartLine } from './shared.ts';

/**
 * The cart (2.0): one row per line, the newest at the bottom and scrolled into view; a line just scanned flashes. Each
 * row: the name (two lines; a tap reads it all), the price (a tap changes it, when the cashier may), the unit chip,
 * the batch and the prescription tick where they apply, big − and + for the quantity, the line's amount, and under it
 * in green the offer it gets.
 */
export const CartLines = memo(function CartLines({ cart, currency, warehouseId, offerByLine, offerNames, flash, rxItems, onQty, onUnit, onLine, onRemove, onPrice }: {
  cart: readonly CartLine[]; currency: CurrencyCode; warehouseId: string;
  /** the offer discount on each line, by line number (1…) */
  offerByLine: Readonly<Record<number, number>>;
  /** the offer's name on each line, by line number (1…) */
  offerNames: Readonly<Record<number, string>>;
  /** the line just added (it flashes) */
  flash: string | null;
  rxItems: ReadonlySet<string>;
  onQty(key: string, qtyMilli: number): void;
  onUnit(key: string): void;
  onLine(key: string, patch: Pick<CartLine, 'batchId'> | Pick<CartLine, 'rxSeen'>): void;
  onRemove(key: string): void;
  onPrice: ((key: string) => void) | null;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!flash || !box.current) return;
    const row = box.current.querySelector<HTMLElement>(`[data-line="${CSS.escape(flash)}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [flash, cart.length]);
  return (
    <div className="pos-lines" ref={box}>
      {cart.length === 0 && (
        <div className="pos-empty">
          <Icon name="cart" size={40} />
          <p className="muted">{t('pos_emptyCart')}</p>
        </div>
      )}
      {cart.map((l, i) => {
        const key = lineKey(l);
        const offer = offerByLine[i + 1] ?? 0;
        return (
          <div key={key} data-line={key} className={'pos-line' + (flash === key ? ' pos-line-flash' : '')}>
            <div className="pos-line-name">
              <CartName name={i18n.name(l.item.name)} />
              <span className="pos-line-meta">
                {onPrice ? (
                  <button type="button" className="link-btn small num" title={t('tu_priceEdit')} onClick={() => onPrice(key)}>{i18n.money(l.unitPrice, currency)}</button>
                ) : <span className="muted small num">{i18n.money(l.unitPrice, currency)}</span>}
                {l.item.units.length > 0 && (
                  <button type="button" className="chip" title={t('unit')} aria-label={`${t('unit')}: ${unitLabel(i18n, l.unit ?? l.item.unit)}`} onClick={() => onUnit(key)}>
                    {unitLabel(i18n, l.unit ?? l.item.unit)}
                  </button>
                )}
              </span>
              <BatchPick item={l.item} warehouseId={warehouseId} value={l.batchId ?? ''} onChange={(batchId) => onLine(key, { batchId })} />
              {rxItems.has(l.item.id) && <RxTick seen={!!l.rxSeen} onChange={(rxSeen) => onLine(key, { rxSeen })} />}
              {offer > 0 && <span className="pos-line-offer small"><Icon name="tag" size={13} /> {offerNames[i + 1] ?? t('of_lineOffer')} −{i18n.money(offer, currency)}</span>}
            </div>
            <div className="pos-qty">
              <button type="button" className="btn pos-qty-btn" aria-label={t('pos_less')} onClick={() => onQty(key, l.qtyMilli - 1000)}>−</button>
              <span className="num pos-qty-n">{i18n.qty(l.qtyMilli)}</span>
              <button type="button" className="btn pos-qty-btn" aria-label={t('pos_more')} onClick={() => onQty(key, l.qtyMilli + 1000)}>+</button>
            </div>
            <span className="num pos-line-total">{i18n.money(lineTotal(l), currency)}</span>
            <button type="button" className="btn pos-remove" aria-label={t('pos_remove')} onClick={() => onRemove(key)}><Icon name="x" size={16} /></button>
          </div>
        );
      })}
    </div>
  );
});
