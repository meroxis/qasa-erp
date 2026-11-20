import { isNetworkError, newIdempotencyKey, request } from '../api.ts';
import { documentText } from './outbox.ts';

/**
 * Keys held for documents sent and not yet answered: the same document sent again (a second tap, a retry after the
 * link dropped) goes with the same key, so the server makes it once and answers the retry with the first one.
 * The key is let go once the server answered, yes or no; a lost answer keeps it for the retry.
 */
const held = new Map<string, string>();

export async function sendOnce<T>(method: 'POST', url: string, body: unknown, make: () => string = newIdempotencyKey): Promise<T> {
  const of = documentText([method, url, body]);
  const key = held.get(of) ?? make();
  held.set(of, key);
  try {
    const answer = await request<T>(method, url, body, { key });
    held.delete(of);
    return answer;
  } catch (e) {
    if (!isNetworkError(e)) held.delete(of);
    throw e;
  }
}

/** For tests: the keys held now. */
export const heldOnceKeys = (): number => held.size;
