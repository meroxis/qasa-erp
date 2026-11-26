import { useI18n, type I18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';
import type { CashMoves } from '../industry/pos-api.ts';
import { money2, shiftTime } from './shared.ts';

/**
 * The other cash on a shift's safe (2.0): what was paid out of the drawer or taken into it beside the till's own
 * sales (a supplier or an expense paid in cash, a debt collected, cash carried to another safe), with the documents
 * behind it. The server counts it in the cash expected; an older server, and a blind close, send none.
 */

const TYPE_KEY: Record<string, Key> = { purchase: 'purchase', purchase_return: 'purchase_return', receipt: 'receipt', payment: 'payment', reversal: 'reversal', journal: 'journal' };

/** What kind of document a line is, in words (anything else on a safe's account is a journal entry). */
export const cashMoveType = (i18n: Pick<I18n, 't'>, type: string): string => i18n.t(TYPE_KEY[type] ?? 'journal');

export function hasCashMoves(m: CashMoves | undefined | null): m is CashMoves {
  return !!m && (m.count > 0 || m.in.IQD !== 0 || m.in.USD !== 0 || m.out.IQD !== 0 || m.out.USD !== 0);
}

const some = (m: { IQD: number; USD: number }) => m.IQD !== 0 || m.USD !== 0;

/** The two sums as rows of a shift's figures: `row` draws one (the close dialog and the report differ in markup). */
export function cashMoveSums(i18n: I18n, m: CashMoves | undefined | null): { key: 'tu_cashIn' | 'tu_cashOut'; label: string; value: string }[] {
  if (!hasCashMoves(m)) return [];
  return [
    ...(some(m.in) ? [{ key: 'tu_cashIn' as const, label: i18n.t('tu_cashIn'), value: `+${money2(i18n, m.in)}` }] : []),
    ...(some(m.out) ? [{ key: 'tu_cashOut' as const, label: i18n.t('tu_cashOut'), value: `−${money2(i18n, m.out)}` }] : [])
  ];
}

/** The documents, one a line: what it is and its number, its words, who wrote it and when, and the amount (`links`: for whoever reads the books). */
export function CashMoveList({ moves, title, links = false }: { moves: CashMoves | undefined | null; title?: string | undefined; links?: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!hasCashMoves(moves) || !moves.lines.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }} data-cash-moves>
      <div>
        <strong>{title ?? t('tu_cashMoves')}</strong>
        <div className="small muted">{t('tu_cashMovesHelp')}</div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('tu_cashDoc')}</th><th>{t('preparedBy')}</th><th>{t('pos_time')}</th><th className="num">{t('pos_amount')}</th></tr></thead>
          <tbody>
            {moves.lines.map((l) => (
              <tr key={l.entryId}>
                <td>
                  {links ? <a href={href(`entry/${l.entryId}`)}>{cashMoveType(i18n, l.type)} <span className="ltr">{l.number ?? ''}</span></a> : <>{cashMoveType(i18n, l.type)} <span className="ltr">{l.number ?? ''}</span></>}
                  {l.description && <span className="small muted" style={{ display: 'block' }}>{l.description}</span>}
                </td>
                <td>{l.by}</td>
                <td className="num">{shiftTime(i18n, l.at)}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{l.amount > 0 ? '+' : '−'}{i18n.money(Math.abs(l.amount), l.currency)}</td>
              </tr>
            ))}
            {moves.count > moves.lines.length && <tr><td colSpan={4} className="muted">{t('tu_cashMore', { n: i18n.int(moves.count - moves.lines.length) })}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
