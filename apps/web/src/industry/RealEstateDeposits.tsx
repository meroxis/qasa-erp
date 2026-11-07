import { useState } from 'react';
import { rateToX100, todayIso, toWesternDigits, type CurrencyCode } from '@qasa/core';
import { api, type PartyView } from '../api.ts';
import { AccountCombo, AmountInput, ErrorBox, Icon, Modal, SearchCombo, useData, useLoad, useToast, type PickOption } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';
import { realEstateApi, type DepositStatus, type ReDepositView, type ReUnitView } from './real-estate-api.ts';
import { useFxRate } from './fx-prefill.ts';

/**
 * عربون الحجز on a unit's panel: the deposits taken (each a posted receipt), what is still held, and taking, refunding or
 * forfeiting one. Refunds and forfeits are drafts that go through checking and approval on the vouchers page; while still
 * a draft they can be taken back here.
 */

const CHIP: Record<DepositStatus, string> = { held: 'warn', applied: 'ok', refunded: '', forfeited: 'bad' };
const unitLabel = (u: Pick<ReUnitView, 'building' | 'code'>) => (u.building ? `${u.building}-${u.code}` : u.code);

type Dialog = { kind: 'take' } | { kind: 'refund' | 'forfeit'; deposit: ReDepositView } | null;

export function UnitDeposits({ unit, currency, onChanged }: { unit: ReUnitView; currency: CurrencyCode; onChanged(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { data, error, reload } = useLoad(() => realEstateApi.unit(unit.id), [unit.id, unit.status, unit.depositHeld]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const deposits = data?.deposits ?? [];
  const canTake = unit.actions.includes('deposit');
  if (!canTake && deposits.length === 0) return null;

  const done = (message: string) => {
    setDialog(null);
    toast(message);
    reload();
    onChanged();
  };
  async function reopen(d: ReDepositView) {
    setBusy(true);
    try {
      await realEstateApi.reopenDeposit(d.entryId);
      done(t('dep_reopened'));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8, borderBlockStart: '1px solid var(--line)', paddingBlockStart: 10 }}>
      <div className="row">
        <span style={{ fontWeight: 600 }}>{t('dep_title')}</span>
        <span className="spacer" />
        {unit.depositHeld > 0 && <span className="chip warn num">{t('dep_held')}: {i18n.money(unit.depositHeld, currency)}</span>}
      </div>
      {error ? <ErrorBox error={error} /> : null}
      {deposits.map((d) => (
        <div key={d.entryId} className="stack" style={{ gap: 4, padding: 8, border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <strong className="num">{i18n.money(d.amount, d.currency)}</strong>
            <span className={'chip ' + (d.reversed ? 'bad' : CHIP[d.status])}>{d.reversed ? t('dep_reversed') : t(`dep_st_${d.status}`)}</span>
            <span className="spacer" />
            <span className="small num muted">{i18n.date(d.date)}</span>
          </div>
          <div className="small">
            <a className="ltr" href={href(`entry/${d.entryId}`)}>{d.entryNumber ?? '—'}</a>
            {' · '}{d.party.name}
            {d.closeEntry && <> · <a href={href(`entry/${d.closeEntry.id}`)}>{d.closeEntry.status === 'draft' ? t('dep_closeDraft') : t('dep_closeEntry')}</a></>}
          </div>
          {d.closeEntry?.status === 'draft' && <p className="small muted" style={{ margin: 0 }}>{t('dep_draftHelp')}</p>}
          {d.actions.length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {d.actions.includes('refund') && <button type="button" className="btn small" onClick={() => setDialog({ kind: 'refund', deposit: d })}><Icon name="undo" size={15} />{t('dep_refund')}</button>}
              {d.actions.includes('forfeit') && <button type="button" className="btn small" onClick={() => setDialog({ kind: 'forfeit', deposit: d })}><Icon name="x" size={15} />{t('dep_forfeit')}</button>}
              {d.actions.includes('reopen') && <button type="button" className="btn small" disabled={busy} onClick={() => void reopen(d)}><Icon name="undo" size={15} />{t('dep_reopen')}</button>}
            </div>
          )}
        </div>
      ))}
      {deposits.length === 0 && <p className="small muted" style={{ margin: 0 }}>{t('dep_none')}</p>}
      {canTake && <div className="row"><button type="button" className="btn" onClick={() => setDialog({ kind: 'take' })}><Icon name="wallet" size={16} />{t('dep_take')}</button></div>}

      {dialog?.kind === 'take' && <TakeModal unit={unit} currency={currency} onClose={() => setDialog(null)} onDone={() => done(t('dep_taken'))} />}
      {dialog?.kind === 'refund' && <RefundModal unit={unit} deposit={dialog.deposit} onClose={() => setDialog(null)} onDone={() => done(t('dep_refundDrafted'))} />}
      {dialog?.kind === 'forfeit' && <ForfeitModal unit={unit} deposit={dialog.deposit} onClose={() => setDialog(null)} onDone={() => done(t('dep_forfeitDrafted'))} />}
    </div>
  );
}

const rateValue = (s: string) => rateToX100(Number(toWesternDigits(s)));

function TakeModal({ unit: u, currency, onClose, onDone }: { unit: ReUnitView; currency: CurrencyCode; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const customers = useLoad(() => api.parties({ type: 'customer', active: 'true' }), []);
  const options: PickOption[] = (customers.data ?? []).map((p: PartyView) => ({ id: p.id, code: p.code, label: p.name, search: p.phone }));
  const [partyId, setPartyId] = useState(u.party?.id ?? '');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayIso());
  const [until, setUntil] = useState(u.reservedUntil ?? '');
  const [cash, setCash] = useState(settings?.postingAccounts.cash ?? '');
  const [rate, setRate] = useFxRate(currency, date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await realEstateApi.takeDeposit(u.id, {
        partyId, amount: amount ?? 0, date, cashAccountCode: cash, lang: i18n.lang,
        ...(until ? { until } : {}), ...(currency === 'USD' && rate ? { rateX100: rateValue(rate) } : {})
      });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={t('dep_takeTitle', { n: unitLabel(u) })} onClose={onClose}>
      <div className="stack">
        <div className="field">
          <span>{t('customer')}</span>
          {u.status === 'reserved' && u.party ? <input className="input" disabled value={u.party.name} /> : <SearchCombo value={partyId} options={options} onChange={setPartyId} placeholder={t('customer')} />}
        </div>
        <div className="grid-2">
          <label className="field"><span>{t('dep_amount')}</span><AmountInput value={amount} currency={currency} onChange={setAmount} ariaLabel={t('dep_amount')} /></label>
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>{t('re_reservedUntil')}</span><input className="input" type="date" min={todayIso()} value={until} onChange={(e) => setUntil(e.target.value)} /></label>
          {currency === 'USD' && <label className="field"><span>{t('exchangeRate')}</span><input className="input num ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>}
        </div>
        <div className="field"><span>{t('cashAccount')}</span><AccountCombo value={cash} onChange={setCash} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} /></div>
        <p className="muted small" style={{ margin: 0 }}>{t('dep_takeHelp')}</p>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !partyId || !amount || !cash} onClick={() => void submit()}><Icon name="check" size={16} />{t('dep_take')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function RefundModal({ unit: u, deposit: d, onClose, onDone }: { unit: ReUnitView; deposit: ReDepositView; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const [date, setDate] = useState(todayIso());
  const [cash, setCash] = useState(settings?.postingAccounts.cash ?? '');
  const [rate, setRate] = useFxRate(d.currency, date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await realEstateApi.refundDeposit(d.entryId, { date, cashAccountCode: cash, lang: i18n.lang, ...(d.currency === 'USD' && rate ? { rateX100: rateValue(rate) } : {}) });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={t('dep_refundTitle', { n: unitLabel(u) })} onClose={onClose}>
      <div className="stack">
        <p style={{ margin: 0 }}>{t('dep_refundHelp', { a: i18n.money(d.amount, d.currency), p: d.party.name })}</p>
        <div className="grid-2">
          <label className="field"><span>{t('date')}</span><input className="input" type="date" min={d.date} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {d.currency === 'USD' && <label className="field"><span>{t('exchangeRate')}</span><input className="input num ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>}
        </div>
        <div className="field"><span>{t('cashAccount')}</span><AccountCombo value={cash} onChange={setCash} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} /></div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !cash} onClick={() => void submit()}><Icon name="undo" size={16} />{t('dep_refund')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function ForfeitModal({ unit: u, deposit: d, onClose, onDone }: { unit: ReUnitView; deposit: ReDepositView; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [date, setDate] = useState(todayIso());
  const [account, setAccount] = useState('49');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await realEstateApi.forfeitDeposit(d.entryId, { date, lang: i18n.lang, ...(account && account !== '49' ? { accountCode: account } : {}) });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={t('dep_forfeitTitle', { n: unitLabel(u) })} onClose={onClose}>
      <div className="stack">
        <p style={{ margin: 0 }}>{t('dep_forfeitHelp', { a: i18n.money(d.amount, d.currency), p: d.party.name })}</p>
        <label className="field"><span>{t('date')}</span><input className="input" type="date" min={d.date} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <div className="field"><span>{t('dep_forfeitAccount')}</span><AccountCombo value={account} onChange={setAccount} filter={(a) => a.code.startsWith('4')} ariaLabel={t('dep_forfeitAccount')} /></div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !account} onClick={() => void submit()}><Icon name="x" size={16} />{t('dep_forfeit')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

