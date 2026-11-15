import { OfficeError } from './api';
import type { Key } from './i18n';
import { LinkError } from './link';
import { OWNER_ERRORS } from './owner/errors';
import type { Me } from './roles';

/**
 * The office's and the link's refusals, in the user's language (never a raw message with someone's data in it). An
 * office error code, or the code of a 400 validation answer's details (the first one known), names its text; the
 * details' values fill it in (a period, a number).
 */

type Translate = (k: Key, v?: Record<string, string | number>) => string;

/** The text of an office refusal, and the values it takes from the refusal's details. */
export interface ErrorText {
  key: Key;
  vars?: (details: Record<string, unknown>) => Record<string, string | number>;
}

const BASE_ERRORS: Record<string, ErrorText> = {
  plan_limit: { key: 'planLimit' },
  // an answer too big for one message (phone link 1.1): the office says so instead of dropping the link
  answer_too_large: { key: 'tooLarge' }
};

/** Every refusal the app explains: its own, and phone app 1.1's for the owner and the managers (owner/errors.ts). */
export const ERRORS: Record<string, ErrorText> = { ...BASE_ERRORS, ...OWNER_ERRORS };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function explainWith(t: Translate, error: unknown, me: Me | null = null): string {
  if (error instanceof OfficeError) {
    // the phone link refused it: an office before phone app 1.1 says nothing of what it offers, and may need an
    // update; one that does was asked something it does not take from this phone (no claim about its age)
    if (error.status === 403 && isRecord(error.details) && error.details.phone === true) return t(me?.phoneLink ? 'phoneRefused' : 'officeOld');
    if (error.status === 403) return t('forbidden');
    const known = ERRORS[error.code];
    if (known) return t(known.key, known.vars?.(isRecord(error.details) ? error.details : {}));
    if (error.code === 'validation') {
      for (const d of Array.isArray(error.details) ? error.details : []) {
        const text = isRecord(d) && typeof d.code === 'string' ? ERRORS[d.code] : undefined;
        if (text) return t(text.key, text.vars?.(d as Record<string, unknown>));
      }
      return t('validation');
    }
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
