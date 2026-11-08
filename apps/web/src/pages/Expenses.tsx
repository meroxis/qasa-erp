import { useState } from 'react';
import { todayIso, type CurrencyCode } from '@qasa/core';
import { api } from '../api.ts';
import { briefApi, EXPENSE_CATEGORIES, type ExpenseCategory } from '../industry/brief-api.ts';
import { AccountCombo, AmountInput, ErrorBox, Icon, Modal, StatusChip, useData, useLoad, usePageNav, useToast } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';

/**
 * Quick expenses: rent, the generator, fuel, salaries … in one short form, for someone who doesn't know journal
 * entries. Each one is an ordinary payment voucher (سند صرف) on the expense account the company set for that kind,
 * so it goes through the preparer → checker → approver chain like any other and counts once approved.
 */

const ICONS: Record<ExpenseCategory, string> = {
  rent: 'building', power: 'trend', fuel: 'truck', salaries: 'users', internet: 'globe', maintenance: 'sliders', transport: 'truck', other: 'receipt'
};
const label = (c: ExpenseCategory) => `br_exp_${c}` as Key;

export function Expenses() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, accounts } = useData();
  usePageNav({ key: 'br_expenses', group: 'gAccounting' });
  const month = todayIso().slice(0, 7);
  const [viewMonth, setViewMonth] = useState(month);
  const map = useLoad(() => briefApi.settings(), []);
  const list = useLoad(() => briefApi.expenses(viewMonth), [viewMonth]);
  const cashAccounts = accounts.filter((a) => a.postable && a.code.startsWith('18'));

  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  const [cash, setCash] = useState(() => settings?.postingAccounts.cash ?? '1811');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [mapping, setMapping] = useState(false);

  const account = category ? map.data?.expenseAccounts[category] : undefined;
  const accountName = account ? accounts.find((a) => a.code === account) : undefined;
  const ready = !!category && !!account && !!amount && amount > 0 && !!cash && !!date;

  async function save() {
    if (!ready || !category || !account || !amount) return;
    setBusy(true);
    setError(null);
    try {
      const description = note.trim() || t(label(category));
      const entry = await api.createVoucher({
        kind: 'payment', date, cashAccountCode: cash, description, currency,
        rateX100: currency === 'IQD' ? 100 : settings?.defaultRateX100 ?? 142000,
        items: [{ accountCode: account, amount, description }]
      });
      toast(t('br_expenseSaved', { n: entry.number ?? '' }));
      setAmount(null);
      setNote('');
      setCategory(null);
      list.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  // by account: an account that several kinds share (rent, internet, transport on 33) shows its own name, not a kind
  const byAccount = list.data?.byAccount ?? [];
  const max = Math.max(1, ...byAccount.map((a) => a.amount));

  return (
    <div className="stack" style={{ maxWidth: 1000, marginInline: 'auto', width: '100%' }}>
      <section className="card pad stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>{t('br_newExpense')}</h2>
          <span className="spacer" />
          <button type="button" className="btn ghost small" onClick={() => setMapping(true)}><Icon name="sliders" size={14} />{t('br_expenseAccounts')}</button>
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 8 }}>{t('br_whatFor')}</div>
          <div role="radiogroup" aria-label={t('br_whatFor')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
            {EXPENSE_CATEGORIES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={category === c} className={'btn' + (category === c ? ' primary' : '')}
                style={{ minHeight: 56, justifyContent: 'flex-start' }} onClick={() => setCategory(c)}>
                <Icon name={ICONS[c]} size={18} />{t(label(c))}
              </button>
            ))}
          </div>
          {category && accountName && <div className="small muted" style={{ marginTop: 6 }}>{t('br_goesTo')}: {i18n.digitsOf(accountName.code)} · {i18n.name(accountName.name)}</div>}
        </div>
        <div className="grid-3" style={{ alignItems: 'end' }}>
          <label className="field">
            <span>{t('br_amount')}</span>
            <AmountInput value={amount} currency={currency} onChange={setAmount} ariaLabel={t('br_amount')} />
          </label>
          <label className="field">
            <span>{t('br_currency')}</span>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
              <option value="IQD">{t('br_iqd')}</option>
              <option value="USD">{t('br_usd')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('date')}</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <div className="grid-2" style={{ alignItems: 'end' }}>
          <div className="field">
            <span>{t('br_paidFrom')}</span>
            {cashAccounts.length > 1
              ? <AccountCombo value={cash} onChange={setCash} filter={(a) => a.postable && a.code.startsWith('18')} ariaLabel={t('br_paidFrom')} />
              : <div className="input" aria-readonly="true">{cashAccounts[0] ? i18n.name(cashAccounts[0].name) : cash}</div>}
          </div>
          <label className="field">
            <span>{t('br_note')}</span>
            <input className="input" value={note} maxLength={200} placeholder={category ? t(label(category)) : ''} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <ErrorBox error={error ?? map.error} />
        <div className="row">
          <span className="small muted">{t('br_expenseApproval')}</span>
          <span className="spacer" />
          <button type="button" className="btn primary" disabled={!ready || busy} onClick={() => void save()}><Icon name="check" size={16} />{t('br_saveExpense')}</button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t('br_monthExpenses')}</h2>
          <span className="spacer" />
          <input className="input" type="month" value={viewMonth} max={month} onChange={(e) => e.target.value && setViewMonth(e.target.value)} aria-label={t('br_month')} style={{ width: 'auto' }} />
        </div>
        <ErrorBox error={list.error} />
        {list.data && (list.data.rows.length === 0 ? <p className="muted" style={{ padding: '0 16px 16px' }}>{t('noData')}</p> : (
          <>
            <div style={{ padding: '0 16px 12px', display: 'grid', gap: 8 }}>
              {byAccount.map((a) => (
                <div key={a.accountCode} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 160px) 1fr auto', alignItems: 'center', gap: 10 }}>
                  <span className="small">{a.category ? t(label(a.category)) : i18n.name(a.name)}</span>
                  <span style={{ height: 10, borderRadius: 5, background: 'var(--accent-soft, #DCE6FA)', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${(a.amount / max) * 100}%`, background: 'var(--accent, #1D5FD1)' }} />
                  </span>
                  <strong className="small num">{i18n.money(a.amount, 'IQD')}</strong>
                </div>
              ))}
              <div className="row" style={{ borderTop: '1px solid var(--line, #E4E1D8)', paddingTop: 8 }}>
                <strong>{t('br_total')}</strong><span className="spacer" /><strong className="num">{i18n.money(list.data.total, 'IQD')}</strong>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{t('date')}</th><th>{t('br_kind')}</th><th>{t('br_note')}</th><th>{t('br_status')}</th><th className="amount">{t('br_amount')}</th></tr></thead>
                <tbody>
                  {list.data.rows.map((r) => (
                    <tr key={r.entryId + r.accountCode}>
                      <td>{i18n.date(r.date)}</td>
                      <td>{r.category ? t(label(r.category)) : i18n.digitsOf(r.accountCode)}</td>
                      <td><a href={href(`entry/${r.entryId}`)}>{r.description}</a> {r.number && <span className="small muted">{i18n.digitsOf(r.number)}</span>}</td>
                      <td><StatusChip status={r.status} /></td>
                      <td className="amount">{i18n.money(r.amount, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ))}
      </section>

      {mapping && map.data && (
        <MappingModal current={map.data.expenseAccounts} onClose={() => setMapping(false)} onSaved={() => { setMapping(false); map.reload(); list.reload(); }} />
      )}
    </div>
  );
}

function MappingModal({ current, onClose, onSaved }: { current: Record<ExpenseCategory, string>; onClose(): void; onSaved(): void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(current);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await briefApi.saveSettings({ expenseAccounts: value });
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('br_expenseAccounts')} onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>{t('br_expenseAccountsHelp')}</p>
        {EXPENSE_CATEGORIES.map((c) => (
          <div key={c} className="field">
            <span>{t(label(c))}</span>
            <AccountCombo value={value[c]} onChange={(code) => setValue({ ...value, [c]: code })} filter={(a) => a.postable && a.code.startsWith('3')} ariaLabel={t(label(c))} />
          </div>
        ))}
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{t('br_save')}</button>
        </div>
      </div>
    </Modal>
  );
}
