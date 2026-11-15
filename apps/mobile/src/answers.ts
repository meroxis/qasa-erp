import type { Answer } from './link';

/**
 * The office's answers as the API calls read them: a refusal becomes an OfficeError (its status, code and details, for
 * the screens to explain), and what goes into a path is checked first. api.ts and the calls of phone app 1.1 (owner/api.ts)
 * share them from here, so neither imports the other.
 */

/** A refusal from the office (status and its error code), for the screens to explain. */
export class OfficeError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details: unknown) {
    super(code);
  }
}

export function ok<T>(answer: Answer<T>): T {
  if (answer.s >= 200 && answer.s < 300) return answer.b;
  const body = answer.b as { error?: string; details?: unknown } | null;
  throw new OfficeError(answer.s, body?.error ?? 'error', body?.details ?? null);
}

export const q = (params: Record<string, string>) => '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

/** Ids from the office go into paths only as they are: letters, digits, dashes, underscores. */
export const safeId = (id: string) => {
  if (!/^[\w-]{1,64}$/.test(id)) throw new OfficeError(400, 'validation', null);
  return id;
};
