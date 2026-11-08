import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ApiError } from './api.ts';
import { errorMessages } from './components.tsx';
import { isKey, makeI18n, type Key } from './i18n.ts';
import { ROWS } from './pages/Plans.tsx';

// 1.0 texts: every error the server can now answer has its own words, and the plan page promises only what ships.
const LANGS = ['ar', 'en', 'ku'] as const;
const all = (key: Key) => LANGS.map((l) => makeI18n(l, 'western', () => {}, () => {}).t(key));
const en = makeI18n('en', 'western', () => {}, () => {});

it('has its own message, in Arabic, English and Kurdish, for every new error code', () => {
  const codes = [
    'database_newer', 'company_damaged', 'company_backup_use_settings', 'company_open_it_first', 'in_use', 'item_in_use',
    'invoice_has_unit', 'unit_has_deposits', 'account_invalid', 'same_person', 'fa_months_not_run', 'fa_run_has_disposed_asset',
    'account_invalid_gain', 'account_invalid_accountCode', 'reversal_before_entry', 'fa_period_before_last', 'fa_later_months_run',
    'bn_warehouse_choose', 'date_range_reversed'
  ];
  const missing = codes.filter((c) => !isKey(`err_${c}`));
  expect(missing).toEqual([]);
  for (const c of codes) {
    const [ar, english, ku] = all(`err_${c}` as Key);
    expect(new Set([ar, english, ku]).size, c).toBe(3);
    expect(english, c).not.toBe(en.t('err_internal'));
  }
  // the undo of a cheque step and of a depreciation month have their own words too
  for (const k of ['bk_undo', 'bk_undoDraft', 'bk_undoApproved', 'fa_reverseRun', 'fa_reverseRunNote', 'fa_undisposeApproved', 'adj_countCostHelp']) expect(isKey(k), k).toBe(true);
});

it('names the month depreciation was run up to when an earlier one is picked, and sends the asset category picked', () => {
  const error = new ApiError(400, 'validation', [{ code: 'fa_period_before_last', field: 'period', period: '2026-09' }]);
  expect(errorMessages(error, en)[0]).toContain('2026-09');
  // computers and furniture share account 116: the form sends the category, or the server can't tell them apart
  const form = readFileSync(new URL('./pages/FixedAssets.tsx', import.meta.url), 'utf8');
  expect(form).toContain('const figures = { ...(category ? { category } : {}), assetAccount');
});

it('says which adjustment account is wrong, instead of a general message', () => {
  const error = new ApiError(400, 'validation', [{ code: 'account_invalid', field: 'gain' }]);
  expect(errorMessages(error, en)).toEqual([en.t('err_account_invalid_gain')]);
  // a field without its own words keeps the code's message
  expect(errorMessages(new ApiError(400, 'validation', [{ code: 'account_invalid', field: 'cash' }]), en)).toEqual([en.t('err_account_invalid')]);
  // same_person covers adjustments as well as vouchers
  expect(en.t('err_same_person')).toMatch(/adjustment/);
});

it('promises only what 1.0 has: branches on Business, working online marked soon', () => {
  expect(en.t('f_branches')).toBe('Branches');
  expect(ROWS.find((r) => r.label === 'f_online')).toMatchObject({ cells: [false, false, true], soon: true });
  expect(ROWS.find((r) => r.label === 'f_branches')?.soon).toBeUndefined();
  // the row that is still to come is the online edition in the browser, not working from anywhere (that is Qasa Relay)
  expect(en.t('f_online')).toBe('Online edition (in the browser)');
  expect(all('f_online')).not.toContain('Working online from anywhere');
});

it('shows Qasa Relay as included on Pro and Business, as the release notes and the Store text say', () => {
  expect(ROWS.find((r) => r.label === 'f_relay')).toEqual({ label: 'f_relay', cells: [false, true, true] });
  for (const text of all('f_relay')) expect(text).toMatch(/^Qasa Relay: /);
  expect(en.t('f_relay')).toContain('not in the free month');
});

it('calls the trial a free month, once per PC and without Qasa Relay', () => {
  for (const k of ['planTrialChip', 'trialEndedNote', 'trialHelp', 'trialStarted', 'e_trial', 'err_trial_unavailable', 'startTrial'] as Key[]) {
    expect(en.t(k).toLowerCase(), k).toContain('free month');
    for (const text of all(k)) expect(text, k).not.toMatch(/Pro trial|تجربة Pro|تاقیکردنەوەی Pro/);
  }
  expect(en.t('trialHelp')).toMatch(/per PC.*Qasa Relay/);
});

it('tells how a removed licence frees its seat, also when the PC is offline', () => {
  for (const text of all('removeLicenseConfirm')) expect(text).toContain('my.qasaerp.com');
});

it('lists what the usage report really sends: the update channel, the first-report flag, and never the licence number', () => {
  const [arRest, enRest, kuRest] = all('us_field_rest');
  expect(enRest).toMatch(/update channel/);
  expect(enRest).toMatch(/first report/);
  expect(arRest).toContain('قناة التحديث');
  expect(arRest).toContain('أول تقرير');
  expect(kuRest).toContain('کەناڵی نوێکردنەوە');
  expect(kuRest).toContain('یەکەم ڕاپۆرت');
  // the one-time number the portal signs its time with is named too
  expect(enRest).toContain('one-time random number (a nonce) used to check the time');
  expect(arRest).toContain('رقم عشوائي لمرة واحدة (nonce)');
  expect(kuRest).toContain('ژمارەیەکی هەڕەمەکیی یەکجاری (nonce)');
  const [arInstall, enInstall, kuInstall] = all('us_field_install');
  // a report is never linked to a licence: the number is never sent, and nothing says it is
  expect(enInstall).toMatch(/licence number is never sent.*never linked to a licence/);
  expect(arInstall).toContain('لا يُرسل معه رقم الترخيص أبداً');
  expect(kuInstall).toContain('ژمارەی مۆڵەت هەرگیز لەگەڵیدا نانێردرێت');
  expect(enRest).not.toMatch(/licence number if activated/);
  expect(enRest).toContain('without the licence number');
  expect(arRest).not.toContain('رقم الترخيص إن كان مفعّلاً');
  expect(kuRest).not.toContain('ژمارەی مۆڵەت ئەگەر چالاک بێت');
  for (const text of [arInstall, enInstall, kuInstall]) expect(text).not.toMatch(/linked to the licence holder|فيرتبط بصاحب الترخيص|بە خاوەنی مۆڵەتەکەوە دەبەسترێتەوە/);
  // no longer says the number can't be tied to anyone
  for (const text of [arInstall, enInstall, kuInstall]) expect(text).not.toMatch(/\(not your name or company\)/);
});

it('shows every field the usage report sends: the screen\'s payload type matches the server\'s', () => {
  const fields = (path: string) => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const body = /export interface UsagePayload \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '';
    return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]).sort();
  };
  const server = fields('../../../packages/server/src/usage.ts');
  expect(server).toContain('nonce');
  expect(fields('./industry/usage-api.ts')).toEqual(server);
});
