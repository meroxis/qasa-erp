import { OfficeError } from '../answers';
import type { Brief } from '../api';
import type { Key } from '../i18n';
import type { Me } from '../roles';
import { uuidV4 } from '../uuid';
import type { ApprovalState, EntryAction, EntrySummary, EntryView } from './api';

/**
 * Approving vouchers from the phone (phone app 1.1): what this user gets of the office's approvals, which buttons an
 * entry shows (the office's own list of what the user may do with it), and sending an action so that a lost answer
 * never turns into a second, different action. The office decides every action again (its permissions, separate
 * duties, the period lock, the entry's state, and whether the entry is still what the phone showed).
 */

export type ApprovalTab = 'waiting' | 'check';

const isOwner = (me: Me) => !me.signInRequired || !me.user;
const may = (me: Me, permission: string) => isOwner(me) || me.user!.permissions.includes(permission) || me.user!.permissions.includes('admin');

/** "Waiting for approval" for someone who approves vouchers, "To check" for someone who checks them; both for some. */
export function approvalTabs(me: Me | null): ApprovalTab[] {
  if (!me) return [];
  return [...(may(me, 'entries.approve') ? ['waiting' as const] : []), ...(may(me, 'entries.check') ? ['check' as const] : [])];
}

/** To check: the drafts, without those that wait for approval or were rejected (an approver's, or back with their preparer). */
export const toCheck = (drafts: readonly EntrySummary[]): EntrySummary[] => drafts.filter((e) => e.approval?.state !== 'waiting' && e.approval?.state !== 'rejected');

/**
 * "Waiting for approval" in its two parts, as the desktop has them: sent for approval, and checked waiting to be approved
 * (empty parts left out). Each entry shows once: a checked voucher that also waits for approval is in both of the
 * office's lists, and shows with the checked ones (as one checked between the two lists' answers does).
 */
export function waitingSections(sent: readonly EntrySummary[], checked: readonly EntrySummary[]): { title: Key; entries: readonly EntrySummary[] }[] {
  const inChecked = new Set(checked.map((e) => e.id));
  const drafts = sent.filter((e) => e.status !== 'checked' && !inChecked.has(e.id));
  const moved = sent.filter((e) => e.status === 'checked' && !inChecked.has(e.id));
  return ([{ title: 'aprSentGroup', entries: drafts }, { title: 'aprCheckedGroup', entries: [...checked, ...moved] }] as const).filter((s) => s.entries.length > 0);
}

/** The word for an entry's kind in a list. */
export function kindKey(type: string): Key {
  return type === 'receipt' ? 'kindReceipt' : type === 'payment' ? 'aprPayment' : type === 'journal' ? 'aprJournal' : 'aprEntry';
}

export interface ApprovalButton {
  action: EntryAction;
  label: Key;
  /** asked first (posting can only be undone with a reversal; a return sends it back) */
  confirm?: Key;
  /** said when done */
  done: Key;
  kind: 'primary' | 'secondary' | 'danger';
}

/** The office's action names (EntryView.actions) and how the phone shows each; the rest (edit, delete, reverse) stay on the PC. */
const BUTTONS: readonly (readonly [string, ApprovalButton])[] = [
  ['approve_waiting', { action: 'approve-waiting', label: 'aprApprove', confirm: 'aprApproveConfirm', done: 'aprApproved', kind: 'primary' }],
  ['approve', { action: 'approve', label: 'aprApproveChecked', confirm: 'aprApproveConfirm', done: 'aprApproved', kind: 'primary' }],
  ['check', { action: 'check', label: 'aprCheck', done: 'aprChecked', kind: 'primary' }],
  ['return', { action: 'return', label: 'aprReturn', confirm: 'aprReturnConfirm', done: 'aprReturned', kind: 'secondary' }],
  ['reject', { action: 'reject', label: 'aprReject', done: 'aprRejected', kind: 'danger' }]
];
/** What separate duties keep from whoever prepared the voucher. */
const NOT_ONE_S_OWN: readonly EntryAction[] = ['approve-waiting', 'approve', 'check'];

/**
 * The buttons for an entry: only what the office says this user may do with it now. Under separate duties a voucher of
 * the user's own shows no Check or Approve (the office would refuse them, same_person): `samePerson` says why.
 */
export function buttonsFor(entry: Pick<EntryView, 'actions' | 'preparedById'>, me: Me | null): { buttons: ApprovalButton[]; samePerson: boolean } {
  const all = BUTTONS.filter(([name]) => entry.actions.includes(name)).map(([, b]) => b);
  const own = !!me?.separateDuties && !!entry.preparedById && entry.preparedById === me.user?.id;
  if (!own) return { buttons: all, samePerson: false };
  const buttons = all.filter((b) => !NOT_ONE_S_OWN.includes(b.action));
  return { buttons, samePerson: buttons.length < all.length };
}

/**
 * Home's approvals card. The number is the office's own count of everything an approver has to approve, each entry once
 * (GET /api/voucher-approval, toApprove: the vouchers that wait and the entries checked, so a checked voucher that also
 * waits is not counted twice). It is the whole company's, while the lists are the user's branches', and the brief's
 * drafts include the vouchers that wait or were rejected: the number shows only for an approver who is not limited to
 * branches, and only from an office that counts it (one before 1.5 shows the card without a number), so the list never
 * says less than the card. Anyone else of the approvals gets the card without a number while something may wait for
 * them; nothing waits for anyone: no card.
 */
export function approvalsCard(me: Me | null, state: ApprovalState | null | undefined, brief: Pick<Brief, 'approvals'> | null | undefined): { show: boolean; count: number | null } {
  if (!me) return { show: false, count: null };
  const approves = may(me, 'entries.approve');
  const checks = may(me, 'entries.check');
  // one source for the number: the office's toApprove; without it (an older office) only whether anything waits
  const counted = typeof state?.toApprove === 'number' && Number.isSafeInteger(state.toApprove) && state.toApprove >= 0 ? state.toApprove : null;
  const waiting = counted ?? Math.max(state?.waiting ?? 0, brief?.approvals.waitingApproval ?? 0);
  const drafts = brief?.approvals.waitingCheck ?? 0;
  if (approves && !me.user?.branchLimited && counted !== null && counted > 0) return { show: true, count: counted };
  const something = (approves ? waiting : 0) + (checks ? drafts : 0);
  return { show: something > 0, count: null };
}

/**
 * One key per action (the office makes an action once per key): made when the user confirms it, and the same on every
 * try of that action on that entry as it was seen, until it is done, refused, or the entry is loaded again. A new key
 * per tap would turn a lost answer into a refusal ("not allowed": it went through the first time).
 */
export class ActionKeys {
  private readonly keys = new Map<string, string>();
  constructor(private readonly make: () => string = uuidV4) {}
  keyFor(id: string, action: EntryAction, seen: string): string {
    const k = `${id}|${action}|${seen}`;
    let key = this.keys.get(k);
    if (!key) {
      key = this.make();
      this.keys.set(k, key);
    }
    return key;
  }
  forget(id: string, action: EntryAction, seen: string): void {
    this.keys.delete(`${id}|${action}|${seen}`);
  }
  clear(): void {
    this.keys.clear();
  }
}

export type ActionOutcome =
  /** the office did it (the entry as it is now: the whole of it, or its id, number and status when sent again) */
  | { kind: 'done'; entry: Partial<EntryView> }
  /** changed since the phone showed it (entry_changed): look at it again */
  | { kind: 'changed' }
  /** no longer in that state, or gone (someone dealt with it): the list is loaded again */
  | { kind: 'taken' }
  /** refused for another reason: said, and a new try is a new action */
  | { kind: 'refused'; error: unknown }
  /** no answer (the link, or the office still busy with the first try): the same key goes with the next try */
  | { kind: 'lost'; error: unknown };

/**
 * The entry as the phone shows it, sent back as `seen` with every action on it: "r<revision>" from an office that keeps
 * the revision (1.5 on: one up with every change, so two changes in the same millisecond still differ), else its
 * preparedAt, the field's first form.
 */
export function seenOf(entry: Pick<EntrySummary, 'preparedAt' | 'revision'>): string {
  const r = entry.revision;
  return typeof r === 'number' && Number.isSafeInteger(r) && r >= 0 ? `r${r}` : entry.preparedAt;
}

/**
 * Sends an action on an entry with `seen` (seenOf: the entry as shown) and its own key; the office's answer that it is still
 * making the first try (in_progress) is waited out a few times with the same key.
 */
export async function sendAction(
  api: { entryAction(id: string, action: EntryAction, body: { seen: string; reason?: string }, key: string): Promise<Partial<EntryView>> },
  keys: ActionKeys,
  entry: Pick<EntrySummary, 'id' | 'preparedAt' | 'revision'>,
  action: EntryAction,
  reason?: string,
  options: { tries?: number; waitMs?: number } = {}
): Promise<ActionOutcome> {
  const seen = seenOf(entry);
  const key = keys.keyFor(entry.id, action, seen);
  const body = action === 'reject' ? { seen, reason: reason ?? '' } : { seen };
  const tries = options.tries ?? 3;
  for (let attempt = 1; ; attempt++) {
    try {
      const answer = await api.entryAction(entry.id, action, body, key);
      keys.forget(entry.id, action, seen);
      return { kind: 'done', entry: answer };
    } catch (error) {
      if (!(error instanceof OfficeError)) return { kind: 'lost', error };
      if (error.code === 'in_progress') {
        if (attempt >= tries) return { kind: 'lost', error };
        await new Promise((r) => setTimeout(r, options.waitMs ?? 1500));
        continue;
      }
      keys.forget(entry.id, action, seen);
      if (error.code === 'entry_changed') return { kind: 'changed' };
      if (error.code === 'action_not_allowed' || error.code === 'not_found') return { kind: 'taken' };
      return { kind: 'refused', error };
    }
  }
}

/** A reason for a rejection: 1 to 300 characters, as the office takes it. */
export const MAX_REASON = 300;
export const reasonOk = (text: string) => text.trim().length > 0 && text.length <= MAX_REASON;

/**
 * The receipt photo an entry's screen asks the office for: only when the office says the voucher has one (an office
 * before phone app 1.1 never does), and only a photo of a sane size (the office takes at most 400 KB).
 */
export function photoToShow(entry: Pick<EntryView, 'id' | 'image'>): { id: string; by: string; key: string } | null {
  const image = entry.image;
  if (!image || typeof image !== 'object' || !Number.isSafeInteger(image.bytes) || image.bytes <= 0 || image.bytes > 512 * 1024) return null;
  return { id: entry.id, by: typeof image.createdBy === 'string' ? image.createdBy : '', key: `${entry.id}|${image.createdAt}` };
}
