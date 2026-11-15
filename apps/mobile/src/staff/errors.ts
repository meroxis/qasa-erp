import type { ErrorText } from '../explain';
import { qty } from '../i18n';

/**
 * The office's refusals of the staff's 1.1 work, in the user's words (explain.ts): by the office's error code, or by the
 * code of a detail of a 400 validation answer. A text with numbers in it takes them from the detail; without them, it is
 * not used.
 */

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);

export const STAFF_ERRORS: Record<string, ErrorText> = {
  photo_invalid: 'errPhotoInvalid',
  photo_too_large: 'errPhotoTooLarge',
  date_future: 'errDateFuture',
  expense_date_too_old: { key: 'errExpenseTooOld', vars: (d) => (count(d.days) !== null ? { d: count(d.days)! } : null) },
  cash_account_invalid: 'errCashAccount',
  stock_insufficient: {
    key: 'errStockInsufficient',
    vars: (d) => (count(d.line) !== null && count(d.available) !== null ? { n: count(d.line)!, a: qty(count(d.available)!) } : null)
  },
  same_warehouse: 'errSameWarehouse',
  item_not_stock: { key: 'errItemNotStock', vars: (d) => (count(d.line) !== null ? { n: count(d.line)! } : null) },
  po_receipt_pending: 'errPoPending',
  po_over_remaining: 'errPoOver',
  po_line_unknown: 'rcvNotOnOrder'
};
