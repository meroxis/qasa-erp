import { beforeEach, describe, expect, it, vi } from 'vitest';

// the tab's session storage (these tests run without a browser)
const tab = new Map<string, string>();
(globalThis as { sessionStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).sessionStorage = {
  getItem: (k) => tab.get(k) ?? null, setItem: (k, v) => { tab.set(k, String(v)); }, removeItem: (k) => { tab.delete(k); }
};

const sent: { url: string; key: string | undefined; body?: unknown }[] = [];
let answer: () => Promise<unknown> = async () => ({ id: 'v1' });
vi.mock('../api.ts', () => ({
  newIdempotencyKey: (() => { let n = 0; return () => `k${++n}`; })(),
  isNetworkError: (e: unknown) => e instanceof TypeError,
  request: async (_m: string, url: string, b: unknown, o: { key?: string }) => { sent.push({ url, key: o.key, body: b }); return answer(); }
}));
const { forgetOnceKeys, heldOnceKeys, reloadOnceKeysForTests, sendOnce, HOLD_MS, ONCE_STORE } = await import('./send-once.ts');

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

  it('sends a gift voucher sale and a till return once: a retry after a lost answer goes with the same key (third review)', async () => {
    const { tillRulesApi } = await import('../pos/rules-api.ts');
    const { posApi } = await import('./pos-api.ts');
    answer = async () => { throw new TypeError('Failed to fetch'); };
    await expect(tillRulesApi.sellVoucher('s1', 25_000)).rejects.toThrow();
    await expect(posApi.giveBack('s1', { invoiceId: 'i1', lines: [{ lineNo: 1, qtyMilli: 1000 }], approvals: ['a1'] })).rejects.toThrow();
    answer = async () => ({ id: 'v1' });
    await tillRulesApi.sellVoucher('s1', 25_000);
    await posApi.giveBack('s1', { invoiceId: 'i1', lines: [{ lineNo: 1, qtyMilli: 1000 }], approvals: ['a1'] });
    const keys = (url: string) => sent.filter((s) => s.url === url).map((s) => s.key);
    expect(new Set(keys('/api/pos/shifts/s1/gift-vouchers')).size).toBe(1);
    expect(keys('/api/pos/shifts/s1/gift-vouchers')).toHaveLength(2);
    expect(new Set(keys('/api/pos/shifts/s1/returns')).size).toBe(1);
    // another voucher, sold after the first was answered, is a new one
    await tillRulesApi.sellVoucher('s1', 25_000);
    expect(new Set(keys('/api/pos/shifts/s1/gift-vouchers')).size).toBe(2);
    expect(heldOnceKeys()).toBe(0);
  });

  it('lets the key go when the server said no', async () => {
    answer = async () => { throw new Error('pos_shift_closed'); };
    await expect(sendOnce('POST', '/api/pos/shifts/s/gift-vouchers', { amount: 1 })).rejects.toThrow();
    expect(heldOnceKeys()).toBe(0);
  });
});

describe('how long a key is held, and for what (verify report, finding 13)', () => {
  /** an office server: makes one document for each key, and answers a key it knows with the first one */
  const server = () => {
    const made = new Map<string, { id: string; body: unknown }>();
    let lose = false;
    return {
      made,
      loseNext: () => { lose = true; },
      answer: async () => {
        const last = sent.at(-1)!;
        if (!made.has(last.key!)) made.set(last.key!, { id: `c${made.size + 1}`, body: last.body });
        if (lose) { lose = false; throw new TypeError('Failed to fetch'); }
        return made.get(last.key!);
      }
    };
  };
  const collect = (amount: number, clock?: () => number) => sendOnce<{ id: string }>('POST', '/api/wholesale/collections', { partyId: 'ali', amount }, undefined, clock);
  beforeEach(() => { sent.length = 0; });

  it('books a second, identical collection made after the first was answered: twice, as it should', async () => {
    const office = server();
    answer = office.answer;
    const first = await collect(50_000);
    const second = await collect(50_000);
    expect(first.id).not.toBe(second.id);
    expect(office.made.size).toBe(2);
    expect(heldOnceKeys()).toBe(0);
  });

  it('books a collection once when its answer was lost and it is sent again', async () => {
    const office = server();
    answer = office.answer;
    office.loseNext();
    await expect(collect(50_000)).rejects.toThrow();
    // the office made it; the rep, told nothing, sends it again: the first one comes back
    const again = await collect(50_000);
    expect(again.id).toBe('c1');
    expect(office.made.size).toBe(1);
    expect(heldOnceKeys()).toBe(0);
    // answered now: the next identical one is a new collection
    expect((await collect(50_000)).id).toBe('c2');
  });

  it('lets a held key go after ten minutes: the same collection entered hours later is a new one, not a replay of the lost one', async () => {
    const office = server();
    answer = office.answer;
    let now = 1_000_000;
    const clock = () => now;
    office.loseNext();
    await expect(collect(50_000, clock)).rejects.toThrow();
    // a retry a few minutes later still goes with the key, and each lost try holds it from then
    now += HOLD_MS - 1;
    office.loseNext();
    await expect(collect(50_000, clock)).rejects.toThrow();
    now += HOLD_MS - 1;
    expect((await collect(50_000, clock)).id).toBe('c1');
    // lost again, and nobody retries; three hours later the customer pays the same amount again
    office.loseNext();
    await expect(collect(50_000, clock)).rejects.toThrow();
    expect(office.made.size).toBe(2);
    now += 3 * 60 * 60_000;
    expect((await collect(50_000, clock)).id).toBe('c3');
    expect(office.made.size).toBe(3);
    expect(heldOnceKeys()).toBe(0);
  });

  it('never sends another body with a held key, and clears the key after a refusal', async () => {
    const office = server();
    answer = office.answer;
    office.loseNext();
    await expect(collect(50_000)).rejects.toThrow();
    // another amount, another customer, another address: each its own key
    await collect(60_000);
    await sendOnce('POST', '/api/wholesale/collections', { partyId: 'sam', amount: 50_000 });
    await sendOnce('POST', '/api/wholesale/handovers', { partyId: 'ali', amount: 50_000 });
    const keys = sent.map((s) => s.key);
    expect(new Set(keys).size).toBe(4);
    for (const [key, doc] of office.made) expect(sent.filter((s) => s.key === key).every((s) => JSON.stringify(s.body) === JSON.stringify(doc.body))).toBe(true);
    // the held one is still there for its retry
    expect(heldOnceKeys()).toBe(1);
    expect((await collect(50_000)).id).toBe('c1');
    // a refusal (a validation error) is an answer: the corrected-and-resent document, and the same one sent again, are new
    answer = async () => { throw new Error('validation'); };
    await expect(collect(70_000)).rejects.toThrow('validation');
    expect(heldOnceKeys()).toBe(0);
    answer = office.answer;
    const before = office.made.size;
    await collect(70_000);
    expect(office.made.size).toBe(before + 1);
    expect(sent.at(-1)!.key).not.toBe(sent.at(-2)!.key);
  });
});

describe('a page loaded again after a lost answer (round four of the review)', () => {
  /** an office server: makes one document for each key, and answers a key it knows with the first one */
  const server = () => {
    const made = new Map<string, { id: string }>();
    let lose = false;
    return {
      made,
      loseNext: () => { lose = true; },
      answer: async () => {
        const last = sent.at(-1)!;
        if (!made.has(last.key!)) made.set(last.key!, { id: `c${made.size + 1}` });
        if (lose) { lose = false; throw new TypeError('Failed to fetch'); }
        return made.get(last.key!);
      }
    };
  };
  let now = 5_000_000;
  const clock = () => now;
  const collect = (amount: number) => sendOnce<{ id: string }>('POST', '/api/wholesale/collections', { partyId: 'ali', amount }, undefined, clock);
  const kept = () => JSON.parse(sessionStorage.getItem(ONCE_STORE) ?? '[]') as [string, string, number][];
  beforeEach(() => { sent.length = 0; forgetOnceKeys(); reloadOnceKeysForTests(); now += 24 * 60 * 60_000; });

  it('retries with the same key: the collection is booked once, though the page forgot everything it had in memory', async () => {
    const office = server();
    answer = office.answer;
    office.loseNext();
    await expect(collect(50_000)).rejects.toThrow();
    expect(kept()).toHaveLength(1);
    // F5: memory gone, the tab's session storage still there
    reloadOnceKeysForTests();
    expect(heldOnceKeys()).toBe(0);
    now += 60_000;
    expect((await collect(50_000)).id).toBe('c1');
    expect(office.made.size).toBe(1);
    expect(new Set(sent.map((x) => x.key)).size).toBe(1);
    // answered: nothing is kept, in memory or in the tab; the next identical collection is a new one
    expect(heldOnceKeys()).toBe(0);
    expect(sessionStorage.getItem(ONCE_STORE)).toBeNull();
    reloadOnceKeysForTests();
    expect((await collect(50_000)).id).toBe('c2');
  });

  it('keeps the ten minutes across the reload: after them the same document is a new one', async () => {
    const office = server();
    answer = office.answer;
    office.loseNext();
    await expect(collect(50_000)).rejects.toThrow();
    reloadOnceKeysForTests();
    now += HOLD_MS;
    expect((await collect(50_000)).id).toBe('c2');
    expect(office.made.size).toBe(2);
  });

  it('lets a kept key go on a refusal and on signing out, and keeps another document\'s key apart', async () => {
    const office = server();
    answer = office.answer;
    office.loseNext();
    await expect(collect(50_000)).rejects.toThrow();
    office.loseNext();
    await expect(collect(60_000)).rejects.toThrow();
    expect(kept()).toHaveLength(2);
    reloadOnceKeysForTests();
    // the first is refused now (an answer): its key goes, the other's stays for its retry
    answer = async () => { throw new Error('validation'); };
    await expect(collect(50_000)).rejects.toThrow('validation');
    expect(kept().map((r) => r[0])).toEqual([expect.stringContaining('60000')]);
    answer = office.answer;
    reloadOnceKeysForTests();
    expect((await collect(60_000)).id).toBe('c2');
    expect(office.made.size).toBe(2);
    // signing out: the next person at this PC starts with no keys of someone else's
    office.loseNext();
    await expect(collect(70_000)).rejects.toThrow();
    forgetOnceKeys();
    expect(sessionStorage.getItem(ONCE_STORE)).toBeNull();
    expect(heldOnceKeys()).toBe(0);
  });

  it('reads nothing from a store it can\'t trust: not text, a key that is none, a time in the future', async () => {
    const office = server();
    answer = office.answer;
    const of = JSON.stringify(['POST', '/api/wholesale/collections', { amount: 50_000, partyId: 'ali' }]);
    for (const bad of ['{', '"x"', JSON.stringify([[of, '', now]]), JSON.stringify([[of, 'k-old', now + 60_000]]), JSON.stringify([[of, 'k-old', 'soon']]), JSON.stringify([[of, 'x'.repeat(65), now]]), JSON.stringify([of])]) {
      forgetOnceKeys();
      sessionStorage.setItem(ONCE_STORE, bad);
      reloadOnceKeysForTests();
      sent.length = 0;
      await collect(50_000);
      expect(sent[0]!.key, bad).not.toBe('k-old');
      expect(sent[0]!.key, bad).toMatch(/^k\d+$/);
    }
    // … and one it can: kept a minute ago
    forgetOnceKeys();
    sessionStorage.setItem(ONCE_STORE, JSON.stringify([[of, 'k-old', now - 60_000]]));
    reloadOnceKeysForTests();
    sent.length = 0;
    await collect(50_000);
    expect(sent[0]!.key).toBe('k-old');
  });
});
