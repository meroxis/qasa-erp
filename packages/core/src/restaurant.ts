/**
 * Restaurants and cafés (2.1, plan feature 'restaurant'): what the server and the pages share. An order is a table's
 * tab (or a takeaway or delivery order): its lines go to the kitchen as tickets, and it is paid at the till's own sale,
 * all at once or in parts (each guest what they had), until nothing is left to pay.
 */

/** A table's order, one to take away, or one to deliver. */
export const RS_ORDER_KINDS = ['table', 'takeaway', 'delivery'] as const;
export type RsOrderKind = (typeof RS_ORDER_KINDS)[number];
export const isRsOrderKind = (v: unknown): v is RsOrderKind => typeof v === 'string' && (RS_ORDER_KINDS as readonly string[]).includes(v);

/** At most this many lines on one order, items on one request, and characters in a line's note ("no onion"). */
export const RS_MAX_LINES = 200;
export const RS_MAX_ADD = 50;
export const RS_MAX_NOTE = 120;
/** At most 999 of one dish on a line (thousandths), and 99 guests at a table. */
export const RS_MAX_QTY_MILLI = 999_000;
export const RS_MAX_GUESTS = 99;

/** A line's amount: quantity (thousandths) × price, to the dinar. */
export const rsLineAmount = (qtyMilli: number, unitPrice: number): number => Math.round((qtyMilli * unitPrice) / 1000);

/**
 * A bill shared evenly by `people`: each one's share, in whole dinars, adding up to the total exactly (the first
 * shares carry the dinars left over). Nothing for no people or no total.
 */
export function rsEvenShares(total: number, people: number): number[] {
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(people) || people < 1) return [];
  const base = Math.floor(total / people);
  const rest = total - base * people;
  return Array.from({ length: people }, (_, i) => base + (i < rest ? 1 : 0));
}

/** "T4", "#12": how a table or an order is named on a ticket and a bill. */
export const rsOrderLabel = (o: { number: string; tableName?: string | null }): string => (o.tableName ? `${o.tableName} · #${o.number}` : `#${o.number}`);
