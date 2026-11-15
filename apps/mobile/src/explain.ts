import { OfficeError } from './api';
import type { Key } from './i18n';
import { LinkError } from './link';
import type { Me } from './roles';
import { STAFF_ERRORS, type ErrorText } from './staff/errors';

/**
 * The office's and the link's refusals, in the user's language (never a raw message with someone's data in it). An
 * office error code, or the code of a detail of a 400 validation answer, has its own text when a group of features
 * gives it one (src/staff/errors.ts); the first detail with a text wins.
 */

export type Translate = (k: Key, v?: Record<string, string | number>) => string;

export const BASE_ERRORS: Record<string, ErrorText> = {};
const ERRORS: Record<string, ErrorText> = { ...BASE_ERRORS, ...STAFF_ERRORS };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The text for a code (with its detail's numbers), or null when there is none. */
function textOf(t: Translate, code: string, detail: Record<string, unknown> | null): string | null {
  const text = Object.prototype.hasOwnProperty.call(ERRORS, code) ? ERRORS[code] : undefined;
  if (!text) return null;
  if (typeof text === 'string') return t(text);
  const vars = detail ? text.vars(detail) : null;
  return vars ? t(text.key, vars) : null;
}

/**
 * `me`: who the phone acts as, as the office said, for a refusal of the phone link (403 with details.phone): an office
 * that tells what its phone link offers (me.phoneLink) refused it on purpose; an office that tells nothing may be too
 * old for it.
 */
export function explainWith(t: Translate, error: unknown, me: Me | null = null): string {
  if (error instanceof OfficeError) {
    if (error.code === 'answer_too_large') return t('tooLarge');
    if (error.status === 403 && isRecord(error.details) && error.details.phone === true) return t(me?.phoneLink ? 'phoneRefused' : 'officeOld');
    const own = textOf(t, error.code, isRecord(error.details) ? error.details : null);
    if (own) return own;
    if (error.code === 'validation' && Array.isArray(error.details)) {
      for (const d of error.details) {
        const text = isRecord(d) && typeof d.code === 'string' ? textOf(t, d.code, d) : null;
        if (text) return text;
      }
    }
    if (error.status === 403) return t('forbidden');
    if (error.code === 'plan_limit') return t('planLimit');
    if (error.code === 'validation') return t('validation');
    return `${t('error')} ${error.code}`;
  }
  if (error instanceof LinkError) {
    const map: Partial<Record<LinkError['code'], Key>> = {
      unreachable: 'offline', timeout: 'offline', closed: 'offline', plan_limit: 'planLimit', phone_limit: 'phoneLimit',
      pairing_invalid: 'pairingInvalid', unknown_device: 'unknownDevice', stale: 'stale', tampered: 'tampered', bad_message: 'tampered'
    };
    const k = map[error.code];
    return k ? t(k) : `${t('error')} ${error.code}`;
  }
  return t('loadFailed');
}
