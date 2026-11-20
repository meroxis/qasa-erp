import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TILL_CARD_PAYMENTS } from './till-payments.ts';

// 2.0.0 (owner's decision): the till is cash, credit and gift vouchers only; the card and wallet code stays dormant.
describe('card and wallet payments at the till', () => {
  it('are off, and every screen that offers them asks the one flag', () => {
    expect(TILL_CARD_PAYMENTS).toBe(false);
    const read = (f: string) => readFileSync(new URL(`../../../apps/web/src/${f}`, import.meta.url), 'utf8');
    expect(read('pos/Register.tsx')).toContain('if (TILL_CARD_PAYMENTS) tillsApi.paymentAccounts()');
    expect(read('industry/TillSettings.tsx')).toContain('{TILL_CARD_PAYMENTS && <PayAccountsCard />}');
    expect(read('pos/TillRulesSettings.tsx')).toContain("{TILL_CARD_PAYMENTS && <label");
    expect(read('pages/CustomerDisplay.tsx')).toContain('{TILL_CARD_PAYMENTS && state.paying');
  });
});
