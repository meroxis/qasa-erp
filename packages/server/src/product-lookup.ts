import { z } from 'zod';
import {
  APP_VERSION, isProductSource, PRODUCT_IMAGE_LICENCE, PRODUCT_SOURCE_SITES, publicBarcode, type ProductSource
} from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { parse } from './categories.ts';
import { imageMime, MAX_IMAGE_BYTES, setItemImage, toBase64, type ImageMime } from './media.ts';
import { readSetting, writeSetting } from './settings.ts';
import type { ApiExtension } from './routes.ts';

/**
 * Product lookup (2.0, every plan): a product's picture and name from its barcode, out of the open product databases
 * (Open Food Facts and its sister projects: beauty, pet food, other products). Free, no account, no key.
 *
 * What leaves the building, and when:
 *  - Nothing, until an admin switches "Look up product pictures and names online" on (Settings; off by default).
 *  - Then only the barcode number, and only of a barcode a manufacturer printed (core product-lookup.ts: never a
 *    scale's label, a number the shop gave an item itself, or a short code). No name, price, company or user.
 *  - Only this server asks (the page itself may talk to nobody else), only the databases' own addresses over https
 *    (HOSTS below; a redirect anywhere else is refused), for at most three seconds and a bounded size.
 *
 * What comes back is somebody else's text and bytes: names are cut to plain short text, a picture is taken only when
 * its first bytes say JPEG, PNG or WebP and it fits an item's picture as it is (the 400-pixel version they serve,
 * else the 200-pixel one; the server never re-encodes pictures). Nothing is stored for an item until the person saves
 * it; the answer itself is kept a while (product_lookups, a "not found" too) so the same barcode is not asked twice.
 *
 * Their rules (https://openfoodfacts.github.io/openfoodfacts-server/api/, read November 2026): a User-Agent that names
 * the app, its version and a contact; at most 15 product reads a minute from one address (the app keeps to 10, per
 * company and for the whole server). The data is under the Open Database License, the pictures under Creative Commons
 * Attribution-ShareAlike: a picture saved from them keeps its source (item_image_sources) for the credit line.
 */

const API_HOSTS: Record<ProductSource, string> = {
  openfoodfacts: 'world.openfoodfacts.org',
  openbeautyfacts: 'world.openbeautyfacts.org',
  openproductsfacts: 'world.openproductsfacts.org',
  openpetfoodfacts: 'world.openpetfoodfacts.org'
};
const IMAGE_HOSTS: ReadonlySet<string> = new Set(['images.openfoodfacts.org', 'images.openbeautyfacts.org', 'images.openproductsfacts.org', 'images.openpetfoodfacts.org']);
/** Every address the lookup may talk to: the four databases' API hosts and picture hosts, nothing else. */
export const LOOKUP_HOSTS: ReadonlySet<string> = new Set([...Object.values(API_HOSTS), ...IMAGE_HOSTS]);
/** The database that keeps a product of each type (their answer names the type when a barcode is in a sister project). */
const TYPE_SOURCE: Record<string, ProductSource> = { food: 'openfoodfacts', beauty: 'openbeautyfacts', product: 'openproductsfacts', petfood: 'openpetfoodfacts' };

export const LOOKUP_USER_AGENT = `QasaERP/${APP_VERSION} (info@qasaerp.com; https://qasaerp.com)`;
const FIELDS = 'code,product_name,product_name_ar,product_name_en,product_name_ku,product_name_ckb,brands,quantity,image_front_url,image_front_small_url';
export const LOOKUP_TIMEOUT_MS = 3000;
const MAX_JSON_BYTES = 256 * 1024;
/** A download is stopped here; a picture is used only when it fits an item's picture (MAX_IMAGE_BYTES). */
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
/** Product reads a minute: theirs is 15 from one address. */
export const LOOKUP_READS_PER_MINUTE = 10;
const IMAGES_PER_MINUTE = 30;
const FOUND_DAYS = 30;
const NOT_FOUND_DAYS = 7;
const MAX_CACHE_ROWS = 5000;
const MAX_TEXT = 120;
/** The bulk search asks about one item, then waits this long: 6 a minute, so the forms still get their answers. */
export const BULK_PACE_MS = 10_000;

/* ---------- what tests replace: the network, the clock and the waiting ---------- */

interface Env { fetch: typeof fetch | null; now: () => number; sleep: (ms: number) => Promise<void>; server: boolean | null }
const realSleep = (ms: number) => new Promise<void>((resolve) => { const t = setTimeout(resolve, ms); (t as { unref?: () => void }).unref?.(); });
const env: Env = { fetch: null, now: () => Date.now(), sleep: realSleep, server: null };
/** Tests only: another network, clock or wait (`null` puts the real one back), and whether this is a server at all. */
export function configureProductLookup(options: Partial<Env>): void {
  Object.assign(env, options);
}
/** Tests only: everything back as the app starts (no counts, no search running). */
export function resetProductLookup(): void {
  env.fetch = null; env.now = () => Date.now(); env.sleep = realSleep; env.server = null;
  globalReads.length = 0;
  for (const job of JOBS) job.stop = true;
  JOBS.clear();
  STATE = new WeakMap();
}
/** The website demo answers in the browser, which may talk to nobody: there the lookup does not exist. */
const onServer = (): boolean => env.server ?? (typeof (globalThis as { window?: unknown }).window === 'undefined' && typeof fetch === 'function');

/* ---------- the setting ---------- */

export interface LookupSettings {
  /** an admin switched it on (off by default) */
  enabled: boolean;
  /** the one-time question was answered (yes or no): it is not asked again */
  asked: boolean;
  /** false where there is no server to ask from (the website demo) */
  available: boolean;
}
export function lookupSettings(db: Db): LookupSettings {
  const available = onServer();
  return { enabled: available && readSetting(db, 'product_lookup') === '1', asked: readSetting(db, 'product_lookup_asked') === '1', available };
}
export function setLookupSettings(db: Db, patch: { enabled?: boolean | undefined }, user: string): LookupSettings {
  transaction(db, () => {
    if (patch.enabled !== undefined) writeSetting(db, 'product_lookup', patch.enabled ? '1' : '0');
    // either answer is an answer: the question is not put again
    writeSetting(db, 'product_lookup_asked', '1');
    audit(db, user, 'update', 'settings', 'product_lookup', patch);
  });
  if (patch.enabled === false) stopBulk(db);
  return lookupSettings(db);
}

/* ---------- counting requests ---------- */

interface CompanyState { reads: number[]; images: number[]; inflight: Map<string, Promise<LookupRow | 'busy' | 'unreachable'>>; job: BulkJob | null }
let STATE = new WeakMap<Db, CompanyState>();
const globalReads: number[] = [];
function stateOf(db: Db): CompanyState {
  let s = STATE.get(db);
  if (!s) { s = { reads: [], images: [], inflight: new Map(), job: null }; STATE.set(db, s); }
  return s;
}
/** Takes one of `limit` a minute from each list, or none from any: false when one of them is full. */
function take(lists: number[][], limit: number): boolean {
  const now = env.now();
  for (const list of lists) {
    while (list.length && now - list[0]! >= 60_000) list.shift();
    if (list.length >= limit) return false;
  }
  for (const list of lists) list.push(now);
  return true;
}

/* ---------- asking, with the limits ---------- */

/** The address as it may be asked: https, one of `hosts`, no user, no port. Null for anything else. */
export function allowedUrl(address: string, hosts: ReadonlySet<string>): URL | null {
  let url: URL;
  try { url = new URL(address); } catch { return null; }
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password || url.port) return null;
  return url;
}

interface Fetched { status: number; type: string; bytes: Uint8Array }
/**
 * One GET within the limits: only `hosts`, a redirect followed twice at most and only to one of them, three seconds
 * for the whole of it, and never more than `maxBytes` read. Null when any of that fails (no network, too slow, too big).
 */
async function guardedGet(address: string, hosts: ReadonlySet<string>, accept: string, maxBytes: number): Promise<Fetched | null> {
  const fetchFn = env.fetch ?? fetch;
  let url = allowedUrl(address, hosts);
  const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
  try {
    for (let hop = 0; url && hop < 3; hop++) {
      const res = await fetchFn(url.toString(), { redirect: 'manual', signal, headers: { 'user-agent': LOOKUP_USER_AGENT, accept }, credentials: 'omit' });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => {});
        url = location ? allowedUrl(new URL(location, url).toString(), hosts) : null;
        continue;
      }
      if (Number(res.headers.get('content-length') ?? 0) > maxBytes) { await res.body?.cancel().catch(() => {}); return null; }
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maxBytes) { await reader.cancel().catch(() => {}); return null; }
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) { bytes.set(c, at); at += c.length; }
      return { status: res.status, type: (res.headers.get('content-type') ?? '').toLowerCase(), bytes };
    }
  } catch {
    return null;
  }
  return null;
}

/* ---------- reading their answer ---------- */

/** Somebody else's text as plain short text: no control or direction characters, single spaces, cut. Null when empty. */
export function plainText(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== 'string') return null;
  // (the zero-width non-joiner stays: Kurdish and Persian words are written with it)
  const text = value.replace(/[\p{Cc}​‎‏‪-‮⁦-⁩﻿]/gu, ' ').replace(/\s+/g, ' ').trim();
  return text ? [...text].slice(0, max).join('').trim() : null;
}

export interface LookupRow {
  barcode: string; found: boolean; source: ProductSource | null;
  name: string | null; nameAr: string | null; nameEn: string | null; nameKu: string | null; brand: string | null; quantity: string | null;
  imageUrl: string | null; imageSmallUrl: string | null; pageUrl: string | null;
}
const notFoundRow = (barcode: string): LookupRow =>
  ({ barcode, found: false, source: null, name: null, nameAr: null, nameEn: null, nameKu: null, brand: null, quantity: null, imageUrl: null, imageSmallUrl: null, pageUrl: null });

export type ApiAnswer = { kind: 'found'; row: LookupRow } | { kind: 'not_found' } | { kind: 'elsewhere'; source: ProductSource } | { kind: 'unreadable' };

/** What one database answered for a barcode (`status` and `body` as received): found, not there, or kept by a sister project. */
export function readProductAnswer(source: ProductSource, barcode: string, status: number, body: string): ApiAnswer {
  let json: unknown;
  try { json = JSON.parse(body); } catch { return { kind: 'unreadable' }; }
  if (!json || typeof json !== 'object') return { kind: 'unreadable' };
  const answer = json as { status?: unknown; status_verbose?: unknown; product?: unknown };
  if (status === 200 && Number(answer.status) === 1 && answer.product && typeof answer.product === 'object') {
    const p = answer.product as Record<string, unknown>;
    const picture = (v: unknown) => (typeof v === 'string' && v.length <= 500 && allowedUrl(v, IMAGE_HOSTS) ? v : null);
    const row: LookupRow = {
      barcode, found: true, source,
      name: plainText(p.product_name), nameAr: plainText(p.product_name_ar), nameEn: plainText(p.product_name_en),
      nameKu: plainText(p.product_name_ckb) ?? plainText(p.product_name_ku),
      // "Brand A, Brand B": the first is the one on the pack
      brand: plainText(typeof p.brands === 'string' ? p.brands.split(',')[0] : null, 60), quantity: plainText(p.quantity, 30),
      imageUrl: picture(p.image_front_url), imageSmallUrl: picture(p.image_front_small_url),
      pageUrl: `${PRODUCT_SOURCE_SITES[source]}/product/${barcode}`
    };
    // a page with neither a name nor a picture helps nobody: the same as not found
    return row.name || row.nameAr || row.nameEn || row.nameKu || row.imageUrl || row.imageSmallUrl ? { kind: 'found', row } : { kind: 'not_found' };
  }
  if ((status === 200 || status === 404) && Number(answer.status) === 0) {
    const type = /different product type: (\w+)/.exec(typeof answer.status_verbose === 'string' ? answer.status_verbose : '')?.[1];
    const other = type ? TYPE_SOURCE[type] : undefined;
    return other && other !== source ? { kind: 'elsewhere', source: other } : { kind: 'not_found' };
  }
  return { kind: 'unreadable' };
}

/** A name suggestion: its language (the field it would fill) and the text. */
export interface NameSuggestion { lang: 'ar' | 'en' | 'ku'; text: string }

const ARABIC_SCRIPT = /[؀-ۿ]/;
/**
 * The names offered for a product, at most four: its Arabic, English and Kurdish names as the database has them (its
 * main name counts as Arabic when it is written in Arabic letters, else as English), then the first of them with the
 * size after it ("Coca-Cola 330 ml") when the name does not say it already.
 */
export function nameSuggestions(row: Pick<LookupRow, 'name' | 'nameAr' | 'nameEn' | 'nameKu' | 'quantity'>): NameSuggestion[] {
  const out: NameSuggestion[] = [];
  const add = (lang: NameSuggestion['lang'], text: string | null) => {
    if (text && !out.some((s) => s.text.toLowerCase() === text.toLowerCase())) out.push({ lang, text });
  };
  const mainIsArabic = !!row.name && ARABIC_SCRIPT.test(row.name);
  add('ar', row.nameAr ?? (mainIsArabic ? row.name : null));
  add('en', row.nameEn ?? (mainIsArabic ? null : row.name));
  add('ku', row.nameKu);
  if (row.name) add(mainIsArabic ? 'ar' : 'en', row.name);
  const sized = out.slice(0, 2).flatMap((s) => (row.quantity && !s.text.toLowerCase().includes(row.quantity.toLowerCase()) ? [{ lang: s.lang, text: `${s.text} ${row.quantity}` }] : []));
  for (const s of sized) add(s.lang, s.text);
  return out.slice(0, 4);
}

/* ---------- what is kept of an answer ---------- */

interface CacheRow {
  barcode: string; found: number; source: string | null; name: string | null; name_ar: string | null; name_en: string | null; name_ku: string | null;
  brand: string | null; quantity: string | null; image_url: string | null; image_small_url: string | null; page_url: string | null; looked_at: string;
}
/** The answer kept for a barcode while it is fresh (found: 30 days; not found: 7), else null. */
export function cachedLookup(db: Db, barcode: string): LookupRow | null {
  const r = db.prepare('SELECT * FROM product_lookups WHERE barcode = ?').get(barcode) as CacheRow | undefined;
  if (!r) return null;
  const found = Number(r.found) === 1 && isProductSource(r.source);
  const age = env.now() - Date.parse(r.looked_at);
  if (!(age >= 0) || age > (found ? FOUND_DAYS : NOT_FOUND_DAYS) * 86_400_000) return null;
  if (!found) return notFoundRow(barcode);
  // the addresses are checked again on the way out: only the databases' own picture hosts are ever asked
  const picture = (v: string | null) => (v && allowedUrl(v, IMAGE_HOSTS) ? v : null);
  return {
    barcode, found: true, source: r.source as ProductSource, name: r.name, nameAr: r.name_ar, nameEn: r.name_en, nameKu: r.name_ku, brand: r.brand, quantity: r.quantity,
    imageUrl: picture(r.image_url), imageSmallUrl: picture(r.image_small_url), pageUrl: r.page_url
  };
}
function keepLookup(db: Db, row: LookupRow): void {
  const now = new Date(env.now()).toISOString();
  transaction(db, () => {
    db.prepare('DELETE FROM product_lookups WHERE barcode = ?').run(row.barcode);
    db.prepare(`INSERT INTO product_lookups (barcode, found, source, name, name_ar, name_en, name_ku, brand, quantity, image_url, image_small_url, page_url, looked_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.barcode, row.found ? 1 : 0, row.source, row.name, row.nameAr, row.nameEn, row.nameKu, row.brand, row.quantity, row.imageUrl, row.imageSmallUrl, row.pageUrl, now);
    // answers too old to be read again go, and the list never grows past its size (the oldest first)
    db.prepare('DELETE FROM product_lookups WHERE looked_at < ?').run(new Date(env.now() - FOUND_DAYS * 86_400_000).toISOString());
    const edge = db.prepare(`SELECT looked_at FROM product_lookups ORDER BY looked_at DESC LIMIT 1 OFFSET ${MAX_CACHE_ROWS}`).get() as { looked_at: string } | undefined;
    if (edge) db.prepare('DELETE FROM product_lookups WHERE looked_at <= ?').run(edge.looked_at);
  });
}

/* ---------- the lookup ---------- */

/** Asks the databases about a barcode that may be asked about (at most two reads: the food one, then the one it names). */
async function askDatabases(db: Db, barcode: string): Promise<LookupRow | 'busy' | 'unreachable'> {
  let source: ProductSource = 'openfoodfacts';
  for (let step = 0; step < 2; step++) {
    if (!take([stateOf(db).reads, globalReads], LOOKUP_READS_PER_MINUTE)) return 'busy';
    const got = await guardedGet(`https://${API_HOSTS[source]}/api/v2/product/${barcode}?fields=${FIELDS}`, new Set([API_HOSTS[source]]), 'application/json', MAX_JSON_BYTES);
    if (!got || !got.type.includes('application/json')) return 'unreachable';
    const answer = readProductAnswer(source, barcode, got.status, new TextDecoder().decode(got.bytes));
    if (answer.kind === 'unreadable') return 'unreachable';
    if (answer.kind === 'found') return answer.row;
    if (answer.kind === 'not_found') return notFoundRow(barcode);
    source = answer.source;
  }
  return notFoundRow(barcode);
}

/** The picture at one of their addresses, when it is a picture and fits an item's picture as it is. */
async function fetchPicture(db: Db, address: string): Promise<{ mime: ImageMime; bytes: Uint8Array } | null> {
  if (!take([stateOf(db).images], IMAGES_PER_MINUTE)) return null;
  const got = await guardedGet(address, IMAGE_HOSTS, 'image/jpeg,image/png,image/webp', MAX_DOWNLOAD_BYTES);
  if (!got || got.status !== 200 || !got.type.startsWith('image/') || got.bytes.length === 0 || got.bytes.length > MAX_IMAGE_BYTES) return null;
  // what the bytes are, whatever the header says
  const mime = imageMime(got.bytes);
  return mime ? { mime, bytes: got.bytes } : null;
}

export interface ProductLookupResult {
  found: boolean;
  /**
   * why there is nothing: the setting is off, the barcode is the shop's own (or no barcode), the databases don't have
   * it, too many were asked this minute, or they could not be reached
   */
  reason?: 'off' | 'own' | 'not_found' | 'busy' | 'unreachable';
  source?: ProductSource;
  names?: NameSuggestion[];
  brand?: string | null;
  quantity?: string | null;
  /** the picture, already downloaded and checked, small enough to be saved as it is; null when there is none */
  image?: { mime: ImageMime; data: string } | null;
  licence?: string;
  pageUrl?: string | null;
}

/**
 * A product's names and picture by its barcode. Never throws for what the network does: no answer is "nothing found".
 * `image: false` skips the download of the picture.
 */
export async function lookupProduct(db: Db, typed: string, options: { image?: boolean } = {}): Promise<ProductLookupResult> {
  if (!lookupSettings(db).enabled) return { found: false, reason: 'off' };
  const barcode = publicBarcode(typed);
  if (!barcode) return { found: false, reason: 'own' };
  let row = cachedLookup(db, barcode);
  if (!row) {
    const state = stateOf(db);
    // the same barcode asked twice at once (a form drawn twice) is one request
    let asking = state.inflight.get(barcode);
    if (!asking) {
      asking = askDatabases(db, barcode).finally(() => state.inflight.delete(barcode));
      state.inflight.set(barcode, asking);
    }
    const answer = await asking;
    if (answer === 'busy' || answer === 'unreachable') return { found: false, reason: answer };
    row = answer;
    try { keepLookup(db, row); } catch { /* the company was closed meanwhile: the answer still stands */ }
  }
  if (!row.found || !row.source) return { found: false, reason: 'not_found' };
  let image: ProductLookupResult['image'] = null;
  if (options.image !== false) {
    for (const address of [row.imageUrl, row.imageSmallUrl]) {
      if (!address) continue;
      const picture = await fetchPicture(db, address);
      if (picture) { image = { mime: picture.mime, data: toBase64(picture.bytes) }; break; }
    }
  }
  return { found: true, source: row.source, names: nameSuggestions(row), brand: row.brand, quantity: row.quantity, image, licence: PRODUCT_IMAGE_LICENCE, pageUrl: row.pageUrl };
}

/* ---------- pictures for the items that have none ---------- */

export interface BulkStatus {
  running: boolean;
  /** items without a picture whose barcode may be asked about */
  total: number;
  done: number;
  /** pictures saved */
  added: number;
  /** how it ended: all done, stopped by someone, the setting switched off, or the databases could not be reached */
  ended: 'done' | 'stopped' | 'off' | 'unreachable' | null;
  startedAt: string | null;
}
interface BulkJob extends BulkStatus { stop: boolean; finished: Promise<void> }
const JOBS = new Set<BulkJob>();
const IDLE: BulkStatus = { running: false, total: 0, done: 0, added: 0, ended: null, startedAt: null };
const statusOf = (job: BulkJob | null): BulkStatus =>
  (job ? { running: job.running, total: job.total, done: job.done, added: job.added, ended: job.ended, startedAt: job.startedAt } : IDLE);

export function bulkStatus(db: Db): BulkStatus { return statusOf(stateOf(db).job); }
export function stopBulk(db: Db): BulkStatus {
  const job = stateOf(db).job;
  if (job?.running) job.stop = true;
  return statusOf(job);
}
/** Tests: resolves when the search that is running has ended. */
export async function bulkFinished(db: Db): Promise<BulkStatus> {
  await stateOf(db).job?.finished;
  return bulkStatus(db);
}

/** The active items that have a barcode a manufacturer printed and no picture. */
function itemsWithoutPicture(db: Db): { id: string; barcode: string }[] {
  const rows = db.prepare(`SELECT i.id, i.barcode FROM items i LEFT JOIN item_images m ON m.item_id = i.id
                           WHERE m.item_id IS NULL AND i.active = 1 AND i.barcode IS NOT NULL AND i.barcode <> '' ORDER BY i.code`).all() as { id: string; barcode: string }[];
  return rows.flatMap((r) => { const barcode = publicBarcode(r.barcode); return barcode ? [{ id: r.id, barcode }] : []; });
}

/**
 * "Find pictures for items without one": goes through them one at a time on the server, within the limit, until all
 * are done, someone stops it, the setting is switched off or the databases stop answering. It only ever adds a
 * picture to an item that has none at that moment. One search per company at a time; a second start joins the first.
 */
export function startBulk(db: Db, user: string): BulkStatus {
  const state = stateOf(db);
  if (state.job?.running) return statusOf(state.job);
  if (!lookupSettings(db).enabled) return { ...IDLE, ended: 'off' };
  const items = itemsWithoutPicture(db);
  const job: BulkJob = { running: true, total: items.length, done: 0, added: 0, ended: null, startedAt: new Date(env.now()).toISOString(), stop: false, finished: Promise.resolve() };
  state.job = job;
  JOBS.add(job);
  audit(db, user, 'update', 'item_image', null, { bulk: 'start', items: items.length });
  job.finished = (async () => {
    let failures = 0;
    try {
      for (const item of items) {
        if (!lookupSettings(db).enabled) { job.ended = 'off'; break; }
        if (job.stop) { job.ended = 'stopped'; break; }
        const asked = !cachedLookup(db, item.barcode);
        let result = await lookupProduct(db, item.barcode);
        // the minute is full (the forms asked too): wait and ask once more
        while (result.reason === 'busy' && !job.stop) { await env.sleep(BULK_PACE_MS); result = await lookupProduct(db, item.barcode); }
        if (job.stop) { job.ended = 'stopped'; break; }
        if (result.reason === 'unreachable') {
          // no internet, or they are down: after a few in a row the search ends instead of knocking on
          if (++failures >= 3) { job.ended = 'unreachable'; break; }
        } else {
          failures = 0;
          if (result.found && result.image && result.source && result.pageUrl) {
            const source = { source: result.source, licence: PRODUCT_IMAGE_LICENCE, url: result.pageUrl };
            // never in place of a picture: one added meanwhile (by a person) stays
            const added = transaction(db, () => {
              if (db.prepare('SELECT 1 FROM item_images WHERE item_id = ?').get(item.id) || !db.prepare('SELECT 1 FROM items WHERE id = ?').get(item.id)) return false;
              setItemImage(db, item.id, result.image!.data, user, source);
              return true;
            });
            if (added) job.added++;
          }
        }
        job.done++;
        if (asked && job.done < job.total && !job.stop) await env.sleep(BULK_PACE_MS);
      }
      job.ended ??= 'done';
    } catch {
      // the company file was closed under it, or the like: the search ends, what was saved stays
      job.ended ??= 'stopped';
    } finally {
      job.running = false;
      JOBS.delete(job);
    }
  })();
  return statusOf(job);
}

/* ---------- the API ---------- */

export const productLookupApi: ApiExtension = {
  rules: {
    // whoever may add or change items may look one up; the setting and the search over every item are an admin's
    'POST /api/items/lookup': 'stock',
    'PUT /api/items/lookup/settings': 'admin',
    'POST /api/items/lookup/bulk': 'admin',
    'DELETE /api/items/lookup/bulk': 'admin'
  },
  routes(db, { actorOf }) {
    return [
      { method: 'GET', path: '/api/items/lookup/settings', handler: async () => lookupSettings(db) },
      {
        method: 'PUT', path: '/api/items/lookup/settings',
        handler: async (req) => setLookupSettings(db, parse(z.object({ enabled: z.boolean().optional() }), req.body), actorOf(req).name)
      },
      {
        method: 'POST', path: '/api/items/lookup',
        handler: async (req) => {
          const body = parse(z.object({ barcode: z.string().min(1).max(64), image: z.boolean().optional() }), req.body);
          return lookupProduct(db, body.barcode, { image: body.image !== false });
        }
      },
      { method: 'GET', path: '/api/items/lookup/bulk', handler: async () => bulkStatus(db) },
      { method: 'POST', path: '/api/items/lookup/bulk', handler: async (req) => startBulk(db, actorOf(req).name) },
      { method: 'DELETE', path: '/api/items/lookup/bulk', handler: async () => stopBulk(db) }
    ];
  }
};
