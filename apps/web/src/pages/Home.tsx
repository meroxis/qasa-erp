import { todayIso } from '@qasa/core';
import { api } from '../api.ts';
import { ErrorBox, Icon, useData, useLoad } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';
import { EntriesTable } from './Entries.tsx';

export function Home() {
  const i18n = useI18n();
  const { t } = i18n;
  const { accounts, settings } = useData();
  const { data: entries, error } = useLoad(() => api.entries(), []);
  const month = todayIso().slice(0, 7);
  const cash = accounts.find((a) => a.code === '18')?.balance ?? 0;
  const count = (fn: (e: NonNullable<typeof entries>[number]) => boolean) => (entries ?? []).filter(fn).length;
  const noCompany = settings && !settings.companyName.ar && !settings.companyName.en && !settings.companyName.ku;

  const tiles = [
    { label: t('cashAndBanks'), value: i18n.money(cash, 'IQD') },
    { label: t('waitingCheck'), value: i18n.int(count((e) => e.status === 'draft')) },
    { label: t('waitingApproval'), value: i18n.int(count((e) => e.status === 'checked')) },
    { label: t('postedThisMonth'), value: i18n.int(count((e) => e.status === 'approved' && e.date.startsWith(month))) }
  ];

  return (
    <div className="stack">
      {noCompany && (
        <div className="alert info">{t('setupCompany')} <a href={href('settings')}>{t('settings')}</a></div>
      )}
      <div className="grid-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="card pad tile">
            <div className="label">{tile.label}</div>
            <div className="value num">{tile.value}</div>
          </div>
        ))}
      </div>
      <div className="card pad stack">
        <h2>{t('quickActions')}</h2>
        <div className="row">
          <a className="btn primary" href={href('new/receipt')}><Icon name="plus" size={16} />{t('newReceipt')}</a>
          <a className="btn primary" href={href('new/payment')}><Icon name="plus" size={16} />{t('newPayment')}</a>
          <a className="btn" href={href('new/journal')}><Icon name="plus" size={16} />{t('newJournal')}</a>
          <a className="btn" href={href('trial-balance')}><Icon name="chart" size={16} />{t('trialBalance')}</a>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <div className="row" style={{ padding: '14px 16px 6px' }}>
          <h2>{t('recentEntries')}</h2>
          <span className="spacer" />
          <a className="btn ghost small" href={href('entries')}>{t('viewAll')}</a>
        </div>
        {entries && <EntriesTable entries={entries.slice(0, 10)} />}
      </div>
    </div>
  );
}
