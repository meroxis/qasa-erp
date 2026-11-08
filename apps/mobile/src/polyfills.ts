import { getRandomValues } from 'expo-crypto';

/**
 * @noble's randomBytes uses crypto.getRandomValues, which React Native's engine doesn't have: expo-crypto's comes from
 * the system's secure random source (Android SecureRandom, iOS SecRandomCopyBytes). Imported first, in index.ts.
 */
const g = globalThis as { crypto?: { getRandomValues?: unknown } };
if (!g.crypto) g.crypto = {};
if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = <T extends ArrayBufferView>(array: T): T => getRandomValues(array as never) as T;
}
