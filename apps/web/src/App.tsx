import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { APP_VERSION, htmlLang, isLang, type DigitStyle, type Lang } from '@qasa/core';
import { api, currentUser, SIGNED_OUT_EVENT, type AccountView, type Me, type PlanStatus, type Settings as SettingsData } from './api.ts';
import { DataContext, DisplayContext, Icon, isDensity, isTheme, Logo, ToastProvider, type Density, type Theme } from './components.tsx';
import { I18nContext, isKey, makeI18n, useI18n, type Key } from './i18n.ts';
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
import { PasswordModal, SignIn, Users } from './pages/Users.tsx';
import { Guarantors, InstallmentDetail, InstallmentEditor, Installments, InstallmentsAging } from './pages/Installments.tsx';

declare global {
  /** Only in the Windows app: its bridge to the desktop shell (apps/desktop/src/app-preload.ts). */
  interface Window { qasaDesktop?: { setLanguage(lang: string): void; setTheme?(theme: string): void } }
}

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

interface NavItem { key: Key; icon: string; path?: string; match?: string[]; adminOnly?: boolean }
const NAV: { group: Key; items: NavItem[] }[] = [
  { group: 'gOverview', items: [{ key: 'home', icon: 'home', path: '', match: ['', 'home'] }] },
  {
    group: 'gSales',
    items: [
      { key: 'invoices', icon: 'invoice', path: 'sales', match: ['sales', 'new-invoice:sale'] },
      { key: 'customers', icon: 'contact', path: 'customers', match: ['customers'] },
      { key: 'salesReturns', icon: 'undo', path: 'sales-returns', match: ['sales-returns'] },
      { key: 'installments', icon: 'cal', path: 'installments', match: ['installments', 'installment', 'new-installment', 'guarantors', 'installments-aging'] },
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
      // everyone: Language and display is each person's own; the company sections show to admins only
      { key: 'settings', icon: 'sliders', path: 'settings', match: ['settings'] },
      { key: 'users', icon: 'users', path: 'users', match: ['users'], adminOnly: true },
      { key: 'planLicense', icon: 'star', path: 'plans', match: ['plans'], adminOnly: true }
    ]
  }
];

export function App() {
  const [lang, setLangState] = useState<Lang>(() => stored<Lang>('qasa.lang', 'ar', isLang));
  const [digits, setDigitsState] = useState<DigitStyle>(() => stored<DigitStyle>('qasa.digits', 'western', (v) => v === 'western' || v === 'eastern'));
  const [theme, setThemeState] = useState<Theme>(() => stored<Theme>('qasa.theme', 'system', isTheme));
  const [density, setDensityState] = useState<Density>(() => stored<Density>('qasa.density', 'comfortable', isDensity));
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [plan, setPlan] = useState<PlanStatus | null>(null);
  /** null while loading; with sign-in on and nobody signed in, the sign-in page shows instead of the app */
  const [me, setMe] = useState<Me | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [online, setOnline] = useState(true);
  const route = useRoute();

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    remember('qasa.lang', l);
    window.qasaDesktop?.setLanguage(l); // the Windows app's menus and start dialogs follow
  }, []);
  const setDigits = useCallback((d: DigitStyle) => { setDigitsState(d); remember('qasa.digits', d); }, []);
  const setTheme = useCallback((v: Theme) => {
    setThemeState(v);
    remember('qasa.theme', v);
    window.qasaDesktop?.setTheme?.(v); // the Windows app's title bar and menus follow
  }, []);
  const setDensity = useCallback((v: Density) => { setDensityState(v); remember('qasa.density', v); }, []);
  const display = useMemo(() => ({ theme, density, setTheme, setDensity }), [theme, density, setTheme, setDensity]);
  const dark = theme === 'dark' || (theme === 'system' && systemDark);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme; else root.dataset.theme = theme;
    if (density === 'compact') root.dataset.density = density; else delete root.dataset.density;
  }, [theme, density]);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;
    const changed = () => setSystemDark(query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  // the Windows app learns the saved choice once (its own copy may predate it)
  useEffect(() => { window.qasaDesktop?.setTheme?.(theme); }, []); // eslint-disable-line react-hooks/exhaustive-deps
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

  const reloadMe = useCallback(async () => {
    try {
      setMe(await api.me());
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    void reloadMe();
    const signedOut = () => setMe((m) => (m ? { ...m, user: null } : m));
    window.addEventListener(SIGNED_OUT_EVENT, signedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, signedOut);
  }, [reloadMe]);

  // the books load once someone is in (the owner, without sign-in)
  const userId = me?.user?.id ?? (me?.user ? 'owner' : null);
  useEffect(() => {
    if (!userId) return;
    void reloadAccounts();
    void reloadSettings();
    void reloadPlan();
  }, [userId, reloadAccounts, reloadSettings, reloadPlan]);

  const data = useMemo(
    () => ({ accounts, settings, plan, online, reloadAccounts, reloadSettings, reloadPlan }),
    [accounts, settings, plan, online, reloadAccounts, reloadSettings, reloadPlan]
  );
  const { t } = i18n;
  const [page, arg, arg2] = route;

  let title: string = t('home');
  let content: ReactNode;
  const isAdmin = !!me?.user?.permissions.includes('admin');
  // admin pages open for admins only; everyone else lands on the home page
  const adminPage = ['users', 'plans'].includes(page ?? '') && !isAdmin;
  switch (adminPage ? '' : page ?? '') {
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
    case 'installments':
      title = t('installments');
      content = <Installments />;
      break;
    case 'installment':
      title = t('installments');
      content = arg ? <InstallmentDetail key={arg} id={arg} /> : null;
      break;
    case 'new-installment':
      title = t('insNew');
      content = <InstallmentEditor key={'new-' + (arg ?? '')} {...(arg ? { invoiceId: arg } : {})} />;
      break;
    case 'guarantors':
      title = t('guarantors');
      content = <Guarantors />;
      break;
    case 'installments-aging':
      title = t('aging');
      content = <InstallmentsAging />;
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
      content = <Settings admin={isAdmin} />;
      break;
    case 'final-accounts':
      title = t('finalAccounts');
      content = <FinalAccounts />;
      break;
    case 'users':
      title = t('users');
      content = me ? <Users me={me} onMeChanged={(m) => { if (m) setMe(m); else void reloadMe(); }} /> : null;
      break;
    case 'plans':
      title = t('planLicense');
      content = <Plans />;
      break;
    default:
      content = <Home />;
  }

  const company = settings ? i18n.name(settings.companyName) : '';
  const user = me?.signInRequired ? me.user?.name ?? '' : currentUser() || me?.user?.name || '';
  // the header shows where a page sits: "Sales › Sales invoices"
  const group = NAV.find((g) => g.items.some((item) => (item.match ?? []).some((m) => m === (page ?? '') || m === `${page}:${arg}`)))?.group;
  const crumb = group && group !== 'gOverview' ? group : null;

  if (me?.signInRequired && !me.user) {
    return (
      <I18nContext.Provider value={i18n}>
        <DisplayContext.Provider value={display}>
          <ToastProvider>
            <SignIn company="" onSignedIn={(m) => setMe(m)} />
          </ToastProvider>
        </DisplayContext.Provider>
      </I18nContext.Provider>
    );
  }
  if (!me) return online ? null : <div className="signin-page"><div className="card pad">{t('serverDown')}</div></div>;

  function navItems(items: NavItem[]) {
    return items.filter((item) => !item.adminOnly || isAdmin).map((item) => {
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
    });
  }

  async function signOut() {
    try { await api.logout(); } catch { /* signed out either way */ }
    setMe((m) => (m ? { ...m, user: null } : m));
  }

  return (
    <I18nContext.Provider value={i18n}>
      <DataContext.Provider value={data}>
       <DisplayContext.Provider value={display}>
        <ToastProvider>
          <div className="app">
            <nav className="sidebar" aria-label={t('appName')}>
              <div className="brand">
                <Logo size={28} />
                <div>
                  <div className="brand-name">{t('appName')}</div>
                  <div className="brand-tag">{t('tagline')}</div>
                </div>
              </div>
              <div className="company-card">
                <span className="avatar mark"><Icon name="building" size={16} /></span>
                <div><span className="label">{t('company')}</span><strong className="bidi">{company || t('noCompany')}</strong></div>
              </div>
              <div className="nav-scroll">
                {NAV.filter((g) => g.group !== 'gSystem').map((g) => (
                  <div key={g.group} style={{ display: 'contents' }}>
                    <div className="nav-group">{t(g.group)}</div>
                    {navItems(g.items)}
                  </div>
                ))}
              </div>
              <div className="pane-footer">{navItems(NAV.find((g) => g.group === 'gSystem')?.items ?? [])}</div>
            </nav>
            <div className="main">
              <header className="topbar">
                <h1>
                  {crumb && <><span className="crumb">{t(crumb)}</span><Icon name="chevron" size={16} className="flip" /></>}
                  <span>{title}</span>
                </h1>
                <span className="spacer" />
                <button type="button" className="btn subtle icon" title={dark ? t('lightMode') : t('darkMode')} aria-label={dark ? t('lightMode') : t('darkMode')} onClick={() => setTheme(dark ? 'light' : 'dark')}>
                  <Icon name={dark ? 'sun' : 'moon'} size={16} />
                </button>
                <span className="topbar-sep" />
                <UserMenu
                  name={user || t('owner')}
                  role={me.signInRequired && me.user ? me.user.roles.map((r) => (isKey('role_' + r) ? t(('role_' + r) as Key) : r)).join('، ') : t('owner')}
                  plan={plan ? { label: plan.source === 'trial' ? t('planTrialChip') : t(`plan_${plan.plan}`), paid: plan.plan !== 'free' } : null}
                  admin={isAdmin}
                  signInRequired={me.signInRequired}
                  onChangePassword={() => setChangingPassword(true)}
                  onSignOut={() => void signOut()}
                />
              </header>
              {changingPassword && <PasswordModal needsCurrent onClose={() => setChangingPassword(false)} />}
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
       </DisplayContext.Provider>
      </DataContext.Provider>
    </I18nContext.Provider>
  );
}

/** The person at the top of the window: who is working, their plan, and their own settings. */
function UserMenu({ name, role, plan, admin, signInRequired, onChangePassword, onSignOut }: {
  name: string;
  role: string;
  plan: { label: string; paid: boolean } | null;
  admin: boolean;
  signInRequired: boolean;
  onChangePassword(): void;
  onSignOut(): void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] ?? '').join('').toUpperCase();
  const close = () => setOpen(false);
  const planChip = plan && <span className={'plan-chip' + (plan.paid ? ' paid' : '')}>{plan.label}</span>;
  return (
    <div className="menu-anchor" ref={box}>
      <button ref={button} type="button" className="user-btn" aria-expanded={open} aria-label={`${t('userMenu')}: ${name}`} onClick={() => setOpen(!open)}>
        <span className="avatar">{initials}</span>
        <span className="bidi">{name}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="menu">
          <div className="persona">
            <span className="avatar lg">{initials}</span>
            <div>
              <strong className="bidi">{name}</strong>
              <span className="small muted">{role}</span>
              {plan && (admin ? <a href={href('plans')} onClick={close} style={{ textDecoration: 'none' }}>{planChip}</a> : planChip)}
            </div>
          </div>
          <div className="menu-sep" />
          <a className="menu-item" href={href('settings')} onClick={close}><Icon name="globe" size={16} />{t('displayTitle')}</a>
          {admin && <a className="menu-item" href={href('plans')} onClick={close}><Icon name="star" size={16} />{t('planLicense')}</a>}
          {signInRequired && <button type="button" className="menu-item" onClick={() => { close(); onChangePassword(); }}><Icon name="key" size={16} />{t('changePassword')}</button>}
          {signInRequired && (
            <>
              <div className="menu-sep" />
              <button type="button" className="menu-item" onClick={() => { close(); onSignOut(); }}><Icon name="logout" size={16} className="flip" />{t('signOut')}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
