import { useEffect, useState } from 'react';
import { BUSINESS_FEATURE, todayIso } from '@qasa/core';
import { api } from '../api.ts';
import { ErrorBox, Icon, StatusChip, useData, useLoad } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';
import { EntriesTable } from './Entries.tsx';
import { briefApi, type DashboardView } from '../industry/brief-api.ts';
import { ChequesHomeNote } from '../industry/ChequesAhead.tsx';
import { ReorderHomeNote } from '../industry/ReorderList.tsx';
import { RenewalBanner } from '../industry/RenewalBanner.tsx';
import { moneyBoth } from './Brief.tsx';
import type { I18n, Key } from '../i18n.ts';
import { NAV, toggleFavourite, visibleItems, type NavItem, type NavViewer } from '../nav.ts';

export function Home({ viewer, user, favourites }: { viewer: NavViewer; user: string; favourites: string[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { accounts, settings, plan, reloadPlan, companyBooks, seesBooks } = useData();
  // the trial balance and the final accounts are the company's books: no link for someone limited to branches
  const books = companyBooks !== false;
  // this month's invoice count feeds the "growing" note
  useEffect(() => { void reloadPlan(); }, [reloadPlan]);
  // 1.4: the journal and the accounts' balances are not sent to someone who may not read the books (a cashier): no
  // vouchers on their home page, and no cash tile made from a balance
  const journal = seesBooks !== false;
  const { data: entries, error } = useLoad(() => (journal ? api.entries() : Promise.resolve([])), [journal]);
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
    ...(d.profitMonth ? [{ label: t('br_profitMonth'), value: i18n.money(d.profitMonth.profit, 'IQD'), icon: 'chart', ...(books ? { link: 'final-accounts' } : {}), tone: d.profitMonth.profit < 0 ? 'bad' : 'ok' }] : []),
    { label: t('receivables'), value: i18n.money(d.receivables, 'IQD'), link: 'reports-more/aging', icon: 'contact' },
    { label: t('payables'), value: i18n.money(d.payables, 'IQD'), link: 'reports-more/supplier-aging', icon: 'truck' }
  ] : [
    ...(journal ? [{ label: t('cashAndBanks'), value: i18n.money(cash, 'IQD'), icon: 'wallet' }] : []),
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
        <div className="alert info">{t('setupCompany')} <a href={href('settings/company')}>{t('settings')}</a></div>
      )}
      {plan?.license?.state === 'expired' && plan.license.expires && (
        <div className="alert bad plan-banner">
          <span>{t('expiredNote', { p: t(`plan_${plan.license.plan}`), d: i18n.date(plan.license.expires) })}</span>
          <a href={href('plans')}>{t('planLicense')}</a>
        </div>
      )}
      <RenewalBanner admin={viewer.admin} />
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
        {books && <a className="btn" style={{ marginInlineStart: 'auto' }} href={href('trial-balance')}><Icon name="chart" size={16} />{t('trialBalance')}</a>}
      </nav>
      <ChequesHomeNote counts={d?.cheques} />
      <ReorderHomeNote />
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
      <div className={(d ? 'grid-3' : 'grid-4') + ' kpi-grid'} style={d ? { gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' } : undefined}>
        {tiles.map((tile) => (
          <div key={tile.label} className="card pad tile">
            <div className="label"><span className="ico"><Icon name={tile.icon} size={18} /></span>{tile.link ? <a href={href(tile.link)}>{tile.label}</a> : tile.label}</div>
            <div className="value num" style={tile.tone === 'bad' ? { color: 'var(--bad, #A4271A)' } : undefined}>{tile.value}</div>
            {tile.sub && <div className="small muted" style={{ marginTop: 4 }}>{tile.sub}</div>}
          </div>
        ))}
      </div>
      <FirstSteps viewer={viewer} />
      <Launcher viewer={viewer} user={user} favourites={favourites} />
      {d && <SalesChart d={d} />}
      {journal && <div className="card flow">
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
      </div>}
      <ErrorBox error={error} />
      {journal && <div className="card">
        <div className="card-head">
          <h2>{t('recentEntries')}</h2>
          <span className="spacer" />
          <a className="btn ghost small" href={href('entries')}>{t('viewAll')}</a>
        </div>
        {entries && <EntriesTable entries={entries.slice(0, 10)} />}
      </div>}
    </div>
  );
}

function trendText(i18n: I18n, now: number, before: number): string {
  if (!before) return '';
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  return i18n.t('br_vsLastMonth', { p: i18n.ltr(`${pct >= 0 ? '+' : '-'}${i18n.int(Math.abs(pct))}%`) });
}

/** Sales of the last six months as bars, with the month's profit underneath; no chart library. */
function SalesChart({ d }: { d: DashboardView }) {
  const i18n = useI18n();
  const { t } = i18n;
  const max = Math.max(1, ...d.months.map((m) => m.sales));
  // Arabic and Kurdish month names come from the app's own list (a browser without Kurdish data would show "Nov")
  const monthName = (ym: string) => (i18n.lang === 'en' ? new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(new Date(ym + '-15T00:00:00')) : i18n.month(ym));
  return (
    <div className="card">
      <div className="card-head"><h2>{t('br_salesSixMonths')}</h2><span className="spacer" /><a className="btn ghost small" href={href('reports-more')}>{t('br_reports')}</a></div>
      <div role="img" aria-label={t('br_salesSixMonths')} style={{ display: 'grid', gridTemplateColumns: `repeat(${d.months.length}, minmax(0, 1fr))`, gap: 12, alignItems: 'end', height: 200, padding: '8px 16px 0' }}>
        {d.months.map((m, n) => (
          <div key={m.month} title={i18n.money(m.sales, 'IQD')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 6 }}>
            <span className="small num" style={{ fontWeight: 600 }}>{m.sales ? i18n.ltr(i18n.digitsOf(compact(m.sales))) : ''}</span>
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
            <div className="num" style={{ color: (m.profit ?? 0) < 0 ? 'var(--bad, #A4271A)' : 'var(--ok, #1F7A52)' }} title={t('br_profit')}>{m.profit ? i18n.ltr(i18n.digitsOf(compact(m.profit))) : '—'}</div>
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
  return (v < 0 ? '-' : '') + s;
}

/** The home screen's big tiles, in sections, from the same list as the menu: only what this person may open and what the
 * company does; ★ pins a page to Favourites at the top of the menu. */
function Launcher({ viewer, user, favourites }: { viewer: NavViewer; user: string; favourites: string[] }) {
  const { t } = useI18n();
  const { plan } = useData();
  const brief = NAV.flatMap((g) => g.items).find((i) => i.key === 'br_title');
  const sections = NAV
    .filter((g) => g.group !== 'gOverview' && g.group !== 'gSystem')
    .map((g) => ({
      group: g.group,
      items: [...(g.group === 'gReports' && brief ? [brief] : []), ...visibleItems(g.items, viewer)].filter((i) => i.tile !== false && i.path !== undefined)
    }))
    .filter((s) => s.items.length);
  return (
    <section className="launcher no-print" aria-label={t('launchTitle')} data-tour="launcher">
      {sections.map((s) => (
        <div key={s.group} className={'launch-section g-' + s.group}>
          <div className="launch-head">
            <span className="launch-bar" aria-hidden="true" />
            <h2>{t(s.group)}</h2>
            {s.group === 'gIndustry' && <span className="launch-note">{t('bizSectionNote')}</span>}
          </div>
          <div className="launch-grid">
            {s.items.map((item) => <LaunchTile key={item.key} item={item} pinned={favourites.includes(item.key)} user={user} locked={lockOf(item, plan?.features ?? null)} />)}
          </div>
        </div>
      ))}
    </section>
  );
}

function lockOf(item: NavItem, features: readonly string[] | null): string | null {
  const feature = item.business ? BUSINESS_FEATURE[item.business] : null;
  if (!feature || !features || features.includes(feature)) return null;
  return feature === 'realEstate' ? 'Business' : 'Pro';
}

function LaunchTile({ item, pinned, user, locked }: { item: NavItem; pinned: boolean; user: string; locked: string | null }) {
  const { t } = useI18n();
  return (
    <div className="launch-tile" data-tour={item.key === 'br_title' ? 'brief' : undefined}>
      <a href={href(item.path ?? '')}>
        <span className="launch-ico"><Icon name={item.icon} size={22} /></span>
        <span className="launch-label">{t(item.key)}</span>
        {locked && <span className="launch-lock">{locked}</span>}
      </a>
      <button
        type="button" className={'launch-pin' + (pinned ? ' on' : '')} aria-pressed={pinned}
        aria-label={`${t(pinned ? 'pinRemove' : 'pinAdd')}: ${t(item.key)}`} title={t(pinned ? 'pinRemove' : 'pinAdd')}
        onClick={() => toggleFavourite(user, item.key)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}

const STEPS_HIDDEN = 'qasa.firstSteps.hidden';

/** A new company's first steps, worked out from its own books; hidden once done (or when the person hides it). */
function FirstSteps({ viewer }: { viewer: NavViewer }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(STEPS_HIDDEN) === '1'; } catch { return false; } });
  const parties = useLoad(() => api.parties(), []);
  const items = useLoad(() => api.items(), []);
  const sales = useLoad(() => api.invoices({ kind: 'sale', status: 'posted' }), []);
  const users = useLoad(() => (viewer.admin ? api.users() : Promise.resolve(null)), [viewer.admin]);
  if (hidden || !settings || !parties.data || !items.data || !sales.data) return null;
  const named = !!(settings.companyName.ar || settings.companyName.en || settings.companyName.ku);
  const steps: { key: Key; hint: Key; done: boolean; link: string; icon: string }[] = [
    { key: 'fsCompany', hint: 'fsCompanyHint', done: named, link: 'settings/company', icon: 'building' },
    { key: 'fsImport', hint: 'fsImportHint', done: parties.data.length > 0 || items.data.length > 0, link: viewer.admin ? 'import' : 'items', icon: 'upload' },
    { key: 'fsInvoice', hint: 'fsInvoiceHint', done: sales.data.length > 0, link: 'new-invoice/sale', icon: 'invoice' }
  ];
  if (viewer.admin && users.data) steps.push({ key: 'fsUsers', hint: 'fsUsersHint', done: users.data.length > 1, link: 'users', icon: 'users' });
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const hide = () => { try { localStorage.setItem(STEPS_HIDDEN, '1'); } catch { /* not available */ } setHidden(true); };
  return (
    <section className="card pad first-steps no-print" aria-labelledby="first-steps-title">
      <div className="fs-head">
        <h2 id="first-steps-title">{t('fsTitle')}</h2>
        <span className="small muted">{t('fsProgress', { n: i18n.int(done), m: i18n.int(steps.length) })}</span>
        <span className="fs-meter" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}><span style={{ inlineSize: `${(done / steps.length) * 100}%` }} /></span>
        <button type="button" className="btn ghost small" onClick={hide}>{t('fsHide')}</button>
      </div>
      <ol className="fs-steps">
        {steps.map((s) => (
          <li key={s.key} className={s.done ? 'done' : ''}>
            <a href={href(s.link)}>
              <span className="fs-dot" aria-hidden="true">{s.done ? <Icon name="check" size={14} /> : <Icon name={s.icon} size={15} />}</span>
              <span className="fs-text"><strong>{t(s.key)}</strong><span>{t(s.hint)}</span></span>
              <span className="visually-hidden">{s.done ? t('fsDone') : ''}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
