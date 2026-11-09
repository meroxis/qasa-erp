import { useEffect, useState } from 'react';
import type { CurrencyCode } from '@qasa/core';
import { request } from '../api.ts';
import { Icon } from '../components.tsx';
import { useI18n, type I18n } from '../i18n.ts';
import { invoiceMessage, statementMessage, whatsappNumber, whatsappUrl } from '../share.ts';

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

/** For an invoice page: sale invoices only, with the verify link once posted. */
export function InvoiceWhatsApp({ company, invoice: v }: {
  company: string;
  invoice: { id: string; kind: string; status: string; number: string | null; date: string; total: number; currency: CurrencyCode; partyName?: string | null; partyPhone?: string | null };
}) {
  const i18n = useI18n();
  const [verify, setVerify] = useState<string | null>(null);
  const posted = v.kind === 'sale' && v.status === 'posted';
  useEffect(() => {
    if (!posted) return;
    let live = true;
    request<{ url: string }>('GET', `/api/verify/invoices/${encodeURIComponent(v.id)}?lang=${i18n.lang}`)
      .then((a) => { if (live) setVerify(a.url); }, () => undefined);
    return () => { live = false; };
  }, [v.id, posted, i18n.lang]);
  if (v.kind !== 'sale' || v.status === 'draft') return null;
  return <WhatsAppButton phone={v.partyPhone} text={withVerifyLink(i18n, invoiceMessage(i18n, company, v), verify)} />;
}

/** For a customer's or supplier's statement: the closing balance (in dinars). */
export function StatementWhatsApp({ company, name, phone, balance, date, currency = 'IQD' }: {
  company: string; name: string; phone?: string | null; balance: number; date: string; currency?: 'IQD' | 'USD';
}) {
  const i18n = useI18n();
  return <WhatsAppButton phone={phone} text={statementMessage(i18n, company, { name, balance, currency, date })} />;
}
