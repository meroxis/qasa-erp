import { useEffect, useRef, useState } from 'react';
import { rateFromX100, todayIso, type CurrencyCode } from '@qasa/core';
import { api, ApiError, type EntryView, type PartyView, type QuickVoucherInput, type VoucherApprovalState } from '../api.ts';
import { AccountCombo, AmountInput, ErrorBox, Icon, Modal, SearchCombo, useData, useLoad, useToast, type PickOption } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';
import { holdKey, type HeldKey } from './outbox.ts';
import { amountInIqd, balanceAfter, mayQuickVoucher, parseRateText, quickOutcome, type QuickKind } from './quick-voucher.ts';

/**
 * 1.4: "Receive payment" (a receipt voucher from a customer) and "Pay supplier" (a payment voucher), from a short
 * form: who, how much, in which currency, into or out of which safe or bank, the date and a note. The balance before
 * and what is left after show as the amount is typed. The server makes an ordinary voucher of it and says whether it
 * was posted, waits for approval, or is a draft for the usual checking.
 */

export interface QuickVoucherPreset {
  /** the customer or supplier (left out on the vouchers list: chosen in the form) */
  partyId?: string;
  /** an invoice the money is for: its number goes in the note, its total and currency in the amount */
  invoice?: { number: string | null; total: number; currency: CurrencyCode; rateX100: number };
}

export function QuickVoucherButton({ kind, preset, className = 'btn', onDone }: {
  kind: QuickKind; preset?: QuickVoucherPreset; className?: string; onDone?(entry: EntryView): void;
}) {
  const { t } = useI18n();
  const { permissions } = useData();
  const [open, setOpen] = useState(false);
  if (!mayQuickVoucher(kind, permissions)) return null;
  return (
    // (in a list the row itself opens the customer: a click on the button or in its form stays here)
    <span style={{ display: 'contents' }} onClick={(e) => e.stopPropagation()}>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Icon name="wallet" size={16} />{kind === 'receipt' ? t('s14_receive') : t('s14_paySupplier')}
      </button>
      {open && <QuickVoucherForm kind={kind} preset={preset ?? {}} onClose={() => setOpen(false)} onDone={(entry) => { setOpen(false); onDone?.(entry); }} />}
    </span>
  );
}

export function QuickVoucherForm({ kind, preset, onClose, onDone }: { kind: QuickKind; preset: QuickVoucherPreset; onClose(): void; onDone(entry: EntryView): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, reloadAccounts } = useData();
  const partyType = kind === 'receipt' ? 'customer' : 'supplier';
  const [partyId, setPartyId] = useState(preset.partyId ?? '');
  const [amount, setAmount] = useState<number | null>(preset.invoice?.total ?? null);
  const [currency, setCurrency] = useState<CurrencyCode>(preset.invoice?.currency ?? 'IQD');
  const [rateText, setRateText] = useState(() => String(rateFromX100(preset.invoice?.currency === 'USD' ? preset.invoice.rateX100 : settings?.defaultRateX100 ?? 142000)));
  const [cashAccount, setCashAccount] = useState(settings?.postingAccounts.cash ?? '');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState(preset.invoice?.number ? t('s14_forInvoice', { n: preset.invoice.number }) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // the same key while the form says the same thing: a second click, or a try whose answer was lost, makes one voucher
  const key = useRef<HeldKey | null>(null);
  // one fixed party: read fresh, for the balance now; otherwise the list to choose from
  const one = useLoad<PartyView | null>(() => (preset.partyId ? api.party(preset.partyId) : Promise.resolve(null)), [preset.partyId]);
  const list = useLoad<PartyView[]>(() => (preset.partyId ? Promise.resolve([]) : api.parties({ type: partyType, active: 'true' })), [preset.partyId, partyType]);
  const [approval, setApproval] = useState<VoucherApprovalState | null>(null);
  useEffect(() => { api.voucherApproval().then(setApproval, () => { /* an older server: nothing waits */ }); }, []);

  const party = preset.partyId ? one.data ?? null : list.data?.find((p) => p.id === partyId) ?? null;
  const options: PickOption[] = (list.data ?? []).map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone, hint: p.balance ? i18n.money(p.balance, 'IQD') : '' }));
  const rateX100 = currency === 'USD' ? parseRateText(rateText) : 100;
  const after = party ? balanceAfter(party.balance, amount, currency, rateX100) : null;
  const ready = !!party && amountInIqd(amount, currency, rateX100) !== null && !!cashAccount && !!date;

  async function save() {
    if (!party || !ready || busy) return;
    if (!rateX100) { setError(new ApiError(400, 'validation', [{ code: 'rate_invalid' }])); return; }
    const input: QuickVoucherInput = {
      kind, partyId: party.id, amount: amount ?? 0, currency, ...(currency === 'USD' ? { rateX100 } : {}), cashAccountCode: cashAccount, date,
      ...(note.trim() ? { note: note.trim() } : {})
    };
    setBusy(true);
    setError(null);
    try {
      key.current = holdKey(key.current, input);
      const entry = await api.quickVoucher(input, { key: key.current.key });
      const outcome = quickOutcome(entry);
      if (outcome === 'posted') await reloadAccounts();
      toast(outcome === 'posted' ? t('s14_posted', { n: entry.number ?? '' }) : outcome === 'waiting' ? t('s14_savedWaiting') : t('s14_savedDraft'));
      onDone(entry);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={kind === 'receipt' ? t('s14_receive') : t('s14_paySupplier')} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{kind === 'receipt' ? t('s14_receiveHelp') : t('s14_payHelp')}</p>
        <div className="field">
          <span>{kind === 'receipt' ? t('customer') : t('supplier')}</span>
          {preset.partyId
            ? <strong className="bidi">{party ? `${party.code} — ${party.name}` : '…'}</strong>
            : <SearchCombo value={partyId} options={options} onChange={setPartyId} placeholder={kind === 'receipt' ? t('chooseCustomer') : t('chooseSupplier')} ariaLabel={kind === 'receipt' ? t('customer') : t('supplier')} />}
        </div>
        <ErrorBox error={one.error ?? list.error} />
        <div className="grid-2">
          <div className="field">
            <span>{t('amount')}</span>
            <AmountInput key={currency} value={amount} currency={currency} onChange={setAmount} ariaLabel={t('amount')} />
          </div>
          <div className="field">
            <span>{t('currency')}</span>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <div className="track">
                {(['IQD', 'USD'] as const).map((c) => <button key={c} type="button" aria-pressed={currency === c} onClick={() => setCurrency(c)}>{c === 'IQD' ? t('iqdName') : t('usdName')}</button>)}
              </div>
              {currency === 'USD' && (
                <input className={'input amount' + (rateX100 ? '' : ' invalid')} style={{ width: 110 }} inputMode="decimal" aria-label={t('rate')} title={t('perUsd')} value={rateText} onChange={(e) => setRateText(e.target.value)} />
              )}
            </div>
          </div>
          <div className="field">
            <span>{kind === 'receipt' ? t('s14_into') : t('s14_outOf')}</span>
            <AccountCombo value={cashAccount} onChange={setCashAccount} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} />
          </div>
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <label className="field"><span>{t('notes')}</span><input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {party && (
          <div className="totals" role="status" style={{ alignSelf: 'stretch' }}>
            <span className="muted">{t('s14_balanceBefore')}</span><span className="num">{i18n.money(party.balance, 'IQD')}</span>
            <span>{t('s14_balanceAfter')}</span><strong className="num" style={{ fontSize: 18 }}>{after === null ? '—' : i18n.money(after, 'IQD')}</strong>
          </div>
        )}
        {after !== null && after < 0 && <div className="alert warn small">{t('s14_overpaid')}</div>}
        {approval?.on && !approval.mayApprove && <div className="alert info small">{t('s14_willWait')}</div>}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !ready} onClick={() => void save()}><Icon name="check" size={16} />{busy ? t('saving') : t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          {!preset.partyId && party && <a className="btn subtle" href={href(`party/${party.id}`)}>{t('statement')}</a>}
        </div>
      </div>
    </Modal>
  );
}
