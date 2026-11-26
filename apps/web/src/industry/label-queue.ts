/**
 * Labels another page asks for (a clothing model's variants, a purchase's goods): kept for this tab until the Labels
 * page opens and takes them, so the page starts with those rows. Nothing is kept past the tab (sessionStorage).
 */
const KEY = 'qasa_label_queue';

export interface QueuedLabel { itemId: string; copies: number }

export function queueLabels(rows: readonly QueuedLabel[]): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(rows.filter((r) => r.itemId && r.copies > 0).slice(0, 500))); } catch { /* not available */ }
}

/** Empties the queue (the Labels page, once it has shown the rows). */
export function clearQueuedLabels(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* not available */ }
}

/** The rows queued (the queue stays until clearQueuedLabels: a page drawn twice reads them twice). */
export function queuedLabels(): QueuedLabel[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? list.filter((r): r is QueuedLabel => !!r && typeof r.itemId === 'string' && Number.isInteger(r.copies) && r.copies > 0).map((r) => ({ itemId: r.itemId, copies: Math.min(500, r.copies) }))
      : [];
  } catch {
    return [];
  }
}
