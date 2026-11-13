import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { PartyView } from '../api.ts';
import { PartyPicker, QuickPartyForm } from './PartyPicker.tsx';

// The picker's own callbacks, run without a browser: what the page is told when someone is chosen.
const fixture = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0 }));
vi.mock('react', () => ({
  useState<T>(initial: T | (() => T)) {
    const i = fixture.cursor++;
    if (!(i in fixture.states)) fixture.states[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [fixture.states[i], (value: T | ((old: T) => T)) => {
      fixture.states[i] = typeof value === 'function' ? (value as (old: T) => T)(fixture.states[i] as T) : value;
    }];
  },
  useEffect() {},
  useMemo<T>(fn: () => T) { return fn(); },
  useRef<T>(initial: T) {
    const i = fixture.cursor++;
    if (!(i in fixture.states)) fixture.states[i] = { current: initial };
    return fixture.states[i];
  }
}));
vi.mock('../api.ts', () => ({ api: {} }));
vi.mock('./prices-api.ts', () => ({ pricesApi: {} }));
vi.mock('../components.tsx', () => ({
  ErrorBox: 'ErrorBox', Icon: 'Icon', SearchCombo: 'SearchCombo',
  useData: () => ({ permissions: ['sales', 'purchases'] }), useToast: () => () => {}
}));
vi.mock('../i18n.ts', () => ({ useI18n: () => ({ t: (s: string) => s, digitsOf: String, lang: 'en' }) }));

type Node = ReactElement<Record<string, unknown>>;
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...flatten(node.props.children)];
}
function invoke(handler: unknown, ...args: unknown[]) { return (handler as (...values: unknown[]) => unknown)(...args); }

const party = (over: Partial<PartyView>): PartyView => ({
  id: 'p1', type: 'customer', code: 'C-0001', name: 'Mer', phone: '', address: '', accountCode: '1612', creditLimit: null, notes: '',
  active: true, balance: 0, hasEntries: false, ...over
});
// the page's own list has Mer and Las; Raz is on the server only (added by someone else since the page opened)
const mer = party({ id: 'p1', name: 'Mer', accountCode: '1612' });
const las = party({ id: 'p2', code: 'C-0002', name: 'Las', accountCode: '1613' });
const raz = party({ id: 'p9', code: 'C-0009', name: 'Raz', accountCode: '1619' });
const options = [mer, las].map((p) => ({ id: p.id, code: p.code, label: p.name }));

const onChange = vi.fn();
const onCreated = vi.fn();
function render(extra: Record<string, unknown> = {}) {
  fixture.cursor = 0;
  return flatten(PartyPicker({ type: 'customer', value: '', options, onChange, onCreated, placeholder: '…', ...extra }));
}
const combo = (nodes: Node[]) => nodes.find((n) => n.type === 'SearchCombo')!;
const form = (nodes: Node[]) => nodes.find((n) => n.type === QuickPartyForm);
/** Opens the form under the box, as the "+" does. */
function openForm(extra: Record<string, unknown> = {}) {
  invoke((combo(render(extra)).props.add as { onAdd(typed: string): void }).onAdd, 'Raz');
  return form(render(extra))!;
}

beforeEach(() => {
  fixture.states = []; fixture.cursor = 0;
  vi.clearAllMocks();
  vi.stubGlobal('window', { setTimeout: () => 0 });
});

describe('someone found by the form ("use this one") whom the page\'s list does not have', () => {
  it('is handed to the page as a record when chosen, and again every time they are chosen from the list', () => {
    invoke(openForm().props.onDone, raz, false);
    expect(onChange.mock.calls).toEqual([['p9', raz]]);
    // found, not added: the page is not told of a new party
    expect(onCreated).not.toHaveBeenCalled();
    // the list has them from now on
    expect((combo(render()).props.options as { id: string }[]).map((o) => o.id)).toEqual(['p1', 'p2', 'p9']);
    // another party is chosen, then Raz again from the list: a page that reads the party's account from the record
    // (a voucher line) must get Raz's, not keep the account of the party chosen in between
    invoke(combo(render()).props.onChange, 'p2');
    invoke(combo(render()).props.onChange, 'p9');
    expect(onChange.mock.calls.slice(1)).toEqual([['p2'], ['p9', raz]]);
  });

  it('is told to the page as new only when the form added them', () => {
    invoke(openForm().props.onDone, raz, true);
    expect(onCreated).toHaveBeenCalledWith(raz);
    expect(onChange).toHaveBeenCalledWith('p9', raz);
  });
});

describe('the price list in the form', () => {
  it('is asked for unless the page says it never prices by it (the till)', () => {
    expect(openForm().props.priceList).toBe(true);
    fixture.states = [];
    expect(openForm({ priceList: false }).props.priceList).toBe(false);
  });
});
