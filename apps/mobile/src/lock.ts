import { scryptAsync } from '@noble/hashes/scrypt.js';
import { randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { fromB64, sameBytes, toB64 } from './protocol';

/**
 * The app lock: an optional PIN (4 to 8 digits) and, when the phone has one, the fingerprint or face. The PIN is never
 * kept: only a slow hash of it (scrypt) in the phone's secure storage. Wrong PINs make the next try wait longer (no
 * wipe: a phone handed to a child must not lose the sales and receipts waiting in its outbox); "Forgot the PIN?" unpairs
 * the phone and wipes what it keeps.
 */

export const PIN_MIN = 4;
export const PIN_MAX = 8;

export const validPin = (pin: string) => new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);

/** A PIN anyone would guess: one digit repeated, or digits counting up or down (1234, 9876, 0123…). */
export function weakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const steps = new Set<number>();
  for (let i = 1; i < pin.length; i++) steps.add((Number(pin[i]) - Number(pin[i - 1]) + 10) % 10);
  return steps.size === 1 && (steps.has(1) || steps.has(9));
}

export interface PinParams { N: number; r: number; p: number }
/**
 * Slow enough that the hash gives nothing away cheaply, quick enough on a modest Android phone (pure JavaScript). The
 * PIN's real protection is the secure storage it sits in and the waits below.
 */
export const PIN_PARAMS: PinParams = { N: 2 ** 13, r: 8, p: 1 };

/** "s1.N.r.p.salt.hash" (base64url): the stored form. */
export async function hashPin(pin: string, params: PinParams = PIN_PARAMS, salt: Uint8Array = randomBytes(16)): Promise<string> {
  if (!validPin(pin)) throw new Error('pin_invalid');
  const hash = await scryptAsync(utf8ToBytes(pin), salt, { ...params, dkLen: 32 });
  return ['s1', params.N, params.r, params.p, toB64(salt), toB64(hash)].join('.');
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('.');
  if (parts.length !== 6 || parts[0] !== 's1' || !validPin(pin)) return false;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![N, r, p].every((v) => Number.isSafeInteger(v) && v > 0) || N > 2 ** 20 || r > 32 || p > 4) return false;
  try {
    const hash = await scryptAsync(utf8ToBytes(pin), fromB64(parts[4]!), { N, r, p, dkLen: 32 });
    return sameBytes(hash, fromB64(parts[5]!));
  } catch {
    return false;
  }
}

/** Free tries before the waits start; then 30 s, doubling up to 15 minutes. */
export const FREE_TRIES = 5;
export function lockoutMs(failures: number): number {
  if (failures < FREE_TRIES) return 0;
  return Math.min(30_000 * 2 ** (failures - FREE_TRIES), 15 * 60_000);
}

/** Auto-lock after the app has been in the background this long: at once, 1 minute, 5 minutes. */
export const AUTO_LOCK_CHOICES = [0, 60_000, 300_000] as const;
export type AutoLock = (typeof AUTO_LOCK_CHOICES)[number];

export function shouldLock(backgroundSince: number | null, now: number, after: number): boolean {
  return backgroundSince !== null && now - backgroundSince >= after;
}

/** pin: the hash; length: how many digits (the pad unlocks as soon as that many are in, with no OK key) */
export interface LockSettings { pin: string | null; length: number; biometric: boolean; after: AutoLock }

export function parseLockSettings(text: string | null): LockSettings {
  const fallback: LockSettings = { pin: null, length: 0, biometric: false, after: 60_000 };
  if (!text) return fallback;
  try {
    const v = JSON.parse(text) as Partial<LockSettings>;
    return {
      pin: typeof v.pin === 'string' && v.pin.startsWith('s1.') && typeof v.length === 'number' && v.length >= PIN_MIN && v.length <= PIN_MAX ? v.pin : null,
      length: typeof v.length === 'number' && v.length >= PIN_MIN && v.length <= PIN_MAX ? v.length : 0,
      biometric: v.biometric === true && typeof v.pin === 'string' && typeof v.length === 'number',
      after: (AUTO_LOCK_CHOICES as readonly number[]).includes(v.after as number) ? (v.after as AutoLock) : 60_000
    };
  } catch {
    return fallback;
  }
}
