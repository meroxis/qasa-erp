import { APP_VERSION, type Lang } from '@qasa/core';
import { useI18n, type I18n, type Key } from '../i18n.ts';

/** qasaerp.com in the app's language (Arabic is the site's root). */
const SITE: Record<Lang, string> = { ar: 'https://qasaerp.com/', en: 'https://qasaerp.com/en/', ku: 'https://qasaerp.com/ku/' };
const SOURCE = 'https://github.com/meroxis/qasa-erp';
/** The notices online: in the browser and the demo, and in the Windows app only when its installed copy can't open. */
export const NOTICES = `${SOURCE}/blob/main/THIRD_PARTY_NOTICES.md`;

/**
 * The Windows app (1.0 on) opens the THIRD_PARTY_NOTICES.md installed with it: the copy that shipped, without the
 * internet. Null in the browser, the demo and older Windows apps, which link to the notices online instead.
 */
export function installedNotices(): (() => void) | null {
  const desktop = typeof window === 'undefined' ? undefined : window.qasaDesktop;
  const open = desktop?.openNotices;
  if (!open) return null;
  const online = () => { window.open(NOTICES, '_blank', 'noopener'); };
  return () => { Promise.resolve(open.call(desktop)).then((ok) => { if (ok === false) online(); }, online); };
}

export type LegalPage = 'terms' | 'privacy' | 'eula' | 'refunds' | 'data' | 'acceptable-use' | 'third-party';

/** The address of a legal page on qasaerp.com, in the app's language. */
export const legalUrl = (lang: Lang, page: LegalPage): string => `${SITE[lang]}${page}/`;

const LINKS: [LegalPage, Key][] = [
  ['terms', 'lg_terms'], ['privacy', 'lg_privacy'], ['eula', 'lg_eula'], ['refunds', 'lg_refunds'],
  ['data', 'lg_data'], ['acceptable-use', 'lg_acceptable'], ['third-party', 'lg_thirdParty']
];

function Out({ href, children }: { href: string; children: React.ReactNode }) {
  // the Windows app opens outside addresses in the system browser
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

/**
 * "By using Qasa ERP you agree to the Terms and the Privacy Policy" (and, for a paid licence, the EULA), with the
 * links: for the first-run dialog and the licence activation step.
 */
export function AgreeLine({ paid = false }: { paid?: boolean }) {
  const { t, lang } = useI18n();
  const parts = (text: string, links: Record<string, [LegalPage, Key]>) =>
    text.split(/(\{\w+\})/).map((piece, i) => {
      const m = /^\{(\w+)\}$/.exec(piece);
      const link = m ? links[m[1]!] : undefined;
      return link ? <Out key={i} href={legalUrl(lang, link[0])}>{t(link[1])}</Out> : <span key={i}>{piece}</span>;
    });
  return (
    <p className="muted small" style={{ margin: 0 }}>
      {parts(t('lg_agree'), { terms: ['terms', 'lg_terms'], privacy: ['privacy', 'lg_privacy'] })}
      {paid && <> {parts(t('lg_agreePaid'), { eula: ['eula', 'lg_eula'] })}</>}
    </p>
  );
}

/** Settings → About & legal: the version, the two licences (AGPL core, proprietary Pro) and the legal texts. */
export function LegalPanel() {
  const i18n: I18n = useI18n();
  const { t, lang } = i18n;
  const openNotices = installedNotices();
  return (
    <div className="card pad stack">
      <h2>{t('lg_title')}</h2>
      <div className="grid-2">
        <div className="field"><span>{t('lg_version')}</span><strong className="ltr num">Qasa ERP {APP_VERSION}</strong></div>
        <div className="field"><span>©</span><strong>{t('lg_maker')}</strong></div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <strong>{t('lg_licences')}</strong>
        <p className="muted" style={{ margin: 0 }}>{t('lg_core')} <Out href={SOURCE}>{t('lg_source')}</Out></p>
        <p className="muted" style={{ margin: 0 }}>{t('lg_pro')}</p>
        <p className="muted" style={{ margin: 0 }}>{t('lg_privacyNote')}</p>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {LINKS.map(([page, key]) => page === 'third-party' && openNotices
          ? <button key={page} type="button" className="btn subtle" onClick={openNotices}>{t(key)}</button>
          : <a key={page} className="btn subtle" href={page === 'third-party' ? NOTICES : legalUrl(lang, page)} target="_blank" rel="noopener noreferrer">{t(key)}</a>)}
      </div>
    </div>
  );
}
