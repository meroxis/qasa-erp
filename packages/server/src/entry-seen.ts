import { z } from 'zod';
import { transaction, type Db } from './db.ts';
import { conflict } from './errors.ts';

/**
 * What an approver saw is what is approved (phone app 1.1). A voucher that waits for approval stays its preparer's to
 * change, and a draft stays changeable until it is checked; someone who opened it on a phone and taps Approve a while
 * later would otherwise post whatever it says by then (another amount, account or party). Every change to an entry's
 * lines goes through replaceDraft (journal.ts), which writes the time of the change into prepared_at, so preparedAt is
 * the entry's version.
 *
 * The approval actions (check, approve, return, approve-waiting and reject) take an optional `seen`: the preparedAt of
 * the entry as the asker was shown it. Given and no longer the entry's, the action is refused with 409 entry_changed
 * and nothing changes; the asker looks at it again. The phone link always sends it (pro/src/phone); the desktop sends
 * none and works as before.
 */

/** The body of an approval action, as far as `seen` goes (other fields are the action's own). */
export const seenBody = z.object({ seen: z.string().min(1).max(40).optional() });

/** Refuses the action when the entry changed since the asker saw it (`seen` given). Call inside the action's transaction. */
export function assertSeen(db: Db, id: string, seen?: string): void {
  if (seen === undefined) return;
  const row = db.prepare('SELECT prepared_at FROM entries WHERE id = ?').get(id) as { prepared_at: string } | undefined;
  // an entry that is not there is the action's own answer (not_found)
  if (row && row.prepared_at !== seen) throw conflict('entry_changed');
}

/** An approval action, refused as a whole when the entry changed since it was seen: the check and the action in one transaction. */
export function whenSeen<T>(db: Db, id: string, seen: string | undefined, act: () => T): T {
  return transaction(db, () => {
    assertSeen(db, id, seen);
    return act();
  });
}
