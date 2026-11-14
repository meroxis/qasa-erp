import { useState } from 'react';
import type { EntryStatus, EntryType } from '@qasa/core';
import { api, type EntrySummary } from '../api.ts';
import { EmptyState, ErrorBox, Icon, typeName, useData, useLoad, useMay } from '../components.tsx';
import { QuickVoucherButton } from '../industry/QuickVoucher.tsx';
import { ApprovalButtons, approvalStateOf, useMayApprove, useVoucherApproval, VoucherStateChip } from '../industry/VoucherApproval.tsx';
import { useI18n } from '../i18n.ts';
import { go, href } from '../router.ts';

export function EntriesTable({ entries, onChanged }: { entries: EntrySummary[]; onChanged?: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  // 1.4: vouchers that wait for approval get Approve and Reject on their row, for whoever may approve vouchers
  const mayApprove = useMayApprove();
  const deciding = !!onChanged && mayApprove && entries.some((e) => approvalStateOf(e) === 'waiting');
  if (entries.length === 0) return <EmptyState compact icon="book" title={t('es_vouchers')} text={t('es_vouchersText')} />;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{t('colNumber')}</th>
          <th>{t('colType')}</th>
          <th>{t('colDate')}</th>
          <th>{t('colParty')}</th>
          <th className="amount">{t('colAmount')}</th>
          <th>{t('colStatus')}</th>
          {deciding && <th />}
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id} className="click" onClick={() => go(`entry/${e.id}`)}>
            <td>{e.number ? <a href={href(`entry/${e.id}`)} className="ltr num" onClick={(ev) => ev.stopPropagation()}>{e.number}</a> : <span className="muted">{t('draft')}</span>}</td>
            <td>{typeName(e.type, i18n)}</td>
            <td className="num">{i18n.date(e.date)}</td>
            <td>
              <div className="bidi" style={{ fontWeight: 600 }}>{e.party || e.description}</div>
              {e.party && <div className="muted small bidi">{e.description}</div>}
            </td>
            <td className="amount">{i18n.money(e.total, e.currency)}</td>
            <td>
              <VoucherStateChip entry={e} />
              {approvalStateOf(e) === 'rejected' && e.approval?.reason && <div className="muted small bidi">{e.approval.reason}</div>}
            </td>
            {deciding && (
              <td style={{ whiteSpace: 'nowrap' }}>
                {approvalStateOf(e) === 'waiting' && <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><ApprovalButtons id={e.id} small onDone={onChanged!} /></span>}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TYPES: (EntryType | '')[] = ['', 'receipt', 'payment', 'journal', 'sale', 'purchase', 'reversal', 'closing'];
const STATUSES: (EntryStatus | '')[] = ['', 'draft', 'checked', 'approved'];
/** Someone who does not keep the books has only the vouchers they prepared: receipts and payments. */
const OWN_TYPES: (EntryType | '')[] = ['', 'receipt', 'payment'];

export function Entries({ status: initialStatus }: { status?: EntryStatus } = {}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [type, setType] = useState<EntryType | ''>('');
  const [status, setStatus] = useState<EntryStatus | ''>(initialStatus ?? '');
  // 1.4: only the vouchers that wait for approval, or that were rejected
  const [approval, setApproval] = useState<'' | 'waiting' | 'rejected'>('');
  const [q, setQ] = useState('');
  // 1.4: someone who does not keep the books gets their own vouchers from the server and no other, and prepares them
  // with "Receive payment" only: no editor, no count of what waits in the whole company
  const own = useData().seesBooks === false;
  // the voucher editor is for whoever prepares vouchers (may.ts); others read the journal
  const mayPrepare = useMay()('voucher');
  const { data, error, reload } = useLoad(() => api.entries({ type, status, approval, q: q.trim() }), [type, status, approval, q]);
  const [approvalState, reloadApproval] = useVoucherApproval();
  const showApproval = !!approvalState && (approvalState.on || (!own && approvalState.waiting > 0) || approval !== '' || (own && !!data?.some((e) => e.approval)));
  const changed = () => { reload(); reloadApproval(); };

  return (
    <div className="stack">
      {own && <div className="alert info small">{t('s14_myVouchersHelp')}</div>}
      <div className="row">
        {!own && mayPrepare && (
          <>
            <a className="btn primary" href={href('new/receipt')}><Icon name="plus" size={16} />{t('newReceipt')}</a>
            <a className="btn primary" href={href('new/payment')}><Icon name="plus" size={16} />{t('newPayment')}</a>
            <a className="btn" href={href('new/journal')}><Icon name="plus" size={16} />{t('newJournal')}</a>
          </>
        )}
        <QuickVoucherButton kind="receipt" className={own ? 'btn primary' : 'btn'} onDone={changed} />
        <QuickVoucherButton kind="payment" onDone={changed} />
        <span className="spacer" />
        <input className="input" style={{ width: 240 }} type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="tabs">
        {(own ? OWN_TYPES : TYPES).map((ty) => (
          <button key={ty || 'all'} type="button" aria-pressed={type === ty} onClick={() => setType(ty)}>{ty ? typeName(ty, i18n) : t('all')}</button>
        ))}
      </div>
      <div className="row">
        <div className="track">
          {STATUSES.map((s) => (
            <button key={s || 'all'} type="button" aria-pressed={status === s && !approval} onClick={() => { setApproval(''); setStatus(s); }}>{s ? t(s) : t('all')}</button>
          ))}
          {showApproval && (
            <>
              <button type="button" aria-pressed={approval === 'waiting'} onClick={() => { setStatus(''); setApproval('waiting'); }}>
                {t('s14_waiting')}{!own && approvalState.waiting > 0 ? ` (${i18n.int(approvalState.waiting)})` : ''}
              </button>
              <button type="button" aria-pressed={approval === 'rejected'} onClick={() => { setStatus(''); setApproval('rejected'); }}>{t('s14_rejected')}</button>
            </>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card">{data && <EntriesTable entries={data} onChanged={changed} />}</div>
    </div>
  );
}
