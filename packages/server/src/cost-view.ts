import { seesBooks, seesCost, type Actor } from './auth.ts';
import { isCompanyBooks } from './branches.ts';
import { AppError } from './errors.ts';

/**
 * Cost stays with those who may see it (1.4). The router calls this for every request, so the rule holds for every
 * answer of a route, whichever way it is asked: a list, one record, a barcode scan at the till, the answer to a save.
 *
 * Two rules (auth.ts):
 * - seesCost: an item's purchase price and average cost, the value of the stock, the cost of a sale's lines. Without
 *   it those fields are left out of the answer (never sent as zero).
 * - seesBooks: the journal, the company's own books and the reports made from them, profit on the dashboard and in the
 *   sales reports, and the prices on purchase invoices and orders. Without it the books are refused (403, as for any
 *   action a user may not do) and the cost and profit fields of the other reports are left out.
 *
 * One thing of the journal stays with someone who does not keep the books: the vouchers they prepared themselves. A
 * sales person takes a customer's money with "Receive payment" (quick-vouchers.ts), and that receipt may wait for
 * approval: they can open it by its id and list their own, with where the approval stands and why it was rejected.
 * Nobody else's entry, by any address: ownVouchersOnly below, asked by the two routes that read the journal.
 *
 * What customers owe and what suppliers are owed are not cost: a balance, and the total of the balances
 * (/api/parties/totals), are sent to everyone for both, as the lists of customers and suppliers are. What each
 * purchase cost is in the lines of a supplier's statement, and those are left out (routes.ts).
 */

/** Answers under these paths lose these fields for someone who may not see cost. */
const COST_FIELDS: readonly (readonly [string, readonly string[]])[] = [
  ['/api/items', ['purchasePrice', 'purchaseCurrency', 'value']],
  ['/api/warehouses', ['value']],
  ['/api/stock-docs', ['totalValue', 'unitCost', 'value']],
  ['/api/adjustments', ['valueOut', 'valueIn', 'unitCost', 'value']],
  ['/api/batches', ['value']],
  // a sale's lines carry what the goods cost (set when posted): also in the till's answer and a quotation made an invoice
  ['/api/invoices', ['cost']],
  ['/api/pos', ['cost']],
  ['/api/quotes', ['cost']]
];

/** Answers under these paths lose these fields for someone who may not read the books. */
const BOOKS_FIELDS: readonly (readonly [string, readonly string[]])[] = [
  // every account's balance is the trial balance by another name
  ['/api/accounts', ['balance']],
  // the Daily Brief, the dashboard, the end-of-day close and the sales reports: sales stay, cost and profit go
  ['/api/brief', ['cost', 'profit', 'profitMonth', 'value']],
  // what was agreed with a supplier, and the last price paid
  ['/api/purchase-orders', ['total', 'unitPrice', 'amount', 'lastPrice']]
];

/** The money on a purchase invoice (or a purchase return) is what the goods cost. */
const PURCHASE_KINDS: ReadonlySet<unknown> = new Set(['purchase', 'purchase_return']);
const PURCHASE_MONEY: ReadonlySet<string> = new Set(['discount', 'subtotal', 'total', 'baseTotal', 'unitPrice', 'amount', 'cost', 'returnedAmount', 'payments']);

/** Read by nobody without the books: the journal, the company's books (branches.ts) and the stock valuation. */
const BOOKS_ONLY: readonly string[] = ['/api/entries', '/api/vouchers', '/api/brief/reports/stock-value'];

const under = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

/** The two reads of the journal that answer someone without the books, with their own vouchers only. */
const OWN_VOUCHER_READS: ReadonlySet<string> = new Set(['GET /api/entries', 'GET /api/entries/:id']);

/**
 * Whose vouchers a reader of the journal gets: null for someone who keeps the books (every entry), otherwise the
 * user's own id: only the receipt and payment vouchers that user prepared. Someone who cannot be told from the others
 * (no id) gets none.
 */
export function ownVouchersOnly(actor: Actor): string | null {
  if (seesBooks(actor)) return null;
  if (!actor.id) throw new AppError(403, 'forbidden');
  return actor.id;
}

/** Refuses the books to someone who may not read them. */
export function checkCostRequest(actor: Actor | null, method: string, path: string): void {
  if (!actor || seesBooks(actor)) return;
  // their own vouchers: the routes limit the answer with ownVouchersOnly
  if (OWN_VOUCHER_READS.has(`${method} ${path}`)) return;
  if (isCompanyBooks(path) || BOOKS_ONLY.some((p) => under(path, p))) throw new AppError(403, 'forbidden');
}

/** A record of an answer: an object literal, or a row as the database gives it (no prototype); not a Buffer, not a Date. */
function isPlain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A copy of an answer without the named fields, at any depth (lists and plain objects; anything else as it is). */
function without(value: unknown, fields: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => without(v, fields));
  if (!isPlain(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !fields.has(k)).map(([k, v]) => [k, without(v, fields)]));
}

/** A copy of an answer in which every purchase invoice has lost its money. */
function withoutPurchaseMoney(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPurchaseMoney);
  if (!isPlain(value)) return value;
  if (PURCHASE_KINDS.has(value.kind)) return without(value, PURCHASE_MONEY);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutPurchaseMoney(v)]));
}

/** What a route answered, without what this person may not see. */
export function hideCost(actor: Actor | null, path: string, result: unknown): unknown {
  if (!actor || result === null || typeof result !== 'object') return result;
  let out: unknown = result;
  if (!seesCost(actor)) {
    const fields = COST_FIELDS.filter(([prefix]) => under(path, prefix)).flatMap(([, f]) => f);
    if (fields.length) out = without(out, new Set(fields));
  }
  if (!seesBooks(actor)) {
    const fields = BOOKS_FIELDS.filter(([prefix]) => under(path, prefix)).flatMap(([, f]) => f);
    if (fields.length) out = without(out, new Set(fields));
    if (under(path, '/api/invoices')) out = withoutPurchaseMoney(out);
  }
  return out;
}
