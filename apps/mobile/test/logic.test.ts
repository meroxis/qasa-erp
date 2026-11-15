import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OfficeError } from '../src/api';
import { explainWith } from '../src/explain';
import { KEYS, TEXT_PARTS, translate, type Key } from '../src/i18n';
import { LinkError, type OfficeLink } from '../src/link';
import { hashPin, lockoutMs, parseLockSettings, shouldLock, validPin, verifyPin, weakPin } from '../src/lock';
import { canGoBack, current, initialNav, navigate, type NavState } from '../src/nav';
import { ownerApi } from '../src/owner/api';
import { askMine } from '../src/owner/dayclose';
import { readPairingCode, validAddress } from '../src/pairing';
import { encodePairingCode, generateKeyPair, type PairingCode } from '../src/protocol';
import { actsAs, ALL_FEATURES, BASE_FEATURES, featuresOf, lockRequired, needsNewerOffice, OFFER_OF, offered, runsTheOffice, type Me } from '../src/roles';
import { UUID_V4, uuidV4 } from '../src/uuid';

describe('keys for changes', () => {
  it('are UUID v4, lower case, different every time', () => {
    const keys = new Set(Array.from({ length: 200 }, () => uuidV4()));
    expect(keys.size).toBe(200);
    for (const k of keys) expect(k).toMatch(UUID_V4);
    expect(uuidV4(() => new Uint8Array(16).fill(255))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(uuidV4(() => new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000');
  });
});

describe('the pairing code from the QR', () => {
  const office = generateKeyPair();
  const good: PairingCode = {
    addresses: ['192.168.1.20', 'office-pc.local'], port: 47421, relay: 'ABCDE-FGH23', serverPublicKey: office.publicKey,
    pairingId: 'p1x2y3z4w5v6', pairingSecret: new Uint8Array(32).fill(3), company: 'Meroxis'
  };

  it('takes a well-formed code', () => {
    expect(readPairingCode(encodePairingCode(good))).toMatchObject({ addresses: ['192.168.1.20', 'office-pc.local'], port: 47421, relay: 'ABCDE-FGH23' });
    expect(readPairingCode(`  ${encodePairingCode({ ...good, relay: null })}\n`)).toMatchObject({ relay: null });
    expect(readPairingCode(encodePairingCode({ ...good, addresses: [] }))).toMatchObject({ addresses: [] });
  });

  it('refuses one with something wrong in it, or no way to reach the office', () => {
    expect(readPairingCode('https://example.com')).toBeNull();
    expect(readPairingCode(encodePairingCode({ ...good, addresses: ['192.168.1.300'] }))).toBeNull();
    expect(readPairingCode(encodePairingCode({ ...good, addresses: ['10.0.0.1/phone?x'] }))).toBeNull();
    expect(readPairingCode(encodePairingCode({ ...good, addresses: ['evil host'] }))).toBeNull();
    expect(readPairingCode(encodePairingCode({ ...good, port: 70000 }))).toBeNull();
    expect(readPairingCode(encodePairingCode({ ...good, port: 0 }))).toBeNull();
    expect(readPairingCode(encodePairingCode({ ...good, relay: 'ABCDE-FGH2O' }))).toBeNull();
    expect(readPairingCode(encodePairingCode({ ...good, relay: '../../x' }))).toBeNull();
    expect(readPairingCode(encodePairingCode({ ...good, addresses: [], relay: null }))).toBeNull();
    expect(readPairingCode(encodePairingCode({ ...good, pairingId: 'a b' }))).toBeNull();
    expect(readPairingCode(encodePairingCode({ ...good, pairingSecret: new Uint8Array(8) }))).toBeNull();
    expect(validAddress('1.2.3')).toBe(false);
    expect(validAddress('10.0.0.25')).toBe(true);
  });
});

describe('what the phone offers, by the office user it acts as', () => {
  const me = (roles: string[], permissions: string[]): Me => ({ signInRequired: true, user: { id: 'u1', name: 'Raz', roles, permissions } });

  it('everything to the owner (no sign-in at the office): phone app 1.0\'s, and 1.1\'s once the office offers them', () => {
    const owner: Me = { signInRequired: false, user: { id: null, name: 'Mer', roles: ['admin'], permissions: ['admin'] } };
    expect([...featuresOf(owner)]).toEqual(BASE_FEATURES);
    expect([...featuresOf({ ...owner, phoneLink: { v: 2, offers: ALL_OFFERS } })]).toEqual(ALL_FEATURES);
    expect(actsAs({ signInRequired: false, user: null })).toBeNull();
  });

  it('a sales rep sells, orders and sees statements; no figures, no receipts, no new items', () => {
    const f = featuresOf(me(['sales'], ['sales']));
    expect([...f].sort()).toEqual(['count', 'lookup', 'order', 'sale', 'statement']);
    expect(actsAs(me(['sales'], ['sales']))).toBe('Raz');
  });

  it('a rep who also prepares vouchers collects; an accountant sees the figures; a storekeeper counts into the open count', () => {
    expect(featuresOf(me(['sales', 'preparer'], ['sales', 'entries.prepare'])).has('collect')).toBe(true);
    const accountant = featuresOf(me(['checker'], ['entries.check']));
    expect(accountant.has('figures')).toBe(true);
    expect(accountant.has('sale')).toBe(false);
    const keeper = featuresOf(me(['storekeeper'], ['stock']));
    expect([...keeper].sort()).toEqual(['count', 'countSession', 'lookup', 'newItem']);
    expect(featuresOf(me(['admin'], ['admin'])).size).toBe(BASE_FEATURES.length);
    expect(featuresOf({ ...me(['admin'], ['admin']), phoneLink: { v: 2, offers: ALL_OFFERS } }).size).toBe(ALL_FEATURES.length);
  });

  it('only looking up and counting before the phone knows who it is', () => {
    expect([...featuresOf(null)].sort()).toEqual(['count', 'lookup']);
  });

  it('needs the app lock (a PIN) on a phone that sees the figures or acts as an admin or the owner, and only offers it to others', () => {
    // the owner (no sign-in at the office), an admin, an accountant, a viewer: required
    expect(lockRequired({ signInRequired: false, user: null })).toBe(true);
    expect(lockRequired(me(['admin'], ['admin']))).toBe(true);
    expect(lockRequired(me(['checker'], ['entries.check']))).toBe(true);
    expect(lockRequired(me(['viewer'], []))).toBe(true);
    // a sales rep, a storekeeper: offered, not required
    expect(lockRequired(me(['sales'], ['sales']))).toBe(false);
    expect(lockRequired(me(['storekeeper'], ['stock']))).toBe(false);
    // not known yet: asked once the office says who the phone acts as
    expect(lockRequired(null)).toBe(false);
  });
});

// ——— phone app 1.1: what the office offers ———

/** The office's roles and what each may change (packages/server/src/auth.ts; a test below holds them to it). */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['admin', 'entries.prepare', 'entries.check', 'entries.approve', 'sales', 'purchases', 'stock'],
  preparer: ['entries.prepare'], checker: ['entries.check'], approver: ['entries.approve'],
  sales: ['sales'], purchasing: ['purchases'], storekeeper: ['stock'], viewer: []
};
const ROLES = Object.keys(ROLE_PERMISSIONS);
const ALL_OFFERS = [...new Set(Object.values(OFFER_OF))];
const asUser = (roles: string[], offers: string[] | null = ALL_OFFERS): Me => ({
  signInRequired: true,
  user: { id: 'u1', name: 'Las', roles, permissions: [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r]!))] },
  ...(offers ? { phoneLink: { v: 2, offers } } : {})
});

describe('phone app 1.1: what the office offers, and to whom', () => {
  it('shows a 1.1 feature only when the office offers it; an office before 1.1 offers none', () => {
    const approver = asUser(['approver'], null);
    expect(offered(approver).size).toBe(0);
    expect([...featuresOf(approver)].sort()).toEqual(['count', 'figures', 'lookup', 'statement']);
    expect([...featuresOf({ ...approver, phoneLink: { v: 2, offers: ['approvals'] } })]).toContain('approvals');
    expect(featuresOf({ ...approver, phoneLink: { v: 2, offers: ['approvals'] } }).has('rate')).toBe(false);
    // what the office says it offers and the app does not know is left out; a broken answer offers nothing
    expect([...offered({ ...approver, phoneLink: { v: 3, offers: ['approvals', 'teleport', 7 as unknown as string] } })]).toEqual(['approvals']);
    expect(offered({ ...approver, phoneLink: { v: 2, offers: 'approvals' as unknown as string[] } }).size).toBe(0);
  });

  it('gives each feature to whom it is for', () => {
    const f = (roles: string[]) => featuresOf(asUser(roles));
    // approvals: who approves or checks; the rate: everyone, set by an admin only; the end of the day: who sells or sees the figures
    expect(f(['approver']).has('approvals') && f(['checker']).has('approvals')).toBe(true);
    expect(f(['preparer']).has('approvals') || f(['sales']).has('approvals') || f(['viewer']).has('approvals')).toBe(false);
    for (const roles of [['sales'], ['storekeeper'], ['viewer'], ['purchasing'], []]) expect(f(roles).has('rate'), roles.join('+')).toBe(true);
    expect(f(['admin']).has('rateSet')).toBe(true);
    for (const roles of [['preparer'], ['approver'], ['checker', 'approver', 'preparer', 'viewer']]) expect(f(roles).has('rateSet'), roles.join('+')).toBe(false);
    expect(f(['sales']).has('dayClose') && f(['viewer']).has('dayClose') && f(['preparer']).has('dayClose')).toBe(true);
    expect(f(['storekeeper']).has('dayClose') || f(['purchasing']).has('dayClose')).toBe(false);
  });

  it('tells the owner and an admin what needs the office PC updated, and nobody else', () => {
    expect(needsNewerOffice({ signInRequired: false, user: null })).toEqual(['approvals', 'rate', 'rateSet', 'dayClose']);
    expect(needsNewerOffice(asUser(['admin'], null))).toEqual(['approvals', 'rate', 'rateSet', 'dayClose']);
    expect(needsNewerOffice(asUser(['admin']))).toEqual([]);
    expect(needsNewerOffice(asUser(['sales'], null))).toEqual(['rate', 'dayClose']);
    expect(needsNewerOffice(null)).toEqual([]);
    expect(runsTheOffice({ signInRequired: false, user: null }) && runsTheOffice(asUser(['admin']))).toBe(true);
    for (const roles of [['sales'], ['approver', 'checker', 'preparer', 'viewer'], ['storekeeper']]) expect(runsTheOffice(asUser(roles)), roles.join('+')).toBe(false);
  });

  it('asks a PIN of every phone that shows the figures, approves or sets the rate, and asks for its own day only without one, whatever the mix of roles', () => {
    for (let mask = 0; mask < 1 << ROLES.length; mask++) {
      const roles = ROLES.filter((_, i) => (mask >> i) & 1);
      const user = asUser(roles);
      const f = featuresOf(user);
      const label = roles.join('+') || 'no role';
      for (const feature of ['figures', 'approvals', 'rateSet'] as const) if (f.has(feature)) expect(lockRequired(user), `${label} ${feature}`).toBe(true);
      if (f.has('dayClose') && !lockRequired(user)) expect(askMine(user), label).toBe(true);
      if (lockRequired(user)) expect(askMine(user), label).toBe(false);
    }
  });

  it('asks the office for the day\'s close with mine=1 from a phone without a PIN', async () => {
    const paths: string[] = [];
    const link = { request: async (_m: string, p: string) => { paths.push(p); return { s: 200, b: {} }; } } as unknown as OfficeLink;
    const api = ownerApi(link);
    await api.dayClose('2026-11-15', askMine(asUser(['sales', 'storekeeper'])));
    await api.dayClose('2026-11-15', askMine(asUser(['sales', 'viewer'])));
    await api.entries('waiting');
    await api.entries('draft');
    await api.rates(45);
    expect(paths).toEqual(['/api/brief/day-close?date=2026-11-15&mine=1', '/api/brief/day-close?date=2026-11-15', '/api/entries?approval=waiting', '/api/entries?status=draft', '/api/fx/rates?days=30']);
    await expect(api.dayClose('15/11/2026', true)).rejects.toThrow(OfficeError);
    await expect(api.entry('../users')).rejects.toThrow(OfficeError);
  });

  it('holds the roles above to the office\'s own (when the monorepo is here)', () => {
    const auth = join(__dirname, '..', '..', '..', 'packages', 'server', 'src', 'auth.ts');
    if (!existsSync(auth)) return;
    const text = readFileSync(auth, 'utf8');
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      if (role === 'admin') {
        expect(text).toMatch(/admin: ALL,/);
        expect(text).toContain(`const ALL: Permission[] = [${permissions.map((p) => `'${p}'`).join(', ')}];`);
        continue;
      }
      expect(text, role).toContain(`${role}: [${permissions.map((p) => `'${p}'`).join(', ')}]`);
    }
    expect(text).toContain(`export const ROLES: readonly Role[] = [${ROLES.map((r) => `'${r}'`).join(', ')}];`);
  });
});

describe('the office\'s refusals in words (explain.ts)', () => {
  const t = (k: Key, v?: Record<string, string | number>) => translate('en', k, v);
  const old = asUser(['admin'], null);
  const now = asUser(['admin']);

  it('says the office PC may need an update only when it says nothing of what it offers', () => {
    const refusal = new OfficeError(403, 'forbidden', { phone: true });
    expect(explainWith(t, refusal, old)).toBe(translate('en', 'officeOld'));
    expect(explainWith(t, refusal, null)).toBe(translate('en', 'officeOld'));
    expect(explainWith(t, refusal, now)).toBe(translate('en', 'phoneRefused'));
    // a refusal for want of a permission is that
    expect(explainWith(t, new OfficeError(403, 'forbidden', { need: 'entries.approve' }), now)).toBe(translate('en', 'forbidden'));
  });

  it('says an answer too big for the phone is that, and names the office\'s codes and the codes of its validation answers', () => {
    expect(explainWith(t, new OfficeError(413, 'answer_too_large', null), now)).toBe(translate('en', 'tooLarge'));
    expect(explainWith(t, new OfficeError(409, 'same_person', null), now)).toBe(translate('en', 'errSamePerson'));
    expect(explainWith(t, new OfficeError(409, 'entry_changed', null), now)).toBe(translate('en', 'aprChanged'));
    expect(explainWith(t, new OfficeError(400, 'validation', [{ code: 'schema' }, { code: 'period_locked', period: '2026-10' }]), now)).toBe('Period 2026-10 is locked');
    expect(explainWith(t, new OfficeError(400, 'validation', [{ code: 'reject_reason_required' }]), now)).toBe(translate('en', 'errRejectReason'));
    expect(explainWith(t, new OfficeError(400, 'validation', [{ code: 'something_new' }]), now)).toBe(translate('en', 'validation'));
    expect(explainWith(t, new OfficeError(402, 'plan_limit', null), now)).toBe(translate('en', 'planLimit'));
    // a code it does not know, as before; one that means something else elsewhere is not given the approvals' words
    expect(explainWith(t, new OfficeError(409, 'count_session_open', null), now)).toBe('Something went wrong: count_session_open');
    expect(explainWith(t, new OfficeError(409, 'action_not_allowed', null), now)).toBe('Something went wrong: action_not_allowed');
    expect(explainWith(t, new LinkError('timeout'), now)).toBe(translate('en', 'offline'));
    expect(explainWith(t, new Error('x'), now)).toBe(translate('en', 'loadFailed'));
  });

  it('keeps each text in one part of the texts only', () => {
    const seen = new Map<string, string>();
    for (const [part, keys] of Object.entries(TEXT_PARTS)) {
      for (const k of keys) {
        expect(seen.get(k), `${k} in ${part} and ${seen.get(k)}`).toBeUndefined();
        seen.set(k, part);
      }
    }
    expect(seen.size).toBe(KEYS.length);
  });
});

describe('the app lock', () => {
  const quick = { N: 2 ** 4, r: 8, p: 1 };

  it('keeps a slow hash of the PIN, never the PIN, and checks it', async () => {
    const stored = await hashPin('2580', quick);
    expect(stored).toMatch(/^s1\.16\.8\.1\./);
    expect(stored).not.toContain('2580');
    expect(await verifyPin('2580', stored)).toBe(true);
    expect(await verifyPin('2581', stored)).toBe(false);
    expect(await verifyPin('2580', stored.replace('s1.', 's2.'))).toBe(false);
    expect(await verifyPin('2580', 's1.99999999.8.1.AA.AA')).toBe(false);
    // two hashes of the same PIN differ (a new salt each time)
    expect(await hashPin('2580', quick)).not.toBe(stored);
    await expect(hashPin('12', quick)).rejects.toThrow(/pin_invalid/);
  });

  it('takes 4 to 8 digits and refuses the ones anyone would guess', () => {
    expect(validPin('2580')).toBe(true);
    expect(validPin('25801470')).toBe(true);
    expect(validPin('258')).toBe(false);
    expect(validPin('258014703')).toBe(false);
    expect(validPin('25a0')).toBe(false);
    for (const weak of ['0000', '1111', '1234', '4321', '0123', '9876', '7890', '123456']) expect(weakPin(weak), weak).toBe(true);
    for (const fine of ['2580', '1357', '9024', '1122']) expect(weakPin(fine), fine).toBe(false);
  });

  it('waits longer after each wrong PIN past the fifth, up to 15 minutes', () => {
    expect([0, 4].map(lockoutMs)).toEqual([0, 0]);
    expect([5, 6, 7].map(lockoutMs)).toEqual([30_000, 60_000, 120_000]);
    expect(lockoutMs(30)).toBe(15 * 60_000);
  });

  it('locks after the time in the background the user chose', () => {
    expect(shouldLock(null, 10_000, 0)).toBe(false);
    expect(shouldLock(1000, 1000, 0)).toBe(true);
    expect(shouldLock(1000, 50_000, 60_000)).toBe(false);
    expect(shouldLock(1000, 61_000, 60_000)).toBe(true);
    expect(parseLockSettings(null)).toEqual({ pin: null, length: 0, biometric: false, after: 60_000 });
    expect(parseLockSettings('{"pin":"s1.x","length":6,"biometric":true,"after":300000}')).toEqual({ pin: 's1.x', length: 6, biometric: true, after: 300_000 });
    // a hash without its length is not used (the pad would not know when to check)
    expect(parseLockSettings('{"pin":"s1.x","after":0}')).toEqual({ pin: null, length: 0, biometric: false, after: 0 });
    // the fingerprint alone, without a PIN behind it, is not a lock
    expect(parseLockSettings('{"biometric":true,"after":5}')).toEqual({ pin: null, length: 0, biometric: false, after: 60_000 });
    expect(parseLockSettings('not json')).toEqual({ pin: null, length: 0, biometric: false, after: 60_000 });
  });
});

describe('navigation', () => {
  it('goes up a tab\'s stack, then to home, then leaves the app', () => {
    let s: NavState = initialNav();
    expect(canGoBack(s)).toBe(false);
    s = navigate(s, { type: 'tab', tab: 'customers' });
    s = navigate(s, { type: 'push', route: { name: 'customer', id: 'c1' } });
    s = navigate(s, { type: 'push', route: { name: 'statement', id: 'c1' } });
    expect(current(s)).toEqual({ name: 'statement', id: 'c1' });
    s = navigate(s, { type: 'back' });
    expect(current(s)).toEqual({ name: 'customer', id: 'c1' });
    // each tab keeps its own place
    s = navigate(s, { type: 'tab', tab: 'items' });
    expect(current(s)).toEqual({ name: 'items' });
    s = navigate(s, { type: 'tab', tab: 'customers' });
    expect(current(s)).toEqual({ name: 'customer', id: 'c1' });
    // the open tab pressed again: its first screen
    s = navigate(s, { type: 'tab', tab: 'customers' });
    expect(current(s)).toEqual({ name: 'customers' });
    s = navigate(s, { type: 'back' });
    expect(s.tab).toBe('home');
    expect(canGoBack(s)).toBe(false);
    expect(navigate(s, { type: 'back' })).toBe(s);
  });

  it('opens a screen on another tab, replaces the top one, and keeps long stacks short', () => {
    let s = navigate(initialNav(), { type: 'open', tab: 'sell', route: { name: 'scan', purpose: 'cart' } });
    expect(s.tab).toBe('sell');
    expect(s.stacks.sell).toEqual([{ name: 'cart' }, { name: 'scan', purpose: 'cart' }]);
    s = navigate(s, { type: 'replace', route: { name: 'item', code: '6281', purpose: 'cart' } });
    expect(s.stacks.sell).toEqual([{ name: 'cart' }, { name: 'item', code: '6281', purpose: 'cart' }]);
    for (let i = 0; i < 40; i++) s = navigate(s, { type: 'push', route: { name: 'scan', purpose: 'cart' } });
    expect(s.stacks.sell.length).toBeLessThanOrEqual(12);
    expect(s.stacks.sell[0]).toEqual({ name: 'cart' });
  });
});
