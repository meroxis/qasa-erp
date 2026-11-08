import { z } from 'zod';
import { checkPrintDesign, PRINT_DOCS, type PrintDesign, type PrintDesigns, type PrintDoc } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, invalid } from './errors.ts';
import { deleteSetting, readSetting, writeSetting } from './settings.ts';
import { fromBase64, imageMime, toBase64, type ImageMime } from './media.ts';
import type { ApiExtension } from './routes.ts';

/**
 * What printed papers carry at the top and the bottom (free, every edition): the company's logo, its address, phones,
 * tax number and a line of the company's own at the foot (bank account, "goods sold are not returned after 7 days"…).
 *
 * The logo is checked by its first bytes (PNG, JPEG or WebP, never SVG: an SVG can carry script), at most 200 KB.
 * Both live in settings (MEDIUMTEXT on MariaDB/MySQL), so there is no new table and a company copy carries them along.
 * Anyone signed in reads them (every page that prints needs them); only an admin changes them (not listed in rules).
 */

export const MAX_LOGO_BYTES = 200 * 1024;
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
export interface PrintProfileView extends PrintProfile { logo: CompanyLogo | null }

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
  return { ...profile, logo: getCompanyLogo(db) };
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
  const bytes = fromBase64(base64);
  if (!bytes || bytes.length === 0) throw invalid([{ code: 'pp_logo_invalid' }]);
  if (bytes.length > MAX_LOGO_BYTES) throw invalid([{ code: 'pp_logo_too_large' }]);
  const mime = imageMime(bytes);
  if (!mime) throw invalid([{ code: 'pp_logo_invalid' }]);
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
