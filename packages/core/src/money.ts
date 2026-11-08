/**
 * Money is always stored as a whole number in the currency's minor unit:
 * IQD → dinars (no decimals in practice), USD → cents.
 * Never use floating point for stored amounts.
 */
export type CurrencyCode = 'IQD' | 'USD';

export const CURRENCIES: Record<CurrencyCode, { decimals: number }> = {
  IQD: { decimals: 0 },
  USD: { decimals: 2 }
};

export const BASE_CURRENCY: CurrencyCode = 'IQD';

export function isCurrency(value: unknown): value is CurrencyCode {
  return value === 'IQD' || value === 'USD';
}

export function isMinorAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * Exchange rates are stored as "IQD per 1 USD × 100" so two decimals survive
 * without floating point, e.g. 1420.50 → 142050.
 */
export function rateToX100(rate: number): number {
  return Math.round(rate * 100);
}

export function rateFromX100(rateX100: number): number {
  return rateX100 / 100;
}

/** Converts an amount in `currency` minor units to base (IQD) minor units. */
export function toBase(amountMinor: number, currency: CurrencyCode, rateX100: number): number {
  if (currency === 'IQD') return amountMinor;
  // cents × (IQD per USD × 100) / (100 cents × 100)
  return roundHalfUp((amountMinor * rateX100) / 10000);
}

export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Converts several amounts to base currency so that their base total equals the
 * base value of their exact total. Any rounding difference goes to the largest amount.
 */
export function toBaseBalanced(amounts: number[], currency: CurrencyCode, rateX100: number): number[] {
  const converted = amounts.map((a) => toBase(a, currency, rateX100));
  if (currency === 'IQD' || amounts.length === 0) return converted;
  const exactTotal = toBase(amounts.reduce((s, a) => s + a, 0), currency, rateX100);
  const diff = exactTotal - converted.reduce((s, a) => s + a, 0);
  if (diff !== 0) {
    let largest = 0;
    amounts.forEach((a, i) => { if (Math.abs(a) > Math.abs(amounts[largest] ?? 0)) largest = i; });
    converted[largest] = (converted[largest] ?? 0) + diff;
  }
  return converted;
}

/**
 * Western digits, the Arabic decimal mark as ".", spaces gone, and commas (or "٬") only as thousands separators:
 * "1,250,000.5" → "1250000.5". A comma anywhere else ("2,5", the decimal mark of comma-decimal Excel files) is not
 * guessed at: the result is null, so the caller reports the value as invalid instead of reading ten times the amount.
 */
export function normalizeNumber(text: string): string | null {
  const s = toWesternDigits(text).replace(/\s/g, '').replace(/٬/g, ',').replace('٫', '.');
  if (!s.includes(',')) return s;
  return /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : null;
}

/** Parses user input such as "1,250,000", "١٬٢٥٠٬٠٠٠" or "12.5" into minor units. Returns null when invalid. */
export function parseAmount(text: string, currency: CurrencyCode): number | null {
  const normalized = normalizeNumber(text);
  if (normalized === null || normalized === '') return null;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const decimals = CURRENCIES[currency].decimals;
  const [whole = '0', fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) return null;
  const minor = Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : null;
}

const EASTERN = '٠١٢٣٤٥٦٧٨٩';

export function toWesternDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String(EASTERN.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

export function toEasternDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => EASTERN[Number(d)] ?? d).replace(/,/g, '٬').replace(/%/g, '٪');
}

export type DigitStyle = 'western' | 'eastern';

/** Formats minor units with thousands separators, e.g. 3600000 IQD → "3,600,000", 253512 USD → "2,535.12". */
export function formatAmount(amountMinor: number, currency: CurrencyCode, digits: DigitStyle = 'western'): string {
  const decimals = CURRENCIES[currency].decimals;
  const negative = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const whole = Math.floor(abs / 10 ** decimals);
  const fraction = decimals ? String(abs % 10 ** decimals).padStart(decimals, '0') : '';
  let text = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (decimals) text += '.' + fraction;
  if (negative) text = '-' + text;
  return digits === 'eastern' ? toEasternDigits(text).replace('.', '٫') : text;
}

export function formatInteger(value: number, digits: DigitStyle = 'western'): string {
  const text = String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return digits === 'eastern' ? toEasternDigits(text) : text;
}
