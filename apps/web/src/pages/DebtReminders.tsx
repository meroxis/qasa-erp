import { useState } from 'react';
import type { Lang } from '@qasa/core';
import { EmptyState, ErrorBox, Icon, Modal, useData, useLoad, usePageNav, useToast } from '../components.tsx';
import { makeI18n, useI18n } from '../i18n.ts';
import { href } from '../router.ts';
import { displayPhone, whatsappNumber, whatsappUrl } from '../share.ts';
import { reminderAmount, reminderMessage } from '../industry/market-messages.ts';
import { remindersApi, type ReminderRow } from '../industry/market-extras-api.ts';

/**
 * تذكير الديون — the customers who owe, oldest debt first, with one tap to remind each on WhatsApp in their own
 * language (every plan). "Remind everyone" walks the list one by one: WhatsApp opens for one customer at a time (a
 * browser opens a window only on a click), and each one opened is kept on the customer. Route: debt-reminders.
 */

const DAYS = [0, 30, 60, 90] as const;

export function DebtReminders() {
  const i18n = useI18n();
  const { t } = i18n;
  usePageNav({ key: 'mx_rmTitle', group: 'gSales' });
  const { permissions } = useData();
  const may = !permissions || permissions.includes('sales');
  const [minDays, setMinDays] = useState<number>(30);
  const { data, error, reload } = useLoad(() => remindersApi.list({ minDays: String(minDays) }), [minDays]);
  const [walking, setWalking] = useState<ReminderRow[] | null>(null);
  const rows = data?.rows ?? [];
  const reachable = rows.filter((r) => whatsappNumber(r.phone));
  return (
    <div className="stack">
      <p className="muted no-print" style={{ margin: 0 }}>{t('mx_rmHelp')}</p>
      <div className="row no-print">
        <div className="tabs" role="group" aria-label={t('mx_rmOwingFor')}>
          {DAYS.map((d) => (
            <button key={d} type="button" aria-pressed={minDays === d} onClick={() => setMinDays(d)}>{d === 0 ? t('mx_rmAll') : t('mx_rmOver', { n: i18n.int(d) })}</button>
          ))}
        </div>
        <span className="spacer" />
        {may && reachable.length > 0 && (
          <button type="button" className="btn primary" onClick={() => setWalking(reachable)}><Icon name="mail" size={16} />{t('mx_rmAllButton', { n: i18n.int(reachable.length) })}</button>
        )}
      </div>
      <ErrorBox error={error} />
      {data && (rows.length === 0 ? <EmptyState icon="check" title={t('mx_rmTitle')} text={t('mx_rmNone')} /> : (
        <div className="card">
          <table className="table">
            <thead><tr><th>{t('mx_customer')}</th><th>{t('mx_phone')}</th><th className="num">{t('mx_rmOwes')}</th><th className="num">{t('mx_rmDays')}</th><th>{t('mx_rmLast')}</th><th className="no-print" /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.partyId}>
                  <td><a href={href(`party/${r.partyId}`)}>{r.name}</a> <span className="muted small ltr">{r.code}</span></td>
                  <td className="ltr">{displayPhone(r.phone) ?? <span className="chip warn">{t('mx_rmNoMobile')}</span>}</td>
                  <td className="num">
                    {r.owed.IQD > 0 && <div>{i18n.money(r.owed.IQD, 'IQD')}</div>}
                    {r.owed.USD > 0 && <div>{i18n.money(r.owed.USD, 'USD')}</div>}
                    {r.owed.IQD <= 0 && r.owed.USD <= 0 && i18n.money(r.balance, 'IQD')}
                  </td>
                  <td className="num"><span className={r.oldestDays > 90 ? 'chip bad' : r.oldestDays > 30 ? 'chip warn' : ''}>{i18n.int(r.oldestDays)}</span></td>
                  <td className="small">{r.lastRemindedAt ? <>{i18n.date(r.lastRemindedAt.slice(0, 10))} <span className="muted">({i18n.int(r.reminders)})</span></> : <span className="muted">{t('mx_rmNever')}</span>}</td>
                  <td className="no-print">{may && whatsappNumber(r.phone) && <RemindButton row={r} onSent={reload} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {walking && <RemindAll rows={walking} onClose={() => { setWalking(null); reload(); }} />}
    </div>
  );
}

/** Opens WhatsApp with the reminder in the customer's language and keeps that it was sent. */
export function useRemind() {
  const i18n = useI18n();
  const { settings } = useData();
  return async (row: ReminderRow): Promise<void> => {
    const lang: Lang = row.lang ?? i18n.lang;
    const text = reminderMessage(makeI18n(lang, i18n.digits, () => {}, () => {}), row, settings?.companyName ?? null);
    window.open(whatsappUrl(row.phone, text), '_blank', 'noopener,noreferrer');
    await remindersApi.log({ partyId: row.partyId, ...reminderAmount(row), days: row.oldestDays, lang });
  };
}

function RemindButton({ row, onSent }: { row: ReminderRow; onSent(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const remind = useRemind();
  const [error, setError] = useState<unknown>(null);
  return (
    <>
      <button type="button" className="btn small" onClick={() => { setError(null); remind(row).then(() => { toast(t('mx_rmSent')); onSent(); }, setError); }}>
        <Icon name="mail" size={14} />{t('mx_rmRemind')}
      </button>
      <ErrorBox error={error} />
    </>
  );
}

/** One customer at a time: open WhatsApp for this one, then on to the next. */
function RemindAll({ rows, onClose }: { rows: ReminderRow[]; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const remind = useRemind();
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const row = rows[index];
  return (
    <Modal title={t('mx_rmAllTitle')} onClose={onClose}>
      {row ? (
        <div className="stack">
          <p className="muted small" style={{ margin: 0 }}>{t('mx_rmStep', { n: i18n.int(index + 1), of: i18n.int(rows.length) })}</p>
          <div className="card" style={{ padding: 12 }}>
            <strong>{row.name}</strong>
            <div className="ltr">{displayPhone(row.phone)}</div>
            <p style={{ whiteSpace: 'pre-wrap' }}>{reminderMessage(makeI18n(row.lang ?? i18n.lang, i18n.digits, () => {}, () => {}), row, null)}</p>
          </div>
          <ErrorBox error={error} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setIndex(index + 1)}>{t('mx_rmSkip')}</button>
            <button type="button" className="btn primary" autoFocus onClick={() => { setError(null); remind(row).then(() => setIndex(index + 1), setError); }}>
              <Icon name="mail" size={16} />{t('mx_rmOpenNext')}
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <p>{t('mx_rmDone', { n: i18n.int(rows.length) })}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn primary" onClick={onClose}>{t('mx_close')}</button></div>
        </div>
      )}
    </Modal>
  );
}
