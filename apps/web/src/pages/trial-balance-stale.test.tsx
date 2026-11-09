import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { TrialBalance } from './Reports.tsx';

// Like React, the first render after a date change still sees what the last load returned: the report for the old
// dates. That report must not show, nor be exported, under the new dates.
const fixture = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, last: null as unknown, pending: [] as Promise<unknown>[] }));
vi.mock('react', () => ({
  useState<T>(initial: T | (() => T)) {
    const i = fixture.cursor++;
    if (!(i in fixture.states)) fixture.states[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [fixture.states[i], (value: T) => { fixture.states[i] = value; }];
  }
}));
vi.mock('../components.tsx', () => ({
  AccountCombo: 'AccountCombo', ErrorBox: 'ErrorBox', Icon: 'Icon', downloadCsv: () => {},
  useData: () => ({ settings: { fiscalYearStart: '01-01' } }),
  useLoad: (fn: () => Promise<unknown>) => {
    const data = fixture.last;
    fixture.pending.push(fn().then((value) => { fixture.last = value; }));
    return { data, error: null, loading: true };
  }
}));
vi.mock('../i18n.ts', () => ({ useI18n: () => ({ t: (s: string) => s, money: String, date: String, name: () => '' }) }));
vi.mock('../router.ts', () => ({ go: () => {}, href: (s: string) => s }));
vi.mock('../industry/printing.ts', () => ({ printDocument: () => {} }));
vi.mock('../api.ts', () => ({
  api: {
    trialBalance: () => Promise.resolve({
      rows: [{ code: '181', name: { ar: 'الصندوق', en: 'Cash', ku: 'سندوق' }, openingDebit: 0, openingCredit: 0, debit: 5000, credit: 0, closingDebit: 5000, closingCredit: 0 }],
      totalDebit: 5000, totalCredit: 5000, openingDebitTotal: 0, openingCreditTotal: 0, balanceDebitTotal: 5000, balanceCreditTotal: 5000
    })
  }
}));

type Node = ReactElement<Record<string, unknown>>;
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  const inner = typeof node.type === 'function' ? flatten((node.type as (p: unknown) => unknown)(node.props)) : flatten(node.props.children);
  return [node, ...inner];
}
const render = (from: string, to: string) => {
  fixture.states = [from, to];
  fixture.cursor = 0;
  return flatten(TrialBalance());
};
const exportButton = (nodes: Node[]) => nodes.find((n) => n.type === 'button' && JSON.stringify(n.props.children).includes('exportExcel'));
const hasReport = (nodes: Node[]) => nodes.some((n) => n.type === 'h2' && JSON.stringify(n.props.children).includes('trialBalance'));

beforeEach(async () => {
  fixture.last = null;
  fixture.pending = [];
  render('2026-01-01', '2026-06-30');
  await Promise.all(fixture.pending);
});

it('shows and exports the report once it is loaded for its dates', () => {
  const nodes = render('2026-01-01', '2026-06-30');
  expect(hasReport(nodes)).toBe(true);
  expect(exportButton(nodes)?.props.disabled).toBe(false);
});

it('clears the report and disables Export at once when From moves after To', () => {
  const nodes = render('2026-12-31', '2026-06-30');
  expect(hasReport(nodes)).toBe(false);
  expect(exportButton(nodes)?.props.disabled).toBe(true);
});

it('does not show or export the old figures under new dates while the new report loads', () => {
  const nodes = render('2026-01-01', '2026-03-31');
  expect(hasReport(nodes)).toBe(false);
  expect(exportButton(nodes)?.props.disabled).toBe(true);
});
