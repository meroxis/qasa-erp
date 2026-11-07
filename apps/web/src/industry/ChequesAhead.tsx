import type { CSSProperties } from 'react';
import type { CurrencyCode } from '@qasa/core';
import { Icon } from '../components.tsx';
import { useI18n, type I18n } from '../i18n.ts';
import { href } from '../router.ts';

/**
 * Cheques in the Daily Brief and on the home page: open cheques (received, or written by the company) due within the
 * next week — late ones first — and cheques that bounced in the last 30 days.
 */

export interface ChequeAlertView {
  id: string; direction: 'received' | 'issued'; number: string; bank: string; partyId: string; party: string; phone: string;
  currency: CurrencyCode; amount: number; dueDate: string; daysLate: number;
}
export interface ChequesAheadView { due: ChequeAlertView[]; bounced: ChequeAlertView[]; dueTotal: { IQD: number; USD: number } }
export interface ChequeCounts { due: number; late: number; bounced: number; dueTotal: { IQD: number; USD: number } }

const bad = 'var(--bad, #A4271A)';
const listStyle: CSSProperties = { listStyle: 'none', margin: 0, padding: '0 16px 12px' };
const itemStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line, #E4E1D8)', flexWrap: 'wrap' };

const both = (i18n: I18n, m: { IQD: number; USD: number }) =>
  [m.IQD ? i18n.money(m.IQD, 'IQD') : null, m.USD ? i18n.money(m.USD, 'USD') : null].filter(Boolean).join(' · ') || i18n.money(0, 'IQD');

/** The cheque lines of the Daily Brief message (empty when there is nothing to say). */
export function chequeBriefLines(i18n: I18n, c: ChequesAheadView | undefined): string[] {
  if (!c) return [];
  const { t } = i18n;
  const lines: string[] = [];
  if (c.due.length) {
    const late = c.due.filter((x) => x.daysLate > 0).length;
    lines.push('', `🧾 ${t('chq_dueWeek')}: ${i18n.int(c.due.length)} · ${both(i18n, c.dueTotal)}${late ? ` (${t('chq_lateN', { n: i18n.int(late) })})` : ''}`);
  }
  if (c.bounced.length) {
    lines.push(`⚠️ ${t('chq_bounced')}: ${i18n.int(c.bounced.length)}`);
    for (const x of c.bounced.slice(0, 3)) lines.push(`• ${x.party} — ${i18n.money(x.amount, x.currency)}`);
  }
  return lines;
}

function Row({ c }: { c: ChequeAlertView }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <li style={itemStyle}>
      <span style={{ flex: 1, minWidth: 160 }}>
        <a href={href(`cheque/${c.id}`)}>{c.party}</a> <span className="small muted ltr">{i18n.digitsOf(c.number)} · {c.bank}</span>
        <span className="small" style={{ display: 'block', color: c.daysLate > 0 ? bad : undefined }}>
          {c.direction === 'issued' ? t('chq_issued') : t('chq_received')} · {c.daysLate > 0 ? t('chq_lateDays', { n: i18n.int(c.daysLate) }) : t('chq_dueOn', { d: i18n.date(c.dueDate) })}
        </span>
      </span>
      <strong className="num">{i18n.money(c.amount, c.currency)}</strong>
    </li>
  );
}

/** The Daily Brief's section. */
export function ChequesBriefSection({ cheques }: { cheques: ChequesAheadView | undefined }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!cheques) return null;
  const empty = !cheques.due.length && !cheques.bounced.length;
  return (
    <section className="card" style={{ breakInside: 'avoid' }}>
      <div className="card-head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="receipt" size={18} />{t('chq_title')}</h2>
        <span className="spacer" />
        {!empty && <a className="btn ghost small no-print" href={href('banking/cheques')}>{t('br_seeAll')}</a>}
      </div>
      {empty ? <p className="muted" style={{ padding: '0 16px 16px', margin: 0 }}>{t('br_allClear')}</p> : (
        <ul style={listStyle}>
          {cheques.bounced.map((c) => (
            <li key={'b' + c.id} style={itemStyle}>
              <span style={{ flex: 1, minWidth: 160 }}>
                <a href={href(`cheque/${c.id}`)}>{c.party}</a> <span className="small muted ltr">{i18n.digitsOf(c.number)} · {c.bank}</span>
                <span className="small" style={{ display: 'block', color: bad }}>{t('chq_bouncedOne')}</span>
              </span>
              <strong className="num" style={{ color: bad }}>{i18n.money(c.amount, c.currency)}</strong>
            </li>
          ))}
          {cheques.due.map((c) => <Row key={'d' + c.id} c={c} />)}
        </ul>
      )}
    </section>
  );
}

/** The home page's reminder, only when something needs attention. */
export function ChequesHomeNote({ counts }: { counts: ChequeCounts | undefined }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!counts || (!counts.due && !counts.bounced)) return null;
  const parts = [
    counts.due ? `${t('chq_dueWeek')}: ${i18n.int(counts.due)} · ${both(i18n, counts.dueTotal)}` : null,
    counts.late ? t('chq_lateN', { n: i18n.int(counts.late) }) : null,
    counts.bounced ? `${t('chq_bounced')}: ${i18n.int(counts.bounced)}` : null
  ].filter(Boolean);
  return (
    <a href={href('banking/cheques')} className={'alert no-print ' + (counts.bounced || counts.late ? 'bad' : 'info')} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
      <Icon name="receipt" size={18} />
      <span style={{ flex: 1 }}><strong>{t('chq_title')}</strong> — {parts.join(' · ')}</span>
      <Icon name="chevron" size={16} />
    </a>
  );
}
