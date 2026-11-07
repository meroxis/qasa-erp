import { request } from '../api.ts';

/** Companies on this PC (Windows app only; the routes come from the app's own server process). */

export interface CompanyView { id: string; name: string; createdAt: string; current: boolean; openable: boolean }
export interface CompaniesView { current: string; limit: number | null; canAdd: boolean; list: CompanyView[] }

export const companiesApi = {
  list: () => request<CompaniesView>('GET', '/api/companies'),
  create: (name: string) => request<CompaniesView>('POST', '/api/companies', { name }),
  rename: (id: string, name: string) => request<CompaniesView>('PUT', `/api/companies/${encodeURIComponent(id)}`, { name }),
  open: (id: string) => request<{ ok: true; reload: true }>('POST', `/api/companies/${encodeURIComponent(id)}/open`),
  backup: (id: string) => request<{ saved: string | null }>('POST', `/api/companies/${encodeURIComponent(id)}/backup`)
};

/**
 * True in a Windows app that can keep several companies (its preload says so). Not in a browser, the web demo, or on
 * an office PC working on another PC's company (that window has no own server process to switch).
 */
export function canSwitchCompanies(): boolean {
  if (typeof window === 'undefined') return false;
  const desktop = (window as unknown as { qasaDesktop?: { companies?: unknown } }).qasaDesktop;
  return desktop?.companies === true && /^http:\/\/127\.0\.0\.1:\d+$/.test(window.location.origin);
}
