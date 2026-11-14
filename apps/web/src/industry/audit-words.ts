import { isKey, type I18n, type Key } from '../i18n.ts';

/**
 * The audit log in the reader's language (Settings → Periods and year-end). The server writes each row with its own
 * words for what was done, to what, and often which one ("update", "print_design", "voucher"): the page shows the
 * app's names for them, never the server's words.
 */

/** What was done: "po.send" and "price_list.set" have their words under a_po_send and a_price_list_set. */
export function auditAction(i18n: Pick<I18n, 't'>, action: string): string {
  const key = `a_${action.replace(/\./g, '_')}`;
  return isKey(key) ? i18n.t(key) : action;
}

/** What it was done to. */
export function auditEntity(i18n: Pick<I18n, 't'>, entity: string): string {
  const key = `e_${entity}`;
  return isKey(key) ? i18n.t(key) : entity;
}

const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
/** A word of the server's own (a setting's key, "company", a kind of paper), as against a number, a period or a code. */
const SERVER_WORD = /^[a-z][a-z_]*$/;

/**
 * Which one, after the entity's name: the kind of paper a print design is for (in words), the start of a record's id,
 * a period or a number as it is. Nothing for a word of the server's own that has no name here (a setting's key, the
 * "company" of the one print header): the entity's name says it already.
 */
export function auditRef(i18n: Pick<I18n, 't'>, entity: string, entityId: string | null): { text: string; plain: boolean } | null {
  if (!entityId) return null;
  if (entity === 'print_design') {
    const key = `pd_doc_${entityId}`;
    return isKey(key) ? { text: i18n.t(key as Key), plain: true } : null;
  }
  if (RECORD_ID.test(entityId)) return { text: entityId.slice(0, 8), plain: false };
  if (SERVER_WORD.test(entityId)) return null;
  return { text: entityId.length > 12 ? entityId.slice(0, 8) : entityId, plain: false };
}
