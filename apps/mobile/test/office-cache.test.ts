import { afterEach, describe, expect, it } from 'vitest';
import { forgetOffice, officeScope, recall, remember, setOfficeScope } from '../src/office-cache';

// What a screen keeps in memory of the office (the expense form's safes and banks, for when the link drops) belongs to
// the office the phone is paired with, and is gone on unpairing.

const A = { serverKey: 'key-a', deviceId: 'phone-1' };
const B = { serverKey: 'key-b', deviceId: 'phone-9' };
const SAFES = { accounts: [{ code: '1811', name: { ar: 'الصندوق', en: 'Cash', ku: 'سندووق' } }], cash: '1811' };

afterEach(() => { forgetOffice(); });

describe('what screens keep of the office', () => {
  it('is read back for the office it was read from only', () => {
    setOfficeScope(officeScope(A));
    remember('expense.accounts', SAFES);
    expect(recall('expense.accounts')).toEqual(SAFES);
    // the same office again (the app's state changed, not the office): still there
    setOfficeScope(officeScope({ ...A }));
    expect(recall('expense.accounts')).toEqual(SAFES);
    // paired with another office: nothing of the first
    setOfficeScope(officeScope(B));
    expect(recall('expense.accounts')).toBeNull();
    // and back: what was kept went with the change
    setOfficeScope(officeScope(A));
    expect(recall('expense.accounts')).toBeNull();
  });

  it('is gone on unpairing, and when the office removes the phone', () => {
    setOfficeScope(officeScope(A));
    remember('expense.accounts', SAFES);
    forgetOffice();
    expect(recall('expense.accounts')).toBeNull();
    // paired again with the same office: still nothing from before
    setOfficeScope(officeScope(A));
    expect(recall('expense.accounts')).toBeNull();
    remember('expense.accounts', SAFES);
    // the office removed this phone (its id is gone): nothing kept, nothing read
    setOfficeScope(officeScope({ ...A, deviceId: null }));
    expect(recall('expense.accounts')).toBeNull();
    remember('expense.accounts', SAFES);
    expect(recall('expense.accounts')).toBeNull();
    expect(officeScope(null)).toBeNull();
  });
});
