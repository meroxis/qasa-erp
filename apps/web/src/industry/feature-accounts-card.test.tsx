import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// 2.0.0: the accountant chooses the account a new feature posts to (server: feature-accounts.ts, PUT /api/feature-accounts/:key)
it('lists each feature account in Settings → Company and lets an admin choose one of the right kind', () => {
  const card = readFileSync(new URL('./FeatureAccountsCard.tsx', import.meta.url), 'utf8');
  expect(card).toContain("request<FeatureAccountView[]>('PUT', `/api/feature-accounts/${encodeURIComponent(key)}`, { accountCode })");
  expect(card).toContain('filter={(x) => x.code.startsWith(a.root)}');
  for (const key of ['notesReceivable', 'consignment', 'giftVouchers', 'oldGold', 'goldOwed']) expect(card).toContain(`${key}: 'ux_fa_${key}'`);
  expect(readFileSync(new URL('../pages/Settings.tsx', import.meta.url), 'utf8')).toContain('<PostingAccountsCard /><FeatureAccountsCard />');
});
