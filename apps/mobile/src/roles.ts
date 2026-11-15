/**
 * What the phone offers its user, from the office's own answer about who it acts as (GET /api/auth/me). The office
 * checks every request again with the user's permissions; this only keeps buttons away that would be refused.
 */

export interface Me {
  signInRequired: boolean;
  /** "Separate duties" is on at the office (the office sends it): nobody checks or approves what they prepared */
  separateDuties?: boolean;
  user: { id: string | null; name: string; username?: string; roles: string[]; permissions: string[]; branchLimited?: boolean } | null;
  /**
   * 1.1: what this office's phone link offers beyond phone app 1.0, the version of it and the largest photo it takes.
   * An office before that release sends none: the phone then offers what 1.0 does.
   */
  phoneLink?: { v: number; offers: string[]; photoMaxBytes?: number };
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
  // ——— 1.1: each only when the office offers it (me.phoneLink.offers) ———
  /** vouchers that wait for approval or checking, approved or sent back */
  | 'approvals'
  /** the day's dollar rate, read */
  | 'rate'
  /** today's dollar rate, set (the owner and admins) */
  | 'rateSet'
  /** the end-of-day totals, read */
  | 'dayClose'
  /** an expense with the photo of its paper receipt */
  | 'expense'
  /** a customer's invoice or statement sent as a PDF */
  | 'share'
  /** stock moved between warehouses */
  | 'transfer'
  /** goods received against a purchase order */
  | 'receive';

/** The same roles as the office's FIGURES_ROLES (pro/src/phone/rules.ts). */
export const FIGURES_ROLES: readonly string[] = ['admin', 'preparer', 'checker', 'approver', 'viewer'];

/** What phone app 1.0 offered: every office has these. */
export const BASE_FEATURES: readonly Feature[] = ['figures', 'lookup', 'newItem', 'sale', 'order', 'collect', 'statement', 'count', 'countSession'];

/** Each 1.1 feature, and what the office must offer for it (phoneLink.offers). */
export const OFFER_OF = {
  approvals: 'approvals', rate: 'rate', rateSet: 'rate', dayClose: 'dayClose', expense: 'expense', share: 'share', transfer: 'transfer', receive: 'receive'
} as const satisfies Partial<Record<Feature, string>>;

type OfferedFeature = keyof typeof OFFER_OF;
const OFFERED_FEATURES = Object.keys(OFFER_OF) as OfferedFeature[];

export const ALL_FEATURES: readonly Feature[] = [...BASE_FEATURES, ...OFFERED_FEATURES];

/** What the office offers beyond phone app 1.0 (anything this app does not know is left out; none from an older office). */
export function offered(me: Me | null): Set<string> {
  const offers = me?.phoneLink?.offers;
  const known = new Set<string>(Object.values(OFFER_OF));
  return new Set(Array.isArray(offers) ? offers.filter((o): o is string => typeof o === 'string' && known.has(o)) : []);
}

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
  }
}

/** The 1.1 features this user's role would get, whether or not the office offers them. */
function roleFeatures(me: Me): OfferedFeature[] {
  if (!me.signInRequired || !me.user) return [...OFFERED_FEATURES];
  const { roles, permissions } = me.user;
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
  if (!me.signInRequired || !me.user) return new Set<Feature>([...BASE_FEATURES, ...extra]);
  const { roles, permissions } = me.user;
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
