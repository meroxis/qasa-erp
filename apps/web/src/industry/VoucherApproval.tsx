import { useEffect, useState } from 'react';
import type { EntryStatus } from '@qasa/core';
import { api, type EntryView, type VoucherApproval, type VoucherApprovalState } from '../api.ts';
import { ErrorBox, Icon, Modal, StatusChip, useData, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';

/**
 * 1.4, "Vouchers need approval": how a voucher that was sent for approval shows (its state, who asked, why it was
 * rejected) and the two buttons of someone who may approve vouchers. The server decides who may; the buttons are only
 * hidden from the others.
 */

export const MAX_REJECT_REASON = 300;

/** Waiting or rejected while it is not posted yet; otherwise nothing special. */
export function approvalStateOf(e: { status: EntryStatus; approval?: VoucherApproval | null }): 'waiting' | 'rejected' | null {
  if (e.status === 'approved' || !e.approval) return null;
  return e.approval.state === 'waiting' || e.approval.state === 'rejected' ? e.approval.state : null;
}

/** The voucher's chip: "waiting for approval" or "rejected" instead of "draft" while it is one of those. */
export function VoucherStateChip({ entry }: { entry: { status: EntryStatus; reversedById?: string | null; approval?: VoucherApproval | null } }) {
  const { t } = useI18n();
  const state = approvalStateOf(entry);
  if (state === 'waiting') return <span className="chip warn">{t('s14_waiting')}</span>;
  if (state === 'rejected') return <span className="chip bad">{t('s14_rejected')}</span>;
  return <StatusChip status={entry.status} reversed={!!entry.reversedById} />;
}

/** The line under a voucher's buttons that says where its approval stands. */
export function ApprovalNote({ entry }: { entry: Pick<EntryView, 'status' | 'approval' | 'actions'> }) {
  const { t } = useI18n();
  const a = entry.approval;
  if (!a) return null;
  const state = approvalStateOf(entry);
  if (state === 'waiting') return <div className="alert warn no-print" role="status">{t('s14_waitingNote', { u: a.requestedBy })}</div>;
  if (state === 'rejected') {
    return (
      <div className="alert bad no-print" role="status">
        <span className="bidi">{t('s14_rejectedNote', { u: a.decidedBy ?? '', r: a.reason ?? '' })}</span>
        {entry.actions.includes('edit') && <div className="small">{t('s14_rejectedFix')}</div>}
      </div>
    );
  }
  if (a.state === 'approved' && a.decidedBy) return <div className="muted small no-print">{t('s14_approvedNote', { u: a.decidedBy, p: a.requestedBy })}</div>;
  return null;
}

/** The setting, how many wait and what this user may do; null until it arrives (and on a server without it). */
export function useVoucherApproval(): [VoucherApprovalState | null, () => void] {
  const [state, setState] = useState<VoucherApprovalState | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    api.voucherApproval().then((s) => { if (alive) setState(s); }, () => { /* nothing waits there */ });
    return () => { alive = false; };
  }, [n]);
  return [state, () => setN((x) => x + 1)];
}

/** The company setting "Vouchers need approval" (off unless an admin switches it on), on the Users page. */
export function VoucherApprovalSetting() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [state, setState] = useState<VoucherApprovalState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { api.voucherApproval().then(setState, setError); }, []);
  const set = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setState(await api.setVoucherApproval(on));
      toast(t('saved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card pad stack">
      <div className="row">
        <h2>{t('s14_needTitle')}</h2>
        {!!state?.waiting && <a className="chip warn num" href={href('entries')}>{t('s14_needWaiting', { n: i18n.int(state.waiting) })}</a>}
        <span className="spacer" />
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={!!state?.on} disabled={busy || !state} onChange={(e) => void set(e.target.checked)} />
          {t('active')}
        </label>
      </div>
      <p className="muted" style={{ margin: 0 }}>{t('s14_needHelp')}</p>
      <ErrorBox error={error} />
    </div>
  );
}

/** May the person signed in approve vouchers? (the entries.approve permission: the Approver role, and every admin) */
export function useMayApprove(): boolean {
  return !!useData().permissions?.includes('entries.approve');
}

/** Approve and Reject for a voucher that waits; Reject asks for the reason first. */
export function ApprovalButtons({ id, small = false, onDone }: { id: string; small?: boolean; onDone(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { reloadAccounts } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const size = small ? ' small' : '';

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reloadAccounts();
      toast(message);
      setRejecting(false);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    // (in a list the row itself opens the voucher: a click on these stays here)
    <span style={{ display: 'contents' }} onClick={(e) => e.stopPropagation()}>
      <button type="button" className={'btn primary' + size} disabled={busy} onClick={() => void run(() => api.approveWaiting(id), t('a_approve'))}>
        <Icon name="check" size={small ? 15 : 16} />{t('s14_approve')}
      </button>
      <button type="button" className={'btn danger' + size} disabled={busy} onClick={() => { setError(null); setReason(''); setRejecting(true); }}>{t('s14_reject')}</button>
      {!rejecting && <ErrorBox error={error} />}
      {rejecting && (
        <Modal title={t('s14_rejectTitle')} onClose={() => setRejecting(false)}>
          <div className="stack">
            <p style={{ margin: 0 }}>{t('s14_rejectHelp')}</p>
            <label className="field">
              <span>{t('s14_rejectReason')}</span>
              <textarea className="input" rows={3} maxLength={MAX_REJECT_REASON} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </label>
            <ErrorBox error={error} />
            <div className="row">
              <button type="button" className="btn danger" disabled={busy || !reason.trim()} onClick={() => void run(() => api.rejectEntry(id, reason.trim()), t('s14_rejectedToast'))}>{t('s14_reject')}</button>
              <button type="button" className="btn" onClick={() => setRejecting(false)}>{t('cancel')}</button>
            </div>
          </div>
        </Modal>
      )}
    </span>
  );
}
