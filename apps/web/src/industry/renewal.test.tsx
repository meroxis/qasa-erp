import { describe, expect, it } from 'vitest';
import { renewalReminder, renewUrl } from './RenewalBanner.tsx';

const plan = (expires: string | null, state: 'active' | 'grace' | 'expired' = 'active') =>
  ({ license: { id: 'QL-2026-0001', plan: 'pro', licensee: 'Meroxis Company', issued: '2025-11-30', expires, state } }) as never;

describe('the licence renewal reminder', () => {
  it('starts 14 days before the last day, can be put away until the last 3 days, and stays through the grace days', () => {
    expect(renewalReminder(plan('2026-11-30'), '2026-11-15')).toBeNull();
    expect(renewalReminder(plan('2026-11-30'), '2026-11-16')).toMatchObject({ daysLeft: 14, grace: false, dismissable: true });
    expect(renewalReminder(plan('2026-11-30'), '2026-11-27')).toMatchObject({ daysLeft: 3, dismissable: true });
    expect(renewalReminder(plan('2026-11-30'), '2026-11-28')).toMatchObject({ daysLeft: 2, dismissable: false });
    expect(renewalReminder(plan('2026-11-30'), '2026-11-30')).toMatchObject({ daysLeft: 0, dismissable: false });
    expect(renewalReminder(plan('2026-11-30', 'grace'), '2026-12-01')).toMatchObject({ grace: true, graceDaysLeft: 13, dismissable: false });
    expect(renewalReminder(plan('2026-11-30', 'grace'), '2026-12-14')).toMatchObject({ grace: true, graceDaysLeft: 0 });
    expect(renewalReminder(plan('2026-11-30', 'expired'), '2026-12-15')).toBeNull();
    // a licence that never ends, or none
    expect(renewalReminder(plan(null), '2026-11-20')).toBeNull();
    expect(renewalReminder({ license: null } as never, '2026-11-20')).toBeNull();
  });

  it('opens the customer portal\'s renewal for this licence, and only a licence number goes into the address', () => {
    expect(renewUrl('QL-2026-0001')).toBe('https://my.qasaerp.com/buy?renew=QL-2026-0001');
    expect(renewUrl('x&y=1')).toBe('https://my.qasaerp.com/buy');
  });
});
