import { z } from 'zod';
import { isIsoDate, todayIso, type VoucherInput } from '@qasa/core';
import type { Db } from './db.ts';
import { imageSha256, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, invalid, notFound } from './errors.ts';
import type { Actor } from './auth.ts';
import { EXPENSE_CATEGORIES, expenseAccounts, type ExpenseCategory } from './brief.ts';
import { rateOn } from './fx.ts';
import { createVoucher, getEntry, type EntryView } from './journal.ts';
import { fromBase64, imageMime, MAX_IMAGE_BYTES, toBase64 } from './media.ts';
import { logoSize } from './print-profile.ts';
import { preparerOf } from './quick-vouchers.ts';
import { onceOnly } from './idempotency.ts';
import type { ApiExtension } from './routes.ts';

/**
 * An expense with the photo of its paper receipt (1.5; the phone app's "Expense"): the same payment voucher the
 * desktop's Expenses page makes — from a safe or bank, to the expense account the company set for that kind — with the
 * receipt's photo kept with it. The voucher goes through the same rules as every voucher (createVoucher): it waits for
 * approval, is approved at once, or is a draft to check and approve, by who prepared it. It names no party and no other
 * account: nobody pays a supplier through it.
 *
 * A dollar expense is booked at the office's rate of its own day (the rate board's rate on that date or the latest
 * before it, else the company's default rate), never at a rate the sender names: a phone's rate can be days old, and a
 * changed app could send any.
 *
 * The photo: one JPEG, whole (its frame header and its end), at most 400 KB and 2048 pixels a side (a small file must
 * not make every phone and PC that shows it decode a huge picture), kept without its metadata (EXIF, GPS, maker notes,
 * comments) and without anything after the picture's end: stripJpegMetadata below, on the office, whatever the sender
 * did. It is stored with the voucher in the same transaction, and the audit log keeps its size and hash.
 */

/** The longest side of a receipt's photo (the phone makes at most 1600 pixels). */
export const MAX_PHOTO_SIDE = 2048;
/** The most base64 text a photo may be sent as (400 KB of bytes is 546,134 characters). */
export const MAX_PHOTO_TEXT = 560_000;

/** The words written on the voucher for each kind, when no note is typed: the desktop's own (br_exp_*), by language. */
export const EXPENSE_WORDS: Record<'ar' | 'en' | 'ku', Record<ExpenseCategory, string>> = {
  ar: { rent: 'إيجار', power: 'كهرباء ومولدة', fuel: 'وقود', salaries: 'رواتب وأجور', internet: 'إنترنت واتصالات', maintenance: 'صيانة', transport: 'نقل', other: 'مصاريف أخرى' },
  en: { rent: 'Rent', power: 'Electricity & generator', fuel: 'Fuel', salaries: 'Salaries & wages', internet: 'Internet & phone', maintenance: 'Maintenance', transport: 'Transport', other: 'Other' },
  ku: { rent: 'کرێ', power: 'کارەبا و مۆلیدە', fuel: 'سووتەمەنی', salaries: 'مووچە و هەقدەست', internet: 'ئینتەرنێت و تەلەفۆن', maintenance: 'چاککردنەوە', transport: 'گواستنەوە', other: 'خەرجیی تر' }
};

export interface ExpenseInput {
  category: ExpenseCategory;
  /** in the expense's currency (minor units) */
  amount: number;
  currency: 'IQD' | 'USD';
  /** the safe or bank it was paid from (a postable account under 18) */
  cashAccountCode: string;
  date: string;
  note?: string | undefined;
  /** the language the kind's words are written in on the voucher */
  lang: 'ar' | 'en' | 'ku';
  /** the receipt's photo: a JPEG as base64 */
  photo?: string | undefined;
}

/** A voucher with its photo's details (EntryView.image), and the rate it was booked at. */
export type ExpenseView = EntryView;

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const COM = 0xfe;
const isApp1To15 = (marker: number) => marker >= 0xe1 && marker <= 0xef;

/**
 * A JPEG without its metadata: the picture is walked segment by segment from its start to its end, the coded data of
 * each scan included; APP1–APP15 (EXIF with GPS and maker notes, XMP, ICC profiles, Photoshop's) and comments are left
 * out wherever they stand (between the scans of a progressive JPEG too), and so is anything after the picture's end (a
 * second picture or a camera maker's trailer, which can carry metadata of their own); APP0 (JFIF), the tables, the
 * frame and the scans are kept as they are. Null when the file can't be walked (no start of image, a segment longer than
 * the file, no scan, no end): such a file is not kept at all.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
  const b = bytes;
  if (b.length < 4 || b[0] !== 0xff || b[1] !== SOI) return null;
  const kept: Uint8Array[] = [b.subarray(0, 2)];
  let scans = 0;
  let i = 2;
  for (;;) {
    if (i >= b.length || b[i] !== 0xff) return null;
    // fill bytes before a marker
    let m = i + 1;
    while (m < b.length && b[m] === 0xff) m++;
    if (m >= b.length) return null;
    const marker = b[m]!;
    // the picture's end: what follows it is not kept (an end before any scan is no picture)
    if (marker === EOI) {
      if (!scans) return null;
      kept.push(new Uint8Array([0xff, EOI]));
      break;
    }
    // a marker without a length here (a restart marker outside a scan) means a broken file
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) return null;
    if (m + 2 >= b.length) return null;
    const length = (b[m + 1]! << 8) | b[m + 2]!;
    if (length < 2) return null;
    const end = m + 1 + length;
    if (end > b.length) return null;
    if (!isApp1To15(marker) && marker !== COM) kept.push(new Uint8Array([0xff]), b.subarray(m, end));
    i = end;
    if (marker === SOS) {
      scans++;
      // the scan's coded data, up to the next marker: in it a 0xFF is followed by 0x00 (a stuffed byte) or is a restart marker
      let j = i;
      for (;;) {
        if (j + 1 >= b.length) return null;
        if (b[j] !== 0xff) { j++; continue; }
        const next = b[j + 1]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { j += 2; continue; }
        break;
      }
      kept.push(b.subarray(i, j));
      i = j;
    }
  }
  const out = new Uint8Array(kept.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of kept) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The photo as it is kept: a whole JPEG of at most 400 KB and 2048 pixels a side, without its metadata. */
export function checkedPhoto(base64: string): Uint8Array {
  const bytes = fromBase64(base64);
  if (!bytes || bytes.length === 0) throw invalid([{ code: 'photo_invalid' }]);
  if (bytes.length > MAX_IMAGE_BYTES) throw invalid([{ code: 'photo_too_large' }]);
  if (imageMime(bytes) !== 'image/jpeg') throw invalid([{ code: 'photo_invalid' }]);
  const size = logoSize(bytes, 'image/jpeg');
  if (!size || size.width < 1 || size.height < 1 || size.width > MAX_PHOTO_SIDE || size.height > MAX_PHOTO_SIDE) throw invalid([{ code: 'photo_invalid' }]);
  const clean = stripJpegMetadata(bytes);
  if (!clean || imageMime(clean) !== 'image/jpeg') throw invalid([{ code: 'photo_invalid' }]);
  return clean;
}

/**
 * Records an expense: the payment voucher (by createVoucher's rules for who prepares it) and, when sent, the receipt's
 * photo, together or neither.
 */
export function recordExpense(db: Db, input: ExpenseInput, actor: Pick<Actor, 'id' | 'name' | 'permissions'>): ExpenseView {
  if (!isIsoDate(input.date)) throw invalid([{ code: 'date_invalid' }]);
  if (input.date > todayIso()) throw invalid([{ code: 'date_future' }]);
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw invalid([{ code: 'amount_invalid' }]);
  const photo = input.photo !== undefined ? checkedPhoto(input.photo) : null;
  const account = expenseAccounts(db)[input.category];
  const note = input.note?.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const description = (note || EXPENSE_WORDS[input.lang][input.category]).slice(0, 200);
  // the office's rate of the expense's own day, never one sent with it
  const rateX100 = input.currency === 'IQD' ? 100 : rateOn(db, input.date).rateX100;
  const voucher: VoucherInput = {
    kind: 'payment', date: input.date, cashAccountCode: input.cashAccountCode, description, currency: input.currency, rateX100,
    items: [{ accountCode: account, amount: input.amount, description }]
  };
  return transaction(db, () => {
    const made = createVoucher(db, voucher, actor.name, actor.id, preparerOf(actor));
    if (photo) {
      const sha256 = imageSha256(photo) ?? '';
      db.prepare('INSERT INTO entry_images (entry_id, mime, data, bytes, sha256, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(made.id, 'image/jpeg', photo, photo.length, sha256, actor.name, new Date().toISOString());
      audit(db, actor.name, 'attach_photo', 'entry', made.id, { bytes: photo.length, sha256 });
    }
    return getEntry(db, made.id);
  });
}

export interface EntryImageView { mime: 'image/jpeg'; data: string; bytes: number; createdBy: string; createdAt: string }

/** A voucher's photo, as base64 (the screens show it as a data: URL, which the app's content security policy allows). */
export function getEntryImage(db: Db, entryId: string): EntryImageView {
  const row = db.prepare('SELECT mime, data, bytes, created_by, created_at FROM entry_images WHERE entry_id = ?').get(entryId) as
    { mime: string; data: Uint8Array; bytes: number; created_by: string; created_at: string } | undefined;
  if (!row || row.mime !== 'image/jpeg') throw notFound('entry_image');
  return { mime: 'image/jpeg', data: toBase64(new Uint8Array(row.data)), bytes: Number(row.bytes), createdBy: row.created_by, createdAt: row.created_at };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const expenseBody = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  // no rate: a dollar expense is booked at the office's rate of its day
  currency: z.enum(['IQD', 'USD']),
  cashAccountCode: z.string().min(1).max(12),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(200).optional(),
  lang: z.enum(['ar', 'en', 'ku']).default('ar'),
  photo: z.string().min(1).max(MAX_PHOTO_TEXT).optional()
}).strict();

const idParam = z.object({ id: z.string().min(1).max(64) });

export const expensesApi: ApiExtension = {
  rules: {
    // an expense is a payment voucher: whoever prepares vouchers, as on the desktop's Expenses page
    'POST /api/expenses': 'entries.prepare'
  },
  routes(db, { actorOf }) {
    return [
      {
        method: 'POST', path: '/api/expenses',
        handler: async (req, reply) => {
          const body = parse(expenseBody, req.body) as ExpenseInput;
          const who = actorOf(req);
          // sent again with the same key (a lost answer, the phone's outbox): one voucher, one photo
          const made = onceOnly(db, req, reply, who, 'POST /api/expenses', () => {
            const result = recordExpense(db, body, who);
            return { id: result.id, result };
          }, (id) => getEntry(db, id));
          reply.status(201).send(made);
          return undefined;
        }
      },
      {
        // under /api/entries: refused to whoever may not read the books (cost-view.ts), and a voucher of another
        // branch to a user limited to branches (branches.ts), as the voucher itself
        method: 'GET', path: '/api/entries/:id/image',
        handler: async (req) => getEntryImage(db, parse(idParam, req.params).id)
      }
    ];
  }
};
