import { useEffect, useRef, useState } from 'react';
import { formatAmount, htmlLang, MONTHS, rateFromX100, todayIso, toWesternDigits, type DigitStyle, type Lang, type Names, type PostingAccounts } from '@qasa/core';
import {
  api, ApiError, currentUser, request, setCurrentUser, type BackupStatus, type DatabaseCheck, type DatabaseInput, type DatabaseStatus, type NetworkStatus, type YearEndStatus
} from '../api.ts';
import { AccountCombo, ErrorBox, Icon, LANGUAGE_NAMES, Modal, downloadCsv, useData, useDisplay, useLoad, useToast, type Density, type Theme } from '../components.tsx';
import { ChoiceTiles, type Choice } from '../ChoiceTiles.tsx';
import { isKey, useI18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';
import { encodeQr, qrSvgPath } from '../industry/qr.ts';
import { UsageCard } from '../industry/UsageCard.tsx';
import { HelpPanel } from '../industry/SupportButton.tsx';
import { GuideLink } from '../industry/GuideLink.tsx';
import { UpdateSettings } from '../industry/UpdateSettings.tsx';
import { desktopUpdates } from '../industry/updates.ts';
import { LegalPanel } from '../industry/LegalPanel.tsx';
import { GraphicsSetting } from '../industry/GraphicsSetting.tsx';
import { PrintersCard } from '../industry/Printers.tsx';
import { CompaniesSetting } from './Companies.tsx';
import { StartOverCard, startOverCall } from '../industry/StartOver.tsx';
import { canSwitchCompanies } from '../industry/companies-api.ts';
import { cloudChoices } from './cloud-providers.ts';
import { backupFailureKey, backupNoticeKey } from '../industry/BackupNotice.tsx';
import { batchesApi, type BatchSettingsView } from '../industry/batches-api.ts';
import { LoyaltySettingsCard } from '../industry/Loyalty.tsx';
import { CloseAskSetting } from '../industry/CloseAsk.tsx';
import { dataPlaceLine, officeText, useDataPlace, type DataPlace } from '../industry/data-place.ts';

/** One section of Settings: its address (#/settings/<id>), icon, name and the line under the name. */
export interface SettingsSection {
  id: string;
  icon: string;
  name: Key;
  help: Key;
  /** Admins only (the server asks for an admin too). */
  admin?: boolean;
  /** A page of its own elsewhere in the app (Users): its rectangle opens that page. */
  page?: string;
  /** Shown only where its cards can work (Companies, Start over and Updates are in the Windows app only). */
  when?: () => boolean;
}

/**
 * The sections of Settings, in order. The names are the ones the release notes and the user guide use ("Settings → Backups",
 * "Settings → Printers", "Settings → Loyalty points", "Settings → Updates", "Settings → About", "Settings → Users").
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'display', icon: 'globe', name: 'displayTitle', help: 'ss_displayHelp' },
  { id: 'company', icon: 'building', name: 'company', help: 'ss_companyHelp', admin: true },
  { id: 'periods', icon: 'cal', name: 'ss_periods', help: 'ss_periodsHelp', admin: true },
  { id: 'sales', icon: 'cart', name: 'ss_sales', help: 's14_salesSectionHelp', admin: true },
  { id: 'loyalty', icon: 'star', name: 'ly_title', help: 'ss_loyaltyHelp', admin: true },
  { id: 'printers', icon: 'printer', name: 'prn_title', help: 'ss_printersHelp' },
  { id: 'backups', icon: 'upload', name: 'bkTitle', help: 'ss_backupsHelp', admin: true },
  { id: 'network', icon: 'branch', name: 'netTitle', help: 'ss_networkHelp', admin: true },
  { id: 'companies', icon: 'layers', name: 'co_title', help: 'ss_companiesHelp', admin: true, when: () => canSwitchCompanies() || (typeof window !== 'undefined' && startOverCall() !== null) },
  { id: 'users', icon: 'users', name: 'users', help: 'ss_usersHelp', admin: true, page: 'users' },
  { id: 'usage', icon: 'chart', name: 'us_title', help: 'ss_usageHelp' },
  { id: 'updates', icon: 'download', name: 'ss_updates', help: 'ss_updatesHelp', when: () => typeof window !== 'undefined' && desktopUpdates() !== null },
  { id: 'about', icon: 'circle', name: 'ss_about', help: 'ss_aboutHelp' }
];

/**
 * The sections this person sees: everyone has display, printers, usage, updates and About; the rest is for admins,
 * and a section whose cards can't work here (Companies and Updates in the browser) is left out.
 */
export const settingsSectionsFor = (admin: boolean): SettingsSection[] => SETTINGS_SECTIONS.filter((s) => (admin || !s.admin) && (!s.when || s.when()));

/**
 * The section #/settings/<id> opens. An unknown name, a page elsewhere, or an admin section for someone else opens
 * none: the grid of sections shows.
 */
export function settingsSectionOf(id: string | null | undefined, admin: boolean): SettingsSection | null {
  return settingsSectionsFor(admin).find((s) => s.id === id && !s.page) ?? null;
}

/**
 * Settings. #/settings shows only a grid of rectangles, one per section this person may see (SettingsGrid); a section
 * opens alone at its own address (#/settings/backups) with a Back link and its name on top, so the browser's Back
 * works and a link can open one section. There is no list at the side, at any window width.
 */
export function Settings({ admin, section }: { admin: boolean; section?: string | null }) {
  const chosen = settingsSectionOf(section, admin);
  // a section (or back to the grid) starts at its top, like a page of its own
  const opened = chosen?.id ?? '';
  useEffect(() => { document.querySelector('main.content')?.scrollTo?.({ top: 0 }); }, [opened]);
  return chosen ? <SettingsSectionPage section={chosen} admin={admin} /> : <SettingsGrid admin={admin} />;
}

/**
 * #/settings: one rectangle per section, with its icon, name and help line, like the tiles of the Home page. Users is a
 * page of its own, so its rectangle opens that page.
 */
export function SettingsGrid({ admin }: { admin: boolean }) {
  const { t } = useI18n();
  return (
    <nav className="settings-grid" aria-label={t('settings')}>
      {settingsSectionsFor(admin).map((s) => (
        <a key={s.id} className="settings-tile" data-section={s.id} href={href(s.page ?? `settings/${s.id}`)}>
          <span className="launch-ico"><Icon name={s.icon} size={22} /></span>
          <span className="settings-tile-text"><strong>{t(s.name)}</strong><span>{t(s.help)}</span></span>
        </a>
      ))}
    </nav>
  );
}

/** #/settings/<id>: that one section alone, under the way back to the grid ("‹ Settings") and the section's name. */
export function SettingsSectionPage({ section, admin }: { section: SettingsSection; admin: boolean }) {
  const { t } = useI18n();
  const name = t(section.name);
  // 1.4: the section's name is on top; a card inside that starts with the same name would say it twice. Such a
  // heading stays for screen readers (cards are labelled by it) and is not drawn. Cards may arrive after the page
  // (they load their own data), so the section is watched while it is open.
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    const mark = () => markRepeatedHeadings(root, name);
    mark();
    if (typeof MutationObserver !== 'function') return;
    const watch = new MutationObserver(mark);
    watch.observe(root, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [name, section.id]);
  return (
    <section ref={box} className="settings-section stack" data-section={section.id} aria-labelledby="settings-section-title">
      <a className="settings-back" href={href('settings')}><Icon name="chevron" size={16} className="settings-back-icon" />{t('settings')}</a>
      <h2 id="settings-section-title" className="settings-section-title">{t(section.name)}</h2>
      <SettingsSectionContent id={section.id} admin={admin} />
    </section>
  );
}

/**
 * Marks the headings inside an open section that only repeat its name (the "Printers" card under "Printers"), and
 * unmarks any that no longer do (another language). The section's own title is never one of them.
 */
export function markRepeatedHeadings(root: ParentNode, name: string): void {
  const same = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim() === name.replace(/\s+/g, ' ').trim();
  for (const h of root.querySelectorAll('h2:not(.settings-section-title)')) {
    const repeated = same(h.textContent);
    if (repeated !== h.classList.contains('settings-repeat-title')) h.classList.toggle('settings-repeat-title', repeated);
  }
}

/** Settings → About: where the company's data is (this PC, or the office PC this one is connected to). */
export function DataPlaceCard({ place }: { place: DataPlace | null }) {
  const { t } = useI18n();
  if (!place) return null;
  return (
    <div className="card pad row" data-place={place.kind} style={{ flexWrap: 'wrap' }}>
      <Icon name={place.kind === 'office' ? 'branch' : 'building'} size={18} />
      <div className="stack" style={{ gap: 2, flex: 1, minWidth: 220 }}>
        <strong>{t('s14_whereData')}</strong>
        <span className="muted small">{dataPlaceLine(t, place)}</span>
      </div>
    </div>
  );
}

function AboutDataPlace() {
  const place = useDataPlace();
  // the website demo keeps its data in the browser, and its status line says so
  return import.meta.env.MODE === 'demo' ? null : <DataPlaceCard place={place} />;
}

/**
 * 1.4: Settings → Backups on a PC connected to an office PC. The books are not here, so nothing here may read as if a
 * copy of this PC protected them: it says where the data and its backups are, and offers no backup buttons.
 */
export function ClientBackupCard({ place }: { place: DataPlace }) {
  const { t } = useI18n();
  return (
    <div className="card pad stack" data-client-backups>
      <div className="card-head"><h2>{t('bkTitle')}</h2><GuideLink slug="backups-restore-and-companies" /></div>
      <div className="alert info" role="status">{officeText(t, place, 's14_bkClient')}</div>
    </div>
  );
}

/** 1.4: Settings → Office network on a PC connected to an office PC: it is a client, and says of which PC. */
export function ClientNetworkCard({ place }: { place: DataPlace }) {
  const { t } = useI18n();
  return (
    <div className="card pad stack" data-client-network>
      <div className="card-head"><h2>{t('netTitle')}</h2><GuideLink slug="office-network-and-qasa-relay" /></div>
      <div className="alert info" role="status">{officeText(t, place, 's14_netClient')}</div>
      <p className="muted small" style={{ margin: 0 }}>{t('s14_netClientSettings')}</p>
    </div>
  );
}

/** Backups: this PC's own (the books are here), or the word that they are on the office PC. Nothing until that is known. */
function BackupCard() {
  const place = useDataPlace();
  if (!place) return null;
  return place.kind === 'office' ? <ClientBackupCard place={place} /> : <ThisPcBackupCard />;
}

function NetworkSection() {
  const place = useDataPlace();
  if (!place) return null;
  return place.kind === 'office' ? <ClientNetworkCard place={place} /> : <><OfficeNetworkCard /><PhonesCard /><DatabaseCard /></>;
}

/** What each section holds: the same cards as before, only grouped. */
function SettingsSectionContent({ id, admin }: { id: string; admin: boolean }) {
  switch (id) {
    case 'company':
      return <><CompanyDetailsCard /><PostingAccountsCard /></>;
    case 'periods':
      return <PeriodsSettings />;
    case 'sales':
      return <ExpirySettingsCard />;
    case 'loyalty':
      return <LoyaltySettingsCard />;
    case 'printers':
      return <><PrintersCard />{admin && <PrintDesignCard />}</>;
    case 'backups':
      return <BackupCard />;
    case 'network':
      return <NetworkSection />;
    case 'companies':
      return <><CompaniesSetting /><StartOverCard /></>;
    case 'usage':
      return <UsageCard admin={admin} />;
    case 'updates':
      return <UpdateSettings />;
    case 'about':
      return <><AboutDataPlace /><HelpPanel /><LegalPanel /></>;
    default:
      return <DisplaySettings />;
  }
}

/** A letter of each language's own writing, above its name on the language rectangles. */
const LANGUAGE_SAMPLES: Record<Lang, string> = { ar: 'ع', en: 'A', ku: 'ک' };

/**
 * Settings → Language and display: what it is at the start of each row, and its options as rectangles at the end.
 * The languages come from the app's one list (LANGUAGE_NAMES), each by its own name, and change the language the same
 * way as everywhere else (setLang: the whole app at once, remembered on this PC, the Windows app's menus too).
 */
export function DisplaySettings() {
  const { t, lang, setLang, digits, setDigits } = useI18n();
  const { theme, density, setTheme, setDensity } = useDisplay();
  const languages: Choice<Lang>[] = LANGUAGE_NAMES.map(([l, label]) => ({ value: l, label, sample: LANGUAGE_SAMPLES[l], lang: htmlLang(l) }));
  const digitStyles: Choice<DigitStyle>[] = [
    { value: 'eastern', label: t('lk_digitsEastern'), sample: '١٢٣' },
    { value: 'western', label: t('lk_digitsWestern'), sample: '123' }
  ];
  const themes: Choice<Theme>[] = [
    { value: 'light', label: t('themeLight'), icon: 'sun' },
    { value: 'dark', label: t('themeDark'), icon: 'moon' },
    { value: 'system', label: t('themeSystem'), icon: 'contrast' }
  ];
  const densities: Choice<Density>[] = [
    { value: 'comfortable', label: t('densityComfortable'), icon: 'rows' },
    { value: 'compact', label: t('densityCompact'), icon: 'rowsDense' }
  ];
  // English always uses 123: the two digit styles are for Arabic and Kurdish
  const english = lang === 'en';
  return (
    <section className="stack" aria-label={t('displayTitle')}>
      <div className="section-head">
        <p>{t('displayHelp')}</p>
      </div>
      <div className="settings-group">
        <div className="setting">
          <Icon name="globe" size={20} className="setting-icon" />
          <div className="setting-text"><strong>{t('language')}</strong><span>{t('languageHelp')}</span></div>
          <div className="setting-ctl">
            <ChoiceTiles label={t('language')} value={lang} options={languages} onChange={setLang} />
          </div>
        </div>
        <div className={'setting' + (english ? ' disabled' : '')}>
          <Icon name="hash" size={20} className="setting-icon" />
          <div className="setting-text"><strong>{t('digits')}</strong><span>{t('digitsHelp')}</span></div>
          <div className="setting-ctl">
            <ChoiceTiles label={t('digits')} value={english ? 'western' : digits} options={digitStyles} onChange={setDigits} disabled={english} />
          </div>
        </div>
        <div className="setting">
          <Icon name="contrast" size={20} className="setting-icon" />
          <div className="setting-text"><strong>{t('appearance')}</strong><span>{t('appearanceHelp')}</span></div>
          <div className="setting-ctl">
            <ChoiceTiles label={t('appearance')} value={theme} options={themes} onChange={setTheme} />
          </div>
        </div>
        <div className="setting">
          <Icon name="rows" size={20} className="setting-icon" />
          <div className="setting-text"><strong>{t('density')}</strong><span>{t('densityHelp')}</span></div>
          <div className="setting-ctl">
            <ChoiceTiles label={t('density')} value={density} options={densities} onChange={setDensity} />
          </div>
        </div>
        <GraphicsSetting />
      </div>
    </section>
  );
}

/** Settings → Company: the company's names, its usual exchange rate and the start of its fiscal year. */
function CompanyDetailsCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { settings, reloadSettings } = useData();
  const [name, setName] = useState<Names>({ ar: '', en: '', ku: '' });
  const [rate, setRate] = useState('');
  const [fiscal, setFiscal] = useState('01-01');
  const [user, setUser] = useState(currentUser());
  // with sign-in on, the name on vouchers is the signed-in user's
  const [signInOn, setSignInOn] = useState(false);
  useEffect(() => { api.me().then((m) => setSignInOn(m.signInRequired), () => undefined); }, []);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!settings) return;
    setName(settings.companyName);
    setRate(String(rateFromX100(settings.defaultRateX100)));
    setFiscal(settings.fiscalYearStart);
  }, [settings]);

  async function save() {
    setError(null);
    try {
      const r = Number(toWesternDigits(rate).replace(/[,٬\s]/g, ''));
      await api.updateSettings({ companyName: name, defaultRateX100: Math.round(r * 100), fiscalYearStart: fiscal });
      setCurrentUser(user.trim());
      await reloadSettings();
      toast(t('saved'));
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="card pad stack">
      <div className="card-head"><h2>{t('company')}</h2><GuideLink slug="company-setup-and-opening-balances" /></div>
      <div className="grid-3">
        <label className="field"><span>{t('nameAr')}</span><input className="input" dir="rtl" lang="ar" value={name.ar} onChange={(e) => setName({ ...name, ar: e.target.value })} /></label>
        <label className="field"><span>{t('nameEn')}</span><input className="input" dir="ltr" lang="en" value={name.en} onChange={(e) => setName({ ...name, en: e.target.value })} /></label>
        <label className="field"><span>{t('nameKu')}</span><input className="input" dir="rtl" lang="ckb" value={name.ku} onChange={(e) => setName({ ...name, ku: e.target.value })} /></label>
        <label className="field"><span>{t('defaultRate')} <span className="muted">({t('perUsd')})</span></span><input className="input amount" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
        <label className="field"><span>{t('fiscalStart')}</span><input className="input ltr" value={fiscal} onChange={(e) => setFiscal(e.target.value)} /></label>
        {!signInOn && <label className="field"><span>{t('yourName')}</span><input className="input" value={user} onChange={(e) => setUser(e.target.value)} /></label>}
      </div>
      <ErrorBox error={error} />
      <div><button type="button" className="btn primary" onClick={save}>{t('save')}</button></div>
    </div>
  );
}

/** Settings → Printers, for admins: the way to the print design and the labels. */
function PrintDesignCard() {
  const { t } = useI18n();
  return (
    <div className="card pad row" style={{ flexWrap: 'wrap' }}>
      <Icon name="printer" size={18} />
      <div className="stack" style={{ gap: 2, flex: 1, minWidth: 220 }}>
        <strong>{t('pd_title')}</strong>
        <span className="muted small">{t('pp_help')}</span>
      </div>
      <a className="btn" href={href('print-design')}>{t('pd_title')}</a>
      <a className="btn" href={href('labels')}><Icon name="tag" size={16} />{t('lb_title')}</a>
    </div>
  );
}

/** Settings → Periods and year-end: period locking, year-end closing and the audit log that records both. */
function PeriodsSettings() {
  const i18n = useI18n();
  const { t } = i18n;
  const [error, setError] = useState<unknown>(null);
  const year = todayIso().slice(0, 4);
  const periods = useLoad(() => api.periods(), []);
  const audit = useLoad(() => api.audit(100), []);

  async function togglePeriod(period: string, locked: boolean) {
    setError(null);
    try {
      if (locked) await api.unlockPeriod(period); else await api.lockPeriod(period);
      periods.reload();
      audit.reload();
    } catch (e) {
      setError(e);
    }
  }

  const lockedSet = new Set((periods.data ?? []).map((p) => p.period));
  const actionLabel = (a: string) => (isKey('a_' + a) ? t(('a_' + a) as 'a_create') : a);
  const entityLabel = (e: string) => (isKey('e_' + e) ? t(('e_' + e) as 'e_entry') : e);

  return (
    <>
      <div className="card pad stack">
        <h2>{t('periods')} — <span className="num">{i18n.digitsOf(year)}</span></h2>
        <div className="muted small">{t('periodsHelp')}</div>
        <div className="grid-4">
          {MONTHS[i18n.lang].map((m, i) => {
            const period = `${year}-${String(i + 1).padStart(2, '0')}`;
            const locked = lockedSet.has(period);
            return (
              <div key={period} className="row" style={{ justifyContent: 'space-between', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }}>
                <span>{m} {locked && <span className="chip warn">{t('locked')}</span>}</span>
                <button type="button" className="btn small" onClick={() => togglePeriod(period, locked)}>{locked ? t('unlock') : t('lock')}</button>
              </div>
            );
          })}
        </div>
        <ErrorBox error={error} />
      </div>

      <YearEndCard onChanged={() => { periods.reload(); audit.reload(); }} />

      <div className="card">
        <div style={{ padding: '14px 16px 6px' }}>
          <h2>{t('auditLog')}</h2>
          <div className="muted small">{t('auditHelp')}</div>
        </div>
        <ErrorBox error={audit.error} />
        <table className="table">
          <thead><tr><th>{t('when')}</th><th>{t('who')}</th><th>{t('what')}</th></tr></thead>
          <tbody>
            {(audit.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="num small">{i18n.dateTime(r.at)}</td>
                <td>{r.user}</td>
                <td>{actionLabel(r.action)} · {entityLabel(r.entity)} {r.entityId && <span className="muted small ltr">{r.entityId.length > 12 ? r.entityId.slice(0, 8) : r.entityId}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Other PCs in the office working on this company file (the Pro module; absent in builds without it). */
function OfficeNetworkCard() {
  const { t, digitsOf } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [absent, setAbsent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.network().then(setStatus, (e) => {
      if (e instanceof ApiError && e.status === 404) setAbsent(true);
      else setError(e);
    });
  }, []);

  async function toggle(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.setNetwork(on));
      toast(t('saved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const address = (a: string) => (status && status.port !== 47420 ? `${a}:${status.port}` : a);
  return (
    <div className="card pad stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="card-head"><h2>{t('netTitle')}</h2><GuideLink slug="office-network-and-qasa-relay" /></div>
        {status && <span className={'chip ' + (status.on ? 'ok' : '')}>{status.on ? t('switchedOn') : t('switchedOff')}</span>}
      </div>
      <p className="muted" style={{ margin: 0 }}>{t('netHelp')}</p>
      {absent && <div className="alert">{t('netOfficial')}</div>}
      {status && !status.available && <div className="alert">{t('netNeedsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      {status && status.available && !status.signInRequired && <div className="alert">{t('netNeedsSignIn')} <a href={href('users')}>{t('users')}</a></div>}
      {status?.on && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="grid-2">
            <div className="field">
              <span>{t('netAddress')}</span>
              {status.addresses.length
                ? status.addresses.map((a) => <strong key={a} className="ltr num" style={{ fontSize: 18 }}>{address(a)}</strong>)
                : <span className="muted">{t('netNoAddress')}</span>}
            </div>
            <div className="field">
              <span>{t('netCode')}</span>
              <PairingCode code={status.code} />
            </div>
          </div>
          <p style={{ margin: 0 }}>{t('netSteps')}</p>
          <p className="muted small" style={{ margin: 0 }}>{t('netFirewall')}</p>
          <p className="muted small" style={{ margin: 0 }}>{t('netSignedIn', { n: digitsOf(String(status.signedIn)) })}</p>
          <RelaySection status={status as NetworkStatus & RelayFields} onChange={setStatus} />
        </div>
      )}
      <ErrorBox error={error} />
      {status && status.available && (status.on || status.signInRequired) && (
        <div>
          <button type="button" className={'btn ' + (status.on ? '' : 'primary')} disabled={busy} onClick={() => toggle(!status.on)}>
            {status.on ? t('netTurnOff') : t('netTurnOn')}
          </button>
        </div>
      )}
    </div>
  );
}

/** What the office network's status adds for Qasa Relay (the Pro module's /api/network). */
interface RelayFields {
  relayWanted?: boolean;
  relay?: { state: 'connecting' | 'online' | 'waiting' | 'refused'; officeIdShown: string; clients: number; lastError: string | null; onlineSince: string | null } | null;
}

/** Qasa Relay: the office network reachable over the internet, with no public IP or router setup. */
function RelaySection({ status, onChange }: { status: NetworkStatus & RelayFields; onChange(s: NetworkStatus): void }) {
  const { t, digitsOf } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const relay = status.relay ?? null;
  const on = !!status.relayWanted;

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      onChange(await request<NetworkStatus>('PUT', '/api/network/relay', { on: next }));
      toast(t('saved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  // the link changes by itself (connecting, online, a lost connection): look again every few seconds while it's on
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => { api.network().then(onChange, () => {}); }, 5000);
    return () => clearInterval(timer);
  }, [on, onChange]);

  // Starter: the office network on the office's own network; Qasa Relay comes with Pro (the server refuses it too)
  if (status.relayAvailable === false) {
    return (
      <div className="stack" style={{ gap: 10, borderBlockStart: '1px solid var(--line)', paddingBlockStart: 14, marginBlockStart: 4 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>{t('rl_title')}</h3>
          <a className="chip plan-pro" href={href('plans')}>Pro</a>
        </div>
        <div className="alert">{t('rl_needsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>
      </div>
    );
  }

  const state = relay?.state ?? 'waiting';
  const chip = state === 'online' ? 'ok' : state === 'refused' ? 'bad' : 'warn';
  const errorKey = relay?.lastError ? ('rl_e_' + relay.lastError) : null;
  return (
    <div className="stack" style={{ gap: 10, borderBlockStart: '1px solid var(--line)', paddingBlockStart: 14, marginBlockStart: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>{t('rl_title')}</h3>
        <span className={'chip ' + (on ? chip : '')}>{on ? t(('rl_state_' + state) as Key) : t('switchedOff')}</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>{t('rl_help')}</p>
      {on && relay && (
        <div className="grid-2">
          <div className="field">
            <span>{t('rl_officeId')}</span>
            <strong className="ltr num" style={{ fontSize: 22, letterSpacing: '.06em' }}>{relay.officeIdShown}</strong>
          </div>
          <div className="field">
            <span>{t('netCode')}</span>
            <PairingCode code={status.code} />
          </div>
        </div>
      )}
      {on && relay && <p style={{ margin: 0 }}>{t('rl_steps')}</p>}
      {on && relay && <p className="muted small" style={{ margin: 0 }}>{t('rl_clients', { n: digitsOf(String(relay.clients)) })}</p>}
      {on && errorKey && isKey(errorKey) && <div className="alert">{t(errorKey)}</div>}
      <p className="muted small" style={{ margin: 0 }}>{t('rl_private')}</p>
      <ErrorBox error={error} />
      <div>
        <button type="button" className={'btn ' + (on ? '' : 'primary')} disabled={busy} onClick={() => void toggle(!on)}>
          {on ? t('rl_turnOff') : t('rl_turnOn')}
        </button>
      </div>
    </div>
  );
}

/**
 * Where the company database is: the company file on this PC, or (Business) the company's own MariaDB/MySQL server.
 * Moving is check first (the server's certificate is settled before any password goes to it), then copy and restart.
 * Hidden in builds without Pro.
 */
function DatabaseCard() {
  const { t, digitsOf } = useI18n();
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [open, setOpen] = useState(false);
  // the port as typed (a number in the field would move the cursor while typing)
  const [form, setForm] = useState<Omit<DatabaseInput, 'port'> & { port: string }>({ host: '', port: '3306', database: 'qasa', user: '', password: '' });
  const [showCa, setShowCa] = useState(false);
  const [check, setCheck] = useState<DatabaseCheck | null>(null);
  const [matches, setMatches] = useState(false);
  /** the self-signed certificate's fingerprint the admin confirmed; it goes with every later check and the move */
  const [confirmed, setConfirmed] = useState<string | null>(null);

  useEffect(() => {
    api.database().then(setStatus, (e) => {
      if (!(e instanceof ApiError && e.status === 404)) setError(e);
    });
  }, []);

  // any change to the form means the server has to be checked again
  function change(patch: Partial<typeof form>) {
    setForm({ ...form, ...patch });
    setCheck(null);
    setMatches(false);
    setConfirmed(null);
  }

  const input = (): DatabaseInput => ({
    host: form.host.trim(), port: Number(form.port), database: form.database.trim(), user: form.user, password: form.password,
    ...(showCa && form.ca?.trim() ? { ca: form.ca.trim() } : {}),
    ...(confirmed ? { fingerprint: confirmed } : {})
  });

  async function runCheck() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.checkDatabase(input());
      setCheck(result);
      if (result.step === 'needs_ca') setShowCa(true);
      if (result.step !== 'confirm_certificate') setMatches(false);
    } catch (e) {
      setCheck(null);
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function move(mode: 'copy' | 'use') {
    if (!window.confirm(t(mode === 'copy' ? 'dbMoveQ' : 'dbUseQ', { host: form.host.trim() }))) return;
    setBusy(true);
    setError(null);
    try {
      if ((await api.moveDatabase(input(), mode)).restarting) setRestarting(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!window.confirm(t('dbLeaveQ'))) return;
    setBusy(true);
    setError(null);
    try {
      if ((await api.leaveDatabase()).restarting) setRestarting(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return error ? <div className="card pad stack"><h2>{t('dbTitle')}</h2><ErrorBox error={error} /></div> : null;
  const ltr = (x: string) => `\u2066${x}\u2069`;
  const server = status.server;
  const disabled = busy || restarting;
  const confirmedPath = check?.step === 'confirm_certificate' && matches;

  return (
    <div className="card pad stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{t('dbTitle')}</h2>
        <span className={'chip ' + (status.kind === 'server' ? 'ok' : '')}>{status.kind === 'server' ? t('dbOnServer') : t('dbOnFile')}</span>
      </div>
      {restarting && <div className="alert ok" role="status">{t('dbRestarting')}</div>}

      {status.kind === 'server' && server && (
        <>
          <p className="muted" style={{ margin: 0 }}>{t('dbOnServerHelp')}</p>
          <div className="grid-2">
            <div className="field"><span>{t('dbServer')}</span><strong className="ltr">{server.host}:{server.port} / {server.database}</strong></div>
            <div className="field"><span>{t('dbUser')}</span><span className="ltr">{server.user}</span></div>
            <div className="field"><span>{t('dbTls')}</span><span>{t(`dbTls_${server.tls}`)}</span></div>
            <div className="field"><span>{t('dbSince')}</span><span className="num">{ltr(digitsOf(server.since.slice(0, 10)))}{server.version ? <span className="muted small"> · <span className="ltr">{server.version}</span></span> : null}</span></div>
          </div>
          <ErrorBox error={error} />
          <div><button type="button" className="btn" disabled={disabled} onClick={() => void leave()}>{t('dbLeave')}</button></div>
        </>
      )}

      {status.kind === 'file' && (
        <>
          <p className="muted" style={{ margin: 0 }}>{t('dbHelp')}</p>
          {!status.available && <div className="alert">{t('dbNeedsBusiness')} <a href={href('plans')}>{t('planLicense')}</a></div>}
          {status.available && !open && <div><button type="button" className="btn" onClick={() => setOpen(true)}>{t('dbMoveOpen')}</button></div>}
          {status.available && open && (
            <div className="stack" style={{ gap: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 10 }}>
              <div className="muted small">{t('dbFormHelp')}</div>
              <div className="grid-2">
                <label className="field"><span>{t('dbHost')}</span><input className="input ltr" spellCheck={false} autoComplete="off" maxLength={253} placeholder="192.168.1.30" value={form.host} onChange={(e) => change({ host: e.target.value })} /></label>
                <label className="field"><span>{t('dbPort')}</span><input className="input ltr num" inputMode="numeric" maxLength={5} value={form.port} onChange={(e) => change({ port: toWesternDigits(e.target.value).replace(/\D/g, '') })} /></label>
                <label className="field"><span>{t('dbName')}</span><input className="input ltr" spellCheck={false} autoComplete="off" maxLength={64} value={form.database} onChange={(e) => change({ database: e.target.value })} /></label>
                <label className="field"><span>{t('dbUser')}</span><input className="input ltr" spellCheck={false} autoComplete="off" maxLength={80} value={form.user} onChange={(e) => change({ user: e.target.value })} /></label>
                <label className="field"><span>{t('dbPassword')}</span><input className="input ltr" type="password" autoComplete="new-password" maxLength={500} value={form.password} onChange={(e) => change({ password: e.target.value })} /></label>
              </div>
              <label className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={showCa} onChange={(e) => { setShowCa(e.target.checked); setCheck(null); }} /> {t('dbCa')}
              </label>
              {showCa && (
                <label className="field">
                  <span className="muted small">{t('dbCaHelp')}</span>
                  <textarea className="input ltr" rows={4} spellCheck={false} autoComplete="off" maxLength={32000} placeholder="-----BEGIN CERTIFICATE-----" value={form.ca ?? ''} onChange={(e) => change({ ca: e.target.value })} />
                </label>
              )}

              {check?.step === 'confirm_certificate' && (
                <div className="alert warn stack" style={{ gap: 8 }}>
                  <strong>{t('dbCertTitle')}</strong>
                  <div className="small">{t('dbCertSelf')}</div>
                  <div className="field"><span>{t('dbFingerprint')}</span><code className="ltr" style={{ overflowWrap: 'anywhere', fontSize: 13 }}>{check.certificate.fingerprint}</code></div>
                  <div className="small">{t('dbValidTo')}: <span className="ltr">{check.certificate.validTo}</span></div>
                  <div className="small">{t('dbCertHow')} <code className="ltr">openssl x509 -in server-cert.pem -noout -fingerprint -sha256</code></div>
                  <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={matches} onChange={(e) => { setMatches(e.target.checked); setConfirmed(e.target.checked ? check.certificate.fingerprint : null); }} /> {t('dbCertMatches')}</label>
                </div>
              )}
              {check?.step === 'needs_ca' && <div className="alert warn">{t('dbNeedsCa', { issuer: check.certificate.issuer.replace(/\n/g, ', ') })}</div>}
              {check?.step === 'ready' && (
                <div className="alert ok stack" style={{ gap: 6 }}>
                  <strong>{t('dbReady')}</strong>
                  <div className="small">{t('dbServer')}: <span className="ltr">{check.server.version}</span> · {t('dbTls')}: {t(`dbTls_${check.tls}`)}</div>
                  {check.state === 'empty'
                    ? <div className="small">{t('dbEmpty')}</div>
                    : <div className="small">{t('dbHasCompany', { name: check.company?.name || '—', n: digitsOf(String(check.company?.entries ?? 0)) })}</div>}
                  {check.inUse && <div className="small" style={{ color: 'var(--bad)' }}>{t('dbInUseNow')}</div>}
                  {check.broadAccount && <div className="alert warn small" role="status">{t('dbBroadAccount')}</div>}
                </div>
              )}
              <ErrorBox error={error} />
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {(check?.step !== 'ready') && (
                  <button type="button" className={'btn ' + (confirmedPath ? 'primary' : '')} disabled={disabled || !form.host || !form.user || !form.password || (check?.step === 'confirm_certificate' && !matches)} onClick={() => void runCheck()}>
                    {check ? t('dbCheckAgain') : t('dbCheck')}
                  </button>
                )}
                {check?.step === 'ready' && !check.inUse && (
                  <button type="button" className="btn primary" disabled={disabled} onClick={() => void move(check.state === 'empty' ? 'copy' : 'use')}>
                    {check.state === 'empty' ? t('dbMove') : t('dbUse')}
                  </button>
                )}
                {check?.step === 'ready' && <button type="button" className="btn" disabled={disabled} onClick={() => void runCheck()}>{t('dbCheckAgain')}</button>}
              </div>
            </div>
          )}
          {!open && <ErrorBox error={error} />}
        </>
      )}
    </div>
  );
}

/** Year-end closing: each fiscal year's result and state; an admin closes a year that has ended, or reopens it. */
function YearEndCard({ onChanged }: { onChanged(): void }) {
  const { t, digitsOf } = useI18n();
  const toast = useToast();
  const { settings } = useData();
  const data = useLoad(() => api.yearEnd(), []);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function act(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      toast(done);
      data.reload();
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  type Year = YearEndStatus['years'][number];
  const name = (y: Year) => digitsOf(data.data?.fiscalYearStart === '01-01' ? String(y.year) : `${y.from} – ${y.to}`);
  const money = (n: number) => digitsOf(formatAmount(Math.abs(n), 'IQD'));
  const why = (y: Year, b: Year['blockers'][number]) =>
    b.code === 'year_not_ended' ? t('bl_year_not_ended', { d: y.to })
      : b.code === 'close_previous_year_first' ? t('bl_close_previous_year_first', { y: String(b.year ?? '') })
        : isKey(`bl_${b.code}`) ? t(`bl_${b.code}` as 'bl_plan_limit', { n: String(b.count ?? '') }) : b.code;

  return (
    <div className="card pad stack">
      <div className="card-head"><h2>{t('ye_title')}</h2><GuideLink slug="reports-final-accounts-year-end" /></div>
      <div className="muted small">{t('ye_help')}</div>
      <ErrorBox error={data.error ?? error} />
      {data.data && data.data.years.length === 0 && <div className="muted">{t('ye_none')}</div>}
      {data.data && data.data.years.length > 0 && (
        <table className="table">
          <thead><tr><th>{t('ye_year')}</th><th>{t('ye_result')}</th><th>{t('ye_state')}</th><th /></tr></thead>
          <tbody>
            {data.data.years.map((y) => (
              <tr key={y.year}>
                <td className="num">{name(y)}</td>
                <td className="num">{y.result === 0 ? digitsOf('0') : t(y.result > 0 ? 'ye_profit' : 'ye_loss', { a: money(y.result) })}</td>
                <td>
                  {y.closing
                    ? <><span className="chip ok">{t('ye_closed')}</span> <a href={href(`entry/${y.closing.entryId}`)} className="ltr num small">{y.closing.number}</a></>
                    : <span className={'chip ' + (y.ended ? 'warn' : '')}>{y.ended ? t('ye_open') : t('ye_running')}</span>}
                  {!y.closing && y.ended && y.blockers.length > 0 && (
                    <ul className="muted small" style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                      {y.blockers.map((b) => <li key={b.code}>{why(y, b)}</li>)}
                    </ul>
                  )}
                </td>
                <td style={{ textAlign: 'end' }}>
                  {y.closing && (
                    <button type="button" className="btn small" disabled={busy} onClick={() => { if (window.confirm(t('ye_reopenQ', { y: name(y) }))) void act(() => api.reopenYear(y.year), t('ye_reopened')); }}>{t('ye_reopen')}</button>
                  )}
                  {!y.closing && y.ended && y.blockers.length === 0 && (
                    <button type="button" className="btn small primary" disabled={busy} onClick={() => { if (window.confirm(t('ye_closeQ', { y: name(y), d: y.to, c: settings?.postingAccounts.yearResult ?? '229' }))) void act(() => api.closeYear(y.year), t('ye_done')); }}>{t('ye_close')}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** The two halves of a pairing code (XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX), one per line, so it reads and types easily. */
export function pairingCodeLines(code: string | null | undefined): string[] {
  if (!code) return [];
  const groups = code.split('-');
  return groups.length > 4 ? [groups.slice(0, 4).join('-'), groups.slice(4).join('-')] : [code];
}

function PairingCode({ code }: { code: string | null | undefined }) {
  return (
    <strong className="ltr num" style={{ fontSize: 20, letterSpacing: '.06em', display: 'grid', gap: 2 }}>
      {pairingCodeLines(code).map((line, i) => <span key={i}>{line}</span>)}
    </strong>
  );
}

const KEEP_CHOICES = [7, 14, 30, 60, 90, 365];

/**
 * One copy in a backup list (the folder's or the cloud's): when, size, and Restore. A copy made by another company or
 * on another PC (own: false) says so, and restoring it asks with its own warning; it is never refused (a new PC must
 * always be able to restore).
 */
export function BackupCopyRow({ copy, when, size, disabled, onRestore }: {
  copy: { encrypted?: boolean; own?: boolean }; when: string; size: string; disabled: boolean; onRestore(): void;
}) {
  const { t } = useI18n();
  const foreign = copy.own === false;
  return (
    <tr>
      <td className="num small">
        {when} {copy.encrypted && <span className="chip ok" title={t('bkEncrypted')}>{t('bkLocked')}</span>}
        {foreign && <> <span className="chip warn">{t('bkForeign')}</span></>}
      </td>
      <td className="num small">{size}</td>
      <td style={{ textAlign: 'end' }}>
        <button type="button" className="btn small" disabled={disabled}
          onClick={() => { if (window.confirm(t(foreign ? 'bkRestoreForeignQ' : 'bkRestoreQ', { when }))) onRestore(); }}>{t('bkRestore')}</button>
      </td>
    </tr>
  );
}

/** A daily copy of the company file in a chosen folder, and restoring one (the Pro module; absent without it). */
function ThisPcBackupCard() {
  const { t, digitsOf, dateTime } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [absent, setAbsent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    api.backup().then(setStatus, (e) => {
      if (e instanceof ApiError && e.status === 404) setAbsent(true);
      else setError(e);
    });
  }, []);

  async function act(work: () => Promise<BackupStatus>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await work());
      if (done) toast(done);
    } catch (e) {
      setError(e);
      // a copy that failed: the card shows why, in the admin's language
      api.backup().then(setStatus, () => {});
    } finally {
      setBusy(false);
    }
  }

  /** An encrypted copy that needs its password: the copy's name, or the token of a file picked in Windows. */
  const [asking, setAsking] = useState<{ name?: string; pick?: string; wrong: boolean } | null>(null);
  /** An unencrypted copy while the company has a backup password: restored only when the admin confirms it is theirs. */
  const [plain, setPlain] = useState<{ name?: string; pick?: string } | null>(null);
  const [plainKnown, setPlainKnown] = useState(false);
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState({ a: '', b: '' });

  async function send(req: { name?: string; pick?: string; password?: string; allowPlain?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      if ((await api.restoreBackup(req)).restarting) {
        setAsking(null);
        setPlain(null);
        setRestarting(true);
      }
    } catch (e) {
      const pick = e instanceof ApiError ? (e.details as { pick?: string | null } | null)?.pick ?? undefined : undefined;
      if (e instanceof ApiError && (e.code === 'backup_password_required' || e.code === 'backup_password_wrong')) {
        setAsking({ ...(req.name ? { name: req.name } : {}), ...(pick ? { pick } : {}), wrong: e.code === 'backup_password_wrong' });
      } else if (e instanceof ApiError && e.code === 'backup_not_encrypted' && !req.allowPlain) {
        setAsking(null);
        setPlainKnown(false);
        setPlain({ ...(req.name ? { name: req.name } : {}), ...(pick ? { pick } : {}) });
      } else {
        setAsking(null);
        setError(e);
      }
    } finally {
      setBusy(false);
    }
  }

  /** A file picked in Windows (a copy in the list asks in its own row: BackupCopyRow). */
  function restoreOther() {
    if (!window.confirm(t('bkRestoreOtherQ'))) return;
    void send({});
  }

  async function savePassword(value: string | null) {
    await act(() => api.setBackupPassword(value), t('saved'));
    setNewPassword({ a: '', b: '' });
  }
  const passwordProblem = newPassword.a.length > 0 && newPassword.a.length < 10 ? t('bkPasswordShort')
    : newPassword.b.length > 0 && newPassword.a !== newPassword.b ? t('bkPasswordMismatch') : null;

  // isolated left-to-right, so "244 KB" and the date keep their order inside Arabic and Kurdish text
  const ltr = (s: string) => `\u2066${s}\u2069`;
  const when = (iso: string) => dateTime(iso);
  const size = (bytes: number) => ltr(digitsOf(bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`));

  return (
    <div className="card pad stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="card-head"><h2>{t('bkTitle')}</h2><GuideLink slug="backups-restore-and-companies" /></div>
        {status?.available && <span className={'chip ' + (status.on ? 'ok' : '')}>{status.on ? t('switchedOn') : t('switchedOff')}</span>}
      </div>
      <p className="muted" style={{ margin: 0 }}>{t('bkHelp')}</p>
      {absent && <div className="alert">{t('bkOfficial')} {t('bkManual')}</div>}
      {absent && <CloseAskSetting />}
      {restarting && <div className="alert ok" role="status">{t('bkRestarting')}</div>}
      {status && (
        <>
          {!status.available && <div className="alert">{t('bkNeedsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
          <div className="grid-2">
            <div className="field">
              <span>{t('bkFolder')}</span>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="ltr small" style={{ overflowWrap: 'anywhere' }}>{status.folder}</span>
                <button type="button" className="btn small" disabled={busy || restarting} onClick={() => act(() => api.chooseBackupFolder())}>{t('bkChooseFolder')}</button>
              </div>
              {status.syncedDefault && <div className="alert info small" role="status">{t('bkLocalInstead', { f: ltr(status.syncedDefault) })}</div>}
            </div>
            <label className="field">
              <span>{t('bkKeep')}</span>
              <select className="input" value={status.keep} disabled={busy || restarting} onChange={(e) => act(() => api.setBackup({ keep: Number(e.target.value) }), t('saved'))}>
                {KEEP_CHOICES.map((n) => <option key={n} value={n}>{t('bkCopies', { n: String(n) })}</option>)}
              </select>
            </label>
          </div>
          <div className="small">{status.last ? t('bkLast', { when: when(status.last.at), size: size(status.last.size) }) : t('bkNone')}</div>
          {status.lastError && <div className="alert bad" role="alert">{t('bkFailed', { e: backupFailureKey(status) ? t(backupFailureKey(status)!) : status.lastError })}</div>}
          {!status.lastError && backupNoticeKey(status) && <div className="alert warn" role="status">{t(backupNoticeKey(status)!)}</div>}
          {/* encrypting copies is for every plan: a saved copy may go to a USB disk or a synced folder */}
          <div className="stack" style={{ gap: 8, padding: 12, border: '1px solid var(--line)', borderRadius: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{t('bkEncryption')}</strong>
              <span className={'chip ' + (status.encrypted ? 'ok' : status.cloudFolder ? 'warn' : '')}>{status.encrypted ? t('bkEncrypted') : t('bkNotEncrypted')}</span>
            </div>
            {!status.encrypted && status.cloudFolder && <div className="alert warn" role="status">{t('bkCloudWarning')}</div>}
            <div className="muted small">{t('bkEncryptionHelp')}</div>
            <div className="grid-2">
              <label className="field"><span>{status.encrypted ? t('bkNewPassword') : t('bkPassword')}</span><input className="input ltr" type="password" autoComplete="new-password" maxLength={200} value={newPassword.a} onChange={(e) => setNewPassword({ ...newPassword, a: e.target.value })} /></label>
              <label className="field"><span>{t('bkPasswordAgain')}</span><input className="input ltr" type="password" autoComplete="new-password" maxLength={200} value={newPassword.b} onChange={(e) => setNewPassword({ ...newPassword, b: e.target.value })} /></label>
            </div>
            {passwordProblem && <div className="small" style={{ color: 'var(--bad)' }}>{passwordProblem}</div>}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn primary" disabled={busy || restarting || !newPassword.a || newPassword.a !== newPassword.b || newPassword.a.length < 10} onClick={() => void savePassword(newPassword.a)}>{status.encrypted ? t('bkChangePassword') : t('bkEncrypt')}</button>
              {status.encrypted && <button type="button" className="btn" disabled={busy || restarting} onClick={() => { if (window.confirm(t('bkStopEncryptingQ'))) void savePassword(null); }}>{t('bkStopEncrypting')}</button>}
            </div>
          </div>
          <CloudBackup encrypted={status.encrypted} disabled={restarting} onRestarting={() => setRestarting(true)} />
          {/* 1.1: with the plan's automatic backups; the main process makes it when the app closes (close-backup.ts) */}
          {status.available && status.onClose !== undefined && (
            <div className="stack" style={{ gap: 8, padding: 12, border: '1px solid var(--line)', borderRadius: 10 }}>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={!!status.onClose} disabled={busy || restarting} onChange={(e) => act(() => api.setBackup({ onClose: e.target.checked }), t('saved'))} />
                <strong>{t('bc_onClose')}</strong>
              </label>
              <div className="muted small">{t('bc_help')}</div>
              {status.onClose && (
                <div className="field">
                  <span>{t('bc_folder')}</span>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="ltr small" style={{ overflowWrap: 'anywhere' }}>{status.closeFolder ?? t('bc_noFolder')}</span>
                    <button type="button" className="btn small" disabled={busy || restarting} onClick={() => act(() => api.chooseCloseFolder())}>{t('bkChooseFolder')}</button>
                    {status.closeFolder && <button type="button" className="btn small" disabled={busy || restarting} onClick={() => act(() => api.chooseCloseFolder(true))}>{t('bc_noFolderButton')}</button>}
                  </div>
                  <span className="muted small">{t('bc_folderHelp')}</span>
                </div>
              )}
              {status.closeError && <div className="alert bad" role="alert">{t('bc_failed', { e: status.closeError })}</div>}
            </div>
          )}
          {/* 1.4: "Back up before closing?" when the books changed and no backup was made since (the Windows app asks) */}
          <CloseAskSetting />
          <ErrorBox error={error} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {/* every plan, Free included: only the automatic daily copies need the plan */}
            <button type="button" className="btn primary" disabled={busy || restarting} onClick={() => act(() => api.runBackup(), t('bkSavedNow'))}>{t('bkNow')}</button>
            {status.available && (
              <button type="button" className="btn" disabled={busy || restarting} onClick={() => act(() => api.setBackup({ on: !status.on }), t('saved'))}>
                {status.on ? t('bkTurnOff') : t('bkTurnOn')}
              </button>
            )}
            <button type="button" className="btn" disabled={busy || restarting} onClick={restoreOther}>{t('bkRestoreOther')}</button>
          </div>
          {status.files.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <h3 style={{ margin: 0 }}>{t('bkCopiesTitle')}</h3>
              <table className="table">
                <tbody>
                  {status.files.map((f) => (
                    <BackupCopyRow key={f.name} copy={f} when={when(f.at)} size={size(f.size)} disabled={busy || restarting} onRestore={() => void send({ name: f.name })} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {!status && !absent && <ErrorBox error={error} />}
      {plain && (
        <Modal title={t('bkPlainTitle')} onClose={() => setPlain(null)}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); if (plainKnown) void send({ ...plain, allowPlain: true }); }}>
            <div className="alert bad" role="alert">{t('bkPlainWarning')}</div>
            <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={plainKnown} onChange={(e) => setPlainKnown(e.target.checked)} />{t('bkPlainKnown')}</label>
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" autoFocus onClick={() => setPlain(null)}>{t('cancel')}</button>
              <button type="submit" className="btn danger" disabled={busy || !plainKnown}>{t('bkPlainRestore')}</button>
            </div>
          </form>
        </Modal>
      )}
      {asking && (
        <Modal title={t('bkPasswordTitle')} onClose={() => { setAsking(null); setPassword(''); }}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void send({ ...(asking.name ? { name: asking.name } : {}), ...(asking.pick ? { pick: asking.pick } : {}), password }); setPassword(''); }}>
            <p style={{ margin: 0 }}>{t('bkPasswordAsk')}</p>
            <label className="field"><span>{t('bkPassword')}</span><input className="input ltr" type="password" autoComplete="off" autoFocus maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {asking.wrong && <div className="alert bad" role="alert">{t('err_backup_password_wrong')}</div>}
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => { setAsking(null); setPassword(''); }}>{t('cancel')}</button>
              <button type="submit" className="btn primary" disabled={busy || !password}>{t('bkRestore')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/** Cloud backup (Pro): what the server says about the connected Google Drive or OneDrive. */
interface CloudStatus {
  available: boolean;
  configured: { google: boolean; onedrive: boolean };
  needsPassword: boolean;
  provider: 'google' | 'onedrive' | null;
  account: string | null;
  connectedAt: string | null;
  last: { at: string; file: string; size: number } | null;
  lastError: string | null;
  connecting: 'google' | 'onedrive' | null;
  uploading: boolean;
}
/** `own: false`: a copy made by another company or on another PC (left out by older servers). */
interface CloudFile { id: string; name: string; size: number; at: string; own?: boolean }
const cloudApi = {
  status: () => request<CloudStatus>('GET', '/api/backup/cloud'),
  connect: (provider: 'google' | 'onedrive') => request<{ url: string; status: CloudStatus }>('POST', '/api/backup/cloud/connect', { provider }),
  cancel: () => request<CloudStatus>('POST', '/api/backup/cloud/cancel', {}),
  disconnect: () => request<CloudStatus>('POST', '/api/backup/cloud/disconnect', {}),
  upload: () => request<CloudStatus>('POST', '/api/backup/cloud/upload', {}),
  files: () => request<CloudFile[]>('GET', '/api/backup/cloud/files'),
  restore: (id: string, password?: string) => request<{ restarting: boolean }>('POST', '/api/backup/cloud/restore', { id, ...(password ? { password } : {}) })
};

/**
 * Google Drive / OneDrive with one click: the browser opens to sign in, and the screen follows along until the account
 * is connected. Only encrypted copies go up, so it asks for the backup password first.
 */
function CloudBackup({ encrypted, disabled, onRestarting }: { encrypted: boolean; disabled: boolean; onRestarting(): void }) {
  const { t, digitsOf, dateTime } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [signInUrl, setSignInUrl] = useState<string | null>(null);
  const [files, setFiles] = useState<CloudFile[] | null>(null);
  const [asking, setAsking] = useState<{ id: string; wrong: boolean } | null>(null);
  const [password, setPassword] = useState('');

  const load = () => cloudApi.status().then(setStatus, (e) => { if (!(e instanceof ApiError && e.status === 404)) setError(e); });
  useEffect(() => { void load(); }, [encrypted]);
  // while signing in or uploading, follow along
  useEffect(() => {
    if (!status?.connecting && !status?.uploading) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [status?.connecting, status?.uploading]);

  if (!status) return error ? <ErrorBox error={error} /> : null;
  const name = (p: 'google' | 'onedrive') => t(p === 'google' ? 'cl_google' : 'cl_onedrive');
  const ltr = (v: string) => `⁦${v}⁩`;
  const when = (iso: string) => dateTime(iso);
  const size = (bytes: number) => ltr(digitsOf(bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`));
  const errorText = (code: string) => { const key = `err_${code}`; return isKey(key) ? t(key) : code; };

  async function act<T>(work: () => Promise<T>, after?: (v: T) => void) {
    setBusy(true);
    setError(null);
    try {
      const v = await work();
      after?.(v);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      void load();
    }
  }

  const connect = (p: 'google' | 'onedrive') => act(() => cloudApi.connect(p), (r) => {
    setSignInUrl(r.url);
    setStatus(r.status);
    // the Windows app opens this in the customer's own browser
    window.open(r.url, '_blank', 'noopener');
  });

  async function restore(id: string, pass?: string) {
    setBusy(true);
    setError(null);
    try {
      if ((await cloudApi.restore(id, pass)).restarting) {
        setAsking(null);
        setFiles(null);
        onRestarting();
      }
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'backup_password_required' || e.code === 'backup_password_wrong')) setAsking({ id, wrong: e.code === 'backup_password_wrong' });
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  const off = busy || disabled;
  return (
    <div className="stack" style={{ gap: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{t('cl_title')}</strong>
        {status.provider && <span className="chip ok">{t('cl_connectedTo', { p: name(status.provider) })}</span>}
      </div>
      <div className="muted small">{t('cl_help')}</div>

      {!status.provider && !status.available && <div className="alert">{t('cl_needsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      {!status.provider && status.available && status.needsPassword && <div className="alert warn" role="status">{t('cl_needsPassword')}</div>}

      {!status.provider && status.available && !status.needsPassword && !status.connecting && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {cloudChoices(status.configured).map(({ provider: p, state }) => state === 'connect' ? (
            <button key={p} type="button" className="btn primary" disabled={off} onClick={() => void connect(p)}>
              <Icon name="globe" size={16} /> {t('cl_connect', { p: name(p) })}
            </button>
          ) : (
            <span key={p} className="chip info">{t('cl_soon', { p: name(p) })}</span>
          ))}
        </div>
      )}

      {status.connecting && (
        <div className="alert" role="status">
          <div>{t('cl_waiting')}</div>
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {signInUrl && <a className="btn small" href={signInUrl} target="_blank" rel="noopener noreferrer">{t('cl_openAgain')}</a>}
            <button type="button" className="btn small" disabled={busy} onClick={() => act(() => cloudApi.cancel(), setStatus)}>{t('cancel')}</button>
          </div>
        </div>
      )}

      {status.provider && (
        <>
          {status.account && <div className="small">{t('cl_account', { a: ltr(status.account) })}</div>}
          <div className="small">{status.uploading ? t('cl_uploading') : status.last ? t('cl_last', { when: when(status.last.at), size: size(status.last.size) }) : t('cl_none')}</div>
          <div className="muted small">{t(status.provider === 'google' ? 'cl_where_google' : 'cl_where_onedrive')}</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {status.available && <button type="button" className="btn" disabled={off || status.uploading} onClick={() => act(() => cloudApi.upload(), () => toast(t('cl_uploaded')))}>{t('cl_uploadNow')}</button>}
            <button type="button" className="btn" disabled={off} onClick={() => act(() => cloudApi.files(), setFiles)}>{t('cl_restoreFrom')}</button>
            <button type="button" className="btn" disabled={off} onClick={() => { if (window.confirm(t('cl_disconnectQ'))) void act(() => cloudApi.disconnect(), setStatus); }}>{t('cl_disconnect')}</button>
          </div>
        </>
      )}
      {status.lastError && !status.connecting && <div className="alert bad" role="alert">{t('cl_failed', { e: errorText(status.lastError) })}</div>}
      <ErrorBox error={error} />

      {files && status.provider && (
        <Modal title={t('cl_cloudCopies', { p: name(status.provider) })} onClose={() => setFiles(null)}>
          {files.length === 0 ? <p className="muted">{t('cl_noCopies')}</p> : (
            <table className="table">
              <tbody>
                {files.map((f) => (
                  <BackupCopyRow key={f.id} copy={f} when={when(f.at)} size={size(f.size)} disabled={busy} onRestore={() => void restore(f.id)} />
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
      {asking && (
        <Modal title={t('bkPasswordTitle')} onClose={() => { setAsking(null); setPassword(''); }}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void restore(asking.id, password); setPassword(''); }}>
            <p style={{ margin: 0 }}>{t('bkPasswordAsk')}</p>
            <label className="field"><span>{t('bkPassword')}</span><input className="input ltr" type="password" autoComplete="off" autoFocus maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {asking.wrong && <div className="alert bad" role="alert">{t('err_backup_password_wrong')}</div>}
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => { setAsking(null); setPassword(''); }}>{t('cancel')}</button>
              <button type="submit" className="btn primary" disabled={busy || !password}>{t('bkRestore')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

const POSTING_FIELDS: { key: keyof PostingAccounts; root: string }[] = [
  { key: 'sales', root: '4' },
  { key: 'costOfSales', root: '3' },
  { key: 'customers', root: '16' },
  { key: 'suppliers', root: '26' },
  { key: 'cash', root: '18' },
  { key: 'yearResult', root: '22' }
];

/** Which accounts invoices post to (sales 42, cost of sales 35, customers 1611 …). */
/** Settings → Stock: how many days before expiry to warn, whether expired stock may be sold, and new items' default. */
function ExpirySettingsCard() {
  const { t } = useI18n();
  const toast = useToast();
  const [s, setS] = useState<BatchSettingsView | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { batchesApi.settings().then(setS, setError); }, []);
  if (!s) return error ? <ErrorBox error={error} /> : null;
  async function save() {
    if (!s) return;
    setError(null);
    try {
      setS(await batchesApi.saveSettings(s));
      toast(t('saved'));
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="card pad stack">
      <h2>{t('ex_settings')}</h2>
      <div className="muted small">{t('ex_trackHelp')}</div>
      <div className="grid-3">
        <label className="field">
          <span>{t('ex_nearDays')}</span>
          <input className="input num" type="number" min={1} max={730} value={s.nearExpiryDays} onChange={(e) => setS({ ...s, nearExpiryDays: Math.max(1, Math.min(730, Math.floor(Number(e.target.value)) || 1)) })} />
        </label>
        <label className="row" style={{ gap: 8, alignSelf: 'end' }}>
          <input type="checkbox" checked={s.defaultTrackExpiry} onChange={(e) => setS({ ...s, defaultTrackExpiry: e.target.checked })} />{t('ex_defaultExpiry')}
        </label>
      </div>
      <div className="field">
        <span>{t('ex_policy')}</span>
        <ChoiceTiles
          label={t('ex_policy')} value={s.expiredSales} onChange={(expiredSales) => setS({ ...s, expiredSales })}
          options={[{ value: 'block', label: t('ex_policyBlock'), icon: 'x' }, { value: 'warn', label: t('ex_policyWarn'), icon: 'clipboard' }]}
        />
      </div>
      <ErrorBox error={error} />
      <div className="row"><button type="button" className="btn primary" onClick={() => void save()}><Icon name="check" size={16} />{t('save')}</button></div>
    </div>
  );
}

function PostingAccountsCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { settings, reloadSettings } = useData();
  const [accounts, setAccounts] = useState<PostingAccounts | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (settings) setAccounts(settings.postingAccounts);
  }, [settings]);

  if (!accounts) return null;

  async function save() {
    if (!accounts) return;
    setError(null);
    try {
      await api.updateSettings({ postingAccounts: accounts });
      await reloadSettings();
      toast(t('saved'));
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="card pad stack">
      <h2>{t('postingAccounts')}</h2>
      <div className="muted small">{t('postingHelp')}</div>
      <div className="grid-3">
        {POSTING_FIELDS.map((f) => (
          <div key={f.key} className="field">
            <span>{t(`pa_${f.key}`)}</span>
            <AccountCombo value={accounts[f.key]} onChange={(code) => setAccounts({ ...accounts, [f.key]: code })} filter={(a) => a.code.startsWith(f.root)} ariaLabel={t(`pa_${f.key}`)} />
          </div>
        ))}
      </div>
      <ErrorBox error={error} />
      <div><button type="button" className="btn primary" onClick={save}>{t('save')}</button></div>
    </div>
  );
}

// ——— Settings → Phones: the Qasa phone app (Pro module, pro/src/phone) ———

interface PhonesStatus {
  available: boolean;
  listening: boolean;
  port: number;
  addresses: string[];
  devices: { id: string; name: string; userId: string | null; userName: string | null; pairedAt: string; lastSeen: string | null; online: boolean }[];
  users: { id: string; name: string }[];
  counts: { id: string; device: string; at: string; warehouseId: string | null; lines: { itemId: string; code: string; name: string; qty: number }[] }[];
  signInRequired: boolean;
}

/**
 * The phone app is not in 1.0 (owner's decision): Settings → Phones says it is coming and offers no pairing. The
 * pairing below stays in the code for the release that ships the app; phones paired before can still be removed.
 */
export const PHONE_APP_READY = false;

/** Pairing a phone: a QR code the phone app scans, with this PC's key and a one-time secret (10 minutes). */
export function PhonesCard({ ready = PHONE_APP_READY }: { ready?: boolean }) {
  const { t, digitsOf, date, dateTime, time } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState<PhonesStatus | null>(null);
  const [absent, setAbsent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => request<PhonesStatus>('GET', '/api/phones').then((s) => { setStatus(s); setUserId((u) => u || s.users[0]?.id || ''); }, (e) => {
    if (e instanceof ApiError && e.status === 404) setAbsent(true);
    else setError(e);
  });
  useEffect(() => { void load(); }, []);
  // while a QR code is shown, watch for the phone to arrive (and drop the code when it runs out)
  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => {
      if (Date.parse(pairing.expiresAt) < Date.now()) setPairing(null);
      void load();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  async function pair() {
    setBusy(true);
    setError(null);
    try {
      setPairing(await request<{ code: string; expiresAt: string }>('POST', '/api/phones/pair', status?.signInRequired ? { userId } : {}));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await request('DELETE', `/api/phones/${id}`);
      toast(t('ph_removed'));
      await load();
    } catch (e) {
      setError(e);
    }
  }

  function downloadCount(c: PhonesStatus['counts'][number]) {
    // through downloadCsv, so a name typed on a phone can't run as a formula in Excel
    downloadCsv(`stock-count-${c.at.slice(0, 10)}.csv`, [['code', 'name', 'qty'], ...c.lines.map((l) => [l.code, l.name, String(l.qty)])]);
  }

  if (absent) return null;
  const qr = pairing ? qrSvgPath(encodeQr(pairing.code, 'L'), 4) : null;
  const known = new Set(status?.devices.map((d) => d.id));
  return (
    <div className="card pad stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{t('ph_title')}</h2>
        {ready ? status && <span className="chip">{digitsOf(String(status.devices.length))}</span> : <span className="chip">{t('soon')}</span>}
      </div>
      <p className="muted" style={{ margin: 0 }}>{ready ? t('ph_help') : t('ph_soonNote')}</p>
      {ready && status && !status.available && <div className="alert">{t('ph_needsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      {status?.devices.length ? (
        <table className="table">
          <thead><tr><th>{t('ph_phone')}</th><th>{t('ph_actsAs')}</th><th>{t('ph_lastSeen')}</th><th /></tr></thead>
          <tbody>
            {status.devices.map((d) => (
              <tr key={d.id}>
                <td>{d.name} {d.online && <span className="chip ok">{t('ph_online')}</span>}</td>
                <td>{d.userName ?? t('ph_owner')}</td>
                <td className="num small">{d.lastSeen ? dateTime(d.lastSeen) : '—'}</td>
                <td><button type="button" className="btn small" onClick={() => void remove(d.id)}>{t('ph_remove')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {!ready ? null : pairing && qr ? (
        <div className="row" style={{ gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <svg viewBox={`0 0 ${qr.size} ${qr.size}`} width={240} height={240} role="img" aria-label={t('ph_qrLabel')} shapeRendering="crispEdges" style={{ background: '#fff', borderRadius: 8 }}>
            <path d={qr.path} fill="#000" />
          </svg>
          <div className="stack" style={{ gap: 6, flex: 1, minWidth: 220 }}>
            <strong>{t('ph_scanThis')}</strong>
            <ol style={{ margin: 0, paddingInlineStart: 20 }}>
              <li>{t('ph_step1')}</li>
              <li>{t('ph_step2')}</li>
              <li>{t('ph_step3')}</li>
            </ol>
            <span className="muted small">{t('ph_expires', { time: time(pairing.expiresAt) })}</span>
            <span className="muted small">{t('ph_sameNetwork')}</span>
            <div><button type="button" className="btn small" onClick={() => { setPairing(null); void request('POST', '/api/phones/pair/cancel', {}); }}>{t('cancel')}</button></div>
          </div>
        </div>
      ) : status?.available ? (
        <div className="row" style={{ gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          {status.signInRequired && (
            <label className="field" style={{ minWidth: 220 }}>
              <span>{t('ph_actsAs')}</span>
              <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
                {status.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="btn primary" disabled={busy || (status.signInRequired && !userId)} onClick={() => void pair()}>
            <Icon name="plus" size={16} /> {t('ph_add')}
          </button>
        </div>
      ) : null}
      {status && pairing && status.devices.some((d) => !known.has(d.id)) && <div className="alert">{t('ph_paired')}</div>}
      {status?.counts.length ? (
        <div className="stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>{t('ph_counts')}</h3>
          {status.counts.map((c) => (
            <div key={c.id} className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
              <span>{c.device} · <span className="num">{date(c.at.slice(0, 10))}</span> · {t('ph_lines', { n: digitsOf(String(c.lines.length)) })}</span>
              <span className="row" style={{ gap: 6 }}>
                <button type="button" className="btn small" onClick={() => downloadCount(c)}>{t('ph_download')}</button>
                <button type="button" className="btn small" onClick={() => void request('DELETE', `/api/phones/counts/${c.id}`).then(load)}>{t('ph_remove')}</button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <ErrorBox error={error} />
    </div>
  );
}
