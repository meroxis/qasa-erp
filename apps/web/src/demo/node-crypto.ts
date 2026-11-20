/** Stands in for `node:crypto` in the website demo. Works on plain http too, where crypto.randomUUID is missing. */
export function randomUUID(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Passwords and sessions belong to the Windows app and the office server; the demo never signs anyone in. */
export function createHash(): never {
  throw new Error('not in the demo');
}
export function randomBytes(): never {
  throw new Error('not in the demo');
}
export function scrypt(): never {
  throw new Error('not in the demo');
}
export function timingSafeEqual(): never {
  throw new Error('not in the demo');
}

/** License keys are activated in the Windows app, not in the demo: here every key is refused. */
export function createPublicKey(): object {
  return {};
}

export function verify(): boolean {
  return false;
}

/** Activation and invoice QR signing belong to the Windows app; the demo shows no QR code (backend.ts). */
export function createHmac(): never {
  throw new Error('not in the demo');
}
export function createPrivateKey(): never {
  throw new Error('not in the demo');
}
export function generateKeyPairSync(): never {
  throw new Error('not in the demo');
}
export function sign(): never {
  throw new Error('not in the demo');
}

/** A whole number from min (or 0) up to max, not included: gift voucher codes and pairing codes (till-rules.ts). */
export function randomInt(min: number, max?: number): number {
  const lo = max === undefined ? 0 : min;
  const hi = max === undefined ? min : max;
  const span = hi - lo;
  const limit = Math.floor(0x100000000 / span) * span;
  const box = new Uint32Array(1);
  do crypto.getRandomValues(box); while (box[0]! >= limit);
  return lo + (box[0]! % span);
}
