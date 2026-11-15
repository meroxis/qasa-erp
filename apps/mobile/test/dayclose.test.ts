import { describe, expect, it } from 'vitest';
import { translate } from '../src/i18n';
import { askMine, drawerTone, METHOD_KEY, stepDay, yesterdayOf } from '../src/owner/dayclose';
import { featuresOf, FIGURES_ROLES, lockRequired, type Me } from '../src/roles';

// The end-of-day close on the phone (phone app 1.1): its days, the drawers' tone, the desktop's words for how sales were
// paid, and the own part (mine=1) for every phone without a PIN.

describe('the end-of-day close on the phone', () => {
  it('steps a day back or forward, never after today', () => {
    expect(stepDay('2026-11-15', -1, '2026-11-15')).toBe('2026-11-14');
    expect(stepDay('2026-11-14', 1, '2026-11-15')).toBe('2026-11-15');
    expect(stepDay('2026-11-15', 1, '2026-11-15')).toBe('2026-11-15');
    expect(stepDay('2026-03-01', -1, '2026-11-15')).toBe('2026-02-28');
    expect(stepDay('2028-03-01', -1, '2028-11-15')).toBe('2028-02-29');
    expect(stepDay('2026-12-31', 1, '2027-06-01')).toBe('2027-01-01');
    expect(yesterdayOf('2026-11-01')).toBe('2026-10-31');
  });

  it('says whether a closed drawer was short, over or matched (counted against expected)', () => {
    expect(drawerTone({ IQD: -2_000, USD: 0 })).toEqual({ key: 'dayShort', tone: 'bad' });
    expect(drawerTone({ IQD: 0, USD: -500 })).toEqual({ key: 'dayShort', tone: 'bad' });
    expect(drawerTone({ IQD: 1_000, USD: 0 })).toEqual({ key: 'dayOver', tone: 'warn' });
    expect(drawerTone({ IQD: 0, USD: 0 })).toEqual({ key: 'dayMatches', tone: 'ok' });
    // short in one currency and over in the other is short
    expect(drawerTone({ IQD: 5_000, USD: -100 })).toEqual({ key: 'dayShort', tone: 'bad' });
    // still open, not counted: nothing to say
    expect(drawerTone(null)).toBeNull();
  });

  it('names how sales were paid in the desktop\'s words', () => {
    expect(translate('en', METHOD_KEY.cash)).toBe('Cash');
    expect(translate('en', METHOD_KEY.credit)).toBe('On credit');
    expect(translate('en', METHOD_KEY.bank)).toBe('Into the bank');
    expect(translate('ku', METHOD_KEY.cash)).toBe('نەقد');
    expect(translate('ku', METHOD_KEY.credit)).toBe('قەرز');
    expect(Object.keys(METHOD_KEY).sort()).toEqual(['bank', 'card', 'cash', 'credit', 'fib', 'loyalty', 'qi', 'zaincash']);
  });

  it('asks for the own part (mine=1) from every phone without a PIN, whatever the mix of roles', () => {
    const roles = ['admin', 'preparer', 'checker', 'approver', 'sales', 'purchasing', 'storekeeper', 'viewer'];
    const perms: Record<string, string[]> = { admin: ['admin'], preparer: ['entries.prepare'], checker: ['entries.check'], approver: ['entries.approve'], sales: ['sales'], purchasing: ['purchases'], storekeeper: ['stock'], viewer: [] };
    let own = 0;
    for (let mask = 0; mask < 1 << roles.length; mask++) {
      const mix = roles.filter((_, i) => (mask >> i) & 1);
      const me: Me = { signInRequired: true, user: { id: 'u1', name: 'Raz', roles: mix, permissions: mix.flatMap((r) => perms[r]!) }, phoneLink: { v: 2, offers: ['dayClose'] } };
      const figures = mix.some((r) => FIGURES_ROLES.includes(r));
      expect(askMine(me), mix.join('+')).toBe(!lockRequired(me));
      expect(askMine(me), mix.join('+')).toBe(!figures);
      if (featuresOf(me).has('dayClose') && askMine(me)) own++;
    }
    // e.g. a cashier who also keeps the stock or buys: own part only
    const mixed = (r: string[]): Me => ({ signInRequired: true, user: { id: 'u1', name: 'Las', roles: r, permissions: r.flatMap((x) => perms[x]!) } });
    expect(askMine(mixed(['sales', 'storekeeper'])) && askMine(mixed(['sales', 'purchasing'])) && askMine(mixed(['sales']))).toBe(true);
    expect(askMine({ signInRequired: false, user: null })).toBe(false);
    expect(own).toBeGreaterThan(0);
  });
});
