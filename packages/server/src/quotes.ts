import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { lineAmount, type CurrencyCode } from '@qasa/core';
import type { Db } from './db.ts';
import { nextSequence, transaction } from './db.ts';
import { audit } from './audit.ts';
import { AppError, conflict, invalid, notFound } from './errors.ts';
import { createInvoice } from './invoices.ts';
import { createItem, listWarehouses } from './items.ts';
import { createParty } from './parties.ts';
import { getSettings } from './settings.ts';
import type { Actor } from './auth.ts';
import type { ApiExtension } from './routes.ts';

/**
 * Quotations (عروض الأسعار), on every plan. A quote is a priced offer to a customer — or to someone not yet a customer,
 * by name — with lines from the items or written freely, a discount, a validity date and terms. It goes from draft to
 * sent, then accepted or rejected; an accepted quote becomes a DRAFT sale invoice (checked and posted the usual way).
 * Free-text lines are invoiced on a service item made once (QT-SERVICE). A quote posts nothing to the books.
 */

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'invoiced' | 'cancelled';
export type QuoteAction = 'edit' | 'send' | 'accept' | 'reject' | 'reopen' | 'convert' | 'cancel' | 'duplicate';
export const QUOTE_STATUSES: readonly QuoteStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'invoiced', 'cancelled'];

export interface QuoteLineInput { itemId?: string | null | undefined; description: string; qtyMilli: number; unitPrice: number }
export interface QuoteInput {
  date: string;
  validUntil?: string | null | undefined;
  partyId?: string | null | undefined;
  customerName?: string | null | undefined;
  currency: CurrencyCode;
  discount?: number | undefined;
  notes?: string | undefined;
  terms?: string | undefined;
  lines: QuoteLineInput[];
}
export interface QuoteLineView { seq: number; itemId: string | null; itemCode: string | null; description: string; qtyMilli: number; unitPrice: number; amount: number }
export interface QuoteSummary {
  id: string;
  number: string;
  date: string;
  validUntil: string | null;
  party: { id: string; code: string; name: string; phone: string } | null;
  customerName: string;
  currency: CurrencyCode;
  subtotal: number;
  discount: number;
  total: number;
  status: QuoteStatus;
  /** still a draft or sent, and past its validity date */
  expired: boolean;
  invoice: { id: string; number: string | null; status: string } | null;
}
export interface QuoteView extends QuoteSummary {
  party: (QuoteSummary['party'] & { address: string }) | null;
  lines: QuoteLineView[];
  notes: string;
  terms: string;
  createdBy: string;
  createdAt: string;
  actions: QuoteAction[];
}
export interface ConvertInput {
  date: string;
  warehouseId?: string | undefined;
  rateX100?: number | undefined;
  /** for a quote to someone not yet a customer: makes them a customer (the quote's name if none is given) */
  customer?: { name?: string | undefined; phone?: string | undefined; address?: string | undefined } | undefined;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: unknown): s is string => typeof s === 'string' && ISO.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const trimmed = (s: string | null | undefined) => s?.trim() || null;
const SERVICE_ITEM = 'QT-SERVICE';

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Row {
  id: string; number: string; date: string; valid_until: string | null; party_id: string | null; customer_name: string | null; currency: CurrencyCode;
  discount: number; status: QuoteStatus; invoice_id: string | null; notes: string | null; terms: string | null; created_by: string; created_at: string;
  p_code: string | null; p_name: string | null; p_phone: string | null; p_address: string | null;
  inv_number: string | null; inv_status: string | null;
}
const SELECT = `SELECT q.*, p.code AS p_code, p.name AS p_name, p.phone AS p_phone, p.address AS p_address,
                       i.number AS inv_number, i.status AS inv_status
                FROM quotes q LEFT JOIN parties p ON p.id = q.party_id LEFT JOIN invoices i ON i.id = q.invoice_id`;

function linesOf(db: Db, quoteId?: string): Map<string, QuoteLineView[]> {
  const rows = db.prepare(`SELECT l.*, it.code AS item_code FROM quote_lines l LEFT JOIN items it ON it.id = l.item_id
                           ${quoteId ? 'WHERE l.quote_id = ?' : ''} ORDER BY l.quote_id, l.seq`).all(...(quoteId ? [quoteId] : [])) as {
    quote_id: string; seq: number; item_id: string | null; item_code: string | null; description: string; qty_milli: number; unit_price: number;
  }[];
  const map = new Map<string, QuoteLineView[]>();
  for (const r of rows) {
    const list = map.get(r.quote_id) ?? [];
    const qtyMilli = Number(r.qty_milli);
    const unitPrice = Number(r.unit_price);
    list.push({ seq: Number(r.seq), itemId: r.item_id, itemCode: r.item_code, description: r.description, qtyMilli, unitPrice, amount: lineAmount(qtyMilli, unitPrice) });
    map.set(r.quote_id, list);
  }
  return map;
}

/** An invoiced quote whose invoice was cancelled is accepted again (it can be invoiced anew). */
function statusOf(r: Row): QuoteStatus {
  if (r.status === 'invoiced' && r.inv_status === 'cancelled') return 'accepted';
  return r.status;
}

function summarize(r: Row, lines: QuoteLineView[], today: string): QuoteSummary {
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const discount = Number(r.discount);
  const status = statusOf(r);
  return {
    id: r.id, number: r.number, date: r.date, validUntil: r.valid_until,
    party: r.party_id ? { id: r.party_id, code: r.p_code ?? '', name: r.p_name ?? '', phone: r.p_phone ?? '' } : null,
    customerName: r.p_name ?? r.customer_name ?? '',
    currency: r.currency, subtotal, discount, total: Math.max(0, subtotal - discount), status,
    expired: (status === 'draft' || status === 'sent') && !!r.valid_until && r.valid_until < today,
    invoice: r.invoice_id && status === 'invoiced' ? { id: r.invoice_id, number: r.inv_number, status: r.inv_status ?? '' } : null
  };
}

export interface QuoteFilters { status?: QuoteStatus | 'open' | undefined; partyId?: string | undefined; q?: string | undefined }

export function listQuotes(db: Db, f: QuoteFilters = {}, today = todayIso()): QuoteSummary[] {
  const where: string[] = [];
  const params: string[] = [];
  if (f.partyId) { where.push('q.party_id = ?'); params.push(f.partyId); }
  if (f.q) {
    where.push("(LOWER(q.number) LIKE ? OR LOWER(COALESCE(p.name, q.customer_name, '')) LIKE ? OR COALESCE(p.phone, '') LIKE ?)");
    const like = `%${f.q.toLowerCase()}%`;
    params.push(like, like, like);
  }
  const rows = db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.date DESC, q.number DESC LIMIT 1000`).all(...params) as unknown as Row[];
  const lines = linesOf(db);
  return rows
    .map((r) => summarize(r, lines.get(r.id) ?? [], today))
    .filter((x) => !f.status || (f.status === 'open' ? x.status === 'draft' || x.status === 'sent' || x.status === 'accepted' : x.status === f.status));
}

function load(db: Db, id: string): Row {
  const r = db.prepare(`${SELECT} WHERE q.id = ?`).get(id) as Row | undefined;
  if (!r) throw notFound('quote');
  return r;
}

function actionsFor(status: QuoteStatus): QuoteAction[] {
  const out: QuoteAction[] = ['duplicate'];
  if (status === 'draft' || status === 'sent') out.push('edit');
  if (status === 'draft') out.push('send');
  if (status === 'draft' || status === 'sent') out.push('accept', 'reject');
  if (status === 'sent' || status === 'accepted' || status === 'rejected') out.push('reopen');
  if (status === 'accepted') out.push('convert');
  if (status !== 'invoiced' && status !== 'cancelled') out.push('cancel');
  return out;
}

export function getQuote(db: Db, id: string, actor: { permissions: readonly string[] } | null = null, today = todayIso()): QuoteView {
  const r = load(db, id);
  const lines = linesOf(db, id).get(id) ?? [];
  const base = summarize(r, lines, today);
  const may = !actor || actor.permissions.includes('sales') || actor.permissions.includes('admin');
  return {
    ...base,
    party: base.party ? { ...base.party, address: r.p_address ?? '' } : null,
    lines, notes: r.notes ?? '', terms: r.terms ?? '', createdBy: r.created_by, createdAt: r.created_at,
    actions: may ? actionsFor(base.status) : []
  };
}

// ——— writing ———

type Problem = { code: string; line?: number };

function inputErrors(db: Db, input: QuoteInput): Problem[] {
  const errors: Problem[] = [];
  if (!isDate(input.date)) errors.push({ code: 'date_invalid' });
  if (input.validUntil && (!isDate(input.validUntil) || (isDate(input.date) && input.validUntil < input.date))) errors.push({ code: 'qt_valid_until_invalid' });
  if (input.currency !== 'IQD' && input.currency !== 'USD') errors.push({ code: 'currency_invalid' });
  if (input.partyId) {
    const party = db.prepare('SELECT type, active FROM parties WHERE id = ?').get(input.partyId) as { type: string; active: number } | undefined;
    if (!party || party.type !== 'customer') errors.push({ code: 'customer_required' });
    else if (Number(party.active) !== 1) errors.push({ code: 'party_inactive' });
  } else if (!input.customerName?.trim()) {
    errors.push({ code: 'qt_customer_required' });
  }
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) errors.push({ code: 'qt_lines_required' });
  if (lines.length > 300) errors.push({ code: 'qt_lines_required' });
  lines.forEach((l, i) => {
    if (l.itemId) {
      if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(l.itemId)) errors.push({ code: 'item_invalid', line: i + 1 });
    } else if (typeof l.description !== 'string' || !l.description.trim()) {
      errors.push({ code: 'qt_line_description_required', line: i + 1 });
    }
    if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0) errors.push({ code: 'line_qty_invalid', line: i + 1 });
    if (!Number.isSafeInteger(l.unitPrice) || l.unitPrice < 0) errors.push({ code: 'line_price_invalid', line: i + 1 });
  });
  const discount = input.discount ?? 0;
  if (!Number.isSafeInteger(discount) || discount < 0) errors.push({ code: 'discount_invalid' });
  else if (!errors.length && discount > lines.reduce((s, l) => s + lineAmount(l.qtyMilli, l.unitPrice), 0)) errors.push({ code: 'discount_invalid' });
  return errors;
}

/** A line written without a description takes its item's name in the quote's language order (ar, en, ku). */
function descriptionOf(db: Db, l: QuoteLineInput): string {
  if (l.description?.trim()) return l.description.trim();
  const it = db.prepare('SELECT name_ar, name_en, name_ku FROM items WHERE id = ?').get(String(l.itemId)) as { name_ar: string; name_en: string; name_ku: string } | undefined;
  return it ? it.name_ar || it.name_en || it.name_ku : '';
}

function writeLines(db: Db, quoteId: string, lines: QuoteLineInput[]): void {
  db.prepare('DELETE FROM quote_lines WHERE quote_id = ?').run(quoteId);
  const insert = db.prepare('INSERT INTO quote_lines (quote_id, seq, item_id, description, qty_milli, unit_price) VALUES (?, ?, ?, ?, ?, ?)');
  lines.forEach((l, i) => insert.run(quoteId, i + 1, l.itemId || null, descriptionOf(db, l), l.qtyMilli, l.unitPrice));
}

function nextNumber(db: Db, date: string): string {
  const year = date.slice(0, 4);
  return `QT-${year}-${String(nextSequence(db, `quote:${year}`)).padStart(4, '0')}`;
}

export function createQuote(db: Db, input: QuoteInput, actor: Actor): QuoteView {
  const errors = inputErrors(db, input);
  if (errors.length) throw invalid(errors);
  const id = transaction(db, () => {
    const newId = randomUUID();
    const now = new Date().toISOString();
    const number = nextNumber(db, input.date);
    db.prepare(`INSERT INTO quotes (id, number, date, valid_until, party_id, customer_name, currency, discount, status, notes, terms, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`)
      .run(newId, number, input.date, input.validUntil || null, input.partyId || null, input.partyId ? null : trimmed(input.customerName),
        input.currency, input.discount ?? 0, trimmed(input.notes), trimmed(input.terms), actor.name, now, now);
    writeLines(db, newId, input.lines);
    audit(db, actor.name, 'create', 'quote', newId, { number });
    return newId;
  });
  return getQuote(db, id, actor);
}

export function updateQuote(db: Db, id: string, input: QuoteInput, actor: Actor): QuoteView {
  const q = getQuote(db, id);
  if (!q.actions.includes('edit')) throw conflict('action_not_allowed', { action: 'edit' });
  const errors = inputErrors(db, input);
  if (errors.length) throw invalid(errors);
  transaction(db, () => {
    db.prepare(`UPDATE quotes SET date = ?, valid_until = ?, party_id = ?, customer_name = ?, currency = ?, discount = ?, notes = ?, terms = ?, updated_at = ?
                WHERE id = ?`)
      .run(input.date, input.validUntil || null, input.partyId || null, input.partyId ? null : trimmed(input.customerName), input.currency,
        input.discount ?? 0, trimmed(input.notes), trimmed(input.terms), new Date().toISOString(), id);
    writeLines(db, id, input.lines);
    audit(db, actor.name, 'update', 'quote', id, { number: q.number });
  });
  return getQuote(db, id, actor);
}

const MOVES: Record<'send' | 'accept' | 'reject' | 'reopen' | 'cancel', QuoteStatus> = {
  send: 'sent', accept: 'accepted', reject: 'rejected', reopen: 'draft', cancel: 'cancelled'
};

export function setQuoteStatus(db: Db, id: string, action: keyof typeof MOVES, actor: Actor, reason?: string): QuoteView {
  const q = getQuote(db, id);
  if (!q.actions.includes(action)) throw conflict('action_not_allowed', { action });
  transaction(db, () => {
    // an invoiced quote whose invoice was cancelled reads as accepted; leaving it clears the old link
    db.prepare('UPDATE quotes SET status = ?, invoice_id = CASE WHEN ? THEN NULL ELSE invoice_id END, updated_at = ? WHERE id = ?')
      .run(MOVES[action], q.status === 'accepted' ? 1 : 0, new Date().toISOString(), id);
    audit(db, actor.name, `quote_${action}`, 'quote', id, { number: q.number, ...(reason?.trim() ? { reason: reason.trim() } : {}) });
  });
  return getQuote(db, id, actor);
}

export function duplicateQuote(db: Db, id: string, actor: Actor, today = todayIso()): QuoteView {
  const q = getQuote(db, id);
  const days = q.validUntil ? Math.max(0, Math.round((Date.parse(q.validUntil + 'T00:00:00Z') - Date.parse(q.date + 'T00:00:00Z')) / 86_400_000)) : null;
  const validUntil = days === null ? null : new Date(Date.parse(today + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
  const partyActive = q.party ? (db.prepare('SELECT active FROM parties WHERE id = ?').get(q.party.id) as { active: number }).active === 1 : false;
  return createQuote(db, {
    date: today, validUntil, currency: q.currency, discount: q.discount, notes: q.notes, terms: q.terms,
    ...(q.party && partyActive ? { partyId: q.party.id } : { customerName: q.customerName }),
    lines: q.lines.map((l) => ({ itemId: l.itemId, description: l.description, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice }))
  }, actor);
}

const SERVICE_NAMES = { ar: 'خدمات وأعمال حسب عرض السعر', en: 'Services and works (quoted)', ku: 'خزمەتگوزاری و کار بەپێی نرخدانان' };

function serviceItem(db: Db, currency: CurrencyCode, user: string): string {
  const found = db.prepare('SELECT id, active FROM items WHERE code = ?').get(SERVICE_ITEM) as { id: string; active: number } | undefined;
  if (found) {
    if (Number(found.active) !== 1) db.prepare('UPDATE items SET active = 1 WHERE id = ?').run(found.id);
    return found.id;
  }
  return createItem(db, { code: SERVICE_ITEM, name: SERVICE_NAMES, unit: 'service', salePrice: 0, saleCurrency: currency, trackStock: false }, user).id;
}

/** An accepted quote becomes a draft sale invoice, to check and post the usual way. */
export function convertQuote(db: Db, id: string, input: ConvertInput, actor: Actor): QuoteView {
  const q = getQuote(db, id);
  if (!q.actions.includes('convert')) throw conflict('action_not_allowed', { action: 'convert' });
  const errors: Problem[] = [];
  if (!isDate(input.date)) errors.push({ code: 'date_invalid' });
  else if (input.date < q.date) errors.push({ code: 'qt_invoice_before_quote' });
  const rate = q.currency === 'USD' ? input.rateX100 ?? getSettings(db).defaultRateX100 : 100;
  if (!Number.isSafeInteger(rate) || rate <= 0) errors.push({ code: 'rate_invalid' });
  const warehouseId = input.warehouseId ?? listWarehouses(db).find((w) => w.active)?.id;
  if (!warehouseId) errors.push({ code: 'warehouse_invalid' });
  if (q.party && !(db.prepare('SELECT active FROM parties WHERE id = ?').get(q.party.id) as { active: number }).active) errors.push({ code: 'party_inactive' });
  if (errors.length) throw invalid(errors);
  transaction(db, () => {
    let partyId = q.party?.id;
    if (!partyId) {
      const name = input.customer?.name?.trim() || q.customerName;
      const party = createParty(db, 'customer', { name, phone: input.customer?.phone, address: input.customer?.address }, actor.name);
      partyId = party.id;
      db.prepare('UPDATE quotes SET party_id = ?, customer_name = NULL WHERE id = ?').run(partyId, id);
    }
    const needsService = q.lines.some((l) => !l.itemId);
    const serviceId = needsService ? serviceItem(db, q.currency, actor.name) : null;
    const draft = createInvoice(db, {
      kind: 'sale', date: input.date, partyId, warehouseId: warehouseId!, currency: q.currency, rateX100: rate, payment: 'credit', discount: q.discount,
      notes: q.number,
      lines: q.lines.map((l) => ({ itemId: l.itemId ?? serviceId!, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, description: l.description }))
    }, actor.name);
    db.prepare("UPDATE quotes SET status = 'invoiced', invoice_id = ?, updated_at = ? WHERE id = ?").run(draft.id, new Date().toISOString(), id);
    audit(db, actor.name, 'quote_convert', 'quote', id, { number: q.number, invoice: draft.id });
  });
  return getQuote(db, id, actor);
}

export interface QuotesSummary { open: number; openValue: Record<CurrencyCode, number>; expired: number; acceptedThisMonth: number; quotedThisMonth: number }

export function quotesSummary(db: Db, today = todayIso()): QuotesSummary {
  const all = listQuotes(db, {}, today);
  const openValue: Record<CurrencyCode, number> = { IQD: 0, USD: 0 };
  const month = today.slice(0, 7);
  let open = 0;
  let expired = 0;
  let acceptedThisMonth = 0;
  let quotedThisMonth = 0;
  for (const q of all) {
    if (q.status === 'draft' || q.status === 'sent') { open += 1; openValue[q.currency] += q.total; }
    if (q.expired) expired += 1;
    if (q.date.startsWith(month) && q.status !== 'cancelled') {
      quotedThisMonth += 1;
      if (q.status === 'accepted' || q.status === 'invoiced') acceptedThisMonth += 1;
    }
  }
  return { open, openValue, expired, acceptedThisMonth, quotedThisMonth };
}

// ——— the API ———

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
  return r.data;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().min(1).max(64);
const text = (max: number) => z.string().max(max);
const quoteBody = z.object({
  date, validUntil: date.or(z.literal('')).nullable().optional(), partyId: id.nullable().optional(), customerName: text(200).nullable().optional(),
  currency: z.enum(['IQD', 'USD']), discount: z.number().int().optional(), notes: text(2000).optional(), terms: text(2000).optional(),
  lines: z.array(z.object({ itemId: id.nullable().optional(), description: text(500), qtyMilli: z.number().int(), unitPrice: z.number().int() })).max(300)
});
const idParam = z.object({ id });

/** Quotations: looking needs a signed-in user, changes need the sales permission. */
export const quotesApi: ApiExtension = {
  rules: {
    'POST /api/quotes': 'sales',
    'PUT /api/quotes/:id': 'sales',
    'POST /api/quotes/:id/status': 'sales',
    'POST /api/quotes/:id/duplicate': 'sales',
    'POST /api/quotes/:id/convert': 'sales'
  },
  routes(db, { actorOf }) {
    return [
      { method: 'GET', path: '/api/quotes/summary', handler: async () => quotesSummary(db) },
      {
        method: 'GET', path: '/api/quotes',
        handler: async (req) => {
          const f = parse(z.object({ status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'invoiced', 'cancelled', 'open']).optional(), partyId: id.optional(), q: text(100).optional() }), req.query);
          return listQuotes(db, { status: f.status, partyId: f.partyId, q: f.q?.trim() || undefined });
        }
      },
      { method: 'GET', path: '/api/quotes/:id', handler: async (req) => getQuote(db, parse(idParam, req.params).id, actorOf(req)) },
      {
        method: 'POST', path: '/api/quotes',
        handler: async (req, reply) => {
          reply.status(201).send(createQuote(db, parse(quoteBody, req.body) as QuoteInput, actorOf(req)));
          return undefined;
        }
      },
      { method: 'PUT', path: '/api/quotes/:id', handler: async (req) => updateQuote(db, parse(idParam, req.params).id, parse(quoteBody, req.body) as QuoteInput, actorOf(req)) },
      {
        method: 'POST', path: '/api/quotes/:id/status',
        handler: async (req) => {
          const body = parse(z.object({ action: z.enum(['send', 'accept', 'reject', 'reopen', 'cancel']), reason: text(500).optional() }), req.body);
          return setQuoteStatus(db, parse(idParam, req.params).id, body.action, actorOf(req), body.reason);
        }
      },
      {
        method: 'POST', path: '/api/quotes/:id/duplicate',
        handler: async (req, reply) => {
          reply.status(201).send(duplicateQuote(db, parse(idParam, req.params).id, actorOf(req)));
          return undefined;
        }
      },
      {
        method: 'POST', path: '/api/quotes/:id/convert',
        handler: async (req) => {
          const body = parse(z.object({
            date, warehouseId: id.optional(), rateX100: z.number().int().positive().optional(),
            customer: z.object({ name: text(200).optional(), phone: text(50).optional(), address: text(300).optional() }).optional()
          }), req.body);
          return convertQuote(db, parse(idParam, req.params).id, body, actorOf(req));
        }
      }
    ];
  }
};
