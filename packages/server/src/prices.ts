import { z } from 'zod';
import type { CurrencyCode } from '@qasa/core';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, invalid, notFound } from './errors.ts';
import { getSettings } from './settings.ts';
import type { ApiExtension } from './routes.ts';

/**
 * Price lists. A customer pays either the retail price (the item's sale price) or the wholesale price. The wholesale
 * price of an item is kept in item_prices; the car-parts card (part_details.wholesale_price) is read when item_prices
 * has no row, and the retail price when neither has one. All of them are in the item's sale currency.
 */

export type PriceList = 'retail' | 'wholesale';
export type PriceSource = 'retail' | 'item_prices' | 'part_details';

export interface PriceQuote {
  itemId: string;
  /** In the asked currency's minor units (converted at the default rate when the item is priced in the other one). */
  price: number;
  currency: CurrencyCode;
  list: PriceList;
  source: PriceSource;
  /** True when the price was converted from the item's own currency. */
  converted: boolean;
}

/** The list a party buys at: retail unless set to wholesale. */
export function partyPriceList(db: Db, partyId: string | null | undefined): PriceList {
  if (!partyId) return 'retail';
  const row = db.prepare('SELECT list FROM party_price_lists WHERE party_id = ?').get(partyId) as { list: PriceList } | undefined;
  return row?.list ?? 'retail';
}

/** The item's own wholesale price (item_prices first, then the car-parts card), or null. */
export function wholesalePrice(db: Db, itemId: string): { price: number; source: 'item_prices' | 'part_details' } | null {
  const own = db.prepare("SELECT price FROM item_prices WHERE item_id = ? AND list = 'wholesale'").get(itemId) as { price: number } | undefined;
  if (own) return { price: own.price, source: 'item_prices' };
  // part_details is in every schema (SQLite and server databases alike)
  const part = db.prepare('SELECT wholesale_price FROM part_details WHERE item_id = ?').get(itemId) as { wholesale_price: number | null } | undefined;
  if (part && part.wholesale_price !== null) return { price: part.wholesale_price, source: 'part_details' };
  return null;
}

/** Converts minor units between IQD (dinars) and USD (cents) at rateX100 (dinars per dollar × 100). */
export function convertMinor(amount: number, from: CurrencyCode, to: CurrencyCode, rateX100: number): number {
  if (from === to) return amount;
  if (rateX100 <= 0) throw new AppError(400, 'rate_invalid');
  return from === 'USD' ? Math.round((amount * rateX100) / 10_000) : Math.round((amount * 10_000) / rateX100);
}

/**
 * The unit price to fill in when this party buys this item: the party's list (wholesale → item_prices, else the
 * car-parts wholesale price, else retail), in the asked currency (the item's own currency when none is asked),
 * converted at the document's own rate when given (else the default rate).
 */
export function priceFor(db: Db, itemId: string, partyId: string | null, currency?: CurrencyCode, rateX100?: number): PriceQuote {
  const item = db.prepare('SELECT sale_price, sale_currency FROM items WHERE id = ?').get(itemId) as { sale_price: number | null; sale_currency: CurrencyCode | null } | undefined;
  if (!item) throw notFound('item');
  const own: CurrencyCode = item.sale_currency ?? 'IQD';
  const list = partyPriceList(db, partyId);
  let price = item.sale_price ?? 0;
  let source: PriceSource = 'retail';
  if (list === 'wholesale') {
    const w = wholesalePrice(db, itemId);
    if (w) ({ price, source } = w);
  }
  const want = currency ?? own;
  return { itemId, price: convertMinor(price, own, want, rateX100 ?? getSettings(db).defaultRateX100), currency: want, list, source, converted: want !== own };
}

export function setPartyPriceList(db: Db, partyId: string, list: PriceList, user: string): { partyId: string; list: PriceList } {
  const party = db.prepare('SELECT type FROM parties WHERE id = ?').get(partyId) as { type: string } | undefined;
  if (!party) throw notFound('party');
  if (party.type !== 'customer') throw invalid([{ code: 'price_list_customers_only' }]);
  transaction(db, () => {
    db.prepare('DELETE FROM party_price_lists WHERE party_id = ?').run(partyId);
    if (list !== 'retail') db.prepare('INSERT INTO party_price_lists (party_id, list) VALUES (?, ?)').run(partyId, list);
    audit(db, user, 'price_list.set', 'party', partyId, { list });
  });
  return { partyId, list };
}

export interface ItemPricesView {
  itemId: string;
  currency: CurrencyCode;
  retail: number | null;
  /** The wholesale price set on the item (item_prices), or null. */
  wholesale: number | null;
  /** What wholesale customers actually pay when no own wholesale price is set (the car-parts card), or null. */
  partsWholesale: number | null;
}

export function getItemPrices(db: Db, itemId: string): ItemPricesView {
  const item = db.prepare('SELECT sale_price, sale_currency FROM items WHERE id = ?').get(itemId) as { sale_price: number | null; sale_currency: CurrencyCode | null } | undefined;
  if (!item) throw notFound('item');
  const own = db.prepare("SELECT price FROM item_prices WHERE item_id = ? AND list = 'wholesale'").get(itemId) as { price: number } | undefined;
  const p = db.prepare('SELECT wholesale_price FROM part_details WHERE item_id = ?').get(itemId) as { wholesale_price: number | null } | undefined;
  const parts = p?.wholesale_price ?? null;
  return { itemId, currency: item.sale_currency ?? 'IQD', retail: item.sale_price, wholesale: own?.price ?? null, partsWholesale: parts };
}

export function setItemWholesale(db: Db, itemId: string, price: number | null, user: string): ItemPricesView {
  if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(itemId)) throw notFound('item');
  if (price !== null && (!Number.isSafeInteger(price) || price < 0 || price > 1e15)) throw invalid([{ code: 'price_invalid' }]);
  transaction(db, () => {
    db.prepare("DELETE FROM item_prices WHERE item_id = ? AND list = 'wholesale'").run(itemId);
    if (price !== null) db.prepare("INSERT INTO item_prices (item_id, list, price) VALUES (?, 'wholesale', ?)").run(itemId, price);
    audit(db, user, 'price.wholesale', 'item', itemId, { price });
  });
  return getItemPrices(db, itemId);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const id = z.string().min(1).max(64);
const idParam = z.object({ id });

export const pricesApi: ApiExtension = {
  rules: {
    'PUT /api/prices/party/:id': 'sales',
    'PUT /api/prices/item/:id': 'stock'
  },
  routes(db, { actorOf }) {
    return [
      {
        method: 'GET', path: '/api/prices',
        handler: async (req) => {
          const q = parse(z.object({
            itemId: id, partyId: id.optional(), currency: z.enum(['IQD', 'USD']).optional(),
            rateX100: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()
          }), req.query);
          return priceFor(db, q.itemId, q.partyId || null, q.currency, q.rateX100);
        }
      },
      {
        method: 'GET', path: '/api/prices/party/:id',
        handler: async (req) => {
          const partyId = parse(idParam, req.params).id;
          if (!db.prepare('SELECT 1 FROM parties WHERE id = ?').get(partyId)) throw notFound('party');
          return { partyId, list: partyPriceList(db, partyId) };
        }
      },
      {
        method: 'PUT', path: '/api/prices/party/:id',
        handler: async (req) => setPartyPriceList(db, parse(idParam, req.params).id, parse(z.object({ list: z.enum(['retail', 'wholesale']) }), req.body).list, actorOf(req).name)
      },
      { method: 'GET', path: '/api/prices/item/:id', handler: async (req) => getItemPrices(db, parse(idParam, req.params).id) },
      {
        method: 'PUT', path: '/api/prices/item/:id',
        handler: async (req) => setItemWholesale(db, parse(idParam, req.params).id, parse(z.object({ wholesale: z.number().int().nullable() }), req.body).wholesale, actorOf(req).name)
      }
    ];
  }
};
