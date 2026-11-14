import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { todayIso } from '@qasa/core';
import { GenRun } from './Generators.tsx';

// Render one generator month without a browser: hooks are simple stand-ins, components are walked as plain elements.
const fixture = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0,
  request: (() => Promise.resolve({})) as (...args: unknown[]) => Promise<unknown>,
  toast: (() => {}) as (s: string) => void,
  run: null as unknown
}));
vi.mock('react', () => ({
  useState<T>(initial: T | (() => T)) {
    const i = fixture.cursor++;
    if (!(i in fixture.states)) fixture.states[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [fixture.states[i], (value: T) => { fixture.states[i] = value; }];
  },
  useEffect() {}, useMemo<T>(fn: () => T) { return fn(); }, useRef<T>(v: T) { return { current: v }; }
}));
vi.mock('react-dom', () => ({ createPortal: () => null }));
vi.mock('../components.tsx', () => ({
  EmptyState: 'EmptyState', AccountCombo: 'AccountCombo', AmountInput: 'AmountInput', ErrorBox: 'ErrorBox', Icon: 'Icon', Modal: 'Modal',
  useData: () => ({ settings: null }), useLoad: () => ({ data: fixture.run, reload: () => {} }), useMay: () => () => true, usePageNav: () => {}, useToast: () => fixture.toast
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
const render = () => { fixture.cursor = 0; return flatten(GenRun({ id: 'g1' })); };
const text = (n: Node) => JSON.stringify(n.props.children ?? '');
const month = (actions: string[]) => ({
  id: 'g1', period: '2026-10', date: '2026-10-31', priceNormal: 10_000, priceGolden: 15_000, status: 'posted',
  entry: { id: 'e1', number: 'JV-2026-0102', status: 'approved' },
  totals: { subscribers: 2, ampsX10: { normal: 50, golden: 0 }, amount: { normal: 50_000, golden: 0 }, total: 50_000 }, bills: [], actions
});

beforeEach(() => {
  fixture.states = [];
  fixture.request = vi.fn(() => Promise.resolve(fixture.run));
  fixture.toast = vi.fn();
});

it('takes back an approved month only after a confirmation with the reversal date, and sends that date', async () => {
  fixture.run = month(['reverse']);
  const reverse = render().find((n) => n.type === 'button' && text(n).includes('gen_reverse'))!;
  expect(reverse).toBeDefined();
  (reverse.props.onClick as () => void)();
  expect(fixture.request).not.toHaveBeenCalled();

  let nodes = render();
  const dialog = nodes.find((n) => n.type === 'Modal')!;
  expect(dialog.props.title).toContain('gen_reverse');
  expect(nodes.some((n) => n.type === 'p' && text(n).includes('gen_reverseNote'))).toBe(true);
  const date = nodes.find((n) => n.type === 'input' && n.props.type === 'date')!;
  expect(date.props.value).toBe(todayIso());
  (date.props.onChange as (e: unknown) => void)({ target: { value: '2026-11-10' } });

  nodes = render();
  const confirm = nodes.find((n) => n.type === 'button' && String(n.props.className).includes('danger') && text(n).includes('gen_reverse'))!;
  (confirm.props.onClick as () => void)();
  expect(fixture.request).toHaveBeenCalledWith('POST', '/api/generators/runs/g1/reverse', { date: '2026-11-10' });
  await vi.waitFor(() => expect(fixture.toast).toHaveBeenCalledWith('gen_reversedDone'));
  // the dialog closes once the month is reversed
  expect(render().some((n) => n.type === 'Modal')).toBe(false);
});

it('shows no reverse button on a month the server does not offer it for', () => {
  fixture.run = month(['unpost']);
  expect(render().some((n) => n.type === 'button' && text(n).includes('gen_reverse'))).toBe(false);
});
