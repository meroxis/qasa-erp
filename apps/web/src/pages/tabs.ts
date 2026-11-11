/** Tab names that the router checks before a (lazily loaded) page is fetched. */
export const REPORT_TABS = ['sales-items', 'sales-categories', 'sales-brands', 'sales-customers', 'profit', 'aging', 'supplier-aging', 'stock-value'] as const;
export type ReportTab = (typeof REPORT_TABS)[number];
export function isReportTab(v: string | undefined): v is ReportTab {
  return !!v && (REPORT_TABS as readonly string[]).includes(v);
}

export type SolarTab = 'home' | 'new' | 'electrical' | 'maintenance' | 'warranty';
export const SOLAR_TABS: readonly SolarTab[] = ['home', 'new', 'electrical', 'maintenance', 'warranty'];
export const isSolarTab = (v: string | undefined): v is SolarTab => !!v && (SOLAR_TABS as readonly string[]).includes(v);
