import { useState } from 'react';
import type { EntryStatus, EntryType } from '@qasa/core';
import { api, type EntrySummary } from '../api.ts';
import { ErrorBox, Icon, StatusChip, typeName, useLoad } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { go, href } from '../router.ts';

export function EntriesTable({ entries }: { entries: EntrySummary[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (entries.length === 0) return <p className="muted" style={{ padding: '14px 16px', margin: 0 }}>{t('noEntries')}</p>;
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
            <td><StatusChip status={e.status} reversed={!!e.reversedById} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TYPES: (EntryType | '')[] = ['', 'receipt', 'payment', 'journal', 'sale', 'purchase', 'reversal', 'closing'];
const STATUSES: (EntryStatus | '')[] = ['', 'draft', 'checked', 'approved'];

export function Entries({ status: initialStatus }: { status?: EntryStatus } = {}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [type, setType] = useState<EntryType | ''>('');
  const [status, setStatus] = useState<EntryStatus | ''>(initialStatus ?? '');
  const [q, setQ] = useState('');
  const { data, error } = useLoad(() => api.entries({ type, status, q: q.trim() }), [type, status, q]);

  return (
    <div className="stack">
      <div className="row">
        <a className="btn primary" href={href('new/receipt')}><Icon name="plus" size={16} />{t('newReceipt')}</a>
        <a className="btn primary" href={href('new/payment')}><Icon name="plus" size={16} />{t('newPayment')}</a>
        <a className="btn" href={href('new/journal')}><Icon name="plus" size={16} />{t('newJournal')}</a>
        <span className="spacer" />
        <input className="input" style={{ width: 240 }} type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="tabs">
        {TYPES.map((ty) => (
          <button key={ty || 'all'} type="button" aria-pressed={type === ty} onClick={() => setType(ty)}>{ty ? typeName(ty, i18n) : t('all')}</button>
        ))}
      </div>
      <div className="row">
        <div className="track">
          {STATUSES.map((s) => (
            <button key={s || 'all'} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s ? t(s) : t('all')}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card">{data && <EntriesTable entries={data} />}</div>
    </div>
  );
}
