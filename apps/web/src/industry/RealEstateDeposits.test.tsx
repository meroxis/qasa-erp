import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { todayIso } from '@qasa/core';
import { UnitDeposits } from './RealEstateDeposits.tsx';
import type { ReDepositView, ReUnitView } from './real-estate-api.ts';

// Render a unit's deposits without a browser: hooks are simple stand-ins, components are walked as plain elements.
const fixture = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0,
  request: (() => Promise.resolve({})) as (...args: unknown[]) => Promise<unknown>,
  toast: (() => {}) as (s: string) => void,
  unit: null as unknown
}));
vi.mock('react', () => ({
  useState<T>(initial: T | (() => T)) {
    const i = fixture.cursor++;
    if (!(i in fixture.states)) fixture.states[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [fixture.states[i], (value: T) => { fixture.states[i] = value; }];
  },
  useEffect() {}, useRef<T>(v: T) { return { current: v }; }
}));
vi.mock('../components.tsx', () => ({
  AccountCombo: 'AccountCombo', AmountInput: 'AmountInput', ErrorBox: 'ErrorBox', Icon: 'Icon', Modal: 'Modal', SearchCombo: 'SearchCombo',
  useData: () => ({ settings: null }), useLoad: () => ({ data: fixture.unit, error: null, reload: () => {} }), useToast: () => fixture.toast
}));
vi.mock('../i18n.ts', () => ({
  useI18n: () => ({ t: (s: string) => s, int: String, date: String, digitsOf: String, money: (n: number) => String(n), lang: 'en' })
}));
vi.mock('../router.ts', () => ({ go: () => {}, href: (s: string) => s }));
vi.mock('../api.ts', () => ({ api: {}, ApiError: class extends Error {}, qs: () => '', request: (...args: unknown[]) => fixture.request(...args) }));

type Node = ReactElement<Record<string, unknown>>;
/** Walks the tree, rendering the component's own function components (not the mocked string ones). */
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  const inner = typeof node.type === 'function' ? flatten((node.type as (p: unknown) => unknown)(node.props)) : flatten(node.props.children);
  return [node, ...inner];
}
const text = (n: Node) => JSON.stringify(n.props.children ?? '');
const deposit = (status: 'refunded' | 'forfeited', closeStatus: 'draft' | 'approved', closeDate = '2026-10-20'): ReDepositView => ({
  entryId: 'd1', entryNumber: 'RV-2026-0007', unitId: 'u1', party: { id: 'p1', name: 'Las', phone: '' }, date: '2026-10-01', currency: 'IQD',
  amount: 5_000_000, status, reversed: false, invoiceId: null, closeEntry: { id: 'c1', number: null, status: closeStatus, type: 'payment', date: closeDate }, actions: ['reopen']
});
const unit = (d: ReDepositView) => ({
  id: 'u1', projectId: 'p', building: 'A', code: '12', floor: 3, kind: 'apartment', bedrooms: 3, areaX100: 12_000, price: 1, view: '', notes: '',
  status: 'available', party: null, reservedUntil: null, expired: false, invoice: null, contract: null, depositHeld: 0, deposits: [d], actions: []
}) as unknown as ReUnitView;
const render = () => { fixture.cursor = 0; return flatten(UnitDeposits({ unit: fixture.unit as ReUnitView, currency: 'IQD', onChanged: () => {} })); };
const takeBack = () => render().find((n) => n.type === 'button' && text(n).includes('dep_reopen'))!;

beforeEach(() => {
  fixture.states = [];
  fixture.request = vi.fn(() => Promise.resolve(fixture.unit));
  fixture.toast = vi.fn();
});

it('asks before taking back an approved refund, explains the reversal, and sends the chosen date', async () => {
  fixture.unit = unit(deposit('refunded', 'approved'));
  (takeBack().props.onClick as () => void)();
  // an approved refund is never reversed on the first click
  expect(fixture.request).not.toHaveBeenCalled();

  let nodes = render();
  const dialog = nodes.find((n) => n.type === 'Modal')!;
  expect(dialog.props.title).toBe('dep_reverseRefundTitle');
  expect(nodes.some((n) => n.type === 'p' && text(n).includes('dep_reverseRefundNote'))).toBe(true);
  const date = nodes.find((n) => n.type === 'input' && n.props.type === 'date')!;
  expect(date.props.value).toBe(todayIso());
  // never before the refund it reverses (the journal refuses that), not only after the deposit
  expect(date.props.min).toBe('2026-10-20');
  (date.props.onChange as (e: unknown) => void)({ target: { value: '2026-11-05' } });

  nodes = render();
  (nodes.find((n) => n.type === 'button' && text(n).includes('dep_reverse"'))!.props.onClick as () => void)();
  expect(fixture.request).toHaveBeenCalledWith('POST', '/api/real-estate/deposits/d1/reopen', { date: '2026-11-05' });
  await vi.waitFor(() => expect(fixture.toast).toHaveBeenCalledWith('dep_reversedBack'));
  expect(fixture.toast).not.toHaveBeenCalledWith('dep_reopened');
});

it('offers a refund dated ahead of today its own date for the reversal, never an earlier one', () => {
  fixture.unit = unit(deposit('refunded', 'approved', '2099-01-15'));
  (takeBack().props.onClick as () => void)();
  const date = render().find((n) => n.type === 'input' && n.props.type === 'date')!;
  expect(date.props.min).toBe('2099-01-15');
  expect(date.props.value).toBe('2099-01-15');
});

it('explains an approved forfeit in its own words', () => {
  fixture.unit = unit(deposit('forfeited', 'approved'));
  (takeBack().props.onClick as () => void)();
  const nodes = render();
  expect(nodes.find((n) => n.type === 'Modal')!.props.title).toBe('dep_reverseForfeitTitle');
  expect(nodes.some((n) => n.type === 'p' && text(n).includes('dep_reverseForfeitNote'))).toBe(true);
});

it('takes back a draft at once, with the draft text', async () => {
  fixture.unit = unit(deposit('refunded', 'draft'));
  (takeBack().props.onClick as () => void)();
  expect(fixture.request).toHaveBeenCalledWith('POST', '/api/real-estate/deposits/d1/reopen', {});
  await vi.waitFor(() => expect(fixture.toast).toHaveBeenCalledWith('dep_reopened'));
  expect(render().some((n) => n.type === 'Modal')).toBe(false);
});
