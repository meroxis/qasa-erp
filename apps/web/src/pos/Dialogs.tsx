import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { todayIso } from '@qasa/core';
import { AmountInput, ErrorBox, Icon, Modal, useData } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { barcodeFor, barsPath } from '../industry/barcode.ts';
import { encodeQr, qrSvgPath } from '../industry/qr.ts';
import { printAlone } from '../industry/printing.ts';
import { tillRulesApi, type GiftVoucherView } from './rules-api.ts';
import { KEYPAD, padPress, type PadKey } from './feedback.ts';

/** The till's shortcuts, as the till uses them (TILL_KEYS in Register.tsx), with what each one does. */
export const TILL_KEYS: readonly { key: string; label: Key }[] = [
  { key: 'F1', label: 'tu_k_help' },
  { key: 'F2', label: 'tu_k_search' },
  { key: 'F3', label: 'tu_k_customer' },
  { key: 'F4', label: 'tu_k_clear' },
  { key: 'F6', label: 'tu_k_hold' },
  { key: 'F7', label: 'tu_k_qty' },
  { key: 'F8', label: 'tu_k_discount' },
  { key: 'F9', label: 'tu_k_pay' },
  { key: 'F10', label: 'tu_k_print' },
  { key: 'Ctrl+Enter', label: 'tu_k_exact' },
  { key: 'Ctrl+Delete', label: 'tu_k_removeLast' },
  { key: 'Esc', label: 'tu_k_esc' }
];

export function ShortcutsHelp({ onClose }: { onClose(): void }) {
  const { t } = useI18n();
  return (
    <Modal title={t('tu_help')} onClose={onClose}>
      <table className="table pos-keys">
        <tbody>
          {TILL_KEYS.map((k) => <tr key={k.key}><td><span className="kbd ltr">{k.key}</span></td><td>{t(k.label)}</td></tr>)}
          <tr><td><span className="kbd ltr">3*</span></td><td>{t('pos_searchPlaceholder')}</td></tr>
        </tbody>
      </table>
    </Modal>
  );
}

/** A number typed with the on-screen keypad (touch mode): whole dinars, or a quantity. */
export function Keypad({ value, onChange, onDone, label }: { value: string; onChange(v: string): void; onDone(): void; label: string }) {
  const { t, digitsOf } = useI18n();
  return (
    <div className="pos-keypad" role="group" aria-label={label}>
      <div className="pos-keypad-show num ltr" aria-live="polite">{digitsOf(value || '0')}</div>
      {KEYPAD.map((k: PadKey) => (
        <button key={k} type="button" className="btn pos-key" aria-label={k === '⌫' ? 'Backspace' : k} onClick={() => onChange(padPress(value, k))}>{k === '⌫' ? <Icon name="undo" size={18} /> : digitsOf(k)}</button>
      ))}
      <button type="button" className="btn primary pos-key pos-key-ok" onClick={onDone}><Icon name="check" size={18} />{t('tu_padOk')}</button>
    </div>
  );
}

/** A quantity for the last line, typed (F7). */
export function QtyDialog({ name, qtyMilli, weighed, onDone, onClose }: { name: string; qtyMilli: number; weighed: boolean; onDone(qtyMilli: number): void; onClose(): void }) {
  const { t } = useI18n();
  const [text, setText] = useState(String(qtyMilli / 1000));
  const n = Number(text.replace(',', '.'));
  const ok = Number.isFinite(n) && n > 0 && n <= 1_000_000 && (weighed || Number.isInteger(n * 1000));
  return (
    <Modal title={`${t('tu_k_qty')}: ${name}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (ok) onDone(Math.round(n * 1000)); }}>
        <input className="input pos-big-input num ltr" inputMode="decimal" autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label={t('pos_qty')} />
        <div className="row"><button type="submit" className="btn primary pos-touch" disabled={!ok}>{t('tu_padOk')}</button></div>
      </form>
    </Modal>
  );
}

/** A line's price changed by hand (a supervisor approves a lower one when the company says so). */
export function PriceDialog({ name, price, currency, onDone, onClose }: { name: string; price: number; currency: 'IQD' | 'USD'; onDone(price: number): void; onClose(): void }) {
  const { t } = useI18n();
  const [value, setValue] = useState<number | null>(price);
  return (
    <Modal title={`${t('tu_priceEdit')}: ${name}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (value !== null && value >= 0) onDone(value); }}>
        <label className="field"><span>{t('tu_price')}</span><AmountInput value={value} currency={currency} onChange={setValue} ariaLabel={t('tu_price')} /></label>
        <div className="row"><button type="submit" className="btn primary pos-touch" disabled={value === null}>{t('tu_padOk')}</button></div>
      </form>
    </Modal>
  );
}

/** The open-price item: an amount up to the most allowed, and what it is (both go with the sale). */
export function MiscDialog({ max, onDone, onClose }: { max: number; onDone(amount: number, note: string): void; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const ok = amount !== null && amount > 0 && amount <= max && note.trim().length > 0;
  return (
    <Modal title={t('tu_misc')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (ok) onDone(amount!, note.trim()); }}>
        <label className="field"><span>{t('tu_miscAmount')} <span className="muted small">{t('tu_miscMax', { n: i18n.money(max, 'IQD') })}</span></span>
          <AmountInput value={amount} currency="IQD" onChange={setAmount} ariaLabel={t('tu_miscAmount')} />
        </label>
        <label className="field"><span>{t('tu_miscNote')}</span><input className="input" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="row"><button type="submit" className="btn primary pos-touch" disabled={!ok}><Icon name="plus" size={18} />{t('tu_miscAdd')}</button></div>
      </form>
    </Modal>
  );
}

/** Sells a gift voucher at the till (cash into the drawer), then shows it ready to print. */
export function VoucherSellDialog({ shiftId, onSold, onClose }: { shiftId: string; onSold(v: GiftVoucherView): void; onClose(): void }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState<number | null>(null);
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sold, setSold] = useState<GiftVoucherView | null>(null);
  const sell = async () => {
    if (!amount || busy) return;
    setBusy(true);
    setError(null);
    try {
      const v = await tillRulesApi.sellVoucher(shiftId, amount, expiry || undefined);
      setSold(v);
      onSold(v);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  if (sold) {
    return (
      <Modal title={t('tu_gvSold', { code: sold.code })} onClose={onClose}>
        <div className="stack">
          <VoucherCard voucher={sold} />
          <div className="row">
            <button type="button" className="btn primary pos-touch" onClick={() => void printAlone('receipt', 'pos-printing-voucher')}><Icon name="printer" size={18} />{t('tu_gvPrint')}</button>
            <button type="button" className="btn pos-touch" onClick={onClose}>{t('pos_done')}</button>
          </div>
          {createPortal(<div className="pos-voucher-host"><VoucherCard voucher={sold} /></div>, document.body)}
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={t('tu_gvSell')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void sell(); }}>
        <label className="field"><span>{t('tu_gvAmount')}</span><AmountInput value={amount} currency="IQD" onChange={setAmount} ariaLabel={t('tu_gvAmount')} /></label>
        <label className="field"><span>{t('tu_gvExpiry')}</span><input className="input" type="date" min={todayIso()} value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row"><button type="submit" className="btn primary pos-touch" disabled={busy || !amount}><Icon name="check" size={18} />{t('tu_gvSell')}</button></div>
      </form>
    </Modal>
  );
}

/** The voucher as it prints on the receipt roll: the company, the value, the code as a QR and as a barcode. */
export function VoucherCard({ voucher }: { voucher: GiftVoucherView }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const qr = useMemo(() => qrSvgPath(encodeQr(voucher.code, 'M'), 2), [voucher.code]);
  const bars = useMemo(() => barcodeFor(voucher.code), [voucher.code]);
  return (
    <div className="pos-voucher pos-receipt">
      <div className="pos-r-center"><strong className="pos-r-company">{settings ? i18n.name(settings.companyName) : ''}</strong></div>
      <div className="pos-r-center">{t('tu_gv')}</div>
      <div className="pos-r-center pos-voucher-value num">{i18n.money(voucher.amount, 'IQD')}</div>
      <div className="pos-r-center">
        <svg role="img" aria-label={voucher.code} width={120} height={120} viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" style={{ background: '#fff' }}>
          <path d={qr.path} fill="#000" />
        </svg>
      </div>
      {bars && (
        <div className="pos-r-center">
          <svg width={Math.min(260, bars.modules * 1.4)} height={44} viewBox={`0 0 ${bars.modules} 40`} preserveAspectRatio="none" aria-hidden="true">
            <path d={barsPath(bars.widths, 40)} fill="#000" />
          </svg>
          <div className="num ltr small">{voucher.code}</div>
        </div>
      )}
      {voucher.expiresOn && <div className="pos-r-center small">{t('tu_gvValidUntil', { d: i18n.date(voucher.expiresOn) })}</div>}
      <div className="pos-r-center small">{t('tu_gvKeep')}</div>
    </div>
  );
}

/** Pays part of the sale with a gift voucher: the code (typed or scanned), its balance, and how much of it to use. */
export function VoucherPayDialog({ due, onUse, onClose }: { due: number; onUse(code: string, amount: number): void; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [code, setCode] = useState('');
  const [found, setFound] = useState<GiftVoucherView | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const check = async () => {
    setError(null);
    setFound(null);
    try {
      const v = await tillRulesApi.lookupVoucher(code.trim());
      setFound(v);
      setAmount(Math.min(v.balance, due));
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Modal title={t('tu_gvPay')} onClose={onClose}>
      <div className="stack">
        <form className="row" onSubmit={(e) => { e.preventDefault(); void check(); }}>
          <input className="input pos-big-input ltr" autoFocus maxLength={40} placeholder={t('tu_gvCode')} aria-label={t('tu_gvCode')} value={code} onChange={(e) => setCode(e.target.value)} />
          <button type="submit" className="btn" disabled={code.trim().length < 4}>{t('tu_gvCheck')}</button>
        </form>
        <ErrorBox error={error} />
        {found && !found.usable && <div className="alert bad" role="alert">{t('tu_gvNotUsable')}</div>}
        {found?.usable && (
          <>
            <div className="pos-r-row"><span>{t('tu_gvBalance', { n: i18n.money(found.balance, 'IQD') })}</span>{found.expiresOn && <span className="muted small">{t('tu_gvValidUntil', { d: i18n.date(found.expiresOn) })}</span>}</div>
            <AmountInput value={amount} currency="IQD" onChange={setAmount} ariaLabel={t('tu_miscAmount')} />
            <button type="button" className="btn primary pos-touch" disabled={!amount || amount > found.balance || amount > due}
              onClick={() => onUse(found.code, amount!)}>{t('tu_gvUse', { n: i18n.money(amount ?? 0, 'IQD') })}</button>
          </>
        )}
      </div>
    </Modal>
  );
}
