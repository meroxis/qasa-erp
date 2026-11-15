import type { Currency } from '../api';
import type { Key, Lang } from '../i18n';
import type { VoucherAnswer } from './api';

/**
 * An expense as the phone sends it (POST /api/expenses): the kind, how much in which currency, the safe or bank it was
 * paid from, the day, a note and the photo of the paper receipt. No rate: the office books a dollar expense at its own
 * rate of that day. The photo is made small on the phone (and its EXIF with the location dropped by re-encoding); the
 * office checks it again and strips any metadata left.
 */

/** The desktop's kinds of expense (Expenses page), each with the account the company set for it. */
export const EXPENSE_CATEGORIES = ['rent', 'power', 'fuel', 'salaries', 'internet', 'maintenance', 'transport', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const CATEGORY_TEXT: Record<ExpenseCategory, Key> = {
  rent: 'expRent', power: 'expPower', fuel: 'expFuel', salaries: 'expSalaries', internet: 'expInternet', maintenance: 'expMaintenance', transport: 'expTransport', other: 'expOther'
};

/** How far back an expense may be dated on the phone (the office takes up to 62 days, for one that waited to be sent). */
export const DAYS_BACK = 31;
export const NOTE_MAX = 200;

/**
 * The photo's sizes, tried in turn: the longer side at most 1600 pixels at JPEG quality 0.6, and when that is still over
 * PHOTO_TEXT_MAX of base64, 1280 pixels at 0.5. Re-encoding makes a new JPEG without the camera's EXIF (its location).
 */
export const PHOTO_STEPS: readonly { side: number; compress: number }[] = [{ side: 1600, compress: 0.6 }, { side: 1280, compress: 0.5 }];
export const PHOTO_TEXT_MAX = 380 * 1024;

/** The size to make a photo of width × height: its longer side at most `side` (never larger than it is). */
export function resizeFor(width: number, height: number, side: number): { width: number } | { height: number } {
  if (width >= height) return { width: Math.min(width, side) };
  return { height: Math.min(height, side) };
}

/** A photo small enough to send: base64 of at most PHOTO_TEXT_MAX, and of no more bytes than the office takes. */
export function photoFits(base64: string, officeMaxBytes = 400 * 1024): boolean {
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  return base64.length > 0 && base64.length <= PHOTO_TEXT_MAX && bytes <= officeMaxBytes;
}

/** The day `n` days before `iso` (YYYY-MM-DD), as the office writes dates. */
export function daysBefore(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** How many days `date` is before `today` (0: today). */
export function daysAgo(date: string, today: string): number {
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86_400_000);
}

export interface ExpenseInput {
  category: ExpenseCategory;
  amount: number;
  currency: Currency;
  cashAccountCode: string;
  date: string;
  note: string;
  lang: Lang;
}

/** The expense for the office: exactly the keys the phone link takes (the photo goes beside it, from the outbox). */
export function expenseBody(e: ExpenseInput) {
  if (!EXPENSE_CATEGORIES.includes(e.category)) throw new Error('category');
  if (!Number.isSafeInteger(e.amount) || e.amount <= 0) throw new Error('amount');
  const note = e.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, NOTE_MAX);
  return {
    category: e.category, amount: e.amount, currency: e.currency, cashAccountCode: e.cashAccountCode, date: e.date, lang: e.lang,
    ...(note ? { note } : {})
  };
}

/**
 * What became of an expense, for its screen: in the books (posted), waiting for approval, a draft to check and approve,
 * or kept on the phone. `notYet`: the office answered from what it kept of an earlier try (its id, number and status
 * only), which can't tell waiting from a draft.
 */
export type ExpenseOutcome = 'posted' | 'waiting' | 'draft' | 'notYet' | 'queued';

export function expenseOutcome(sent: 'sent' | 'posted' | 'queued', answer: unknown): ExpenseOutcome {
  if (sent === 'queued') return 'queued';
  const a = answer as Partial<VoucherAnswer> | null;
  if (a?.status === 'approved') return 'posted';
  if (!a || !('approval' in a)) return 'notYet';
  return a.approval?.state === 'waiting' ? 'waiting' : 'draft';
}

export const OUTCOME_TEXT: Record<Exclude<ExpenseOutcome, 'queued'>, Key> = { posted: 'expPosted', waiting: 'expWaiting', draft: 'expDraft', notYet: 'expNotYet' };
