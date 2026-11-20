import { fromBase, toBase, usableRate, type CurrencyCode } from '@qasa/core';
import { useI18n } from '../i18n.ts';
import { dualLineText, dualRateTitle, useDual } from '../Amount.tsx';
import { perDollar } from '../industry/HeaderRate.tsx';

/**
 * Under the till's total, when the company sees dinar and dollar: "≈ $954.20" (or "≈ 1,250,000 IQD" for a dollar
 * sale), with the rate in a tooltip. Only a hint: the sale is made and paid in its own currency. A dollar sale is
 * booked at the rate the cashier typed for it (`rateX100`), so its hint uses that rate and says so; a dinar sale uses
 * the rate board's rate for today.
 */
export function TillEquivalent({ total, currency, rateX100 }: { total: number; currency: CurrencyCode; rateX100?: number | undefined }) {
  const i18n = useI18n();
  const dual = useDual();
  if (dual.show === 'iqd' || !total) return null;
  if (currency === 'USD') {
    // the sale's own rate; the board's only while the cashier's field is empty or not a number
    const own = usableRate(rateX100) ? rateX100 : null;
    const board = own ? null : dual.rate();
    const r = own ?? board?.rateX100;
    if (!r) return null;
    const title = own ? i18n.t('am_rateSale', { r: perDollar(i18n, own) }) : dualRateTitle(i18n, board!);
    return <div className="pos-eq num" title={title}>{dualLineText(i18n, { amount: toBase(total, 'USD', r), currency: 'IQD', approx: true })}</div>;
  }
  const rate = dual.rate();
  if (!rate) return null;
  return <div className="pos-eq num" title={dualRateTitle(i18n, rate)}>{dualLineText(i18n, { amount: fromBase(total, rate.rateX100), currency: 'USD', approx: true })}</div>;
}
