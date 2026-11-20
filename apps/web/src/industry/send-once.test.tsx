import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: { url: string; key: string | undefined }[] = [];
let answer: () => Promise<unknown> = async () => ({ id: 'v1' });
vi.mock('../api.ts', () => ({
  newIdempotencyKey: (() => { let n = 0; return () => `k${++n}`; })(),
  isNetworkError: (e: unknown) => e instanceof TypeError,
  request: async (_m: string, url: string, _b: unknown, o: { key?: string }) => { sent.push({ url, key: o.key }); return answer(); }
}));
const { heldOnceKeys, sendOnce } = await import('./send-once.ts');

describe('a document sent once (reliability review #6)', () => {
  beforeEach(() => { sent.length = 0; answer = async () => ({ id: 'v1' }); });

  it('sends a retry after a lost answer with the same key, and a new document with a new one', async () => {
    answer = async () => { throw new TypeError('Failed to fetch'); };
    await expect(sendOnce('POST', '/api/delivery/orders', { total: 8_000 })).rejects.toThrow();
    expect(heldOnceKeys()).toBe(1);
    answer = async () => ({ id: 'o1' });
    await sendOnce('POST', '/api/delivery/orders', { total: 8_000 });
    await sendOnce('POST', '/api/delivery/orders', { total: 8_000 });
    expect(sent.map((s) => s.key)).toEqual(['k1', 'k1', 'k2']);
    expect(heldOnceKeys()).toBe(0);
  });

  it('lets the key go when the server said no', async () => {
    answer = async () => { throw new Error('pos_shift_closed'); };
    await expect(sendOnce('POST', '/api/pos/shifts/s/gift-vouchers', { amount: 1 })).rejects.toThrow();
    expect(heldOnceKeys()).toBe(0);
  });
});
