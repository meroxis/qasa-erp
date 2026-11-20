/**
 * Dinar rounding at the till (2.0, Iraqi shops): there are no small coins, so the cash part of a dinar sale may be
 * rounded to 250 or 500 dinars, up, down or to the nearest. Only cash: a card or a wallet takes the exact amount. The
 * difference is booked to the company's rounding account with the sale (pos.ts), and printed on the receipt.
 */
export const ROUNDING_STEPS = [0, 250, 500, 1000] as const;
export type RoundingStep = (typeof ROUNDING_STEPS)[number];
export const ROUNDING_MODES = ['nearest', 'up', 'down'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

export interface CashRounding { step: RoundingStep; mode: RoundingMode }

export const NO_ROUNDING: CashRounding = { step: 0, mode: 'nearest' };

/** The cash a customer pays for `cashDue` dinars under the rule (whole dinars; 0 and less stay as they are). */
export function roundCash(cashDue: number, rule: CashRounding | null | undefined): number {
  if (!rule || !rule.step || cashDue <= 0) return cashDue;
  const step = rule.step;
  const down = Math.floor(cashDue / step) * step;
  if (down === cashDue) return cashDue;
  const up = down + step;
  if (rule.mode === 'up') return up;
  if (rule.mode === 'down') return down;
  // half way goes up, as a shopkeeper rounds
  return cashDue - down >= up - cashDue ? up : down;
}

/** rounded − due: what the rounding adds (> 0) or takes off (< 0) the cash. */
export const roundingOf = (cashDue: number, rule: CashRounding | null | undefined): number => roundCash(cashDue, rule) - cashDue;

export function isCashRounding(v: unknown): v is CashRounding {
  const r = v as Partial<CashRounding> | null;
  return !!r && (ROUNDING_STEPS as readonly number[]).includes(r.step as number) && (ROUNDING_MODES as readonly string[]).includes(r.mode as string);
}
