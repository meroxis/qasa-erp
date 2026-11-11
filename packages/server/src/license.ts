import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import {
  GROWTH_NUDGE_INVOICES, isIsoDate, licenseState, PAID_PLAN_IDS, resolvePlan, trialEndsOn,
  type LicenseInfo, type LicenseState, type LimitName, type PlanResolution
} from '@qasa/core';
import type { Db } from './db.ts';
import { loadNative } from './native-licence.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict } from './errors.ts';
import { deleteSetting, readSetting, writeSetting } from './settings.ts';
import {
  activationStatus, deactivateOnline, licensingConfig, licensingToday, maybeCheckInBackground, noteFirstStart, sealTrial, trialUsedOnThisPc, trustedTrialStart,
  type ActivationStatus
} from './activation.ts';

/**
 * The public keys Meroxis signs licenses with (Ed25519, base64url). Keys are signed with the private halves,
 * which never leave Meroxis; the app can only check them. A key works offline, on any PC of the licensed company.
 */
const LICENSE_PUBLIC_KEYS: readonly string[] = [
  // Meroxis' offline key (licensing/issue.mjs)
  'fEaDX9tiI7598uVB-udxo5b0FfwGjBC0W9l0QlURoe0',
  // the customer portal, my.qasaerp.com (its private half never leaves that server)
  '2La4PsoYPOuS5wrVsEWrFLSDmi0q5xG5LZkJFwFycus'
];
/** "QASA1.<payload>.<signature>"; the version tag is part of the signed text. */
const PREFIX = 'QASA1';

// For now the license is kept with the company's data (one company per installation).
const LICENSE_SETTING = 'license_key';
const TRIAL_SETTING = 'trial_started';

const isoDate = z.string().refine(isIsoDate);
const payloadSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1).max(40),
  plan: z.enum(PAID_PLAN_IDS),
  to: z.string().min(1).max(120),
  users: z.number().int().positive().optional(),
  companies: z.number().int().positive().optional(),
  issued: isoDate,
  expires: isoDate.nullable()
});

let publicKeys: KeyObject[] | undefined;
let lastChecked: { text: string; info: LicenseInfo | null } | undefined;

const toKey = (x: string): KeyObject => createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });

/** The tests sign keys with key pairs of their own. */
export function setLicensePublicKeyForTests(...x: string[]): void {
  publicKeys = x.map(toKey);
  lastChecked = undefined;
}

/** True when one of Meroxis' keys signed `body` (licence keys, and the portal's activation tokens). */
export function verifyLicenseSignature(body: string, signatureB64url: string): boolean {
  publicKeys ??= LICENSE_PUBLIC_KEYS.map(toKey);
  const signature = Buffer.from(signatureB64url, 'base64url');
  if (!publicKeys.some((publicKey) => verify(null, Buffer.from(body), publicKey, signature))) return false;
  return nativeAgrees(body, signatureB64url);
}

/** Official builds check every signature a second time in the Rust module; a build without it counts nothing paid. */
function nativeAgrees(body: string, signatureB64url: string): boolean {
  if (!licensingConfig().requireNative) return true;
  const native = loadNative();
  if (!native) return false;
  return native.publicKeys().some((key) => native.verifyEd25519(key, Buffer.from(body), signatureB64url))
    || native.activationKeys().some((key) => native.verifyEd25519(key, Buffer.from(body), signatureB64url));
}

/** Reads a license key (spaces and line breaks from chat apps are ignored). Returns null unless Meroxis signed it. */
export function readLicenseKey(text: string): LicenseInfo | null {
  const key = text.replace(/\s+/g, '');
  if (lastChecked?.text === key) return lastChecked.info;
  let info: LicenseInfo | null = null;
  const parts = key.split('.');
  if (parts.length === 3 && parts[0] === PREFIX) {
    try {
      publicKeys ??= LICENSE_PUBLIC_KEYS.map(toKey);
      const body = Buffer.from(`${parts[0]}.${parts[1]}`);
      const signature = Buffer.from(parts[2]!, 'base64url');
      if (publicKeys.some((publicKey) => verify(null, body, publicKey, signature)) && nativeAgrees(body.toString(), parts[2]!)) {
        const p = payloadSchema.parse(JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')));
        info = {
          id: p.id, plan: p.plan, licensee: p.to, issued: p.issued, expires: p.expires,
          ...(p.users !== undefined ? { users: p.users } : {}),
          ...(p.companies !== undefined ? { companies: p.companies } : {})
        };
      }
    } catch {
      info = null;
    }
  }
  lastChecked = { text: key, info };
  return info;
}

export interface PlanStatus extends PlanResolution {
  /** The activated license, also after it ended (so the app can say so). */
  license: (LicenseInfo & { state: LicenseState }) | null;
  trialAvailable: boolean;
  trialStarted: string | null;
  usage: { warehouses: number; salesThisMonth: number };
  /** A Free company that has grown past what Free is meant for: show a friendly note, never block. */
  nudge: boolean;
  /** Online activation of the licence on this PC (needed in the official app before the licence counts). */
  activation: ActivationStatus;
}

function storedLicense(db: Db): LicenseInfo | null {
  const text = readSetting(db, LICENSE_SETTING);
  return text ? readLicenseKey(text) : null;
}

function count(db: Db, sql: string, ...params: string[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

export function planStatus(db: Db, today: string = licensingToday()): PlanStatus {
  // the first start in a version that asks for activation decides whether a stored key is a 0.1.8 one (strict mode)
  noteFirstStart(db);
  const license = storedLicense(db);
  const activation = activationStatus(db, license, readSetting(db, LICENSE_SETTING) ?? null);
  // in the official app a licence counts only once activated on this PC (and checked in now and then), or for its
  // first 30 days in this version when it came from 0.1.8 (before activation existed) while the app activates it
  const counts = !activation.required || activation.state === 'active' || activation.inGrace;
  const trialStarted = trustedTrialStart(db, readSetting(db, TRIAL_SETTING) ?? null);
  const resolved = resolvePlan({ license: counts ? license : null, trialStarted, today });
  if (licensingConfig().strict) maybeCheckInBackground(db, activation);
  const salesThisMonth = count(db, "SELECT COUNT(*) AS n FROM invoices WHERE kind = 'sale' AND status = 'posted' AND date LIKE ?", today.slice(0, 7) + '-%');
  return {
    ...resolved,
    license: license ? { ...license, state: licenseState(license, today) } : null,
    trialAvailable: !trialStarted && !license && !trialUsedOnThisPc(db),
    trialStarted,
    usage: { warehouses: count(db, 'SELECT COUNT(*) AS n FROM warehouses'), salesThisMonth },
    nudge: resolved.plan === 'free' && salesThisMonth >= GROWTH_NUDGE_INVOICES,
    activation
  };
}

/** Throws "plan_limit" when adding one more would go over the current plan. Existing records always keep working. */
export function assertWithinLimit(db: Db, limit: LimitName, current: number): void {
  const status = planStatus(db);
  const max = status.limits[limit];
  if (max !== null && current >= max) throw conflict('plan_limit', { limit, max, plan: status.plan });
}

export function activateLicense(db: Db, text: string, user: string, today: string = licensingToday()): PlanStatus {
  const info = readLicenseKey(text);
  if (!info) throw new AppError(400, 'license_invalid');
  if (licenseState(info, today) === 'expired') throw conflict('license_expired', { expires: info.expires });
  // recorded before the key is stored, so a key entered in this version never gets the 0.1.8 grace
  noteFirstStart(db);
  transaction(db, () => {
    writeSetting(db, LICENSE_SETTING, text.replace(/\s+/g, ''));
    audit(db, user, 'activate', 'license', info.id, { plan: info.plan, licensee: info.licensee, expires: info.expires });
  });
  return planStatus(db, today);
}

/**
 * Takes the license off this installation (for example to move it to a new PC). The data stays as it is. Gives this
 * PC's seat back to the portal first, so the key can be activated on the new PC; offline (or refused) the seat stays
 * taken until it is freed at my.qasaerp.com, and the licence is still removed here.
 */
export async function removeLicense(db: Db, user: string): Promise<PlanStatus> {
  if (readSetting(db, 'activation_token')) {
    try {
      await deactivateOnline(db, user);
    } catch { /* offline: the customer frees the seat in the portal */ }
  }
  const info = storedLicense(db);
  transaction(db, () => {
    deleteSetting(db, LICENSE_SETTING);
    deleteSetting(db, 'activation_token');
    audit(db, user, 'remove', 'license', info?.id ?? null);
  });
  return planStatus(db);
}

/** Starts the free Pro trial: once per company, and not after a license was activated. */
export function startTrial(db: Db, user: string, today: string = licensingToday()): PlanStatus {
  // once per company, and (in the official app) once per PC, also after the company file's settings were reset
  if (readSetting(db, TRIAL_SETTING) || readSetting(db, LICENSE_SETTING) || trialUsedOnThisPc(db)) throw conflict('trial_unavailable');
  transaction(db, () => {
    writeSetting(db, TRIAL_SETTING, today);
    sealTrial(db, today);
    audit(db, user, 'start', 'trial', null, { ends: trialEndsOn(today) });
  });
  return planStatus(db, today);
}
