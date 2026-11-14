import { useEffect, useState } from 'react';
import { useI18n, type I18n } from '../i18n.ts';
import { href } from '../router.ts';
import { fxApi, type FxRateOn } from './fx-api.ts';

/**
 * 1.4: today's dollar rate at the top of the window, beside the person's name: "$1 = 1,310 IQD", from the app's own
 * rate board (the latest rate on or before today, else the company's usual rate). For someone who may enter rates it
 * opens the rate board; for anyone else it is plain text. Without a rate, those who may enter one get a quiet "Set
 * dollar rate" link. Hidden on a very narrow window (styles.css).
 */

/** Dinars for one dollar: "1,310", or "1,465.5" when the rate per $100 doesn't divide evenly. */
export function perDollar(i18n: Pick<I18n, 'int' | 'digitsOf'>, rateX100: number): string {
  const one = rateX100 / 100;
  return Number.isInteger(one) ? i18n.int(one) : i18n.digitsOf(one.toLocaleString('en-US', { maximumFractionDigits: 2 }));
}

/** A rate the app can show: a whole positive number of dinars per $100. */
export const hasRate = (rate: FxRateOn | null): rate is FxRateOn => !!rate && Number.isSafeInteger(rate.rateX100) && rate.rateX100 > 0;

export function HeaderRateView({ rate, canSet }: { rate: FxRateOn | null; canSet: boolean }) {
  const i18n = useI18n();
  const { t, lang } = i18n;
  if (!hasRate(rate)) {
    return canSet ? <a className="fx-chip quiet no-print" href={href('rates')}>{t('s14_rateSet')}</a> : null;
  }
  // English writes the dollar sign; Arabic and Kurdish write the word, so the line reads in their own direction
  const amount = (n: number) => (lang === 'en' ? `$${i18n.int(n)}` : i18n.int(n));
  const text = t('s14_rate', { one: amount(1), r: perDollar(i18n, rate.rateX100) });
  const title = rate.source === 'board' && rate.date
    ? t('s14_rateTitle', { d: i18n.date(rate.date), hundred: amount(100), r: i18n.int(rate.rateX100) })
    : t('s14_rateUsual', { hundred: amount(100), r: i18n.int(rate.rateX100) });
  return canSet
    ? <a className="fx-chip no-print" href={href('rates')} title={title} aria-label={`${t('fx_title')}: ${text}`}><span className="num">{text}</span></a>
    : <span className="fx-chip no-print" title={title}><span className="num">{text}</span></span>;
}

/** `watch`: anything that changes when the rate may have (the company's usual rate, leaving the rate board). */
export function HeaderRate({ canSet, watch }: { canSet: boolean; watch: unknown }) {
  const [rate, setRate] = useState<FxRateOn | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    let live = true;
    // a rate that can't be read (the server is away) keeps the last one shown, and shows nothing before the first
    fxApi.rateOn().then((r) => { if (live) { setRate(r); setAsked(true); } }, () => {});
    return () => { live = false; };
  }, [watch]);
  if (!asked) return null;
  return <HeaderRateView rate={rate} canSet={canSet} />;
}
