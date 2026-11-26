/**
 * What the phone offers its user, from the office's own answer about who it acts as (GET /api/auth/me). The office
 * checks every request again with the user's permissions; this only keeps buttons away that would be refused.
 */

/**
 * What an office's phone link offers beyond phone app 1.0 (phone app 1.1 on), the version of it and the largest photo it
 * takes. An office before that release sends none: the phone then offers what 1.0 does.
 */
export interface PhoneLinkInfo {
  v: number;
  offers: string[];
  photoMaxBytes?: number | undefined;
}

export interface Me {
  signInRequired: boolean;
  /** "Separate duties" is on at the office (the office sends it): nobody checks or approves what they prepared */
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
  | 'dayClose'
  /** an expense with the photo of its paper receipt */
  | 'expense'
  /** a customer's invoice or statement sent as a PDF */
  | 'share'
  /** stock moved between warehouses */
  | 'transfer'
  /** goods received against a purchase order */
  | 'receive'
  // ——— phone app 1.2: with an office of Qasa ERP 2.0 on that offers it ———
  /** a new item's picture and names looked up by its barcode (when the office's admin has switched that on) */
  | 'itemLookup'
  // ——— with an office of Qasa ERP 2.1 on ———
  /** what is counted into the open count adds to what it has (a shelf at a time, several phones) */
  | 'countAdd';

/** The same roles as the office's FIGURES_ROLES (pro/src/phone/rules.ts). */
export const FIGURES_ROLES: readonly string[] = ['admin', 'preparer', 'checker', 'approver', 'viewer'];

/** What phone app 1.0 offers, with any office. */
export const BASE_FEATURES: readonly Feature[] = ['figures', 'lookup', 'newItem', 'sale', 'order', 'collect', 'statement', 'count', 'countSession'];

/** The features of phone app 1.1, each with what its office must offer for it (phoneLink.offers). */
export const OFFER_OF = {
  approvals: 'approvals', rate: 'rate', rateSet: 'rate', dayClose: 'dayClose', expense: 'expense', share: 'share', transfer: 'transfer', receive: 'receive',
  itemLookup: 'itemLookup', countAdd: 'countAdd'
} as const satisfies Partial<Record<Feature, string>>;

type OfferedFeature = keyof typeof OFFER_OF;
const OFFERED_FEATURES = Object.keys(OFFER_OF) as OfferedFeature[];

export const ALL_FEATURES: readonly Feature[] = [...BASE_FEATURES, ...OFFERED_FEATURES];

/** What the office's phone link offers (strings this app does not know are left out; an office before phone app 1.1: none). */
export function offered(me: Me | null): Set<string> {
  const offers = me?.phoneLink?.offers;
  const known = new Set<string>(Object.values(OFFER_OF));
  return new Set(Array.isArray(offers) ? offers.filter((o): o is string => typeof o === 'string' && known.has(o)) : []);
}

/** Is the phone the owner's (no sign-in at the office)? */
const isOwner = (me: Me) => !me.signInRequired || !me.user;

/** Who may use each 1.1 feature, by the office's rule (`can`: a permission, `figures`: a FIGURES role; the owner: all). */
function mayUse(f: OfferedFeature, can: (p: string) => boolean, figures: boolean): boolean {
  switch (f) {
    case 'approvals': return can('entries.approve') || can('entries.check');
    case 'rate': return true;
    case 'rateSet': return can('admin');
    case 'dayClose': return figures || can('sales');
    case 'expense': return can('entries.prepare');
    case 'share': return can('sales') || can('entries.prepare') || figures;
    case 'transfer': return can('stock');
    case 'receive': return can('stock') || can('purchases');
    // whoever may add items (the office asks the same of POST /api/items/lookup)
    case 'itemLookup': return can('stock');
    // whoever counts into the open count (countSession)
    case 'countAdd': return can('stock');
  }
}

/** The 1.1 features this user's role would get, whether or not the office offers them (in the features' own order). */
function roleFeatures(me: Me): OfferedFeature[] {
  if (isOwner(me)) return [...OFFERED_FEATURES];
  const { roles, permissions } = me.user!;
  const can = (p: string) => permissions.includes(p) || permissions.includes('admin');
  const figures = roles.some((r) => FIGURES_ROLES.includes(r));
  return OFFERED_FEATURES.filter((f) => mayUse(f, can, figures));
}

export function featuresOf(me: Me | null): Set<Feature> {
  // not known yet (never connected since pairing): looking items up and counting only
  if (!me) return new Set<Feature>(['lookup', 'count']);
  const offers = offered(me);
  const extra = roleFeatures(me).filter((f) => offers.has(OFFER_OF[f]));
  // no sign-in at the office: the phone acts as the owner
  if (isOwner(me)) return new Set<Feature>([...BASE_FEATURES, ...extra]);
  const { roles, permissions } = me.user!;
  const can = (p: string) => permissions.includes(p) || permissions.includes('admin');
  const figures = roles.some((r) => FIGURES_ROLES.includes(r));
  const out = new Set<Feature>(['lookup', 'count']);
  if (figures) out.add('figures');
  if (can('sales')) { out.add('sale'); out.add('order'); }
  if (can('entries.prepare')) out.add('collect');
  if (can('stock')) { out.add('newItem'); out.add('countSession'); }
  if (can('sales') || can('entries.prepare') || figures) out.add('statement');
  for (const f of extra) out.add(f);
  return out;
}

/**
 * The 1.1 features this user would have that the office does not offer (it runs an older Qasa ERP): the phone says the
 * office PC needs an update to use them. Nothing before the office has said who the phone acts as.
 */
export function needsNewerOffice(me: Me | null): Feature[] {
  if (!me) return [];
  const offers = offered(me);
  return roleFeatures(me).filter((f) => !offers.has(OFFER_OF[f]));
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
