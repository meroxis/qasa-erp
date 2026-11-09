import { guideUrl, type GuideSlug } from '@qasa/core';
import { useI18n } from '../i18n.ts';

/**
 * The user guide topic for each app page (the route's first part). The header shows a "?" beside the page title for
 * these; a page that is not listed has none.
 */
export const PAGE_GUIDE: Readonly<Record<string, GuideSlug>> = {
  // vouchers and journal entries
  entries: 'vouchers-and-approval', entry: 'vouchers-and-approval', new: 'vouchers-and-approval', edit: 'vouchers-and-approval',
  accounts: 'chart-of-accounts',
  // sales
  sales: 'sales-invoices-returns-customers-quotations', customers: 'sales-invoices-returns-customers-quotations',
  'sales-returns': 'sales-invoices-returns-customers-quotations', quotes: 'sales-invoices-returns-customers-quotations',
  quote: 'sales-invoices-returns-customers-quotations', 'new-quote': 'sales-invoices-returns-customers-quotations',
  'edit-quote': 'sales-invoices-returns-customers-quotations',
  // purchases
  purchases: 'purchases-and-suppliers', suppliers: 'purchases-and-suppliers', 'purchase-returns': 'purchases-and-suppliers',
  'purchase-orders': 'purchases-and-suppliers', 'purchase-order': 'purchases-and-suppliers',
  'new-purchase-order': 'purchases-and-suppliers', 'edit-purchase-order': 'purchases-and-suppliers',
  // items and stock
  items: 'stock-items-warehouses-counts', item: 'stock-items-warehouses-counts', 'stock-docs': 'stock-items-warehouses-counts',
  'stock-doc': 'stock-items-warehouses-counts', 'new-stock-doc': 'stock-items-warehouses-counts',
  'edit-stock-doc': 'stock-items-warehouses-counts', 'stock-adjustments': 'stock-items-warehouses-counts',
  'stock-adjustment': 'stock-items-warehouses-counts', 'new-stock-adjustment': 'stock-items-warehouses-counts',
  'edit-stock-adjustment': 'stock-items-warehouses-counts', 'stock-count': 'stock-items-warehouses-counts',
  // 1.1: batches and expiry dates are part of the stock topic
  expiry: 'stock-items-warehouses-counts',
  pos: 'point-of-sale', 'pos-shift': 'point-of-sale',
  banking: 'banks-safes-and-cheques', cheque: 'banks-safes-and-cheques', 'bank-statement': 'banks-safes-and-cheques',
  'trial-balance': 'reports-final-accounts-year-end', statement: 'reports-final-accounts-year-end',
  'final-accounts': 'reports-final-accounts-year-end', 'reports-more': 'reports-final-accounts-year-end',
  users: 'users-roles-and-sign-in',
  companies: 'backups-restore-and-companies',
  plans: 'plans-licences-and-activation',
  payroll: 'payroll', 'payroll-run': 'payroll',
  // the tools for one kind of business
  'business-type': 'industry-tools', installments: 'industry-tools', installment: 'industry-tools',
  'new-installment': 'industry-tools', guarantors: 'industry-tools', 'installments-aging': 'industry-tools',
  'real-estate': 'industry-tools', 'real-estate-project': 'industry-tools', mobile: 'industry-tools', repair: 'industry-tools',
  'car-parts': 'industry-tools', works: 'industry-tools', job: 'industry-tools', solar: 'industry-tools',
  'solar-system': 'industry-tools', generators: 'industry-tools', 'gen-run': 'industry-tools', pharmacy: 'industry-tools'
};

/** The guide topic for a page; a new invoice is a sale or a purchase by its argument ("new-invoice/purchase"). */
export function pageGuide(page: string, arg?: string): GuideSlug | null {
  if (page === 'new-invoice') return arg === 'purchase' ? 'purchases-and-suppliers' : 'sales-invoices-returns-customers-quotations';
  return Object.hasOwn(PAGE_GUIDE, page) ? PAGE_GUIDE[page]! : null;
}

/** A question mark in a circle, drawn like the app's other icons. */
function QuestionIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.2-2.5 3.7M12 17h.01" />
    </svg>
  );
}

/**
 * "How does this work?": a small "?" that opens one topic of the user guide on qasaerp.com, in the app's language. The
 * Windows app sends it to the system browser (a new window to an outside address); the browser and the demo open a tab.
 */
export function GuideLink({ slug }: { slug: GuideSlug }) {
  const { t, lang } = useI18n();
  const label = t('us_guideHere');
  return (
    <a className="guide-link no-print" href={guideUrl(slug, lang)} target="_blank" rel="noopener noreferrer" title={label} aria-label={label} data-guide={slug}>
      <QuestionIcon />
    </a>
  );
}
