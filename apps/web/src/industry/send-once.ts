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
 */
export const HOLD_MS = 10 * 60_000;
const held = new Map<string, { key: string; at: number }>();

export async function sendOnce<T>(method: 'POST', url: string, body: unknown, make: () => string = newIdempotencyKey, clock: () => number = Date.now): Promise<T> {
  const of = documentText([method, url, body]);
  const now = clock();
  for (const [text, h] of held) if (now - h.at >= HOLD_MS) held.delete(text);
  const key = held.get(of)?.key ?? make();
  held.set(of, { key, at: now });
  try {
    const answer = await request<T>(method, url, body, { key });
    held.delete(of);
    return answer;
  } catch (e) {
    // a definite no lets the key go; a lost answer keeps it, from now
    if (!isNetworkError(e)) held.delete(of);
    else if (held.get(of)?.key === key) held.set(of, { key, at: clock() });
    throw e;
  }
}

/** For tests: the keys held now. */
export const heldOnceKeys = (): number => held.size;
