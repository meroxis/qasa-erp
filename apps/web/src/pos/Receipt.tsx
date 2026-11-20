import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { InvoiceView } from '../api.ts';
import { useData } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import type { ShiftView } from '../industry/pos-api.ts';
import { PrintDocument } from '../industry/PrintDocument.tsx';
import { invoiceModel } from '../industry/print-model.ts';
import { usePrintSetup } from '../industry/print-api.ts';
import { printAlone } from '../industry/printing.ts';
import { receiptMessage, withAttachment } from '../industry/WhatsAppShare.tsx';
import { WhatsAppSendButton } from '../industry/WhatsAppSend.tsx';
import { loyaltyLines } from '../industry/Loyalty.tsx';
import { unitLabel } from '../industry/units.ts';

/* ---------- the receipt (80 mm) ---------- */

/** The last receipt to the customer's WhatsApp, as a PDF of the 80 mm receipt (a walk-in customer: type the number). */
export function ReceiptWhatsApp({ invoice }: { invoice: InvoiceView }) {
  const { settings } = useData();
  const names = settings?.companyName;
  const message = useCallback((m: I18n) => withAttachment(m, receiptMessage(m, names ? m.name(names) : '', invoice)), [names, invoice]);
  return <WhatsAppSendButton kind="receipt" docRef={invoice.number ?? invoice.id} phone={invoice.partyPhone} lang={invoice.partyLang} message={message} bodyClass="pos-printing" />;
}

/** The receipt alone, on the printer chosen for receipts (Settings → Printers) or through the print window. */
export function printReceipt() {
  return printAlone('receipt', 'pos-printing');
}

export function Receipt({ invoice, shift, rounding = 0 }: { invoice: InvoiceView; shift: ShiftView; rounding?: number }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings, plan } = useData();
  const setup = usePrintSetup();
  const company = settings ? i18n.name(settings.companyName) : '';
  // 1.2 (Pro): the points the sale used and earned, and the customer's balance
  const points = loyaltyLines(i18n, invoice.loyalty);
  // a sale from when the till still asked for the amount paid: what was paid and the change, kept by the server with
  // the sale, print again under the total on a copy of its receipt. The till no longer asks, so new sales carry none
  const handed = invoice.tender ?? null;
  const tenderRows = handed && (
    <>
      <div className="pos-r-row small"><span>{t('pos_paid')}</span><span className="num">{i18n.money(handed.paid, invoice.currency)}</span></div>
      <div className="pos-r-row small"><span>{t('pos_change')}</span><span className="num">{i18n.money(handed.change, invoice.currency)}</span></div>
    </>
  );
  // a receipt design of the company's own (Settings → Print design) replaces the standard receipt
  if (setup.designs.pos) {
    return createPortal(
      <div className="pos-receipt-host" dir={i18n.dir} lang={i18n.lang === 'ku' ? 'ckb' : i18n.lang}>
        <PrintDocument
          model={{ ...invoiceModel(invoice, { pos: true }), tender: handed }} design={setup.designs.pos} profile={setup.profile}
          company={settings?.companyName ?? { ar: '', en: '', ku: '' }} branding={!plan?.features.includes('noBranding')}
          defaultRateX100={settings?.defaultRateX100}
        />
        {points.length > 0 && <div className="pos-receipt pos-r-loyalty">{points.map(([label, value]) => <div key={label} className="pos-r-row small"><span>{label}</span><span className="num">{value}</span></div>)}</div>}
      </div>,
      document.body
    );
  }
  return createPortal(
    <div className="pos-receipt-host" dir={i18n.dir} lang={i18n.lang === 'ku' ? 'ckb' : i18n.lang}>
      <div className="pos-receipt">
        <div className="pos-r-center"><strong className="pos-r-company">{company}</strong></div>
        <div className="pos-r-center small">{t('pos_receipt')}</div>
        <div className="pos-r-row small"><span>{t('pos_no')}</span><span className="num ltr">{invoice.number}</span></div>
        {invoice.offlineRef && invoice.number === invoice.offlineRef && <div className="pos-r-center small pos-r-offline">{t('pos_offlineReceipt')}</div>}
        <div className="pos-r-row small"><span>{t('pos_dateTime')}</span><span className="num ltr">{i18n.date(invoice.date)} {i18n.digitsOf(new Date(invoice.postedAt ?? invoice.createdAt).toTimeString().slice(0, 5))}</span></div>
        <div className="pos-r-row small"><span>{t('pos_cashier')}</span><span>{shift.openedBy === invoice.createdBy ? shift.openedBy : invoice.createdBy}</span></div>
        {invoice.partyName && <div className="pos-r-row small"><span>{t('pos_customer')}</span><span>{invoice.partyName}</span></div>}
        <div className="pos-r-sep" />
        {invoice.lines.map((l) => (
          <div key={l.lineNo} className="pos-r-line">
            <div>{i18n.name(l.itemName)}</div>
            <div className="pos-r-row small">
              <span className="num">{i18n.qty(l.lineUnit && l.unitQtyMilli !== null ? l.unitQtyMilli : l.qtyMilli)}{l.lineUnit ? ` ${unitLabel(i18n, l.lineUnit)}` : ''} × {i18n.money(l.unitPrice, invoice.currency)}</span>
              <span className="num">{i18n.money(l.amount, invoice.currency)}</span>
            </div>
          </div>
        ))}
        <div className="pos-r-sep" />
        {(invoice.offers ?? []).map((o) => (
          <div key={o.offerId} className="pos-r-row"><span>{i18n.name(o.names)}</span><span className="num">−{i18n.money(o.discount, invoice.currency)}</span></div>
        ))}
        {invoice.discount - (invoice.offerDiscount ?? 0) > 0 && (
          <div className="pos-r-row"><span>{t('pos_discount')}</span><span className="num">−{i18n.money(invoice.discount - (invoice.offerDiscount ?? 0), invoice.currency)}</span></div>
        )}
        <div className="pos-r-row pos-r-total"><span>{t('pos_total')}</span><span className="num">{i18n.money(invoice.total, invoice.currency)}</span></div>
        {(invoice.payments ?? []).filter((p) => p.kind === 'pos').map((p) => (
          <div key={p.id} className="pos-r-row small"><span>{t(`pay_${p.method}` as Key)}</span><span className="num">{i18n.money(p.amount, p.currency)}</span></div>
        ))}
        {/* 2.0: the dinar rounding of the cash (no small coins): what it added or took off, and the cash paid */}
        {rounding !== 0 && <div className="pos-r-row small"><span>{t('tu_rounding')}</span><span className="num">{rounding > 0 ? '+' : '−'}{i18n.money(Math.abs(rounding), 'IQD')}</span></div>}
        {tenderRows}
        {points.length > 0 && <div className="pos-r-sep" />}
        {points.map(([label, value]) => <div key={label} className="pos-r-row small"><span>{label}</span><span className="num">{value}</span></div>)}
        <div className="pos-r-sep" />
        <div className="pos-r-center small">{t('pos_thanks')}</div>
        {!plan?.features.includes('noBranding') && <div className="pos-r-center small">{t('madeWith')} · <span className="ltr">qasaerp.com</span></div>}
      </div>
    </div>,
    document.body
  );
}

