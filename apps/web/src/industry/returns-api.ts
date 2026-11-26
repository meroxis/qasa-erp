import type { Lang } from '@qasa/core';
import { refundApprovals, type ContractView, type InvoiceView, type ReturnInput } from '../api.ts';
import { sendOnce } from './send-once.ts';

/**
 * A return of an invoice from the invoice's page (2.0 review): sent with a held key, so a second try after a lost
 * answer gets the first return back from the server (routes.ts answers `POST /api/invoices/:id/returns` once per key)
 * and nothing is paid back or put on the shelf twice.
 */
export const sendReturn = (id: string, input: ReturnInput): Promise<InvoiceView> =>
  sendOnce<InvoiceView>('POST', `/api/invoices/${id}/returns`, { ...input, ...refundApprovals() });

/** An installment collected (Pro): booked at once, so it goes with a held key too and a retry collects nothing twice. */
export const collectInstallmentOnce = (id: string, body: { date: string; amount: number; cashAccountCode: string; rateX100?: number; lang: Lang }): Promise<ContractView> =>
  sendOnce<ContractView>('POST', `/api/installments/${id}/collect`, body);
