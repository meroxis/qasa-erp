import { expect, it, vi } from 'vitest';
import { trialBalanceCsv } from './Reports.tsx';
import { SAFETY_TEXT } from '../i18n/safety.ts';
import type { TrialBalanceReport } from '../api.ts';

vi.mock('../components.tsx', () => ({ AccountCombo: 'AccountCombo', ErrorBox: 'ErrorBox', Icon: 'Icon', downloadCsv: () => {}, useData: () => ({}), useLoad: () => ({}) }));
vi.mock('../i18n.ts', () => ({ useI18n: () => ({}) }));
vi.mock('../router.ts', () => ({ go: () => {}, href: (s: string) => s }));
vi.mock('../industry/printing.ts', () => ({ printDocument: () => {} }));
vi.mock('../api.ts', () => ({ api: {} }));

const name = { ar: 'الصندوق', en: 'Cash', ku: 'سندووق' };
const report: TrialBalanceReport = {
  rows: [
    { code: '1811', name, openingDebit: 1_000_000, openingCredit: 0, debit: 50_000, credit: 0, closingDebit: 1_050_000, closingCredit: 0, balance: 1_050_000 },
    { code: '229', name: { ar: 'الاحتياطي', en: 'Reserves', ku: 'یەدەگ' }, openingDebit: 0, openingCredit: 1_000_000, debit: 0, credit: 50_000, closingDebit: 0, closingCredit: 1_050_000, balance: 1_050_000 }
  ],
  openingDebitTotal: 1_000_000, openingCreditTotal: 1_000_000, totalDebit: 50_000, totalCredit: 50_000, balanceDebitTotal: 1_050_000, balanceCreditTotal: 1_050_000
};

it('exports the trial balance with opening, movement and closing, each as debit and credit', () => {
  const rows = trialBalanceCsv(report, (k) => k, (n) => n.en);
  expect(rows[0]).toEqual(['code', 'account', 'openingDebit', 'openingCredit', 'movementDebit', 'movementCredit', 'closingDebit', 'closingCredit']);
  expect(rows[1]).toEqual(['1811', 'Cash', '1,000,000', '0', '50,000', '0', '1,050,000', '0']);
  expect(rows[2]).toEqual(['229', 'Reserves', '0', '1,000,000', '0', '50,000', '0', '1,050,000']);
  expect(rows[3]).toEqual(['totals', '', '1,000,000', '1,000,000', '50,000', '50,000', '1,050,000', '1,050,000']);
});

it('has the opening and closing headings in Arabic, English and Kurdish', () => {
  for (const k of ['tbMovement', 'openingDebit', 'openingCredit', 'closingDebit', 'closingCredit', 'tbOpeningHelp'] as const) {
    expect(SAFETY_TEXT[k]).toHaveLength(3);
    for (const s of SAFETY_TEXT[k]) expect(s.trim().length).toBeGreaterThan(0);
  }
  expect(SAFETY_TEXT.openingDebit[1]).toBe('Opening debit');
});
