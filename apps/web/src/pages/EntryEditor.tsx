import { useEffect, useState } from 'react';
import { amountInWords, rateFromX100, todayIso, toWesternDigits, type CurrencyCode } from '@qasa/core';
import { api, ApiError, type EntryView, type JournalInput, type VoucherInput } from '../api.ts';
import { AccountCombo, AmountInput, ErrorBox, Icon, SearchCombo, useData, useLoad, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { go } from '../router.ts';

type Kind = 'receipt' | 'payment' | 'journal';

interface Row {
  key: number;
  accountCode: string;
  debit: number | null;
  credit: number | null;
  description: string;
  partyId: string;
}

let rowKey = 1;
const emptyRow = (): Row => ({ key: rowKey++, accountCode: '', debit: null, credit: null, description: '', partyId: '' });

/** Lines on customer (16…) or supplier (26…) accounts can name who they belong to, so it shows on their statement. */
const partyTypeFor = (code: string) => (code.startsWith('16') ? 'customer' : code.startsWith('26') ? 'supplier' : null);

/** Parses "1420", "1,420.50" or "١٤٢٠" into IQD per USD × 100. */
function parseRate(text: string): number | null {
  const s = toWesternDigits(text).replace(/[,٬\s]/g, '').replace('٫', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const value = Math.round(Number(s) * 100);
  return value > 0 ? value : null;
}

export function EntryEditor({ kind: initialKind, id }: { kind?: Kind; id?: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, accounts, reloadAccounts } = useData();
  const [kind, setKind] = useState<Kind>(initialKind ?? 'receipt');
  const [loadError, setLoadError] = useState<unknown>(null);
  const [ready, setReady] = useState(!id);
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [party, setParty] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  const [rateText, setRateText] = useState('');
  const [cashAccount, setCashAccount] = useState('');
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(), emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const parties = useLoad(() => api.parties({ active: 'true' }), []);

  // defaults for a new voucher
  useEffect(() => {
    if (id) return;
    if (!rateText && settings) setRateText(String(rateFromX100(settings.defaultRateX100)));
    if (!cashAccount && accounts.some((a) => a.code === '1811')) setCashAccount('1811');
  }, [id, settings, accounts, rateText, cashAccount]);

  // load an existing draft
  useEffect(() => {
    if (!id) return;
    api.entry(id).then((e: EntryView) => {
      const k: Kind = e.type === 'receipt' || e.type === 'payment' ? e.type : 'journal';
      setKind(k);
      setDate(e.date);
      setDescription(e.description);
      setParty(e.party ?? '');
      setCurrency(e.currency);
      setRateText(String(rateFromX100(e.rateX100)));
      if (k === 'journal') {
        setRows(e.lines.map((l) => ({ key: rowKey++, accountCode: l.accountCode, debit: l.debit || null, credit: l.credit || null, description: l.description, partyId: l.partyId ?? '' })));
      } else {
        setCashAccount(e.cashAccountCode ?? '');
        const items = e.lines.filter((l) => l.accountCode !== e.cashAccountCode || (k === 'receipt' ? l.credit > 0 : l.debit > 0));
        setRows(items.map((l) => ({ key: rowKey++, accountCode: l.accountCode, debit: k === 'receipt' ? l.credit : l.debit, credit: null, description: l.description === e.description ? '' : l.description, partyId: l.partyId ?? '' })));
      }
      setReady(true);
    }, setLoadError);
  }, [id]);

  const isVoucher = kind !== 'journal';
  const rateX100 = currency === 'USD' ? parseRate(rateText) : 100;
  const totalDebit = rows.reduce((s, r) => s + (r.debit ?? 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (r.credit ?? 0), 0);
  const voucherTotal = totalDebit; // for vouchers the amount lives in "debit"
  const difference = totalDebit - totalCredit;

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  async function save() {
    if (!rateX100) {
      setError(new ApiError(400, 'validation', [{ code: 'rate_invalid' }]));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let saved: EntryView;
      const rate = rateX100;
      if (isVoucher) {
        const input: VoucherInput = {
          kind: kind as 'receipt' | 'payment', date, cashAccountCode: cashAccount, description, currency, rateX100: rate,
          items: rows.filter((r) => r.accountCode || r.debit).map((r) => ({ accountCode: r.accountCode, amount: r.debit ?? 0, ...(r.description.trim() ? { description: r.description.trim() } : {}), ...(r.partyId && partyTypeFor(r.accountCode) ? { partyId: r.partyId } : {}) }))
        };
        if (party.trim()) input.party = party.trim();
        saved = id ? await api.updateVoucher(id, input) : await api.createVoucher(input);
      } else {
        const input: JournalInput = {
          date, description, currency, rateX100: rate,
          lines: rows.filter((r) => r.accountCode || r.debit || r.credit).map((r) => ({ accountCode: r.accountCode, debit: r.debit ?? 0, credit: r.credit ?? 0, ...(r.description.trim() ? { description: r.description.trim() } : {}), ...(r.partyId && partyTypeFor(r.accountCode) ? { partyId: r.partyId } : {}) }))
        };
        if (party.trim()) input.party = party.trim();
        saved = id ? await api.updateJournal(id, input) : await api.createJournal(input);
      }
      await reloadAccounts();
      toast(t('saved'));
      go(`entry/${saved.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <ErrorBox error={loadError} />;
  if (!ready) return null;

  const title = id ? `${t('editTitle')} — ${t(kind)}` : t(kind);

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <div className="card pad stack">
        <h2 style={{ fontSize: 18 }}>{title}</h2>
        <div className="grid-3">
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <div className="field">
            <span>{t('currency')}</span>
            <div className="track" style={{ alignSelf: 'flex-start' }}>
              {(['IQD', 'USD'] as const).map((c) => (
                <button key={c} type="button" aria-pressed={currency === c} onClick={() => setCurrency(c)}>{c === 'IQD' ? t('iqdName') : t('usdName')}</button>
              ))}
            </div>
          </div>
          {currency === 'USD' ? (
            <label className="field">
              <span>{t('rate')} <span className="muted">({t('perUsd')})</span></span>
              <input className={'input amount' + (rateX100 ? '' : ' invalid')} inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value)} />
            </label>
          ) : <div />}
          {isVoucher && (
            <div className="field">
              <span>{t('cashAccount')}</span>
              <AccountCombo value={cashAccount} onChange={setCashAccount} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} />
            </div>
          )}
          <label className="field">
            <span>{kind === 'receipt' ? t('receivedFrom') : kind === 'payment' ? t('paidTo') : t('colParty')}</span>
            <input className="input" value={party} onChange={(e) => setParty(e.target.value)} />
          </label>
          <label className="field">
            <span>{isVoucher ? t('forLabel') : t('description')}</span>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="card">
        <div style={{ padding: '14px 16px 8px' }}>
          <h2>{kind === 'receipt' ? t('receiptItems') : kind === 'payment' ? t('paymentItems') : t('journal')}</h2>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '34%' }}>{t('account')}</th>
              {isVoucher ? <th className="amount">{t('amount')}</th> : <><th className="amount">{t('debit')}</th><th className="amount">{t('credit')}</th></>}
              <th>{t('lineNote')}</th>
              <th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <AccountCombo value={r.accountCode} onChange={(code) => update(r.key, { accountCode: code })} />
                  {partyTypeFor(r.accountCode) && (
                    <div style={{ marginTop: 6 }}>
                      <SearchCombo
                        value={r.partyId}
                        options={(parties.data ?? []).filter((p) => p.type === partyTypeFor(r.accountCode)).map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone, hint: p.balance ? i18n.money(p.balance, 'IQD') : '' }))}
                        onChange={(partyId) => {
                          const p = parties.data?.find((x) => x.id === partyId);
                          update(r.key, { partyId, ...(p ? { accountCode: p.accountCode } : {}) });
                          if (p && !party.trim()) setParty(p.name);
                        }}
                        placeholder={partyTypeFor(r.accountCode) === 'customer' ? t('chooseCustomer') : t('chooseSupplier')}
                        ariaLabel={t('customerOrSupplier')}
                        emptyLabel="—"
                      />
                    </div>
                  )}
                </td>
                <td><AmountInput value={r.debit} currency={currency} onChange={(v) => update(r.key, { debit: v })} ariaLabel={isVoucher ? t('amount') : t('debit')} /></td>
                {!isVoucher && <td><AmountInput value={r.credit} currency={currency} onChange={(v) => update(r.key, { credit: v })} ariaLabel={t('credit')} /></td>}
                <td><input className="input" value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} aria-label={t('lineNote')} /></td>
                <td><button type="button" className="btn icon danger" onClick={() => remove(r.key)} aria-label={t('removeLine')} title={t('removeLine')}><Icon name="x" size={16} /></button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>{t('total')}</td>
              {isVoucher ? <td className="amount">{i18n.money(voucherTotal, currency)}</td> : <><td className="amount">{i18n.money(totalDebit, currency)}</td><td className="amount">{i18n.money(totalCredit, currency)}</td></>}
              <td colSpan={2}>
                {!isVoucher && (difference === 0 && totalDebit > 0
                  ? <span className="chip ok">{t('balanced')}</span>
                  : totalDebit + totalCredit > 0 && <span className="chip bad">{t('difference')}: {i18n.money(Math.abs(difference), currency)}</span>)}
              </td>
            </tr>
          </tfoot>
        </table>
        <div style={{ padding: '10px 16px 14px' }}>
          <button type="button" className="btn small" onClick={() => setRows((rs) => [...rs, emptyRow()])}><Icon name="plus" size={15} />{t('addLine')}</button>
        </div>
      </div>

      {isVoucher && voucherTotal > 0 && (
        <div className="card pad">
          <div className="muted small">{t('inWords')}</div>
          <div className="words">{i18n.digitsOf(amountInWords(voucherTotal, currency, i18n.lang))}</div>
        </div>
      )}

      <ErrorBox error={error} />
      <div className="row">
        <button type="button" className="btn primary" onClick={save} disabled={saving}><Icon name="check" size={16} />{saving ? t('saving') : t('saveDraft')}</button>
        <button type="button" className="btn" onClick={() => history.back()}>{t('cancel')}</button>
      </div>
    </div>
  );
}
