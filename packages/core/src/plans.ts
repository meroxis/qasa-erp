import { addDays } from './dates.ts';

/**
 * Qasa ERP plans. Free is a complete product for a small business on one PC; Starter, Pro and Business add what a
 * growing company needs (a team, more warehouses, payroll …). Starter is Pro for a small office: two users, one
 * company, the office network on the office's own network only (no Qasa Relay) and no cloud backup.
 * A plan never locks anyone out of their data:
 * when a license ends, the company keeps everything it entered and continues on the Free features.
 */
export type PlanId = 'free' | 'starter' | 'pro' | 'business';

/** Every plan, from the smallest to the largest: a plan's place here is its rank. */
export const PLAN_IDS: readonly PlanId[] = ['free', 'starter', 'pro', 'business'];

/** The plans a licence key can carry (Free needs none). */
export const PAID_PLAN_IDS = ['starter', 'pro', 'business'] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

/** A plan's place among the plans (Free 0, Starter 1, Pro 2, Business 3); anything that is no plan counts as Free. */
export function planRank(plan: unknown): number {
  return Math.max(0, PLAN_IDS.indexOf(plan as PlanId));
}

/** A year of each paid plan, in Iraqi dinars (shown on the Plan page; the portal sells them). */
export const PLAN_PRICE_IQD: Readonly<Record<PaidPlanId, number>> = { starter: 165_000, pro: 350_000, business: 1_000_000 };

/** Features that only some plans include. */
export type Feature =
  | 'officeNetwork' // several users on the office network (the office's own network)
  | 'relay' // Qasa Relay: the office network, the phone link and the website API reachable over the internet
  | 'roles' // separate sign-ins for the preparer, checker and approver
  | 'installments'
  | 'payroll'
  | 'pipeline' // the sales pipeline: leads and deals
  | 'generators' // generator owners: subscribers by amps, monthly billing, collectors
  | 'websiteApi' // API keys and webhooks for websites and online shops
  | 'phoneApp' // the Qasa phone app: scanning with the camera, prices, stock, items with photos
  | 'bankReconciliation' // matching the bank statement to the books
  | 'electricalSolar' // electrical and solar installers: system quotes, installed equipment and warranty, maintenance
  | 'finalAccountsExport' // print and Excel of the final accounts, year-end closing
  | 'noBranding' // invoices without "Made with Qasa ERP"
  | 'autoBackup' // automatic daily backups to a folder, and the copy made when the app closes
  | 'cloudBackup' // the automatic copies also uploaded to Google Drive or OneDrive
  | 'onlineEdition'
  | 'branches'
  | 'realEstate' // projects, units, reservations and unit sales
  | 'mobileShop' // IMEI tracking, trade-ins, repair orders
  | 'autoParts' // part numbers, fitments, shelves, wholesale prices
  | 'engineeringWorks' // job orders: quotes, measured lines, workshop progress, deposits, job costs
  | 'pharmacy' // pharmacies: generic names, dosage forms, prescription and controlled items, alternatives
  | 'loyalty' // loyalty points: earned on paid sales, used at the till and on invoices (1.2)
  | 'databaseServer'; // the company database on the company's own MariaDB or MySQL server

export interface PlanLimits {
  /** null = unlimited */
  companies: number | null;
  users: number | null;
  warehouses: number | null;
}

export type LimitName = keyof PlanLimits;

export interface PlanDefinition {
  id: PlanId;
  limits: PlanLimits;
  features: readonly Feature[];
}

const PRO_FEATURES: readonly Feature[] = ['officeNetwork', 'relay', 'roles', 'installments', 'payroll', 'finalAccountsExport', 'noBranding', 'autoBackup', 'cloudBackup', 'mobileShop', 'autoParts', 'engineeringWorks', 'pipeline', 'generators', 'websiteApi', 'phoneApp', 'electricalSolar', 'bankReconciliation', 'pharmacy', 'loyalty'];
/** What Pro has and Starter leaves out: reaching the office over the internet (Qasa Relay) and the cloud backup. */
export const STARTER_LEAVES_OUT: readonly Feature[] = ['relay', 'cloudBackup'];
/**
 * Starter's features, written out in full and not worked out from Pro's: a feature added to Pro later is not given to
 * Starter by itself (a test keeps this list equal to Pro's without STARTER_LEAVES_OUT, so adding one is a decision).
 */
const STARTER_FEATURES: readonly Feature[] = ['officeNetwork', 'roles', 'installments', 'payroll', 'finalAccountsExport', 'noBranding', 'autoBackup', 'mobileShop', 'autoParts', 'engineeringWorks', 'pipeline', 'generators', 'websiteApi', 'phoneApp', 'electricalSolar', 'bankReconciliation', 'pharmacy', 'loyalty'];

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: { id: 'free', limits: { companies: 1, users: 1, warehouses: 1 }, features: [] },
  starter: { id: 'starter', limits: { companies: 1, users: 2, warehouses: null }, features: STARTER_FEATURES },
  pro: { id: 'pro', limits: { companies: 3, users: 5, warehouses: null }, features: PRO_FEATURES },
  business: { id: 'business', limits: { companies: null, users: null, warehouses: null }, features: [...PRO_FEATURES, 'onlineEdition', 'branches', 'databaseServer', 'realEstate'] }
};

/** Length of the free trial (every paid feature), once per company and PC; it starts by itself on the first run. */
export const TRIAL_DAYS = 30;
/** Days after a license's last day during which it keeps working (with a reminder), to allow for renewal. */
export const GRACE_DAYS = 14;
/** A Free company posting this many sales invoices in a month sees a friendly note about Pro. It never blocks anything. */
export const GROWTH_NUDGE_INVOICES = 300;

/** What a license key says. Meroxis signs it with Ed25519; the app only holds the public key. */
export interface LicenseInfo {
  /** e.g. "QL-2026-0001" */
  id: string;
  plan: PaidPlanId;
  /** The company the license was issued to; shown in the app. */
  licensee: string;
  /** Replaces the plan's user limit when present. */
  users?: number;
  /** Replaces the plan's company limit when present. */
  companies?: number;
  /** ISO date */
  issued: string;
  /** Last day of the license (ISO date), or null when it never ends. */
  expires: string | null;
}

export type LicenseState = 'active' | 'grace' | 'expired';

export interface PlanResolution {
  plan: PlanId;
  source: 'free' | 'license' | 'trial';
  licenseState: LicenseState | null;
  /** Last day of the grace period, when the license has an end date. */
  graceEnds: string | null;
  trialEnds: string | null;
  trialActive: boolean;
  limits: PlanLimits;
  features: Feature[];
}

export function licenseState(license: LicenseInfo, today: string): LicenseState {
  if (license.expires === null || today <= license.expires) return 'active';
  return today <= addDays(license.expires, GRACE_DAYS) ? 'grace' : 'expired';
}

/** Last day of a trial that started on `started`. */
export function trialEndsOn(started: string): string {
  return addDays(started, TRIAL_DAYS - 1);
}

/** Works out the plan the app runs on today: a valid license first, then a running trial, otherwise Free. */
export function resolvePlan(input: { license: LicenseInfo | null; trialStarted: string | null; today: string }): PlanResolution {
  const { license, trialStarted, today } = input;
  const state = license ? licenseState(license, today) : null;
  const graceEnds = license?.expires ? addDays(license.expires, GRACE_DAYS) : null;
  // A start date in the future means the clock or the data was changed: no trial.
  const trialEnds = trialStarted && trialStarted <= today ? trialEndsOn(trialStarted) : null;
  const trialActive = trialEnds !== null && today <= trialEnds;

  let plan: PlanId = 'free';
  let source: PlanResolution['source'] = 'free';
  let limits = PLANS.free.limits;
  if (license && state !== 'expired') {
    plan = license.plan;
    source = 'license';
    limits = {
      ...PLANS[license.plan].limits,
      ...(license.users !== undefined ? { users: license.users } : {}),
      ...(license.companies !== undefined ? { companies: license.companies } : {})
    };
  } else if (trialActive) {
    // the first month: everything Qasa ERP does (Business), so every kind of company can try its own pages
    plan = 'business';
    source = 'trial';
    // every page, but up to as many company files as Pro: a month's trial is no way to keep many companies
    limits = { ...PLANS.business.limits, companies: PLANS.pro.limits.companies };
  }
  return { plan, source, licenseState: state, graceEnds, trialEnds, trialActive, limits: { ...limits }, features: [...PLANS[plan].features] };
}

/**
 * What a company does. It decides which industry pages show in the menu (chosen at the start, changed in Settings);
 * the plan still decides which of them can be used. 'trade' is the general accounting, sales, purchases and stock.
 */
export const BUSINESS_TYPES = ['trade', 'realEstate', 'mobileShop', 'autoParts', 'engineeringWorks', 'electricalSolar', 'generators', 'pharmacy'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** The plan feature each industry needs (general trade needs none). */
export const BUSINESS_FEATURE: Record<BusinessType, Feature | null> = {
  trade: null, realEstate: 'realEstate', mobileShop: 'mobileShop', autoParts: 'autoParts', engineeringWorks: 'engineeringWorks', electricalSolar: 'electricalSolar', generators: 'generators',
  pharmacy: 'pharmacy'
};

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === 'string' && (BUSINESS_TYPES as readonly string[]).includes(value);
}

/**
 * May one more company be made on this PC? `count` is how many it keeps now (the first one included).
 * null limit = unlimited (Business).
 */
export function canAddCompany(limits: Pick<PlanLimits, 'companies'>, count: number): boolean {
  return limits.companies === null || count < limits.companies;
}
