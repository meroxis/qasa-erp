import type { ErrorText } from '../explain';

/**
 * The office's refusals of what phone app 1.1 does for the owner and the managers, in the user's words (explain.ts):
 * keyed by the office's error code or by a `details[].code` of a 400 validation answer. Two answers are explained by
 * their screens only, where the words are true: an approval of a voucher no longer in that state (action_not_allowed,
 * screens/owner/approvals.tsx: "already dealt with, the list is up to date") and a rate out of range (rate_invalid,
 * screens/owner/rate.tsx); elsewhere the same codes mean other things.
 */
export const OWNER_ERRORS: Record<string, ErrorText> = {
  same_person: { key: 'errSamePerson' },
  period_locked: { key: 'errPeriodLocked', vars: (d) => (typeof d.period === 'string' && /^\d{4}-\d{2}$/.test(d.period) ? { p: d.period } : null) },
  // the voucher was changed after the phone showed it (the office compares `seen`)
  entry_changed: { key: 'aprChanged' },
  reject_reason_required: { key: 'errRejectReason' },
  fx_date_future: { key: 'errFxDateFuture' }
};
