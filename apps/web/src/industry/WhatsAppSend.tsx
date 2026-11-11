import { useMemo, useState } from 'react';
import { isLang, type Lang } from '@qasa/core';
import { Icon, LANGUAGE_NAMES, Modal } from '../components.tsx';
import { makeI18n, useI18n, type I18n, type Key } from '../i18n.ts';
import { displayPhone, whatsappNumber, whatsappUrl } from '../share.ts';
import { printAlone, printDocument } from './printing.ts';
import { desktopShare, makePdf, PDF_CLASS, PRINT_KIND_OF, type PdfOutcome, type ShareKind } from './whatsapp-pdf.ts';

/**
 * "Send on WhatsApp" with the document as a PDF: invoices, POS receipts, quotations, account statements and the
 * end-of-day close. A dialog shows the number (an Iraqi mobile, checked and written back as +964 …), the language of the
 * message (the customer's own, else the app's) and the message itself, which the person may change. In the Windows app
 * one click makes the PDF in the app's own folder, shows it in File Explorer and opens WhatsApp with the message; the
 * person drags the file into the chat and presses Send. Nothing is ever sent without their click.
 */

const TITLE: Record<ShareKind, Key> = {
  invoice: 'wp_title_invoice', receipt: 'wp_title_receipt', quote: 'wp_title_quote', statement: 'wp_title_statement', dayclose: 'wp_title_dayclose'
};

export interface WhatsAppSendProps {
  kind: ShareKind;
  /** the document's number (for the file's name): INV-2026-0001, a customer code and a date … */
  docRef: string;
  phone?: string | null | undefined;
  /** the customer's language for messages (null: the app's) */
  lang?: Lang | null | undefined;
  /** the message, written by the i18n of the language picked */
  message(i18n: I18n): string;
  /** a class that puts only part of the page on paper (the POS receipt's "pos-printing") */
  bodyClass?: string | undefined;
}

/** What the number field says: nothing yet, the number as WhatsApp gets it, or that it isn't one. */
export function phoneState(phone: string): { ok: true; shown: string | null } | { ok: false } {
  if (!phone.trim()) return { ok: true, shown: null };
  const shown = displayPhone(phone);
  return shown ? { ok: true, shown } : { ok: false };
}

/** A sentence with a phone number in it: the number kept left to right inside Arabic and Kurdish text. */
function NumberIn({ text, number }: { text: string; number: string }) {
  const [before, after] = text.split('\u0000');
  return <>{before}<bdi dir="ltr" className="num">{number}</bdi>{after}</>;
}

/** Opens WhatsApp with the message, to the number when it is one (the app's usual wa.me link). */
function openChat(phone: string, text: string): void {
  window.open(whatsappUrl(whatsappNumber(phone) ? phone : null, text), '_blank', 'noopener,noreferrer');
}

export function WhatsAppSendButton(props: WhatsAppSendProps & { label?: Key; primary?: boolean; disabled?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const known = !!whatsappNumber(props.phone);
  return (
    <>
      <button type="button" className={'btn' + (props.primary ? ' primary' : '')} disabled={props.disabled} onClick={() => setOpen(true)}
        title={known ? (props.kind === 'dayclose' ? t('br_ownerPhone') : t('sh_toNumber')) : t('sh_pickChat')}>
        <Icon name="phone" size={16} />{t(props.label ?? 'wp_send')}
      </button>
      {open && <WhatsAppSendModal {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

export function WhatsAppSendModal({ kind, docRef, phone: initialPhone, lang: initialLang, message, bodyClass, onClose }: WhatsAppSendProps & { onClose(): void }) {
  const app = useI18n();
  const { t } = app;
  const [phone, setPhone] = useState(initialPhone ?? '');
  const [lang, setLang] = useState<Lang>(initialLang && isLang(initialLang) ? initialLang : app.lang);
  const written = useMemo(() => message(makeI18n(lang, app.digits, () => {}, () => {})), [message, lang, app.digits]);
  // the person's own changes to the message; a new language writes it anew
  const [edited, setEdited] = useState<string | null>(null);
  const text = edited ?? written;
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PdfOutcome | null>(null);
  const desktop = desktopShare();
  const number = phoneState(phone);

  const send = async () => {
    if (!number.ok || busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      const made = await makePdf(kind, docRef, { bodyClass, desktop });
      setOutcome(made);
      // the chat opens only once the file is there to attach
      if (made?.status === 'saved') openChat(phone, text);
    } finally {
      setBusy(false);
    }
  };

  /** In a browser: the print window, where the person picks "Save as PDF" (the dialog stays off the paper). */
  const printPdf = async () => {
    document.body.classList.add(PDF_CLASS);
    try {
      await (bodyClass ? printAlone(PRINT_KIND_OF[kind], bodyClass) : printDocument(PRINT_KIND_OF[kind]));
    } finally {
      document.body.classList.remove(PDF_CLASS);
    }
  };

  const saved = outcome?.status === 'saved' ? outcome.name : null;
  return (
    <Modal title={t(TITLE[kind])} onClose={onClose}>
      <div className="stack wa-send">
        <p className="muted small" style={{ margin: 0 }}>{desktop ? t('wp_how') : t('wp_browserHelp')}</p>
        <div className="grid-2">
          <label className="field">
            <span>{t('wp_phone')}</span>
            <input className="input ltr" dir="ltr" inputMode="tel" maxLength={30} value={phone} placeholder="0750 123 4567"
              aria-invalid={!number.ok} onChange={(e) => { setPhone(e.target.value); setOutcome(null); }} />
          </label>
          <label className="field">
            <span>{t('wp_lang')}</span>
            <select className="input" value={lang} onChange={(e) => { if (isLang(e.target.value)) { setLang(e.target.value); setEdited(null); } }}>
              {LANGUAGE_NAMES.map(([l, label]) => <option key={l} value={l}>{label}</option>)}
            </select>
          </label>
        </div>
        {number.ok
          ? <div className="small muted">{number.shown ? <NumberIn text={t('wp_phoneOk', { n: '\u0000' })} number={number.shown} /> : t('sh_pickChat')}</div>
          : <div className="small" role="alert" style={{ color: 'var(--bad)' }}>{t('br_phoneInvalid')}</div>}
        <label className="field">
          <span>{t('wp_message')}</span>
          <textarea className="input" rows={8} maxLength={3000} dir={lang === 'en' ? 'ltr' : 'rtl'} value={text} onChange={(e) => setEdited(e.target.value)} />
        </label>
        {busy && <div className="alert info" role="status">{t('wp_working')}</div>}
        {saved && <div className="alert ok" role="status">{t('wp_saved', { n: saved })}</div>}
        {outcome && outcome.status !== 'saved' && <div className="alert bad" role="alert">{t(outcome.status === 'busy' ? 'wp_busy' : 'wp_failed')}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={onClose}>{t('wp_close')}</button>
          {(!desktop || (outcome && outcome.status !== 'saved')) && (
            <button type="button" className="btn" onClick={() => void printPdf()}><Icon name="printer" size={16} />{t('wp_printPdf')}</button>
          )}
          {desktop && !saved && (
            <button type="button" className="btn primary" disabled={busy || !number.ok || !text.trim()} onClick={() => void send()}>
              <Icon name="phone" size={16} />{t('wp_makePdf')}
            </button>
          )}
          {(saved || !desktop) && (
            <button type="button" className={'btn' + (saved ? '' : ' primary')} disabled={!number.ok || !text.trim()} onClick={() => openChat(phone, text)}>
              <Icon name="phone" size={16} />{t(saved ? 'wp_again' : 'wp_openWhatsApp')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
