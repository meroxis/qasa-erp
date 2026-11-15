import { dateText, money, translate, type Lang } from '../i18n';

/**
 * Sending a customer their invoice or statement from the phone: a PDF made on the phone and handed to Android's share
 * sheet (the user picks WhatsApp, or another app, and the chat), and — when the customer has a number WhatsApp can use —
 * the customer's chat opened with a message. Nothing is uploaded anywhere and nothing is sent without the user's taps.
 * The number rule and the messages are the desktop's (apps/web/src/share.ts).
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

/**
 * The link that opens the customer's chat with the message: only the digits of a number whatsappNumber gave, and the
 * message encoded; null when the customer has no such number.
 */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const number = whatsappNumber(phone);
  if (!number || !/^\d{8,15}$/.test(number)) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** A sale invoice for the customer: the company, its number and date, to whom, the total, the check link, thanks. */
export function invoiceMessage(lang: Lang, company: string, inv: { number: string | null; date: string; total: number; currency: 'IQD' | 'USD'; partyName?: string | null }, verifyUrl?: string | null): string {
  const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate(lang, k, v);
  return [
    company,
    t('shrMsgInvoice', { n: inv.number ?? '—', d: dateText(inv.date) }),
    inv.partyName ? `${t('shrMsgTo')}: ${inv.partyName}` : null,
    `${t('total')}: ${money(inv.total, inv.currency, lang)}`,
    verifyUrl ? `${t('shrMsgVerify')}: ${verifyUrl}` : null,
    t('shrMsgThanks')
  ].filter(Boolean).join('\n');
}

/** A customer's balance on a day, for a statement message. */
export function statementMessage(lang: Lang, company: string, s: { name: string; balance: number; currency: 'IQD' | 'USD'; date: string }): string {
  const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate(lang, k, v);
  return [
    company,
    t('shrMsgStatement', { name: s.name, d: dateText(s.date) }),
    `${t('shrMsgBalance')}: ${money(Math.abs(s.balance), s.currency, lang)}${s.balance < 0 ? ` (${t('shrMsgInYourFavour')})` : ''}`,
    t('shrMsgThanks')
  ].join('\n');
}

/**
 * A document's number as the PDF's file name (as the desktop names its PDFs): Latin letters, digits, dot, dash and
 * underscore, at most 64 ("INV-2026-0001"; Arabic-Indic digits become Western ones; anything else becomes a dash).
 */
export function pdfRef(text: string): string {
  const western = text.normalize('NFKC').replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
  const clean = western
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 64)
    .replace(/[^A-Za-z0-9]+$/, '');
  return clean || 'document';
}

/**
 * How long the last shared PDF is kept after the share sheet closed: the app the user picked (WhatsApp) may read the
 * file only when the user sends it in the chat, so it is not deleted at once. It goes at the next share, at the next
 * start of the app, or when the app comes back to the screen this long after the share.
 */
export const SHARE_KEEP_MS = 10 * 60_000;

/** Whether the last shared PDF goes now (the app is back on the screen): kept only within SHARE_KEEP_MS of its share. */
export const shareExpired = (sharedAt: number | null, now: number) => sharedAt !== null && now - sharedAt > SHARE_KEEP_MS;
