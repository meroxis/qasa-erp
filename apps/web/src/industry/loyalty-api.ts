import type { LoyaltyLedgerRow, LoyaltyRules, Names } from '@qasa/core';
import { request } from '../api.ts';

/** Loyalty points (Pro): the rules, a customer's points and their ledger. Amounts in IQD. */
export interface LoyaltySettingsView { available: boolean; rules: LoyaltyRules; accountCode: string; accountName: Names | null }

export interface PartyLoyaltyView {
  partyId: string;
  balance: number;
  worth: number;
  expiring: { points: number; on: string } | null;
  /** newest first */
  rows: LoyaltyLedgerRow[];
  rules: Pick<LoyaltyRules, 'on' | 'pointValue' | 'minRedeem' | 'maxRedeemPercent' | 'expiryMonths'>;
  available: boolean;
}

/** On an invoice: what it earned and used, and the customer's balance now (null: none, and points are off). */
export interface InvoiceLoyaltyView { earned: number; redeemed: number; value: number; balance: number }

export const loyaltyApi = {
  settings: () => request<LoyaltySettingsView>('GET', '/api/loyalty/settings'),
  saveSettings: (body: { rules?: Partial<LoyaltyRules>; accountCode?: string }) => request<LoyaltySettingsView>('PUT', '/api/loyalty/settings', body),
  party: (id: string) => request<PartyLoyaltyView>('GET', `/api/loyalty/parties/${encodeURIComponent(id)}`),
  adjust: (id: string, body: { points: number; note: string }) => request<PartyLoyaltyView>('POST', `/api/loyalty/parties/${encodeURIComponent(id)}/adjust`, body)
};
