import { roundHalfUp } from './money.ts';
import { formatQty, isUnit, QTY_SCALE, UNITS, type UnitCode } from './inventory.ts';
import type { Lang } from './lang.ts';

/**
 * Units with conversions. An item keeps one base unit (items.unit): stock, average cost, returns and reports are all
 * in base units. Its other units (a box of 10 strips of 10 tablets) each say how many base units they hold, in
 * thousandths (the factor), and may have their own barcode and price. A document line typed in another unit keeps
 * the unit, a copy of the factor and the quantity as typed; its base quantity is worked out from them.
 */

/** At most this many other units per item. */
export const MAX_ITEM_UNITS = 10;
/** The largest factor: a million base units in one, in thousandths. */
export const MAX_UNIT_FACTOR_MILLI = 1_000_000_000;

export interface ItemUnit {
  unit: UnitCode;
  /** base units in one of this unit, in thousandths (a box of 100 tablets = 100000; a gram of a kg item = 1) */
  factorMilli: number;
  barcode?: string | null | undefined;
  /** price of one of this unit, in the item's sale currency; null = the base price × the factor */
  salePrice?: number | null | undefined;
}

/**
 * The base quantity (thousandths) of `unitQtyMilli` of a unit holding `factorMilli` thousandths of the base unit, or
 * null when it isn't a whole number of thousandths (1 g of an item kept in kg is fine; ⅓ of a box of 10 is not) or is
 * too large to keep exactly.
 */
export function toBaseQty(unitQtyMilli: number, factorMilli: number): number | null {
  if (!Number.isSafeInteger(unitQtyMilli) || !Number.isSafeInteger(factorMilli) || factorMilli <= 0) return null;
  const product = BigInt(unitQtyMilli) * BigInt(factorMilli);
  if (product % BigInt(QTY_SCALE) !== 0n) return null;
  const base = product / BigInt(QTY_SCALE);
  if (base > BigInt(Number.MAX_SAFE_INTEGER) || base < -BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(base);
}

/** The quantity in a unit for a base quantity, or null when it isn't whole thousandths of that unit. */
export function fromBaseQty(baseQtyMilli: number, factorMilli: number): number | null {
  if (!Number.isSafeInteger(baseQtyMilli) || !Number.isSafeInteger(factorMilli) || factorMilli <= 0) return null;
  const product = BigInt(baseQtyMilli) * BigInt(QTY_SCALE);
  if (product % BigInt(factorMilli) !== 0n) return null;
  return Number(product / BigInt(factorMilli));
}

/** The price of one of a unit: its own price, or else the base price × the factor (rounded half up). */
export function unitPrice(base: { price: number }, unit: { factorMilli: number; salePrice?: number | null | undefined }): number {
  if (unit.salePrice !== null && unit.salePrice !== undefined) return unit.salePrice;
  return roundHalfUp((base.price * unit.factorMilli) / QTY_SCALE);
}

/** A customer price list keeps prices per base unit: one of another unit costs the list price × the factor. */
export function priceListUnitPrice(listPrice: number, factorMilli: number): number {
  return roundHalfUp((listPrice * factorMilli) / QTY_SCALE);
}

export type ItemUnitError =
  | { code: 'units_too_many' }
  | { code: 'unit_invalid'; unit: string }
  | { code: 'unit_repeated'; unit: string }
  | { code: 'unit_is_base'; unit: string }
  | { code: 'unit_factor_invalid'; unit: string }
  | { code: 'unit_barcode_repeated'; unit: string }
  | { code: 'unit_price_invalid'; unit: string }
  | { code: 'sale_unit_invalid' }
  | { code: 'purchase_unit_invalid' };

/** Checks an item's other units against its base unit and barcode (the database checks other items' barcodes). */
export function validateItemUnits(
  base: { unit: string; barcode?: string | null | undefined; saleUnit?: string | null | undefined; purchaseUnit?: string | null | undefined },
  units: readonly ItemUnit[]
): ItemUnitError[] {
  const errors: ItemUnitError[] = [];
  if (units.length > MAX_ITEM_UNITS) errors.push({ code: 'units_too_many' });
  const seen = new Set<string>();
  const barcodes = new Set<string>();
  const own = base.barcode?.trim() || '';
  for (const u of units) {
    if (!isUnit(u.unit) || u.unit === 'service') { errors.push({ code: 'unit_invalid', unit: String(u.unit) }); continue; }
    if (u.unit === base.unit) errors.push({ code: 'unit_is_base', unit: u.unit });
    else if (seen.has(u.unit)) errors.push({ code: 'unit_repeated', unit: u.unit });
    seen.add(u.unit);
    if (!Number.isSafeInteger(u.factorMilli) || u.factorMilli <= 0 || u.factorMilli > MAX_UNIT_FACTOR_MILLI) errors.push({ code: 'unit_factor_invalid', unit: u.unit });
    const barcode = u.barcode?.trim() || '';
    if (barcode) {
      if (barcode === own || barcodes.has(barcode)) errors.push({ code: 'unit_barcode_repeated', unit: u.unit });
      barcodes.add(barcode);
    }
    if (u.salePrice !== null && u.salePrice !== undefined && (!Number.isSafeInteger(u.salePrice) || u.salePrice < 0)) {
      errors.push({ code: 'unit_price_invalid', unit: u.unit });
    }
  }
  const known = (unit: string | null | undefined) => !unit || unit === base.unit || units.some((u) => u.unit === unit);
  if (!known(base.saleUnit)) errors.push({ code: 'sale_unit_invalid' });
  if (!known(base.purchaseUnit)) errors.push({ code: 'purchase_unit_invalid' });
  return errors;
}

/**
 * A base quantity told in the item's units, largest first: "3 boxes 4 strips 2 tablets". Display only; what does not
 * divide into whole units stays in the base unit.
 */
export function splitInUnits(qtyMilli: number, baseUnit: UnitCode, units: readonly Pick<ItemUnit, 'unit' | 'factorMilli'>[]): { unit: UnitCode; qtyMilli: number }[] {
  const negative = qtyMilli < 0;
  let rest = Math.abs(qtyMilli);
  const parts: { unit: UnitCode; qtyMilli: number }[] = [];
  const bigger = [...units].filter((u) => u.factorMilli > QTY_SCALE).sort((a, b) => b.factorMilli - a.factorMilli);
  for (const u of bigger) {
    // whole units only: both the quantity and the factor are in thousandths of the base unit
    const count = Math.floor(rest / u.factorMilli);
    if (count > 0) {
      parts.push({ unit: u.unit, qtyMilli: count * QTY_SCALE });
      rest -= count * u.factorMilli;
    }
  }
  if (rest > 0 || parts.length === 0) parts.push({ unit: baseUnit, qtyMilli: rest });
  return negative ? parts.map((p) => ({ ...p, qtyMilli: -p.qtyMilli })) : parts;
}

/** splitInUnits as text in a language: "3 علبة 4 شريط 2 حبة". */
export function formatInUnits(qtyMilli: number, baseUnit: UnitCode, units: readonly Pick<ItemUnit, 'unit' | 'factorMilli'>[], lang: Lang): string {
  return splitInUnits(qtyMilli, baseUnit, units).map((p) => `${formatQty(p.qtyMilli)} ${UNITS[p.unit][lang]}`).join(' ');
}
