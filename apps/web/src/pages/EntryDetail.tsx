import { useState } from 'react';
import { amountInWords, rateFromX100, todayIso } from '@qasa/core';
import { api, type EntryView } from '../api.ts';
import { ErrorBox, Icon, Modal, StatusChip, useData, useLoad, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { go, href } from '../router.ts';

function time(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function EntryDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, reloadAccounts } = useData();
  const { data, error, reload } = useLoad(() => api.entry(id), [id]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [reversing, setReversing] = useState(false);
  const [reverseDate, setReverseDate] = useState(todayIso());

  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const e: EntryView = data;
  const isVoucher = e.type === 'receipt' || e.type === 'payment';
  const company = settings ? i18n.name(settings.companyName) : '';

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await reloadAccounts();
      toast(message);
      reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t('confirmDelete'))) return;
    setBusy(true);
    try {
      await api.deleteEntry(id);
      toast(t('a_delete'));
      go('entries');
    } catch (err) {
      setActionError(err);
      setBusy(false);
    }
  }

  async function reverse() {
    setBusy(true);
    setActionError(null);
    try {
      const reversal = await api.reverse(id, reverseDate);
      await reloadAccounts();
      setReversing(false);
      toast(t('a_reverse'));
      go(`entry/${reversal.id}`);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  const sigs = [
    { role: t('preparedBy'), who: e.preparedBy, at: e.preparedAt, done: true },
    { role: t('checkedBy'), who: e.checkedBy, at: e.checkedAt, done: !!e.checkedBy },
    { role: t('approvedBy'), who: e.approvedBy, at: e.approvedAt, done: !!e.approvedBy }
  ];

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <div className="row no-print">
        <button type="button" className="btn" onClick={() => history.back()}>{t('back')}</button>
        <span className="spacer" />
        {e.actions.includes('edit') && <a className="btn" href={href(`edit/${e.id}`)}>{t('actEdit')}</a>}
        {e.actions.includes('delete') && <button type="button" className="btn danger" disabled={busy} onClick={remove}>{t('actDelete')}</button>}
        {e.actions.includes('return') && <button type="button" className="btn" disabled={busy} onClick={() => run(() => api.entryAction(id, 'return'), t('a_return'))}>{t('actReturn')}</button>}
        {e.actions.includes('check') && <button type="button" className="btn primary" disabled={busy} onClick={() => run(() => api.entryAction(id, 'check'), t('a_check'))}><Icon name="check" size={16} />{t('actCheck')}</button>}
        {e.actions.includes('approve') && <button type="button" className="btn primary" disabled={busy} onClick={() => run(() => api.entryAction(id, 'approve'), t('a_approve'))}><Icon name="check" size={16} />{t('actApprove')}</button>}
        {e.actions.includes('reverse') && <button type="button" className="btn danger" disabled={busy} onClick={() => setReversing(true)}><Icon name="undo" size={16} />{t('actReverse')}</button>}
        <button type="button" className="btn" onClick={() => window.print()}><Icon name="printer" size={16} />{t('print')}</button>
      </div>
      <ErrorBox error={actionError} />
      {e.status === 'approved' && <div className="alert info no-print">{e.invoiceId ? t('fromInvoiceNote') : e.stockDocId ? t('fromStockDocNote') : t('postedNote')}</div>}

      <div className="paper">
        <div className="paper-head">
          <div style={{ flex: 1 }}>
            <div className="muted">{company}</div>
            <div className="paper-title">{t(e.type)}</div>
            <div style={{ marginTop: 4 }}><StatusChip status={e.status} reversed={!!e.reversedById} /></div>
          </div>
          <div className="paper-meta">
            <span className="muted">{t('number')}</span><strong className="ltr">{e.number ?? t('draft')}</strong>
            <span className="muted">{t('date')}</span><strong className="num">{i18n.date(e.date)}</strong>
            {e.currency === 'USD' && <><span className="muted">{t('exchangeRate')}</span><strong className="num">{i18n.digitsOf(String(rateFromX100(e.rateX100)))}</strong></>}
          </div>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          {e.party && (
            <div className="row"><span className="muted" style={{ width: 130 }}>{e.type === 'payment' ? t('paidTo') : e.type === 'receipt' ? t('receivedFrom') : t('colParty')}</span><strong>{e.party}</strong></div>
          )}
          {/* An invoice posting mixes the sale with its cost, so its total is not an amount anyone pays — the invoice shows that. */}
          {!e.invoiceId && !e.stockDocId && (
            <>
              <div className="row"><span className="muted" style={{ width: 130 }}>{t('amount')}</span><strong style={{ fontSize: 18 }} className="num">{i18n.money(e.total, e.currency)}</strong>
                {e.currency === 'USD' && <span className="muted">({t('iqdEquivalent')}: {i18n.money(e.baseTotal, 'IQD')})</span>}
              </div>
              <div className="row" style={{ alignItems: 'flex-start' }}><span className="muted" style={{ width: 130, paddingTop: 10 }}>{t('inWords')}</span><div className="words" style={{ flex: 1 }}>{i18n.digitsOf(amountInWords(e.total, e.currency, i18n.lang))}</div></div>
            </>
          )}
          <div className="row"><span className="muted" style={{ width: 130 }}>{isVoucher ? t('forLabel') : t('description')}</span><span>{e.description}</span></div>
          {e.invoiceId && <div className="row"><span className="muted" style={{ width: 130 }}>{t('e_invoice')}</span><a href={href(`invoice/${e.invoiceId}`)}>{t('openInvoice')}</a></div>}
          {e.stockDocId && <div className="row"><span className="muted" style={{ width: 130 }}>{t('e_stock_doc')}</span><a href={href(`stock-doc/${e.stockDocId}`)}>{t('openDocument')}</a></div>}
          {e.reversesId && <div className="row"><span className="muted" style={{ width: 130 }}>{t('reverses')}</span><a href={href(`entry/${e.reversesId}`)}>{t('open')}</a></div>}
          {e.reversedById && <div className="row"><span className="muted" style={{ width: 130 }}>{t('reversedBy')}</span><a href={href(`entry/${e.reversedById}`)}>{t('open')}</a></div>}
        </div>

        <table className="table" style={{ marginTop: 16 }}>
          <thead>
            <tr><th style={{ width: 80 }}>{t('code')}</th><th>{t('account')}</th><th className="amount">{t('debit')}</th><th className="amount">{t('credit')}</th></tr>
          </thead>
          <tbody>
            {e.lines.map((l) => (
              <tr key={l.lineNo}>
                <td><span className="tree-code">{l.accountCode}</span></td>
                <td>{i18n.name(l.accountName)}{l.partyName && <span className="chip info" style={{ marginInlineStart: 8 }}>{l.partyName}</span>}{l.description && l.description !== e.description && <div className="muted small">{l.description}</div>}</td>
                <td className="amount">{l.debit ? i18n.money(l.debit, e.currency) : ''}</td>
                <td className="amount">{l.credit ? i18n.money(l.credit, e.currency) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td /><td>{t('total')}</td><td className="amount">{i18n.money(e.total, e.currency)}</td><td className="amount">{i18n.money(e.total, e.currency)}</td></tr>
          </tfoot>
        </table>

        <div className="sigs">
          {sigs.map((s) => (
            <div key={s.role} className={'sig' + (s.done ? ' done' : '')}>
              <div className="muted small">{s.role}</div>
              <div className="who">{s.who || '—'}</div>
              <div className="small" style={{ color: s.done ? 'var(--ok)' : 'var(--warn)', fontWeight: 600 }}>{s.done ? '✓ ' + i18n.digitsOf(time(s.at)) : t('waiting')}</div>
            </div>
          ))}
        </div>
      </div>

      {reversing && (
        <Modal title={t('reverseTitle')} onClose={() => setReversing(false)}>
          <div className="stack">
            <p style={{ margin: 0 }}>{t('reverseHelp')}</p>
            <label className="field"><span>{t('reversalDate')}</span><input className="input" type="date" value={reverseDate} onChange={(ev) => setReverseDate(ev.target.value)} /></label>
            <ErrorBox error={actionError} />
            <div className="row">
              <button type="button" className="btn danger" disabled={busy} onClick={reverse}>{t('confirm')}</button>
              <button type="button" className="btn" onClick={() => setReversing(false)}>{t('cancel')}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
