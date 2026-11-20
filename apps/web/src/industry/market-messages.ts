import type { Names } from '@qasa/core';
import type { I18n, Key } from '../i18n.ts';
import type { DeliveryOrderSummary, DeliveryStatus, ReminderRow } from './market-extras-api.ts';

/**
 * The WhatsApp messages of the market extras, written by the i18n of the customer's language (theirs, else the app's).
 * Nothing is sent by Qasa: the app opens WhatsApp with the message and the person presses Send.
 */

/** What a delivery customer is told at a step of their order (new, preparing, out with the driver, delivered, cancelled). */
export function deliveryMessage(i18n: I18n, order: Pick<DeliveryOrderSummary, 'number' | 'customerName' | 'total' | 'driverName' | 'payment' | 'cancelReason'>,
  status: DeliveryStatus, company: Names | null, driverPhone = ''): string {
  const vars = {
    name: order.customerName, number: order.number, total: i18n.money(order.total, 'IQD'), driver: order.driverName ?? '',
    phone: driverPhone, company: company ? i18n.name(company) : ''
  };
  const body = i18n.t(`mx_wa_${status}` as Key, vars);
  const pay = status === 'out' && order.payment === 'cod' ? ` ${i18n.t('mx_wa_payCod', vars)}` : '';
  const why = status === 'cancelled' && order.cancelReason ? ` (${order.cancelReason})` : '';
  return `${body}${pay}${why}${vars.company ? `\n— ${vars.company}` : ''}`;
}

/** What a customer who owes is told: how much in each currency they owe in, and since when, from the shop. */
export function reminderMessage(i18n: I18n, row: Pick<ReminderRow, 'name' | 'owed' | 'balance' | 'oldestDays'>, company: Names | null): string {
  const parts = [
    ...(row.owed.IQD > 0 ? [i18n.money(row.owed.IQD, 'IQD')] : []),
    ...(row.owed.USD > 0 ? [i18n.money(row.owed.USD, 'USD')] : [])
  ];
  const amount = parts.length ? parts.join(' + ') : i18n.money(row.balance, 'IQD');
  return i18n.t('mx_rm_text', { name: row.name, amount, days: i18n.int(row.oldestDays), company: company ? i18n.name(company) : '' }).trim();
}

/** The one amount a reminder is kept with: dinars when they owe dinars, else dollars (in cents). */
export function reminderAmount(row: Pick<ReminderRow, 'owed' | 'balance'>): { amount: number; currency: 'IQD' | 'USD' } {
  if (row.owed.IQD > 0) return { amount: row.owed.IQD, currency: 'IQD' };
  if (row.owed.USD > 0) return { amount: row.owed.USD, currency: 'USD' };
  return { amount: Math.max(0, row.balance), currency: 'IQD' };
}
