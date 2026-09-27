import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { APP_VERSION, htmlLang, isLang, type DigitStyle, type Lang } from '@qasa/core';
import { api, currentUser, type AccountView, type PlanStatus, type Settings as SettingsData } from './api.ts';
import { DataContext, Icon, Logo, ToastProvider } from './components.tsx';
import { I18nContext, makeI18n, type Key } from './i18n.ts';
import { href, useRoute } from './router.ts';
import { Home } from './pages/Home.tsx';
import { Entries } from './pages/Entries.tsx';
import { EntryEditor } from './pages/EntryEditor.tsx';
import { EntryDetail } from './pages/EntryDetail.tsx';
import { Accounts } from './pages/Accounts.tsx';
import { Statement, TrialBalance } from './pages/Reports.tsx';
import { Settings } from './pages/Settings.tsx';
import { Parties, PartyDetail } from './pages/Parties.tsx';
import { ItemDetail, Items } from './pages/Items.tsx';
import { InvoiceDetail, InvoiceEditor, Invoices } from './pages/Invoices.tsx';
import { Plans } from './pages/Plans.tsx';
import { FinalAccounts } from './pages/FinalAccounts.tsx';
import { StockDocDetail, StockDocEditor, StockDocs } from './pages/StockDocs.tsx';

function stored<T extends string>(key: string, fallback: T, valid: (v: string) => boolean): T {
  try {
    const v = localStorage.getItem(key);
    return v && valid(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* not available */ }
}

interface NavItem { key: Key; icon: string; path?: string; match?: string[] }
const NAV: { group: Key; items: NavItem[] }[] = [
  { group: 'gOverview', items: [{ key: 'home', icon: 'home', path: '', match: ['', 'home'] }] },
  {
    group: 'gSales',
    items: [
      { key: 'invoices', icon: 'invoice', path: 'sales', match: ['sales', 'new-invoice:sale'] },
      { key: 'customers', icon: 'contact', path: 'customers', match: ['customers'] },
      { key: 'salesReturns', icon: 'undo', path: 'sales-returns', match: ['sales-returns'] },
      { key: 'installments', icon: 'cal' },
      { key: 'pipeline', icon: 'trend' }
    ]
  },
  {
    group: 'gPurchases',
    items: [
      { key: 'purchaseInvoices', icon: 'cart', path: 'purchases', match: ['purchases', 'new-invoice:purchase'] },
      { key: 'suppliers', icon: 'truck', path: 'suppliers', match: ['suppliers'] },
      { key: 'purchaseReturns', icon: 'undo', path: 'purchase-returns', match: ['purchase-returns'] }
    ]
  },
  {
    group: 'gAccounting',
    items: [
      { key: 'vouchers', icon: 'receipt', path: 'entries', match: ['entries', 'entry', 'new', 'edit'] },
      { key: 'accounts', icon: 'tree', path: 'accounts', match: ['accounts'] },
      { key: 'trialBalance', icon: 'chart', path: 'trial-balance', match: ['trial-balance'] },
      { key: 'finalAccounts', icon: 'book', path: 'final-accounts', match: ['final-accounts'] },
      { key: 'statement', icon: 'doc', path: 'statement', match: ['statement'] }
    ]
  },
  {
    group: 'gStock',
    items: [
      { key: 'items', icon: 'box', path: 'items', match: ['items', 'item'] },
      { key: 'stockDocs', icon: 'swap', path: 'stock-docs', match: ['stock-docs', 'stock-doc', 'new-stock-doc', 'edit-stock-doc'] }
    ]
  },
  { group: 'gPeople', items: [{ key: 'hr', icon: 'idcard' }, { key: 'salaries', icon: 'users' }] },
  {
    group: 'gSystem',
    items: [
      { key: 'settings', icon: 'sliders', path: 'settings', match: ['settings'] },
      { key: 'planLicense', icon: 'star', path: 'plans', match: ['plans'] }
    ]
  }
];

export function App() {
  const [lang, setLangState] = useState<Lang>(() => stored<Lang>('qasa.lang', 'ar', isLang));
  const [digits, setDigitsState] = useState<DigitStyle>(() => stored<DigitStyle>('qasa.digits', 'western', (v) => v === 'western' || v === 'eastern'));
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [plan, setPlan] = useState<PlanStatus | null>(null);
  const [online, setOnline] = useState(true);
  const route = useRoute();

  const setLang = useCallback((l: Lang) => { setLangState(l); remember('qasa.lang', l); }, []);
  const setDigits = useCallback((d: DigitStyle) => { setDigitsState(d); remember('qasa.digits', d); }, []);
  const i18n = useMemo(() => makeI18n(lang, digits, setLang, setDigits), [lang, digits, setLang, setDigits]);

  useEffect(() => {
    document.documentElement.lang = htmlLang(lang);
    document.documentElement.dir = i18n.dir;
    document.title = i18n.t('appName');
  }, [lang, i18n]);

  const reloadAccounts = useCallback(async () => {
    try {
      setAccounts(await api.accounts());
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);
  const reloadSettings = useCallback(async () => {
    try {
      setSettings(await api.settings());
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  const reloadPlan = useCallback(async () => {
    try {
      setPlan(await api.plan());
    } catch {
      // keeps the last known plan; the status bar already shows when the server is unreachable
    }
  }, []);

  useEffect(() => {
    void reloadAccounts();
    void reloadSettings();
    void reloadPlan();
  }, [reloadAccounts, reloadSettings, reloadPlan]);

  const data = useMemo(
    () => ({ accounts, settings, plan, online, reloadAccounts, reloadSettings, reloadPlan }),
    [accounts, settings, plan, online, reloadAccounts, reloadSettings, reloadPlan]
  );
  const { t } = i18n;
  const [page, arg, arg2] = route;

  let title: string = t('home');
  let content: ReactNode;
  switch (page ?? '') {
    case '':
    case 'home':
      content = <Home />;
      break;
    case 'entries':
      title = t('vouchers');
      content = <Entries />;
      break;
    case 'new':
      title = arg === 'payment' ? t('newPayment') : arg === 'journal' ? t('newJournal') : t('newReceipt');
      content = <EntryEditor key={'new-' + arg} kind={arg === 'payment' || arg === 'journal' ? arg : 'receipt'} />;
      break;
    case 'edit':
      title = t('editTitle');
      content = arg ? <EntryEditor key={'edit-' + arg} id={arg} /> : null;
      break;
    case 'entry':
      title = t('vouchers');
      content = arg ? <EntryDetail key={arg} id={arg} /> : null;
      break;
    case 'accounts':
      title = t('accounts');
      content = <Accounts />;
      break;
    case 'trial-balance':
      title = t('trialBalance');
      content = <TrialBalance />;
      break;
    case 'statement':
      title = t('statement');
      content = <Statement key={arg ?? ''} {...(arg ? { code: arg } : {})} />;
      break;
    case 'sales':
      title = t('invoices');
      content = <Invoices key="sale" kind="sale" />;
      break;
    case 'purchases':
      title = t('purchaseInvoices');
      content = <Invoices key="purchase" kind="purchase" />;
      break;
    case 'new-invoice': {
      const kind = arg === 'purchase' ? 'purchase' : 'sale';
      title = kind === 'sale' ? t('newSale') : t('newPurchase');
      content = <InvoiceEditor key={`new-${kind}-${arg2 ?? ''}`} kind={kind} {...(arg2 ? { partyId: arg2 } : {})} />;
      break;
    }
    case 'edit-invoice':
      title = t('editTitle');
      content = arg ? <InvoiceEditor key={'edit-' + arg} id={arg} /> : null;
      break;
    case 'invoice':
      title = t('invoices');
      content = arg ? <InvoiceDetail key={arg} id={arg} /> : null;
      break;
    case 'sales-returns':
      title = t('salesReturns');
      content = <Invoices key="sale_return" kind="sale_return" />;
      break;
    case 'purchase-returns':
      title = t('purchaseReturns');
      content = <Invoices key="purchase_return" kind="purchase_return" />;
      break;
    case 'stock-docs':
      title = t('stockDocs');
      content = <StockDocs />;
      break;
    case 'new-stock-doc': {
      const kind = arg === 'transfer' ? 'transfer' : 'opening';
      title = kind === 'transfer' ? t('newTransfer') : t('newOpeningStock');
      content = <StockDocEditor key={'new-' + kind} kind={kind} />;
      break;
    }
    case 'edit-stock-doc':
      title = t('editTitle');
      content = arg ? <StockDocEditor key={'edit-' + arg} id={arg} /> : null;
      break;
    case 'stock-doc':
      title = t('stockDocs');
      content = arg ? <StockDocDetail key={arg} id={arg} /> : null;
      break;
    case 'customers':
      title = t('customers');
      content = <Parties key="customer" type="customer" />;
      break;
    case 'suppliers':
      title = t('suppliers');
      content = <Parties key="supplier" type="supplier" />;
      break;
    case 'party':
      title = t('statement');
      content = arg ? <PartyDetail key={arg} id={arg} /> : null;
      break;
    case 'items':
      title = t('items');
      content = <Items />;
      break;
    case 'item':
      title = t('items');
      content = arg ? <ItemDetail key={arg} id={arg} /> : null;
      break;
    case 'settings':
      title = t('settings');
      content = <Settings />;
      break;
    case 'final-accounts':
      title = t('finalAccounts');
      content = <FinalAccounts />;
      break;
    case 'plans':
      title = t('planLicense');
      content = <Plans />;
      break;
    default:
      content = <Home />;
  }

  const company = settings ? i18n.name(settings.companyName) : '';
  const user = currentUser();

  return (
    <I18nContext.Provider value={i18n}>
      <DataContext.Provider value={data}>
        <ToastProvider>
          <div className="app">
            <nav className="sidebar" aria-label={t('appName')}>
              <div className="brand">
                <Logo />
                <div>
                  <div className="brand-name">{t('appName')}</div>
                  <div className="brand-tag">{t('tagline')}</div>
                </div>
              </div>
              <div className="company-card">
                <strong>{company || t('noCompany')}</strong>
                {user && <span className="small" style={{ color: 'var(--navy-muted)' }}>{user}</span>}
                {plan && (
                  <a className={'plan-chip' + (plan.plan === 'free' ? '' : ' paid')} href={href('plans')}>
                    {plan.source === 'trial' ? t('planTrialChip') : t(`plan_${plan.plan}`)}
                  </a>
                )}
              </div>
              {NAV.map((g) => (
                <div key={g.group} style={{ display: 'contents' }}>
                  <div className="nav-group">{t(g.group)}</div>
                  {g.items.map((item) => {
                    if (item.path === undefined) {
                      return (
                        <button key={item.key} type="button" className="nav-item" disabled>
                          <Icon name={item.icon} /><span>{t(item.key)}</span><span className="soon">{t('soon')}</span>
                        </button>
                      );
                    }
                    const active = (item.match ?? []).some((m) => m === (page ?? '') || m === `${page}:${arg}`);
                    return (
                      <a key={item.key} className={'nav-item' + (active ? ' active' : '')} href={href(item.path)} aria-current={active ? 'page' : undefined}>
                        <Icon name={item.icon} /><span>{t(item.key)}</span>
                      </a>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className="main">
              <header className="topbar">
                <h1>{title}</h1>
                <span className="spacer" />
                <div className="track" role="group" aria-label={t('language')}>
                  {([['ar', 'عربي'], ['en', 'EN'], ['ku', 'کوردی']] as const).map(([l, label]) => (
                    <button key={l} type="button" lang={htmlLang(l)} aria-pressed={lang === l} onClick={() => setLang(l)}>{label}</button>
                  ))}
                </div>
                {lang !== 'en' && (
                  <button type="button" className="btn small" title={t('digits')} aria-label={t('digits')} onClick={() => setDigits(digits === 'eastern' ? 'western' : 'eastern')}>
                    {digits === 'eastern' ? '١٢٣' : '123'}
                  </button>
                )}
              </header>
              <main className="content">
                {plan?.license?.state === 'grace' && plan.license.expires && plan.graceEnds && page !== 'plans' && (
                  <div className="alert warn plan-banner no-print" style={{ marginBottom: 14 }}>
                    <span>{t('graceNote', { p: t(`plan_${plan.license.plan}`), d: i18n.date(plan.license.expires), g: i18n.date(plan.graceEnds) })}</span>
                    <a href={href('plans')}>{t('planLicense')}</a>
                  </div>
                )}
                {content}
              </main>
              <footer className="statusbar">
                <span className={'dot' + (online ? '' : ' off')} />
                <span>{import.meta.env.MODE === 'demo' ? t('demoMode') : online ? t('localMode') : t('serverDown')}</span>
                <span className="spacer" />
                {import.meta.env.MODE === 'demo' && <a href="../" className="ltr">qasaerp.com</a>}
                <span className="ltr">Qasa ERP {APP_VERSION}</span>
              </footer>
            </div>
          </div>
        </ToastProvider>
      </DataContext.Provider>
    </I18nContext.Provider>
  );
}
