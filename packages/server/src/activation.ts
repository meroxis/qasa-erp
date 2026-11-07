import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { addDays, APP_VERSION, isIsoDate, todayIso, type LicenseInfo } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError } from './errors.ts';
import { deleteSetting, readSetting, writeSetting } from './settings.ts';
import { planStatus, readLicenseKey, verifyLicenseSignature, type PlanStatus } from './license.ts';
import type { ApiExtension } from './routes.ts';
import { loadNative } from './native-licence.ts';
// the company's invoice-signing key goes to the portal, so qasaerp.com/v can show who issued an invoice
import { companyVerifyKey } from './verify.ts';

/**
 * Online activation (my.qasaerp.com). A licence key is activated once on a PC, online: the portal keeps a seat for
 * that PC and answers with an activation token it signed ("QACT1.<payload>.<signature>") for that key on that PC.
 * The app keeps working offline on the token; every few days, when online, it checks in for a fresh one, and learns
 * when the seat was freed or the licence revoked (then it goes back to Free; the data never locks).
 *
 * Strict mode (the official Windows app turns it on with configureLicensing) asks for the token, seals the trial to
 * this PC and watches for the clock being turned back. Tests, the website demo and development builds run without it.
 *
 * What a PC is: a hash of Windows' MachineGuid, so one PC with two companies is one seat and a company file copied to
 * another PC needs activating there. Elsewhere (development) a hash of the company's install id.
 */

export interface LicensingConfig {
  /** Require activation, seal the trial, watch the clock. */
  strict: boolean;
  /**
   * Official builds: licences, activations and this PC's id must also pass the Rust module (native-licence.ts);
   * without it (removed or replaced) nothing paid counts.
   */
  requireNative?: boolean | undefined;
  /** The app's own data folder (outside the company file): keeps a trial marker per PC. */
  dataDir: string | null;
  portalUrl: string;
  /** For tests: the machine's own id instead of Windows' MachineGuid, and the clock. */
  machineGuid?: (() => string | null) | undefined;
  now?: (() => number) | undefined;
  fetch?: typeof fetch | undefined;
}

const DEFAULTS: LicensingConfig = { strict: false, dataDir: null, portalUrl: 'https://my.qasaerp.com' };
let config: LicensingConfig = { ...DEFAULTS };

/** The Windows app calls this at start (strict, its data folder); tests set a fake portal and clock. */
export function configureLicensing(patch: Partial<LicensingConfig>): void {
  config = { ...config, ...patch };
  cachedGuid = undefined;
}

export function resetLicensingForTests(): void {
  config = { ...DEFAULTS };
  cachedGuid = undefined;
  inFlight = null;
  lastAttempt = 0;
}

export const licensingConfig = (): Readonly<LicensingConfig> => config;
const nowMs = () => (config.now ? config.now() : Date.now());
const todayOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const licensingToday = (): string => (config.now ? todayOf(nowMs()) : todayIso());

/** Days a token keeps working after its check-by date while the PC has no internet. */
export const OFFLINE_GRACE_DAYS = 14;
/** Check in when the last check is older than this (and the PC is online). */
const CHECK_EVERY_MS = 3 * 86_400_000;
/** At most one background try an hour. */
const RETRY_MS = 3_600_000;
/** The clock may go back this much (time zone or a small correction) before it counts as turned back. */
const CLOCK_SLACK_MS = 86_400_000;

const TOKEN_SETTING = 'activation_token';
const CHECKED_SETTING = 'activation_checked';
const REVOKED_SETTING = 'activation_revoked';
const INSTALL_SETTING = 'install_id';
const CLOCK_SETTING = 'clock_high';
const TRIAL_SEAL_SETTING = 'trial_seal';
const TRIAL_MARKER = 'trial-used.json';

// ——— who this PC is ———

let cachedGuid: string | null | undefined;

function windowsMachineGuid(): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/.exec(out)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** A random id of this company's installation, kept in its settings (made on first use). */
export function installId(db: Db): string {
  let id = readSetting(db, INSTALL_SETTING);
  if (!id) {
    id = randomBytes(16).toString('hex');
    writeSetting(db, INSTALL_SETTING, id);
  }
  return id;
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * This PC, as the portal knows it: 32 hex characters, a hash (Windows' own id never leaves the PC). Kept in one
 * place so the Rust module can take it over later.
 */
export function machineId(db: Db): string {
  if (config.requireNative) {
    const native = loadNative();
    // the same value for every company on this PC (one seat), worked out in compiled code
    return native ? native.machineId('qasa-machine') : 'no-native-module';
  }
  if (cachedGuid === undefined) cachedGuid = config.machineGuid ? config.machineGuid() : windowsMachineGuid();
  return sha(cachedGuid ? `qasa-machine|${cachedGuid}` : `qasa-install|${installId(db)}`).slice(0, 32);
}

/** The short fingerprint of a key that a token names (the portal computes the same: LicenseKeys::keyHash). */
export const keyHash = (key: string): string => sha(key.replace(/\s+/g, '')).slice(0, 32);

// ——— tamper-evident values (a seal over what the company file holds) ———

function seal(db: Db, text: string): string {
  return createHmac('sha256', `qasa-seal|${installId(db)}|${machineId(db)}`).update(text).digest('base64url');
}

function sealOk(db: Db, text: string, mac: string): boolean {
  const want = Buffer.from(seal(db, text));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * Notes the latest time seen (sealed) and tells whether the clock was turned back since. A missing value starts the
 * watch; an altered one counts as turned back.
 */
function clockTurnedBack(db: Db, now: number): boolean {
  const stored = readSetting(db, CLOCK_SETTING);
  let high = 0;
  if (stored) {
    const [ms, mac] = stored.split('.');
    if (!ms || !mac || !sealOk(db, `clock|${ms}`, mac)) return true;
    high = Number(ms);
  }
  if (now + CLOCK_SLACK_MS < high) return true;
  if (now > high + 3_600_000) writeSetting(db, CLOCK_SETTING, `${now}.${seal(db, `clock|${now}`)}`);
  return false;
}

/** After a successful check-in the portal's date is the truth: the watch starts again from now. */
function resetClock(db: Db, now: number): void {
  writeSetting(db, CLOCK_SETTING, `${now}.${seal(db, `clock|${now}`)}`);
}

// ——— the activation token ———

const isoDate = z.string().refine(isIsoDate);
const tokenSchema = z.object({
  v: z.literal(1),
  lic: z.string().min(1).max(40),
  key: z.string().regex(/^[0-9a-f]{32}$/),
  machine: z.string().regex(/^[0-9a-f]{32}$/),
  plan: z.enum(['pro', 'business']),
  users: z.number().int().positive().optional(),
  companies: z.number().int().positive().optional(),
  expires: isoDate.nullable(),
  issued: isoDate,
  checkBy: isoDate
});
export type ActivationToken = z.infer<typeof tokenSchema>;
const TOKEN_PREFIX = 'QACT1';

/** Reads a token the portal signed (the same keys that sign licences). Null when anything is off. */
export function readActivationToken(text: string): ActivationToken | null {
  const parts = text.replace(/\s+/g, '').split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  try {
    if (!verifyLicenseSignature(`${parts[0]}.${parts[1]}`, parts[2]!)) return null;
    return tokenSchema.parse(JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}

export type ActivationState = 'none' | 'active' | 'needs_activation' | 'stale' | 'revoked' | 'clock';

export interface ActivationStatus {
  /** Strict mode: a licence counts only while active. */
  required: boolean;
  state: ActivationState;
  checkBy: string | null;
  /** The last day it keeps working without a check-in. */
  offlineUntil: string | null;
  lastChecked: string | null;
  revokedReason: string | null;
}

/** Where this PC stands with the stored licence key (no network: reads the stored token). */
export function activationStatus(db: Db, license: LicenseInfo | null, keyText: string | null): ActivationStatus {
  const required = config.strict;
  const lastChecked = readSetting(db, CHECKED_SETTING) ?? null;
  const base = { required, checkBy: null, offlineUntil: null, lastChecked, revokedReason: null };
  if (!license || !keyText) return { ...base, state: 'none' };
  const revoked = readSetting(db, REVOKED_SETTING);
  if (revoked) {
    const parsed = JSON.parse(revoked) as { key?: string; reason?: string };
    if (parsed.key === keyHash(keyText)) return { ...base, state: 'revoked', revokedReason: parsed.reason ?? 'revoked' };
  }
  const tokenText = readSetting(db, TOKEN_SETTING);
  const token = tokenText ? readActivationToken(tokenText) : null;
  if (!token || token.lic !== license.id || token.key !== keyHash(keyText) || token.machine !== machineId(db) || token.plan !== license.plan) {
    return { ...base, state: 'needs_activation' };
  }
  const offlineUntil = addDays(token.checkBy, OFFLINE_GRACE_DAYS);
  const info = { ...base, checkBy: token.checkBy, offlineUntil };
  if (required) {
    const now = nowMs();
    // a clock turned back, or one that is behind the day the portal issued the token
    if (clockTurnedBack(db, now) || licensingToday() < addDays(token.issued, -1)) return { ...info, state: 'clock' };
  }
  return { ...info, state: licensingToday() <= offlineUntil ? 'active' : 'stale' };
}

// ——— the trial, sealed to this PC ———

function markerFile(): string | null {
  return config.dataDir ? join(config.dataDir, TRIAL_MARKER) : null;
}

function markerHas(db: Db): string | null {
  const file = markerFile();
  if (!file || !existsSync(file)) return null;
  try {
    const list = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
    return list[machineId(db)] ?? null;
  } catch {
    return null;
  }
}

/** Records the trial: sealed in the company file, and in a small file of the app's own (outside it) for this PC. */
export function sealTrial(db: Db, started: string): void {
  writeSetting(db, TRIAL_SEAL_SETTING, seal(db, `trial|${started}`));
  const file = markerFile();
  if (!file) return;
  let list: Record<string, string> = {};
  try {
    if (existsSync(file)) list = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  } catch { /* a damaged marker is rewritten */ }
  list[machineId(db)] ??= started;
  mkdirSync(config.dataDir!, { recursive: true });
  writeFileSync(file, JSON.stringify(list));
}

/** May this PC start the free trial? Not twice, even after the company file's settings were reset (strict mode). */
export function trialUsedOnThisPc(db: Db): boolean {
  return config.strict && markerHas(db) !== null;
}

/**
 * The trial start the plan may count: in strict mode only a sealed one, never moved by a turned-back clock, and the
 * PC's own record wins over an edited company file. Returns '2000-01-01' (long ended) when tampered with.
 */
export function trustedTrialStart(db: Db, stored: string | null): string | null {
  if (!config.strict) return stored;
  const marker = markerHas(db);
  if (!stored) return marker;
  const mac = readSetting(db, TRIAL_SEAL_SETTING);
  // a trial started before sealing existed is taken over once (sealed, and recorded for this PC)
  if (!mac && !marker) {
    sealTrial(db, stored);
    return stored;
  }
  if (!mac || !sealOk(db, `trial|${stored}`, mac)) return marker ?? '2000-01-01';
  if (marker && marker < stored) return marker;
  if (clockTurnedBack(db, nowMs())) return '2000-01-01';
  return stored;
}

// ——— talking to the portal ———

async function call(path: string, body: object): Promise<{ status: number; data: Record<string, unknown> }> {
  const doFetch = config.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(config.portalUrl.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new AppError(503, 'activation_offline');
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch { /* not JSON: handled as a refusal below */ }
  return { status: res.status, data };
}

const PORTAL_ERRORS = new Set(['key_invalid', 'unknown_licence', 'revoked', 'expired', 'seats_full', 'rate_limited']);

/** Activates the stored key on this PC (needs the internet once). */
export async function activateOnline(db: Db, user: string): Promise<PlanStatus> {
  const keyText = readSetting(db, 'license_key');
  const license = keyText ? readLicenseKey(keyText) : null;
  if (!keyText || !license) throw new AppError(400, 'license_invalid');
  const { status, data } = await call('/api/v1/activate', { verifyKey: companyVerifyKey(db),
    key: keyText, machine: machineId(db), label: hostname().slice(0, 60), appVersion: APP_VERSION
  });
  const token = typeof data.token === 'string' ? data.token : null;
  if (status !== 200 || !token || !readActivationToken(token)) {
    const code = typeof data.error === 'string' && PORTAL_ERRORS.has(data.error) ? data.error : 'failed';
    throw new AppError(status === 409 ? 409 : status === 429 ? 429 : 400, `activation_${code}`,
      code === 'seats_full' ? { used: data.used ?? null, max: data.max ?? null } : null);
  }
  transaction(db, () => {
    writeSetting(db, TOKEN_SETTING, token);
    writeSetting(db, CHECKED_SETTING, new Date(nowMs()).toISOString());
    deleteSetting(db, REVOKED_SETTING);
    resetClock(db, nowMs());
    audit(db, user, 'activate', 'license', license.id, { online: true, machine: machineId(db).slice(0, 8) });
  });
  return planStatus(db);
}

/** Checks in now. Takes a renewed key the portal sends along; learns of a freed seat or a revoked licence. */
export async function checkOnline(db: Db, user = 'Qasa ERP'): Promise<PlanStatus> {
  const tokenText = readSetting(db, TOKEN_SETTING);
  const keyText = readSetting(db, 'license_key');
  if (!tokenText || !keyText) return planStatus(db);
  const { status, data } = await call('/api/v1/check', { token: tokenText, appVersion: APP_VERSION, verifyKey: companyVerifyKey(db) });
  const checked = new Date(nowMs()).toISOString();
  if (data.revoked === true) {
    const reason = typeof data.reason === 'string' ? data.reason : 'revoked';
    transaction(db, () => {
      writeSetting(db, REVOKED_SETTING, JSON.stringify({ key: keyHash(keyText), reason, at: checked }));
      deleteSetting(db, TOKEN_SETTING);
      writeSetting(db, CHECKED_SETTING, checked);
      audit(db, user, 'revoked', 'license', readLicenseKey(keyText)?.id ?? null, { reason });
    });
    return planStatus(db);
  }
  const token = typeof data.token === 'string' ? readActivationToken(data.token) : null;
  if (status !== 200 || !token) {
    // a token the portal no longer accepts: activate again (needs the internet, which we have)
    if (data.error === 'token_invalid') deleteSetting(db, TOKEN_SETTING);
    return planStatus(db);
  }
  const newKey = typeof data.key === 'string' && readLicenseKey(data.key) ? data.key.replace(/\s+/g, '') : null;
  transaction(db, () => {
    if (newKey && newKey !== keyText) {
      writeSetting(db, 'license_key', newKey);
      audit(db, user, 'renew', 'license', token.lic, { expires: token.expires });
    }
    writeSetting(db, TOKEN_SETTING, data.token as string);
    writeSetting(db, CHECKED_SETTING, checked);
    deleteSetting(db, REVOKED_SETTING);
    resetClock(db, nowMs());
  });
  return planStatus(db);
}

/** Gives this PC's seat back (moving to another PC) and takes the licence off. The data stays. */
export async function deactivateOnline(db: Db, user: string): Promise<void> {
  const tokenText = readSetting(db, TOKEN_SETTING);
  if (tokenText) {
    const { status } = await call('/api/v1/deactivate', { token: tokenText });
    if (status !== 200) throw new AppError(400, 'activation_failed');
  }
  transaction(db, () => {
    deleteSetting(db, TOKEN_SETTING);
    deleteSetting(db, CHECKED_SETTING);
    audit(db, user, 'deactivate', 'license', null, { machine: machineId(db).slice(0, 8) });
  });
}

let inFlight: Promise<unknown> | null = null;
let lastAttempt = 0;

/**
 * Called while reading the plan (strict mode): checks in in the background when it's time. Never waits, never
 * throws; the next reading of the plan shows the answer.
 */
export function maybeCheckInBackground(db: Db, status: ActivationStatus): void {
  if (!config.strict || inFlight || !['active', 'stale', 'clock'].includes(status.state)) return;
  const now = nowMs();
  if (now - lastAttempt < RETRY_MS) return;
  const last = status.lastChecked ? Date.parse(status.lastChecked) : 0;
  if (status.state === 'active' && now - last < CHECK_EVERY_MS) return;
  lastAttempt = now;
  inFlight = checkOnline(db).catch(() => undefined).finally(() => { inFlight = null; });
}

/** For tests: wait for a background check-in. */
export async function settleBackgroundCheck(): Promise<void> {
  await inFlight;
}

/** The routes: activate on this PC, check in now, give the seat back (admins only, like the licence itself). */
export const activationApi: ApiExtension = {
  routes(db, { actorOf }) {
    return [
      { method: 'POST', path: '/api/plan/activate', handler: async (req) => activateOnline(db, actorOf(req).name) },
      { method: 'POST', path: '/api/plan/check', handler: async (req) => checkOnline(db, actorOf(req).name) },
      {
        method: 'POST', path: '/api/plan/deactivate',
        handler: async (req) => {
          const name = actorOf(req).name;
          await deactivateOnline(db, name);
          transaction(db, () => {
            deleteSetting(db, 'license_key');
            audit(db, name, 'remove', 'license', null);
          });
          return planStatus(db);
        }
      }
    ];
  }
};
