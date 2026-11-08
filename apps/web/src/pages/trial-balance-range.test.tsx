import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { TrialBalance } from './Reports.tsx';

// Render the trial balance without a browser: hooks are simple stand-ins, components are walked as plain elements.
const fixture = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, asked: [] as [string | undefined, string | undefined][] }));
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
  useLoad: (fn: () => unknown) => { fn(); return { data: null, error: null }; }
}));
vi.mock('../i18n.ts', () => ({ useI18n: () => ({ t: (s: string) => s, money: String, date: String, name: () => '' }) }));
vi.mock('../router.ts', () => ({ go: () => {}, href: (s: string) => s }));
vi.mock('../industry/printing.ts', () => ({ printDocument: () => {} }));
vi.mock('../api.ts', () => ({
  api: { trialBalance: (from?: string, to?: string) => { fixture.asked.push([from, to]); return Promise.resolve(null); } }
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

beforeEach(() => { fixture.asked = []; });

it('says From is later than To and does not ask the server for a reversed period', () => {
  const nodes = render('2026-12-31', '2026-01-01');
  expect(fixture.asked).toEqual([]);
  expect(nodes.some((n) => n.props.role === 'alert' && n.props.children === 'err_date_range_reversed')).toBe(true);
});

it('asks for a period that runs forward (the same day included), with no message', () => {
  const nodes = render('2026-01-01', '2026-01-01');
  expect(fixture.asked).toEqual([['2026-01-01', '2026-01-01']]);
  expect(nodes.some((n) => n.props.role === 'alert')).toBe(false);
});

