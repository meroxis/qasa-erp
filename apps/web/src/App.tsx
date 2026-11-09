import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { APP_VERSION, htmlLang, isLang, type DigitStyle, type Lang } from '@qasa/core';
import { api, currentUser, SIGNED_OUT_EVENT, type AccountView, type Me, type PlanStatus, type Settings as SettingsData } from './api.ts';
import { BusyBar, DataContext, DisplayContext, Icon, isDensity, isTheme, Logo, PageNavContext, ToastProvider, type Density, type PageNav, type Theme } from './components.tsx';
import { I18nContext, isKey, makeI18n, useI18n, type Key } from './i18n.ts';
import { href, useRoute } from './router.ts';
import { Home } from './pages/Home.tsx';
import type { EntryStatus } from '@qasa/core';
import { PasswordModal, SignIn, Users } from './pages/Users.tsx';
import { SupportButton } from './industry/SupportButton.tsx';
import { BranchSwitcher } from './industry/BranchSwitcher.tsx';
import { BRANCH_EVENT } from './industry/branches-api.ts';
import { BUSINESS_FEATURE } from '@qasa/core';
import { ADMIN_PAGES, canSee, COMPANY_BOOK_PAGES, FAVOURITES_EVENT, seesCompanyBooks, favourites, findPage, NAV, navCollapsed, setNavCollapsed, type NavItem, type NavViewer } from './nav.ts';
import { CommandPalette } from './industry/CommandPalette.tsx';
import { Tour, TOUR_EVENT, tourDone } from './industry/Tour.tsx';
import { UpdateBanner } from './industry/UpdateBanner.tsx';
import { BackupNoticeBar } from './industry/BackupNotice.tsx';
import { PrintNotices } from './industry/Printers.tsx';
import { GuideLink, pageGuide } from './industry/GuideLink.tsx';
import { activationNoticeFor } from './industry/activation-notice.ts';
import { isReportTab, isSolarTab } from './pages/tabs.ts';
import { canSwitchCompanies } from './industry/companies-api.ts';

/**
 * Pages load when they are first opened, not with the app: the first screen comes up quickly and the window holds only
 * what is in use. Each page module becomes its own small file in the build.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each page has its own props
function lazyPage<M extends Record<string, unknown>, K extends keyof M & string>(load: () => Promise<M>, name: K): M[K] {
  return lazy(async () => ({ default: (await load())[name] as unknown as ComponentType<any> })) as unknown as M[K];
}
/** Shown for the moment a page's file is loading (first visit only). */
function PageLoading() {
  return <div className="page-loading" role="status" aria-busy="true"><span className="spinner" aria-hidden="true" /></div>;
}
const Entries = lazyPage(() => import('./pages/Entries.tsx'), 'Entries');
const EntryEditor = lazyPage(() => import('./pages/EntryEditor.tsx'), 'EntryEditor');
const EntryDetail = lazyPage(() => import('./pages/EntryDetail.tsx'), 'EntryDetail');
const Accounts = lazyPage(() => import('./pages/Accounts.tsx'), 'Accounts');
const Statement = lazyPage(() => import('./pages/Reports.tsx'), 'Statement');
const TrialBalance = lazyPage(() => import('./pages/Reports.tsx'), 'TrialBalance');
const Settings = lazyPage(() => import('./pages/Settings.tsx'), 'Settings');
const Parties = lazyPage(() => import('./pages/Parties.tsx'), 'Parties');
const PartyDetail = lazyPage(() => import('./pages/Parties.tsx'), 'PartyDetail');
const ItemDetail = lazyPage(() => import('./pages/Items.tsx'), 'ItemDetail');
const Items = lazyPage(() => import('./pages/Items.tsx'), 'Items');
const InvoiceDetail = lazyPage(() => import('./pages/Invoices.tsx'), 'InvoiceDetail');
const InvoiceEditor = lazyPage(() => import('./pages/Invoices.tsx'), 'InvoiceEditor');
const Invoices = lazyPage(() => import('./pages/Invoices.tsx'), 'Invoices');
const Plans = lazyPage(() => import('./pages/Plans.tsx'), 'Plans');
const FinalAccounts = lazyPage(() => import('./pages/FinalAccounts.tsx'), 'FinalAccounts');
const StockDocDetail = lazyPage(() => import('./pages/StockDocs.tsx'), 'StockDocDetail');
const StockDocEditor = lazyPage(() => import('./pages/StockDocs.tsx'), 'StockDocEditor');
const StockDocs = lazyPage(() => import('./pages/StockDocs.tsx'), 'StockDocs');
const Guarantors = lazyPage(() => import('./pages/Installments.tsx'), 'Guarantors');
const InstallmentDetail = lazyPage(() => import('./pages/Installments.tsx'), 'InstallmentDetail');
const InstallmentEditor = lazyPage(() => import('./pages/Installments.tsx'), 'InstallmentEditor');
const Installments = lazyPage(() => import('./pages/Installments.tsx'), 'Installments');
const InstallmentsAging = lazyPage(() => import('./pages/Installments.tsx'), 'InstallmentsAging');
const RealEstate = lazyPage(() => import('./pages/RealEstate.tsx'), 'RealEstate');
const RealEstateProject = lazyPage(() => import('./pages/RealEstate.tsx'), 'RealEstateProject');
const MobileShop = lazyPage(() => import('./pages/MobileShop.tsx'), 'MobileShop');
const RepairDetail = lazyPage(() => import('./pages/MobileShop.tsx'), 'RepairDetail');
const CarParts = lazyPage(() => import('./pages/CarParts.tsx'), 'CarParts');
const EngineeringWorks = lazyPage(() => import('./pages/EngineeringWorks.tsx'), 'EngineeringWorks');
const JobDetail = lazyPage(() => import('./pages/EngineeringWorks.tsx'), 'JobDetail');
const BusinessTypeChooser = lazyPage(() => import('./pages/BusinessType.tsx'), 'BusinessTypeChooser');
const BusinessTypePage = lazyPage(() => import('./pages/BusinessType.tsx'), 'BusinessTypePage');
const Pos = lazyPage(() => import('./pages/Pos.tsx'), 'Pos');
const PosShiftReport = lazyPage(() => import('./pages/Pos.tsx'), 'PosShiftReport');
const Payroll = lazyPage(() => import('./pages/Payroll.tsx'), 'Payroll');
const PayrollRun = lazyPage(() => import('./pages/Payroll.tsx'), 'PayrollRun');
const Import = lazyPage(() => import('./pages/Import.tsx'), 'Import');
const QuoteDetail = lazyPage(() => import('./pages/Quotes.tsx'), 'QuoteDetail');
const QuoteEditor = lazyPage(() => import('./pages/Quotes.tsx'), 'QuoteEditor');
const Quotes = lazyPage(() => import('./pages/Quotes.tsx'), 'Quotes');
const Pipeline = lazyPage(() => import('./pages/Pipeline.tsx'), 'Pipeline');
const Brief = lazyPage(() => import('./pages/Brief.tsx'), 'Brief');
const Expenses = lazyPage(() => import('./pages/Expenses.tsx'), 'Expenses');
const MoreReports = lazyPage(() => import('./pages/MoreReports.tsx'), 'MoreReports');
const Rates = lazyPage(() => import('./pages/Rates.tsx'), 'Rates');
const Banking = lazyPage(() => import('./pages/Banking.tsx'), 'Banking');
const ChequeDetail = lazyPage(() => import('./pages/Banking.tsx'), 'ChequeDetail');
const StatementDetail = lazyPage(() => import('./pages/Banking.tsx'), 'StatementDetail');
const PurchaseOrders = lazyPage(() => import('./pages/PurchaseOrders.tsx'), 'PurchaseOrders');
const PurchaseOrderEditor = lazyPage(() => import('./pages/PurchaseOrders.tsx'), 'PurchaseOrderEditor');
const PurchaseOrderDetail = lazyPage(() => import('./pages/PurchaseOrders.tsx'), 'PurchaseOrderDetail');
const StockAdjustments = lazyPage(() => import('./pages/StockAdjustments.tsx'), 'StockAdjustments');
const StockAdjustmentEditor = lazyPage(() => import('./pages/StockAdjustments.tsx'), 'StockAdjustmentEditor');
const StockAdjustmentDetail = lazyPage(() => import('./pages/StockAdjustments.tsx'), 'StockAdjustmentDetail');
const StockCount = lazyPage(() => import('./pages/StockAdjustments.tsx'), 'StockCount');
const PrintDesignPage = lazyPage(() => import('./pages/PrintDesign.tsx'), 'PrintDesignPage');
const Labels = lazyPage(() => import('./pages/Labels.tsx'), 'Labels');
const Expiry = lazyPage(() => import('./pages/Expiry.tsx'), 'Expiry');
const Companies = lazyPage(() => import('./pages/Companies.tsx'), 'Companies');
const FixedAssets = lazyPage(() => import('./pages/FixedAssets.tsx'), 'FixedAssets');
const FixedAssetDetail = lazyPage(() => import('./pages/FixedAssets.tsx'), 'FixedAssetDetail');
const GenRun = lazyPage(() => import('./pages/Generators.tsx'), 'GenRun');
const Generators = lazyPage(() => import('./pages/Generators.tsx'), 'Generators');
const WebsiteApi = lazyPage(() => import('./pages/WebsiteApi.tsx'), 'WebsiteApi');
const Solar = lazyPage(() => import('./pages/Solar.tsx'), 'Solar');
const SolarSystem = lazyPage(() => import('./pages/Solar.tsx'), 'SolarSystem');
const Branches = lazyPage(() => import('./pages/Branches.tsx'), 'Branches');

declare global {
  /** Only in the Windows app: its bridge to the desktop shell (apps/desktop/src/app-preload.ts). */
  interface Window {
    qasaDesktop?: {
      setLanguage(lang: string): void;
      setTheme?(theme: string): void;
      /** Opens the THIRD_PARTY_NOTICES.md installed with the app (Settings → About & legal); false when it could not. Missing before 1.0. */
      openNotices?(): Promise<boolean>;
    };
  }
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

export function App() {
  const [lang, setLangState] = useState<Lang>(() => stored<Lang>('qasa.lang', 'ar', isLang));
  const [digits, setDigitsState] = useState<DigitStyle>(() => stored<DigitStyle>('qasa.digits', 'western', (v) => v === 'western' || v === 'eastern'));
  const [theme, setThemeState] = useState<Theme>(() => stored<Theme>('qasa.theme', 'system', isTheme));
  const [density, setDensityState] = useState<Density>(() => stored<Density>('qasa.density', 'comfortable', isDensity));
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  // which list a detail page belongs to, kept with the route it was said on
  const [pageNavState, setPageNavState] = useState<(PageNav & { route: string }) | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [plan, setPlan] = useState<PlanStatus | null>(null);
  /** null while loading; with sign-in on and nobody signed in, the sign-in page shows instead of the app */
  const [me, setMe] = useState<Me | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [online, setOnline] = useState(true);
  const route = useRoute();
  // the menu: shrunk to icons (remembered on this PC), which section is open (undefined: the current page's), pinned pages
  const [collapsed, setCollapsed] = useState(navCollapsed);
  // a narrow window or a phone (the website demo): the menu is the icon rail, whatever was chosen on a wide window
  const narrow = useNarrow();
  const railed = collapsed || narrow;
  const [openGroup, setOpenGroup] = useState<string | null | undefined>(undefined);
  const [searching, setSearching] = useState(false);
  const [favs, setFavs] = useState<string[]>([]);
  const favUser = me?.signInRequired ? me.user?.name ?? '' : currentUser() || me?.user?.name || '';
  useEffect(() => {
    const load = () => setFavs(favourites(favUser));
    load();
    window.addEventListener(FAVOURITES_EVENT, load);
    return () => window.removeEventListener(FAVOURITES_EVENT, load);
  }, [favUser]);
  // a new page opens its own section of the menu
  const routePage = route[0] ?? '';
  useEffect(() => { setOpenGroup(undefined); }, [routePage]);
  // Ctrl+K (⌘K) opens the search from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // the welcome tour: once per person, after the company has said what it does; again from Help or Ctrl+K
  const [touring, setTouring] = useState(false);
  useEffect(() => {
    const open = () => { setSearching(false); setTouring(true); };
    window.addEventListener(TOUR_EVENT, open);
    return () => window.removeEventListener(TOUR_EVENT, open);
  }, []);
  const tourReady = !!settings && settings.businessTypes !== null && !!me?.user && import.meta.env.MODE !== 'demo';
  useEffect(() => {
    if (tourReady && (routePage === '' || routePage === 'home') && !tourDone(favUser)) setTouring(true);
    // only when the company becomes ready or the person changes, not on every page
  }, [tourReady, favUser]);
  // the page reloads its data when the branch picked in the topbar changes
  const [branchKey, setBranchKey] = useState(0);
  useEffect(() => {
    const bump = () => setBranchKey((k) => k + 1);
    window.addEventListener(BRANCH_EVENT, bump);
    return () => window.removeEventListener(BRANCH_EVENT, bump);
  }, []);

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
  // the current page stays in view in the pane (at 1366x768 the list scrolls)
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('.nav-item.active')?.scrollIntoView({ block: 'nearest' });
  });
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

  // someone limited to branches gets no link to the company's own books (the server refuses them anyway)
  const companyBooks = seesCompanyBooks({ admin: !!me?.user?.permissions.includes('admin'), branchLimited: !!me?.user?.branchLimited });
  const data = useMemo(
    () => ({ accounts, settings, plan, online, companyBooks, reloadAccounts, reloadSettings, reloadPlan }),
    [accounts, settings, plan, online, companyBooks, reloadAccounts, reloadSettings, reloadPlan]
  );
  const { t } = i18n;
  const [page, arg, arg2] = route;
  const routeKey = `${page ?? ''}/${arg ?? ''}`;
  const routeRef = useRef(routeKey);
  routeRef.current = routeKey;
  const setPageNav = useCallback((nav: PageNav | null) => setPageNavState(nav ? { ...nav, route: routeRef.current } : null), []);
  const pageNav = pageNavState && pageNavState.route === routeKey ? pageNavState : null;

  let title: string = t('home');
  let content: ReactNode;
  const isAdmin = !!me?.user?.permissions.includes('admin');
  const viewer: NavViewer = { admin: isAdmin, permissions: me?.user?.permissions ?? [], businessTypes: settings?.businessTypes ?? [], branchLimited: !!me?.user?.branchLimited };
  const books = seesCompanyBooks(viewer);
  // admin pages (the menu's admin-only items) open for admins only, and the company's books (trial balance, final
  // accounts, statements) not for someone limited to branches; everyone else lands on the home page
  const adminPage = (ADMIN_PAGES.has(page ?? '') && !isAdmin) || (COMPANY_BOOK_PAGES.has(page ?? '') && !books);
  switch (adminPage ? '' : page ?? '') {
    case '':
    case 'home':
      content = <Home viewer={viewer} user={favUser} favourites={favs} />;
      break;
    case 'entries':
      title = t('vouchers');
      content = <Entries key={arg ?? ''} {...(arg === 'draft' || arg === 'checked' || arg === 'approved' ? { status: arg as EntryStatus } : {})} />;
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
    case 'real-estate':
      title = t('re_title');
      content = <RealEstate />;
      break;
    case 'real-estate-project':
      title = t('re_title');
      content = arg ? <RealEstateProject key={arg} id={arg} /> : null;
      break;
    case 'mobile':
      title = t(arg === 'repairs' ? 'mob_navRepairs' : 'mob_nav');
      content = <MobileShop key={arg ?? 'devices'} tab={arg === 'repairs' ? 'repairs' : 'devices'} />;
      break;
    case 'repair':
      title = t('mob_navRepairs');
      content = arg ? <RepairDetail key={arg} id={arg} /> : null;
      break;
    case 'works':
      title = t('ew_jobs');
      content = <EngineeringWorks />;
      break;
    case 'job':
      title = t('ew_jobs');
      content = arg ? <JobDetail key={arg} id={arg} /> : null;
      break;
    case 'payroll':
      title = t('pay_title');
      content = <Payroll key={arg ?? 'months'} tab={arg === 'employees' ? 'employees' : arg === 'advances' ? 'advances' : 'months'} />;
      break;
    case 'payroll-run':
      title = t('pay_title');
      content = arg ? <PayrollRun key={arg} id={arg} /> : null;
      break;
    case 'pos':
      title = t('pos_title');
      content = <Pos />;
      break;
    case 'pos-shift':
      title = t('pos_title');
      content = arg ? <PosShiftReport key={arg} id={arg} /> : null;
      break;
    case 'solar':
      title = t('sl_title');
      content = <Solar key={arg ?? 'home'} tab={isSolarTab(arg) ? arg : 'home'} />;
      break;
    case 'solar-system':
      title = t('sl_title');
      content = arg ? <SolarSystem key={arg} id={arg} /> : null;
      break;
    case 'branches':
      title = t('bn_title');
      content = <Branches />;
      break;
    case 'website-api':
      title = t('wa_nav');
      content = <WebsiteApi />;
      break;
    case 'generators':
      title = t('gen_title');
      content = <Generators key={arg ?? 'collect'} tab={arg === 'subscribers' || arg === 'months' || arg === 'debts' ? arg : 'collect'} />;
      break;
    case 'gen-run':
      title = t('gen_title');
      content = arg ? <GenRun key={arg} id={arg} /> : null;
      break;
    case 'banking':
      title = t('bk_title');
      content = <Banking key={arg ?? 'accounts'} tab={arg === 'transfer' || arg === 'cheques' || arg === 'reconcile' ? arg : 'accounts'} />;
      break;
    case 'purchase-orders':
      title = t('po_title');
      content = <PurchaseOrders />;
      break;
    case 'new-purchase-order':
      title = t('po_title');
      content = <PurchaseOrderEditor key="new" />;
      break;
    case 'edit-purchase-order':
      title = t('po_title');
      content = arg ? <PurchaseOrderEditor key={arg} id={arg} /> : null;
      break;
    case 'purchase-order':
      title = t('po_title');
      content = arg ? <PurchaseOrderDetail key={arg} id={arg} /> : null;
      break;
    case 'stock-adjustments':
      title = t('adj_title');
      content = <StockAdjustments />;
      break;
    case 'new-stock-adjustment':
      title = t('adj_title');
      content = <StockAdjustmentEditor key="new" />;
      break;
    case 'edit-stock-adjustment':
      title = t('adj_title');
      content = arg ? <StockAdjustmentEditor key={arg} id={arg} /> : null;
      break;
    case 'stock-adjustment':
      title = t('adj_title');
      content = arg ? <StockAdjustmentDetail key={arg} id={arg} /> : null;
      break;
    case 'stock-count':
      title = t('adj_count');
      content = <StockCount />;
      break;
    case 'print-design':
      title = t('pd_title');
      content = <PrintDesignPage />;
      break;
    case 'labels':
      title = t('lb_title');
      content = <Labels />;
      break;
    case 'expiry':
      title = t('ex_title');
      content = <Expiry />;
      break;
    case 'companies':
      title = t('co_title');
      content = <Companies />;
      break;
    case 'fixed-assets':
      title = t('fa_title');
      content = <FixedAssets key={arg ?? 'list'} tab={arg === 'runs' ? 'runs' : undefined} />;
      break;
    case 'fixed-asset':
      title = t('fa_title');
      content = arg ? <FixedAssetDetail key={arg} id={arg} /> : null;
      break;
    case 'cheque':
      title = t('bk_title');
      content = arg ? <ChequeDetail key={arg} id={arg} /> : null;
      break;
    case 'bank-statement':
      title = t('bk_title');
      content = arg ? <StatementDetail key={arg} id={arg} /> : null;
      break;
    case 'rates':
      title = t('fx_title');
      // the revaluation is worked out from the company's books: not for someone limited to branches
      content = <Rates key={arg ?? 'rates'} tab={arg === 'revaluation' && books ? 'revaluation' : 'rates'} revaluation={books} />;
      break;
    case 'brief':
      title = t('br_title');
      content = <Brief />;
      break;
    case 'expenses':
      title = t('br_expenses');
      content = <Expenses />;
      break;
    case 'reports-more':
      title = t('br_reports');
      content = <MoreReports key={arg ?? ''} tab={isReportTab(arg) ? arg : 'sales-items'} />;
      break;
    case 'quotes':
      title = t('qt_title');
      content = <Quotes />;
      break;
    case 'new-quote':
      title = t('qt_title');
      content = <QuoteEditor key="new" />;
      break;
    case 'edit-quote':
      title = t('qt_title');
      content = arg ? <QuoteEditor key={arg} id={arg} /> : null;
      break;
    case 'quote':
      title = t('qt_title');
      content = arg ? <QuoteDetail key={arg} id={arg} /> : null;
      break;
    case 'pipeline':
      title = t('pl_title');
      content = <Pipeline />;
      break;
    case 'import':
      title = t('md_title');
      content = <Import />;
      break;
    case 'business-type':
      title = t('bizType');
      content = <BusinessTypePage />;
      break;
    case 'car-parts':
      title = t('pt_title');
      content = <CarParts />;
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
      content = <Home viewer={viewer} user={favUser} favourites={favs} />;
  }

  if (pageNav?.title) title = t(pageNav.title);
  const company = settings ? i18n.name(settings.companyName) : '';
  const user = me?.signInRequired ? me.user?.name ?? '' : currentUser() || me?.user?.name || '';
  // the header shows where a page sits: "Sales › Sales invoices" (a page refused to a non-admin shows Home)
  const shown = adminPage ? '' : page ?? '';
  const matches = (item: NavItem) => (pageNav ? item.key === pageNav.key : (item.match ?? []).some((m) => m === shown || m === `${shown}:${arg}`));
  const group = pageNav?.group ?? NAV.find((g) => g.items.some(matches))?.group;
  const crumb = group && group !== 'gOverview' ? group : null;
  // "How does this work?": the user guide's topic for this page, beside its title
  const guide = pageGuide(shown, arg);

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

  const shownItems = (items: NavItem[]) => items.filter((item) => canSee(item, viewer));
  const activeGroup = NAV.find((g) => shownItems(g.items).some(matches))?.group ?? null;
  const groupOpen = (g: string) => (openGroup === undefined ? g === activeGroup : openGroup === g);
  const favItems = favs.map((k) => findPage(k)).filter((i): i is NavItem => !!i && i.path !== undefined && canSee(i, viewer));
  function navLink(item: NavItem, extra = '') {
    if (item.path === undefined) {
      return (
        <button key={item.key} type="button" className="nav-item" disabled title={t(item.key)}>
          <Icon name={item.icon} /><span>{t(item.key)}</span><span className="soon">{t('soon')}</span>
        </button>
      );
    }
    const active = matches(item);
    const feature = item.business ? BUSINESS_FEATURE[item.business] : null;
    const locked = !!feature && !!plan && !plan.features.includes(feature);
    return (
      <a key={extra + item.key} className={'nav-item' + (active ? ' active' : '')} href={href(item.path)} aria-current={active ? 'page' : undefined} title={railed ? t(item.key) : undefined}>
        <Icon name={item.icon} /><span>{t(item.key)}</span>{locked && !railed && <span className="soon">{feature === 'realEstate' ? 'Business' : 'Pro'}</span>}
      </a>
    );
  }

  async function signOut() {
    try { await api.logout(); } catch { /* signed out either way */ }
    setMe((m) => (m ? { ...m, user: null } : m));
  }

  return (
    <I18nContext.Provider value={i18n}>
      <DataContext.Provider value={data}>
       <DisplayContext.Provider value={display}>
       <PageNavContext.Provider value={setPageNav}>
        <ToastProvider>
          <BusyBar />
          <div className="app">
            <nav className={'sidebar' + (railed ? ' collapsed' : '')} aria-label={t('appName')}>
              <div className="brand">
                <Logo size={28} />
                <div className="brand-text">
                  <div className="brand-name">{t('appName')}</div>
                  <div className="brand-tag">{t('tagline')}</div>
                </div>
                {!narrow && <button type="button" className="btn subtle icon nav-toggle" aria-label={collapsed ? t('navExpand') : t('navCollapse')} title={collapsed ? t('navExpand') : t('navCollapse')} aria-pressed={collapsed} onClick={() => { setCollapsed(!collapsed); setNavCollapsed(!collapsed); }}>
                  <Icon name="panel" size={16} className="flip" />
                </button>}
              </div>
              <div className="company-card" title={railed ? company || t('noCompany') : undefined}>
                <span className="avatar mark"><Icon name="building" size={16} /></span>
                <div><span className="label">{t('company')}</span><strong className="bidi">{company || t('noCompany')}</strong></div>
              </div>
              <div className="nav-scroll" ref={navRef}>
                {favItems.length > 0 && (
                  <div className="nav-section">
                    <div className="nav-group">{t('navFavourites')}</div>
                    {favItems.map((item) => navLink(item, 'fav-'))}
                  </div>
                )}
                {NAV.filter((g) => shownItems(g.items).length).map((g) => {
                  const open = railed || groupOpen(g.group);
                  const id = `nav-${g.group}`;
                  return (
                    <div key={g.group} className={'nav-section' + (open ? ' open' : '')}>
                      {!railed && (
                        <button type="button" className="nav-group nav-group-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpenGroup(open ? null : g.group)}>
                          <span>{t(g.group)}</span>
                          <Icon name="chevronDown" size={14} />
                        </button>
                      )}
                      {open && <div id={id} className="nav-items">{shownItems(g.items).map((item) => navLink(item))}</div>}
                    </div>
                  );
                })}
              </div>
            </nav>
            <div className="main">
              <header className="topbar">
                <h1>
                  {crumb && <><span className="crumb" aria-hidden="true">{t(crumb)}</span><Icon name="chevron" size={16} className="flip" /></>}
                  <span>{title}</span>
                </h1>
                {guide && <GuideLink slug={guide} />}
                <span className="spacer" />
                <button type="button" className="search-trigger no-print" onClick={() => setSearching(true)} aria-label={t('searchHint')} aria-keyshortcuts="Control+K">
                  <Icon name="search" size={16} />
                  <span>{t('searchHint')}</span>
                  <kbd className="ltr">Ctrl K</kbd>
                </button>
                <BranchSwitcher user={user} />
                <SupportButton compact />
                <button type="button" className="btn subtle icon" title={dark ? t('lightMode') : t('darkMode')} aria-label={dark ? t('lightMode') : t('darkMode')} onClick={() => setTheme(dark ? 'light' : 'dark')}>
                  <Icon name={dark ? 'sun' : 'moon'} size={16} />
                </button>
                <span className="topbar-sep" />
                <UserMenu
                  name={user || t('owner')}
                  role={me.signInRequired && me.user ? me.user.roles.map((r) => (isKey('role_' + r) ? t(('role_' + r) as Key) : r)).join(lang === 'en' ? ', ' : '، ') : t('role_admin')}
                  plan={plan ? { label: plan.source === 'trial' ? t('planTrialChip') : t(`plan_${plan.plan}`), paid: plan.plan !== 'free' } : null}
                  admin={isAdmin}
                  signInRequired={me.signInRequired}
                  onChangePassword={() => setChangingPassword(true)}
                  onSignOut={() => void signOut()}
                />
              </header>
              {changingPassword && <PasswordModal needsCurrent onClose={() => setChangingPassword(false)} />}
              {searching && <CommandPalette viewer={viewer} onClose={() => setSearching(false)} />}
              {touring && settings && settings.businessTypes !== null && <Tour user={favUser} businessTypes={settings.businessTypes} onClose={() => setTouring(false)} />}
              {/* the first time an admin opens the company: what does it do? (decides the menu; changed later under System) */}
              {isAdmin && settings && settings.businessTypes === null && import.meta.env.MODE !== 'demo' && (
                <div className="backdrop"><div className="modal biz-modal" role="dialog" aria-modal="true" aria-label={t('bizWelcome')}><Suspense fallback={<PageLoading />}><BusinessTypeChooser first /></Suspense></div></div>
              )}
              <UpdateBanner />
              <PrintNotices />
              <main className="content">
                {import.meta.env.MODE === 'demo' && narrow && <div className="alert info demo-phone no-print" role="note" style={{ marginBottom: 14 }}>{t('demoPhoneNote')}</div>}
                {plan?.license?.state === 'grace' && plan.license.expires && plan.graceEnds && page !== 'plans' && (
                  <div className="alert warn plan-banner no-print" style={{ marginBottom: 14 }}>
                    <span>{t('graceNote', { p: t(`plan_${plan.license.plan}`), d: i18n.date(plan.license.expires), g: i18n.date(plan.graceEnds) })}</span>
                    <a href={href('plans')}>{t('planLicense')}</a>
                  </div>
                )}
                {/* (the 0.1.8 grace notice for everyone at this PC; the others for admins, with their link to Plan & license) */}
                {page !== 'plans' && activationNoticeFor(plan, isAdmin) && (
                  <div className="alert warn plan-banner no-print" role="status" style={{ marginBottom: 14 }}>
                    <span>{t(activationNoticeFor(plan, isAdmin)!, { p: t(`plan_${plan!.license!.plan}`), d: plan!.activation.graceUntil ? i18n.date(plan!.activation.graceUntil) : '' })}</span>
                    {isAdmin && <a href={href('plans')}>{t('planLicense')}</a>}
                  </div>
                )}
                {import.meta.env.MODE !== 'demo' && <BackupNoticeBar admin={isAdmin} page={page} />}
                <div key={branchKey} style={{ display: 'contents' }}><Suspense fallback={<PageLoading />}>{content}</Suspense></div>
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
       </PageNavContext.Provider>
       </DisplayContext.Provider>
      </DataContext.Provider>
    </I18nContext.Provider>
  );
}

/** True in a window no wider than a phone or a small tablet (760 px): the website demo on a phone. */
function useNarrow(): boolean {
  const query = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 760px)') : null);
  const [narrow, setNarrow] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const q = query();
    if (!q) return;
    const changed = () => setNarrow(q.matches);
    q.addEventListener('change', changed);
    return () => q.removeEventListener('change', changed);
  }, []);
  return narrow;
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
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => [...w.replace(/^ال(?=\p{L}{2})/u, '')][0] ?? '').join(/\p{Script=Arabic}/u.test(name) ? '\u200C' : '').toUpperCase();
  const close = () => setOpen(false);
  const planChip = plan && <span className={'plan-chip' + (plan.paid ? ' paid' : '')}>{plan.label}</span>;
  return (
    <div className="menu-anchor" ref={box} onBlur={(e) => { const next = e.relatedTarget as Node | null; if (open && next && !e.currentTarget.contains(next)) setOpen(false); }}>
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
          {admin && canSwitchCompanies() && <a className="menu-item" href={href('companies')} onClick={close}><Icon name="building" size={16} />{t('co_menu')}</a>}
          {signInRequired && <button type="button" className="menu-item" onClick={() => { close(); button.current?.focus(); onChangePassword(); }}><Icon name="key" size={16} />{t('changePassword')}</button>}
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
