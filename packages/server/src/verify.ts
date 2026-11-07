import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import type { Lang, Names } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { AppError, conflict } from './errors.ts';
import { getInvoice } from './invoices.ts';
import { planStatus } from './license.ts';
import { getSettings, readSetting, writeSetting } from './settings.ts';
import type { ApiExtension } from './routes.ts';

/**
 * Invoice QR codes (every plan). Each company has its own Ed25519 key pair, made the first time it is needed; the
 * private half stays in the company's settings and never leaves it. A posted sale invoice's QR code opens
 * qasaerp.com/v/ with the invoice's main details and their signature after the "#" (a browser never sends that part to
 * a server). On a paid plan the details name the licence, and the app gives the portal its public key when it
 * activates or checks in, so the verify page can say who issued the invoice; on Free the page shows the details as
 * unverified.
 */

const PRIVATE_SETTING = 'verify_private_key';
const PUBLIC_SETTING = 'verify_public_key';
/** What is signed: this prefix and the payload as it appears in the link, so nothing has to be put back in order. */
export const SIGNED_PREFIX = 'QINV1.';
export const VERIFY_URL = 'https://qasaerp.com/v/#';
/** Names are cut to this many characters so the code stays small enough to scan from paper. */
const NAME_MAX = 40;

export interface QrPayload {
  v: 1;
  /** the company's name */
  c: string;
  /** invoice number */
  n: string;
  /** date, YYYY-MM-DD */
  d: string;
  /** total in minor units (IQD dinars, USD cents) */
  t: number;
  cur: 'IQD' | 'USD';
  /** the customer, when there is one */
  p?: string;
  /** the licence number (paid plans): where the verify page finds the company's keys */
  l?: string;
}

function keys(db: Db): { privateKey: KeyObject; publicKey: string } {
  let stored = readSetting(db, PRIVATE_SETTING);
  if (!stored) {
    transaction(db, () => {
      // two requests at once: the first one's pair wins
      if (readSetting(db, PRIVATE_SETTING)) return;
      const pair = generateKeyPairSync('ed25519');
      writeSetting(db, PRIVATE_SETTING, pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'));
      writeSetting(db, PUBLIC_SETTING, pair.publicKey.export({ format: 'jwk' }).x!);
    });
    stored = readSetting(db, PRIVATE_SETTING)!;
  }
  const privateKey = createPrivateKey({ key: Buffer.from(stored, 'base64'), format: 'der', type: 'pkcs8' });
  const publicKey = readSetting(db, PUBLIC_SETTING) ?? createPublicKey(privateKey).export({ format: 'jwk' }).x!;
  return { privateKey, publicKey };
}

/**
 * The public key this company signs its invoice QR codes with (base64url, 43 characters), made on first use. The
 * app sends it to the portal with an activation and each check-in (activation.ts: `verifyKey` in the request body).
 */
export function companyVerifyKey(db: Db): string {
  return keys(db).publicKey;
}

const cut = (text: string) => (Array.from(text.trim()).length > NAME_MAX ? Array.from(text.trim()).slice(0, NAME_MAX - 1).join('') + '…' : text.trim());

function companyName(names: Names, lang: Lang): string {
  return [names[lang], names.ar, names.ku, names.en].find((n) => n && n.trim()) ?? '';
}

/** Signs a payload: the text after "#" in the link (payload.signature, both base64url). */
export function signPayload(db: Db, payload: QrPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = sign(null, Buffer.from(SIGNED_PREFIX + body), keys(db).privateKey).toString('base64url');
  return `${body}.${signature}`;
}

/** The link a posted sale invoice's QR code holds. */
export function invoiceQr(db: Db, invoiceId: string, lang: Lang): { url: string; payload: QrPayload; licensed: boolean } {
  const invoice = getInvoice(db, invoiceId);
  if (invoice.kind !== 'sale' || invoice.status !== 'posted' || !invoice.number) throw conflict('qr_needs_posted_sale');
  const plan = planStatus(db);
  const licence = plan.plan !== 'free' && plan.source === 'license' ? plan.license?.id ?? null : null;
  const payload: QrPayload = {
    v: 1,
    c: cut(companyName(getSettings(db).companyName, lang)),
    n: invoice.number,
    d: invoice.date,
    t: invoice.total,
    cur: invoice.currency,
    ...(invoice.partyName ? { p: cut(invoice.partyName) } : {}),
    ...(licence ? { l: licence } : {})
  };
  return { url: VERIFY_URL + signPayload(db, payload), payload, licensed: !!licence };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

/** Reading only: any signed-in user who may see the invoice may print its code. */
export const verifyApi: ApiExtension = {
  routes(db) {
    return [
      {
        method: 'GET', path: '/api/verify/invoices/:id',
        handler: async (req) => {
          const { id } = parse(z.object({ id: z.string().min(1).max(64) }), req.params);
          const { lang } = parse(z.object({ lang: z.enum(['ar', 'en', 'ku']).default('ar') }), req.query ?? {});
          return invoiceQr(db, id, lang);
        }
      },
      { method: 'GET', path: '/api/verify/key', handler: async () => ({ publicKey: companyVerifyKey(db) }) }
    ];
  }
};
