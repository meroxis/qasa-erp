import type { CurrencyCode } from '@qasa/core';
import type { I18n } from './i18n.ts';

/**
 * Sharing on WhatsApp: a message in the person's language, opened in WhatsApp (the app or the web) with the number
 * filled in when there is one. The Windows app opens https links in the default browser, which hands wa.me to
 * WhatsApp Desktop when it is installed. Nothing is sent by Qasa itself: the person presses Send in WhatsApp.
 */

/** A phone number as WhatsApp wants it: digits with the country code (Iraqi mobiles 07… → 9647…), or null. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  // Arabic-Indic and Persian digits typed on an Arabic or Kurdish keyboard count too
  const western = phone.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
  const d = western.replace(/\D/g, '').replace(/^00/, '');
  if (/^9647\d{9}$/.test(d)) return d;
  // +964 0750 …: the trunk 0 written after the country code as well
  if (/^96407\d{9}$/.test(d)) return '964' + d.slice(4);
  if (/^07\d{9}$/.test(d)) return '964' + d.slice(1);
  if (/^7\d{9}$/.test(d)) return '964' + d;
  // an Iraqi number that is no mobile (a landline): WhatsApp has none
  if (d.startsWith('964')) return null;
  // another country's number written in full
  if (/^[1-9]\d{9,14}$/.test(d) && phone.trim().startsWith('+')) return d;
  return null;
}

/** A number WhatsApp takes, written to be read back: "+964 750 123 4567" for an Iraqi mobile; null when it isn't one. */
export function displayPhone(phone: string | null | undefined): string | null {
  const n = whatsappNumber(phone);
  if (!n) return null;
  return /^9647\d{9}$/.test(n) ? `+964 ${n.slice(3, 6)} ${n.slice(6, 9)} ${n.slice(9)}` : `+${n}`;
}

/** The wa.me link for a message, to a number or (without one) letting the person pick the chat. */
export function whatsappUrl(phone: string | null | undefined, text: string): string {
  const number = whatsappNumber(phone);
  return `https://wa.me/${number ?? ''}?text=${encodeURIComponent(text)}`;
}

/** Opens WhatsApp with the message. */
export function openWhatsApp(phone: string | null | undefined, text: string): void {
  window.open(whatsappUrl(phone, text), '_blank', 'noopener,noreferrer');
}

/** Copies text to the clipboard; false when the browser refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A sale invoice for the customer: number, date, total, and what is still owed when it is on credit. */
export function invoiceMessage(i18n: I18n, company: string, inv: { number: string | null; date: string; total: number; currency: CurrencyCode; partyName?: string | null }): string {
  const { t } = i18n;
  return [
    company,
    t('br_shareInvoice', { n: inv.number ? i18n.digitsOf(inv.number) : '—', d: i18n.date(inv.date) }),
    inv.partyName ? `${t('br_to')}: ${inv.partyName}` : null,
    `${t('br_total')}: ${i18n.money(inv.total, inv.currency)}`,
    t('br_thanks')
  ].filter(Boolean).join('\n');
}

/** Shares a sale invoice with its customer on WhatsApp. */
export function shareInvoice(i18n: I18n, company: string, inv: { number: string | null; date: string; total: number; currency: CurrencyCode; partyName?: string | null; partyPhone?: string | null }): void {
  openWhatsApp(inv.partyPhone, invoiceMessage(i18n, company, inv));
}

/** A customer's or supplier's balance on a day, for an account statement message. */
export function statementMessage(i18n: I18n, company: string, s: { name: string; balance: number; currency: CurrencyCode; date: string }): string {
  const { t } = i18n;
  return [
    company,
    t('br_shareStatement', { name: s.name, d: i18n.date(s.date) }),
    `${t('br_balance')}: ${i18n.money(Math.abs(s.balance), s.currency)}${s.balance < 0 ? ` (${t('br_inYourFavour')})` : ''}`,
    t('br_thanks')
  ].join('\n');
}

/** Shares a customer's balance with them on WhatsApp. */
export function shareStatement(i18n: I18n, company: string, s: { name: string; phone?: string | null; balance: number; currency: CurrencyCode; date: string }): void {
  openWhatsApp(s.phone, statementMessage(i18n, company, s));
}
