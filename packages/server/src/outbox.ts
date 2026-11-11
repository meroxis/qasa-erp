import { z } from 'zod';
import { audit } from './audit.ts';
import { AppError } from './errors.ts';
import { OFFLINE_REFERENCE } from './pos.ts';
import type { ApiExtension } from './routes.ts';

/**
 * The outbox of a PC on the office network (1.2): what its till or its receipts saved while the office server could not
 * be reached waits there, on that PC, until it is sent. Discarding one is an admin's decision, after a confirmation, and
 * is written to this company's audit log first (the PC removes it only once this answered), with what it was, so
 * nothing taken at a counter disappears without a trace. The route needs an admin: it is not listed in `rules`.
 */

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const discardSchema = z.object({
  key: z.string().regex(KEY),
  kind: z.enum(['pos_sale', 'voucher']),
  reference: z.string().max(40).regex(OFFLINE_REFERENCE).optional(),
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.enum(['IQD', 'USD']),
  lines: z.number().int().min(0).max(1000),
  madeBy: z.string().max(100),
  madeAt: z.string().max(30).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/),
  /** why it was not booked: the server's refusal code, or none (it was still waiting) */
  refusal: z.string().max(64).regex(/^[a-z0-9_]+$/).optional(),
  reason: z.string().max(500).optional()
});

export const outboxApi: ApiExtension = {
  routes(db, { actorOf }) {
    return [
      {
        method: 'POST', path: '/api/outbox/discarded',
        handler: async (req) => {
          const r = discardSchema.safeParse(req.body);
          if (!r.success) throw new AppError(400, 'validation', r.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })));
          const body = r.data;
          const actor = actorOf(req);
          // sent before (its answer was lost): the document is in the books, and the PC only drops its copy
          const booked = db.prepare('SELECT result_id FROM idempotency_keys WHERE idem_key = ? AND result_id IS NOT NULL').get(body.key) as { result_id: string } | undefined;
          audit(db, actor.name, 'discard', 'outbox', body.key, {
            kind: body.kind, reference: body.reference ?? null, total: body.total, currency: body.currency, lines: body.lines,
            madeBy: body.madeBy, madeAt: body.madeAt, refusal: body.refusal ?? null, reason: body.reason?.trim() || null,
            booked: booked?.result_id ?? null
          });
          return { recorded: true, booked: booked?.result_id ?? null };
        }
      }
    ];
  }
};
