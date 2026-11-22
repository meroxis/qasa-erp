import { beforeEach, expect, it, vi } from 'vitest';

// The calls that move money or stock at once go out through sendOnce (a held idempotency key), so a lost answer and a
// second press never book them twice (reliability review, finding 3). The others stay plain requests.
const once: string[] = [];
const plain: string[] = [];
vi.mock('./send-once.ts', () => ({ sendOnce: async (_m: string, url: string) => { once.push(url); return { id: 'x' }; } }));
vi.mock('../api.ts', () => ({
  qs: () => '',
  refundApprovals: () => ({}),
  request: async (_m: string, url: string) => { plain.push(url); return { id: 'x' }; }
}));
const { bankingApi } = await import('./banking-api.ts');
const { adjustmentsApi } = await import('./adjustments-api.ts');
const { clothingApi } = await import('./clothing-api.ts');

beforeEach(() => { once.length = 0; plain.length = 0; });

it('sends transfers, cheques, stock adjustments and the clothing exchange with a key that is held for the retry', async () => {
  await bankingApi.transfer({ date: '2026-11-22', from: '1811', to: '1831', currency: 'IQD', amount: 1000, lang: 'en' });
  await bankingApi.addCheque({ direction: 'received' } as never);
  await adjustmentsApi.create({} as never);
  await adjustmentsApi.post('a1', 'en');
  await clothingApi.exchange('s1', { invoiceId: 'i1', back: [{ lineNo: 1, qtyMilli: 1000 }] });
  expect(once).toEqual(['/api/banking/transfers', '/api/banking/cheques', '/api/adjustments', '/api/adjustments/a1/post', '/api/clothing/shifts/s1/exchange']);
  expect(plain).toEqual([]);
});

it('the expenses page pays out of the safe through sendOnce too', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../pages/Expenses.tsx', import.meta.url), 'utf8');
  expect(source).toMatch(/sendOnce<EntryView>\('POST', '\/api\/vouchers'/);
  expect(source).not.toMatch(/api\.createVoucher\(/);
});
