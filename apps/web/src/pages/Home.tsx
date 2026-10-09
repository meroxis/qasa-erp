import { useEffect } from 'react';
import { todayIso } from '@qasa/core';
import { api } from '../api.ts';
import { ErrorBox, Icon, StatusChip, useData, useLoad } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';
import { EntriesTable } from './Entries.tsx';

export function Home() {
  const i18n = useI18n();
  const { t } = i18n;
  const { accounts, settings, plan, reloadPlan } = useData();
  // this month's invoice count feeds the "growing" note
  useEffect(() => { void reloadPlan(); }, [reloadPlan]);
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
    { label: t('cashAndBanks'), value: i18n.money(cash, 'IQD'), icon: 'wallet' },
    { label: t('salesThisMonth'), value: i18n.money(salesTotal, 'IQD'), link: 'sales', icon: 'trend' },
    { label: t('receivables'), value: i18n.money(owed('customer'), 'IQD'), link: 'customers', icon: 'contact' },
    { label: t('payables'), value: i18n.money(owed('supplier'), 'IQD'), link: 'suppliers', icon: 'truck' }
  ] as { label: string; value: string; link?: string; icon: string }[];
  // the Iraqi approval chain at a glance: prepared → checked → approved
  const flow = [
    { status: 'draft', label: t('waitingCheck'), value: count((e) => e.status === 'draft') },
    { status: 'checked', label: t('waitingApproval'), value: count((e) => e.status === 'checked') },
    { status: 'approved', label: t('postedThisMonth'), value: count((e) => e.status === 'approved' && e.date.startsWith(month)) }
  ] as const;

  return (
    <div className="stack">
      {noCompany && (
        <div className="alert info">{t('setupCompany')} <a href={href('settings')}>{t('settings')}</a></div>
      )}
      {plan?.license?.state === 'expired' && plan.license.expires && (
        <div className="alert bad plan-banner">
          <span>{t('expiredNote', { p: t(`plan_${plan.license.plan}`), d: i18n.date(plan.license.expires) })}</span>
          <a href={href('plans')}>{t('planLicense')}</a>
        </div>
      )}
      {plan?.nudge && (
        <div className="alert info plan-banner">
          <strong>{t('nudgeTitle')}</strong>
          <span>{t('nudgeText', { n: plan.usage.salesThisMonth })}</span>
          <a href={href('plans')}>{t('seePlans')}</a>
        </div>
      )}
      <nav className="cmdbar no-print" aria-label={t('quickActions')}>
        <a className="btn primary" href={href('new-invoice/sale')}><Icon name="invoice" size={16} />{t('newSale')}</a>
        <a className="btn" href={href('new-invoice/purchase')}><Icon name="cart" size={16} />{t('newPurchase')}</a>
        <span className="sep" />
        <a className="btn" href={href('new/receipt')}><Icon name="plus" size={16} />{t('newReceipt')}</a>
        <a className="btn" href={href('new/payment')}><Icon name="plus" size={16} />{t('newPayment')}</a>
        <a className="btn" href={href('new/journal')}><Icon name="plus" size={16} />{t('newJournal')}</a>
        <span className="sep" />
        <a className="btn" href={href('trial-balance')}><Icon name="chart" size={16} />{t('trialBalance')}</a>
      </nav>
      <div className="grid-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="card pad tile">
            <div className="label"><span className="ico"><Icon name={tile.icon} size={18} /></span>{tile.link ? <a href={href(tile.link)}>{tile.label}</a> : tile.label}</div>
            <div className="value num">{tile.value}</div>
          </div>
        ))}
      </div>
      <div className="card flow">
        <div className="flow-title">
          <h2>{t('voucherFlow')}</h2>
          <span className="small muted">{t('role_preparer')} · {t('role_checker')} · {t('role_approver')}</span>
        </div>
        {flow.map((step, i) => (
          <div key={step.status} style={{ display: 'contents' }}>
            {i > 0 && <Icon name="chevron" className="flip" />}
            <a className="step" href={href('entries')}>
              <span className="step-top"><span className="value num">{i18n.int(step.value)}</span><StatusChip status={step.status} /></span>
              <span className="label">{step.label}</span>
            </a>
          </div>
        ))}
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <div className="card-head">
          <h2>{t('recentEntries')}</h2>
          <span className="spacer" />
          <a className="btn ghost small" href={href('entries')}>{t('viewAll')}</a>
        </div>
        {entries && <EntriesTable entries={entries.slice(0, 10)} />}
      </div>
    </div>
  );
}
