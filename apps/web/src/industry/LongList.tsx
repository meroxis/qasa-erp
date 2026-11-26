import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useI18n } from '../i18n.ts';

/** How many rows a long table shows at first, and how many more each "Show more" adds. */
export const ROWS_AT_ONCE = 300;

/**
 * A long table shows its rows a few hundred at a time (2.0.0). A big company's items page, or a year of a till's safe
 * on its statement (a line for every sale), put 100,000 rows on the screen at once, and the app stood still for many
 * seconds (bench/big-company.ts). The counts, the totals and the export still take every row, and so does printing:
 * the whole list is drawn just before the page goes to the printer.
 *
 * `from: 'end'`: a statement's newest lines, the earlier ones folded after the opening balance (each line keeps its own
 * running balance). `reset`: what starts the list again from the first few hundred (a new search, another account).
 */
export function useRowsShown<T>(rows: readonly T[] | null | undefined, options: { from?: 'start' | 'end'; reset?: unknown } = {}) {
  const [count, setCount] = useState(ROWS_AT_ONCE);
  const { reset } = options;
  useEffect(() => { setCount(ROWS_AT_ONCE); }, [reset]);
  useEffect(() => {
    // the printed page is the whole list: drawn at once, before the printer lays the page out
    const whole = () => { flushSync(() => setCount(Number.POSITIVE_INFINITY)); };
    window.addEventListener('beforeprint', whole);
    return () => window.removeEventListener('beforeprint', whole);
  }, []);
  const list = rows ?? [];
  const n = Math.min(count, list.length);
  return {
    shown: options.from === 'end' ? list.slice(list.length - n) : list.slice(0, n),
    hidden: list.length - n,
    more: () => setCount((c) => c + ROWS_AT_ONCE),
    all: () => setCount(Number.POSITIVE_INFINITY)
  };
}

/** The row that says how many are not shown yet, with "Show more" and "Show all" (never printed: printing draws all). */
export function MoreRows({ hidden, columns, earlier = false, onMore, onAll }: {
  hidden: number; columns: number; earlier?: boolean; onMore: () => void; onAll: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  if (hidden <= 0) return null;
  return (
    <tr className="more-rows no-print">
      <td colSpan={columns}>
        <span className="muted">{t(earlier ? 'll_hiddenBefore' : 'll_hiddenAfter', { n: i18n.int(hidden) })}</span>
        <button type="button" className="btn small ghost" onClick={onMore}>{t('ll_more', { n: i18n.int(Math.min(hidden, ROWS_AT_ONCE)) })}</button>
        <button type="button" className="btn small ghost" onClick={onAll}>{t('ll_all')}</button>
      </td>
    </tr>
  );
}
