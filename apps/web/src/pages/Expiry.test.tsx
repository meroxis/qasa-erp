import { expect, it } from 'vitest';
import { ApiError } from '../api.ts';
import { errorMessages } from '../components.tsx';
import { isKey, makeI18n, type Key } from '../i18n.ts';
import { NAV } from '../nav.ts';
import { isExpiredRefusal } from '../industry/BatchFields.tsx';
import { pageGuide } from '../industry/GuideLink.tsx';

const LANGS = ['ar', 'en', 'ku'] as const;
const all = (key: Key) => LANGS.map((l) => makeI18n(l, 'western', () => {}, () => {}).t(key));
const en = makeI18n('en', 'western', () => {}, () => {});

it('has the expiry page under Inventory, with its guide topic', () => {
  const stock = NAV.find((g) => g.group === 'gStock')!;
  expect(stock.items.find((i) => i.path === 'expiry')).toMatchObject({ key: 'ex_title', match: ['expiry'] });
  expect(pageGuide('expiry')).toBe('stock-items-warehouses-counts');
});

it('says every batch and unit error in Arabic, English and Kurdish', () => {
  const codes = [
    'expiry_required', 'expiry_invalid', 'batch_expiry_differs', 'batch_expired', 'batch_insufficient', 'batch_invalid', 'batch_no_invalid', 'batch_in_use',
    'batch_number_taken', 'unit_qty_fraction', 'unit_repeated', 'unit_is_base', 'unit_factor_invalid', 'unit_barcode_repeated', 'barcode_taken', 'unit_in_use',
    'units_too_many', 'sale_unit_invalid', 'purchase_unit_invalid'
  ];
  expect(codes.filter((c) => !isKey(`err_${c}`))).toEqual([]);
  for (const c of codes) {
    const texts = all(`err_${c}` as Key);
    expect(new Set(texts).size, c).toBe(3);
  }
  // the line and what is left are in the message
  const error = new ApiError(400, 'validation', [{ code: 'batch_expired', line: 2, available: 3000 }]);
  expect(errorMessages(error, en)).toEqual(['Line 2: only 3 is within its expiry date; the rest has expired.']);
});

it('asks before selling expired stock only for that refusal', () => {
  expect(isExpiredRefusal(new ApiError(400, 'validation', [{ code: 'batch_expired', line: 1 }]))).toBe(true);
  expect(isExpiredRefusal(new ApiError(400, 'validation', [{ code: 'stock_insufficient', line: 1 }]))).toBe(false);
  expect(isExpiredRefusal(new Error('x'))).toBe(false);
});

it('has the pharmacy page among the industry pages, for the pharmacy business type, in three languages', () => {
  const industry = NAV.find((g) => g.group === 'gIndustry')!;
  expect(industry.items.find((i) => i.path === 'pharmacy')).toMatchObject({ key: 'phm_title', icon: 'pill', business: 'pharmacy' });
  for (const k of ['bt_pharmacy', 'bt_pharmacyText', 'phm_title', 'f_pharmacy', 'err_plan_limit_pharmacy', 'ph_recordHelp', 'err_ph_patient_required'] as Key[]) {
    expect(new Set(all(k)).size, k).toBe(3);
  }
});

it('names every POS payment method and the dollar statement hint in three languages', () => {
  for (const k of ['pay_cash', 'pay_card', 'pay_zaincash', 'pay_qi', 'pay_account', 'pos_left', 'pos_payAccounts', 'usd_statementHint',
    'err_payments_total_mismatch', 'err_pos_method_unavailable', 'err_reference_taken', 'err_overpayment', 'wa_scope_payments', 'cat_title'] as Key[]) {
    expect(new Set(all(k)).size, k).toBe(3);
  }
});
