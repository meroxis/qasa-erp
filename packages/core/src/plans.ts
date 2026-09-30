import { addDays } from './dates.ts';

/**
 * Qasa ERP plans. Free is a complete product for a small business on one PC; Pro and Business add what a
 * growing company needs (a team, more warehouses, payroll …). A plan never locks anyone out of their data:
 * when a license ends, the company keeps everything it entered and continues on the Free features.
 */
export type PlanId = 'free' | 'pro' | 'business';

export const PLAN_IDS: readonly PlanId[] = ['free', 'pro', 'business'];

/** Features that only some plans include. */
export type Feature =
  | 'officeNetwork' // several users on the office network
  | 'roles' // separate sign-ins for the preparer, checker and approver
  | 'installments'
  | 'payroll'
  | 'finalAccountsExport' // print and Excel of the final accounts, year-end closing
  | 'noBranding' // invoices without "Made with Qasa ERP"
  | 'cloudBackup'
  | 'onlineEdition'
  | 'branches'
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

const PRO_FEATURES: readonly Feature[] = ['officeNetwork', 'roles', 'installments', 'payroll', 'finalAccountsExport', 'noBranding', 'cloudBackup'];

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: { id: 'free', limits: { companies: 1, users: 1, warehouses: 1 }, features: [] },
  pro: { id: 'pro', limits: { companies: 3, users: 5, warehouses: null }, features: PRO_FEATURES },
  business: { id: 'business', limits: { companies: null, users: null, warehouses: null }, features: [...PRO_FEATURES, 'onlineEdition', 'branches', 'databaseServer'] }
};

/** Length of the free Pro trial, once per company. */
export const TRIAL_DAYS = 30;
/** Days after a license's last day during which it keeps working (with a reminder), to allow for renewal. */
export const GRACE_DAYS = 14;
/** A Free company posting this many sales invoices in a month sees a friendly note about Pro. It never blocks anything. */
export const GROWTH_NUDGE_INVOICES = 300;

/** What a license key says. Meroxis signs it with Ed25519; the app only holds the public key. */
export interface LicenseInfo {
  /** e.g. "QL-2026-0001" */
  id: string;
  plan: Exclude<PlanId, 'free'>;
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
    plan = 'pro';
    source = 'trial';
    limits = PLANS.pro.limits;
  }
  return { plan, source, licenseState: state, graceEnds, trialEnds, trialActive, limits: { ...limits }, features: [...PLANS[plan].features] };
}
