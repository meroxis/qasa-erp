import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import { fromB64, generateKeyPair, publicKeyOf, toB64, type KeyPair } from './protocol';
import type { OfficeInfo } from './link';
import type { Lang } from './i18n';
import type { OutboxStorage } from './outbox';
import type { Me } from './roles';
import { parseLockSettings, type LockSettings } from './lock';
import type { ThemeChoice } from './theme';

/**
 * What the phone keeps. In the phone's secure storage (the Android Keystore / iOS Keychain, readable by this app only,
 * never backed up off the phone): its own key, the office it is paired with (and that office's pinned public key), who
 * it acts as there, the app lock and the outbox's key. In the app's own files: the outbox, encrypted with that key.
 * Unpairing wipes all of it (wipePairing); only the language and the light/dark choice stay.
 */

const KEY = 'qasa.phoneKey';
const OFFICE = 'qasa.office';
const LANG = 'qasa.lang';
const NAME = 'qasa.phoneName';
const ME = 'qasa.me';
const THEME = 'qasa.theme';
const LOCK = 'qasa.lock';
const LOCK_FAILS = 'qasa.lockFails';
const OUTBOX_KEY = 'qasa.outboxKey';

/** Secure storage readable only while the phone is unlocked, and only on this phone (no backup, no transfer). */
const SECURE: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const get = (k: string) => SecureStore.getItemAsync(k, SECURE);
const set = (k: string, v: string) => SecureStore.setItemAsync(k, v, SECURE);
const del = (k: string) => SecureStore.deleteItemAsync(k, SECURE);

export async function phoneKey(): Promise<KeyPair> {
  const stored = await get(KEY);
  if (stored) {
    const secretKey = fromB64(stored);
    if (secretKey.length === 32) return { secretKey, publicKey: publicKeyOf(secretKey) };
  }
  const pair = generateKeyPair();
  await set(KEY, toB64(pair.secretKey));
  return pair;
}

function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function loadOffice(): Promise<OfficeInfo | null> {
  const o = parseJson<OfficeInfo>(await get(OFFICE));
  return o && typeof o.serverKey === 'string' && Array.isArray(o.addresses) && typeof o.port === 'number' ? o : null;
}
export const saveOffice = (office: OfficeInfo) => set(OFFICE, JSON.stringify(office));

export const loadMe = async () => parseJson<Me>(await get(ME));
export const saveMe = (me: Me) => set(ME, JSON.stringify(me));

export async function loadLang(): Promise<Lang | null> {
  const v = await get(LANG);
  return v === 'ar' || v === 'en' || v === 'ku' ? v : null;
}
export const saveLang = (lang: Lang) => set(LANG, lang);

export async function loadTheme(): Promise<ThemeChoice> {
  const v = await get(THEME);
  return v === 'light' || v === 'dark' ? v : 'system';
}
export const saveTheme = (choice: ThemeChoice) => set(THEME, choice);

export const loadName = () => get(NAME);
export const saveName = (name: string) => set(NAME, name.slice(0, 80));

export const loadLock = async (): Promise<LockSettings> => parseLockSettings(await get(LOCK));
export const saveLock = (lock: LockSettings) => set(LOCK, JSON.stringify(lock));

/** Wrong PINs in a row, and when the last was (kept, so closing the app does not reset the wait). */
export async function loadLockFails(): Promise<{ n: number; at: number }> {
  const v = parseJson<{ n?: unknown; at?: unknown }>(await get(LOCK_FAILS));
  return { n: typeof v?.n === 'number' ? v.n : 0, at: typeof v?.at === 'number' ? v.at : 0 };
}
export const saveLockFails = (fails: { n: number; at: number }) => set(LOCK_FAILS, JSON.stringify(fails));

// ——— the outbox's file (encrypted by outbox.ts) and its key ———

const outboxFile = () => new File(Paths.document, 'qasa-outbox.enc');
const outboxTemp = () => new File(Paths.document, 'qasa-outbox.enc.new');
/** the 0.1 app's outbox, in the clear: removed (that app was never released) */
const oldOutbox = () => new File(Paths.document, 'qasa-outbox.json');

export const outboxStorage: OutboxStorage = {
  async read() {
    const old = oldOutbox();
    if (old.exists) old.delete();
    const file = outboxFile();
    if (file.exists) return file.text();
    // a write that stopped between its two steps: the new copy is whole (it was written before the move)
    const temp = outboxTemp();
    return temp.exists ? temp.text() : null;
  },
  async write(text) {
    // written beside the old one, then moved over it: a crash mid-write leaves one whole copy
    const temp = outboxTemp();
    if (temp.exists) temp.delete();
    temp.create();
    await temp.write(text);
    await temp.move(outboxFile(), { overwrite: true });
  },
  async remove() {
    for (const f of [outboxFile(), outboxTemp(), oldOutbox()]) if (f.exists) f.delete();
  },
  readKey: () => get(OUTBOX_KEY),
  writeKey: (key) => set(OUTBOX_KEY, key),
  removeKey: () => del(OUTBOX_KEY)
};

/**
 * Unpairing (or "Forgot the PIN?"): the office, who the phone acted as, the app lock and the phone's own key are gone
 * (pairing again makes a new key, so the office sees a new phone). The outbox is wiped by its own wipe().
 */
export async function wipePairing(): Promise<void> {
  for (const k of [OFFICE, ME, LOCK, LOCK_FAILS, KEY, NAME]) await del(k);
}
