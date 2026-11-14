import { useI18n } from '../i18n.ts';

/** Where a receipt that a document made stands (1.4.1): waiting for approval, or rejected; the server sends null once approved. */
export type ReceiptApprovalState = 'waiting' | 'rejected' | null;

export interface ApprovalOf { approval?: ReceiptApprovalState | undefined; rejectedBy?: string | null | undefined; reason?: string | null | undefined }

/**
 * The chip beside a document's receipt (an installment, a job's deposit, a unit's deposit, a generator collection):
 * "Collected, waiting for approval", or "Rejected" with who rejected it and why. Nothing for an approved one.
 */
export function ReceiptApproval({ of }: { of: ApprovalOf }) {
  const { t } = useI18n();
  if (of.approval === 'waiting') return <span className="chip warn">{t('da_waiting')}</span>;
  if (of.approval !== 'rejected') return null;
  return (
    <>
      <span className="chip bad">{t('s14_rejected')}</span>
      {of.reason && <span className="small muted" style={{ display: 'block' }}>{t('s14_rejectedNote', { u: of.rejectedBy ?? '', r: of.reason })}</span>}
    </>
  );
}

/** After a document's receipt is made: the usual message, or (waiting for approval) that it counts once approved. */
export const receiptDoneText = (t: ReturnType<typeof useI18n>['t'], made: ApprovalOf | undefined, usual: string): string =>
  made?.approval === 'waiting' ? t('da_savedWaiting') : usual;
