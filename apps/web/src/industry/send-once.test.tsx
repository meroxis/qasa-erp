import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: { url: string; key: string | undefined; body?: unknown }[] = [];
let answer: () => Promise<unknown> = async () => ({ id: 'v1' });
vi.mock('../api.ts', () => ({
  newIdempotencyKey: (() => { let n = 0; return () => `k${++n}`; })(),
  isNetworkError: (e: unknown) => e instanceof TypeError,
  request: async (_m: string, url: string, b: unknown, o: { key?: string }) => { sent.push({ url, key: o.key, body: b }); return answer(); }
}));
const { heldOnceKeys, sendOnce, HOLD_MS } = await import('./send-once.ts');

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
