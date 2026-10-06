import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { CurrencyCode } from '@qasa/core';
import { InvoiceEditor } from './Invoices.tsx';
import { api } from '../api.ts';

// Exercise the editor's actual selection and save callbacks without a browser or company database.
const fixture = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, first: true, effects: [] as (() => void)[],
  item: { id: 'sample', code: 'I1', name: { ar: 'meroxis', en: 'meroxis', ku: 'meroxis' }, unit: 'service', saleCurrency: 'USD' as CurrencyCode, salePrice: 1000, trackStock: false, qtyMilli: 0, value: 0 }
}));
vi.mock('react', () => ({
  useState<T>(initial: T | (() => T)) {
    const i = fixture.cursor++;
    if (!(i in fixture.states)) fixture.states[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [fixture.states[i], (value: T | ((old: T) => T)) => {
      fixture.states[i] = typeof value === 'function' ? (value as (old: T) => T)(fixture.states[i] as T) : value;
    }];
  },
  useEffect(fn: () => void) { if (fixture.first) fixture.effects.push(fn); },
  useMemo<T>(fn: () => T) { return fn(); }
}));
vi.mock('../api.ts', () => ({
  ApiError: Error,
  api: {
    parties: () => [], warehouses: () => [{ id: 'w', active: true, name: fixture.item.name }], items: () => [fixture.item],
    createInvoice: vi.fn(async () => ({ id: 'draft' }))
  }
}));
vi.mock('../components.tsx', () => ({
  AccountCombo: 'AccountCombo', AmountInput: 'AmountInput', ErrorBox: 'ErrorBox', Icon: 'Icon', InvoiceStatusChip: 'InvoiceStatusChip',
  Modal: 'Modal', QtyInput: 'QtyInput', SearchCombo: 'SearchCombo',
  useData: () => ({ settings: { defaultRateX100: 142000, postingAccounts: { cash: '1811' } }, reloadAccounts: async () => {} }),
  useLoad: (fn: () => unknown) => ({ data: fn() }), useToast: () => () => {}
}));
vi.mock('../i18n.ts', () => ({ useI18n: () => ({
  t: (s: string) => s, name: (n: { en: string }) => n.en, int: String, money: String, digitsOf: String, lang: 'en'
}) }));
vi.mock('../router.ts', () => ({ go: () => {}, href: (s: string) => s }));
vi.mock('./Parties.tsx', () => ({ InvoicesTable: 'InvoicesTable' }));
vi.mock('./Items.tsx', () => ({ averageCost: () => 0, qtyText: String, unitName: (_: unknown, unit: string) => unit }));

function flatten(value: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as ReactElement<Record<string, unknown>>;
  return [node, ...flatten(node.props.children)];
}
function render() { fixture.cursor = 0; return flatten(InvoiceEditor({ kind: 'sale' })); }
function invoke(handler: unknown, ...args: unknown[]) { return (handler as (...values: unknown[]) => unknown)(...args); }

beforeEach(() => {
  fixture.states = []; fixture.cursor = 0; fixture.first = true; fixture.effects = [];
  vi.clearAllMocks();
});

it.each([
  ['USD', 'IQD', 1000, 14200],
  ['IQD', 'USD', 14200, 1000],
  ['USD', 'USD', 1000, 1000],
  ['IQD', 'IQD', 14200, 14200]
] as const)('selects and saves a %s catalog price on a %s invoice correctly', async (from, to, amount, expected) => {
  fixture.item.saleCurrency = from; fixture.item.salePrice = amount;
  render(); fixture.effects.forEach((fn) => fn()); fixture.first = false;
  const currency = render().find((n) => n.type === 'button' && n.props.children === (to === 'USD' ? 'usdName' : 'iqdName'))!;
  invoke(currency.props.onClick);
  const picker = render().find((n) => n.type === 'SearchCombo' && n.props.ariaLabel === 'item')!;
  invoke(picker.props.onChange, fixture.item.id);
  const nodes = render();
  expect(nodes.find((n) => n.type === 'AmountInput' && n.props.ariaLabel === 'unitPrice')!.props.value).toBe(expected);
  await invoke(nodes.find((n) => n.type === 'button' && n.props.children === 'saveDraft')!.props.onClick);
  expect(api.createInvoice).toHaveBeenCalledWith(expect.objectContaining({
    currency: to, rateX100: to === 'IQD' ? 100 : 142000,
    lines: [{ itemId: 'sample', qtyMilli: 1000, unitPrice: expected }]
  }));
});
