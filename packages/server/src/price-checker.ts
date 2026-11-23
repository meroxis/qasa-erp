import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { todayIso, type CurrencyCode, type Names, type OfferKind, type ProductSource, type UnitCode } from '@qasa/core';
import type { Db } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { planStatus } from './license.ts';
import { findByBarcode, getItem } from './items.ts';
import { itemImageSource } from './media.ts';
import { offerOnNow, tillOffers } from './offers.ts';
import type { ApiExtension, ApiRequest } from './routes.ts';

/**
 * Price checkers (Starter, Pro and Business): a cheap tablet or an old PC near the shelves where a customer scans a
 * barcode and sees the item's name, picture, price and unit, and the offer on it now. Nothing else: no cost, no stock,
 * no customer, no other page.
 *
 * Such a screen signs in with nobody's account: an admin adds the device and gets its token once (the app shows it as
 * a link to open on the device, the token after # so it never reaches a server log). Only the token's SHA-256 is kept,
 * and the token opens two read-only routes and nothing else (x-qasa-price-checker header). A device is revoked by the
 * admin at any time. Each device is held to a few lookups a second.
 */

export const priceCheckerAvailable = (db: Db): boolean => planStatus(db).features.includes('priceChecker');
export const PRICE_CHECKER_HEADER = 'x-qasa-price-checker';
const MAX_DEVICES = 20;

const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex');
const nowIso = () => new Date().toISOString();

export interface PriceCheckerDevice { id: string; name: string; warehouseId: string | null; createdBy: string; createdAt: string; lastSeenAt: string | null; revokedAt: string | null }

interface DeviceRow { id: string; name: string; token_hash: string; warehouse_id: string | null; created_by: string; created_at: string; last_seen_at: string | null; revoked_at: string | null }
const view = (r: DeviceRow): PriceCheckerDevice => ({
  id: r.id, name: r.name, warehouseId: r.warehouse_id, createdBy: r.created_by, createdAt: r.created_at, lastSeenAt: r.last_seen_at, revokedAt: r.revoked_at
});

export function listDevices(db: Db): PriceCheckerDevice[] {
  return (db.prepare('SELECT * FROM price_checker_devices ORDER BY revoked_at IS NOT NULL, created_at DESC').all() as unknown as DeviceRow[]).map(view);
}

/** A new device and its token: shown this once, never stored (only its hash is). */
export function addDevice(db: Db, input: { name: string; warehouseId?: string | null | undefined }, user: string): { device: PriceCheckerDevice; token: string } {
  if (!priceCheckerAvailable(db)) throw conflict('plan_limit', { limit: 'priceChecker' });
  const name = input.name.trim();
  if (!name) throw invalid([{ code: 'pc_name_required' }]);
  if (input.warehouseId && !db.prepare('SELECT 1 FROM warehouses WHERE id = ?').get(input.warehouseId)) throw invalid([{ code: 'warehouse_invalid' }]);
  const live = Number((db.prepare('SELECT COUNT(*) AS n FROM price_checker_devices WHERE revoked_at IS NULL').get() as { n: number }).n);
  if (live >= MAX_DEVICES) throw conflict('pc_too_many', { max: MAX_DEVICES });
  const token = `qpc_${randomBytes(24).toString('base64url')}`;
  const id = randomUUID();
  db.prepare('INSERT INTO price_checker_devices (id, name, token_hash, warehouse_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name.slice(0, 80), hashOf(token), input.warehouseId || null, user, nowIso());
  audit(db, user, 'create', 'price_checker', id, { name });
  return { device: view(db.prepare('SELECT * FROM price_checker_devices WHERE id = ?').get(id) as unknown as DeviceRow), token };
}

export function revokeDevice(db: Db, id: string, user: string): PriceCheckerDevice {
  const r = db.prepare('SELECT * FROM price_checker_devices WHERE id = ?').get(id) as DeviceRow | undefined;
  if (!r) throw notFound('price_checker');
  if (!r.revoked_at) {
    db.prepare('UPDATE price_checker_devices SET revoked_at = ? WHERE id = ?').run(nowIso(), id);
    audit(db, user, 'revoke', 'price_checker', id, { name: r.name });
  }
  return view(db.prepare('SELECT * FROM price_checker_devices WHERE id = ?').get(id) as unknown as DeviceRow);
}

/** Lookups per device: at most this many in a second (a scanner gun held down, or someone trying tokens). */
const PER_SECOND = 8;
const recent = new Map<string, number[]>();
function throttle(key: string): void {
  const now = Date.now();
  const list = (recent.get(key) ?? []).filter((t) => now - t < 1000);
  if (list.length >= PER_SECOND) throw new AppError(429, 'too_many_requests');
  list.push(now);
  recent.set(key, list);
  if (recent.size > 1000) recent.clear();
}

/** The device a request comes from, by its token; anything else is refused (401), as a wrong token is. */
export function deviceOf(db: Db, req: ApiRequest): DeviceRow {
  const raw = req.headers[PRICE_CHECKER_HEADER];
  const token = typeof raw === 'string' ? raw.trim() : '';
  throttle(token ? hashOf(token).slice(0, 16) : 'none');
  if (!token || token.length > 200) throw new AppError(401, 'unauthorized');
  const hash = hashOf(token);
  const r = db.prepare('SELECT * FROM price_checker_devices WHERE token_hash = ?').get(hash) as DeviceRow | undefined;
  if (!r || r.revoked_at || !timingSafeEqual(Buffer.from(r.token_hash), Buffer.from(hash))) throw new AppError(401, 'unauthorized');
  if (!priceCheckerAvailable(db)) throw conflict('plan_limit', { limit: 'priceChecker' });
  // when it was last used, kept once a minute at most
  if (!r.last_seen_at || Date.now() - Date.parse(r.last_seen_at) > 60_000) db.prepare('UPDATE price_checker_devices SET last_seen_at = ? WHERE id = ?').run(nowIso(), r.id);
  return r;
}

export interface CheckerOffer {
  names: Names; kind: OfferKind; endsOn: string | null;
  buyMilli: number | null; getMilli: number | null; getPercent: number | null; bundleMilli: number | null; bundlePrice: number | null; price: number | null; percentOff: number | null;
}
export interface PriceCheck {
  found: boolean;
  name?: Names; unit?: UnitCode; price?: number; currency?: CurrencyCode;
  /** a data: URL of the item's picture, when it has one */
  image?: string | null;
  /** 2.1: the open product database the picture came from, when it is not the shop's own (the screen credits it) */
  imageSource?: ProductSource;
  offers?: CheckerOffer[];
}

function offerView(r: ReturnType<typeof tillOffers>[number]): CheckerOffer {
  return {
    names: r.names, kind: r.kind, endsOn: r.endsOn, buyMilli: r.buyMilli, getMilli: r.getMilli, getPercent: r.getPercent, bundleMilli: r.bundleMilli,
    bundlePrice: r.bundlePrice, price: r.price, percentOff: r.percentOff
  };
}

function imageOf(db: Db, itemId: string): string | null {
  const row = db.prepare('SELECT mime, data FROM item_images WHERE item_id = ?').get(itemId) as { mime: string; data: Uint8Array } | undefined;
  return row ? `data:${row.mime};base64,${Buffer.from(row.data).toString('base64')}` : null;
}

/** The open product database a picture came from, for the screen's credit line; nothing for the shop's own picture. */
function sourceOf(db: Db, itemId: string): { imageSource?: ProductSource } {
  const source = itemImageSource(db, itemId)?.source;
  return source ? { imageSource: source } : {};
}

/** What the screen shows for a code scanned or typed: by barcode (an item's, or one of its units'), else by item code. */
export function priceCheck(db: Db, device: Pick<DeviceRow, 'warehouse_id'>, code: string, now: Date = new Date()): PriceCheck {
  const typed = code.trim();
  if (!typed) return { found: false };
  let { item, unit } = findByBarcode(db, typed);
  if (!item) {
    const byCode = db.prepare('SELECT id FROM items WHERE code = ?').get(typed) as { id: string } | undefined;
    item = byCode ? getItem(db, byCode.id) : null;
    unit = null;
  }
  if (!item || !item.active || item.unit === 'service') return { found: false };
  const unitRow = unit ? item.units.find((u) => u.unit === unit) : undefined;
  const price = unitRow?.salePrice ?? (unitRow ? Math.round((item.salePrice * unitRow.factorMilli) / 1000) : item.salePrice);
  const offers = tillOffers(db, device.warehouse_id, todayIso(now))
    .filter((r) => r.items.includes(item!.id) || (!!item!.categoryId && r.categories.includes(item!.categoryId)))
    .filter((r) => offerOnNow(r, now))
    .map(offerView);
  return { found: true, name: item.name, unit: unit ?? item.unit, price, currency: item.saleCurrency, image: imageOf(db, item.id), ...sourceOf(db, item.id), offers };
}

export interface SlideOffer extends CheckerOffer { items: { name: Names; price: number; currency: CurrencyCode; unit: UnitCode; image: string | null; imageSource?: ProductSource }[] }

/** The offers on now, with a few of their goods: what the screen shows while nobody scans. */
export function offerSlides(db: Db, device: Pick<DeviceRow, 'warehouse_id'>, now: Date = new Date()): SlideOffer[] {
  const rules = tillOffers(db, device.warehouse_id, todayIso(now)).filter((r) => offerOnNow(r, now)).slice(0, 12);
  return rules.map((r) => {
    const ids = r.items.length ? r.items.slice(0, 3)
      : (r.categories.length ? (db.prepare(`SELECT id FROM items WHERE active = 1 AND category_id IN (${r.categories.map(() => '?').join(', ')}) ORDER BY code LIMIT 3`).all(...r.categories) as { id: string }[]).map((x) => x.id) : []);
    const items = ids.flatMap((itemId, i) => {
      const it = db.prepare('SELECT name_ar, name_en, name_ku, sale_price, sale_currency, unit, active FROM items WHERE id = ?').get(itemId) as {
        name_ar: string; name_en: string; name_ku: string; sale_price: number; sale_currency: CurrencyCode; unit: UnitCode; active: number;
      } | undefined;
      if (!it || it.active !== 1) return [];
      // one picture per slide is enough for a cheap tablet
      return [{ name: { ar: it.name_ar, en: it.name_en, ku: it.name_ku }, price: Number(it.sale_price), currency: it.sale_currency, unit: it.unit, image: i === 0 ? imageOf(db, itemId) : null, ...(i === 0 ? sourceOf(db, itemId) : {}) }];
    });
    return { ...offerView(r), items };
  });
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);

/**
 * The devices are the admin's (reading them too). The two lookups are public routes for the device's token alone: no
 * session, no cookie (a page on another site can't ride on one), and nothing but what is on the shelf label.
 */
export const priceCheckerApi: ApiExtension = {
  rules: { 'GET /api/price-checker/devices': 'admin' },
  public: ['GET /api/price-check', 'GET /api/price-check/offers'],
  routes(db, { actorOf }) {
    return [
      { method: 'GET', path: '/api/price-checker/devices', handler: async () => ({ available: priceCheckerAvailable(db), devices: listDevices(db) }) },
      {
        method: 'POST', path: '/api/price-checker/devices',
        handler: async (req, reply) => {
          reply.status(201).send(addDevice(db, parse(z.object({ name: z.string().max(80), warehouseId: id.nullable().optional() }), req.body), actorOf(req).name));
          return undefined;
        }
      },
      { method: 'POST', path: '/api/price-checker/devices/:id/revoke', handler: async (req) => revokeDevice(db, parse(z.object({ id }), req.params).id, actorOf(req).name) },
      {
        method: 'GET', path: '/api/price-check',
        handler: async (req) => {
          const device = deviceOf(db, req);
          return priceCheck(db, device, parse(z.object({ code: z.string().max(64) }), req.query ?? {}).code);
        }
      },
      { method: 'GET', path: '/api/price-check/offers', handler: async (req) => ({ offers: offerSlides(db, deviceOf(db, req)) }) }
    ];
  }
};
