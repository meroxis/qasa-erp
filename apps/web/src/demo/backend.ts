import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import {
  ApiReply, apiRoutes, errorResponse, initDatabase, seedClothingDemo, seedDemo, seedRestaurantDemo, seedGoldDemo, seedMarketDemo, seedPetrolStationDemo, seedPharmacyDemo, seedPhoneShopDemo,
  seedWholesaleDemo, startDemoMonth, type Db, type Route
} from '@qasa/server/browser';
import { DatabaseSync } from './node-sqlite.ts';

/**
 * The phone-shop sample's pictures, as base64 by item code: drawn for the demo by Meroxis (own work, no photos of real
 * products). Fetched only when the phone shop is asked for.
 */
async function phoneShopPictures(): Promise<Record<string, string>> {
  const files = import.meta.glob('./phone-shop/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(files)) {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out[path.replace(/^.*\/(.+)\.png$/, '$1')] = btoa(bin);
  }
  return out;
}

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
  // ?petrol in the address opens the sample company as a petrol station
  // (named in the language the visitor reads: its tanks and the wording of its entries);
  // ?phoneshop opens it as a phone shop, with its pictures (the till's big pictures and quick buttons);
  // without either the demo is the sample company as always
  const demoKind = new URLSearchParams(window.location.search);
  // 2.0: ?market, ?gold, ?wholesale, ?clothing and ?pharmacy (2.1: and ?restaurant) open it as those businesses; every demo runs in the free
  // first month, so the paid pages show what they do instead of asking for a plan
  startDemoMonth(db);
  if (demoKind.has('petrol')) seedPetrolStationDemo(db, demoLang());
  else if (demoKind.has('phoneshop')) seedPhoneShopDemo(db, await phoneShopPictures());
  else if (demoKind.has('market')) seedMarketDemo(db);
  else if (demoKind.has('gold')) seedGoldDemo(db);
  else if (demoKind.has('wholesale')) seedWholesaleDemo(db);
  else if (demoKind.has('clothing')) seedClothingDemo(db);
  else if (demoKind.has('restaurant')) seedRestaurantDemo(db);
  else if (demoKind.has('pharmacy')) seedPharmacyDemo(db);

  const routes = apiRoutes(db, { demo: true }).map((route) => ({ route, pattern: compile(route.path) }));
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    // invoice QR codes are signed by the Windows app only; the demo prints invoices without one
    if (url.pathname.startsWith('/api/verify/')) return json(404, { error: 'not_found', details: null });
    for (const { route, pattern } of routes) {
      if (route.method !== method) continue;
      const match = pattern.exec(url.pathname);
      if (!match) continue;
      return handle(route, match.groups ?? {}, url, init);
    }
    return json(404, { error: 'not_found', details: null });
  };
}

/** The language the app opens in (App.tsx keeps it as qasa.lang); Arabic when none is kept or storage is closed. */
function demoLang(): 'ar' | 'en' | 'ku' {
  try {
    const kept = window.localStorage.getItem('qasa.lang');
    return kept === 'en' || kept === 'ku' ? kept : 'ar';
  } catch {
    return 'ar';
  }
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
