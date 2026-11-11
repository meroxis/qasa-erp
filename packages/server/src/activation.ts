import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
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
  /**
   * More folders that keep the same marker (the Windows app: %LOCALAPPDATA%\Qasa ERP). Every copy is read and a
   * missing one is written again from the others, so deleting one copy never frees the trial. Every copy is a file of
   * the Windows user's own, so this only slows a reset down: deleting all of them (with the company file's trial
   * settings, or with a new company file) does start another month. Only a record the portal keeps for the PC would
   * make the trial once per PC for certain.
   */
  markerDirs?: readonly string[] | undefined;
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

/**
 * A seal over `text` with `keyMaterial`. Official builds (requireNative) seal in the Rust module, elsewhere an HMAC.
 * Either way the key comes from this PC (its Windows machine id) and the company file, which the PC's own user can
 * read: a seal shows that a value was edited by hand, it is no secret from that user. What must hold against them
 * is signed by the portal (licence keys, activation tokens, the portal's time).
 */
function sealWith(keyMaterial: string, text: string): string {
  if (config.requireNative) {
    const native = loadNative();
    return native ? native.seal(text, keyMaterial) : '';
  }
  return createHmac('sha256', keyMaterial).update(text).digest('base64url');
}

function sealWithOk(keyMaterial: string, text: string, mac: string): boolean {
  if (!mac) return false;
  if (config.requireNative) {
    const native = loadNative();
    return !!native && native.open(mac, keyMaterial) === text;
  }
  const want = Buffer.from(sealWith(keyMaterial, text));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

const companyKey = (db: Db) => `qasa-seal|${installId(db)}|${machineId(db)}`;
const seal = (db: Db, text: string): string => sealWith(companyKey(db), text);
const sealOk = (db: Db, text: string, mac: string): boolean => sealWithOk(companyKey(db), text, mac);

/** "<value>.<seal>": the value never holds a dot, the seal may (the Rust module's does). */
function splitSealed(stored: string): [string, string] | null {
  const dot = stored.indexOf('.');
  return dot > 0 ? [stored.slice(0, dot), stored.slice(dot + 1)] : null;
}

/**
 * Notes the latest time seen (sealed) and tells whether the clock was turned back since. A missing value starts the
 * watch; an altered one counts as turned back.
 */
function clockTurnedBack(db: Db, now: number): boolean {
  const stored = readSetting(db, CLOCK_SETTING);
  let high = 0;
  if (stored) {
    const [ms, mac] = splitSealed(stored) ?? ['', ''];
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

// ——— the first start of a version that asks for activation (1.0) ———

/** Days a licence entered before activation existed (0.1.8, no token) keeps counting while it is being activated. */
export const ACTIVATION_GRACE_DAYS = 30;
/**
 * Only keys issued before activation existed (1.0.0 came out on 2026-11-08: every key since is activated online)
 * are 0.1.8 keys, and that grace ends for good: no company starts one after LEGACY_GRACE_LAST_START. Otherwise a key
 * someone removed the record of could start a new grace again and again, without a seat and past a revocation.
 */
export const LEGACY_KEYS_ISSUED_BEFORE = '2026-11-08';
export const LEGACY_GRACE_LAST_START = '2027-01-31';
/**
 * "<date>|<key hash or ->.<seal>": the day this company first ran in strict mode, and the licence key it held then if
 * that key had never been activated (a 0.1.8 key). Written once; an edited value counts as nothing.
 */
const FIRST_START_SETTING = 'activation_grace_from';

/** The first strict start of this company (recorded now if missing). Null when the record was edited. */
function firstStart(db: Db): { date: string; key: string } | null {
  const stored = readSetting(db, FIRST_START_SETTING);
  if (!stored) {
    const date = licensingToday();
    const keyText = readSetting(db, 'license_key');
    const neverActivated = !readSetting(db, TOKEN_SETTING) && !readSetting(db, CHECKED_SETTING) && !readSetting(db, REVOKED_SETTING);
    const license = keyText && neverActivated ? readLicenseKey(keyText) : null;
    const legacy = !!license && license.issued < LEGACY_KEYS_ISSUED_BEFORE && date <= LEGACY_GRACE_LAST_START;
    const key = keyText && legacy ? keyHash(keyText) : '-';
    const value = `${date}|${key}`;
    writeSetting(db, FIRST_START_SETTING, `${value}.${seal(db, `grace|${value}`)}`);
    // the watch on the clock starts with the record: from now on a missing latest time means one removed by hand
    if (!readSetting(db, CLOCK_SETTING)) resetClock(db, nowMs());
    return { date, key };
  }
  const parts = splitSealed(stored);
  if (!parts || !sealOk(db, `grace|${parts[0]}`, parts[1])) return null;
  const [date, key, ...rest] = parts[0].split('|');
  if (!date || !isIsoDate(date) || !key || rest.length) return null;
  return { date, key };
}

/**
 * Notes the first start (strict mode only). Called before anything can store a new key or trial, so a key entered in
 * this version never passes for a 0.1.8 one and an unsealed trial written after this day is not taken over.
 */
export function noteFirstStart(db: Db): void {
  if (config.strict) firstStart(db);
}

/**
 * Companies → Add, and opening a company that holds no licence yet, hand the open company's licence key to the other
 * company file (the licence belongs to the PC). Call this on that file (`to`) before the key is written into it.
 * A key without an activation token passes for a 0.1.8 one only where a company's own first start found it: unless the
 * open company (`from`) holds such a key with its grace, the other company's first start is noted now, before the key
 * is there, so a carried key never starts a grace of its own (a key entered in this version and never activated, with
 * its seats full or leaked, stays on Free in every company). A carried 0.1.8 key shares the PC's grace (graceMarker):
 * the same days, never new ones.
 */
export function noteFirstStartBeforeCarry(from: Db, to: Db): void {
  if (!config.strict) return;
  const keyText = readSetting(from, 'license_key');
  const license = keyText && !readSetting(from, TOKEN_SETTING) ? readLicenseKey(keyText) : null;
  if (license && keyText && activationStatus(from, license, keyText).graceUntil !== null) return;
  firstStart(to);
}

/**
 * The last day a 0.1.8 key (held at the first start, never activated) counts without an activation token, or null
 * when the key has no such grace.
 */
function graceUntil(db: Db, keyText: string): string | null {
  if (!config.strict || readSetting(db, TOKEN_SETTING)) return null;
  const first = firstStart(db);
  if (!first || first.key !== keyHash(keyText) || first.date > LEGACY_GRACE_LAST_START) return null;
  const license = readLicenseKey(keyText);
  if (!license || license.issued >= LEGACY_KEYS_ISSUED_BEFORE) return null;
  const start = graceMarker(db, first.date, first.key);
  return start ? addDays(start, ACTIVATION_GRACE_DAYS - 1) : null;
}

/**
 * The PC's own record of the grace (in the trial marker file, sealed): one grace per PC, so a company made
 * later on this PC (it takes the key over) shares the first one's days instead of starting new ones. Returns the start
 * that counts, null when the record was edited.
 */
function graceMarker(db: Db, date: string, key: string): string | null {
  if (!markerFiles().length) return date;
  const id = `grace|${machineId(db)}`;
  const marked = markerEntry(db, id, 'grace');
  if (marked === 'none') {
    const value = `${date}|${key}`;
    // the app's folder can't be written: the company's own sealed record still limits the grace
    writeMarkerEntry(id, `${value}.${sealWith(markerKey(db), `grace|${value}`)}`, false);
    return date;
  }
  if (marked === 'bad') return null;
  const [markedDate] = marked.split('|');
  if (!markedDate || !isIsoDate(markedDate)) return null;
  // one grace per PC: another key held here later shares its days (else switching keys would start new ones)
  return markedDate < date ? markedDate : date;
}

/** How far this PC's clock may be from the portal's and still count as agreeing with it. */
const CLOCK_AGREES_MS = 3_600_000;

const SIGNED_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
/** The random value a ping sends for the portal to sign its time with: 16 bytes, 32 lowercase hex characters. */
const TIME_NONCE = /^[0-9a-f]{32}$/;

/** A fresh nonce for one ping (usage.ts): the portal's signed time is good for that request only. */
export const newTimeNonce = (): string => randomBytes(16).toString('hex');

/**
 * The time in a portal answer, only when the portal signed it for this request: header X-Qasa-Time
 * "<ISO time>.<signature>", the signature (Ed25519, base64url) over "time|<ISO time>|<nonce>" with the key that signs
 * licences and activation tokens, where nonce is the one this PC sent with the request. A separate
 * X-Qasa-Time-Signature header is read too. Anything unsigned, wrongly signed or signed for another nonce (an answer
 * recorded earlier and played back) gives null.
 */
export function signedPortalTime(header: string | null | undefined, nonce: string, signatureHeader?: string | null): number | null {
  if (!header || !TIME_NONCE.test(nonce)) return null;
  let time = header.trim();
  let signature = signatureHeader?.trim() ?? '';
  if (!signature) {
    const dot = time.lastIndexOf('.');
    if (dot < 0) return null;
    signature = time.slice(dot + 1);
    time = time.slice(0, dot);
  }
  if (!SIGNED_TIME.test(time) || !SIGNATURE.test(signature)) return null;
  try {
    if (!verifyLicenseSignature(`time|${time}|${nonce}`, signature)) return null;
  } catch {
    return null;
  }
  const ms = Date.parse(time);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The portal's time, signed by the portal (X-Qasa-Time on the usage ping's answer; see signedPortalTime). A plain
 * Date header is never trusted: a fake local "portal" could send any date. When this PC's clock agrees with the
 * signed time and the latest time seen is ahead of both, the clock was set wrong (ahead) for a moment and has been put
 * right; without this, a trial would stay ended until the real date caught up. The latest time seen starts again from
 * now. Only while no activation is held: a licence's check-in already does this with a signed token. `nonce` is the
 * one the ping sent (newTimeNonce), so only the portal's answer to that ping counts.
 * Returns true when it corrected something.
 */
export function trustPortalDate(db: Db, timeHeader: string | null | undefined, nonce: string, signatureHeader?: string | null): boolean {
  if (!config.strict || !timeHeader || readSetting(db, TOKEN_SETTING)) return false;
  const portal = signedPortalTime(timeHeader, nonce, signatureHeader);
  if (portal === null) return false;
  const now = nowMs();
  if (Math.abs(now - portal) > CLOCK_AGREES_MS) return false;
  const stored = readSetting(db, CLOCK_SETTING);
  const [ms, mac] = (stored && splitSealed(stored)) || ['', ''];
  // an edited value stays as it is (it says the file was tampered with); only a sealed one ahead of now is corrected
  if (!ms || !sealOk(db, `clock|${ms}`, mac) || Number(ms) <= now + CLOCK_SLACK_MS) return false;
  resetClock(db, now);
  return true;
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
  /**
   * A licence key from 0.1.8 (held before activation existed, never activated): the last day it counts while the app
   * activates it online by itself. Null for any other key.
   */
  graceUntil: string | null;
  /** The licence counts now under that grace (state is still 'needs_activation'). */
  inGrace: boolean;
}

/** Where this PC stands with the stored licence key (no network: reads the stored token). */
export function activationStatus(db: Db, license: LicenseInfo | null, keyText: string | null): ActivationStatus {
  const required = config.strict;
  const lastChecked = readSetting(db, CHECKED_SETTING) ?? null;
  const base = { required, checkBy: null, offlineUntil: null, lastChecked, revokedReason: null, graceUntil: null, inGrace: false };
  if (!license || !keyText) return { ...base, state: 'none' };
  const revoked = readSetting(db, REVOKED_SETTING);
  if (revoked) {
    const parsed = JSON.parse(revoked) as { key?: string; reason?: string };
    if (parsed.key === keyHash(keyText)) return { ...base, state: 'revoked', revokedReason: parsed.reason ?? 'revoked' };
  }
  const tokenText = readSetting(db, TOKEN_SETTING);
  const token = tokenText ? readActivationToken(tokenText) : null;
  if (!token || token.lic !== license.id || token.key !== keyHash(keyText) || token.machine !== machineId(db) || token.plan !== license.plan) {
    const until = graceUntil(db, keyText);
    // the grace runs from a sealed date; a clock turned back does not stretch it
    const turnedBack = until !== null && (!readSetting(db, CLOCK_SETTING) || clockTurnedBack(db, nowMs()));
    const inGrace = until !== null && !turnedBack && licensingToday() <= until;
    return { ...base, state: 'needs_activation', graceUntil: until, inGrace };
  }
  const offlineUntil = addDays(token.checkBy, OFFLINE_GRACE_DAYS);
  const info = { ...base, checkBy: token.checkBy, offlineUntil };
  if (required) {
    const now = nowMs();
    // a clock turned back, or one that is behind the day the portal issued the token. A stored token always has the
    // latest time seen next to it (activating, checking in and carrying the licence to another company all write it):
    // gone means removed to hide a clock turned back
    if (!readSetting(db, CLOCK_SETTING) || clockTurnedBack(db, now) || licensingToday() < addDays(token.issued, -1)) return { ...info, state: 'clock' };
  }
  return { ...info, state: licensingToday() <= offlineUntil ? 'active' : 'stale' };
}

// ——— the trial, sealed to this PC ———

/** This PC's marker files: in the app's own folder first, then in the other folders that keep a copy (markerDirs). */
function markerFiles(): string[] {
  const dirs = [config.dataDir, ...(config.markerDirs ?? [])].filter((dir): dir is string => !!dir);
  return [...new Set(dirs)].map((dir) => join(dir, TRIAL_MARKER));
}

/** A trial start that counts as long ended: what a tampered record gives. */
const ENDED_TRIAL = '2000-01-01';
const markerKey = (db: Db) => `qasa-trial-marker|${machineId(db)}`;

function readMarkerList(file: string): Record<string, unknown> | null {
  try {
    const list = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return list && typeof list === 'object' && !Array.isArray(list) ? list as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * One entry of this PC's marker ("<value>.<seal>", the seal over "<purpose>|<value>"), read from every marker file:
 * 'none' when no file has it, 'bad' when a file that is there no longer reads or holds it edited, else the earliest
 * value. A file without the entry (deleted, emptied) gets it back from the others, so removing one copy of the
 * marker never frees what it records.
 */
function markerEntry(db: Db, id: string, purpose: 'trial' | 'grace'): string | 'none' | 'bad' {
  let found: { value: string; stored: string } | null = null;
  const missing: string[] = [];
  for (const file of markerFiles()) {
    if (!existsSync(file)) {
      missing.push(file);
      continue;
    }
    const list = readMarkerList(file);
    if (!list) return 'bad';
    const entry = list[id];
    if (entry === undefined) {
      missing.push(file);
      continue;
    }
    const parts = typeof entry === 'string' ? splitSealed(entry) : null;
    if (!parts || !sealWithOk(markerKey(db), `${purpose}|${parts[0]}`, parts[1])) return 'bad';
    if (!found || parts[0] < found.value) found = { value: parts[0], stored: entry as string };
  }
  if (!found) return 'none';
  if (missing.length) writeMarkerEntry(id, found.stored, false, missing);
  return found.value;
}

/**
 * Writes an entry into the marker files that don't hold it yet (an entry already there, even an edited one, stays; a
 * damaged file is replaced only when it held nothing readable). `strict`: a file that can't be written throws.
 */
function writeMarkerEntry(id: string, stored: string, strict: boolean, files: string[] = markerFiles()): void {
  for (const file of files) {
    try {
      const list: Record<string, unknown> = (existsSync(file) ? readMarkerList(file) : null) ?? {};
      if (list[id] !== undefined) continue;
      list[id] = stored;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(list));
    } catch (error) {
      // the app's own folder must take the record; another copy that can't be written is only a copy fewer
      if (strict && file === markerFiles()[0]) throw error;
    }
  }
}

/**
 * This PC's trial start from its markers ("<date>.<seal>"), null when it has none. An entry that was edited, or
 * a file that no longer reads, counts as a trial long ended: a damaged marker never gives a new trial.
 */
function markerHas(db: Db): string | null {
  const marked = markerEntry(db, machineId(db), 'trial');
  if (marked === 'none') return null;
  return marked === 'bad' || !isIsoDate(marked) ? ENDED_TRIAL : marked;
}

/**
 * Records the trial: sealed in the company file, and in a small file of the app's own (outside it) for this PC,
 * sealed too, with a copy in each other marker folder. Starts the watch on the clock with it.
 */
export function sealTrial(db: Db, started: string): void {
  writeSetting(db, TRIAL_SEAL_SETTING, seal(db, `trial|${started}`));
  if (!readSetting(db, CLOCK_SETTING)) resetClock(db, nowMs());
  if (!markerFiles().length) return;
  writeMarkerEntry(machineId(db), `${started}.${sealWith(markerKey(db), `trial|${started}`)}`, true);
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
  // a company without a trial of its own (Companies → Add) counts the PC's: the clock may not go back on it either
  if (!stored) return marker !== null && clockTurnedBack(db, nowMs()) ? ENDED_TRIAL : marker;
  const mac = readSetting(db, TRIAL_SEAL_SETTING);
  // a trial started before sealing existed (0.1.x) is taken over once (sealed, and recorded for this PC). Only a start
  // on or before this company's first start in a sealing version can be one: a later unsealed start was written by
  // hand. (Tied to that first start, not to a calendar date that could pass before the release ships.)
  if (!mac && !marker) {
    const first = firstStart(db);
    if (!isIsoDate(stored) || !first || stored > first.date) return ENDED_TRIAL;
    sealTrial(db, stored);
    return stored;
  }
  if (!mac || !sealOk(db, `trial|${stored}`, mac)) return marker ?? ENDED_TRIAL;
  // a sealed trial always has the latest time seen next to it: gone means removed to hide a clock turned back
  if (!readSetting(db, CLOCK_SETTING) || clockTurnedBack(db, nowMs())) return ENDED_TRIAL;
  if (marker && marker < stored) return marker;
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

/**
 * The company's invoice-signing public key for the portal, or nothing when it can't be had now (Windows could not
 * protect a new key, for example): the QR key never stops an activation or a check-in; the next one sends it.
 */
function verifyKeyField(db: Db): { verifyKey?: string } {
  try {
    return { verifyKey: companyVerifyKey(db) };
  } catch {
    return {};
  }
}

/** Activates the stored key on this PC (needs the internet once). */
export async function activateOnline(db: Db, user: string): Promise<PlanStatus> {
  const keyText = readSetting(db, 'license_key');
  const license = keyText ? readLicenseKey(keyText) : null;
  if (!keyText || !license) throw new AppError(400, 'license_invalid');
  const { status, data } = await call('/api/v1/activate', { ...verifyKeyField(db),
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
  const { status, data } = await call('/api/v1/check', { token: tokenText, appVersion: APP_VERSION, ...verifyKeyField(db) });
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
    // Any other answer (token_invalid included) keeps the token: a portal that lost its signing key, or answers wrongly
    // for a while, must not drop every paying PC to Free. The token runs out by itself (offline grace), and a freed
    // seat or a revoked licence comes as an explicit "revoked" answer above.
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
  if (!config.strict || inFlight) return;
  // a 0.1.8 key (never activated): activate it on this PC by itself, also after its grace ended
  const legacyKey = status.state === 'needs_activation' && status.graceUntil !== null;
  if (!legacyKey && !['active', 'stale', 'clock'].includes(status.state)) return;
  const now = nowMs();
  if (now - lastAttempt < RETRY_MS) return;
  const last = status.lastChecked ? Date.parse(status.lastChecked) : 0;
  if (status.state === 'active' && now - last < CHECK_EVERY_MS) return;
  lastAttempt = now;
  const attempt = legacyKey ? activateOnline(db, 'Qasa ERP') : checkOnline(db);
  inFlight = attempt.catch(() => undefined).finally(() => { inFlight = null; });
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
