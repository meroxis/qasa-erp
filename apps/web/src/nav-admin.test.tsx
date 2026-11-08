import { expect, it } from 'vitest';
import { ADMIN_PAGES, allPages, canSee, COMPANY_BOOK_PAGES, findPage, seesCompanyBooks, type NavViewer } from './nav.ts';

// A viewer who types or bookmarks an admin page lands on Home instead of a page whose every button the server refuses.
it('keeps every admin-only menu page, and its detail pages, for admins', () => {
  for (const page of ['users', 'plans', 'print-design', 'companies', 'import', 'business-type', 'website-api', 'branches', 'fixed-assets', 'fixed-asset', 'payroll', 'payroll-run']) {
    expect(ADMIN_PAGES.has(page), page).toBe(true);
  }
  for (const page of ['', 'home', 'sales', 'new-invoice', 'pos', 'brief']) expect(ADMIN_PAGES.has(page), page).toBe(false);
});

// Someone limited to branches gets none of the company's own books: no menu item, tile or search hit, and a typed or
// bookmarked link lands on Home (the server refuses those reports to them anyway).
it('hides the company-books pages from a user limited to branches, never from an admin', () => {
  for (const page of ['trial-balance', 'final-accounts', 'statement']) expect(COMPANY_BOOK_PAGES.has(page), page).toBe(true);
  for (const page of ['', 'home', 'brief', 'reports-more', 'customers', 'rates', 'accounts']) expect(COMPANY_BOOK_PAGES.has(page), page).toBe(false);
  const limited: NavViewer = { admin: false, permissions: ['sales'], businessTypes: [], branchLimited: true };
  const everywhere: NavViewer = { ...limited, branchLimited: false };
  const keys = (v: NavViewer) => allPages(v).map((p) => p.key);
  for (const key of ['trialBalance', 'finalAccounts', 'statement'] as const) {
    expect(canSee(findPage(key)!, limited), key).toBe(false);
    expect(canSee(findPage(key)!, everywhere), key).toBe(true);
    expect(canSee(findPage(key)!, { ...limited, admin: true }), key).toBe(true);
    expect(keys(limited)).not.toContain(key);
  }
  expect(keys(limited)).toContain('br_reports');
  expect(seesCompanyBooks(limited)).toBe(false);
  expect(seesCompanyBooks({ admin: true, branchLimited: true })).toBe(true);
});
