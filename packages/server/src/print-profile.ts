import { z } from 'zod';
import { checkPrintDesign, PRINT_DOCS, type PrintDesign, type PrintDesigns, type PrintDoc } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid } from './errors.ts';
import { planStatus } from './license.ts';
import { deleteSetting, readSetting, writeSetting } from './settings.ts';
import { fromBase64, imageMime, toBase64, type ImageMime } from './media.ts';
import type { ApiExtension } from './routes.ts';

/**
 * What printed papers carry at the top and the bottom: the company's address, phones, tax number and a line of the
 * company's own at the foot (bank account, "goods sold are not returned after 7 days"…), on every plan; and the
 * company's logo, on the paid plans (Starter, Pro, Business) and during the free month.
 *
 * The logo is a paid feature checked here, on the server: without it a logo is neither taken nor handed out for
 * printing. One saved earlier stays saved (a plan never takes data away): it prints again once a paid plan is back,
 * and it can always be removed.
 *
 * The logo is checked by what the file is, not by its name: PNG, JPEG or WebP by its first bytes (never SVG: an SVG can
 * carry script), read through to its end mark, with a picture size the header states and no larger than
 * MAX_LOGO_SIDE, at most 200 KB. It is only ever shown as a picture (an <img> from a data: address of the checked type).
 * Both live in settings (MEDIUMTEXT on MariaDB/MySQL), so there is no new table and a company copy carries them along.
 * Anyone signed in reads them (every page that prints needs them); only an admin changes them (not listed in rules).
 */

export const MAX_LOGO_BYTES = 200 * 1024;
/** The longest side of a logo, in pixels (a small file can state a huge picture: it is refused, not decoded). */
export const MAX_LOGO_SIDE = 2000;

/** Whether this company's plan prints its own logo (Starter, Pro, Business, and the free month). */
export const logoAvailable = (db: Db): boolean => planStatus(db).features.includes('companyLogo');

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32le = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
const tag = (b: Uint8Array, i: number) => String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);

/**
 * The picture's size as its own header states it, or null when the file is not a whole picture of that type: a PNG
 * must start with its IHDR and end with its IEND, a JPEG must carry a frame header and end with its end mark, a WebP's
 * stated length must be the file's. Anything after the picture's end (another file stuck on) makes it refused.
 */
export function logoSize(bytes: Uint8Array, mime: ImageMime): { width: number; height: number } | null {
  const b = bytes;
  if (mime === 'image/png') {
    if (b.length < 8 + 25 + 12 || u32be(b, 8) !== 13 || tag(b, 12) !== 'IHDR') return null;
    const end = b.length - 12;
    if (u32be(b, end) !== 0 || tag(b, end + 4) !== 'IEND') return null;
    return { width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (mime === 'image/jpeg') {
    if (b.length < 12 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return null;
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xff) { i += 1; continue; }
      // start of scan: the frame header would have come before it
      if (marker === 0xda) return null;
      const length = u16be(b, i + 2);
      if (length < 2) return null;
      const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (frame) return length >= 7 ? { height: u16be(b, i + 5), width: u16be(b, i + 7) } : null;
      i += 2 + length;
    }
    return null;
  }
  // WebP: RIFF, the length of what follows, WEBP, then the first chunk says which kind
  if (b.length < 30 || u32le(b, 4) + 8 !== b.length) return null;
  const kind = tag(b, 12);
  if (kind === 'VP8X') return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (kind === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
  }
  return null;
}
const LOGO_KEY = 'company_logo';
const PROFILE_KEY = 'print_profile';

export interface PrintProfile {
  address: string;
  phone: string;
  taxNumber: string;
  /** a free line printed at the foot of every paper */
  footer: string;
  /** whether the logo is printed (it can stay saved while hidden) */
  showLogo: boolean;
}

export interface CompanyLogo { mime: ImageMime; data: string; updatedAt: string }
export interface PrintProfileView extends PrintProfile {
  /** the logo to print: null when there is none, or when the plan does not print one */
  logo: CompanyLogo | null;
  /** a logo is saved but the plan does not print it (it prints again on a paid plan) */
  logoKept: boolean;
}

const EMPTY: PrintProfile = { address: '', phone: '', taxNumber: '', footer: '', showLogo: true };

const PROFILE = z.object({
  address: z.string().max(200).transform((s) => s.trim()),
  phone: z.string().max(80).transform((s) => s.trim()),
  taxNumber: z.string().max(40).transform((s) => s.trim()),
  footer: z.string().max(300).transform((s) => s.trim()),
  showLogo: z.boolean()
}).strict();

function readJson<T>(db: Db, key: string): T | null {
  const raw = readSetting(db, key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getCompanyLogo(db: Db): CompanyLogo | null {
  const logo = readJson<CompanyLogo>(db, LOGO_KEY);
  return logo && typeof logo.data === 'string' && typeof logo.mime === 'string' ? logo : null;
}

export function getPrintProfile(db: Db): PrintProfileView {
  const stored = readJson<Partial<PrintProfile>>(db, PROFILE_KEY) ?? {};
  const profile: PrintProfile = {
    address: typeof stored.address === 'string' ? stored.address : EMPTY.address,
    phone: typeof stored.phone === 'string' ? stored.phone : EMPTY.phone,
    taxNumber: typeof stored.taxNumber === 'string' ? stored.taxNumber : EMPTY.taxNumber,
    footer: typeof stored.footer === 'string' ? stored.footer : EMPTY.footer,
    showLogo: typeof stored.showLogo === 'boolean' ? stored.showLogo : EMPTY.showLogo
  };
  const logo = getCompanyLogo(db);
  const allowed = logo !== null && logoAvailable(db);
  return { ...profile, logo: allowed ? logo : null, logoKept: logo !== null && !allowed };
}

export function updatePrintProfile(db: Db, input: unknown, user: string): PrintProfileView {
  const profile = parse(PROFILE, input);
  transaction(db, () => {
    writeSetting(db, PROFILE_KEY, JSON.stringify(profile));
    audit(db, user, 'update', 'print_profile', 'company', profile);
  });
  return getPrintProfile(db);
}

export function setCompanyLogo(db: Db, base64: string, user: string): CompanyLogo {
  // a paid feature, refused here whatever the page shows
  if (!logoAvailable(db)) throw conflict('plan_limit', { limit: 'companyLogo' });
  const bytes = fromBase64(base64);
  if (!bytes || bytes.length === 0) throw invalid([{ code: 'pp_logo_invalid' }]);
  if (bytes.length > MAX_LOGO_BYTES) throw invalid([{ code: 'pp_logo_too_large' }]);
  const mime = imageMime(bytes);
  if (!mime) throw invalid([{ code: 'pp_logo_invalid' }]);
  const size = logoSize(bytes, mime);
  if (!size || size.width < 1 || size.height < 1) throw invalid([{ code: 'pp_logo_invalid' }]);
  if (size.width > MAX_LOGO_SIDE || size.height > MAX_LOGO_SIDE) throw invalid([{ code: 'pp_logo_too_wide' }]);
  // stored re-encoded from the checked bytes, never the text the client sent
  const logo: CompanyLogo = { mime, data: toBase64(bytes), updatedAt: new Date().toISOString() };
  transaction(db, () => {
    writeSetting(db, LOGO_KEY, JSON.stringify(logo));
    audit(db, user, 'update', 'company_logo', 'company', { mime, bytes: bytes.length });
  });
  return logo;
}

export function deleteCompanyLogo(db: Db, user: string): void {
  if (!readSetting(db, LOGO_KEY)) return;
  transaction(db, () => {
    deleteSetting(db, LOGO_KEY);
    audit(db, user, 'delete', 'company_logo', 'company');
  });
}

/* ---------- print designs (the print designer) ---------- */

const DESIGNS_KEY = 'print_designs';

/** The saved designs: only well-formed ones count (a design written by an older or broken copy is skipped, not printed). */
export function getPrintDesigns(db: Db): PrintDesigns {
  const stored = readJson<Record<string, unknown>>(db, DESIGNS_KEY);
  const out: PrintDesigns = {};
  if (!stored || typeof stored !== 'object') return out;
  for (const doc of PRINT_DOCS) {
    if (!(doc in stored)) continue;
    const checked = checkPrintDesign(stored[doc]);
    if ('design' in checked) out[doc] = checked.design;
  }
  return out;
}

function isDoc(v: string): v is PrintDoc {
  return (PRINT_DOCS as readonly string[]).includes(v);
}

/** Saves a kind's own design (checked field by field; anything unknown is refused). */
export function setPrintDesign(db: Db, doc: string, input: unknown, user: string): PrintDesigns {
  if (!isDoc(doc)) throw invalid([{ code: 'pd_unknown_doc' }]);
  const checked = checkPrintDesign(input);
  if ('problems' in checked) throw invalid(checked.problems.map((p) => ({ code: p.code, field: p.path })));
  const design: PrintDesign = checked.design;
  const designs = { ...getPrintDesigns(db), [doc]: design };
  transaction(db, () => {
    writeSetting(db, DESIGNS_KEY, JSON.stringify(designs));
    audit(db, user, 'update', 'print_design', doc, { layout: design.layout, paper: design.paper });
  });
  return designs;
}

/** Back to the default: the sale invoice to the program's design, any other kind to "same as the sale invoice". */
export function resetPrintDesign(db: Db, doc: string, user: string): PrintDesigns {
  if (!isDoc(doc)) throw invalid([{ code: 'pd_unknown_doc' }]);
  const designs = getPrintDesigns(db);
  if (!(doc in designs)) return designs;
  delete designs[doc];
  transaction(db, () => {
    if (Object.keys(designs).length) writeSetting(db, DESIGNS_KEY, JSON.stringify(designs));
    else deleteSetting(db, DESIGNS_KEY);
    audit(db, user, 'delete', 'print_design', doc);
  });
  return designs;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const docParam = z.object({ doc: z.string().min(1).max(20) });

export const printProfileApi: ApiExtension = {
  // reading is open to anyone signed in; PUT and DELETE aren't listed, so they need an admin
  routes(db, { actorOf }) {
    return [
      { method: 'GET', path: '/api/print-profile', handler: async () => getPrintProfile(db) },
      { method: 'GET', path: '/api/print-designs', handler: async () => getPrintDesigns(db) },
      {
        method: 'PUT', path: '/api/print-designs/:doc',
        handler: async (req) => setPrintDesign(db, parse(docParam, req.params).doc, req.body, actorOf(req).name)
      },
      {
        method: 'DELETE', path: '/api/print-designs/:doc',
        handler: async (req) => resetPrintDesign(db, parse(docParam, req.params).doc, actorOf(req).name)
      },
      { method: 'PUT', path: '/api/print-profile', handler: async (req) => updatePrintProfile(db, req.body, actorOf(req).name) },
      {
        method: 'PUT', path: '/api/company-logo',
        handler: async (req) => {
          const body = parse(z.object({ data: z.string().min(1).max(Math.ceil(MAX_LOGO_BYTES * 4 / 3) + 200) }), req.body);
          return setCompanyLogo(db, body.data, actorOf(req).name);
        }
      },
      {
        method: 'DELETE', path: '/api/company-logo',
        handler: async (req, reply) => {
          deleteCompanyLogo(db, actorOf(req).name);
          reply.status(204).send();
          return undefined;
        }
      }
    ];
  }
};
