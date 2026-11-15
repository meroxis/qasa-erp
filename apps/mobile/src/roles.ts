/**
 * What the phone offers its user, from the office's own answer about who it acts as (GET /api/auth/me). The office
 * checks every request again with the user's permissions; this only keeps buttons away that would be refused.
 */

/** What an office's phone link offers beyond phone app 1.0 (phone app 1.1 on; absent from an older office). */
export interface PhoneLinkInfo {
  v: number;
  offers: string[];
  photoMaxBytes?: number | undefined;
}

export interface Me {
  signInRequired: boolean;
  /** "separate duties" at the office: nobody checks or approves a voucher they prepared themselves */
  separateDuties?: boolean | undefined;
  user: { id: string | null; name: string; username?: string; roles: string[]; permissions: string[]; branchLimited?: boolean } | null;
  phoneLink?: PhoneLinkInfo | undefined;
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
  | 'countSession'
  // ——— phone app 1.1: each only when the office offers it (me.phoneLink.offers) ———
  /** what waits for approval or to be checked, approved, rejected, checked or returned from the phone */
  | 'approvals'
  /** today's dollar rate and the last days' */
  | 'rate'
  /** setting today's rate (the owner and an admin only) */
  | 'rateSet'
  /** the end-of-day close (a user without the figures: their own registers only) */
  | 'dayClose';

/** The same roles as the office's FIGURES_ROLES (pro/src/phone/rules.ts). */
export const FIGURES_ROLES: readonly string[] = ['admin', 'preparer', 'checker', 'approver', 'viewer'];

/** What phone app 1.0 offers, with any office. */
export const BASE_FEATURES: readonly Feature[] = ['figures', 'lookup', 'newItem', 'sale', 'order', 'collect', 'statement', 'count', 'countSession'];

/** The features of phone app 1.1, each with what its office must offer for it. */
export const OFFER_OF = { approvals: 'approvals', rate: 'rate', rateSet: 'rate', dayClose: 'dayClose' } as const satisfies Partial<Record<Feature, string>>;
const NEW_FEATURES = Object.keys(OFFER_OF) as (keyof typeof OFFER_OF)[];

export const ALL_FEATURES: readonly Feature[] = [...BASE_FEATURES, ...NEW_FEATURES];

/** What the office's phone link offers (strings it does not know are left out; an office before phone app 1.1: none). */
export function offered(me: Me | null): Set<string> {
  const offers = me?.phoneLink?.offers;
  const known = new Set<string>(Object.values(OFFER_OF));
  return new Set(Array.isArray(offers) ? offers.filter((o): o is string => typeof o === 'string' && known.has(o)) : []);
}

/** Is the phone the owner's (no sign-in at the office)? */
const isOwner = (me: Me) => !me.signInRequired || !me.user;

/** What this user's role would have of phone app 1.1, whatever the office offers. */
function newFeaturesOf(me: Me): Set<Feature> {
  if (isOwner(me)) return new Set(NEW_FEATURES);
  const { roles, permissions } = me.user!;
  const can = (p: string) => permissions.includes(p) || permissions.includes('admin');
  const figures = roles.some((r) => FIGURES_ROLES.includes(r));
  const out = new Set<Feature>(['rate']);
  if (can('entries.approve') || can('entries.check')) out.add('approvals');
  if (permissions.includes('admin')) out.add('rateSet');
  if (figures || can('sales')) out.add('dayClose');
  // in one order for everyone (the features' own)
  return new Set(NEW_FEATURES.filter((f) => out.has(f)));
}

export function featuresOf(me: Me | null): Set<Feature> {
  // not known yet (never connected since pairing): looking items up and counting only
  if (!me) return new Set<Feature>(['lookup', 'count']);
  const offers = offered(me);
  const out = new Set<Feature>();
  // no sign-in at the office: the phone acts as the owner
  if (isOwner(me)) {
    for (const f of BASE_FEATURES) out.add(f);
  } else {
    const { roles, permissions } = me.user!;
    const can = (p: string) => permissions.includes(p) || permissions.includes('admin');
    const figures = roles.some((r) => FIGURES_ROLES.includes(r));
    out.add('lookup');
    out.add('count');
    if (figures) out.add('figures');
    if (can('sales')) { out.add('sale'); out.add('order'); }
    if (can('entries.prepare')) out.add('collect');
    if (can('stock')) { out.add('newItem'); out.add('countSession'); }
    if (can('sales') || can('entries.prepare') || figures) out.add('statement');
  }
  for (const f of newFeaturesOf(me)) if (offers.has(OFFER_OF[f as keyof typeof OFFER_OF])) out.add(f);
  return out;
}

/** What this user's role would have of phone app 1.1, but their office does not offer yet (its PC needs the update). */
export function needsNewerOffice(me: Me | null): Feature[] {
  if (!me) return [];
  const offers = offered(me);
  return [...newFeaturesOf(me)].filter((f) => !offers.has(OFFER_OF[f as keyof typeof OFFER_OF]));
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

/** The owner or an admin: told when the office PC needs an update for what the phone offers. */
export const runsTheOffice = (me: Me | null): boolean => !!me && (isOwner(me) || me.user!.permissions.includes('admin'));
