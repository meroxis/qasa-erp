import { roundHalfUp, toBase, type CurrencyCode } from './money.ts';

/**
 * Settings → Language and display → "Show amounts in" (one choice for the whole company):
 *   'iqd'     dinar only, as the app always showed (the default, so nothing changes for a company until it chooses);
 *   'iqd_usd' dinar and dollar: each total also shows its value in the other currency, dinar first;
 *   'usd_iqd' dollar and dinar: the same with the dollar first, for a company that thinks in dollars.
 * Only what the screens show changes: amounts are stored as they always were, each in its own currency.
 */
export const AMOUNTS_SHOW = ['iqd', 'iqd_usd', 'usd_iqd'] as const;
export type AmountsShow = (typeof AMOUNTS_SHOW)[number];
export const DEFAULT_AMOUNTS_SHOW: AmountsShow = 'iqd';

export function isAmountsShow(value: unknown): value is AmountsShow {
  return typeof value === 'string' && (AMOUNTS_SHOW as readonly string[]).includes(value);
}

/** Dinars (IQD minor units) in dollar cents at a rate (IQD per 1 USD × 100), rounded half away from zero. */
export function fromBase(amountIqd: number, rateX100: number): number {
  return roundHalfUp((amountIqd * 10000) / rateX100);
}

/** A rate the app can convert with: a whole positive number of dinars per $100. */
export function usableRate(rateX100: number | null | undefined): rateX100 is number {
  return typeof rateX100 === 'number' && Number.isSafeInteger(rateX100) && rateX100 > 0;
}

/** One amount as shown: `approx` marks a figure converted at the day's rate (≈), never stored money. */
export interface DualLine { amount: number; currency: CurrencyCode; approx: boolean }

/**
 * What an amount shows under the company's choice: `first` (the big line: the real money, or what it is worth in the
 * first currency) and `second` (a smaller line under it, or null).
 *
 * `money` is what is really there in each currency: a dinar total is { IQD: n, USD: 0 }; a safe holding both is both.
 * Real money is always shown as it is and never converted twice:
 *  - dinars only (the app's totals): the dinars, and ≈ their dollars (dollar first: ≈ the dollars, then the dinars);
 *  - dollars only (a dollar balance or safe): the dollars, and ≈ their dinars, in both orders;
 *  - both: the two real amounts on the first line ("1,000,000 IQD + $500.00", in the chosen order) and ≈ the whole in
 *    the second currency of the choice on the second line.
 * With 'iqd', or without a rate, the real amounts alone (dinars, then dollars when there are any), as before.
 */
export function dualLines(money: { IQD: number; USD: number }, show: AmountsShow, rateX100: number | null | undefined): { first: DualLine[]; second: DualLine | null } {
  const iqd = money.IQD;
  const usd = money.USD;
  const real: DualLine[] = [];
  if (iqd !== 0 || usd === 0) real.push({ amount: iqd, currency: 'IQD', approx: false });
  if (usd !== 0) real.push({ amount: usd, currency: 'USD', approx: false });
  // (nothing is nothing in either currency: a zero gets no "≈ $0.00" under it)
  if (show === 'iqd' || !usableRate(rateX100) || (iqd === 0 && usd === 0)) return { first: real, second: null };
  const usdFirst = show === 'usd_iqd';
  if (usd === 0) {
    const eq: DualLine = { amount: fromBase(iqd, rateX100), currency: 'USD', approx: true };
    return usdFirst ? { first: [eq], second: real[0]! } : { first: real, second: eq };
  }
  // real dollars (a dollar balance, a dollar safe) stay on top in both orders: real money is never shown smaller than
  // what it is converted to
  if (iqd === 0) return { first: real, second: { amount: toBase(usd, 'USD', rateX100), currency: 'IQD', approx: true } };
  // both real: in the chosen order, and the whole in the other currency
  const ordered = usdFirst ? [real[1]!, real[0]!] : real;
  const whole: DualLine = usdFirst
    ? { amount: iqd + toBase(usd, 'USD', rateX100), currency: 'IQD', approx: true }
    : { amount: fromBase(iqd, rateX100) + usd, currency: 'USD', approx: true };
  return { first: ordered, second: whole };
}

/** The sign that marks a converted figure, before it: "≈ $1,234.56". */
export const APPROX_SIGN = '≈';
