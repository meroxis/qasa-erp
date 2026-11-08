import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { todayIso } from '@qasa/core';
import { PayrollRun } from './Payroll.tsx';

// Render the month without a browser: hooks are simple stand-ins, components are walked as plain elements.
const fixture = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0,
  request: (() => Promise.resolve({})) as (...args: unknown[]) => Promise<unknown>,
  toast: (() => {}) as (s: string) => void,
  run: null as unknown
}));
vi.mock('react', () => ({
  Fragment: 'Fragment',
  useState<T>(initial: T | (() => T)) {
    const i = fixture.cursor++;
    if (!(i in fixture.states)) fixture.states[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [fixture.states[i], (value: T | ((old: T) => T)) => {
      fixture.states[i] = typeof value === 'function' ? (value as (old: T) => T)(fixture.states[i] as T) : value;
    }];
  },
  useEffect() {}
}));
vi.mock('../components.tsx', () => ({
  EmptyState: 'EmptyState', AccountCombo: 'AccountCombo', AmountInput: 'AmountInput', downloadCsv: () => {}, ErrorBox: 'ErrorBox', Icon: 'Icon',
  Modal: 'Modal', SearchCombo: 'SearchCombo', useData: () => ({ settings: null }), useLoad: () => ({ data: fixture.run, reload: () => {} }),
  usePageNav: () => {}, useToast: () => fixture.toast
}));
vi.mock('../i18n.ts', () => ({
  useI18n: () => ({ t: (s: string) => s, int: String, date: String, digitsOf: String, money: (n: number) => String(n), name: () => '', lang: 'en' })
}));
vi.mock('../router.ts', () => ({ go: () => {}, href: (s: string) => s }));
vi.mock('../api.ts', () => ({ ApiError: class extends Error {}, qs: () => '', request: (...args: unknown[]) => fixture.request(...args) }));

type Node = ReactElement<Record<string, unknown>>;
/** Walks the tree, rendering the page's own function components (not the mocked string ones). */
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  const inner = typeof node.type === 'function' ? flatten((node.type as (p: unknown) => unknown)(node.props)) : flatten(node.props.children);
  return [node, ...inner];
}
const render = () => { fixture.cursor = 0; return flatten(PayrollRun({ id: 'r1' })); };
const text = (n: Node) => JSON.stringify(n.props.children ?? '');
const button = (nodes: Node[], label: string) => nodes.find((n) => n.type === 'button' && text(n).includes(label));
const totals = { gross: 0, allowances: 0, overtime: 0, bonus: 0, absence: 0, advanceDeduction: 0, socialSecurity: 0, otherDeductions: 0, net: 1_000_000 };
const month = (actions: string[]) => ({
  id: 'r1', period: '2026-10', date: '2026-10-31', currency: 'IQD', status: 'posted', employees: 2, totals, notes: '', lines: [],
  entry: { id: 'e1', number: 'JV-2026-0101', status: 'approved' }, payment: null, createdBy: 'Mer', createdAt: '2026-10-31T10:00:00Z', actions
});

beforeEach(() => {
  fixture.states = [];
  fixture.request = vi.fn(() => Promise.resolve(fixture.run));
  fixture.toast = vi.fn();
});

it('takes back an approved, unpaid month only after a confirmation with the reversal date, and sends that date', async () => {
  fixture.run = month(['pay', 'reverse']);
  const reverse = button(render(), 'pay_reverse')!;
  expect(reverse).toBeDefined();
  (reverse.props.onClick as () => void)();
  // nothing is sent before the confirmation
  expect(fixture.request).not.toHaveBeenCalled();

  let nodes = render();
  const dialog = nodes.find((n) => n.type === 'Modal')!;
  expect(dialog.props.title).toContain('pay_reverse');
  expect(nodes.some((n) => n.type === 'p' && text(n).includes('pay_reverseNote'))).toBe(true);
  const date = nodes.find((n) => n.type === 'input' && n.props.type === 'date')!;
  expect(date.props.value).toBe(todayIso());
  (date.props.onChange as (e: unknown) => void)({ target: { value: '2026-11-09' } });

  nodes = render();
  const confirm = nodes.find((n) => n.type === 'button' && String(n.props.className).includes('danger') && text(n).includes('pay_reverse'))!;
  (confirm.props.onClick as () => void)();
  expect(fixture.request).toHaveBeenCalledWith('POST', '/api/payroll/runs/r1/reverse', { date: '2026-11-09' });
  await vi.waitFor(() => expect(fixture.toast).toHaveBeenCalledWith('pay_reversedDone'));
});

it('shows no reverse button when the server does not offer it', () => {
  fixture.run = month(['pay']);
  expect(button(render(), 'pay_reverse')).toBeUndefined();
});
