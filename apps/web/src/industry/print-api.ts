import { useSyncExternalStore } from 'react';
import type { PrintDesign, PrintDesigns, PrintDoc } from '@qasa/core';
import { request } from '../api.ts';

/** The print header (logo, address…) and the print designs: read once per visit and shared by every page that prints. */

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';
export interface PrintProfile { address: string; phone: string; taxNumber: string; footer: string; showLogo: boolean }
export interface CompanyLogo { mime: ImageMime; data: string; updatedAt: string }
export interface PrintProfileView extends PrintProfile {
  /** the logo to print: null when there is none, or when the plan does not print one (the server decides) */
  logo: CompanyLogo | null;
  /** a logo is saved but the plan does not print it (older servers leave it out) */
  logoKept?: boolean;
}

export const printApi = {
  profile: () => request<PrintProfileView>('GET', '/api/print-profile'),
  saveProfile: (p: PrintProfile) => request<PrintProfileView>('PUT', '/api/print-profile', p),
  setLogo: (data: string) => request<CompanyLogo>('PUT', '/api/company-logo', { data }),
  deleteLogo: () => request<void>('DELETE', '/api/company-logo'),
  designs: () => request<PrintDesigns>('GET', '/api/print-designs'),
  saveDesign: (doc: PrintDoc, design: PrintDesign) => request<PrintDesigns>('PUT', `/api/print-designs/${doc}`, design),
  resetDesign: (doc: PrintDoc) => request<PrintDesigns>('DELETE', `/api/print-designs/${doc}`)
};

export interface PrintSetup { profile: PrintProfileView | null; designs: PrintDesigns }

let state: PrintSetup = { profile: null, designs: {} };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function load(): void {
  if (loading) return;
  loading = Promise.all([printApi.profile().catch(() => null), printApi.designs().catch(() => ({}))])
    .then(([profile, designs]) => { state = { profile, designs }; })
    .finally(() => notify());
}

/** After a change here (or to be sure of another person's change): asks again. */
export function refreshPrintSetup(): void {
  loading = null;
  load();
}

/** Puts a just-saved answer in place without asking again. */
export function setPrintSetup(patch: Partial<PrintSetup>): void {
  state = { ...state, ...patch };
  notify();
}

export function usePrintSetup(): PrintSetup {
  return useSyncExternalStore(
    (onChange) => { listeners.add(onChange); load(); return () => listeners.delete(onChange); },
    () => state,
    () => state
  );
}

export const logoUrl = (logo: CompanyLogo | null | undefined): string | null => (logo ? `data:${logo.mime};base64,${logo.data}` : null);
