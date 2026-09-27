import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { ApiReply, apiRoutes, errorResponse, initDatabase, seedDemo, type Db, type Route } from '@qasa/server/browser';
import { DatabaseSync } from './node-sqlite.ts';

/**
 * The website demo has no server: the real API runs in the page, on SQLite in WebAssembly, filled with the
 * sample company. Requests to /api/… never leave the browser, and a reload starts the demo afresh.
 */
export async function startDemoBackend(): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const raw = new SQL.Database();
  const db = new DatabaseSync(raw) as unknown as Db;
  db.exec('PRAGMA foreign_keys = ON');
  initDatabase(db);
  seedDemo(db);

  const routes = apiRoutes(db, { demo: true }).map((route) => ({ route, pattern: compile(route.path) }));
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    for (const { route, pattern } of routes) {
      if (route.method !== method) continue;
      const match = pattern.exec(url.pathname);
      if (!match) continue;
      return handle(route, match.groups ?? {}, url, init);
    }
    return json(404, { error: 'not_found', details: null });
  };
}

function compile(path: string): RegExp {
  const source = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\/:(\w+)/g, '/(?<$1>[^/]+)');
  return new RegExp(`^${source}$`);
}

async function handle(route: Route, params: Record<string, string>, url: URL, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
  let body: unknown;
  try {
    body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
  } catch {
    return json(400, { error: 'bad_request', details: null });
  }
  const decoded = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, decodeURIComponent(v)]));
  const reply = new ApiReply();
  try {
    const result = await route.handler({ params: decoded, query: Object.fromEntries(url.searchParams), body, headers }, reply);
    if (reply.sent) return reply.statusCode === 204 ? new Response(null, { status: 204 }) : json(reply.statusCode, reply.payload);
    return json(200, result);
  } catch (error) {
    const response = errorResponse(error);
    if (response.status === 500) console.error(error);
    return json(response.status, response.body);
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
