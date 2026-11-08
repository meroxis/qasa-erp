/**
 * Companies on this PC (Settings → Companies, and the account menu): list, make, rename, open, back up. Only in the
 * Windows app — the server process adds these routes to its own server; the office network's other PCs and the web
 * demo don't have them. Every change needs an admin of the company open now, and opening another company signs
 * nobody in: that company's own sign-in (if it has one) asks again.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import {
  AppError, conflict, invalid, notFound, noteFirstStartBeforeCarry, readSetting, SCHEMA_VERSION, writeSetting,
  type Actor, type ApiExtension, type ApiRequest, type Db
} from '@qasa/server';
import {
  addCompany, backupFileName, chooseCompany, CompanyError, companyDirOf, hasCompanyFile, isCompanyId,
  readRegistry, renameCompany, writeRegistry, type Registry
} from './companies.ts';

/**
 * What a new company takes over from the one open now: the licence and this PC's activation of it. Both belong to
 * the PC (one seat, the activation is bound to its machine id), so a second company on the same PC needs no second
 * activation. The trial is the PC's too (its record in the app's folder), so a new company never starts a new month.
 * The day of the last check-in is not carried: the new company checks in at once, which registers its own invoice
 * signing key with the portal (otherwise its genuine invoices show as unverified for days).
 */
export const CARRIED_SETTINGS = ['license_key', 'activation_token', 'activation_revoked'] as const;

/**
 * Whether a closed company file can be opened by this version, read-only and without changing it: not damaged at its
 * start, a Qasa ERP company file, and not from a newer Qasa ERP. Deeper damage shows when it opens (main.ts then offers
 * the way back).
 */
export function companyFileProblem(file: string): 'company_damaged' | 'database_newer' | null {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch {
    return 'company_damaged';
  }
  try {
    const row = db.prepare('SELECT version FROM schema_version').get() as { version?: unknown } | undefined;
    return Number(row?.version ?? 0) > SCHEMA_VERSION ? 'database_newer' : null;
  } catch {
    return 'company_damaged';
  } finally {
    db.close();
  }
}

/** The backup password (Pro) of a company folder: a Companies → Back up copy would leave that encryption out. */
function hasBackupPassword(dir: string): boolean {
  const file = join(dir, 'backup.json');
  if (!existsSync(file)) return false;
  try {
    const secret = (JSON.parse(readFileSync(file, 'utf8')) as { secret?: unknown }).secret;
    return typeof secret === 'string' && secret.length > 0;
  } catch {
    // backup settings that can't be read: they may hold a password, so never a plain copy
    return true;
  }
}

export interface CompanyApiDeps {
  db: Db;
  userDataDir: string;
  currentId: string;
  /** The plan's company limit now (null = unlimited). */
  limit(): number | null;
  /** Opens the company file at `file` (made with its tables when new: openDatabase), lets `prepare` write to it, then closes it. */
  makeCompanyFile(file: string, prepare: (db: Db) => void): void;
  chooseFolder(): Promise<string | null>;
  /** Called after the reply went out: the app closes this company and opens `id`. */
  switchTo(id: string): void;
  log(...parts: unknown[]): void;
  now?: () => Date;
  random?: () => Uint8Array;
}

const forbidden = () => new AppError(403, 'forbidden');
const stamp = (d: Date) => d.toISOString().slice(0, 19).replace(/[:T]/g, '-');

function fromCompanyError(error: unknown): unknown {
  if (!(error instanceof CompanyError)) return error;
  if (error.code === 'company_not_found') return notFound('company');
  if (error.code === 'company_name_invalid') return invalid([{ path: 'name', code: 'company_name_invalid' }]);
  return conflict(error.code);
}

/** The company folder keeps its company on a MariaDB/MySQL server (Pro): no company file to copy. */
function onDatabaseServer(dir: string): boolean {
  try {
    return (JSON.parse(readFileSync(join(dir, 'database.json'), 'utf8')) as { kind?: unknown }).kind === 'server';
  } catch {
    return false;
  }
}

export function companyApi(deps: CompanyApiDeps): ApiExtension {
  const now = () => (deps.now ? deps.now() : new Date());
  const random = () => (deps.random ? deps.random() : randomBytes(4));
  const companyName = () => {
    try {
      const raw = readSetting(deps.db, 'company_name');
      const names = raw ? (JSON.parse(raw) as Record<string, string>) : null;
      return names?.ar || names?.en || names?.ku || 'Qasa ERP';
    } catch {
      return 'Qasa ERP';
    }
  };
  const registry = (): Registry => readRegistry(deps.userDataDir, companyName(), now().toISOString());
  const admin = (actorOf: (req: ApiRequest) => Actor, req: ApiRequest) => {
    const actor = actorOf(req);
    if (!actor.roles.includes('admin')) throw forbidden();
    return actor;
  };
  const view = (r: Registry) => {
    const limit = deps.limit();
    return {
      current: deps.currentId,
      limit,
      canAdd: limit === null || r.list.length < limit,
      // the plan's limit only stops adding companies: every company already made always opens, whatever the plan
      list: r.list.map((c) => ({ ...c, current: c.id === deps.currentId }))
    };
  };
  const idOf = (req: ApiRequest) => {
    const id = (req.params as { id?: unknown }).id;
    if (!isCompanyId(id)) throw notFound('company');
    return id;
  };
  const guard = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      throw fromCompanyError(error);
    }
  };

  return {
    routes(_db, { actorOf }) {
      return [
        {
          method: 'GET', path: '/api/companies',
          handler: async (req) => {
            admin(actorOf, req);
            return view(registry());
          }
        },
        {
          method: 'POST', path: '/api/companies',
          handler: async (req, reply) => {
            const actor = admin(actorOf, req);
            const name = (req.body as { name?: unknown } | undefined)?.name;
            const current = registry();
            let id = '';
            do id = 'c' + Buffer.from(random()).toString('hex').slice(0, 8); while (current.list.some((c) => c.id === id));
            const next = guard(() => addCompany(current, { id, name, now: now().toISOString(), limit: deps.limit() }));
            const dir = companyDirOf(deps.userDataDir, id);
            if (existsSync(dir)) throw conflict('company_exists');
            const carried: [string, string][] = [];
            for (const key of CARRIED_SETTINGS) {
              const value = readSetting(deps.db, key);
              if (value != null) carried.push([key, value]);
            }
            try {
              mkdirSync(join(dir, 'data'), { recursive: true });
              deps.makeCompanyFile(join(dir, 'data', 'qasa.sqlite'), (db) => {
                // before the key is there: a carried key never starts a 0.1.8 grace of its own
                noteFirstStartBeforeCarry(deps.db, db);
                for (const [key, value] of carried) writeSetting(db, key, value);
              });
              writeRegistry(deps.userDataDir, next);
            } catch (error) {
              // nothing half-made is left behind
              rmSync(dir, { recursive: true, force: true });
              throw error;
            }
            deps.log(`company ${id} made by ${actor.username || actor.name}`);
            return reply.status(201).send(view(next));
          }
        },
        {
          method: 'PUT', path: '/api/companies/:id',
          handler: async (req) => {
            admin(actorOf, req);
            const id = idOf(req);
            const next = guard(() => renameCompany(registry(), id, (req.body as { name?: unknown } | undefined)?.name));
            writeRegistry(deps.userDataDir, next);
            return view(next);
          }
        },
        {
          method: 'POST', path: '/api/companies/:id/open',
          handler: async (req) => {
            const actor = admin(actorOf, req);
            const id = idOf(req);
            const r = registry();
            if (id === deps.currentId) throw conflict('company_is_current');
            const next = guard(() => chooseCompany(r, id));
            // never limited by the plan (nobody is locked out of their own books); a file from a newer version is
            // refused here, before companies.json names it, so the next start never lands on it
            const dir = companyDirOf(deps.userDataDir, id);
            const server = onDatabaseServer(dir);
            if (!server && !hasCompanyFile(dir)) throw notFound('company');
            const file = join(dir, 'data', 'qasa.sqlite');
            if (!server) {
              const problem = companyFileProblem(file);
              // only a newer file is refused; a damaged one opens, and the app's start then offers Try again or
              // Restore from a backup (main.ts), so a damaged company is never out of reach
              if (problem === 'database_newer') throw conflict(problem);
              // the licence belongs to this PC: a company without one gets this company's, so activating in any
              // company never leaves another on Free
              const carried: [string, string][] = [];
              for (const key of CARRIED_SETTINGS) {
                const value = readSetting(deps.db, key);
                if (value != null) carried.push([key, value]);
              }
              if (!problem && carried.some(([key]) => key === 'license_key')) {
                // only a help: damage deeper in the file than its start must not stop it opening, where the app's
                // start offers Try again or Restore from a backup (the licence can be entered again there)
                try {
                  deps.makeCompanyFile(file, (other) => {
                    if (readSetting(other, 'license_key')) return;
                    // all or nothing: a key without its activation token would never be carried again (the next open
                    // sees the key and stops here)
                    other.exec('BEGIN IMMEDIATE');
                    try {
                      noteFirstStartBeforeCarry(deps.db, other);
                      for (const [key, value] of carried) writeSetting(other, key, value);
                      other.exec('COMMIT');
                    } catch (error) {
                      try { other.exec('ROLLBACK'); } catch { /* the error below says what went wrong */ }
                      throw error;
                    }
                  });
                } catch (e) {
                  deps.log(`company ${id}: the licence was not carried over (${e instanceof Error ? e.message : String(e)})`);
                }
              }
            }
            writeRegistry(deps.userDataDir, next);
            deps.log(`opening company ${id} (asked by ${actor.username || actor.name})`);
            // after this reply: the window then reloads on the other company
            setTimeout(() => deps.switchTo(id), 50);
            return { ok: true, reload: true };
          }
        },
        {
          method: 'POST', path: '/api/companies/:id/backup',
          handler: async (req) => {
            admin(actorOf, req);
            const id = idOf(req);
            const entry = registry().list.find((c) => c.id === id);
            if (!entry) throw notFound('company');
            const dir = companyDirOf(deps.userDataDir, id);
            const isCurrent = id === deps.currentId;
            if (isCurrent ? deps.db.dialect === 'mysql' : onDatabaseServer(dir)) throw conflict('company_on_server');
            if (!isCurrent && !hasCompanyFile(dir)) throw notFound('company');
            // with a backup password every copy is encrypted (Settings → Backups): never a plain copy to a folder that
            // may be synced to the cloud
            if (hasBackupPassword(dir)) throw conflict('company_backup_use_settings');
            const folder = await deps.chooseFolder();
            if (!folder) return { saved: null };
            const target = join(folder, backupFileName(entry.name, stamp(now())));
            if (existsSync(target)) throw conflict('company_backup_exists');
            // made under a temporary name and checked, so a failure never leaves half a copy under the real name
            const part = `${target}.part`;
            rmSync(part, { force: true });
            const quoted = `'${part.replace(/'/g, "''")}'`;
            try {
              if (isCurrent) {
                deps.db.exec(`VACUUM INTO ${quoted}`);
              } else {
                // the other company is closed: a consistent copy, read-only, never changing its file
                const other = new DatabaseSync(join(dir, 'data', 'qasa.sqlite'), { readOnly: true });
                try {
                  other.exec(`VACUUM INTO ${quoted}`);
                } finally {
                  other.close();
                }
              }
              const copy = new DatabaseSync(part, { readOnly: true });
              let sound = false;
              try {
                sound = (copy.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined)?.integrity_check === 'ok';
              } finally {
                copy.close();
              }
              if (!sound) throw new Error('the copy did not check out');
              renameSync(part, target);
            } catch (error) {
              rmSync(part, { force: true });
              throw error;
            }
            deps.log(`company ${id} backed up to ${target}`);
            return { saved: target };
          }
        }
      ];
    }
  };
}
