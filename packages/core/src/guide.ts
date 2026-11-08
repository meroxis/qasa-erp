import { isLang, type Lang } from './lang.ts';

/**
 * The user guide on qasaerp.com: a home page and one page per topic, in Arabic, English and Kurdish. The site keeps
 * Arabic at its root (qasaerp.com/guide/), English and Kurdish under /en/ and /ku/, like its other pages.
 */
export const GUIDE_SLUGS = [
  'install-and-first-start',
  'company-setup-and-opening-balances',
  'chart-of-accounts',
  'vouchers-and-approval',
  'sales-invoices-returns-customers-quotations',
  'purchases-and-suppliers',
  'stock-items-warehouses-counts',
  'point-of-sale',
  'banks-safes-and-cheques',
  'reports-final-accounts-year-end',
  'users-roles-and-sign-in',
  'backups-restore-and-companies',
  'plans-licences-and-activation',
  'office-network-and-qasa-relay',
  'payroll',
  'industry-tools'
] as const;

export type GuideSlug = (typeof GUIDE_SLUGS)[number];

export const SITE_ORIGIN = 'https://qasaerp.com';
const SITE_HOST = 'qasaerp.com';
const LANG_PATH: Record<Lang, string> = { ar: '/', en: '/en/', ku: '/ku/' };

export function isGuideSlug(value: unknown): value is GuideSlug {
  return typeof value === 'string' && (GUIDE_SLUGS as readonly string[]).includes(value);
}

/** The guide's home (slug null) or one topic, in the given language (Arabic for anything else). */
export function guideUrl(slug: GuideSlug | null, lang: Lang): string {
  if (slug !== null && !isGuideSlug(slug)) throw new Error(`unknown guide page: ${String(slug)}`);
  const base = LANG_PATH[isLang(lang) ? lang : 'ar'];
  return `${SITE_ORIGIN}${base}guide/${slug ? `${slug}/` : ''}`;
}

/**
 * True only for a plain https address on qasaerp.com itself: no other host or subdomain, no port, no user name or
 * password, and nothing the URL parser had to rewrite. The Windows app opens only such addresses from its own menus.
 */
export function isQasaSiteUrl(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.hostname === SITE_HOST && url.port === '' && url.username === '' && url.password === ''
    && url.href === address && url.pathname.startsWith('/');
}

/** True only for an address guideUrl gives: the guide home or a known topic, in one of the three languages. */
export function isGuideUrl(address: string): boolean {
  if (!isQasaSiteUrl(address)) return false;
  // no query or hash, not even an empty one ("…/guide/?" and "…/guide/#" leave url.search and url.hash empty)
  if (/[?#]/.test(address)) return false;
  const url = new URL(address);
  const m = /^\/(?:(en|ku)\/)?guide\/(?:([a-z0-9-]+)\/)?$/.exec(url.pathname);
  return !!m && (m[2] === undefined || isGuideSlug(m[2]));
}
