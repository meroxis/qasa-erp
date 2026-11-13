import { normalizeForSearch, toWesternDigits } from '@qasa/core';
import { isNetworkError, newIdempotencyKey, type PartyInput, type PartyType, type PartyView, type Permission, type SendOptions } from '../api.ts';
import { whatsappNumber } from '../share.ts';

/**
 * Adding a customer or supplier from inside a picker (PartyPicker.tsx): who may, what is sent, who already looks the
 * same, and sending it so that a try whose answer was lost never adds the same person twice.
 */

/** The same rule as the server's (routes.ts, partyPermission): sales adds customers, purchasing adds suppliers. */
export const partyPermission = (type: PartyType): Permission => (type === 'supplier' ? 'purchases' : 'sales');

/** Whether the "+" shows at all. Unknown permissions (not loaded yet): hidden; the server refuses the rest anyway. */
export function mayAddParty(permissions: readonly Permission[] | undefined, type: PartyType): boolean {
  return !!permissions && permissions.includes(partyPermission(type));
}

/** The limits the server's own check has (routes.ts, partySchema), so a refusal is said at the field. */
export const QUICK_LIMITS = { name: 200, phone: 50, address: 300 } as const;

export interface QuickPartyFields { name: string; phone: string; city: string }

export type QuickPartyCheck = { ok: true; input: PartyInput } | { ok: false; field: keyof QuickPartyFields; code: 'name_required' | 'too_long' };

/**
 * What the form sends: the name (required), and the phone and the city or address when given; trimmed, and nothing
 * else. Everything else about the party keeps the Customers page's defaults (its account, no credit limit, active).
 */
export function quickPartyInput(fields: QuickPartyFields): QuickPartyCheck {
  const name = fields.name.trim().replace(/\s+/g, ' ');
  const phone = fields.phone.trim();
  const address = fields.city.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, field: 'name', code: 'name_required' };
  if (name.length > QUICK_LIMITS.name) return { ok: false, field: 'name', code: 'too_long' };
  if (phone.length > QUICK_LIMITS.phone) return { ok: false, field: 'phone', code: 'too_long' };
  if (address.length > QUICK_LIMITS.address) return { ok: false, field: 'city', code: 'too_long' };
  return { ok: true, input: { name, ...(phone ? { phone } : {}), ...(address ? { address } : {}) } };
}

/** A phone number as its digits (Arabic and Persian digits too); an Iraqi mobile always the same way (9647…). */
export function phoneDigits(phone: string | null | undefined): string {
  if (!phone) return '';
  const mobile = whatsappNumber(phone);
  if (mobile) return mobile;
  return toWesternDigits(phone).replace(/\D/g, '');
}

export interface SameParty { party: PartyView; samePhone: boolean; sameName: boolean }

/**
 * The parties of the same kind that already have this phone number or exactly this name (as the search reads names:
 * letter case, Arabic and Kurdish letter forms and extra spaces don't count). The same phone first, at most five.
 */
export function sameParties(parties: readonly PartyView[], type: PartyType, fields: { name: string; phone?: string | undefined }): SameParty[] {
  const name = normalizeForSearch(fields.name);
  const phone = phoneDigits(fields.phone);
  return parties
    .filter((p) => p.type === type)
    .map((party) => ({
      party,
      samePhone: phone.length >= 5 && phoneDigits(party.phone) === phone,
      sameName: !!name && normalizeForSearch(party.name) === name
    }))
    .filter((s) => s.samePhone || s.sameName)
    .sort((a, b) => Number(b.samePhone) - Number(a.samePhone) || Number(b.party.active) - Number(a.party.active))
    .slice(0, 5);
}

/** How long a quick add waits for the server before it says the link is down (the till's own wait). */
export const QUICK_ADD_TIMEOUT_MS = 12_000;

/** The key a quick add is sent with: the same one every time the same person is sent, a new one once anything changed. */
export interface QuickKey { key: string; of: string }

export function quickKey(held: QuickKey | null, type: PartyType, input: PartyInput, make: () => string = newIdempotencyKey): QuickKey {
  const of = JSON.stringify([type, input.name, input.phone ?? '', input.address ?? '']);
  return held && held.of === of ? held : { key: make(), of };
}

export type QuickAddResult =
  | { status: 'added'; party: PartyView; key: null }
  /** someone the same is already there: nothing was sent; the person picks one of them or adds anyway */
  | { status: 'same'; same: SameParty[]; key: QuickKey | null }
  /** the server was not reached: nothing is known to be added; the key is kept, so the next try can't add it twice */
  | { status: 'offline'; key: QuickKey };

export interface QuickAddDeps {
  list(type: PartyType): Promise<PartyView[]>;
  create(type: PartyType, input: PartyInput, options: SendOptions): Promise<PartyView>;
  makeKey?: () => string;
}

/**
 * Adds the party through the same request the Customers page makes (the server checks the permission and the fields),
 * after looking for someone with the same phone or name; `force` skips that look (the person chose "add anyway").
 * A refusal by the server is thrown as it is.
 */
export async function quickAddParty(
  type: PartyType, input: PartyInput, opts: { force?: boolean; held?: QuickKey | null }, deps: QuickAddDeps
): Promise<QuickAddResult> {
  const held = opts.held ?? null;
  try {
    if (!opts.force) {
      const same = sameParties(await deps.list(type), type, input);
      if (same.length) return { status: 'same', same, key: held };
    }
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    return { status: 'offline', key: quickKey(held, type, input, deps.makeKey) };
  }
  const key = quickKey(held, type, input, deps.makeKey);
  try {
    const party = await deps.create(type, input, { key: key.key, timeoutMs: QUICK_ADD_TIMEOUT_MS });
    return { status: 'added', party, key: null };
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    return { status: 'offline', key };
  }
}

/**
 * Puts the cursor in the first field after `root` (the picker): where the person goes on once the new party is
 * chosen. Fields that can't be reached with Tab are passed over.
 */
export function focusAfter(root: HTMLElement | null): void {
  if (!root || typeof document === 'undefined') return;
  const fields = document.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea, button, a[href], [tabindex]');
  for (const el of fields) {
    if (root.contains(el) || !(root.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if ((el as HTMLInputElement).disabled || el.tabIndex < 0 || el.getClientRects().length === 0) continue;
    el.focus();
    return;
  }
}
