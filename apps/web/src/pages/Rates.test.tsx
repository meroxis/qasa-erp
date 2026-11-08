import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { Rates } from './Rates.tsx';

// Render the rate board without a browser: hooks are simple stand-ins, components are walked as plain elements.
const fixture = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0,
  reloadSettings: (() => {}) as () => void,
  rates: [{ date: '2026-11-07', rateX100: 1460000, source: null, createdBy: 'Mer' }, { date: '2026-11-06', rateX100: 146000, source: null, createdBy: 'Las' }]
}));
vi.mock('react', () => ({
  useState<T>(initial: T | (() => T)) {
    const i = fixture.cursor++;
    if (!(i in fixture.states)) fixture.states[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [fixture.states[i], (value: T) => { fixture.states[i] = value; }];
  },
  useMemo<T>(fn: () => T) { return fn(); }
}));
vi.mock('../components.tsx', () => ({
  AccountCombo: 'AccountCombo', ErrorBox: 'ErrorBox', Icon: 'Icon', Modal: 'Modal',
  useData: () => ({ settings: { defaultRateX100: 1460000 }, reloadSettings: fixture.reloadSettings }),
  useLoad: (fn: () => unknown) => ({ data: fn(), reload: () => {} }), usePageNav: () => {}, useToast: () => () => {}
}));
vi.mock('../i18n.ts', () => ({ useI18n: () => ({ t: (s: string) => s, int: String, date: String, digitsOf: String, lang: 'en' }) }));
vi.mock('../router.ts', () => ({ go: () => {}, href: (s: string) => s }));
vi.mock('../industry/fx-api.ts', () => ({ fxApi: { rates: () => fixture.rates, deleteRate: async () => {} } }));

type Node = ReactElement<Record<string, unknown>>;
/** Walks the tree, rendering the page's own function components (not the mocked string ones). */
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  const inner = typeof node.type === 'function' && node.type.name !== 'DeleteRate' && node.type.name !== 'RateChart'
    ? flatten((node.type as (p: unknown) => unknown)(node.props)) : flatten(node.props.children);
  return [node, ...inner];
}
const render = () => { fixture.cursor = 0; return flatten(Rates({ tab: 'rates' })); };

beforeEach(() => { fixture.states = []; fixture.reloadSettings = vi.fn(); });

it('reloads the settings after a rate is deleted, so new documents stop using the deleted default rate', () => {
  const del = render().find((n) => n.type === 'button' && n.props['aria-label'] === 'actDelete')!;
  (del.props.onClick as () => void)();
  const dialog = render().find((n) => typeof n.type === 'function' && n.type.name === 'DeleteRate')!;
  expect(dialog).toBeDefined();
  (dialog.props.onDone as () => void)();
  expect(fixture.reloadSettings).toHaveBeenCalledTimes(1);
});

it('offers no revaluation (worked out from the company books) to someone limited to branches', () => {
  fixture.cursor = 0;
  const nodes = flatten(Rates({ tab: 'revaluation', revaluation: false }));
  expect(nodes.some((n) => n.type === 'button' && n.props.children === 'fx_tabRevaluation')).toBe(false);
  expect(nodes.some((n) => typeof n.type === 'function' && n.type.name === 'Revaluation')).toBe(false);
  expect(nodes.some((n) => typeof n.type === 'function' && n.type.name === 'Board')).toBe(true);
});
