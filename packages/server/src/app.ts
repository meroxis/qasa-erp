import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import { ApiReply, apiRoutes, errorResponse, type ApiExtension, type ApiRequest } from './routes.ts';

/** Large enough for an Excel import of a few thousand rows and an item picture; the default (1 MB) is too small. */
const BODY_LIMIT = 8 * 1024 * 1024;

/** The names this PC's own server answers to (plain http, this PC only). */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const isLoopbackIp = (ip: string): boolean => ip === '::1' || ip.startsWith('127.') || ip.startsWith('::ffff:127.');

/** The host name of a Host header, lower case, without its port ("[::1]:4417" → "[::1]"). */
export function hostNameOf(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0] ?? '';
}

/**
 * Whether a browser request may reach the API:
 * - a page of another site never changes anything: a change (any method but GET and HEAD) that names an Origin must
 *   come from this server's own origin (cross-site form posts and fetch() calls, which need no preflight, are refused);
 * - on plain http (this PC's own server, or one run from the source code) the Host must be one of this PC's own
 *   names, so a site whose name was pointed at 127.0.0.1 (DNS rebinding) can't read or change the books either.
 * Requests that name no Origin or Host (not from a browser page) pass: they are the app's own or a program's.
 */
export function requestRefusal(
  req: { method: string; headers: Record<string, string | string[] | undefined> }, https: boolean, allowedHosts: ReadonlySet<string> = LOOPBACK_HOSTS
): 'host' | 'origin' | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const host = one(req.headers.host);
  if (!https && host !== undefined && !allowedHosts.has(hostNameOf(host))) return 'host';
  const origin = one(req.headers.origin);
  if (origin !== undefined && req.method !== 'GET' && req.method !== 'HEAD') {
    let originHost: string | null = null;
    try {
      const url = new URL(origin);
      if (url.protocol === 'http:' || url.protocol === 'https:') originHost = url.host.toLowerCase();
    } catch { /* "null" or not a URL: a sandboxed or file page */ }
    if (!originHost || !host || originHost !== host.trim().toLowerCase()) return 'origin';
  }
  return null;
}

/**
 * What a module may serve beside the app's own routes (the Pro module adds them to this server once it is built), by
 * the address that answers when it is there. /api/auth/me names the ones this build has, so the app does not ask for
 * the others: a build without the module has no backups card to load, no office network, phones or database server,
 * no medicines to look up at the till (pharmacy) and no licence check of the module's own (pro).
 */
export const MODULE_ROUTES: Readonly<Record<string, string>> = {
  backup: '/api/backup', network: '/api/network', phones: '/api/phones', database: '/api/database',
  pharmacy: '/api/pharmacy', pro: '/api/pro/licence-check',
  // 1.5: work from phones, told at every office PC (pro/src/phone/activity.ts: on the office network and Qasa Relay too)
  phoneActivity: '/api/phone-activity'
};

/**
 * https: the office network serves the same app over TLS with its own certificate (the Pro module).
 * extensions: routes a module adds (the Pro module's), served with the app's own.
 * allowedHosts: more names a plain-http server answers to (a server run from the source code for the office network).
 * clientSource: names where a request really comes from when the address alone can't tell (Qasa Relay: every PC
 * arrives from 127.0.0.1, the relay knows each one's own address). Sign-in failures are counted per source.
 */
let viewOnly: (() => boolean) | null = null;
/**
 * The Windows app with several companies: a company past the plan's company limit opens to be viewed, not changed.
 * Asked at each change, so it follows the licence (a check-in that brings the plan back lifts it at once). Every server
 * built here refuses changes then (this PC's, the office network's, the phones'), with 409 company_view_only. Only the
 * requests listed in VIEW_ONLY_ALLOWED still pass.
 */
export function configureViewOnly(check: (() => boolean) | null): void {
  viewOnly = check;
}
/**
 * The only requests that change something and that a view-only company still takes, each by its method and its exact
 * route (round four of the review: whole address prefixes used to be open, so switching sign-in or separate duties
 * off, or restoring a cloud backup over the company file, passed). A route not written here is refused: one added
 * later under /api/auth or /api/backup is closed until someone decides otherwise.
 */
export const VIEW_ONLY_ALLOWED: ReadonlySet<string> = new Set([
  // signing in and out, and one's own password (a leaked password must never have to wait for the plan)
  'POST /api/auth/login', 'POST /api/auth/logout', 'POST /api/auth/password',
  // the licence and the plan: how a company stops being view-only
  'POST /api/plan/license', 'DELETE /api/plan/license', 'POST /api/plan/trial', 'POST /api/plan/activate', 'POST /api/plan/check', 'POST /api/plan/deactivate',
  // the companies of this PC (the Windows app): another one made, renamed, opened, backed up
  'POST /api/companies', 'PUT /api/companies/:id', 'POST /api/companies/:id/open', 'POST /api/companies/:id/backup',
  // the usage setting (kept on this PC, not in the company)
  'PUT /api/usage', 'POST /api/usage/context',
  // backups: set up and made, to a folder or the cloud. Never one put in place of the company file (the two restores)
  'PUT /api/backup', 'PUT /api/backup/password', 'POST /api/backup/local-notice', 'POST /api/backup/folder', 'POST /api/backup/close-folder', 'POST /api/backup/run',
  'POST /api/backup/cloud/connect', 'POST /api/backup/cloud/cancel', 'POST /api/backup/cloud/disconnect', 'POST /api/backup/cloud/upload'
]);
/** each allowed route as a pattern for an address that matched no route (`:id` is one part of the path) */
const VIEW_ONLY_PATTERNS = [...VIEW_ONLY_ALLOWED].map((entry) => {
  const [method, route] = entry.split(' ') as [string, string];
  return { method, test: new RegExp(`^${route.split('/').map((part) => (part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`) };
});
/**
 * Whether a request would change the company's records (so a view-only company refuses it). `url`: the route the
 * request was matched to ("/api/companies/:id/open"), or its address when it matched none.
 */
export function changesRecords(method: string, url: string): boolean {
  const verb = method.toUpperCase();
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return false;
  // the path as the router reads it: percent-escapes undone ("/%61pi/items" is /api/items), doubled slashes and a
  // trailing one dropped; one that can't be read counts as a change
  let path = url.split('?')[0] ?? '';
  try { path = decodeURIComponent(path); } catch { return true; }
  path = path.replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1');
  if (!path.startsWith('/api/')) return false;
  if (VIEW_ONLY_ALLOWED.has(`${verb} ${path}`)) return false;
  return !VIEW_ONLY_PATTERNS.some((p) => p.method === verb && p.test.test(path));
}

/** The routes of each server built here, as they were registered (the view-only sweep reads them: view-only.test.ts). */
const ROUTES = new WeakMap<object, { method: string; url: string }[]>();
export function registeredRoutes(app: FastifyInstance): readonly { method: string; url: string }[] {
  return ROUTES.get(app) ?? [];
}

export function buildApp(db: Db, options: {
  https?: { key: string; cert: string };
  extensions?: readonly ApiExtension[];
  allowedHosts?: readonly string[];
  clientSource?: (req: FastifyRequest) => string | undefined;
} = {}): FastifyInstance {
  const app = (options.https ? Fastify({ logger: false, https: options.https, bodyLimit: BODY_LIMIT }) : Fastify({ logger: false, bodyLimit: BODY_LIMIT })) as unknown as FastifyInstance;
  const https = !!options.https;
  const routes: { method: string; url: string }[] = [];
  ROUTES.set(app, routes);
  app.addHook('onRoute', (route) => { for (const method of [route.method].flat()) routes.push({ method: String(method).toUpperCase(), url: route.url }); });
  const allowedHosts = new Set([...LOOPBACK_HOSTS, ...(options.allowedHosts ?? []).map((h) => hostNameOf(h)).filter(Boolean)]);

  app.addHook('onRequest', async (req, reply) => {
    const refused = requestRefusal(req, https, allowedHosts);
    if (refused) return reply.status(403).send({ error: 'forbidden', details: { reason: refused } });
    // judged by the route the request was matched to (what will really run), not by how its address was written:
    // an escaped or oddly written address reaches the same route (review of the fixes, finding 9)
    const route = (req as { routeOptions?: { url?: string } }).routeOptions?.url;
    if (viewOnly && changesRecords(req.method, route ?? req.url) && viewOnly()) return reply.status(409).send({ error: 'company_view_only', details: null });
  });

  /** Where a request comes from: this PC's own server only on plain http from this PC's own address. */
  const sourceOf = (req: FastifyRequest): string => {
    const named = options.clientSource?.(req);
    if (named) return `net:${named}`.slice(0, 100);
    // every loopback address (127.x.y.z, ::1) is this PC, one place: a program here can't rotate them to guess
    // passwords without the per-place limit (security review #8)
    if (!https && isLoopbackIp(req.ip)) return 'local:loopback';
    return `net:${req.ip}`.slice(0, 100);
  };

  app.setErrorHandler((error, _req, reply) => {
    const response = errorResponse(error);
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (response.status === 500 && statusCode && statusCode < 500) {
      return reply.status(statusCode).send({ error: 'bad_request', details: error instanceof Error ? error.message : String(error) });
    }
    if (response.status === 500) console.error(error);
    return reply.status(response.status).send(response.body);
  });

  // asked at each request: a module adds its routes after the app is built
  const modules = () => Object.entries(MODULE_ROUTES).filter(([, url]) => app.hasRoute({ method: 'GET', url })).map(([name]) => name);
  for (const route of apiRoutes(db, { extensions: options.extensions ?? [], modules })) {
    app.route({
      method: route.method,
      url: route.path,
      handler: async (req, reply) => {
        const out = new ApiReply();
        const request: ApiRequest = {
          params: req.params, query: req.query, body: req.body, headers: req.headers, secure: req.protocol === 'https', source: sourceOf(req)
        };
        const result = await route.handler(request, out);
        for (const [name, value] of Object.entries(out.headers)) reply.header(name, value);
        return out.sent ? reply.status(out.statusCode).send(out.payload) : result;
      }
    });
  }

  return app;
}
