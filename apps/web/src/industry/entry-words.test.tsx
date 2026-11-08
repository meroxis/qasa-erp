import { beforeEach, expect, it, vi } from 'vitest';

// What the page sends to the server for steps that write entries: the person's language, and the new undo routes.
const sent = vi.hoisted(() => [] as { method: string; url: string; body: unknown }[]);
vi.mock('../api.ts', () => ({
  qs: () => '',
  request: async (method: string, url: string, body?: unknown) => { sent.push({ method, url, body }); return {}; }
}));

const { bankingApi } = await import('./banking-api.ts');
const { adjustmentsApi, countLines } = await import('./adjustments-api.ts');
const { assetsApi } = await import('./assets-api.ts');
const { mediaApi } = await import('./media-api.ts');

beforeEach(() => { sent.length = 0; });

it('sends the UI language with transfers, cheques and their steps, so the entry is not written in Arabic for everyone', async () => {
  await bankingApi.transfer({ date: '2026-11-01', from: '1811', to: '1821', currency: 'IQD', amount: 1000, lang: 'en' });
  await bankingApi.addCheque({ direction: 'received', number: '7', bank: 'Rafidain', partyId: 'p', currency: 'IQD', amount: 5000, issueDate: '2026-11-01', dueDate: '2026-11-30', lang: 'ku' });
  await bankingApi.clear('c1', { date: '2026-11-02', lang: 'en' });
  await bankingApi.bounce('c1', { date: '2026-11-02', lang: 'en' });
  await bankingApi.cancelCheque('c1', { date: '2026-11-02', lang: 'ku' });
  expect(sent.map((s) => [s.url, (s.body as { lang?: string }).lang])).toEqual([
    ['/api/banking/transfers', 'en'], ['/api/banking/cheques', 'ku'], ['/api/banking/cheques/c1/clear', 'en'],
    ['/api/banking/cheques/c1/bounce', 'en'], ['/api/banking/cheques/c1/cancel', 'ku']
  ]);
});

it('undoes a cheque step through its own route, with the reversal date', async () => {
  await bankingApi.undoCheque('c 1', { date: '2026-11-03' });
  expect(sent).toEqual([{ method: 'POST', url: '/api/banking/cheques/c%201/undo', body: { date: '2026-11-03' } }]);
});

it('posts a stock adjustment and imports from Excel in the UI language', async () => {
  await adjustmentsApi.post('a1', 'ku');
  await mediaApi.import('opening_balances', [], false, { date: '2026-01-01' }, 'en');
  expect(sent[0]).toEqual({ method: 'POST', url: '/api/adjustments/a1/post', body: { lang: 'ku' } });
  expect(sent[1]!.body).toMatchObject({ kind: 'opening_balances', lang: 'en', options: { date: '2026-01-01' } });
});

it('reverses an approved depreciation month and an approved disposal on the chosen date', async () => {
  await assetsApi.reverseRun('r1', { date: '2026-11-05' });
  await assetsApi.undispose('a1', { date: '2026-11-06' });
  expect(sent).toEqual([
    { method: 'POST', url: '/api/assets/depreciation/r1/reverse', body: { date: '2026-11-05' } },
    { method: 'POST', url: '/api/assets/a1/undispose', body: { date: '2026-11-06' } }
  ]);
});

it('sends a unit cost only with a counted surplus, so a surplus of an item with no stock can post', () => {
  const counted = new Map([['new', 3000], ['short', 1000], ['same', 2000]]);
  const costs = new Map([['new', 2500], ['short', 900]]);
  const books = new Map([['new', 0], ['short', 4000], ['same', 2000]]);
  expect(countLines(counted, costs, books)).toEqual([
    { itemId: 'new', countedMilli: 3000, unitCost: 2500 },
    { itemId: 'short', countedMilli: 1000 },
    { itemId: 'same', countedMilli: 2000 }
  ]);
});
