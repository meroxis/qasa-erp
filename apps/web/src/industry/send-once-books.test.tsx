import { beforeEach, describe, expect, it, vi } from 'vitest';

// What books money or stock in consignment, gold, wholesale, delivery and the daily suppliers' sheet goes through
// sendOnce (2.0 review): a retry after a lost answer carries the first try's key, so the server (onceOnly) answers it
// with the first document and books nothing twice. A new document gets a new key.

const sent: { method: string; url: string; key: string | undefined }[] = [];
let answer: () => Promise<unknown> = async () => ({ id: 'x' });
vi.mock('../api.ts', () => ({
  newIdempotencyKey: (() => { let n = 0; return () => `k${++n}`; })(),
  isNetworkError: (e: unknown) => e instanceof TypeError,
  qs: () => '',
  request: async (method: string, url: string, _b: unknown, o?: { key?: string }) => { sent.push({ method, url, key: o?.key }); return answer(); }
}));
const { wholesaleApi } = await import('./wholesale-api.ts');
const { deliveryApi, dailyApi } = await import('./market-extras-api.ts');
const { consignmentApi } = await import('./consignment-api.ts');
const { goldApi } = await import('./gold-api.ts');
const { heldOnceKeys } = await import('./send-once.ts');

const collection = { repId: 'r', partyId: 'p', date: '2026-11-20', currency: 'IQD' as const, rateX100: 100, amount: 25_000 };
const handover = { repId: 'r', date: '2026-11-20', currency: 'IQD' as const, rateX100: 100 };
const order = { customerName: 'Rizgar', phone: '', address: 'Ankawa', warehouseId: 'w', payment: 'cod' as const, fee: 0, lines: [] };
const sheet = { partyId: 'p', date: '2026-11-20', warehouseId: 'w', lines: [{ itemId: 'i', receivedMilli: 1000, returnedMilli: 0 }] };
const consignmentDoc = { kind: 'receipt' as const, date: '2026-11-20', supplierId: 's', warehouseId: 'w', lines: [] };
const goldDoc = { kind: 'receipt' as const, date: '2026-11-20', partyId: 's', warehouseId: 'w', pricePerGram: 1, lines: [] };

const CALLS: [string, () => Promise<unknown>][] = [
  ['wholesale collection', () => wholesaleApi.collect(collection)],
  ['wholesale collection taken back', () => wholesaleApi.cancelCollection('c1')],
  ['wholesale handover', () => wholesaleApi.handOver(handover)],
  ['wholesale handover taken back', () => wholesaleApi.cancelHandover('h1')],
  ['delivery order', () => deliveryApi.create(order as never)],
  ['driver handover', () => deliveryApi.handOver({ driverId: 'd', amount: 5_000, cashAccountCode: '1811' })],
  ['driver handover taken back', () => deliveryApi.cancelHandover('h1')],
  ['daily supplier sheet', () => dailyApi.save(sheet)],
  ['consignment document', () => consignmentApi.createDoc(consignmentDoc as never)],
  ['consignment document posted', () => consignmentApi.postDoc('d1', 'en')],
  ['consignment document cancelled', () => consignmentApi.cancelDoc('d1')],
  ['consignment settlement', () => consignmentApi.settle({ supplierId: 's', currency: 'IQD', date: '2026-11-20', lang: 'en' })],
  ['consignment settlement cancelled', () => consignmentApi.cancelSettlement('s1')],
  ['gold document', () => goldApi.createDoc(goldDoc as never)],
  ['gold document posted', () => goldApi.postDoc('g1', 'en')],
  ['gold document cancelled', () => goldApi.cancelDoc('g1')]
];

describe('money and stock are sent once (2.0 review: the web uses the key the server honours)', () => {
  beforeEach(() => { sent.length = 0; answer = async () => ({ id: 'x' }); });

  it.each(CALLS)('%s: a retry after a lost answer carries the same key; the next one a new key', async (_name, send) => {
    answer = async () => { throw new TypeError('Failed to fetch'); };
    await expect(send()).rejects.toThrow();
    expect(heldOnceKeys()).toBe(1);
    answer = async () => ({ id: 'x' });
    await send();
    await send();
    expect(sent).toHaveLength(3);
    expect(sent.every((s) => s.method === 'POST' && !!s.key)).toBe(true);
    expect(sent[1]!.key).toBe(sent[0]!.key);
    expect(sent[2]!.key).not.toBe(sent[0]!.key);
    expect(heldOnceKeys()).toBe(0);
  });

  it('a second sheet for the day (the supplier came again) is another document, with a key of its own', async () => {
    answer = async () => { throw new TypeError('Failed to fetch'); };
    await expect(dailyApi.save(sheet)).rejects.toThrow();
    answer = async () => ({ id: 'x' });
    await dailyApi.save({ ...sheet, again: true });
    expect(sent[1]!.key).not.toBe(sent[0]!.key);
    await dailyApi.save(sheet);
    expect(sent[2]!.key).toBe(sent[0]!.key);
  });
});
