import type { CashRounding, Names } from '@qasa/core';
import { qs, request } from '../api.ts';
import { sendOnce } from '../industry/send-once.ts';

/** The till's rules and what goes with them (2.0, server till-rules.ts). */

export type ApprovalAction = 'line_delete' | 'void' | 'price' | 'discount' | 'no_sale' | 'refund' | 'credit_over' | 'blind_view' | 'offline_sale' | 'rate';

/**
 * What an approval is for, beside its action (the server keeps it with the approval and holds the use to it): a refund's
 * invoice and lines; a lower price's item, unit, currency and price; a discount's amount and the basket it is given on;
 * credit over the limit: the customer and the amount on account; a kept sale the server refused: its receipt
 * reference and what it is worth; dollars at a rate away from the day's: the kind of sale and that very rate.
 */
export interface ApprovalFor {
  invoiceId?: string; lines?: { lineNo: number; qtyMilli: number }[];
  itemId?: string; unit?: string; partyId?: string; reference?: string; amount?: number;
  currency?: 'IQD' | 'USD'; gross?: number; rate?: { kind: 'notes' | 'sale'; rateX100: number };
}

/** The rate dollars are held to at the till today, and how far a typed one may be from it (per cent). */
export interface RateRule { referenceX100: number; freePct: number; bandPct: number }

export interface SupervisorRules { lineDelete: boolean; void: boolean; price: boolean; discountPct: number; noSale: boolean; refund: boolean; creditOver: boolean }
export interface DisplayRules { lang: 'till' | 'ar' | 'en' | 'ku'; paymentText: string; slideshow: boolean }

export interface TillRulesView {
  rounding: CashRounding;
  blindClose: boolean;
  supervisor: SupervisorRules;
  misc: { itemId: string | null; max: number; allowed: boolean };
  display: DisplayRules;
  mayApprove: boolean;
  hasPin: boolean;
  /** this person's PIN is from before 6 digits were asked for */
  pinShort?: boolean;
  /** the day's dollar rate (the rate board's for today, else the company's); none from a server before 2.0's last fixes */
  rate?: RateRule;
  /** (an admin) wrong PINs hold someone's approvals locked right now */
  pinLocked?: boolean;
  /** (an admin) the last time wrong PINs locked approvals */
  pinAlert?: { scope: 'cashier' | 'all'; cashier: string; tries: number; at: string } | null;
}

export interface TillRulesInput {
  rounding?: CashRounding; roundingAccount?: string | null; blindClose?: boolean; supervisor?: SupervisorRules;
  misc?: { itemId: string | null; max: number; users: string[] | null }; display?: DisplayRules;
}

export interface Approval { token: string; approver: string; action: ApprovalAction; expiresAt: string; used: boolean }

export interface GiftVoucherView {
  id: string; code: string; amount: number; balance: number; currency: 'IQD'; expiresOn: string | null; status: 'active' | 'cancelled';
  createdBy: string; createdAt: string; usable: boolean;
  /** made by a refund (not sold at a till): cancelling it pays the customer out of a safe the admin names */
  fromRefund?: boolean;
}

/** What the customer screens show: only what a customer at the counter sees anyway. */
export interface DisplayState {
  dir: 'rtl' | 'ltr'; lang: 'ar' | 'en' | 'ku'; company: string; welcome: string; totalLabel: string;
  lines: { name: string; qty: string; amount: string; offer?: string }[];
  total: string;
  saved?: { label: string; value: string };
  points?: { label: string; value: string };
  paid?: { label: string; value: string };
  change?: { label: string; value: string };
  paying?: boolean;
  done?: string;
}

export interface DisplayFeed { state: DisplayState | null; display: DisplayRules; offers: Names[]; images: string[]; company: Names; logo: { mime: string; data: string } | null }

/** Today's rules on a till as an admin set them; nothing turned on with a server that has none (an older one). */
export const NO_RULES: TillRulesView = {
  rounding: { step: 0, mode: 'nearest' }, blindClose: false,
  supervisor: { lineDelete: false, void: false, price: false, discountPct: 0, noSale: false, refund: false, creditOver: false },
  misc: { itemId: null, max: 0, allowed: false }, display: { lang: 'till', paymentText: '', slideshow: true }, mayApprove: false, hasPin: false
};

export const tillRulesApi = {
  rules: () => request<TillRulesView>('GET', '/api/pos/rules'),
  save: (input: TillRulesInput) => request<unknown>('PUT', '/api/pos/rules', input),
  setPin: (pin: string) => request<{ ok: true }>('PUT', '/api/pos/pin', { pin }),
  clearPinAlert: () => request<{ ok: true }>('DELETE', '/api/pos/pin-alert'),
  /** an admin lifts the locks wrong PINs left (written to the audit log) */
  unlockPins: () => request<{ ok: true }>('POST', '/api/pos/pin-unlock', {}),
  /** a supervisor's PIN typed on an invoice screen for a refund there (no shift) */
  approveRefund: (invoiceId: string, pin: string, lines?: { lineNo: number; qtyMilli: number }[]) =>
    request<Approval>('POST', '/api/refund-approvals', { invoiceId, pin, ...(lines ? { lines } : {}) }),
  approve: (shiftId: string, action: ApprovalAction, pin: string, detail?: string, what: ApprovalFor = {}) =>
    request<Approval>('POST', '/api/pos/approve', { shiftId, action, pin, ...(detail ? { detail } : {}), ...what }),
  customer: (id: string) => request<{ id: string; balance: number; creditLimit: number | null; overLimit: boolean }>('GET', `/api/pos/customer/${id}`),
  /** sent once: a second tap, or a retry after the answer was lost, goes with the same key and makes one voucher */
  sellVoucher: (shiftId: string, amount: number, expiresOn?: string) =>
    sendOnce<GiftVoucherView>('POST', `/api/pos/shifts/${shiftId}/gift-vouchers`, { amount, ...(expiresOn ? { expiresOn } : {}) }),
  lookupVoucher: (code: string) => request<GiftVoucherView>('GET', '/api/pos/gift-vouchers/lookup' + qs({ code })),
  /** an admin: what expired vouchers still hold goes to income through a draft entry */
  expireVouchers: () => request<{ entryId: string | null; count: number; amount: number }>('POST', '/api/pos/gift-vouchers/expire', {}),
  vouchers: () => request<{ vouchers: GiftVoucherView[]; sold: number; used: number; outstanding: number; expiredUnused: number }>('GET', '/api/pos/gift-vouchers'),
  /** `cashAccountCode`: the safe that pays a voucher a refund made (one sold at a till goes back out of the safe it was paid into) */
  cancelVoucher: (id: string, cashAccountCode?: string) => request<GiftVoucherView>('POST', `/api/pos/gift-vouchers/${id}/cancel`, cashAccountCode ? { cashAccountCode } : {}),
  displayCode: (tillId: string) => request<{ code: string }>('POST', '/api/pos/display/code', { tillId }),
  showState: (tillId: string, state: DisplayState) => request<{ ok: true }>('POST', '/api/pos/display/state', { tillId, state }),
  /** a screen pairs with the till's code once and goes on with the key it gets */
  pair: (code: string) => request<{ key: string }>('POST', '/api/pos/display/pair', { code }),
  feed: (key: string) => request<DisplayFeed>('GET', '/api/pos/display/feed' + qs({ key })),
  feedImage: (key: string, id: string) => request<{ mime: string; data: string }>('GET', `/api/pos/display/image/${id}` + qs({ key })),
  images: () => request<{ images: { id: string }[]; max: number }>('GET', '/api/pos/display/images'),
  adminImage: (id: string) => request<{ mime: string; data: string }>('GET', `/api/pos/display/image-admin/${id}`),
  addImage: (base64: string) => request<{ id: string }>('POST', '/api/pos/display/images', { base64 }),
  deleteImage: (id: string) => request<{ ok: true }>('DELETE', `/api/pos/display/images/${id}`)
};
