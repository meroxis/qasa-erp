import { describe, expect, it } from 'vitest';
import { hashPin, lockoutMs, parseLockSettings, shouldLock, validPin, verifyPin, weakPin } from '../src/lock';
import { canGoBack, current, initialNav, navigate, type NavState } from '../src/nav';
import { readPairingCode, validAddress } from '../src/pairing';
import { encodePairingCode, generateKeyPair, type PairingCode } from '../src/protocol';
import { actsAs, ALL_FEATURES, featuresOf, type Me } from '../src/roles';
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

  it('everything to the owner (no sign-in at the office)', () => {
    expect([...featuresOf({ signInRequired: false, user: { id: null, name: 'Mer', roles: ['admin'], permissions: ['admin'] } })]).toEqual(ALL_FEATURES);
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
    expect(featuresOf(me(['admin'], ['admin'])).size).toBe(ALL_FEATURES.length);
  });

  it('only looking up and counting before the phone knows who it is', () => {
    expect([...featuresOf(null)].sort()).toEqual(['count', 'lookup']);
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
