import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import { fromB64, generateKeyPair, publicKeyOf, toB64, type KeyPair } from './protocol';
import type { OfficeInfo } from './link';
import type { Lang } from './i18n';

/**
 * What the phone keeps: its own key (secure storage: the Android Keystore / iOS Keychain), the office it is paired
 * with, the language, and the outbox (sales and counts waiting for the office, in the app's own files).
 */

const KEY = 'qasa.phoneKey';
const OFFICE = 'qasa.office';
const LANG = 'qasa.lang';
const NAME = 'qasa.phoneName';

export async function phoneKey(): Promise<KeyPair> {
  const stored = await SecureStore.getItemAsync(KEY);
  if (stored) {
    const secretKey = fromB64(stored);
    return { secretKey, publicKey: publicKeyOf(secretKey) };
  }
  const pair = generateKeyPair();
  await SecureStore.setItemAsync(KEY, toB64(pair.secretKey));
  return pair;
}

export async function loadOffice(): Promise<OfficeInfo | null> {
  const text = await SecureStore.getItemAsync(OFFICE);
  if (!text) return null;
  try {
    return JSON.parse(text) as OfficeInfo;
  } catch {
    return null;
  }
}

export const saveOffice = (office: OfficeInfo) => SecureStore.setItemAsync(OFFICE, JSON.stringify(office));
export const forgetOffice = () => SecureStore.deleteItemAsync(OFFICE);

export async function loadLang(): Promise<Lang | null> {
  const v = await SecureStore.getItemAsync(LANG);
  return v === 'ar' || v === 'en' || v === 'ku' ? v : null;
}
export const saveLang = (lang: Lang) => SecureStore.setItemAsync(LANG, lang);

export const loadName = () => SecureStore.getItemAsync(NAME);
export const saveName = (name: string) => SecureStore.setItemAsync(NAME, name);

// ——— the outbox: what waits for the office (no Wi-Fi, office PC off) and is sent again later ———

export interface OutboxItem {
  id: string;
  kind: 'sale' | 'count';
  body: unknown;
  createdAt: string;
  /** the last refusal from the office, shown to the user (not sent again) */
  error?: string;
}

const outboxFile = () => new File(Paths.document, 'qasa-outbox.json');

export async function loadOutbox(): Promise<OutboxItem[]> {
  try {
    const file = outboxFile();
    if (!file.exists) return [];
    const list = JSON.parse(await file.text()) as OutboxItem[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveOutbox(list: OutboxItem[]): void {
  const file = outboxFile();
  if (!file.exists) file.create();
  file.write(JSON.stringify(list));
}
