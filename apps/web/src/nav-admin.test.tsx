import { expect, it } from 'vitest';
import { ADMIN_PAGES } from './nav.ts';

// A viewer who types or bookmarks an admin page lands on Home instead of a page whose every button the server refuses.
it('keeps every admin-only menu page, and its detail pages, for admins', () => {
  for (const page of ['users', 'plans', 'print-design', 'companies', 'import', 'business-type', 'website-api', 'branches', 'fixed-assets', 'fixed-asset', 'payroll', 'payroll-run']) {
    expect(ADMIN_PAGES.has(page), page).toBe(true);
  }
  for (const page of ['', 'home', 'sales', 'new-invoice', 'pos', 'brief']) expect(ADMIN_PAGES.has(page), page).toBe(false);
});
