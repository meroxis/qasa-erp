import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import {
  GROWTH_NUDGE_INVOICES, isIsoDate, licenseState, resolvePlan, todayIso, trialEndsOn,
  type LicenseInfo, type LicenseState, type LimitName, type PlanResolution
} from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict } from './errors.ts';
import { deleteSetting, readSetting, writeSetting } from './settings.ts';

/**
 * Meroxis' license-signing public key (Ed25519, base64url). Keys are signed with the private half, which
 * never leaves Meroxis; the app can only check them. A key works offline, on any PC of the licensed company.
 */
const LICENSE_PUBLIC_KEY = 'fEaDX9tiI7598uVB-udxo5b0FfwGjBC0W9l0QlURoe0';
/** "QASA1.<payload>.<signature>"; the version tag is part of the signed text. */
const PREFIX = 'QASA1';

// For now the license is kept with the company's data (one company per installation).
const LICENSE_SETTING = 'license_key';
const TRIAL_SETTING = 'trial_started';

const isoDate = z.string().refine(isIsoDate);
const payloadSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1).max(40),
  plan: z.enum(['pro', 'business']),
  to: z.string().min(1).max(120),
  users: z.number().int().positive().optional(),
  companies: z.number().int().positive().optional(),
  issued: isoDate,
  expires: isoDate.nullable()
});

let publicKey: KeyObject | undefined;
let lastChecked: { text: string; info: LicenseInfo | null } | undefined;

/** The tests sign keys with a key pair of their own. */
export function setLicensePublicKeyForTests(x: string): void {
  publicKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
  lastChecked = undefined;
}

/** Reads a license key (spaces and line breaks from chat apps are ignored). Returns null unless Meroxis signed it. */
export function readLicenseKey(text: string): LicenseInfo | null {
  const key = text.replace(/\s+/g, '');
  if (lastChecked?.text === key) return lastChecked.info;
  let info: LicenseInfo | null = null;
  const parts = key.split('.');
  if (parts.length === 3 && parts[0] === PREFIX) {
    try {
      publicKey ??= createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: LICENSE_PUBLIC_KEY }, format: 'jwk' });
      if (verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2]!, 'base64url'))) {
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
}

function storedLicense(db: Db): LicenseInfo | null {
  const text = readSetting(db, LICENSE_SETTING);
  return text ? readLicenseKey(text) : null;
}

function count(db: Db, sql: string, ...params: string[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

export function planStatus(db: Db, today: string = todayIso()): PlanStatus {
  const license = storedLicense(db);
  const trialStarted = readSetting(db, TRIAL_SETTING) ?? null;
  const resolved = resolvePlan({ license, trialStarted, today });
  const salesThisMonth = count(db, "SELECT COUNT(*) AS n FROM invoices WHERE kind = 'sale' AND status = 'posted' AND date LIKE ?", today.slice(0, 7) + '-%');
  return {
    ...resolved,
    license: license ? { ...license, state: licenseState(license, today) } : null,
    trialAvailable: !trialStarted && !license,
    trialStarted,
    usage: { warehouses: count(db, 'SELECT COUNT(*) AS n FROM warehouses'), salesThisMonth },
    nudge: resolved.plan === 'free' && salesThisMonth >= GROWTH_NUDGE_INVOICES
  };
}

/** Throws "plan_limit" when adding one more would go over the current plan. Existing records always keep working. */
export function assertWithinLimit(db: Db, limit: LimitName, current: number): void {
  const status = planStatus(db);
  const max = status.limits[limit];
  if (max !== null && current >= max) throw conflict('plan_limit', { limit, max, plan: status.plan });
}

export function activateLicense(db: Db, text: string, user: string, today: string = todayIso()): PlanStatus {
  const info = readLicenseKey(text);
  if (!info) throw new AppError(400, 'license_invalid');
  if (licenseState(info, today) === 'expired') throw conflict('license_expired', { expires: info.expires });
  transaction(db, () => {
    writeSetting(db, LICENSE_SETTING, text.replace(/\s+/g, ''));
    audit(db, user, 'activate', 'license', info.id, { plan: info.plan, licensee: info.licensee, expires: info.expires });
  });
  return planStatus(db, today);
}

/** Takes the license off this installation (for example to move it to a new PC). The data stays as it is. */
export function removeLicense(db: Db, user: string): PlanStatus {
  const info = storedLicense(db);
  transaction(db, () => {
    deleteSetting(db, LICENSE_SETTING);
    audit(db, user, 'remove', 'license', info?.id ?? null);
  });
  return planStatus(db);
}

/** Starts the free Pro trial: once per company, and not after a license was activated. */
export function startTrial(db: Db, user: string, today: string = todayIso()): PlanStatus {
  if (readSetting(db, TRIAL_SETTING) || readSetting(db, LICENSE_SETTING)) throw conflict('trial_unavailable');
  transaction(db, () => {
    writeSetting(db, TRIAL_SETTING, today);
    audit(db, user, 'start', 'trial', null, { ends: trialEndsOn(today) });
  });
  return planStatus(db, today);
}
