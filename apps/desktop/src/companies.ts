/**
 * Several companies on one PC. Each company is a folder with the same layout the app always had:
 *   the first company   %APPDATA%\Qasa ERP\                  (data\qasa.sqlite, backup.json, network\ …)
 *   the others          %APPDATA%\Qasa ERP\companies\<id>\   (the same, inside)
 * companies.json (in %APPDATA%\Qasa ERP) lists them and says which one opens. A folder is always worked out from the
 * company's id, which must look like `c` + 8 hex digits — never from a name or a path the window sent — so nothing
 * outside the app's own folder can be opened or written.
 *
 * What belongs to this PC rather than to a company stays in %APPDATA%\Qasa ERP for all of them: the licence
 * activation and the trial record (one seat, one free month, whatever the company), the logs and the secrets key.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The first company: the folder the app always used. */
export const MAIN_COMPANY = 'main';
const COMPANY_ID = /^c[0-9a-f]{8}$/;
const REGISTRY = 'companies.json';
const NAME_MAX = 80;

export interface CompanyEntry {
  id: string;
  /** The label on the switcher (the company's own printed name stays in its Settings). */
  name: string;
  createdAt: string;
}

export interface Registry {
  current: string;
  list: CompanyEntry[];
}

export const isCompanyId = (id: unknown): id is string => id === MAIN_COMPANY || (typeof id === 'string' && COMPANY_ID.test(id));

/** The folder of a company. Throws for anything that isn't a company id. */
export function companyDirOf(userDataDir: string, id: string): string {
  if (id === MAIN_COMPANY) return userDataDir;
  if (!isCompanyId(id)) throw new Error('not a company id');
  return join(userDataDir, 'companies', id);
}

/** A name for the switcher: trimmed, no control characters, 1 to 80 characters. Null when nothing is left. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const name = value.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return [...name].slice(0, NAME_MAX).join('');
}

/** A new id from random bytes (crypto in the app, fixed in tests). */
export function newCompanyId(random: Uint8Array): string {
  if (random.length < 4) throw new Error('four random bytes needed');
  return 'c' + Buffer.from(random.subarray(0, 4)).toString('hex');
}

const emptyRegistry = (defaultName: string, now: string): Registry => ({ current: MAIN_COMPANY, list: [{ id: MAIN_COMPANY, name: defaultName, createdAt: now }] });

/**
 * What a companies.json says, checked: unknown or repeated ids are dropped, the first company is always there, and
 * a `current` that isn't listed falls back to it.
 */
export function parseRegistry(raw: unknown, defaultName: string, now: string): Registry {
  const out = emptyRegistry(defaultName, now);
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { current?: unknown; list?: unknown };
  const seen = new Set<string>();
  const list: CompanyEntry[] = [];
  for (const e of Array.isArray(r.list) ? r.list : []) {
    const entry = e as { id?: unknown; name?: unknown; createdAt?: unknown };
    if (!isCompanyId(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    list.push({ id: entry.id, name: cleanName(entry.name) ?? defaultName, createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : now });
  }
  if (!seen.has(MAIN_COMPANY)) list.unshift(out.list[0]!);
  return { current: isCompanyId(r.current) && seen.has(r.current) ? r.current : MAIN_COMPANY, list };
}

export function readRegistry(userDataDir: string, defaultName = 'Qasa ERP', now = new Date().toISOString()): Registry {
  try {
    return parseRegistry(JSON.parse(readFileSync(join(userDataDir, REGISTRY), 'utf8')), defaultName, now);
  } catch {
    return emptyRegistry(defaultName, now);
  }
}

/** Written to a temporary file first, so a power cut never leaves half a list. */
export function writeRegistry(userDataDir: string, registry: Registry): void {
  mkdirSync(userDataDir, { recursive: true });
  const file = join(userDataDir, REGISTRY);
  writeFileSync(file + '.tmp', JSON.stringify(registry, null, 2));
  renameSync(file + '.tmp', file);
}

export class CompanyError extends Error {
  constructor(readonly code: 'company_name_invalid' | 'company_not_found' | 'company_limit' | 'company_exists' | 'company_is_current') {
    super(code);
  }
}

const find = (registry: Registry, id: string) => registry.list.find((c) => c.id === id) ?? null;

/** Adds a company to the list (the folder and its file are made separately). */
export function addCompany(registry: Registry, input: { id: string; name: unknown; now: string; limit: number | null }): Registry {
  const name = cleanName(input.name);
  if (!name) throw new CompanyError('company_name_invalid');
  if (!isCompanyId(input.id) || input.id === MAIN_COMPANY) throw new Error('not a new company id');
  if (find(registry, input.id)) throw new CompanyError('company_exists');
  if (input.limit !== null && registry.list.length >= input.limit) throw new CompanyError('company_limit');
  return { ...registry, list: [...registry.list, { id: input.id, name, createdAt: input.now }] };
}

export function renameCompany(registry: Registry, id: string, value: unknown): Registry {
  const name = cleanName(value);
  if (!name) throw new CompanyError('company_name_invalid');
  if (!find(registry, id)) throw new CompanyError('company_not_found');
  return { ...registry, list: registry.list.map((c) => (c.id === id ? { ...c, name } : c)) };
}

/** The company that opens next. */
export function chooseCompany(registry: Registry, id: string): Registry {
  if (!find(registry, id)) throw new CompanyError('company_not_found');
  return { ...registry, current: id };
}

/** A backup file's name from the company's name: letters of any language, digits, - and _; never a path. Restore takes .sqlite files. */
export function backupFileName(name: string, stamp: string): string {
  const safe = [...name.normalize('NFC')].filter((ch) => /[\p{L}\p{N}_-]/u.test(ch) || ch === ' ').join('').trim().replace(/\s+/g, '-').slice(0, 40);
  return `${safe || 'company'}-${stamp.replace(/[^0-9-]/g, '')}.sqlite`;
}

/** Does the company's folder already hold a company file (SQLite)? */
export const hasCompanyFile = (dir: string): boolean => existsSync(join(dir, 'data', 'qasa.sqlite'));

export type DamagedChoice = 'retry' | 'aside' | 'first' | 'quit';

/**
 * The buttons when a company file can't be opened at the start, and which one Enter presses. Enter is always Try
 * again: a file only locked for a moment (antivirus, a OneDrive sync, a second copy of the app) must never be set aside
 * with one keypress. Escape quits.
 */
export function damagedFileChoices(main: boolean): { choices: DamagedChoice[]; defaultId: number; cancelId: number } {
  const choices: DamagedChoice[] = ['retry', 'aside', ...(main ? [] : ['first' as const]), 'quit'];
  return { choices, defaultId: choices.indexOf('retry'), cancelId: choices.length - 1 };
}
