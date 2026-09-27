import { useState } from 'react';
import { api, type InvoiceSummary, type PartyInput, type PartyType, type PartyView } from '../api.ts';
import { AccountCombo, AmountInput, ErrorBox, Icon, InvoiceStatusChip, Modal, downloadCsv, useLoad, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { go, href } from '../router.ts';

/** الزبائن / المجهزون */
export function Parties({ type }: { type: PartyType }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<PartyView | 'new' | null>(null);
  const { data, error, reload } = useLoad(() => api.parties({ type, q: q.trim() }), [type, q]);
  const total = (data ?? []).reduce((s, p) => s + p.balance, 0);

  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} />{type === 'customer' ? t('newCustomer') : t('newSupplier')}</button>
        <a className="btn" href={href(type === 'customer' ? 'new-invoice/sale' : 'new-invoice/purchase')}><Icon name="invoice" size={16} />{type === 'customer' ? t('newSale') : t('newPurchase')}</a>
        <span className="spacer" />
        <input className="input" style={{ width: 240 }} type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {data && data.length === 0 && <p className="muted" style={{ padding: '14px 16px', margin: 0 }}>{t('noParties')}</p>}
        {data && data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>{t('code')}</th>
                <th>{t('name')}</th>
                <th>{t('phone')}</th>
                <th className="amount">{t('balanceDue')}</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className="click" onClick={() => go(`party/${p.id}`)}>
                  <td><span className="tree-code">{p.code}</span></td>
                  <td>
                    <strong>{p.name}</strong>
                    {!p.active && <span className="chip" style={{ marginInlineStart: 8 }}>{t('inactive')}</span>}
                    {p.address && <div className="muted small">{p.address}</div>}
                  </td>
                  <td className="num ltr">{i18n.digitsOf(p.phone)}</td>
                  <td className="amount">{p.balance ? i18n.money(p.balance, 'IQD') : <span className="muted">—</span>}</td>
                  <td>
                    <button type="button" className="btn icon ghost" title={t('actEdit')} aria-label={t('actEdit')} onClick={(e) => { e.stopPropagation(); setEditing(p); }}>
                      <Icon name="edit" size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td /><td>{t('total')}</td><td /><td className="amount">{i18n.money(total, 'IQD')}</td><td /></tr>
            </tfoot>
          </table>
        )}
      </div>
      {editing && (
        <PartyForm type={type} party={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(p) => { setEditing(null); reload(); if (editing === 'new') go(`party/${p.id}`); }} />
      )}
    </div>
  );
}

export function PartyForm({ type, party, onClose, onSaved }: { type: PartyType; party: PartyView | null; onClose(): void; onSaved(p: PartyView): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState(party?.name ?? '');
  const [phone, setPhone] = useState(party?.phone ?? '');
  const [address, setAddress] = useState(party?.address ?? '');
  const [accountCode, setAccountCode] = useState(party?.accountCode ?? '');
  const [creditLimit, setCreditLimit] = useState<number | null>(party?.creditLimit ?? null);
  const [notes, setNotes] = useState(party?.notes ?? '');
  const [active, setActive] = useState(party?.active ?? true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const root = type === 'customer' ? '16' : '26';

  async function save() {
    setBusy(true);
    setError(null);
    const input: PartyInput = { name, phone, address, notes, active, creditLimit: type === 'customer' ? creditLimit : null };
    if (accountCode) input.accountCode = accountCode;
    try {
      const saved = party ? await api.updateParty(party.id, input) : await api.createParty(type, input);
      toast(t('saved'));
      onSaved(saved);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={party ? `${party.code} — ${party.name}` : type === 'customer' ? t('newCustomer') : t('newSupplier')} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>{t('name')}</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <div className="grid-2">
          <label className="field"><span>{t('phone')}</span><input className="input ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          {type === 'customer' && (
            <label className="field"><span>{t('creditLimit')}</span><AmountInput value={creditLimit} currency="IQD" onChange={setCreditLimit} ariaLabel={t('creditLimit')} /></label>
          )}
        </div>
        <label className="field"><span>{t('address')}</span><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        <div className="field">
          <span>{t('linkedAccount')}</span>
          <AccountCombo value={accountCode} onChange={setAccountCode} filter={(a) => a.code.startsWith(root)} ariaLabel={t('linkedAccount')} />
        </div>
        <label className="field"><span>{t('notes')}</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {party && (
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('active')}</label>
        )}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy} onClick={save}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** كشف حساب زبون / مجهز, with their invoices. */
export function PartyDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [editing, setEditing] = useState(false);
  const { data, error, reload } = useLoad(() => api.partyStatement(id, from || undefined, to || undefined), [id, from, to]);
  const invoices = useLoad(() => api.invoices({ partyId: id }), [id]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const p = data.party;
  const isCustomer = p.type === 'customer';

  const exportCsv = () => downloadCsv(`${p.code}-statement.csv`, [
    [t('date'), t('number'), t('description'), t('debit'), t('credit'), t('balance')],
    [from, '', t('opening'), '', '', data.opening],
    ...data.lines.map((l) => [l.date, l.number, l.description, l.debit, l.credit, l.balance]),
    ['', '', t('closing'), data.totalDebit, data.totalCredit, data.closing]
  ]);

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <div className="row no-print">
        <button type="button" className="btn" onClick={() => history.back()}>{t('back')}</button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={16} />{t('actEdit')}</button>
        <a className="btn primary" href={href(isCustomer ? `new-invoice/sale/${p.id}` : `new-invoice/purchase/${p.id}`)}><Icon name="plus" size={16} />{isCustomer ? t('newSale') : t('newPurchase')}</a>
        <button type="button" className="btn" onClick={exportCsv}><Icon name="download" size={16} />{t('exportExcel')}</button>
        <button type="button" className="btn" onClick={() => window.print()}><Icon name="printer" size={16} />{t('print')}</button>
      </div>

      <div className="grid-4">
        <div className="card pad tile" style={{ gridColumn: 'span 2' }}>
          <div className="label">{isCustomer ? t('customer') : t('supplier')} · <span className="ltr">{p.code}</span></div>
          <div className="value" style={{ fontSize: 20 }}>{p.name}</div>
          <div className="muted small">{[p.phone && i18n.digitsOf(p.phone), p.address].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="card pad tile">
          <div className="label">{t('balanceDue')}</div>
          <div className="value num">{i18n.money(p.balance, 'IQD')}</div>
        </div>
        <div className="card pad tile">
          <div className="label">{isCustomer ? t('creditLimit') : t('linkedAccount')}</div>
          <div className="value num" style={{ fontSize: 18 }}>{isCustomer ? (p.creditLimit === null ? t('noLimit') : i18n.money(p.creditLimit, 'IQD')) : <span className="ltr">{p.accountCode}</span>}</div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ padding: '12px 16px' }}>
          <h2>{t('statement')}</h2>
          <span className="spacer" />
          <label className="row small no-print" style={{ gap: 6 }}>{t('from')}<input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} /></label>
          <label className="row small no-print" style={{ gap: 6 }}>{t('to')}<input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} /></label>
        </div>
        <table className="table">
          <thead>
            <tr><th>{t('date')}</th><th>{t('number')}</th><th>{t('description')}</th><th className="amount">{t('debit')}</th><th className="amount">{t('credit')}</th><th className="amount">{t('balance')}</th></tr>
          </thead>
          <tbody>
            <tr><td /><td /><td className="muted">{t('opening')}</td><td /><td /><td className="amount">{i18n.money(data.opening, 'IQD')}</td></tr>
            {data.lines.map((l, i) => (
              <tr key={i} className="click" onClick={() => go(l.invoiceId ? `invoice/${l.invoiceId}` : `entry/${l.entryId}`)}>
                <td className="num">{i18n.date(l.date)}</td>
                <td><span className="ltr num">{l.number}</span></td>
                <td>{l.description}</td>
                <td className="amount">{l.debit ? i18n.money(l.debit, 'IQD') : ''}</td>
                <td className="amount">{l.credit ? i18n.money(l.credit, 'IQD') : ''}</td>
                <td className="amount">{i18n.money(l.balance, 'IQD')}</td>
              </tr>
            ))}
            {data.lines.length === 0 && <tr><td colSpan={6} className="muted">{t('noData')}</td></tr>}
          </tbody>
          <tfoot>
            <tr><td /><td /><td>{t('closing')}</td><td className="amount">{i18n.money(data.totalDebit, 'IQD')}</td><td className="amount">{i18n.money(data.totalCredit, 'IQD')}</td><td className="amount">{i18n.money(data.closing, 'IQD')}</td></tr>
          </tfoot>
        </table>
      </div>

      <div className="card no-print">
        <div style={{ padding: '12px 16px' }}><h2>{t('partyInvoices')}</h2></div>
        {invoices.data && <InvoicesTable invoices={invoices.data} showParty={false} />}
      </div>

      {editing && <PartyForm type={p.type} party={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </div>
  );
}

export function InvoicesTable({ invoices, showParty = true }: { invoices: InvoiceSummary[]; showParty?: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (invoices.length === 0) return <p className="muted" style={{ padding: '14px 16px', margin: 0 }}>{t('noInvoices')}</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{t('colNumber')}</th>
          <th>{t('colDate')}</th>
          {showParty && <th>{t('customerOrSupplier')}</th>}
          <th>{t('paymentMode')}</th>
          <th className="amount">{t('totalDue')}</th>
          <th>{t('colStatus')}</th>
        </tr>
      </thead>
      <tbody>
        {invoices.map((v) => (
          <tr key={v.id} className="click" onClick={() => go(`invoice/${v.id}`)}>
            <td>
              {v.number ? <a href={href(`invoice/${v.id}`)} className="ltr num" onClick={(e) => e.stopPropagation()}>{v.number}</a> : <span className="muted">{t('draft')}</span>}
              {v.returnOf && <> <span className="chip warn">{t(v.kind)}</span></>}
            </td>
            <td className="num">{i18n.date(v.date)}</td>
            {showParty && <td>{v.partyName ?? <span className="muted">{t('walkIn')}</span>}</td>}
            <td>{v.payment === 'cash' ? t('payCash') : t('payCredit')}</td>
            <td className="amount">{i18n.money(v.total, v.currency)}</td>
            <td><InvoiceStatusChip status={v.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
