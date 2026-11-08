import { expect, it } from 'vitest';
import type { PlanStatus } from '../api.ts';
import { activationNotice, activationNoticeFor } from './activation-notice.ts';
import { ACTIVATION_TEXT } from '../i18n/activation.ts';

const plan = (state: PlanStatus['activation']['state'], revokedReason: string | null = null, licensed = true) => ({
  license: licensed ? ({ plan: 'pro' } as PlanStatus['license']) : null,
  activation: { required: true, state, checkBy: null, offlineUntil: null, lastChecked: null, revokedReason }
});

it('tells a customer whose key is not activated (an update from 0.1.8) on every page, not only under Plans', () => {
  expect(activationNotice(plan('needs_activation'))).toBe('ac_bannerNeeds');
  expect(activationNotice(plan('stale'))).toBe('ac_bannerStale');
  expect(activationNotice(plan('clock'))).toBe('ac_clock');
  expect(activationNotice(plan('revoked', 'released'))).toBe('ac_revoked_released');
  expect(activationNotice(plan('revoked', 'revoked'))).toBe('ac_revoked_revoked');
});

it('says nothing when the licence is active, when there is no key, or when activation is not required', () => {
  expect(activationNotice(plan('active'))).toBeNull();
  expect(activationNotice(plan('needs_activation', null, false))).toBeNull();
  expect(activationNotice({ ...plan('needs_activation'), activation: { ...plan('needs_activation').activation, required: false } })).toBeNull();
  expect(activationNotice(null)).toBeNull();
});

it('tells a 0.1.8 key in its grace that it keeps working until the last day, and to connect so it activates', () => {
  const grace = (inGrace: boolean, graceUntil: string | null) => ({ ...plan('needs_activation'), activation: { ...plan('needs_activation').activation, inGrace, graceUntil } });
  expect(activationNotice(grace(true, '2026-12-07'))).toBe('ac_bannerGrace');
  // the grace is over (or never was): the plain notice
  expect(activationNotice(grace(false, '2026-12-07'))).toBe('ac_bannerNeeds');
  expect(activationNotice(grace(false, null))).toBe('ac_bannerNeeds');
  for (const [i, text] of ACTIVATION_TEXT.ac_bannerGrace.entries()) {
    expect(text, String(i)).toContain('{d}');
    expect(text, String(i)).toContain('{p}');
  }
  expect(ACTIVATION_TEXT.ac_bannerGrace[1]).toMatch(/keeps working until \{d\}.*internet/);
  for (const text of ACTIVATION_TEXT.ac_needsGrace) expect(text).toContain('{d}');
});

it('shows the 0.1.8 grace notice to everyone at the PC (0.1.8 showed no release notes), the others to admins only', () => {
  const grace = { ...plan('needs_activation'), activation: { ...plan('needs_activation').activation, inGrace: true, graceUntil: '2026-12-07' } };
  expect(activationNoticeFor(grace, false)).toBe('ac_bannerGrace');
  expect(activationNoticeFor(grace, true)).toBe('ac_bannerGrace');
  for (const other of [plan('needs_activation'), plan('stale'), plan('clock'), plan('revoked', 'released')]) {
    expect(activationNoticeFor(other, false)).toBeNull();
    expect(activationNoticeFor(other, true)).toBe(activationNotice(other));
  }
  expect(activationNoticeFor(plan('active'), true)).toBeNull();
  // it asks only for the internet, which needs no admin
  expect(ACTIVATION_TEXT.ac_bannerGrace[1]).toMatch(/Connect this PC to the internet/);
});
