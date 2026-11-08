import type { CurrencyCode } from '@qasa/core';

/**
 * An amount in minor units (IQD dinars, USD cents) moved to the other currency at a rate (IQD per USD × 100).
 * Changing a quote's or order's currency converts its prices, so 5,000 IQD never silently becomes $50.00.
 */
export function convertAmount(amount: number, from: CurrencyCode, to: CurrencyCode, rateX100: number): number {
  if (from === to || !amount) return amount;
  return from === 'IQD' ? Math.round((amount * 10000) / rateX100) : Math.round((amount * rateX100) / 10000);
}

/** The prices of a document's lines in the new currency; null when there is no rate to convert with. */
export function convertLines<T extends { unitPrice: number }>(lines: readonly T[], from: CurrencyCode, to: CurrencyCode, rateX100: number | undefined): T[] | null {
  if (from === to) return [...lines];
  if (!rateX100 || rateX100 <= 0) return null;
  return lines.map((l) => ({ ...l, unitPrice: convertAmount(l.unitPrice, from, to, rateX100) }));
}
