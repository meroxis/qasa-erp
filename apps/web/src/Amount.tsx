import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { APPROX_SIGN, DEFAULT_AMOUNTS_SHOW, dualLines, todayIso, usableRate, type AmountsShow, type CurrencyCode, type DualLine } from '@qasa/core';
import { useI18n, type I18n } from './i18n.ts';
import { href } from './router.ts';
import { fxApi } from './industry/fx-api.ts';
import { perDollar } from './industry/HeaderRate.tsx';

/**
 * Dinar and dollar on the screens (Settings → Language and display → "Show amounts in"), in one place so every screen
 * does it the same way. A total that the app keeps in dinars also shows what it is worth in dollars (or the other way,
 * dollar first), at the dollar rate of the rate board, marked "≈" and in smaller type under the real amount, with the
 * rate and its date in a tooltip. Money that really is in dollars (a dollar safe, a dollar balance) shows as it is and
 * is never converted twice. Only what is shown changes: amounts are stored as before.
 *
 * The rate: today's for today's figures (the same as the header's rate chip); for a past period, the rate of its last
 * day (the latest rate entered on or before it). A period older than every rate on the board uses today's rate, and
 * the tooltip says so. Without any rate on the board, amounts show in their own currency only and those who may enter a
 * rate get a quiet hint (DualRateHint).
 */

export interface DualRate {
  /** IQD per 1 USD × 100 */
  rateX100: number;
  /** the day the rate was entered for */
  date: string;
  /** true when no rate was entered on or before the day asked for, so today's rate is used */
  today: boolean;
}

export interface DualSource {
  show: AmountsShow;
  /** The rate for a day (default today): undefined while it is being read, null when the board has none. */
  rate(date?: string): DualRate | null | undefined;
  /** may enter a rate (an admin, a preparer): gets the hint when there is none */
  canSet: boolean;
}

/** Dinar only, no rate: amounts as the app always showed them (the default source, and messages built without one). */
export const DINAR_ONLY: DualSource ={ show: DEFAULT_AMOUNTS_SHOW, rate: () => null, canSet: false };
export const DualContext = createContext<DualSource>(DINAR_ONLY);
export const useDual = (): DualSource => useContext(DualContext);

/** Asks for a day's rate (today's date given by the caller); the answer comes through the reader's `write`. */
export type RateReader = (day: string, today: string) => void;

/** The rate board's answer for a day (fxApi.rateOn): `source` 'board' when a rate was entered on or before it. */
export type RateOn = (day: string) => Promise<{ source: string; date: string | null; rateX100: number }>;

/**
 * The one rule for a day's dollar rate, for the screens (rateReader) and the printed paper (paperRateX100) alike: the
 * rate entered on or before the day; for a day older than every rate, today's (the latest), marked `today`; null when
 * the board has none. A failed request rejects (it is not an answer). `todayRate`: today's lookup, for a caller that
 * keeps it.
 */
export function boardRate(rateOn: RateOn, day: string, today: string, todayRate: () => Promise<DualRate | null> = () => boardRate(rateOn, today, today)): Promise<DualRate | null> {
  return rateOn(day).then((r) => (r.source === 'board' && r.date && usableRate(r.rateX100)
    ? { rateX100: r.rateX100, date: r.date, today: false }
    : day >= today ? null : todayRate().then((t) => (t ? { ...t, today: true } : null))));
}

/**
 * The rate of a printed paper's "other-currency equivalent": the same as the screen's "≈" for that date (boardRate);
 * the company's usual rate only when the board has no rate at all or cannot be read.
 */
export function paperRateX100(rateOn: RateOn, day: string, today: string, usualX100: number | undefined): Promise<number | undefined> {
  return boardRate(rateOn, day, today).then((r) => r?.rateX100 ?? usualX100, () => usualX100);
}

/** The first pause before a failed rate request is asked again; it doubles on each failure, up to a minute. */
export const RATE_RETRY_MS = 2_000;

/**
 * Reads each day's rate once from the rate board (boardRate). Every day read is written (`write`) when its answer
 * comes, the day a lookup fell back to (today) as well: a day asked for but never written would stay "being read" for
 * the whole session. A failed request (offline, the server restarting) is not an answer and is not kept: the day is
 * asked again after a short pause, longer after each failure, while the reader is still in use (`alive`).
 */
export function rateReader(
  rateOn: RateOn,
  write: (day: string, rate: DualRate | null) => void,
  { retryMs = RATE_RETRY_MS, alive = () => true }: { retryMs?: number; alive?: () => boolean } = {}
): RateReader {
  const asked = new Map<string, Promise<DualRate | null>>();
  const failures = new Map<string, number>();
  const load = (d: string, today: string): Promise<DualRate | null> => {
    const had = asked.get(d);
    if (had) return had;
    const p = boardRate(rateOn, d, today, () => load(today, today));
    asked.set(d, p);
    p.then((r) => { failures.delete(d); write(d, r); }, () => {
      // (until the pause is over the failed answer stays, so a render does not ask again at once)
      const n = (failures.get(d) ?? 0) + 1;
      failures.set(d, n);
      setTimeout(() => {
        if (asked.get(d) === p) asked.delete(d);
        if (alive()) void load(d, today).catch(() => undefined);
      }, Math.min(retryMs * 2 ** (n - 1), 60_000));
    });
    return p;
  };
  return (day, today) => { void load(day, today).catch(() => undefined); };
}

/**
 * The live source for the app: the company's choice, and each day's rate read once from the rate board.
 * `watch`: anything that changes when a rate may have changed (the usual rate, leaving the rate board).
 */
export function DualProvider({ show, canSet, watch, children }: { show: AmountsShow; canSet: boolean; watch: unknown; children: ReactNode }) {
  const [known, setKnown] = useState<ReadonlyMap<string, DualRate | null>>(() => new Map());
  const reader = useRef<RateReader | null>(null);
  // a rate may have changed: read every day again (the answers of the reader before are dropped)
  const seen = useRef(watch);
  useEffect(() => {
    if (Object.is(seen.current, watch)) return;
    seen.current = watch;
    reader.current = null;
    setKnown(new Map());
  }, [watch]);

  const rate = useCallback((date?: string): DualRate | null | undefined => {
    if (show === 'iqd') return null;
    const today = todayIso();
    // (a day after the browser's today is kept: the server's day, for figures it dated, may be ahead of this PC's clock)
    const day = date || today;
    if (known.has(day)) return known.get(day);
    if (!reader.current) {
      const mine: RateReader = rateReader((d) => fxApi.rateOn(d), (d, r) => {
        if (reader.current === mine) setKnown((m) => (m.has(d) ? m : new Map(m).set(d, r)));
      }, { alive: () => reader.current === mine });
      reader.current = mine;
    }
    reader.current(day, today);
    return undefined;
  }, [show, known]);

  const value = useMemo<DualSource>(() => ({ show, rate, canSet }), [show, rate, canSet]);
  return <DualContext.Provider value={value}>{children}</DualContext.Provider>;
}

/**
 * One line as text: "1,250,000 IQD", "≈ $954.20". `format`: the figure's own text (a chart's short "1.25M"); the
 * full amount by default. Every converted figure is built here, so the sign sits the same way on every screen.
 */
export function dualLineText(i18n: Pick<I18n, 'money'>, line: DualLine, format?: (line: DualLine) => string): string {
  const text = format ? format(line) : i18n.money(line.amount, line.currency);
  return line.approx ? `${APPROX_SIGN} ${text}` : text;
}

/**
 * An amount's two lines as text, for the screen or a message: the second is null when there is nothing to add.
 * `book`: for a total kept in IQD at the book rates beside its real money (`money`), the text when nothing is
 * converted (dinar only, or no rate): the one IQD figure, as before the choice existed.
 */
export function dualText(i18n: Pick<I18n, 'money'>, money: { IQD: number; USD: number }, show: AmountsShow, rate: DualRate | null | undefined, book?: number): { first: string; second: string | null } {
  const { first, second } = dualLines(money, show, rate?.rateX100);
  if (!second && book !== undefined) return { first: i18n.money(book, 'IQD'), second: null };
  return { first: first.map((l) => dualLineText(i18n, l)).join(' + '), second: second ? dualLineText(i18n, second) : null };
}

/** The tooltip of a converted figure: the rate used and its date. */
export function dualRateTitle(i18n: Pick<I18n, 't' | 'date' | 'int' | 'digitsOf'>, rate: DualRate): string {
  return i18n.t(rate.today ? 'am_rateToday' : 'am_rateOn', { d: i18n.date(rate.date), r: perDollar(i18n, rate.rateX100) });
}

type Money2 = { IQD: number; USD: number };

/**
 * An amount on the screen, as the company chose to see amounts. `value`: a number in `currency` (dinars by default), or
 * the real money in each currency ({ IQD, USD }). `date`: the day the figure belongs to (a past period's last day);
 * today by default. With dinar only, or without a rate, it is the same text as before (no extra markup). Otherwise
 * the second figure goes on a smaller line under the first (`inline`: after it, for a row of text).
 */
export function Amount({ value, currency = 'IQD', date, inline = false, parens = false, book }: {
  value: number | Money2;
  currency?: CurrencyCode;
  date?: string | undefined;
  inline?: boolean;
  /** financial-statement style: a negative number in parentheses, "(250,000 IQD)" */
  parens?: boolean;
  /**
   * For what customers or suppliers owe: `value` is the real money in each currency and `book` the same in IQD at the
   * book rates (the official total). Converted, the real money shows (each dollar converted once, at the day's rate);
   * with dinar only, or without a rate, the book figure shows as it always did.
   */
  book?: number | undefined;
}) {
  const i18n = useI18n();
  const dual = useDual();
  // an amount the server did not send (cost to someone who may not see it) shows as nothing, as i18n.money does
  if (typeof value === 'number' && Number.isNaN(value)) return null;
  const negative = parens && typeof value === 'number' && value < 0;
  const n = negative ? -(value as number) : value;
  const money: Money2 = typeof n === 'number' ? (currency === 'USD' ? { IQD: 0, USD: n } : { IQD: n, USD: 0 }) : n;
  const rate = dual.show === 'iqd' ? null : dual.rate(date);
  const { first, second } = dualText(i18n, money, dual.show, rate, book);
  const wrap = (text: string) => (negative ? `(${text})` : text);
  if (!second || !rate) return <>{wrap(first)}</>;
  // real dinars and dollars together: each amount kept whole, the line free to wrap at the "+" in a narrow tile
  const parts = first.split(' + ');
  return (
    <span className={'dual' + (inline ? ' inline' : '')}>
      <span className="dual-first">{parts.map((p, i) => <Fragment key={i}>{i > 0 && ' + '}<span className="dual-part">{wrap(p)}</span></Fragment>)}</span>
      <span className="dual-second" title={dualRateTitle(i18n, rate)}>{wrap(second)}</span>
    </span>
  );
}

export type AmountTextOptions = { currency?: CurrencyCode; date?: string | undefined; book?: number | undefined };
/** An amount as text for a message or a copy, as the company chose to see it: "1,250,000 IQD (≈ $954.20)". */
export type AmountText = (value: number | Money2, opts?: AmountTextOptions) => string;

/** amountText without React: for builders of messages (briefText, dayCloseText) that get the source from their caller. */
export function amountTextOf(i18n: Pick<I18n, 'money'>, dual: Pick<DualSource, 'show' | 'rate'>): AmountText {
  return (value, opts = {}) => {
    const money: Money2 = typeof value === 'number' ? (opts.currency === 'USD' ? { IQD: 0, USD: value } : { IQD: value, USD: 0 }) : value;
    const { first, second } = dualText(i18n, money, dual.show, dual.show === 'iqd' ? null : dual.rate(opts.date), opts.book);
    return second ? `${first} (${second})` : first;
  };
}

/**
 * What customers or suppliers owe in all: `owed` the real money in each currency, `book` the total in IQD at the book
 * rates. A server that does not send `owed` (an office PC not yet updated) gets the book total alone: converting it
 * would turn its dollars, already in dinars at their book rate, into dollars again at another rate.
 */
export function OwedTotal({ owed, book, date, inline = false }: { owed: Money2 | undefined; book: number; date?: string | undefined; inline?: boolean }) {
  const i18n = useI18n();
  return owed ? <Amount value={owed} book={book} date={date} inline={inline} /> : <>{i18n.money(book, 'IQD')}</>;
}

/** The text of an amount as the company chose to see it, for messages and copies: "1,250,000 IQD (≈ $954.20)". */
export function useAmountText(): AmountText {
  const i18n = useI18n();
  const dual = useDual();
  return amountTextOf(i18n, dual);
}

/**
 * Under a page whose note says its figures are in dinars: once it also shows ≈ figures (dinar and dollar, with a rate
 * on the board), a short line that says what they are. Nothing with dinar only.
 */
export function DualNote({ date }: { date?: string | undefined } = {}) {
  const { t } = useI18n();
  const dual = useDual();
  if (dual.show === 'iqd' || !dual.rate(date)) return null;
  return <p className="small muted" style={{ marginBlockStart: 0 }}>{t('am_note')}</p>;
}

/**
 * The quiet line for someone who may enter a rate, when amounts should show in dollars too but the rate board has no
 * rate: "Enter the dollar rate to see amounts in dollars too". Nothing for anyone else, or once there is a rate.
 */
export function DualRateHint({ date }: { date?: string | undefined } = {}) {
  const { t } = useI18n();
  const dual = useDual();
  if (dual.show === 'iqd' || !dual.canSet || dual.rate(date) !== null) return null;
  return <div className="dual-hint small muted no-print"><a href={href('rates')}>{t('am_setRate')}</a></div>;
}
