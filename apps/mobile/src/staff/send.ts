import { OfficeError } from '../answers';
import type { OfficeApi } from '../api';
import type { OutboxItem } from '../outbox';

/** How each of the staff's 1.1 changes goes from the outbox to the office, with its own key (the item's id). */
export type KindSender = (api: OfficeApi, item: OutboxItem, blob: () => Promise<string | null>) => Promise<unknown>;

export const staffSenders: Record<'expense' | 'transfer' | 'arrival', KindSender> = {
  // the photo was kept beside the item, sealed: it goes with the expense (one that can't be read is not sent without it)
  expense: async (api, item, blob) => {
    const photo = item.blob ? await blob() : null;
    if (item.blob && !photo) throw new OfficeError(400, 'photo_invalid', null);
    return api.expense({ ...(item.body as Record<string, unknown>), ...(photo ? { photo } : {}) }, item.id);
  },
  transfer: (api, item) => api.transfer(item.body, item.id),
  arrival: (api, item) => api.arrival(item.target ?? '', item.body, item.id)
};
