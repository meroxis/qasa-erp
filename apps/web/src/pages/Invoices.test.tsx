import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { CurrencyCode } from '@qasa/core';
import { InvoiceEditor } from './Invoices.tsx';
import { api } from '../api.ts';
import { pricesApi } from '../industry/prices-api.ts';
import { printDocument } from '../industry/printing.ts';
import { go } from '../router.ts';

// Exercise the editor's actual selection and save callbacks without a browser or company database.
const fixture = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, first: true, effects: [] as (() => void)[],
  item: { id: 'sample', code: 'I1', name: { ar: 'meroxis', en: 'meroxis', ku: 'meroxis' }, unit: 'service', saleCurrency: 'USD' as CurrencyCode, salePrice: 1000, trackStock: false, qtyMilli: 0, value: 0 },
  // what the signed-in person may change (undefined: not known, as before these tests)
  permissions: undefined as string[] | undefined,
  steps: [] as string[],
  toasts: [] as string[],
  reloads: 0
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
  useMemo<T>(fn: () => T) { return fn(); },
  useCallback<T>(fn: T) { return fn; },
  useRef<T>(initial: T) {
    const i = fixture.cursor++;
    if (!(i in fixture.states)) fixture.states[i] = { current: initial };
    return fixture.states[i];
  }
}));
// the price list answer never arrives here, so the catalog price is what gets saved
vi.mock('../industry/categories-api.ts', () => ({ categoriesApi: { list: () => [] }, inCategory: () => true }));
vi.mock('../industry/CatalogPickers.tsx', () => ({ CategoryOptions: 'CategoryOptions' }));
vi.mock('../industry/prices-api.ts', () => ({ pricesApi: { priceFor: vi.fn(() => new Promise(() => {})) } }));
vi.mock('../industry/PartyPicker.tsx', () => ({ PartyPicker: 'PartyPicker' }));
vi.mock('../industry/PrintDocument.tsx', () => ({ DesignedPrint: 'DesignedPrint' }));
vi.mock('../industry/print-model.ts', () => ({ invoiceModel: (v: { id: string }) => ({ doc: 'sale', id: v.id }) }));
vi.mock('../industry/printing.ts', () => ({
  afterPaint: async () => {}, whenQuiet: async () => true,
  printDocument: vi.fn(async () => { fixture.steps.push('print'); return 'printed'; })
}));
vi.mock('../api.ts', () => ({
  ApiError: Error,
  pendingRequests: () => 0,
  api: {
    parties: () => [], warehouses: () => [{ id: 'w', active: true, name: fixture.item.name }], items: () => [fixture.item],
    createInvoice: vi.fn(async () => { fixture.steps.push('create'); return { id: 'draft', actions: ['edit', 'delete', 'post'] }; }),
    updateInvoice: vi.fn(async (id: string) => { fixture.steps.push('update'); return { id, actions: ['edit', 'delete', 'post'] }; }),
    postInvoice: vi.fn(async (id: string) => {
      fixture.steps.push('post');
      return { id, kind: 'sale', status: 'posted', number: 'INV-2026-0007', date: '2026-11-13', partyId: null, partyName: null, total: 14200, currency: 'IQD', actions: ['cancel'] };
    })
  }
}));
vi.mock('../components.tsx', () => ({
  AccountCombo: 'AccountCombo', AmountInput: 'AmountInput', ErrorBox: 'ErrorBox', Icon: 'Icon', InvoiceStatusChip: 'InvoiceStatusChip',
  Modal: 'Modal', QtyInput: 'QtyInput', SearchCombo: 'SearchCombo', SplitButton: 'SplitButton',
  useData: () => ({ settings: { defaultRateX100: 142000, postingAccounts: { cash: '1811' } }, reloadAccounts: async () => {}, permissions: fixture.permissions, userKey: 'name:Mer' }),
  useLoad: (fn: () => unknown) => ({ data: fn(), reload: () => { fixture.reloads++; } }), usePageNav: () => {},
  useToast: () => (m: string) => { fixture.toasts.push(m); }
}));
vi.mock('../i18n.ts', () => ({ useI18n: () => ({
  t: (s: string) => s, name: (n: { en: string }) => n.en, int: String, money: String, digitsOf: String, lang: 'en'
}) }));
vi.mock('../router.ts', () => ({ go: vi.fn(), href: (s: string) => s }));
vi.mock('./Parties.tsx', () => ({ InvoicesTable: 'InvoicesTable' }));
vi.mock('./Items.tsx', () => ({ averageCost: () => 0, qtyText: String, unitName: (_: unknown, unit: string) => unit }));

type Node = ReactElement<Record<string, unknown>>;
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...flatten(node.props.children)];
}
function render(kind: 'sale' | 'purchase' = 'sale') { fixture.cursor = 0; return flatten(InvoiceEditor({ kind })); }
function invoke(handler: unknown, ...args: unknown[]) { return (handler as (...values: unknown[]) => unknown)(...args); }
/** The first render, with its effects run (the defaults a new invoice starts with). */
function open(kind: 'sale' | 'purchase' = 'sale') { render(kind); fixture.effects.forEach((fn) => fn()); fixture.first = false; }
const saveButton = (kind: 'sale' | 'purchase' = 'sale') => render(kind).find((n) => n.type === 'SplitButton')!;
const choiceKeys = (button: Node) => (button.props.choices as { key: string }[]).map((c) => c.key);
const savedBar = (nodes: Node[]) => nodes.find((n) => n.type === 'div' && String(n.props.className).includes('saved-strip'));
const lineItems = (nodes: Node[]) => nodes.filter((n) => n.type === 'SearchCombo' && n.props.ariaLabel === 'item').map((n) => n.props.value);
function pickSample(kind: 'sale' | 'purchase' = 'sale') {
  invoke(render(kind).find((n) => n.type === 'SearchCombo' && n.props.ariaLabel === 'item')!.props.onChange, fixture.item.id);
}

beforeEach(() => {
  fixture.states = []; fixture.cursor = 0; fixture.first = true; fixture.effects = [];
  fixture.permissions = undefined; fixture.steps = []; fixture.toasts = []; fixture.reloads = 0;
  vi.clearAllMocks();
});
afterEach(() => { vi.unstubAllGlobals(); });

/** A window that answers the Post question and keeps the editor's key listener, as the browser would. */
function stubWindow(confirm = true) {
  const keys: ((e: unknown) => void)[] = [];
  vi.stubGlobal('window', {
    confirm: () => { fixture.steps.push('confirm'); return confirm; },
    setTimeout: (fn: () => void) => { fn(); return 0; },
    addEventListener: (type: string, fn: (e: unknown) => void) => { if (type === 'keydown') keys.push(fn); },
    removeEventListener: () => {}
  });
  vi.stubGlobal('document', { querySelector: () => null });
  return keys;
}

it.each([
  ['USD', 'IQD', 1000, 14200],
  ['IQD', 'USD', 14200, 1000],
  ['USD', 'USD', 1000, 1000],
  ['IQD', 'IQD', 14200, 14200]
] as const)('selects and saves a %s catalog price on a %s invoice correctly', async (from, to, amount, expected) => {
  fixture.item.saleCurrency = from; fixture.item.salePrice = amount;
  open();
  const currency = render().find((n) => n.type === 'button' && n.props.children === (to === 'USD' ? 'usdName' : 'iqdName'))!;
  invoke(currency.props.onClick);
  pickSample();
  const nodes = render();
  expect(nodes.find((n) => n.type === 'AmountInput' && n.props.ariaLabel === 'unitPrice')!.props.value).toBe(expected);
  // "Save as draft" is one of the save button's ways
  await invoke(nodes.find((n) => n.type === 'SplitButton')!.props.onRun, 'draft');
  expect(api.createInvoice).toHaveBeenCalledWith(expect.objectContaining({
    currency: to, rateX100: to === 'IQD' ? 100 : 142000,
    lines: [{ itemId: 'sample', qtyMilli: 1000, unitPrice: expected }]
  }));
  // a draft is not posted, and its own page opens as before
  expect(api.postInvoice).not.toHaveBeenCalled();
  expect(go).toHaveBeenCalledWith('invoice/draft');
});

it('asks for the customer price at the invoice\'s own rate when the item is priced in the other currency', () => {
  fixture.item.saleCurrency = 'IQD'; fixture.item.salePrice = 15000;
  open();
  invoke(render().find((n) => n.type === 'button' && n.props.children === 'usdName')!.props.onClick);
  invoke(render().find((n) => n.type === 'input' && n.props['aria-label'] === 'rate')!.props.onChange, { target: { value: '1500' } });
  invoke(render().find((n) => n.type === 'SearchCombo' && n.props.ariaLabel === 'item')!.props.onChange, fixture.item.id);
  expect(pricesApi.priceFor).toHaveBeenLastCalledWith('sample', null, 'USD', 150000);
  // the same currency needs no conversion, so no rate is sent
  invoke(render().find((n) => n.type === 'button' && n.props.children === 'iqdName')!.props.onClick);
  invoke(render().find((n) => n.type === 'SearchCombo' && n.props.ariaLabel === 'item')!.props.onChange, fixture.item.id);
  expect(pricesApi.priceFor).toHaveBeenLastCalledWith('sample', null, 'IQD', null);
});

describe('the customer box', () => {
  it('is a picker that can add a customer on a sale and a supplier on a purchase', () => {
    open();
    const sale = render().find((n) => n.type === 'PartyPicker')!;
    expect(sale.props).toMatchObject({ type: 'customer', emptyLabel: 'walkIn', placeholder: 'chooseCustomer' });
    // a party added in the picker is chosen, and the page loads its list again
    invoke(sale.props.onCreated, { id: 'p9' });
    expect(fixture.reloads).toBe(1);
    fixture.states = []; fixture.first = true; fixture.effects = [];
    open('purchase');
    const purchase = render('purchase').find((n) => n.type === 'PartyPicker')!;
    expect(purchase.props).toMatchObject({ type: 'supplier', placeholder: 'chooseSupplier' });
    expect(purchase.props.emptyLabel).toBeUndefined();
  });
});

describe('the one save button', () => {
  it('offers "Save, print and next" first on a sale and "Save and next" first on a purchase, with F9', () => {
    open();
    const sale = saveButton();
    expect(choiceKeys(sale)).toEqual(['print_next', 'print', 'next', 'whatsapp', 'post', 'draft']);
    expect(sale.props).toMatchObject({ current: 'print_next', shortcut: 'F9' });
    expect((sale.props.choices as { key: string; label: string }[])[0]).toMatchObject({ label: 'sv_print_next', hint: 'sv_hint_print_next' });
    fixture.states = []; fixture.first = true; fixture.effects = [];
    open('purchase');
    const purchase = saveButton('purchase');
    expect(choiceKeys(purchase)).toEqual(['next', 'print_next', 'print', 'post', 'draft']);
    expect(purchase.props.current).toBe('next');
  });

  it('posts, prints and opens a fresh invoice, in that order, and names the one saved last', async () => {
    stubWindow();
    open();
    invoke(render().find((n) => n.type === 'PartyPicker')!.props.onChange, 'p1');
    pickSample();
    await invoke(saveButton().props.onRun, 'print_next');
    expect(fixture.steps).toEqual(['confirm', 'create', 'post', 'print']);
    expect(printDocument).toHaveBeenCalledWith('invoice');
    // the page stays: no other page opens, and the invoice starts empty again
    expect(go).not.toHaveBeenCalled();
    const nodes = render();
    expect(nodes.find((n) => n.type === 'PartyPicker')!.props.value).toBe('');
    expect(lineItems(nodes)).toEqual(['']);
    // the stock and the balances are read again
    expect(fixture.reloads).toBe(2);
    expect(savedBar(nodes)!.props.className).toContain('ok');
    expect(nodes.some((n) => n.type === 'DesignedPrint')).toBe(true);
    expect(nodes.some((n) => n.type === 'a' && n.props.href === 'invoice/draft')).toBe(true);
    // the next invoice is a new one, not a change to the one just posted
    pickSample();
    await invoke(saveButton().props.onRun, 'next');
    expect(api.createInvoice).toHaveBeenCalledTimes(2);
    expect(api.updateInvoice).not.toHaveBeenCalled();
  });

  it('remembers the way used last as the main button, and F9 presses it', async () => {
    const keys = stubWindow();
    open();
    pickSample();
    await invoke(saveButton().props.onRun, 'next');
    expect(saveButton().props.current).toBe('next');
    expect(fixture.steps).toEqual(['confirm', 'create', 'post']);
    // F9 anywhere on the page
    expect(keys).toHaveLength(1);
    pickSample();
    fixture.steps = [];
    render();
    keys[0]!({ key: 'F9', preventDefault: () => {} });
    await vi.waitFor(() => expect(fixture.steps).toEqual(['confirm', 'create', 'post']));
    // a held-down key or Ctrl+F9 does nothing
    fixture.steps = [];
    keys[0]!({ key: 'F9', repeat: true, preventDefault: () => {} });
    keys[0]!({ key: 'F9', ctrlKey: true, preventDefault: () => {} });
    expect(fixture.steps).toEqual([]);
  });

  it('prints nothing and keeps the invoice open with the reason when posting is refused', async () => {
    stubWindow();
    open();
    pickSample();
    const refusal = new Error('stock_insufficient');
    vi.mocked(api.postInvoice).mockRejectedValueOnce(refusal);
    await invoke(saveButton().props.onRun, 'print_next');
    expect(fixture.steps).toEqual(['confirm', 'create']);
    expect(printDocument).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    const nodes = render();
    expect(nodes.find((n) => n.type === 'ErrorBox')!.props.error).toBe(refusal);
    // the line is still there, and no "saved" bar is shown
    expect(lineItems(nodes)).toEqual(['sample', '']);
    expect(savedBar(nodes)).toBeUndefined();
    // trying again changes the draft already saved instead of making a second one
    fixture.steps = [];
    await invoke(saveButton().props.onRun, 'print_next');
    expect(fixture.steps).toEqual(['confirm', 'update', 'post', 'print']);
    expect(api.createInvoice).toHaveBeenCalledTimes(1);
  });

  it('keeps the invoice posted and says so when the paper does not print', async () => {
    stubWindow();
    open();
    pickSample();
    vi.mocked(printDocument).mockResolvedValueOnce('failed');
    await invoke(saveButton().props.onRun, 'print_next');
    expect(api.postInvoice).toHaveBeenCalledTimes(1);
    expect(fixture.toasts).toEqual(['sv_notPrinted']);
    const nodes = render();
    expect(savedBar(nodes)!.props.className).toContain('warn');
    // "Print" in the bar tries again, and the bar follows
    await invoke(nodes.find((n) => n.type === 'button' && flatten(n.props.children).some((c) => c.type === 'Icon' && c.props.name === 'printer'))!.props.onClick);
    expect(printDocument).toHaveBeenCalledTimes(2);
    expect(savedBar(render())!.props.className).toContain('ok');
  });

  it('does nothing when the Post question is answered No', async () => {
    stubWindow(false);
    open();
    pickSample();
    await invoke(saveButton().props.onRun, 'print_next');
    expect(fixture.steps).toEqual(['confirm']);
    expect(api.createInvoice).not.toHaveBeenCalled();
  });

  it('"Save and print" posts, prints and opens the invoice\'s own page', async () => {
    stubWindow();
    open();
    pickSample();
    await invoke(saveButton().props.onRun, 'print');
    expect(fixture.steps).toEqual(['confirm', 'create', 'post', 'print']);
    expect(go).toHaveBeenCalledWith('invoice/draft');
  });

  it('still posts the way the Post button did: the same question, no paper, then the invoice\'s own page', async () => {
    stubWindow();
    open();
    pickSample();
    const post = (saveButton().props.choices as { key: string; label: string }[]).find((c) => c.key === 'post')!;
    expect(post.label).toBe('actPost');
    await invoke(saveButton().props.onRun, 'post');
    expect(fixture.steps).toEqual(['confirm', 'create', 'post']);
    expect(printDocument).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledWith('invoice/draft');
  });

  it('reads "Save and next" and keeps a draft for someone who may only prepare', async () => {
    stubWindow();
    // a storekeeper: may not post sales
    fixture.permissions = ['stock'];
    open();
    const button = saveButton();
    expect(choiceKeys(button)).toEqual(['next', 'draft']);
    expect((button.props.choices as { key: string; label: string; hint: string }[])[0]).toMatchObject({ label: 'sv_next', hint: 'sv_hint_next_draft' });
    pickSample();
    await invoke(button.props.onRun, 'next');
    // no Post question, nothing posted or printed: a draft, then the next invoice
    expect(fixture.steps).toEqual(['create']);
    expect(api.postInvoice).not.toHaveBeenCalled();
    expect(printDocument).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    // a way that isn't offered is not run, whoever asks for it
    fixture.steps = [];
    pickSample();
    await invoke(saveButton().props.onRun, 'print_next');
    expect(fixture.steps).toEqual([]);
  });

  it('keeps a draft when the server\'s answer does not list "post" among what this person may do', async () => {
    stubWindow();
    open();
    pickSample();
    vi.mocked(api.createInvoice).mockResolvedValueOnce({ id: 'draft', actions: ['edit', 'delete'] } as never);
    await invoke(saveButton().props.onRun, 'print_next');
    expect(api.postInvoice).not.toHaveBeenCalled();
    expect(printDocument).not.toHaveBeenCalled();
    expect(fixture.toasts).toEqual(['sv_onlyDraft']);
  });
});
