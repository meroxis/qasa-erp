import { useCallback, useEffect, useState } from 'react';
import type { CurrencyCode, Lang, Names } from '@qasa/core';
import { request } from '../api.ts';
import { Icon, useData } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { invoiceMessage, statementMessage, whatsappNumber, whatsappUrl } from '../share.ts';
import { WhatsAppSendButton } from './WhatsAppSend.tsx';

/**
 * "Send on WhatsApp" on invoices, quotations and account statements: opens WhatsApp (the app or the web) with a short
 * message in the user's language, to the customer's number when it has one. Nothing is sent by Qasa itself — the person
 * presses Send in WhatsApp. A posted sale invoice carries its verify link (the same as its QR code).
 */

/** A message plus the invoice's verify link, when it has one. */
export function withVerifyLink(i18n: I18n, message: string, verifyUrl: string | null | undefined): string {
  return verifyUrl ? `${message}\n${i18n.t('sh_verify')}: ${verifyUrl}` : message;
}

/** A quotation for the customer: number, date, total and how long it holds. */
export function quoteMessage(i18n: I18n, company: string, q: { number: string; date: string; total: number; currency: CurrencyCode; validUntil: string | null; customerName?: string | null }): string {
  const { t } = i18n;
  return [
    company,
    t('sh_quote', { n: i18n.digitsOf(q.number), d: i18n.date(q.date) }),
    q.customerName ? `${t('br_to')}: ${q.customerName}` : null,
    `${t('br_total')}: ${i18n.money(q.total, q.currency)}`,
    q.validUntil ? t('sh_validUntil', { d: i18n.date(q.validUntil) }) : null,
    t('br_thanks')
  ].filter(Boolean).join('\n');
}

/** The button itself: a link, so it also works where pop-ups are blocked. */
export function WhatsAppButton({ phone, text }: { phone: string | null | undefined; text: string }) {
  const { t } = useI18n();
  const known = !!whatsappNumber(phone);
  return (
    <a className="btn" href={whatsappUrl(phone, text)} target="_blank" rel="noopener noreferrer" title={known ? t('sh_toNumber') : t('sh_pickChat')}>
      <Icon name="phone" size={16} />{t('sh_whatsapp')}
    </a>
  );
}

/** The company's name in the message's language. */
function useCompanyNames(): Names {
  const { settings } = useData();
  return settings?.companyName ?? { ar: '', en: '', ku: '' };
}

/** A message that goes with a PDF: the text, then a line saying the file is attached. */
export const withAttachment = (i18n: I18n, message: string): string => `${message}\n${i18n.t('wp_attached')}`;

/** A POS receipt for the customer: number and date, the total, how it was paid. */
export function receiptMessage(i18n: I18n, company: string, r: {
  number: string | null; date: string; total: number; currency: CurrencyCode; partyName?: string | null;
  payments?: readonly { kind: string; method: string; amount: number; currency: CurrencyCode }[];
}): string {
  const { t } = i18n;
  const paid = (r.payments ?? []).filter((p) => p.kind === 'pos').map((p) => `${t(`pay_${p.method}` as Key)} ${i18n.money(p.amount, p.currency)}`);
  return [
    company,
    r.partyName ? t('wp_hello', { name: r.partyName }) : null,
    t('wp_receipt', { n: r.number ? i18n.digitsOf(r.number) : '—', d: i18n.date(r.date) }),
    `${t('br_total')}: ${i18n.money(r.total, r.currency)}`,
    paid.length > 1 ? t('wp_paidBy', { m: paid.join('، ') }) : null,
    t('br_thanks')
  ].filter(Boolean).join('\n');
}

/** For an invoice page: sale invoices only, with the verify link once posted, sent with the invoice as a PDF. */
export function InvoiceWhatsApp({ invoice: v }: {
  /** the company's name in the app's language (the message uses the customer's) */
  company?: string;
  invoice: {
    id: string; kind: string; status: string; number: string | null; date: string; total: number; currency: CurrencyCode;
    partyName?: string | null; partyPhone?: string | null; partyLang?: Lang | null;
  };
}) {
  const i18n = useI18n();
  const names = useCompanyNames();
  const [verify, setVerify] = useState<string | null>(null);
  const posted = v.kind === 'sale' && v.status === 'posted';
  useEffect(() => {
    if (!posted) return;
    let live = true;
    request<{ url: string }>('GET', `/api/verify/invoices/${encodeURIComponent(v.id)}?lang=${i18n.lang}`)
      .then((a) => { if (live) setVerify(a.url); }, () => undefined);
    return () => { live = false; };
  }, [v.id, posted, i18n.lang]);
  const message = useCallback((m: I18n) => withAttachment(m, withVerifyLink(m, invoiceMessage(m, m.name(names), v), verify)), [names, v, verify]);
  if (v.kind !== 'sale' || v.status === 'draft') return null;
  return <WhatsAppSendButton kind="invoice" docRef={v.number ?? v.id} phone={v.partyPhone} lang={v.partyLang} message={message} />;
}

/** For a customer's or supplier's statement: the closing balance, sent with the statement as a PDF. */
export function StatementWhatsApp({ name, code, phone, lang, balance, date, currency = 'IQD' }: {
  /** the company's name in the app's language (the message uses the party's) */
  company?: string;
  name: string; code: string; phone?: string | null; lang?: Lang | null; balance: number; date: string; currency?: 'IQD' | 'USD';
}) {
  const names = useCompanyNames();
  const message = useCallback((m: I18n) => withAttachment(m, statementMessage(m, m.name(names), { name, balance, currency, date })), [names, name, balance, currency, date]);
  return <WhatsAppSendButton kind="statement" docRef={`${code}_${date}`} phone={phone} lang={lang} message={message} />;
}

/** For a quotation: sent with the quotation as a PDF. */
export function QuoteWhatsApp({ quote: q }: {
  quote: { number: string; date: string; total: number; currency: CurrencyCode; validUntil: string | null; customerName?: string | null; party?: { name: string; phone: string; lang?: Lang | null } | null };
}) {
  const names = useCompanyNames();
  const message = useCallback((m: I18n) => withAttachment(m, quoteMessage(m, m.name(names), { ...q, customerName: q.party?.name ?? q.customerName })), [names, q]);
  return <WhatsAppSendButton kind="quote" docRef={q.number} phone={q.party?.phone} lang={q.party?.lang} message={message} />;
}
