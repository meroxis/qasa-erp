import { OfficeError, ok, q, safeId } from '../answers';
import type { Currency, Money, Names } from '../api';
import type { OfficeLink } from '../link';

/**
 * The office's API for what phone app 1.1 does for the owner and the managers: the vouchers that wait (and acting on
 * them), the dollar rate and the end-of-day close (the dashboard is the brief, in api.ts). The same shapes as the
 * desktop's; the phone link lets each through for the phones whose user may (pro/src/phone/owner-routes.ts).
 */

export type EntryStatus = 'draft' | 'checked' | 'approved';

export interface EntryApproval {
  state: 'waiting' | 'rejected' | 'approved';
  requestedBy: string; requestedAt: string; decidedBy: string | null; decidedAt: string | null;
  /** why it was rejected */
  reason: string | null;
}

/** An entry as the lists give it (GET /api/entries). */
export interface EntrySummary {
  id: string;
  type: string;
  number: string | null;
  date: string;
  description: string;
  party: string | null;
  currency: Currency;
  rateX100: number;
  status: EntryStatus;
  cashAccountCode: string | null;
  preparedBy: string;
  preparedById: string | null;
  /** when it was last prepared (written): what the phone saw, sent back with every action on it by an office without a revision */
  preparedAt: string;
  /**
   * an office of 1.5 on: the entry's revision, one up with every change to it; sent back as `seen` ("r<revision>") with
   * every action, so a change since it was shown is refused even when two came in the same millisecond (approvals.ts seenOf)
   */
  revision?: number | undefined;
  checkedBy: string | null;
  approvedBy: string | null;
  /** in the entry's currency (minor units) */
  total: number;
  /** in dinars */
  baseTotal: number;
  approval: EntryApproval | null;
  /** an office of phone app 1.1 on: the voucher has the photo of its paper receipt (an expense from a phone) */
  hasImage?: boolean | undefined;
}

/** What the office says of a voucher's receipt photo (the photo itself: staffApi.entryImage, a JPEG only). */
export interface EntryImage { bytes: number; createdBy: string; createdAt: string }

export interface EntryLine {
  lineNo: number; accountCode: string; accountName: Names; debit: number; credit: number; baseDebit: number; baseCredit: number;
  description: string; partyId: string | null; partyName: string | null;
}

/** One entry (GET /api/entries/:id): its lines, and what this user may do with it (the office's own list). */
export interface EntryView extends EntrySummary {
  lines: EntryLine[];
  actions: string[];
  /** the photo of its paper receipt, when it has one (an office of phone app 1.1 on; none: null or left out) */
  image?: EntryImage | null | undefined;
}

/**
 * "Vouchers need approval" (GET /api/voucher-approval): on, how many vouchers wait (in the whole company), may this user
 * approve; `toApprove` (an office of 1.5 on): everything an approver has to approve, each entry once (the vouchers that
 * wait and the entries checked, a checked one that also waits counted once).
 */
export interface ApprovalState { on: boolean; waiting: number; toApprove?: number | undefined; mayApprove: boolean }

/** What an action on an entry is called in the office's API. */
export type EntryAction = 'approve-waiting' | 'reject' | 'check' | 'approve' | 'return';

/** The rate on a day (GET /api/fx/rate): the one entered on it or the latest before it, else the company's default. */
export interface RateNow { date: string | null; rateX100: number; source: 'board' | 'default' }

/** A rate on the board (GET /api/fx/rates), newest first; who entered it only for a phone that keeps a PIN. */
export interface RateRow { date: string; rateX100: number; source: string | null; createdBy?: string; createdAt: string }

export type DayMethod = 'cash' | 'bank' | 'card' | 'fib' | 'zaincash' | 'qi' | 'credit' | 'loyalty';

export interface DayRegister {
  shiftId: string; number: string; register: string; openedBy: string; status: 'open' | 'closed';
  sales: Money; count: number; expected: Money; counted: Money | null; difference: Money | null;
}

/** The end-of-day close (GET /api/brief/day-close): what the office sends this phone of it. */
export interface DayClose {
  date: string;
  sales: { gross: number; invoices: number; returns: number; returnsCount: number; net: number };
  methods: { method: DayMethod; amount: number; invoices: number }[];
  registers: DayRegister[];
  /** left out for a phone without the figures, as flow is */
  expenses?: { total: number };
  flow?: { in: number; out: number };
  debts: { collected: number; added: number };
  lowStock: { count: number };
}

export function ownerApi(link: OfficeLink) {
  return {
    voucherApproval: async () => ok(await link.request<ApprovalState>('GET', '/api/voucher-approval')),
    /** what waits for approval, the drafts, or the checked entries (up to the office's 500, newest first) */
    entries: async (which: 'waiting' | 'draft' | 'checked') =>
      ok(await link.request<EntrySummary[]>('GET', '/api/entries' + (which === 'waiting' ? q({ approval: 'waiting' }) : q({ status: which })))),
    entry: async (id: string) => ok(await link.request<EntryView>('GET', `/api/entries/${safeId(id)}`)),
    /**
     * An action on an entry, with `seen` (the entry as shown, approvals.ts seenOf: the office refuses it, 409
     * entry_changed, when it was changed since) and the action's own key, the same on every try (owner/approvals.ts ActionKeys).
     */
    entryAction: async (id: string, action: EntryAction, body: { seen: string; reason?: string }, key: string) =>
      ok(await link.request<Partial<EntryView>>('POST', `/api/entries/${safeId(id)}/${action}`, body, key)),
    rate: async () => ok(await link.request<RateNow>('GET', '/api/fx/rate')),
    /** the rates of the last `days` days (1 to 30) */
    rates: async (days: number) => ok(await link.request<RateRow[]>('GET', '/api/fx/rates' + q({ days: String(Math.min(30, Math.max(1, Math.round(days)))) }))),
    /** today's rate (the office's today), by the owner or an admin; with its own key (a lost answer is sent again with it) */
    setRate: async (body: { rateX100: number; source?: string }, key: string) => ok(await link.request<Partial<RateRow>>('POST', '/api/fx/rates', body, key)),
    /** `mine`: only this user's own registers and their shifts (a phone without a PIN always asks so) */
    dayClose: async (date: string, mine: boolean) =>
      ok(await link.request<DayClose>('GET', '/api/brief/day-close' + q(mine ? { date: dayOf(date), mine: '1' } : { date: dayOf(date) })))
  };
}

/** A date as it goes into a path: YYYY-MM-DD only. */
function dayOf(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new OfficeError(400, 'validation', null);
  return date;
}
