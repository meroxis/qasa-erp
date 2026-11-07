import { useEffect } from 'react';
import { todayIso } from '@qasa/core';
import { api } from '../api.ts';
import { ErrorBox, Icon, StatusChip, useData, useLoad } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';
import { EntriesTable } from './Entries.tsx';
import { briefApi, type DashboardView } from '../industry/brief-api.ts';
import { moneyBoth } from './Brief.tsx';
import type { I18n } from '../i18n.ts';

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

  // the owner's dashboard (aged balances, cash in each currency, this month's profit); the simpler tiles until it loads
  const dash = useLoad(() => briefApi.dashboard(), []);
  const d = dash.data;
  const tiles = (d ? [
    { label: t('salesThisMonth'), value: i18n.money(d.salesMonth, 'IQD'), link: 'sales', icon: 'trend', sub: trendText(i18n, d.salesMonth, d.salesLastMonth) },
    { label: t('cashAndBanks'), value: moneyBoth(i18n, d.cash.total), icon: 'wallet', link: 'brief' },
    { label: t('br_profitMonth'), value: i18n.money(d.profitMonth.profit, 'IQD'), icon: 'chart', link: 'final-accounts', tone: d.profitMonth.profit < 0 ? 'bad' : 'ok' },
    { label: t('receivables'), value: i18n.money(d.receivables, 'IQD'), link: 'more-reports/aging', icon: 'contact' },
    { label: t('payables'), value: i18n.money(d.payables, 'IQD'), link: 'more-reports/supplier-aging', icon: 'truck' }
  ] : [
    { label: t('cashAndBanks'), value: i18n.money(cash, 'IQD'), icon: 'wallet' },
    { label: t('salesThisMonth'), value: i18n.money(salesTotal, 'IQD'), link: 'sales', icon: 'trend' },
    { label: t('receivables'), value: i18n.money(owed('customer'), 'IQD'), link: 'customers', icon: 'contact' },
    { label: t('payables'), value: i18n.money(owed('supplier'), 'IQD'), link: 'suppliers', icon: 'truck' }
  ]) as { label: string; value: string; link?: string; icon: string; sub?: string; tone?: 'ok' | 'bad' }[];
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
        <a className="btn" href={href('expenses')}><Icon name="wallet" size={16} />{t('br_newExpense')}</a>
        <a className="btn" style={{ marginInlineStart: 'auto' }} href={href('trial-balance')}><Icon name="chart" size={16} />{t('trialBalance')}</a>
      </nav>
      {d && (
        <a href={href('brief')} className="card pad no-print" style={{ display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none', color: 'inherit', borderInlineStart: '4px solid var(--accent, #1D5FD1)' }}>
          <span className="ico" style={{ display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: 12, background: 'var(--accent-soft, #E8F0FD)', color: 'var(--accent, #1D5FD1)' }}><Icon name="star" size={22} /></span>
          <span style={{ flex: 1 }}>
            <strong style={{ display: 'block', fontSize: 16 }}>{t('br_title')}</strong>
            <span className="small muted">{t('br_teaser')}</span>
          </span>
          <Icon name="chevron" size={18} />
        </a>
      )}
      <div className={d ? 'grid-3' : 'grid-4'} style={d ? { gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' } : undefined}>
        {tiles.map((tile) => (
          <div key={tile.label} className="card pad tile">
            <div className="label"><span className="ico"><Icon name={tile.icon} size={18} /></span>{tile.link ? <a href={href(tile.link)}>{tile.label}</a> : tile.label}</div>
            <div className="value num" style={tile.tone === 'bad' ? { color: 'var(--bad, #A4271A)' } : undefined}>{tile.value}</div>
            {tile.sub && <div className="small muted" style={{ marginTop: 4 }}>{tile.sub}</div>}
          </div>
        ))}
      </div>
      {d && <SalesChart d={d} />}
      <div className="card flow">
        <div className="flow-title">
          <h2>{t('voucherFlow')}</h2>
          <span className="small muted">{t('role_preparer')} · {t('role_checker')} · {t('role_approver')}</span>
        </div>
        {flow.map((step, i) => (
          <div key={step.status} style={{ display: 'contents' }}>
            {i > 0 && <Icon name="chevron" className="flip" />}
            <a className="step" href={href(`entries/${step.status}`)}>
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

function trendText(i18n: I18n, now: number, before: number): string {
  if (!before) return '';
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  return i18n.t('br_vsLastMonth', { p: `${pct >= 0 ? '+' : '−'}${i18n.int(Math.abs(pct))}%` });
}

/** Sales of the last six months as bars, with the month's profit underneath; no chart library. */
function SalesChart({ d }: { d: DashboardView }) {
  const i18n = useI18n();
  const { t } = i18n;
  const max = Math.max(1, ...d.months.map((m) => m.sales));
  const monthName = (ym: string) => new Intl.DateTimeFormat(i18n.lang === 'ku' ? 'ckb-IQ' : i18n.lang === 'ar' ? 'ar-IQ' : 'en-GB', { month: 'short' }).format(new Date(ym + '-15T00:00:00'));
  return (
    <div className="card">
      <div className="card-head"><h2>{t('br_salesSixMonths')}</h2><span className="spacer" /><a className="btn ghost small" href={href('more-reports')}>{t('br_reports')}</a></div>
      <div role="img" aria-label={t('br_salesSixMonths')} style={{ display: 'grid', gridTemplateColumns: `repeat(${d.months.length}, minmax(0, 1fr))`, gap: 12, alignItems: 'end', height: 200, padding: '8px 16px 0' }}>
        {d.months.map((m, n) => (
          <div key={m.month} title={i18n.money(m.sales, 'IQD')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 6 }}>
            <span className="small num" style={{ fontWeight: 600 }}>{m.sales ? i18n.digitsOf(compact(m.sales)) : ''}</span>
            <span style={{
              width: '100%', maxWidth: 56, height: `${Math.max(2, (m.sales / max) * 150)}px`, borderRadius: '6px 6px 2px 2px',
              background: n === d.months.length - 1 ? 'var(--accent, #1D5FD1)' : 'var(--accent-soft, #BCD0F5)'
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${d.months.length}, minmax(0, 1fr))`, gap: 12, padding: '6px 16px 16px', textAlign: 'center' }}>
        {d.months.map((m) => (
          <div key={m.month} className="small">
            <div className="muted">{monthName(m.month)}</div>
            <div className="num" style={{ color: m.profit < 0 ? 'var(--bad, #A4271A)' : 'var(--ok, #1F7A52)' }} title={t('br_profit')}>{m.profit ? i18n.digitsOf(compact(m.profit)) : '—'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 1,250,000 → 1.25M; 85,000 → 85K (dinars). */
function compact(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${+(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${+(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${+(a / 1e3).toFixed(0)}K` : String(a);
  return (v < 0 ? '−' : '') + s;
}
