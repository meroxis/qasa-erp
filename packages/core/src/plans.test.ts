import { describe, expect, it } from 'vitest';
import {
  PAID_PLAN_IDS, PLAN_IDS, PLAN_PRICE_IQD, PLANS, planRank, resolvePlan, STARTER_LEAVES_OUT, type LicenseInfo
} from './plans.ts';

const licence = (plan: LicenseInfo['plan'], extra: Partial<LicenseInfo> = {}): LicenseInfo =>
  ({ id: 'QL-2026-0007', plan, licensee: 'Mer', issued: '2026-11-01', expires: '2027-10-31', ...extra });

describe('the plans', () => {
  it('are four, in order: Free, Starter, Pro, Business', () => {
    expect(PLAN_IDS).toEqual(['free', 'starter', 'pro', 'business']);
    expect(PAID_PLAN_IDS).toEqual(['starter', 'pro', 'business']);
    expect(PLAN_IDS.map(planRank)).toEqual([0, 1, 2, 3]);
    // anything that is no plan ranks as Free, never above a plan
    for (const junk of ['Starter', 'enterprise', '', null, undefined, 2, {}]) expect(planRank(junk)).toBe(0);
    for (const id of PLAN_IDS) expect(PLANS[id].id).toBe(id);
  });

  it('price a year of Starter at 165,000 IQD, under Pro and Business', () => {
    expect(PLAN_PRICE_IQD).toEqual({ starter: 165_000, pro: 350_000, business: 1_000_000 });
  });

  it('give Starter two users, one company and warehouses without a limit', () => {
    expect(PLANS.starter.limits).toEqual({ companies: 1, users: 2, warehouses: null });
    // never more than Pro in any limit
    expect(PLANS.starter.limits.users!).toBeLessThan(PLANS.pro.limits.users!);
    expect(PLANS.starter.limits.companies!).toBeLessThan(PLANS.pro.limits.companies!);
  });

  it('give Starter every Pro feature except Qasa Relay and the cloud backup, and nothing Pro lacks', () => {
    expect(STARTER_LEAVES_OUT).toEqual(['relay', 'cloudBackup']);
    expect([...PLANS.starter.features].sort()).toEqual(PLANS.pro.features.filter((f) => f !== 'relay' && f !== 'cloudBackup').sort());
    expect(PLANS.starter.features).not.toContain('relay');
    expect(PLANS.starter.features).not.toContain('cloudBackup');
    // the office network on the office's own network, and the automatic copies in their folder
    expect(PLANS.starter.features).toContain('officeNetwork');
    expect(PLANS.starter.features).toContain('autoBackup');
    for (const f of PLANS.starter.features) expect(PLANS.pro.features).toContain(f);
    // Business-only pages stay Business-only
    for (const f of ['branches', 'databaseServer', 'realEstate', 'onlineEdition'] as const) expect(PLANS.starter.features).not.toContain(f);
    // each plan has all of the one before it
    for (const f of PLANS.pro.features) expect(PLANS.business.features).toContain(f);
    expect(PLANS.pro.features).toContain('relay');
    expect(PLANS.pro.features).toContain('cloudBackup');
    expect(PLANS.free.features).toEqual([]);
  });

  it('run a Starter licence on Starter: its limits and features, through the grace days, then Free', () => {
    const active = resolvePlan({ license: licence('starter'), trialStarted: null, today: '2026-11-11' });
    expect(active).toMatchObject({ plan: 'starter', source: 'license', licenseState: 'active', limits: { companies: 1, users: 2, warehouses: null } });
    expect(active.features).toEqual([...PLANS.starter.features]);
    expect(active.features).not.toContain('relay');
    expect(active.features).not.toContain('cloudBackup');
    expect(resolvePlan({ license: licence('starter'), trialStarted: null, today: '2027-11-10' })).toMatchObject({ plan: 'starter', licenseState: 'grace' });
    expect(resolvePlan({ license: licence('starter'), trialStarted: null, today: '2027-11-20' })).toMatchObject({ plan: 'free', licenseState: 'expired', features: [] });
    // a Starter licence counts before a trial that is still running: Starter's features, not the trial's
    const withTrial = resolvePlan({ license: licence('starter'), trialStarted: '2026-11-05', today: '2026-11-11' });
    expect(withTrial).toMatchObject({ plan: 'starter', source: 'license' });
    expect(withTrial.features).not.toContain('relay');
    // a user count Meroxis signed into the key replaces the plan's, as on Pro
    expect(resolvePlan({ license: licence('starter', { users: 3 }), trialStarted: null, today: '2026-11-11' }).limits).toEqual({ companies: 1, users: 3, warehouses: null });
  });
});
