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
  const sales = useLoad(() => api.invoices({ kind: 'sale', status: 'posted', from: `${month}-01` }), [month]);
  const salesTotal = (sales.data ?? []).reduce((s, v) => s + v.baseTotal, 0);
  const parties = useLoad(() => api.parties(), []);
  const owed = (type: 'customer' | 'supplier') => (parties.data ?? []).filter((p) => p.type === type).reduce((sum, p) => sum + p.balance, 0);
  const cash = accounts.find((a) => a.code === '18')?.balance ?? 0;
  const count = (fn: (e: NonNullable<typeof entries>[number]) => boolean) => (entries ?? []).filter(fn).length;
  const noCompany = settings && !settings.companyName.ar && !settings.companyName.en && !settings.companyName.ku;

  const tiles = [
    { label: t('cashAndBanks'), value: i18n.money(cash, 'IQD') },
    { label: t('salesThisMonth'), value: i18n.money(salesTotal, 'IQD'), link: 'sales' },
    { label: t('receivables'), value: i18n.money(owed('customer'), 'IQD'), link: 'customers' },
    { label: t('payables'), value: i18n.money(owed('supplier'), 'IQD'), link: 'suppliers' },
    { label: t('waitingCheck'), value: i18n.int(count((e) => e.status === 'draft')) },
    { label: t('waitingApproval'), value: i18n.int(count((e) => e.status === 'checked')) },
    { label: t('postedThisMonth'), value: i18n.int(count((e) => e.status === 'approved' && e.date.startsWith(month))) }
  ] as { label: string; value: string; link?: string }[];

  return (
    <div className="stack">
      {noCompany && (
        <div className="alert info">{t('setupCompany')} <a href={href('settings')}>{t('settings')}</a></div>
      )}
      <div className="grid-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="card pad tile">
            <div className="label">{tile.link ? <a href={href(tile.link)}>{tile.label}</a> : tile.label}</div>
            <div className="value num">{tile.value}</div>
          </div>
        ))}
      </div>
      <div className="card pad stack">
        <h2>{t('quickActions')}</h2>
        <div className="row">
          <a className="btn primary" href={href('new-invoice/sale')}><Icon name="invoice" size={16} />{t('newSale')}</a>
          <a className="btn" href={href('new-invoice/purchase')}><Icon name="cart" size={16} />{t('newPurchase')}</a>
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
