import { useEffect, useRef, useState } from 'react';
import { rateFromX100, type CurrencyCode } from '@qasa/core';
import { fxApi, type FxRateOn } from './fx-api.ts';

/**
 * The dollar rate in an editor, filled from the rate board for the document's date (the latest rate on or before it,
 * else the company's default) whenever the currency is USD — until the user types a rate of their own, which is never
 * overwritten. Editing a saved document keeps its own rate (pass active: false).
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a board answer may replace the rate in the box. */
export function mayPrefill(s: { active: boolean; currency: CurrencyCode; date: string; typed: boolean }): boolean {
  return s.active && s.currency === 'USD' && !s.typed && ISO.test(s.date);
}

export const rateTextOf = (r: Pick<FxRateOn, 'rateX100'>) => String(rateFromX100(r.rateX100));

/**
 * Prefills an existing rate box. Returns `typed`, to call from the box's onChange so the user's own rate stays.
 */
export function useRatePrefill(opts: { active: boolean; currency: CurrencyCode; date: string; setRateText(text: string): void }): { typed(): void } {
  const typedRef = useRef(false);
  const latest = useRef(0);
  const { active, currency, date, setRateText } = opts;
  useEffect(() => {
    if (!mayPrefill({ active, currency, date, typed: typedRef.current })) return;
    const ask = ++latest.current;
    fxApi.rateOn(date).then((r) => {
      // a later date was asked for meanwhile, or the user typed: keep what is there
      if (ask !== latest.current || typedRef.current) return;
      setRateText(rateTextOf(r));
    }, () => { /* the default rate already in the box stays */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, currency, date]);
  return { typed: () => { typedRef.current = true; } };
}

/** A rate box of its own (for small dialogs): [text, setText from the user]. */
export function useFxRate(currency: CurrencyCode, date: string, active = true): [string, (text: string) => void] {
  const [text, setText] = useState('');
  const { typed } = useRatePrefill({ active, currency, date, setRateText: setText });
  return [text, (t: string) => { typed(); setText(t); }];
}
