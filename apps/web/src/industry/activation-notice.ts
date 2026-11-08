import type { PlanStatus } from '../api.ts';

export type ActivationNoticeKey =
  | 'ac_bannerNeeds' | 'ac_bannerGrace' | 'ac_bannerStale' | 'ac_clock' | 'ac_revoked_released' | 'ac_revoked_unknown' | 'ac_revoked_revoked';

/**
 * The notice shown on every page (not only under Plans) when a licence key is on this PC but does not count yet:
 * a key from before online activation (0.1.8) after the update, a check that is overdue, a wrong clock, or a freed
 * or cancelled licence. A 0.1.8 key still in its grace counts until graceUntil: the notice says so ({d}) and asks for
 * the internet, so it activates by itself. Null when there is nothing to say.
 */
export function activationNotice(plan: Pick<PlanStatus, 'activation' | 'license'> | null | undefined): ActivationNoticeKey | null {
  if (!plan?.license || !plan.activation.required) return null;
  switch (plan.activation.state) {
    case 'needs_activation': return plan.activation.inGrace && plan.activation.graceUntil ? 'ac_bannerGrace' : 'ac_bannerNeeds';
    case 'stale': return 'ac_bannerStale';
    case 'clock': return 'ac_clock';
    case 'revoked':
      return plan.activation.revokedReason === 'released' ? 'ac_revoked_released' : plan.activation.revokedReason === 'unknown' ? 'ac_revoked_unknown' : 'ac_revoked_revoked';
    default: return null;
  }
}

/**
 * The notice for the person at this PC. Admins see every notice (with the link to Plan & license). Everyone else sees
 * the 0.1.8 grace notice only: 0.1.8 never showed release notes, so the window itself is where a licence holder learns
 * to connect the PC once, and connecting needs no admin. The other notices ask for Plan & license, an admin's page.
 */
export function activationNoticeFor(plan: Pick<PlanStatus, 'activation' | 'license'> | null | undefined, admin: boolean): ActivationNoticeKey | null {
  const key = activationNotice(plan);
  return key && (admin || key === 'ac_bannerGrace') ? key : null;
}
