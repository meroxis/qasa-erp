import { randomBytes } from '@noble/hashes/utils.js';

/** A UUID v4 in its usual lower-case form: the key a change waiting in the outbox is sent with, every time. */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A new UUID v4 (RFC 9562) from the system's secure random source (expo-crypto, see polyfills.ts). */
export function uuidV4(random: (n: number) => Uint8Array = randomBytes): string {
  const b = random(16);
  if (b.length !== 16) throw new Error('uuidV4: 16 random bytes needed');
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
