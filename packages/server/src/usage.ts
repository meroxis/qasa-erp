import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { APP_VERSION, isLang, type Lang } from '@qasa/core';
import type { Db } from './db.ts';
import { AppError } from './errors.ts';
import { planStatus } from './license.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';
import { getSettings } from './settings.ts';

/**
 * The anonymous usage ping: once a day the Windows app tells my.qasaerp.com that this installation is in use, so
 * Meroxis can see whether people who downloaded Qasa ERP use it. It sends only the fields in UsagePayload — never a
 * name, an amount or anything from the books — and nothing at all when it is switched off (Settings), when
 * QASA_NO_PING is set, in tests or in the website demo (which never starts it).
 */

export const PING_URL = 'https://my.qasaerp.com/api/v1/ping';
const STATE_FILE = 'usage.json';
const DAY_MS = 86_400_000;
const FIRST_DELAY_MS = 60_000;
const MAX_BACKOFF_MS = DAY_MS;

/** Exactly what is sent, and nothing more. */
export interface UsagePayload {
  /** A random id of this installation, kept in the app's own data folder (not in the company file). */
  install: string;
  version: string;
  os: string;
  lang: Lang;
  plan: 'free' | 'trial' | 'pro' | 'business';
  /** The licence number, only when a licence is activated on this PC. */
  licence: string | null;
  businessTypes: string[];
  companies: number;
  users: number;
  /** True on the first ping an installation ever sends. */
  firstRun: boolean;
}

interface UsageState {
  install: string;
  enabled: boolean;
  lang: Lang;
  /** When a ping last got through (ISO). */
  lastSent: string | null;
  failures: number;
}

export interface UsageOptions {
  /** The app's own data folder (Electron's userData). */
  dataDir: string;
  version?: string | undefined;
  /** 'windows', or process.platform elsewhere. */
  os?: string | undefined;
  /** How many companies this installation keeps (the desktop app knows its company files). */
  companies?: (() => number) | undefined;
  url?: string | undefined;
  /** For tests: a fake fetch and clock. Without a fetch given, pings never run under the test runner. */
  fetch?: typeof fetch | undefined;
  now?: (() => number) | undefined;
  log?: ((...args: unknown[]) => void) | undefined;
}

export interface UsagePinger {
  /** Sends a ping now (if switched on); resolves true when it got through. */
  pingNow(): Promise<boolean>;
  /** What would be sent now — the same object the settings card shows. */
  preview(): UsagePayload;
  stop(): void;
}

let current: { db: Db; options: UsageOptions; pinger: UsagePinger } | null = null;

const osName = (os?: string) => os ?? (process.platform === 'win32' ? 'windows' : process.platform);

function statePath(dataDir: string): string {
  return join(dataDir, STATE_FILE);
}

function readState(dataDir: string): UsageState {
  const file = statePath(dataDir);
  try {
    if (existsSync(file)) {
      const s = JSON.parse(readFileSync(file, 'utf8')) as Partial<UsageState>;
      if (typeof s.install === 'string' && /^[0-9a-f-]{36}$/.test(s.install)) {
        return {
          install: s.install,
          enabled: s.enabled !== false,
          lang: isLang(s.lang) ? s.lang : 'ar',
          lastSent: typeof s.lastSent === 'string' ? s.lastSent : null,
          failures: Number.isInteger(s.failures) && (s.failures as number) >= 0 ? (s.failures as number) : 0
        };
      }
    }
  } catch {
    // a damaged file: start afresh below (a new install id)
  }
  const fresh: UsageState = { install: randomUUID(), enabled: true, lang: 'ar', lastSent: null, failures: 0 };
  writeState(dataDir, fresh);
  return fresh;
}

function writeState(dataDir: string, state: UsageState): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    const file = statePath(dataDir);
    writeFileSync(file + '.tmp', JSON.stringify(state, null, 2));
    renameSync(file + '.tmp', file);
  } catch {
    // never let the ping get in the way of the app
  }
}

const activeUsers = (db: Db) => Number((db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get() as { n: number }).n);

/** The ping's content, built from the plan, the business types and counts only. */
export function usagePayload(db: Db, options: UsageOptions, state: UsageState): UsagePayload {
  const plan = planStatus(db);
  const activated = plan.source === 'license' && plan.activation.state === 'active';
  return {
    install: state.install,
    version: options.version ?? APP_VERSION,
    os: osName(options.os),
    lang: state.lang,
    plan: plan.source === 'trial' ? 'trial' : plan.plan,
    licence: activated && plan.license ? plan.license.id : null,
    businessTypes: [...(getSettings(db).businessTypes ?? [])],
    companies: Math.max(1, Math.floor(options.companies?.() ?? 1)),
    users: activeUsers(db),
    firstRun: state.lastSent === null
  };
}

/** Pings are off by request (QASA_NO_PING) and under the test runner unless a test hands in its own fetch. */
function pingsAllowed(options: UsageOptions): boolean {
  if (process.env.QASA_NO_PING) return false;
  if ((process.env.VITEST || process.env.NODE_ENV === 'test') && !options.fetch) return false;
  return true;
}

/** Starts the daily ping (the Windows app calls this once its company database is open). */
export function startUsagePings(db: Db, options: UsageOptions): UsagePinger {
  current?.pinger.stop();
  const now = () => (options.now ? options.now() : Date.now());
  const doFetch = options.fetch ?? fetch;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let inFlight: Promise<boolean> | null = null;

  const schedule = (ms: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void tick(), ms);
    timer.unref?.();
  };

  async function send(): Promise<boolean> {
    const state = readState(options.dataDir);
    if (!state.enabled || !pingsAllowed(options)) return false;
    let ok = false;
    try {
      const payload = usagePayload(db, options, state);
      const res = await doFetch(options.url ?? PING_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000)
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    const after = readState(options.dataDir);
    if (ok) writeState(options.dataDir, { ...after, lastSent: new Date(now()).toISOString(), failures: 0 });
    else writeState(options.dataDir, { ...after, failures: after.failures + 1 });
    return ok;
  }

  async function tick(): Promise<void> {
    const ok = await pingNow();
    const failures = readState(options.dataDir).failures;
    // after a failure try again sooner, doubling each time (1 min, 2 min, 4 min …), never more than a day apart
    schedule(ok ? DAY_MS : Math.min(MAX_BACKOFF_MS, FIRST_DELAY_MS * 2 ** Math.max(0, failures - 1)));
  }

  function pingNow(): Promise<boolean> {
    inFlight ??= send().finally(() => { inFlight = null; });
    return inFlight;
  }

  const pinger: UsagePinger = {
    pingNow,
    preview: () => usagePayload(db, options, readState(options.dataDir)),
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (current?.pinger === pinger) current = null;
    }
  };
  current = { db, options, pinger };

  // the first ping a minute after start, then daily (sooner when the last daily ping is overdue)
  if (pingsAllowed(options)) {
    const last = readState(options.dataDir).lastSent;
    const due = last ? Math.max(FIRST_DELAY_MS, Date.parse(last) + DAY_MS - now()) : FIRST_DELAY_MS;
    schedule(Math.min(due, DAY_MS));
  }
  return pinger;
}

/** For tests. */
export function stopUsagePingsForTests(): void {
  current?.pinger.stop();
  current = null;
}

export interface UsageView {
  /** False where nothing is ever sent (the website demo, development without a data folder, QASA_NO_PING). */
  available: boolean;
  enabled: boolean;
  lastSent: string | null;
  /** Exactly what is sent. */
  payload: UsagePayload | null;
}

function view(): UsageView {
  if (!current || !pingsAllowed(current.options)) return { available: false, enabled: false, lastSent: null, payload: null };
  const state = readState(current.options.dataDir);
  return { available: true, enabled: state.enabled, lastSent: state.lastSent, payload: current.pinger.preview() };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

/**
 * The settings card's API: reading is open to signed-in users; switching it on or off is for an admin (not listed
 * in rules); the app's language may be told by anyone signed in (it only picks the language field of the ping).
 */
export const usageApi: ApiExtension = {
  rules: { 'POST /api/usage/context': null },
  routes() {
    return [
      { method: 'GET', path: '/api/usage', handler: async () => view() },
      {
        method: 'PUT', path: '/api/usage',
        handler: async (req: ApiRequest) => {
          const body = parse(z.object({ enabled: z.boolean() }), req.body);
          if (current) writeState(current.options.dataDir, { ...readState(current.options.dataDir), enabled: body.enabled });
          return view();
        }
      },
      {
        method: 'POST', path: '/api/usage/context',
        handler: async (req: ApiRequest) => {
          const body = parse(z.object({ lang: z.enum(['ar', 'en', 'ku']) }), req.body);
          if (current) {
            const state = readState(current.options.dataDir);
            if (state.lang !== body.lang) writeState(current.options.dataDir, { ...state, lang: body.lang });
          }
          return { ok: true };
        }
      }
    ];
  }
};
