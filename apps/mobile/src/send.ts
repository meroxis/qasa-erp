import type { OfficeApi } from './api';
import type { OutboxItem, OutboxKind } from './outbox';
import { staffSenders, type KindSender } from './staff/send';

/**
 * How each kind of change goes from the outbox to the office, with its own key (the item's id): phone app 1.0's, then
 * each 1.1 group's (src/staff/send.ts).
 */
export const SENDERS: Record<OutboxKind, KindSender> = {
  sale: (api, item) => api.draftSale(item.body, item.id),
  order: (api, item) => api.order(item.body, item.id),
  receipt: (api, item) => api.receipt(item.body, item.id),
  count: (api, item) => api.sendCount(item.body, item.id),
  countSession: (api, item) => api.countInto(item.target ?? '', item.body, item.id),
  ...staffSenders
};

/** One change to the office by its kind. */
export const sendItem = (api: OfficeApi, item: OutboxItem, blob: () => Promise<string | null>): Promise<unknown> => SENDERS[item.kind](api, item, blob);
