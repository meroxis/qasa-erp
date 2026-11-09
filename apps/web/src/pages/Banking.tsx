import { useMemo, useState } from 'react';
import { todayIso, toWesternDigits, type CurrencyCode, type Names } from '@qasa/core';
import { api } from '../api.ts';
import { AccountCombo, AmountInput, ErrorBox, Icon, Modal, SearchCombo, StatusChip, useData, useLoad, usePageNav, useToast, type PickOption } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import {
  bankingApi, WALLET_KINDS, type ChequeDirection, type ChequeFilters, type ChequeStatus, type ChequeView, type MoneyAccountView, type MoneyKind,
  type StatementLineView, type StatementView, type WalletKind
} from '../industry/banking-api.ts';
import { guessStatementColumns, rowsToStatement, splitPasted, type ColumnMap, type StatementColumn } from '../industry/bank-statement.ts';
import { MAX_FILE_BYTES, parseCsv, readXlsx } from './Import.tsx';
import { go, href } from '../router.ts';
import { reverseDefaultDate } from '../industry/ReverseModal.tsx';
import { printDocument } from '../industry/printing.ts';

/**
 * البنوك والصكوك: safes, banks and e-wallets with their balances, moving money between them, cheques received and
 * written (with a printable receipt), and — on Pro — reconciling a bank account with the bank's statement.
 * Everything here makes DRAFT entries that go through checking and approval like any voucher.
 *
 * Routes: banking (= banking/accounts), banking/transfer, banking/cheques, banking/reconcile, cheque/<id>, bank-statement/<id>.
 */

const NAV = { key: 'bk_title' as const, group: 'gAccounting' as const };
export type BankingTab = 'accounts' | 'transfer' | 'cheques' | 'reconcile';

const CURRENCIES: CurrencyCode[] = ['IQD', 'USD'];
const kindKey = (k: MoneyKind) => `bk_kind_${k}` as Key;
const statusKey = (s: ChequeStatus) => `bk_status_${s}` as Key;
const STATUS_CHIP: Record<ChequeStatus, string> = { in_hand: 'info', deposited: 'info', pending: 'warn', cleared: 'ok', bounced: 'bad', cancelled: 'neutral' };

/** "146,500" (dinars per $100, as the market quotes it) → rateX100; null when not a whole positive number. */
function parseRate(text: string): number | null {
  const clean = toWesternDigits(text).replace(/[,\s٬]/g, '');
  if (!/^\d+$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function useMoneyAccounts() {
  return useLoad(() => bankingApi.accounts(), []);
}

function AccountSelect({ accounts, value, onChange, label, exclude }: { accounts: MoneyAccountView[]; value: string; onChange(code: string): void; label: string; exclude?: string }) {
  const i18n = useI18n();
  return (
    <label className="field">
      <span>{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {accounts.filter((a) => a.code !== exclude).map((a) => (
          <option key={a.code} value={a.code}>{a.code} · {i18n.name(a.name)} ({i18n.t(kindKey(a.kind))})</option>
        ))}
      </select>
    </label>
  );
}

function RateField({ value, onChange }: { value: string; onChange(v: string): void }) {
  const { t } = useI18n();
  return (
    <label className="field">
      <span>{t('bk_ratePer100')}</span>
      <input className="input num ltr" inputMode="numeric" placeholder="146,500" aria-invalid={value !== '' && parseRate(value) === null} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function CurrencyTrack({ value, onChange }: { value: CurrencyCode; onChange(c: CurrencyCode): void }) {
  const { t } = useI18n();
  return (
    <div className="field">
      <span>{t('currency')}</span>
      <div className="track">
        {CURRENCIES.map((c) => <button key={c} type="button" aria-pressed={value === c} onClick={() => onChange(c)}>{c}</button>)}
      </div>
    </div>
  );
}

function EntryLink({ entry }: { entry: { id: string; number: string | null; status: string } | null }) {
  const { t } = useI18n();
  if (!entry) return <span className="muted">—</span>;
  return (
    <span className="row" style={{ gap: 6 }}>
      <a className="ltr" href={href(`entry/${entry.id}`)}>{entry.number ?? t('bk_draftEntry')}</a>
      <StatusChip status={entry.status as 'draft' | 'checked' | 'approved'} />
    </span>
  );
}

const moneyLine = (i18n: I18n, m: Record<CurrencyCode, number>) =>
  CURRENCIES.filter((c) => m[c] !== 0).map((c) => i18n.money(m[c], c)).join(' · ') || i18n.money(0, 'IQD');

export function Banking({ tab = 'accounts' }: { tab?: BankingTab }) {
  const { t } = useI18n();
  usePageNav(NAV);
  const tabs: [BankingTab, Key][] = [['accounts', 'bk_tabAccounts'], ['transfer', 'bk_tabTransfer'], ['cheques', 'bk_tabCheques'], ['reconcile', 'bk_tabReconcile']];
  return (
    <div className="stack">
      <div className="tabs" role="group">
        {tabs.map(([k, label]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => go(k === 'accounts' ? 'banking' : `banking/${k}`)}>{t(label)}</button>)}
      </div>
      {tab === 'accounts' ? <Accounts /> : tab === 'transfer' ? <Transfer /> : tab === 'cheques' ? <Cheques /> : <Reconcile />}
    </div>
  );
}

/* ---------- safes, banks and wallets ---------- */

function Accounts() {
  const i18n = useI18n();
  const { t } = i18n;
  const list = useMoneyAccounts();
  const { reloadAccounts, companyBooks } = useData();
  // an account's statement is the company's books: no link for someone limited to branches
  const books = companyBooks !== false;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MoneyAccountView | null>(null);
  const accounts = list.data?.accounts ?? [];
  const totals = useMemo(() => {
    const m = { IQD: 0, USD: 0 } as Record<CurrencyCode, number>;
    let base = 0;
    for (const a of accounts) { m.IQD += a.balance.IQD; m.USD += a.balance.USD; base += a.base; }
    return { m, base };
  }, [accounts]);

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('bk_accountsHelp')}</p>
      <div className="grid-4">
        <div className="card pad tile">
          <div className="label">{t('bk_totalCash')} · IQD</div>
          <div className="value num">{i18n.money(totals.m.IQD, 'IQD')}</div>
        </div>
        <div className="card pad tile">
          <div className="label">{t('bk_totalCash')} · USD</div>
          <div className="value num">{i18n.money(totals.m.USD, 'USD')}</div>
        </div>
        <div className="card pad tile">
          <div className="label">{t('total')}</div>
          <div className="value num">{i18n.money(totals.base, 'IQD')}</div>
          <div className="small muted">{t('bk_inBase')}</div>
        </div>
      </div>
      <div className="row">
        <button type="button" className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />{t('bk_addAccount')}</button>
        <a className="btn" href={href('banking/transfer')}><Icon name="swap" size={16} />{t('bk_tabTransfer')}</a>
      </div>
      <ErrorBox error={list.error} />
      {list.data && (accounts.length ? (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('code')}</th><th>{t('name')}</th><th>{t('bk_kind')}</th><th className="num">IQD</th><th className="num">USD</th><th /></tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.code}>
                    <td className="ltr">{a.code}</td>
                    <td>
                      {i18n.name(a.name)}
                      {a.pending > 0 && <div className="small muted">{t('bk_pending', { n: a.pending })}</div>}
                    </td>
                    <td><span className="chip neutral">{t(kindKey(a.kind))}</span>{a.currency && <span className="small muted"> {a.currency}</span>}</td>
                    <td className="num">{i18n.money(a.balance.IQD, 'IQD')}</td>
                    <td className="num">{i18n.money(a.balance.USD, 'USD')}</td>
                    <td className="num">
                      <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        {books && <a className="btn subtle icon" title={t('bk_statement')} aria-label={t('bk_statement') + ' ' + a.code} href={href(`statement/${a.code}`)}><Icon name="doc" size={16} /></a>}
                        <button type="button" className="btn subtle icon" title={t('bk_editAccount')} aria-label={t('bk_editAccount') + ' ' + a.code} onClick={() => setEditing(a)}><Icon name="edit" size={16} /></button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : <p className="muted">{t('bk_noAccounts')}</p>)}
      {adding && <AddAccount onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); void reloadAccounts(); }} />}
      {editing && <EditAccount account={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); list.reload(); }} />}
    </div>
  );
}

function AddAccount({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState<Names>({ ar: '', en: '', ku: '' });
  const [kind, setKind] = useState<WalletKind>('bank');
  const [currency, setCurrency] = useState<CurrencyCode | ''>('IQD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const filled = !!(name.ar.trim() || name.en.trim() || name.ku.trim());
  async function save() {
    setBusy(true);
    setError(null);
    try {
      // a name typed in one language is used for the others until someone translates it
      const any = name.ar.trim() || name.en.trim() || name.ku.trim();
      await bankingApi.addAccount({ name: { ar: name.ar.trim() || any, en: name.en.trim() || any, ku: name.ku.trim() || any }, kind, currency: currency || null });
      toast(t('saved'));
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('bk_addAccount')} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('bk_addAccountHelp')}</p>
        <label className="field"><span>{t('bk_kind')}</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as WalletKind)}>
            {WALLET_KINDS.map((k) => <option key={k} value={k}>{t(kindKey(k))}</option>)}
          </select>
        </label>
        <label className="field"><span>{t('name')} · العربية</span><input className="input" dir="rtl" value={name.ar} onChange={(e) => setName({ ...name, ar: e.target.value })} placeholder="مصرف الرافدين — فرع المنصور" /></label>
        <label className="field"><span>{t('name')} · English</span><input className="input" dir="ltr" value={name.en} onChange={(e) => setName({ ...name, en: e.target.value })} /></label>
        <label className="field"><span>{t('name')} · کوردی</span><input className="input" dir="rtl" value={name.ku} onChange={(e) => setName({ ...name, ku: e.target.value })} /></label>
        <label className="field"><span>{t('currency')}</span>
          <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode | '')}>
            <option value="IQD">IQD</option><option value="USD">USD</option><option value="">{t('bk_anyCurrency')}</option>
          </select>
        </label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !filled} onClick={() => void save()}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function EditAccount({ account, onClose, onDone }: { account: MoneyAccountView; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [kind, setKind] = useState<MoneyKind>(account.kind);
  const [currency, setCurrency] = useState<CurrencyCode | ''>(account.currency ?? '');
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal title={`${account.code} · ${i18n.name(account.name)}`} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>{t('bk_kind')}</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as MoneyKind)}>
            {(['safe', ...WALLET_KINDS] as MoneyKind[]).map((k) => <option key={k} value={k}>{t(kindKey(k))}</option>)}
          </select>
        </label>
        <label className="field"><span>{t('currency')}</span>
          <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode | '')}>
            <option value="IQD">IQD</option><option value="USD">USD</option><option value="">{t('bk_anyCurrency')}</option>
          </select>
        </label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" onClick={() => { bankingApi.setAccount(account.code, { kind, currency: currency || null }).then(onDone, setError); }}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- transfers ---------- */

function Transfer() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings } = useData();
  const list = useMoneyAccounts();
  const accounts = list.data?.accounts ?? [];
  const [date, setDate] = useState(todayIso());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [charge, setCharge] = useState<number | null>(null);
  const [chargeAccount, setChargeAccount] = useState('39');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<{ id: string; number: string | null } | null>(null);
  const rateX100 = currency === 'USD' ? parseRate(rate || String(settings?.defaultRateX100 ?? '')) : 100;
  const source = accounts.find((a) => a.code === from);
  const ready = !!from && !!to && from !== to && !!amount && amount > 0 && rateX100 !== null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const e = await bankingApi.transfer({
        date, from, to, currency, amount: amount!, ...(currency === 'USD' ? { rateX100: rateX100! } : {}),
        ...(charge ? { charge, chargeAccount } : {}), ...(description.trim() ? { description: description.trim() } : {}), lang: i18n.lang
      });
      setDone({ id: e.id, number: e.number });
      toast(t('bk_transferDone'));
      setAmount(null);
      setCharge(null);
      setDescription('');
      list.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('bk_transferHelp')}</p>
      <ErrorBox error={list.error} />
      <div className="card pad stack">
        <div className="grid-2">
          <AccountSelect accounts={accounts} value={from} onChange={setFrom} label={t('bk_from')} />
          <AccountSelect accounts={accounts} value={to} onChange={setTo} label={t('bk_to')} exclude={from} />
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <CurrencyTrack value={currency} onChange={setCurrency} />
          <label className="field">
            <span>{t('amount')}{source && <span className="muted small"> · {t('bk_available')}: <span className="num">{i18n.money(source.balance[currency], currency)}</span></span>}</span>
            <AmountInput value={amount} currency={currency} onChange={setAmount} ariaLabel={t('amount')} />
          </label>
          {currency === 'USD' && <RateField value={rate || (settings ? String(settings.defaultRateX100) : '')} onChange={setRate} />}
          <label className="field"><span>{t('bk_charge')}</span><AmountInput value={charge} currency={currency} onChange={setCharge} ariaLabel={t('bk_charge')} /></label>
          {!!charge && (
            <div className="field"><span>{t('bk_chargeAccount')}</span>
              <AccountCombo value={chargeAccount} onChange={setChargeAccount} filter={(a) => a.code.startsWith('3')} ariaLabel={t('bk_chargeAccount')} />
            </div>
          )}
          <label className="field"><span>{t('description')}</span><input className="input" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} /></label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>{t('bk_exchangeNote')}</p>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !ready} onClick={() => void submit()}><Icon name="swap" size={16} />{t('bk_transferDo')}</button>
          {done && <a className="btn" href={href(`entry/${done.id}`)}><Icon name="doc" size={16} />{t('bk_openEntry')} {done.number ? <span className="ltr">{done.number}</span> : null}</a>}
        </div>
      </div>
    </div>
  );
}

/* ---------- cheques ---------- */

function dueText(i18n: I18n, c: ChequeView): string {
  if (!['in_hand', 'deposited', 'pending'].includes(c.status)) return '';
  if (c.daysToDue === 0) return i18n.t('bk_today');
  return c.daysToDue > 0 ? i18n.t('bk_daysLeft', { n: c.daysToDue }) : i18n.t('bk_daysLate', { n: -c.daysToDue });
}

function Cheques() {
  const i18n = useI18n();
  const { t } = i18n;
  const [filters, setFilters] = useState<ChequeFilters>({ status: 'open' });
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<ChequeDirection | null>(null);
  const list = useLoad(() => bankingApi.cheques({ ...filters, ...(q.trim() ? { q: q.trim() } : {}) }), [filters.direction, filters.status, filters.due, q]);
  const summary = useLoad(() => bankingApi.chequeSummary(), []);
  const s = summary.data;
  const set = (patch: Partial<ChequeFilters>) => setFilters((f) => {
    const next = { ...f, ...patch };
    for (const k of Object.keys(next) as (keyof ChequeFilters)[]) if (next[k] === undefined) delete next[k];
    return next;
  });

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('bk_chequeHelp')}</p>
      {s && (
        <div className="grid-4">
          <div className="card pad tile">
            <div className="label">{t('bk_inHandTotal')}</div>
            <div className="value num">{moneyLine(i18n, s.inHand)}</div>
            <div className="small muted">{t('bk_countCheques', { n: s.inHandCount })}</div>
          </div>
          <div className="card pad tile">
            <div className="label">{t('bk_issuedTotal')}</div>
            <div className="value num">{moneyLine(i18n, s.issuedPending)}</div>
            <div className="small muted">{t('bk_countCheques', { n: s.issuedPendingCount })}</div>
          </div>
          <button type="button" className="card pad tile" style={{ textAlign: 'start', cursor: 'pointer' }} onClick={() => set({ due: 'today', status: 'open' })}>
            <div className="label">{t('bk_due_today')} · {t('bk_due_week')}</div>
            <div className="value num">{i18n.int(s.dueToday)} · {i18n.int(s.dueThisWeek)}</div>
          </button>
          <button type="button" className="card pad tile" style={{ textAlign: 'start', cursor: 'pointer' }} onClick={() => set({ due: 'overdue', status: 'open' })}>
            <div className="label">{t('bk_due_overdue')}</div>
            <div className="value num" style={s.overdue ? { color: 'var(--bad)' } : undefined}>{i18n.int(s.overdue)}</div>
          </button>
        </div>
      )}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn primary" onClick={() => setAdding('received')}><Icon name="plus" size={16} />{t('bk_receive')}</button>
        <button type="button" className="btn" onClick={() => setAdding('issued')}><Icon name="edit" size={16} />{t('bk_issue')}</button>
        <span className="spacer" />
        <input className="input" style={{ maxInlineSize: 220 }} placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('search')} />
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="track">
          <button type="button" aria-pressed={!filters.direction} onClick={() => set({ direction: undefined })}>{t('all')}</button>
          <button type="button" aria-pressed={filters.direction === 'received'} onClick={() => set({ direction: 'received' })}>{t('bk_received')}</button>
          <button type="button" aria-pressed={filters.direction === 'issued'} onClick={() => set({ direction: 'issued' })}>{t('bk_issued')}</button>
        </div>
        <div className="track">
          <button type="button" aria-pressed={!filters.due} onClick={() => set({ due: undefined })}>{t('all')}</button>
          {(['today', 'week', 'overdue'] as const).map((d) => <button key={d} type="button" aria-pressed={filters.due === d} onClick={() => set({ due: d })}>{t(`bk_due_${d}` as Key)}</button>)}
        </div>
        <select className="input" style={{ maxInlineSize: 200 }} aria-label={t('bk_kind')} value={filters.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as ChequeFilters['status'] })}>
          <option value="">{t('all')}</option>
          <option value="open">{t('bk_status_open')}</option>
          {(['in_hand', 'deposited', 'pending', 'cleared', 'bounced', 'cancelled'] as ChequeStatus[]).map((st) => <option key={st} value={st}>{t(statusKey(st))}</option>)}
        </select>
      </div>
      <ErrorBox error={list.error} />
      {list.data && (list.data.length ? (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('bk_chequeNumber')}</th><th>{t('bk_drawnBank')}</th><th>{t('bk_drawer')} / {t('bk_payee')}</th><th>{t('bk_dueDate')}</th><th className="num">{t('amount')}</th><th>{t('bk_kind')}</th></tr></thead>
              <tbody>
                {list.data.map((c) => {
                  const late = c.daysToDue < 0 && ['in_hand', 'deposited', 'pending'].includes(c.status);
                  return (
                    <tr key={c.id}>
                      <td><a className="ltr" href={href(`cheque/${c.id}`)}>{c.number}</a><div className="small muted">{t(c.direction === 'received' ? 'bk_received' : 'bk_issued')}</div></td>
                      <td>{c.bank}</td>
                      <td>{c.party.name}</td>
                      <td><span className="num">{i18n.date(c.dueDate)}</span><div className="small" style={late ? { color: 'var(--bad)' } : { color: 'var(--ink-3)' }}>{dueText(i18n, c)}</div></td>
                      <td className="num">{i18n.money(c.amount, c.currency)}</td>
                      <td><span className={'chip ' + STATUS_CHIP[c.status]}>{t(statusKey(c.status))}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : <p className="muted">{t('bk_noCheques')}</p>)}
      {adding && <ChequeForm direction={adding} onClose={() => setAdding(null)} onDone={(c) => { setAdding(null); go(`cheque/${c.id}`); }} />}
    </div>
  );
}

function ChequeForm({ direction, onClose, onDone }: { direction: ChequeDirection; onClose(): void; onDone(c: ChequeView): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings } = useData();
  const partyType = direction === 'received' ? 'customer' : 'supplier';
  const parties = useLoad(() => api.parties({ type: partyType, active: 'true' }), [partyType]);
  const accounts = useMoneyAccounts();
  const [partyId, setPartyId] = useState('');
  const [number, setNumber] = useState('');
  const [bank, setBank] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState(todayIso());
  const [bankAccount, setBankAccount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const options: PickOption[] = (parties.data ?? []).map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone }));
  const rateX100 = currency === 'USD' ? parseRate(rate || String(settings?.defaultRateX100 ?? '')) : 100;
  const banks = (accounts.data?.accounts ?? []).filter((a) => a.kind !== 'safe');
  const ready = !!partyId && !!number.trim() && !!bank.trim() && !!amount && rateX100 !== null && (direction === 'received' || !!bankAccount);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const c = await bankingApi.addCheque({
        direction, partyId, number: number.trim(), bank: bank.trim(), currency, amount: amount!, issueDate, dueDate,
        ...(currency === 'USD' ? { rateX100: rateX100! } : {}), ...(direction === 'issued' ? { bankAccount } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}),
        lang: i18n.lang
      });
      toast(t('bk_chequeSaved'));
      onDone(c);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t(direction === 'received' ? 'bk_receive' : 'bk_issue')} onClose={onClose}>
      <div className="stack">
        <div className="field">
          <span>{t(direction === 'received' ? 'customer' : 'supplier')}</span>
          <SearchCombo value={partyId} options={options} onChange={setPartyId} placeholder={t('search')} ariaLabel={t(direction === 'received' ? 'customer' : 'supplier')} />
        </div>
        <div className="grid-2">
          <label className="field"><span>{t('bk_chequeNumber')}</span><input className="input ltr" maxLength={50} value={number} onChange={(e) => setNumber(e.target.value)} /></label>
          <label className="field"><span>{t('bk_drawnBank')}</span><input className="input" maxLength={120} value={bank} onChange={(e) => setBank(e.target.value)} placeholder={direction === 'issued' ? '' : 'مصرف الرافدين'} /></label>
          {direction === 'issued' && (
            <AccountSelect accounts={banks} value={bankAccount} onChange={(code) => {
              setBankAccount(code);
              const a = banks.find((x) => x.code === code);
              if (a && !bank.trim()) setBank(i18n.name(a.name));
            }} label={t('bk_ourBank')} />
          )}
          <CurrencyTrack value={currency} onChange={setCurrency} />
          <label className="field"><span>{t('amount')}</span><AmountInput value={amount} currency={currency} onChange={setAmount} ariaLabel={t('amount')} /></label>
          {currency === 'USD' && <RateField value={rate || (settings ? String(settings.defaultRateX100) : '')} onChange={setRate} />}
          <label className="field"><span>{t('bk_issueDate')}</span><input className="input" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></label>
          <label className="field"><span>{t('bk_dueDate')}</span><input className="input" type="date" min={issueDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        </div>
        <label className="field"><span>{t('notes')}</span><input className="input" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <ErrorBox error={error ?? parties.error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !ready} onClick={() => void save()}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

type ChequeStep = 'deposit' | 'clear' | 'bounce' | 'cancel' | 'undo';

/** One cheque: its steps and entries, the actions it allows, and the receipt to print and sign. */
export function ChequeDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  usePageNav(NAV);
  const { settings, plan } = useData();
  const cheque = useLoad(() => bankingApi.cheque(id), [id]);
  const [step, setStep] = useState<ChequeStep | null>(null);
  const c = cheque.data;
  if (!c) return <ErrorBox error={cheque.error} />;
  const company = settings ? i18n.name(settings.companyName) : '';
  const waiting = c.entry && c.entry.status !== 'approved' && ['in_hand', 'pending'].includes(c.status);

  return (
    <div className="stack">
      <div className="row no-print" style={{ flexWrap: 'wrap' }}>
        <a className="btn" href={href('banking/cheques')}><Icon name="chevron" size={16} />{t('bk_backToCheques')}</a>
        <span className="spacer" />
        {c.actions.includes('deposit') && <button type="button" className="btn" onClick={() => setStep('deposit')}><Icon name="building" size={16} />{t('bk_actDeposit')}</button>}
        {c.actions.includes('clear') && <button type="button" className="btn primary" onClick={() => setStep('clear')}><Icon name="check" size={16} />{t(c.direction === 'received' ? 'bk_actClear' : 'bk_actClearIssued')}</button>}
        {c.actions.includes('bounce') && <button type="button" className="btn danger" onClick={() => setStep('bounce')}><Icon name="undo" size={16} />{t('bk_actBounce')}</button>}
        {c.actions.includes('cancel') && <button type="button" className="btn" onClick={() => setStep('cancel')}><Icon name="x" size={16} />{t('bk_actCancel')}</button>}
        {c.actions.includes('undo') && <button type="button" className="btn" onClick={() => setStep('undo')}><Icon name="undo" size={16} />{t('bk_undo')}</button>}
        <button type="button" className="btn" onClick={() => void printDocument('voucher')}><Icon name="printer" size={16} />{t('print')}</button>
      </div>
      {waiting && <div className="alert info no-print">{t('bk_waitApproval')}</div>}

      <div className="paper">
        <div className="paper-head">
          <div style={{ flex: 1 }}>
            <div className="company-line">{company}</div>
            <div className="paper-title">{t(c.direction === 'received' ? 'bk_receipt' : 'bk_issueVoucher')}</div>
            <div style={{ marginTop: 4 }}><span className={'chip ' + STATUS_CHIP[c.status]}>{t(statusKey(c.status))}</span></div>
          </div>
          <div className="paper-meta">
            <span className="muted">{t('date')}</span><strong className="num">{i18n.date(c.issueDate)}</strong>
            {c.entry?.number && <><span className="muted">{t('bk_entryMade')}</span><strong className="ltr">{c.entry.number}</strong></>}
          </div>
        </div>
        <p>{t(c.direction === 'received' ? 'bk_receiptText' : 'bk_issueText', { p: c.party.name })}</p>
        <table className="table">
          <tbody>
            <tr><th>{t('bk_chequeNumber')}</th><td className="ltr">{c.number}</td></tr>
            <tr><th>{t('bk_drawnBank')}</th><td>{c.bank}</td></tr>
            <tr><th>{t(c.direction === 'received' ? 'bk_drawer' : 'bk_payee')}</th><td>{c.party.name}{c.party.phone ? <span className="ltr muted"> · {c.party.phone}</span> : null}</td></tr>
            <tr><th>{t('amount')}</th><td className="num"><strong>{i18n.money(c.amount, c.currency)}</strong> {c.currency}</td></tr>
            <tr><th>{t('bk_issueDate')}</th><td className="num">{i18n.date(c.issueDate)}</td></tr>
            <tr><th>{t('bk_dueDate')}</th><td className="num">{i18n.date(c.dueDate)}</td></tr>
            {c.bankAccount && <tr><th>{t('bk_ourBank')}</th><td>{i18n.name(c.bankAccount.name)}</td></tr>}
            {c.notes && <tr><th>{t('notes')}</th><td>{c.notes}</td></tr>}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 48, justifyContent: 'space-between' }}>
          <div style={{ minInlineSize: 200, borderBlockStart: '1px solid var(--line)', paddingBlockStart: 6, textAlign: 'center' }}>{t('bk_signReceiver')}</div>
          <div style={{ minInlineSize: 200, borderBlockStart: '1px solid var(--line)', paddingBlockStart: 6, textAlign: 'center' }}>{t('bk_signCompany')}</div>
        </div>
        {!plan?.features.includes('noBranding') && <div className="made-with print-only">{t('madeWith')} · <span className="ltr">qasaerp.com</span></div>}
      </div>

      <div className="card pad stack no-print">
        <strong>{t('bk_history')}</strong>
        <div className="plan-facts">
          <span className="muted">{t('bk_entryMade')}</span><EntryLink entry={c.entry} />
          <span className="muted">{t('bk_entryClear')}</span><EntryLink entry={c.clearEntry} />
          <span className="muted">{t('bk_entryBounce')}</span><EntryLink entry={c.bounceEntry} />
        </div>
      </div>
      {step && <ChequeStepModal cheque={c} step={step} onClose={() => setStep(null)} onDone={() => { setStep(null); cheque.reload(); }} />}
    </div>
  );
}

function ChequeStepModal({ cheque, step, onClose, onDone }: { cheque: ChequeView; step: ChequeStep; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings } = useData();
  const accounts = useMoneyAccounts();
  const banks = (accounts.data?.accounts ?? []).filter((a) => a.kind !== 'safe' || step === 'clear');
  // the entry the undo takes back: a draft is deleted, an approved one is reversed on the date chosen here (never before it)
  const undoEntry = cheque.status === 'cleared' ? cheque.clearEntry : cheque.bounceEntry;
  const undoMin = step === 'undo' ? undoEntry?.date : undefined;
  const [date, setDate] = useState(() => (step === 'undo' ? reverseDefaultDate(undoMin) : todayIso()));
  const [bankAccount, setBankAccount] = useState(cheque.bankAccount?.code ?? '');
  const [rate, setRate] = useState('');
  const [fee, setFee] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const title = t(step === 'deposit' ? 'bk_actDeposit' : step === 'clear' ? (cheque.direction === 'received' ? 'bk_actClear' : 'bk_actClearIssued') : step === 'bounce' ? 'bk_actBounce' : step === 'undo' ? 'bk_undo' : 'bk_actCancel');
  async function run() {
    setBusy(true);
    setError(null);
    try {
      if (step === 'deposit') await bankingApi.deposit(cheque.id, { bankAccount, date });
      else if (step === 'clear') {
        const r = cheque.currency === 'USD' && rate ? parseRate(rate) : null;
        await bankingApi.clear(cheque.id, { date, ...(bankAccount ? { bankAccount } : {}), ...(r ? { rateX100: r } : {}), lang: i18n.lang });
      } else if (step === 'bounce') await bankingApi.bounce(cheque.id, { date, ...(fee ? { fee } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}), lang: i18n.lang });
      else if (step === 'cancel') await bankingApi.cancelCheque(cheque.id, { date, ...(reason.trim() ? { reason: reason.trim() } : {}), lang: i18n.lang });
      else await bankingApi.undoCheque(cheque.id, { date });
      toast(t('saved'));
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${title} · ${cheque.number}`} onClose={onClose}>
      <div className="stack">
        <p style={{ margin: 0 }}>{cheque.party.name} — <strong className="num">{i18n.money(cheque.amount, cheque.currency)} {cheque.currency}</strong></p>
        {step === 'cancel' && <div className="alert warn">{t('bk_cancelConfirm')}</div>}
        {step === 'undo' && <div className="alert warn">{t(undoEntry?.status === 'approved' ? 'bk_undoApproved' : 'bk_undoDraft')}</div>}
        {(step !== 'undo' || undoEntry?.status === 'approved') && (
          <label className="field"><span>{t('date')}</span><input className="input" type="date" min={undoMin} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        )}
        {(step === 'deposit' || step === 'clear') && <AccountSelect accounts={banks} value={bankAccount} onChange={setBankAccount} label={t('bk_ourBank')} />}
        {step === 'clear' && cheque.currency === 'USD' && <RateField value={rate || (settings ? String(settings.defaultRateX100) : '')} onChange={setRate} />}
        {step === 'bounce' && <label className="field"><span>{t('bk_fee')}</span><AmountInput value={fee} currency={cheque.currency} onChange={setFee} ariaLabel={t('bk_fee')} /></label>}
        {(step === 'bounce' || step === 'cancel') && <label className="field"><span>{t('bk_reason')}</span><input className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className={'btn ' + (step === 'bounce' || step === 'cancel' || step === 'undo' ? 'danger' : 'primary')} disabled={busy || ((step === 'deposit' || step === 'clear') && !bankAccount)} onClick={() => void run()}>
            <Icon name="check" size={16} />{t('confirm')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- bank reconciliation (Pro) ---------- */

function Reconcile() {
  const i18n = useI18n();
  const { t } = i18n;
  const { plan } = useData();
  const available = !!plan?.features.includes('bankReconciliation');
  const statements = useLoad(() => (available ? bankingApi.statements() : Promise.resolve([])), [available]);
  const accounts = useMoneyAccounts();
  const [adding, setAdding] = useState(false);
  if (!available) {
    return (
      <div className="card pad stack">
        <p style={{ margin: 0 }}>{t('bk_reconHelp')}</p>
        <div className="alert info">{t('bk_reconPro')}</div>
        <div className="row"><a className="btn primary" href={href('plans')}><Icon name="star" size={16} />{t('bk_seePlans')}</a></div>
      </div>
    );
  }
  const nameOf = (code: string) => {
    const a = accounts.data?.accounts.find((x) => x.code === code);
    return a ? i18n.name(a.name) : code;
  };
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('bk_reconHelp')}</p>
      <div className="row"><button type="button" className="btn primary" onClick={() => setAdding(true)}><Icon name="upload" size={16} />{t('bk_newStatement')}</button></div>
      <ErrorBox error={statements.error} />
      {statements.data && (statements.data.length ? (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('account')}</th><th>{t('bk_period')}</th><th className="num">{t('bk_closing')}</th><th className="num">{t('bk_matched')}</th><th>{t('bk_kind')}</th></tr></thead>
              <tbody>
                {statements.data.map((s) => (
                  <tr key={s.id}>
                    <td><a href={href(`bank-statement/${s.id}`)}>{s.accountCode} · {nameOf(s.accountCode)}</a></td>
                    <td className="num">{i18n.date(s.from)} – {i18n.date(s.to)}</td>
                    <td className="num">{i18n.int(s.closing)}</td>
                    <td className="num">{i18n.int(s.matched)} / {i18n.int(s.lines)}</td>
                    <td>{s.status === 'reconciled' ? <span className="chip ok">{t('bk_reconciled')}</span> : <span className="chip warn">{t('bk_status_open')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : <p className="muted">{t('bk_noStatements')}</p>)}
      {adding && <NewStatement accounts={(accounts.data?.accounts ?? []).filter((a) => a.kind !== 'safe')} onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); go(`bank-statement/${id}`); }} />}
    </div>
  );
}

const COLUMNS: StatementColumn[] = ['date', 'description', 'reference', 'amount', 'in', 'out'];

function NewStatement({ accounts, onClose, onDone }: { accounts: MoneyAccountView[]; onClose(): void; onDone(id: string): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [accountCode, setAccountCode] = useState(accounts[0]?.code ?? '');
  const [currency, setCurrency] = useState<CurrencyCode>(accounts[0]?.currency ?? 'IQD');
  const [from, setFrom] = useState(todayIso().slice(0, 8) + '01');
  const [to, setTo] = useState(todayIso());
  const [opening, setOpening] = useState<number | null>(0);
  const [closing, setClosing] = useState<number | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<ColumnMap>({});
  const [hasHeader, setHasHeader] = useState(true);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function load(next: string[][]) {
    setRows(next);
    const guessed = guessStatementColumns(next[0] ?? []);
    const found = Object.keys(guessed).length >= 2;
    setHasHeader(found);
    setMap(found ? guessed : { date: 0, description: 1, amount: 2 });
  }
  async function readFile(file: File) {
    setError(null);
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('too_large');
      if (/\.xlsx$/i.test(file.name)) load(await readXlsx(await file.arrayBuffer()));
      else load(parseCsv(await file.text()));
    } catch {
      setError(new Error('read'));
    }
  }

  const parsed = useMemo(() => rowsToStatement(rows, map, currency, hasHeader), [rows, map, currency, hasHeader]);
  const net = parsed.lines.reduce((s, l) => s + l.amount, 0);
  const computed = (opening ?? 0) + net;
  const off = closing === null ? null : closing - computed;
  // the statement's own period, when the person hasn't changed it
  const dates = parsed.lines.map((l) => l.date).sort();
  const ready = !!accountCode && parsed.lines.length > 0 && opening !== null && closing !== null && off === 0 && from <= to;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const s = await bankingApi.addStatement({ accountCode, currency, from, to, opening: opening!, closing: closing!, lines: parsed.lines });
      onDone(s.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const readError = error instanceof Error && error.message === 'read';
  return (
    <Modal title={t('bk_newStatement')} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <AccountSelect accounts={accounts} value={accountCode} onChange={(c) => { setAccountCode(c); const a = accounts.find((x) => x.code === c); if (a?.currency) setCurrency(a.currency); }} label={t('account')} />
          <CurrencyTrack value={currency} onChange={setCurrency} />
        </div>
        <label className="field"><span>{t('bk_file')}</span><input className="input" type="file" accept=".xlsx,.csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} /></label>
        <label className="field"><span>{t('bk_orPaste')}</span>
          <textarea className="input" rows={3} value={pasted} onChange={(e) => setPasted(e.target.value)} onBlur={() => { if (pasted.trim()) load(splitPasted(pasted, parseCsv)); }} />
        </label>
        {readError && <div className="alert bad" role="alert">{t('err_bk_read_failed')}</div>}
        {rows.length > 0 && (
          <>
            <strong>{t('bk_mapColumns')}</strong>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />{t('bk_headerRow')}</label>
            <div className="grid-3">
              {COLUMNS.map((col) => (
                <label key={col} className="field"><span>{t(`bk_col_${col}` as Key)}</span>
                  <select className="input" value={map[col] ?? ''} onChange={(e) => {
                    const v = e.target.value === '' ? undefined : Number(e.target.value);
                    const next = { ...map };
                    if (v === undefined) delete next[col]; else next[col] = v;
                    // one amount column, or a pair of in/out columns
                    if (col === 'amount' && v !== undefined) { delete next.in; delete next.out; }
                    if ((col === 'in' || col === 'out') && v !== undefined) delete next.amount;
                    setMap(next);
                  }}>
                    <option value="">{t('bk_col_none')}</option>
                    {(rows[0] ?? []).map((h, i) => <option key={i} value={i}>{hasHeader ? (h || `#${i + 1}`) : `#${i + 1} · ${h}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="small">{t('bk_preview', { n: parsed.lines.length, s: i18n.money(net, currency) })}{parsed.skipped > 0 && <span className="muted"> · {t('bk_skipped', { n: parsed.skipped })}</span>}</div>
            {parsed.lines.length > 0 && (
              <div className="table-wrap" style={{ maxBlockSize: 200, overflow: 'auto' }}>
                <table className="table">
                  <tbody>
                    {parsed.lines.slice(0, 8).map((l, i) => (
                      <tr key={i}><td className="num">{i18n.date(l.date)}</td><td>{l.description}</td><td className="ltr">{l.reference ?? ''}</td><td className="num">{i18n.money(l.amount, currency)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <div className="grid-2">
          <label className="field"><span>{t('from')}</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field"><span>{t('to')}</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="field"><span>{t('bk_opening')}</span><AmountInput value={opening} currency={currency} onChange={setOpening} ariaLabel={t('bk_opening')} /></label>
          <label className="field"><span>{t('bk_closing')}</span><AmountInput value={closing} currency={currency} onChange={setClosing} ariaLabel={t('bk_closing')} /></label>
        </div>
        {dates.length > 0 && (from > dates[0]! || to < dates[dates.length - 1]!) && (
          <button type="button" className="btn subtle small" onClick={() => { setFrom(dates[0]!); setTo(dates[dates.length - 1]!); }}>{t('bk_period')}: {i18n.date(dates[0]!)} – {i18n.date(dates[dates.length - 1]!)}</button>
        )}
        {parsed.lines.length > 0 && off !== null && off !== 0 && (
          <div className="alert warn">
            {t('bk_checkSum', { d: i18n.money(off, currency) })}{' '}
            <button type="button" className="btn subtle small" onClick={() => setClosing(computed)}>{t('bk_useComputed')} ({i18n.money(computed, currency)})</button>
          </div>
        )}
        <ErrorBox error={readError ? null : error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !ready} onClick={() => void save()}><Icon name="check" size={16} />{t('bk_createStatement')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** One statement: bank lines against book entries, matching, vouchers for what the books lack, and the difference. */
export function StatementDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  usePageNav(NAV);
  const toast = useToast();
  const loaded = useLoad(() => bankingApi.statement(id), [id]);
  const [view, setView] = useState<StatementView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [matching, setMatching] = useState<StatementLineView | null>(null);
  const [voucher, setVoucher] = useState<StatementLineView | null>(null);
  const s = view ?? loaded.data;
  if (!s) return <ErrorBox error={loaded.error} />;
  const open = s.status === 'open';
  const freeBook = s.book.filter((b) => !b.matched);

  async function act(fn: () => Promise<StatementView | { matched: number; statement: StatementView }>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if ('statement' in r) { setView(r.statement); toast(t('bk_matchedN', { n: r.matched })); } else setView(r);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm(t('bk_deleteStatementConfirm'))) return;
    try {
      await bankingApi.deleteStatement(id);
      go('banking/reconcile');
    } catch (e) {
      setError(e);
    }
  }

  const diffStyle = { color: s.difference === 0 ? 'var(--ok)' : 'var(--bad)' };
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <a className="btn" href={href('banking/reconcile')}><Icon name="chevron" size={16} />{t('bk_statements')}</a>
        <strong>{s.account.code} · {i18n.name(s.account.name)}</strong>
        <span className="muted num">{i18n.date(s.from)} – {i18n.date(s.to)} · {s.currency}</span>
        {s.status === 'reconciled' ? <span className="chip ok">{t('bk_reconciled')}</span> : <span className="chip warn">{t('bk_status_open')}</span>}
        <span className="spacer" />
        {open && <button type="button" className="btn" disabled={busy} onClick={() => void act(() => bankingApi.autoMatch(id))}><Icon name="zap" size={16} />{t('bk_autoMatch')}</button>}
        {open && <button type="button" className="btn primary" disabled={busy || !s.canReconcile} title={s.canReconcile ? undefined : t('bk_reconcileHint')} onClick={() => void act(() => bankingApi.reconcile(id))}><Icon name="check" size={16} />{t('bk_reconcile')}</button>}
        {open && <button type="button" className="btn subtle" onClick={() => void remove()}><Icon name="x" size={16} />{t('bk_deleteStatement')}</button>}
      </div>
      <div className="grid-4">
        <div className="card pad tile"><div className="label">{t('bk_closing')}</div><div className="value num">{i18n.money(s.closing, s.currency)}</div></div>
        <div className="card pad tile"><div className="label">{t('bk_bookBalance')}</div><div className="value num">{i18n.money(s.bookBalance, s.currency)}</div></div>
        <div className="card pad tile"><div className="label">{t('bk_difference')}</div><div className="value num" style={diffStyle}>{i18n.money(s.difference, s.currency)}</div></div>
        <div className="card pad tile">
          <div className="label">{t('bk_unmatchedLines')}</div>
          <div className="value num">{i18n.int(s.unmatchedLines)}</div>
          <div className="small muted num">{i18n.money(s.unmatchedLinesSum, s.currency)}</div>
        </div>
      </div>
      {open && !s.canReconcile && <div className="alert info">{t('bk_reconcileHint')}</div>}
      <ErrorBox error={error} />

      <div className="card">
        <div className="card-head pad"><strong>{t('bk_bankSide')}</strong></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('date')}</th><th>{t('description')}</th><th>{t('bk_col_reference')}</th><th className="num">{t('bk_in')}</th><th className="num">{t('bk_out')}</th><th>{t('bk_matched')}</th><th /></tr></thead>
            <tbody>
              {s.lines.map((l) => (
                <tr key={l.seq}>
                  <td className="num">{i18n.date(l.date)}</td>
                  <td>{l.description}</td>
                  <td className="ltr">{l.reference}</td>
                  <td className="num">{l.amount > 0 ? i18n.money(l.amount, s.currency) : ''}</td>
                  <td className="num">{l.amount < 0 ? i18n.money(-l.amount, s.currency) : ''}</td>
                  <td>{l.entry ? <EntryLink entry={l.entry} /> : <span className="chip warn">—</span>}</td>
                  <td className="num">
                    {open && (l.entry ? (
                      <button type="button" className="btn subtle small" disabled={busy} onClick={() => void act(() => bankingApi.match(id, l.seq, null))}>{t('bk_unmatch')}</button>
                    ) : (
                      <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button type="button" className="btn subtle small" onClick={() => setMatching(l)}>{t('bk_matchTo')}</button>
                        <button type="button" className="btn subtle small" onClick={() => setVoucher(l)}>{t('bk_makeVoucher')}</button>
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head pad"><strong>{t('bk_unmatchedBook')}</strong> <span className="muted num">{i18n.int(s.unmatchedBook)} · {i18n.money(s.unmatchedBookSum, s.currency)}</span></div>
        {freeBook.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('date')}</th><th>{t('bk_openEntry')}</th><th>{t('description')}</th><th className="num">{t('bk_in')}</th><th className="num">{t('bk_out')}</th></tr></thead>
              <tbody>
                {freeBook.map((b) => (
                  <tr key={b.entryId}>
                    <td className="num">{i18n.date(b.date)}</td>
                    <td><a className="ltr" href={href(`entry/${b.entryId}`)}>{b.number ?? '—'}</a></td>
                    <td>{b.description}</td>
                    <td className="num">{b.amount > 0 ? i18n.money(b.amount, s.currency) : ''}</td>
                    <td className="num">{b.amount < 0 ? i18n.money(-b.amount, s.currency) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="pad muted" style={{ margin: 0 }}>—</p>}
      </div>

      {matching && (
        <Modal title={`${t('bk_pickEntry')} · ${i18n.money(matching.amount, s.currency)}`} onClose={() => setMatching(null)}>
          <div className="stack">
            {(() => {
              const candidates = freeBook.filter((b) => b.amount === matching.amount);
              if (!candidates.length) return <p className="muted">{t('bk_noCandidates')}</p>;
              return (
                <table className="table">
                  <tbody>
                    {candidates.map((b) => (
                      <tr key={b.entryId}>
                        <td className="num">{i18n.date(b.date)}</td>
                        <td className="ltr">{b.number ?? '—'}</td>
                        <td>{b.description}</td>
                        <td className="num"><button type="button" className="btn small primary" disabled={busy} onClick={() => { setMatching(null); void act(() => bankingApi.match(id, matching.seq, b.entryId)); }}>{t('bk_matched')}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
            <div className="row"><button type="button" className="btn" onClick={() => setMatching(null)}>{t('cancel')}</button></div>
          </div>
        </Modal>
      )}
      {voucher && <LineVoucher statement={s} line={voucher} onClose={() => setVoucher(null)} onDone={(v) => { setVoucher(null); setView(v); }} />}
    </div>
  );
}

function LineVoucher({ statement, line, onClose, onDone }: { statement: StatementView; line: StatementLineView; onClose(): void; onDone(v: StatementView): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const [accountCode, setAccountCode] = useState(line.amount < 0 ? '39' : '49');
  const [description, setDescription] = useState(line.description);
  const [rate, setRate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const rateX100 = statement.currency === 'USD' ? parseRate(rate || String(settings?.defaultRateX100 ?? '')) : null;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      onDone(await bankingApi.voucherFromLine(statement.id, line.seq, { accountCode, description: description.trim() || line.description, ...(rateX100 ? { rateX100 } : {}) }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t('bk_makeVoucher')} · ${i18n.money(line.amount, statement.currency)}`} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('bk_makeVoucherHelp')}</p>
        <div className="field"><span>{t('bk_counterAccount')}</span><AccountCombo value={accountCode} onChange={setAccountCode} filter={(a) => !a.code.startsWith('18')} ariaLabel={t('bk_counterAccount')} /></div>
        <label className="field"><span>{t('description')}</span><input className="input" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        {statement.currency === 'USD' && <RateField value={rate || (settings ? String(settings.defaultRateX100) : '')} onChange={setRate} />}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !accountCode} onClick={() => void save()}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}
