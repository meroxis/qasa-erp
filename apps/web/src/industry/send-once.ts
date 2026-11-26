import { isNetworkError, newIdempotencyKey, request } from '../api.ts';
import { documentText } from './outbox.ts';

/**
 * Keys held for documents sent and not yet answered: the same document sent again (a second tap, a retry after the
 * link dropped) goes with the same key, so the server makes it once and answers the retry with the first one.
 *
 * - The key is let go once the server answered, yes or no (the document was made, or it was refused): the same
 *   document entered again after that is a new one (a second collection of the same amount from the same customer is
 *   booked twice, as it should be).
 * - A lost answer keeps the key for the retry, for HOLD_MS from the last try and no longer: a retry comes within
 *   minutes. Held for ever, the key would turn the same document entered hours later (a genuine second one) into a
 *   replay of the first, answered as made and never booked.
 * - A key is held for one document, word for word (the method, the address and the whole body): another body never
 *   goes with it.
 * - The keys held are kept in this tab's session storage too (round four of the review), so a page loaded again after
 *   a lost answer (F5, the window reopened on the same tab, an update of the page) still retries with the same key.
 *   Same rules there: gone on a definite answer, gone after HOLD_MS, gone when the person signs out (a key is the
 *   sender's own). What remains: the same document sent again more than HOLD_MS after a try whose answer was lost goes
 *   with a new key, and is booked a second time if the first try did reach the server (docs/offline-till.md).
 */
export const HOLD_MS = 10 * 60_000;
export const ONCE_STORE = 'qasa.sendOnce';
/** a document longer than this is held in memory only (never a reason to fill the tab's storage) */
const MAX_KEPT_TEXT = 200_000;
const held = new Map<string, { key: string; at: number }>();
let restored = false;

function store(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

/** The keys this tab kept before the page was loaded again: read once, the ones still within HOLD_MS. */
function restore(now: number): void {
  if (restored) return;
  restored = true;
  try {
    const kept = JSON.parse(store()?.getItem(ONCE_STORE) ?? 'null') as unknown;
    if (!Array.isArray(kept)) return;
    for (const row of kept as unknown[]) {
      if (!Array.isArray(row)) continue;
      const [text, key, at] = row as unknown[];
      if (typeof text !== 'string' || typeof key !== 'string' || !key || key.length > 64 || typeof at !== 'number' || !Number.isFinite(at)) continue;
      // (a time in the future is a clock that was set back: not trusted)
      if (at > now || now - at >= HOLD_MS || held.has(text)) continue;
      held.set(text, { key, at });
    }
  } catch { /* nothing kept, or not readable: as if none */ }
}

function keep(): void {
  try {
    const rows = [...held].filter(([text]) => text.length <= MAX_KEPT_TEXT).map(([text, h]) => [text, h.key, h.at]);
    if (rows.length) store()?.setItem(ONCE_STORE, JSON.stringify(rows));
    else store()?.removeItem(ONCE_STORE);
  } catch { /* storage full or closed: the keys stay in memory */ }
}

export async function sendOnce<T>(method: 'POST', url: string, body: unknown, make: () => string = newIdempotencyKey, clock: () => number = Date.now): Promise<T> {
  const of = documentText([method, url, body]);
  const now = clock();
  restore(now);
  for (const [text, h] of held) if (now - h.at >= HOLD_MS) held.delete(text);
  const key = held.get(of)?.key ?? make();
  held.set(of, { key, at: now });
  keep();
  try {
    const answer = await request<T>(method, url, body, { key });
    held.delete(of);
    keep();
    return answer;
  } catch (e) {
    // a definite no lets the key go; a lost answer keeps it, from now
    if (!isNetworkError(e)) held.delete(of);
    else if (held.get(of)?.key === key) held.set(of, { key, at: clock() });
    keep();
    throw e;
  }
}

/** Signing out: the keys held are the person's who sent them, never the next one's at this PC. */
export function forgetOnceKeys(): void {
  held.clear();
  try { store()?.removeItem(ONCE_STORE); } catch { /* none kept */ }
}

/** For tests: the keys held now. */
export const heldOnceKeys = (): number => held.size;
/** For tests: as after the page was loaded again (memory gone, the tab's storage as it is). */
export function reloadOnceKeysForTests(): void { held.clear(); restored = false; }
