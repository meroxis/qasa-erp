import { useState } from 'react';
import { ApiError } from '../api.ts';
import { ErrorBox, errorMessages, Icon, Modal, useToast } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { outboxClient, outboxWho, madeBy, refusalCode, type OutboxEntry, type OutboxState, type Who } from '../industry/outbox.ts';
import { PinDialog } from '../pos/Supervisor.tsx';
import { outboxCounts, useOutbox } from '../industry/OutboxBanner.tsx';

/**
 * Waiting to send (1.2): what this PC kept while the office server could not be reached. Everyone sees their own; an
 * admin sees everyone's on this PC and may discard one, after a confirmation, written to the audit log first (so the
 * office server must be there). A refused one says why, for a person to fix the cause and send it again. A sale
 * refused for want of a supervisor (2.0: sold below the list price, or with a discount over the limit, while the till
 * was cut off) is approved here: a supervisor types their PIN for that very receipt, and the sale is sent again as it
 * was kept (the server takes it with both names in the audit log); or an admin discards it.
 */

/** What a supervisor approves of a kept sale the server refused: its shift, its receipt reference, and what it is worth. */
export function supervisorReview(entry: OutboxEntry): { shiftId: string; reference: string; amount: number } | null {
  if (entry.kind !== 'pos_sale' || entry.state !== 'refused' || !entry.error || refusalCode(entry.error) !== 'pos_offline_supervisor') return null;
  const shiftId = /^\/api\/pos\/shifts\/([^/]+)\/sales$/.exec(entry.path)?.[1];
  const body = entry.body as { discount?: number; lines?: { qtyMilli?: number; unitQtyMilli?: number; unitPrice: number }[]; offline?: { reference?: string } };
  const reference = body.offline?.reference ?? entry.reference;
  if (!shiftId || !reference || !Array.isArray(body.lines)) return null;
  // as the server reckons it (pos.ts): the lines at their prices, less the discount typed
  const gross = body.lines.reduce((sum, l) => sum + Math.round(((l.unitQtyMilli ?? l.qtyMilli ?? 1000) * l.unitPrice) / 1000), 0);
  return { shiftId, reference, amount: Math.max(0, gross - (body.discount ?? 0)) };
}
export function OutboxPage({ admin }: { admin: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const state = useOutbox();
  const toast = useToast();
  const [discarding, setDiscarding] = useState<OutboxEntry | null>(null);
  const [reviewing, setReviewing] = useState<OutboxEntry | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (!state) return <div className="card pad">{t('ob_notOffice')}</div>;
  const who = outboxWho();
  const shown = visibleEntries(state, who, admin);
  const box = outboxClient();
  const send = async (entry: OutboxEntry) => {
    setError(null);
    try { await box?.retry(entry.id); } catch (e) { setError(e); }
  };
  return (
    <div className="stack" style={{ maxWidth: 1200 }}>
      <div className="card pad stack">
        <h2 style={{ margin: 0 }}>{t('ob_title')}</h2>
        <p className="muted" style={{ margin: 0 }}>{t('ob_intro')}</p>
        {outboxCounts(state).refused > 0 && <p className="small" style={{ margin: 0 }}>{t('ob_fixHint')}</p>}
        <ErrorBox error={error} />
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="table outbox-table">
            <thead>
              <tr>
                <th>{t('ob_what')}</th><th>{t('ob_madeBy')}</th><th>{t('ob_madeAt')}</th><th className="num">{t('ob_amount')}</th>
                <th>{t('ob_state')}</th><th>{t('ob_why')}</th><th />
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <OutboxRow key={e.id} entry={e} state={state} who={who} admin={admin} onSend={() => void send(e)} onDiscard={() => { setError(null); setDiscarding(e); }}
                  {...(state.online && supervisorReview(e) ? { onReview: () => { setError(null); setReviewing(e); } } : {})} />
              ))}
              {shown.length === 0 && <tr><td colSpan={7} className="muted">{t('ob_none')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {reviewing && supervisorReview(reviewing) && (() => {
        const what = supervisorReview(reviewing)!;
        return (
          <PinDialog shiftId={what.shiftId} action="offline_sale" detail={`${what.reference} — ${i18n.money(reviewing.summary.total, reviewing.summary.currency)}`}
            what={{ reference: what.reference, amount: what.amount }}
            onDone={(ok) => {
              const entry = reviewing;
              setReviewing(null);
              if (!ok) return;
              toast(t('ob_supervisorOk'));
              // back in the line: it goes now when it is this person's, else when the cashier who kept it is signed in
              void box?.retry(entry.id).catch(setError);
            }} />
        );
      })()}
      {discarding && (
        <DiscardDialog
          entry={discarding} online={state.online} i18n={i18n} onCancel={() => setDiscarding(null)}
          onDone={(booked) => { setDiscarding(null); toast(t(booked ? 'ob_discardedBooked' : 'ob_discarded')); }}
        />
      )}
    </div>
  );
}

/** An admin sees every entry on this PC; anyone else their own. Oldest first, as they are sent. */
export function visibleEntries(state: Pick<OutboxState, 'entries'>, who: Pick<Who, 'id' | 'name'> | null, admin: boolean): OutboxEntry[] {
  return state.entries.filter((e) => admin || madeBy(e, who)).sort((a, b) => a.seq - b.seq);
}

/** Why the server refused one, in the reader's words (the same messages as the pages give). */
export function refusalText(entry: OutboxEntry, i18n: I18n): string {
  if (!entry.error) return '';
  return errorMessages(new ApiError(entry.error.status, entry.error.code, entry.error.details), i18n).join(' ');
}

export function OutboxRow({ entry, state, who, admin, onSend, onDiscard, onReview }: {
  entry: OutboxEntry; state: OutboxState; who: Who | null; admin: boolean; onSend(): void; onDiscard(): void; onReview?: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const mine = madeBy(entry, who);
  const refused = entry.state === 'refused';
  const status = refused ? t('ob_refused') : state.sending && mine ? t('ob_sending') : t('ob_waiting');
  return (
    <tr>
      <td>
        <div>{t(`ob_kind_${entry.kind}` as Key)}</div>
        {entry.reference && <div className="small muted"><bdi className="ltr num">{entry.reference}</bdi></div>}
      </td>
      <td><bdi>{entry.user.name}</bdi></td>
      <td className="num">{i18n.dateTime(entry.createdAt)}</td>
      <td className="num">{i18n.money(entry.summary.total, entry.summary.currency)}</td>
      <td>
        <span className={'chip ' + (refused ? 'bad' : 'warn')}>{status}</span>
        {entry.attempts > 0 && <div className="small muted num">{t('ob_tries', { n: i18n.int(entry.attempts) })}</div>}
        {!refused && mine && !state.online && state.nextTry && <div className="small muted">{t('ob_nextTry', { t: i18n.time(state.nextTry) })}</div>}
      </td>
      <td className="outbox-why small">
        {refused ? refusalText(entry, i18n) : !mine ? t('ob_otherUser', { u: entry.user.name }) : ''}
        {refused && supervisorReview(entry) && <div className="muted">{t('ob_supervisorHint')}</div>}
      </td>
      <td>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
          {onReview && <button type="button" className="btn primary" onClick={onReview}><Icon name="key" size={14} />{t('ob_supervisor')}</button>}
          {mine && <button type="button" className="btn" onClick={onSend}><Icon name="upload" size={14} />{t('ob_sendNow')}</button>}
          {admin && <button type="button" className="btn" onClick={onDiscard}><Icon name="x" size={14} />{t('ob_discard')}</button>}
        </div>
      </td>
    </tr>
  );
}

/** The confirmation before a discard: what it was, that it is never booked, and why (written to the audit log). */
export function DiscardDialog({ entry, online, i18n, onCancel, onDone }: {
  entry: OutboxEntry; online: boolean; i18n: I18n; onCancel(): void; onDone(booked: boolean): void;
}) {
  const { t } = i18n;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const confirm = async () => {
    const box = outboxClient();
    if (!box) return;
    setBusy(true);
    setError(null);
    try {
      const { booked } = await box.discard(entry.id, reason);
      onDone(!!booked);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t('ob_discardTitle')} onClose={onCancel}>
      <div className="stack">
        <div className="pos-r-row"><span>{t(`ob_kind_${entry.kind}` as Key)}{entry.reference ? ' ' : ''}{entry.reference && <bdi className="ltr num">{entry.reference}</bdi>}</span><strong className="num">{i18n.money(entry.summary.total, entry.summary.currency)}</strong></div>
        <div className="small muted"><bdi>{entry.user.name}</bdi> · <span className="num">{i18n.dateTime(entry.createdAt)}</span></div>
        <p style={{ margin: 0 }}>{t('ob_discardText')}</p>
        <label className="field"><span>{t('ob_discardReason')}</span><textarea className="input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {!online && <div className="alert warn">{t('ob_discardNeedsServer')}</div>}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn danger" disabled={busy || !online} onClick={() => void confirm()}>{t('ob_discardConfirm')}</button>
          <button type="button" className="btn" onClick={onCancel}>{t('ob_back')}</button>
        </div>
      </div>
    </Modal>
  );
}
