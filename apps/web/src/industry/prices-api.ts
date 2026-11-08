import type { CurrencyCode } from '@qasa/core';
import { qs, request } from '../api.ts';

/** Price lists: a customer buys at retail or wholesale; an item has a wholesale price. */

export type PriceList = 'retail' | 'wholesale';
export interface PriceQuote { itemId: string; price: number; currency: CurrencyCode; list: PriceList; source: 'retail' | 'item_prices' | 'part_details'; converted: boolean }
export interface ItemPricesView { itemId: string; currency: CurrencyCode; retail: number | null; wholesale: number | null; partsWholesale: number | null }

export const pricesApi = {
  /**
   * The unit price to fill in when this party buys this item, in the invoice currency; rateX100 is the document's own
   * rate (dinars per dollar × 100) to convert at, else the server uses the company's default rate.
   */
  priceFor: (itemId: string, partyId?: string | null, currency?: CurrencyCode, rateX100?: number | null) =>
    request<PriceQuote>('GET', '/api/prices' + qs({
      itemId, ...(partyId ? { partyId } : {}), ...(currency ? { currency } : {}),
      ...(rateX100 && Number.isSafeInteger(rateX100) && rateX100 > 0 ? { rateX100: String(rateX100) } : {})
    })),
  partyList: (partyId: string) => request<{ partyId: string; list: PriceList }>('GET', `/api/prices/party/${partyId}`),
  setPartyList: (partyId: string, list: PriceList) => request<{ partyId: string; list: PriceList }>('PUT', `/api/prices/party/${partyId}`, { list }),
  item: (itemId: string) => request<ItemPricesView>('GET', `/api/prices/item/${itemId}`),
  setItemWholesale: (itemId: string, wholesale: number | null) => request<ItemPricesView>('PUT', `/api/prices/item/${itemId}`, { wholesale })
};
