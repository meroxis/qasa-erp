import type { CashRounding, Names } from '@qasa/core';
import { qs, request } from '../api.ts';

/** The till's rules and what goes with them (2.0, server till-rules.ts). */

export type ApprovalAction = 'line_delete' | 'void' | 'price' | 'discount' | 'no_sale' | 'refund' | 'credit_over' | 'blind_view';

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
  approve: (shiftId: string, action: ApprovalAction, pin: string, detail?: string) =>
    request<Approval>('POST', '/api/pos/approve', { shiftId, action, pin, ...(detail ? { detail } : {}) }),
  customer: (id: string) => request<{ id: string; balance: number; creditLimit: number | null; overLimit: boolean }>('GET', `/api/pos/customer/${id}`),
  sellVoucher: (shiftId: string, amount: number, expiresOn?: string) =>
    request<GiftVoucherView>('POST', `/api/pos/shifts/${shiftId}/gift-vouchers`, { amount, ...(expiresOn ? { expiresOn } : {}) }),
  lookupVoucher: (code: string) => request<GiftVoucherView>('GET', '/api/pos/gift-vouchers/lookup' + qs({ code })),
  vouchers: () => request<{ vouchers: GiftVoucherView[]; sold: number; used: number; outstanding: number; expiredUnused: number }>('GET', '/api/pos/gift-vouchers'),
  cancelVoucher: (id: string) => request<GiftVoucherView>('POST', `/api/pos/gift-vouchers/${id}/cancel`, {}),
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
