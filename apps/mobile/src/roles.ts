/**
 * What the phone offers its user, from the office's own answer about who it acts as (GET /api/auth/me). The office
 * checks every request again with the user's permissions; this only keeps buttons away that would be refused.
 */

export interface Me {
  signInRequired: boolean;
  user: { id: string | null; name: string; username?: string; roles: string[]; permissions: string[]; branchLimited?: boolean } | null;
}

export type Feature =
  /** the day's sales, the safes, what customers owe (the owner, the accountants, a viewer) */
  | 'figures'
  /** an item's price and stock, by barcode or name */
  | 'lookup'
  | 'newItem'
  /** a sale sent as a draft invoice */
  | 'sale'
  /** an order for a customer, sent as a quote */
  | 'order'
  /** money received from a customer: a receipt voucher, a draft or waiting for approval (posted at once for an approver) */
  | 'collect'
  | 'statement'
  /** a count sent to the office as a list (Settings → Office network → Phones) */
  | 'count'
  /** counted quantities entered straight into the warehouse's open count */
  | 'countSession';

/** The same roles as the office's FIGURES_ROLES (pro/src/phone/phone.ts). */
export const FIGURES_ROLES: readonly string[] = ['admin', 'preparer', 'checker', 'approver', 'viewer'];

export const ALL_FEATURES: readonly Feature[] = ['figures', 'lookup', 'newItem', 'sale', 'order', 'collect', 'statement', 'count', 'countSession'];

export function featuresOf(me: Me | null): Set<Feature> {
  // not known yet (never connected since pairing): looking items up and counting only
  if (!me) return new Set<Feature>(['lookup', 'count']);
  // no sign-in at the office: the phone acts as the owner
  if (!me.signInRequired || !me.user) return new Set(ALL_FEATURES);
  const { roles, permissions } = me.user;
  const can = (p: string) => permissions.includes(p) || permissions.includes('admin');
  const figures = roles.some((r) => FIGURES_ROLES.includes(r));
  const out = new Set<Feature>(['lookup', 'count']);
  if (figures) out.add('figures');
  if (can('sales')) { out.add('sale'); out.add('order'); }
  if (can('entries.prepare')) out.add('collect');
  if (can('stock')) { out.add('newItem'); out.add('countSession'); }
  if (can('sales') || can('entries.prepare') || figures) out.add('statement');
  return out;
}

/**
 * The app lock (a PIN) is required, not offered, for a phone that acts as a user who sees the company's figures or is an
 * admin (FIGURES_ROLES), or as the owner when the office has no sign-in: a lost or taken phone then doesn't open on the
 * books. Unknown yet (never connected since pairing): not asked until the office says who the phone acts as. The office
 * can't check that a phone really keeps the lock (a changed app wouldn't): this protects an honest phone that is lost.
 */
export function lockRequired(me: Me | null): boolean {
  if (!me) return false;
  if (!me.signInRequired || !me.user) return true;
  return me.user.roles.some((r) => FIGURES_ROLES.includes(r)) || me.user.permissions.includes('admin');
}

/** The name the phone shows for who it works as. */
export const actsAs = (me: Me | null): string | null => (me?.signInRequired && me.user ? me.user.name : null);
