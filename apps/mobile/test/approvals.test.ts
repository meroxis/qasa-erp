import { describe, expect, it } from 'vitest';
import { OfficeError } from '../src/api';
import { LinkError, OfficeLink } from '../src/link';
import { ownerApi, type EntrySummary } from '../src/owner/api';
import { ActionKeys, approvalsCard, approvalTabs, buttonsFor, kindKey, photoToShow, reasonOk, seenOf, sendAction, toCheck, waitingSections } from '../src/owner/approvals';
import { generateKeyPair } from '../src/protocol';
import type { Me } from '../src/roles';
import { staffApi } from '../src/staff/api';
import { UUID_V4 } from '../src/uuid';
import { fakeOffice } from './fake-office';

// Approving vouchers from the phone (phone app 1.1): what each user gets, which buttons an entry shows, the home card's
// number, and an action sent again with its own key after a lost answer.

const user = (permissions: string[], extra: Partial<NonNullable<Me['user']>> = {}, separateDuties = false): Me =>
  ({ signInRequired: true, separateDuties, user: { id: 'u-raz', name: 'Raz', roles: ['approver'], permissions, ...extra } });
const OWNER: Me = { signInRequired: false, user: null };

const entry = (over: Partial<EntrySummary> = {}): EntrySummary => ({
  id: 'e-1', type: 'receipt', number: null, date: '2026-11-15', description: 'Received', party: 'North Market', currency: 'IQD', rateX100: 100,
  status: 'draft', cashAccountCode: '1811', preparedBy: 'Las', preparedById: 'u-las', preparedAt: '2026-11-15T08:00:00.000Z', checkedBy: null,
  approvedBy: null, total: 10_000, baseTotal: 10_000, approval: null, ...over
});

describe('the receipt photo of an expense on the approval screen', () => {
  it('asks the office for it only when the office says the voucher has one, of a size the office takes', () => {
    const meta = { bytes: 182_331, createdBy: 'Las', createdAt: '2026-11-15T08:00:01Z' };
    expect(photoToShow({ id: 'e-1', image: meta })).toEqual({ id: 'e-1', by: 'Las', key: 'e-1|2026-11-15T08:00:01Z' });
    // none, an office before phone app 1.1 (no field), or something that is not a photo's size
    expect(photoToShow({ id: 'e-1', image: null })).toBeNull();
    expect(photoToShow({ id: 'e-1' })).toBeNull();
    for (const bytes of [0, -1, 1.5, 600 * 1024, Number.NaN]) expect(photoToShow({ id: 'e-1', image: { ...meta, bytes } }), String(bytes)).toBeNull();
  });

  it('shows the office\'s photo only when it is a JPEG in base64 (anything else is not shown)', async () => {
    const answers: { s: number; b: unknown }[] = [
      { s: 200, b: { mime: 'image/jpeg', data: '/9j/4AAQSkZJRg==' } },
      { s: 200, b: { mime: 'image/svg+xml', data: 'PHN2Zz4=' } },
      { s: 200, b: { mime: 'image/jpeg', data: 'not base64 <script>' } },
      { s: 404, b: { error: 'not_found', details: null } }
    ];
    const paths: string[] = [];
    const link = { request: async (_m: string, p: string) => { paths.push(p); return answers.shift()!; } } as unknown as OfficeLink;
    const api = staffApi(link);
    expect(await api.entryImage('e-1')).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    expect(await api.entryImage('e-1')).toBeNull();
    expect(await api.entryImage('e-1')).toBeNull();
    expect(await api.entryImage('e-1')).toBeNull();
    expect(paths).toEqual(Array(4).fill('/api/entries/e-1/image'));
    await expect(api.entryImage('../users')).rejects.toThrow(OfficeError);
  });
});

describe('what the approvals screen shows', () => {
  it('waiting for approval to who approves, to check to who checks, both to the owner and an admin', () => {
    expect(approvalTabs(user(['entries.approve']))).toEqual(['waiting']);
    expect(approvalTabs(user(['entries.check']))).toEqual(['check']);
    expect(approvalTabs(user(['entries.check', 'entries.approve']))).toEqual(['waiting', 'check']);
    expect(approvalTabs(user(['admin']))).toEqual(['waiting', 'check']);
    expect(approvalTabs(OWNER)).toEqual(['waiting', 'check']);
    expect(approvalTabs(user(['sales', 'entries.prepare']))).toEqual([]);
    expect(approvalTabs(null)).toEqual([]);
  });

  it('lists to check only the drafts that wait for nobody else (not waiting for approval, not rejected)', () => {
    const drafts = [entry({ id: 'a' }), entry({ id: 'b', approval: { state: 'waiting', requestedBy: 'Las', requestedAt: '', decidedBy: null, decidedAt: null, reason: null } }),
      entry({ id: 'c', approval: { state: 'rejected', requestedBy: 'Las', requestedAt: '', decidedBy: 'Raz', decidedAt: '', reason: 'No' } }), entry({ id: 'd' })];
    expect(toCheck(drafts).map((e) => e.id)).toEqual(['a', 'd']);
    // waiting for approval, in the desktop's two parts: sent for approval, then checked; a part with nothing is left out
    const sent = [entry({ id: 's' })];
    const checked = [entry({ id: 'c', status: 'checked' })];
    expect(waitingSections(sent, checked).map((s) => [s.title, s.entries.map((e) => e.id)])).toEqual([['aprSentGroup', ['s']], ['aprCheckedGroup', ['c']]]);
    expect(waitingSections([], checked).map((s) => s.title)).toEqual(['aprCheckedGroup']);
    expect(waitingSections([], [])).toEqual([]);
    // a checked voucher that also waits for approval is in both of the office's lists: shown once, with the checked
    const waits = { state: 'waiting' as const, requestedBy: 'Las', requestedAt: '', decidedBy: null, decidedAt: null, reason: null };
    const both = entry({ id: 'w', status: 'checked', approval: waits });
    const parts = waitingSections([entry({ id: 's', approval: waits }), both], [both, entry({ id: 'c', status: 'checked' })]);
    expect(parts.map((s) => [s.title, s.entries.map((e) => e.id)])).toEqual([['aprSentGroup', ['s']], ['aprCheckedGroup', ['w', 'c']]]);
    // one checked between the two lists' answers (in the first as checked, not yet in the second): once, with the checked
    expect(waitingSections([both], []).map((s) => [s.title, s.entries.map((e) => e.id)])).toEqual([['aprCheckedGroup', ['w']]]);
    const ids = parts.flatMap((s) => s.entries.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(kindKey('receipt')).toBe('kindReceipt');
    expect(kindKey('payment')).toBe('aprPayment');
    expect(kindKey('journal')).toBe('aprJournal');
    expect(kindKey('reversal')).toBe('aprEntry');
  });

  it('shows the buttons of the office\'s own actions only, approval first', () => {
    const labels = (actions: string[], me: Me | null = user(['admin'])) => buttonsFor({ actions, preparedById: 'u-las' }, me).buttons.map((b) => b.action);
    expect(labels(['edit', 'delete', 'approve_waiting', 'reject'])).toEqual(['approve-waiting', 'reject']);
    expect(labels(['return', 'approve'])).toEqual(['approve', 'return']);
    expect(labels(['edit', 'delete', 'check'])).toEqual(['check']);
    // what stays on the PC: changing, deleting, reversing
    expect(labels(['edit', 'delete', 'reverse'])).toEqual([]);
    const approve = buttonsFor({ actions: ['approve_waiting'], preparedById: 'u-las' }, user(['admin'])).buttons[0]!;
    expect(approve).toMatchObject({ label: 'aprApprove', confirm: 'aprApproveConfirm', done: 'aprApproved' });
    // a checked entry is approved with the desktop's word for it
    expect(buttonsFor({ actions: ['approve'], preparedById: 'u-las' }, user(['admin'])).buttons[0]).toMatchObject({ label: 'aprApproveChecked', confirm: 'aprApproveConfirm' });
    expect(buttonsFor({ actions: ['return'], preparedById: 'u-las' }, user(['admin'])).buttons[0]).toMatchObject({ confirm: 'aprReturnConfirm' });
  });

  it('under separate duties shows no Check or Approve on the user\'s own voucher, and says why', () => {
    const own = { actions: ['approve_waiting', 'reject'], preparedById: 'u-raz' };
    expect(buttonsFor(own, user(['entries.approve'], {}, true))).toEqual({ buttons: [expect.objectContaining({ action: 'reject' })], samePerson: true });
    expect(buttonsFor({ actions: ['check'], preparedById: 'u-raz' }, user(['entries.check'], {}, true))).toEqual({ buttons: [], samePerson: true });
    expect(buttonsFor({ actions: ['return', 'approve'], preparedById: 'u-raz' }, user(['admin'], {}, true)).buttons.map((b) => b.action)).toEqual(['return']);
    // someone else's, or separate duties off: as the office says
    expect(buttonsFor({ ...own, preparedById: 'u-las' }, user(['entries.approve'], {}, true)).samePerson).toBe(false);
    expect(buttonsFor(own, user(['entries.approve'], {}, false))).toMatchObject({ buttons: [{ action: 'approve-waiting' }, { action: 'reject' }], samePerson: false });
    // nothing taken away: nothing to say
    expect(buttonsFor({ actions: ['reject'], preparedById: 'u-raz' }, user(['entries.approve'], {}, true)).samePerson).toBe(false);
  });

  it('takes a reason for a rejection of 1 to 300 characters', () => {
    expect(reasonOk('Wrong customer')).toBe(true);
    expect(reasonOk('   ')).toBe(false);
    expect(reasonOk('')).toBe(false);
    expect(reasonOk('x'.repeat(300))).toBe(true);
    expect(reasonOk('x'.repeat(301))).toBe(false);
  });
});

describe('the home screen\'s approvals card', () => {
  const brief = (waitingCheck: number, waitingApproval: number) => ({ approvals: { waitingCheck, waitingApproval } });
  // the office's own count of everything an approver has to approve, each entry once (toApprove)
  const state = (waiting: number, toApprove = waiting) => ({ on: true, waiting, mayApprove: true, toApprove });
  // an office before 1.5: no toApprove
  const older = (waiting: number) => ({ on: true, waiting, mayApprove: true });

  it('numbers what waits for an approver of the whole company: sent for approval and checked, each once', () => {
    expect(approvalsCard(user(['entries.approve']), state(2, 5), brief(7, 3))).toEqual({ show: true, count: 5 });
    expect(approvalsCard(OWNER, state(1), brief(0, 0))).toEqual({ show: true, count: 1 });
  });

  it('counts a checked voucher that also waits for approval once: the office\'s number, not the two counts added', () => {
    // one voucher, checked and waiting: in the vouchers that wait (1) and in the checked entries (1), one to approve
    expect(approvalsCard(user(['entries.approve']), state(1, 1), brief(0, 1))).toEqual({ show: true, count: 1 });
    expect(approvalsCard(OWNER, state(2, 3), brief(0, 2))).toEqual({ show: true, count: 3 });
    // an office before 1.5 counts no toApprove: the card without a number while anything waits
    expect(approvalsCard(user(['entries.approve']), older(1), brief(0, 1))).toEqual({ show: true, count: null });
    expect(approvalsCard(user(['entries.approve']), older(0), brief(0, 0))).toEqual({ show: false, count: null });
    // a number that is not one is not shown
    expect(approvalsCard(OWNER, { on: true, waiting: 1, mayApprove: true, toApprove: -1 }, brief(0, 0))).toEqual({ show: true, count: null });
  });

  it('shows no number where the counts and the list could disagree: a user limited to branches, or one who checks', () => {
    expect(approvalsCard(user(['entries.approve'], { branchLimited: true }), state(2), brief(0, 3))).toEqual({ show: true, count: null });
    expect(approvalsCard(user(['entries.check']), state(2), brief(4, 3))).toEqual({ show: true, count: null });
    // an approver with nothing to approve but something to check (an admin)
    expect(approvalsCard(user(['admin']), state(0), brief(4, 0))).toEqual({ show: true, count: null });
  });

  it('is not shown when nothing waits for this user', () => {
    expect(approvalsCard(user(['entries.approve']), state(0), brief(4, 0))).toEqual({ show: false, count: null });
    expect(approvalsCard(user(['entries.approve']), state(0, 0), brief(0, 0))).toEqual({ show: false, count: null });
    expect(approvalsCard(user(['entries.check']), state(3), brief(0, 2))).toEqual({ show: false, count: null });
    expect(approvalsCard(user(['entries.approve']), null, null)).toEqual({ show: false, count: null });
    expect(approvalsCard(null, state(3), brief(3, 3))).toEqual({ show: false, count: null });
  });
});

describe('an action sent from the phone', () => {
  const shown = entry({ id: 'e-7', preparedAt: '2026-11-15T09:30:00.000Z' });

  it('goes with what the phone showed (seen) and one key, the same on every try until it is done', async () => {
    const calls: { id: string; action: string; body: unknown; key: string }[] = [];
    const answers: (() => Promise<object>)[] = [
      () => Promise.reject(new LinkError('timeout')),
      () => Promise.resolve({ id: 'e-7', number: 'RV-2026-0004', status: 'approved' })
    ];
    const api = { entryAction: (id: string, action: string, body: unknown, key: string) => { calls.push({ id, action, body, key }); return answers.shift()!(); } };
    const keys = new ActionKeys();
    // the answer is lost: kept for the next try
    expect(await sendAction(api, keys, shown, 'approve-waiting')).toMatchObject({ kind: 'lost' });
    // tapped again: the same key, so the office answers with the first answer, not "not allowed"
    expect(await sendAction(api, keys, shown, 'approve-waiting')).toEqual({ kind: 'done', entry: { id: 'e-7', number: 'RV-2026-0004', status: 'approved' } });
    expect(calls.map((c) => c.key)).toEqual([calls[0]!.key, calls[0]!.key]);
    expect(calls[0]!.key).toMatch(UUID_V4);
    expect(calls[0]!.body).toEqual({ seen: '2026-11-15T09:30:00.000Z' });
    // done: the next action is a new one
    expect(keys.keyFor('e-7', 'approve-waiting', shown.preparedAt)).not.toBe(calls[0]!.key);
  });

  it('waits out "still making the first try" with the same key, and sends a rejection\'s reason', async () => {
    const keysSeen: string[] = [];
    const bodies: unknown[] = [];
    let n = 0;
    const api = {
      entryAction: async (_id: string, _a: string, body: unknown, key: string) => {
        keysSeen.push(key);
        bodies.push(body);
        if (n++ < 2) throw new OfficeError(409, 'in_progress', null);
        return { id: 'e-7', status: 'draft' as const };
      }
    };
    const out = await sendAction(api, new ActionKeys(), shown, 'reject', 'Wrong customer', { waitMs: 1 });
    expect(out).toEqual({ kind: 'done', entry: { id: 'e-7', status: 'draft' } });
    expect(bodies).toEqual(Array(3).fill({ seen: shown.preparedAt, reason: 'Wrong customer' }));
    expect(new Set(keysSeen).size).toBe(1);
    expect(keysSeen).toHaveLength(3);
    // still busy after every try: no answer yet, the key kept
    const busy = { entryAction: async () => { throw new OfficeError(409, 'in_progress', null); } };
    const keys = new ActionKeys(() => 'k-1');
    expect(await sendAction(busy, keys, shown, 'check', undefined, { tries: 2, waitMs: 1 })).toMatchObject({ kind: 'lost' });
    expect(keys.keyFor('e-7', 'check', shown.preparedAt)).toBe('k-1');
  });

  it('says "changed since you opened it", "already dealt with" or the refusal, and forgets the key', async () => {
    const refusing = (error: OfficeError) => ({ entryAction: async () => { throw error; } });
    let made = 0;
    const keys = new ActionKeys(() => `k-${++made}`);
    expect(await sendAction(refusing(new OfficeError(409, 'entry_changed', null)), keys, shown, 'approve')).toEqual({ kind: 'changed' });
    expect(await sendAction(refusing(new OfficeError(409, 'action_not_allowed', { status: 'approved' })), keys, shown, 'approve')).toEqual({ kind: 'taken' });
    expect(await sendAction(refusing(new OfficeError(404, 'not_found', null)), keys, shown, 'approve')).toEqual({ kind: 'taken' });
    const refusal = new OfficeError(409, 'same_person', null);
    expect(await sendAction(refusing(refusal), keys, shown, 'approve')).toEqual({ kind: 'refused', error: refusal });
    // each refusal ended its action: four tries, four keys
    expect(made).toBe(4);
    // a key is for one action on one entry as it was seen
    keys.clear();
    const a = keys.keyFor('e-7', 'approve', 'v1');
    expect(keys.keyFor('e-7', 'approve', 'v1')).toBe(a);
    expect(keys.keyFor('e-7', 'approve', 'v2')).not.toBe(a);
    expect(keys.keyFor('e-7', 'return', 'v1')).not.toBe(a);
  });

  it('sends the revision as `seen` from an office that keeps it, so two changes in one millisecond still differ', async () => {
    const at = '2026-11-15T09:30:00.000Z';
    expect(seenOf({ preparedAt: at, revision: 0 })).toBe('r0');
    expect(seenOf({ preparedAt: at, revision: 7 })).toBe('r7');
    // an office before 1.5 (no revision), or one that is not a number: its preparedAt, as before
    expect(seenOf({ preparedAt: at })).toBe(at);
    for (const revision of [-1, 1.5, Number.NaN]) expect(seenOf({ preparedAt: at, revision }), String(revision)).toBe(at);
    const bodies: unknown[] = [];
    const keys: string[] = [];
    const api = { entryAction: async (_id: string, _a: string, body: unknown, key: string) => { bodies.push(body); keys.push(key); return { id: 'e-7', status: 'approved' as const }; } };
    const ak = new ActionKeys();
    // the same preparedAt, two revisions: two different actions with two keys
    await sendAction(api, ak, entry({ id: 'e-7', preparedAt: at, revision: 1 }), 'approve-waiting');
    await sendAction(api, ak, entry({ id: 'e-7', preparedAt: at, revision: 2 }), 'reject', 'Wrong amount');
    expect(bodies).toEqual([{ seen: 'r1' }, { seen: 'r2', reason: 'Wrong amount' }]);
    expect(new Set(keys).size).toBe(2);
  });

  it('reaches the office with its key and `seen` through the phone\'s own link', async () => {
    let first = true;
    const o = fakeOffice({
      reply: (m) => {
        if (m.m !== 'POST') return { s: 200, b: [] };
        // the office is still busy with the first try when the second arrives
        if (first) { first = false; return { s: 409, b: { error: 'in_progress', details: null } }; }
        return { s: 200, b: { id: 'e-7', number: 'RV-2026-0004', status: 'approved' } };
      }
    });
    const link = new OfficeLink({ office: o.office, phone: generateKeyPair(), name: 'Raz phone', socket: o.socket, reconnect: false });
    const out = await sendAction(ownerApi(link), new ActionKeys(), shown, 'approve-waiting', undefined, { waitMs: 1 });
    expect(out).toMatchObject({ kind: 'done', entry: { status: 'approved' } });
    const posts = o.seen.filter((m) => m.m === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts.map((m) => [m.p, m.b, m.k])).toEqual([
      ['/api/entries/e-7/approve-waiting', { seen: shown.preparedAt }, posts[0]!.k],
      ['/api/entries/e-7/approve-waiting', { seen: shown.preparedAt }, posts[0]!.k]
    ]);
    expect(String(posts[0]!.k)).toMatch(UUID_V4);
    link.close();
  });
});
