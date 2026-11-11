import { createHash } from 'node:crypto';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import { conflict, invalid } from './errors.ts';
import type { Actor } from './auth.ts';
import type { ApiReply, ApiRequest } from './routes.ts';

/**
 * Sending a document again without making it twice (1.2). A PC on the office network that lost the link, or a phone,
 * sends the same request again later with the same key, made by the client (a UUID v4) in this header. The first time,
 * the document is made and the key is kept with it in the same transaction, so a power cut keeps both or neither. Any
 * later request with that key (also one arriving while the first is still running) answers with the document made the
 * first time, and makes nothing. A key belongs to the company (it is kept in the company's books) and to the user who
 * sent it first: the same key from someone else, for another route or with another body is refused. Keys are kept
 * IDEMPOTENCY_KEEP_DAYS days.
 */

export const IDEMPOTENCY_HEADER = 'x-qasa-idempotency';
/** An answer given again from a kept key says so in this header (the body is the document as it is now). */
export const IDEMPOTENCY_REPLAY_HEADER = 'x-qasa-idempotent-replay';
/** At least 30 days were asked for; three times that covers a PC that stays offline for weeks. */
export const IDEMPOTENCY_KEEP_DAYS = 90;
const DAY_MS = 86_400_000;
/** Old keys are cleared at most this often (inside a document's own transaction, a few rows at a time). */
const PRUNE_EVERY_MS = 60 * 60_000;
const PRUNE_ROWS = 500;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The key a request names (lower case), null when it names none; anything but one UUID v4 is refused. */
export function idempotencyKeyOf(headers: ApiRequest['headers']): string | null {
  const raw = headers[IDEMPOTENCY_HEADER];
  if (raw === undefined) return null;
  const value = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!UUID_V4.test(key)) throw invalid([{ code: 'idempotency_key_invalid' }]);
  return key;
}

/** Who a key belongs to: the user's id, or (without sign-in, where every PC is the owner) the owner's. */
const ownerOf = (actor: Pick<Actor, 'id' | 'name'>): string => (actor.id ? `user:${actor.id}` : `name:${actor.name}`).slice(0, 191);

/** A small non-cryptographic hash, only where node:crypto has none (the website demo, which never sends keys). */
function fallbackHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `f:${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
}

/** What the request asks for: the route, its path parameters and its body, as sent. */
export function requestFingerprint(route: string, params: unknown, body: unknown): string {
  const text = JSON.stringify([route, params ?? null, body ?? null]);
  try {
    return createHash('sha256').update(text).digest('hex');
  } catch {
    return fallbackHash(text);
  }
}

let lastPrune = 0;

/** Clears keys older than the keeping time (a few at a time; the index on created_at keeps it quick). */
export function pruneIdempotencyKeys(db: Db, now = Date.now()): number {
  const cutoff = new Date(now - IDEMPOTENCY_KEEP_DAYS * DAY_MS).toISOString();
  const old = db.prepare('SELECT idem_key FROM idempotency_keys WHERE created_at < ? ORDER BY created_at LIMIT ?').all(cutoff, PRUNE_ROWS) as { idem_key: string }[];
  const drop = db.prepare('DELETE FROM idempotency_keys WHERE idem_key = ?');
  for (const r of old) drop.run(r.idem_key);
  return old.length;
}

/** Forgets when old keys were last cleared (tests). */
export function resetIdempotencyPrune(): void {
  lastPrune = 0;
}

interface KeyRow { user_key: string; route: string; request_hash: string; result_id: string | null }

function kept(db: Db, key: string): KeyRow | undefined {
  return db.prepare('SELECT user_key, route, request_hash, result_id FROM idempotency_keys WHERE idem_key = ?').get(key) as KeyRow | undefined;
}

/** A unique key refused the row: another request with the same key got there first (a second server process). */
const isDuplicate = (error: unknown) => /UNIQUE constraint failed: idempotency_keys|ER_DUP_ENTRY|Duplicate entry/i.test(error instanceof Error ? `${error.message} ${(error as { code?: string }).code ?? ''}` : String(error));

/**
 * Makes a document once per key. `make` makes it (inside one transaction with the key) and says the id it is known by;
 * `again` gives the answer for that id when the key comes back. Without a key, `make` runs as it always did.
 *
 * The route is the route's pattern ("POST /api/invoices/:id/post"), so a key can't be used for another kind of request.
 * `fingerprint` is the part of the body that must be the same each time (all of it unless a route says otherwise).
 */
export function onceOnly<T>(
  db: Db, req: ApiRequest, reply: ApiReply | null, actor: Pick<Actor, 'id' | 'name'>, route: string,
  make: () => { id: string; result: T }, again: (id: string) => T, options: { fingerprint?: unknown } = {}
): T {
  const key = idempotencyKeyOf(req.headers);
  if (!key) return make().result;
  const owner = ownerOf(actor);
  const hash = requestFingerprint(route, req.params, 'fingerprint' in options ? options.fingerprint : req.body);
  const replay = (row: KeyRow): T => {
    // the same key for someone else, another route or another body: never their document, never a second one
    if (row.user_key !== owner || row.route !== route || row.request_hash !== hash || !row.result_id) throw conflict('idempotency_key_reused');
    reply?.header(IDEMPOTENCY_REPLAY_HEADER, '1');
    return again(row.result_id);
  };
  try {
    return transaction(db, () => {
      const now = Date.now();
      if (now - lastPrune > PRUNE_EVERY_MS) {
        lastPrune = now;
        pruneIdempotencyKeys(db, now);
      }
      const row = kept(db, key);
      if (row) return replay(row);
      // the key first: a second request with it waits on this row until the document is made, then answers from it
      db.prepare('INSERT INTO idempotency_keys (idem_key, user_key, route, request_hash, result_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)')
        .run(key, owner, route, hash, new Date(now).toISOString());
      const made = make();
      db.prepare('UPDATE idempotency_keys SET result_id = ? WHERE idem_key = ?').run(made.id, key);
      return made.result;
    });
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    const row = kept(db, key);
    if (!row) throw error;
    return replay(row);
  }
}
