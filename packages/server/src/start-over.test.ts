import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from './db.ts';
import { createUser, resetLoginThrottle, setPassword } from './auth.ts';
import { updateSettings, writeSetting } from './settings.ts';
import { checkStartOver, confirmsCompany, parseStartOverRequest } from './start-over.ts';

let db: Db;
beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  const owner = (db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string }).id;
  writeSetting(db, 'trial_started', new Date().toISOString().slice(0, 10));
  await setPassword(db, owner, 'owner-pass-1', 'Mer');
  await createUser(db, { username: 'las', name: 'Las', roles: ['sales'], password: 'las-pass-1' }, 'Mer');
  updateSettings(db, { companyName: { ar: 'شركة ميروكسيس', en: 'Meroxis Company', ku: 'کۆمپانیای مێرۆکسیس' } }, 'Mer');
});
afterEach(() => db.close());

const ask = (username: string, password: string, confirmation: string) => checkStartOver(db, { username, password, confirmation }, 'Qasa ERP');

describe('starting over with empty books: the checks', () => {
  it('needs an admin\'s password and the company\'s name typed, in any of its languages', async () => {
    await expect(ask('admin', 'owner-pass-1', '  meroxis   COMPANY ')).resolves.toMatchObject({ username: 'admin' });
    await expect(ask('admin', 'owner-pass-1', 'شركة ميروكسيس')).resolves.toBeTruthy();
    await expect(ask('admin', 'wrong-password', 'Meroxis Company')).rejects.toMatchObject({ code: 'invalid_login' });
    await expect(ask('las', 'las-pass-1', 'Meroxis Company')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(ask('admin', 'owner-pass-1', 'Meroxis')).rejects.toMatchObject({ code: 'validation', details: [{ code: 'start_over_confirmation' }] });
    // the session the check signed in with is closed at once, and the failed try is in the audit log
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'login_failed'").get()).toEqual({ n: 1 });
    // tries are limited as sign-ins are
    for (let i = 0; i < 6; i++) await ask('admin', 'wrong-password', 'x').catch(() => {});
    await expect(ask('admin', 'owner-pass-1', 'Meroxis Company')).rejects.toMatchObject({ code: 'too_many_attempts' });
  });

  it('takes the switcher\'s name when the company has none, and reads the request field by field', () => {
    expect(confirmsCompany('qasa erp', ['Qasa ERP'])).toBe(true);
    expect(confirmsCompany('', ['Qasa ERP'])).toBe(false);
    expect(confirmsCompany('anything', [])).toBe(false);
    expect(parseStartOverRequest({ username: 'admin', password: 'p', confirmation: 'c' })).toEqual({ username: 'admin', password: 'p', confirmation: 'c' });
    expect(parseStartOverRequest({ username: 'admin', password: 'p' })).toBeNull();
    expect(parseStartOverRequest({ username: 'a'.repeat(65), password: 'p', confirmation: 'c' })).toBeNull();
    expect(parseStartOverRequest('admin')).toBeNull();
  });
});
