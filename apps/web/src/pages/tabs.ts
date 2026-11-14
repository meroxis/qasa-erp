/** Tab names that the router checks before a (lazily loaded) page is fetched. */
export const REPORT_TABS = ['sales-items', 'sales-categories', 'sales-brands', 'sales-customers', 'profit', 'aging', 'supplier-aging', 'stock-value'] as const;
export type ReportTab = (typeof REPORT_TABS)[number];
export function isReportTab(v: string | undefined): v is ReportTab {
  return !!v && (REPORT_TABS as readonly string[]).includes(v);
}

/**
 * The report tabs of someone who may not read the books (a sales-only user): what was sold and what customers owe.
 * Profit, the stock valuation and the ageing of what the company owes its suppliers are reports of the books, and the
 * server refuses them (cost-view.ts, brief.ts).
 */
const BOOKS_REPORTS: ReadonlySet<ReportTab> = new Set(['profit', 'supplier-aging', 'stock-value']);
export const reportTabsFor = (books: boolean): ReportTab[] => REPORT_TABS.filter((k) => books || !BOOKS_REPORTS.has(k));

export type SolarTab = 'home' | 'new' | 'electrical' | 'maintenance' | 'warranty';
export const SOLAR_TABS: readonly SolarTab[] = ['home', 'new', 'electrical', 'maintenance', 'warranty'];
export const isSolarTab = (v: string | undefined): v is SolarTab => !!v && (SOLAR_TABS as readonly string[]).includes(v);
