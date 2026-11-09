import { expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { backupNoticeKey, BackupNoticeBar } from './BackupNotice.tsx';
import { SAFETY_TEXT } from '../i18n/safety.ts';

// Render the bar without a browser: the status the server sent is handed straight to useState.
const fixture = vi.hoisted(() => ({ status: null as unknown }));
vi.mock('react', () => ({ useState: () => [fixture.status, () => {}], useEffect() {} }));
vi.mock('../i18n.ts', () => ({ useI18n: () => ({ t: (s: string) => s }) }));
vi.mock('../router.ts', () => ({ href: (s: string) => `#/${s}` }));
const seen = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../api.ts', () => ({ api: { backup: () => new Promise(() => {}), backupLocalNoticeSeen: () => { seen.calls += 1; return new Promise(() => {}); } } }));

type Node = ReactElement<Record<string, unknown>>;
const render = (status: unknown, admin = true, page = 'home') => {
  fixture.status = status;
  return BackupNoticeBar({ admin, page }) as Node | null;
};

it('says why backups need the admin, and nothing when all is well', () => {
  expect(backupNoticeKey({ notice: 'plan' })).toBe('bkNoticePlan');
  expect(backupNoticeKey({ notice: 'off' })).toBe('bkNoticeOff');
  expect(backupNoticeKey({ notice: 'old' })).toBe('bkNoticeOld');
  expect(backupNoticeKey({ notice: 'failed' })).toBe('bkNoticeFailed');
  expect(backupNoticeKey({ notice: null })).toBeNull();
  // an older Pro module that doesn't say
  expect(backupNoticeKey({})).toBeNull();
  expect(backupNoticeKey(null)).toBeNull();
});

it('shows the bar to admins only, outside Settings, with a link to the backups', () => {
  const bar = render({ notice: 'plan' })!;
  expect(bar).not.toBeNull();
  expect(JSON.stringify(bar.props.children)).toContain('bkNoticePlan');
  expect(JSON.stringify(bar.props.children)).toContain('#/settings');
  expect(String(bar.props.className)).toContain('warn');
  expect(String(render({ notice: 'failed' })!.props.className)).toContain('bad');
  expect(render({ notice: 'plan' }, false)).toBeNull();
  expect(render({ notice: 'plan' }, true, 'settings')).toBeNull();
  expect(render({ notice: null })).toBeNull();
});

it('tells an admin once, on any page, that copies stay on this PC while Documents is synced and there is no password', () => {
  const bar = render({ notice: null, localNotice: true })!;
  expect(JSON.stringify(bar.props.children)).toContain('bkNoticeLocal');
  expect(JSON.stringify(bar.props.children)).toContain('#/settings');
  // in Settings too (the card says where the copies are), without the link to where they already are
  const inSettings = render({ notice: null, localNotice: true }, true, 'settings')!;
  expect(JSON.stringify(inSettings.props.children)).toContain('bkNoticeLocal');
  expect(JSON.stringify(inSettings.props.children)).not.toContain('#/settings');
  // "Got it" marks it read on the server, so it never comes back
  const button = (bar.props.children as Node[])[1]!.props.children as (Node | false)[];
  (button.find((n) => n && n.type === 'button') as Node).props.onClick!();
  expect(seen.calls).toBe(1);
  expect(render({ notice: null, localNotice: true }, false)).toBeNull();
  expect(render({ notice: null, localNotice: false })).toBeNull();
  // with another notice, both show
  const both = render({ notice: 'old', localNotice: true })!;
  expect(JSON.stringify(both.props.children)).toContain('bkNoticeOld');
  expect(JSON.stringify(both.props.children)).toContain('bkNoticeLocal');
});

it('has the notices in Arabic, English and Kurdish', () => {
  for (const k of ['bkNoticePlan', 'bkNoticeOff', 'bkNoticeOld', 'bkNoticeFailed', 'bkNoticeOpen', 'bkSavedNow'] as const) {
    expect(SAFETY_TEXT[k]).toHaveLength(3);
    for (const s of SAFETY_TEXT[k]) expect(s.trim().length).toBeGreaterThan(0);
  }
  for (const s of SAFETY_TEXT.bkNoticePlan) expect(s).toContain('3');
});
