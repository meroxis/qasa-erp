import { fromBaseQty, priceListUnitPrice, toBaseQty, unitPrice, UNITS, formatQty, splitInUnits, type UnitCode } from '@qasa/core';
import type { ItemView } from '../api.ts';
import type { I18n } from '../i18n.ts';

/**
 * Units on the screens (1.1): which units a line can be typed in, their factors and prices. The server works the
 * base quantity out again from the item's own factor; these helpers only show the same figures while typing.
 */

/** A line unit: null is the item's base unit. */
export type LineUnit = UnitCode | null;

/** The units a line of this item can be in: its base unit first, then its other units. */
export function unitChoices(item: Pick<ItemView, 'unit' | 'units'> | undefined): { unit: LineUnit; code: UnitCode; factorMilli: number }[] {
  if (!item) return [];
  return [{ unit: null, code: item.unit, factorMilli: 1000 }, ...(item.units ?? []).map((u) => ({ unit: u.unit, code: u.unit, factorMilli: u.factorMilli }))];
}

/** Base units in one of `unit` (thousandths): 1000 for the base unit. */
export function factorOf(item: Pick<ItemView, 'units'> | undefined, unit: LineUnit): number {
  if (!unit || !item) return 1000;
  return item.units?.find((u) => u.unit === unit)?.factorMilli ?? 1000;
}

/** A line's base quantity from the quantity typed in its unit, or null when it isn't whole thousandths of the base. */
export function baseQty(item: Pick<ItemView, 'units'> | undefined, unit: LineUnit, typedMilli: number): number | null {
  return unit ? toBaseQty(typedMilli, factorOf(item, unit)) : typedMilli;
}

/** The quantity in `unit` for a base quantity (null when it isn't whole thousandths of it). */
export function typedQty(item: Pick<ItemView, 'units'> | undefined, unit: LineUnit, baseMilli: number): number | null {
  return unit ? fromBaseQty(baseMilli, factorOf(item, unit)) : baseMilli;
}

/**
 * A sale price for one of `unit`. basePrice: the price per base unit already in the document's currency (the catalog's
 * or the customer's price list); own: the unit's own price converted to that currency, used unless the customer buys
 * from a price list (a list price is kept per base unit, so it goes × the factor).
 */
export function salePriceFor(item: Pick<ItemView, 'units'> | undefined, unit: LineUnit, basePrice: number, opts: { own?: number | null; fromList?: boolean } = {}): number {
  if (!unit) return basePrice;
  const factor = factorOf(item, unit);
  if (opts.fromList) return priceListUnitPrice(basePrice, factor);
  return unitPrice({ price: basePrice }, { factorMilli: factor, salePrice: opts.own ?? null });
}

/** A unit's name in the current language. */
export function unitLabel(i18n: I18n, unit: UnitCode): string {
  return i18n.name(UNITS[unit]);
}

/** A base quantity in the item's units, largest first: "3 boxes 4 strips 2 tablets" (display only). */
export function inUnits(i18n: I18n, item: Pick<ItemView, 'unit' | 'units'>, qtyMilli: number): string {
  return splitInUnits(qtyMilli, item.unit, item.units ?? []).map((p) => `${i18n.qty(p.qtyMilli)} ${unitLabel(i18n, p.unit)}`).join(' ');
}

/** "= 100 tablet": what one of a unit holds, for the unit pickers. */
export function holdsText(i18n: I18n, item: Pick<ItemView, 'unit'>, factorMilli: number): string {
  return `= ${i18n.digitsOf(formatQty(factorMilli))} ${unitLabel(i18n, item.unit)}`;
}
