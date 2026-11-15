import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { api, ApiError, type ItemDetail, type ItemView, type StockCorrectionResult } from '../api.ts';
import { StockCorrection } from './StockCorrection.tsx';
import { QuickItemForm } from './QuickItemForm.tsx';

// 1.4.2 review: the stock correction dialog and the new-item form, run through their own handlers without a browser.
// A correction whose answer was lost is sent again only as it was, with its key, and the dialog stays locked until the
// server answers it; the weight of a scale's label goes back to the page with the item the form made or chose.

const fixture = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, keys: 0, toasts: [] as string[], done: [] as unknown[],
  data: {} as Record<string, unknown>
}));
vi.mock('react', () => ({
  useState<T>(initial: T | (() => T)) {
    const i = fixture.cursor++;
    if (!(i in fixture.states)) fixture.states[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [fixture.states[i], (value: T | ((old: T) => T)) => {
      fixture.states[i] = typeof value === 'function' ? (value as (old: T) => T)(fixture.states[i] as T) : value;
    }];
  },
  useRef<T>(initial: T) {
    const i = fixture.cursor++;
    if (!(i in fixture.states)) fixture.states[i] = { current: initial };
    return fixture.states[i];
  },
  useEffect() {},
  useMemo<T>(fn: () => T) { return fn(); }
}));
vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  newIdempotencyKey: () => `key-${++fixture.keys}`,
  api: {
    warehouses: () => [{ id: 'w1', code: 'MAIN', active: true, name: { ar: 'Main', en: 'Main', ku: 'Main' } }],
    parties: () => [],
    correctStock: vi.fn(),
    items: vi.fn(),
    createItem: vi.fn(),
    item: vi.fn()
  }
}));
vi.mock('../components.tsx', () => ({
  AccountCombo: 'AccountCombo', AmountInput: 'AmountInput', ErrorBox: 'ErrorBox', Icon: 'Icon', Modal: 'Modal', QtyInput: 'QtyInput', SearchCombo: 'SearchCombo',
  useData: () => fixture.data,
  // a list given at once is there; one still on its way (a promise) is not yet
  useLoad: (fn: () => unknown) => { const data = fn(); return { data: data instanceof Promise ? undefined : data }; },
  useMay: () => () => true,
  useToast: () => (message: string) => { fixture.toasts.push(message); }
}));
vi.mock('../i18n.ts', () => ({ useI18n: () => ({ t: (key: string) => key, name: (n: { en: string }) => n.en, qty: String, lang: 'en' }) }));
vi.mock('./BatchFields.tsx', () => ({ BatchInFields: 'BatchInFields' }));
vi.mock('./CatalogPickers.tsx', () => ({ CategoryOptions: 'CategoryOptions' }));
vi.mock('./categories-api.ts', () => ({ categoriesApi: { list: () => Promise.resolve([]) } }));
vi.mock('./batches-api.ts', () => ({ batchesApi: { settings: () => Promise.resolve({ defaultTrackExpiry: false }) } }));

type Node = ReactElement<Record<string, unknown>>;
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...flatten(node.props.children)];
}
const invoke = (handler: unknown, ...args: unknown[]) => (handler as (...values: unknown[]) => unknown)(...args);
/** Lets a press finish: every answer the mocks give has arrived, and the form has taken it in. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const primary = (nodes: Node[]) => nodes.find((n) => n.type === 'button' && n.props.className === 'btn primary')!;
const words = (node: Node) => [node.props.children].flat().filter((c) => typeof c === 'string');
/** Whether the form's fields are locked (a fieldset around them, disabled). */
const locked = (nodes: Node[]) => nodes.find((n) => n.type === 'fieldset')?.props.disabled === true;

beforeEach(() => {
  fixture.states = []; fixture.cursor = 0; fixture.keys = 0; fixture.toasts = []; fixture.done = []; fixture.data = {};
  vi.mocked(api.correctStock).mockReset();
  vi.mocked(api.items).mockReset();
  vi.mocked(api.createItem).mockReset();
  vi.mocked(api.item).mockReset();
});

describe('a stock correction whose answer was lost', () => {
  const tea: ItemDetail = {
    id: 'i1', code: 'I-0001', barcode: '', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 2_000, saleCurrency: 'IQD',
    trackStock: true, active: true, qtyMilli: 20_000, value: 30_000, hasMoves: true, units: [], saleUnit: null, purchaseUnit: null, updatedAt: null,
    trackBatches: false, trackExpiry: false, categoryId: null, brandId: null, reorderMilli: null, purchasePrice: 1_400, purchaseCurrency: 'IQD',
    stock: [{ warehouseId: 'w1', warehouseCode: 'MAIN', warehouseName: { ar: 'الرئيسي', en: 'Main', ku: 'سەرەکی' }, qtyMilli: 20_000, value: 30_000 }],
    moves: []
  };
  const result: StockCorrectionResult = { document: { type: 'adjustment', id: 'a1', number: 'ADJ-2026-0001', status: 'posted' }, posted: true, diffMilli: 5_000, item: tea };
  const render = () => {
    fixture.cursor = 0;
    return flatten(StockCorrection({ item: tea, onClose: () => {}, onDone: (r) => { fixture.done.push(r); } }));
  };
  const counted = (nodes: Node[]) => nodes.find((n) => n.type === 'QtyInput')!;
  beforeEach(() => { fixture.data = { settings: { defaultRateX100: 142_000, postingAccounts: { cash: '1811' } } }; });

  it('is sent again unchanged with its key, while the fields stay locked, however the form was changed', async () => {
    vi.mocked(api.correctStock).mockRejectedValueOnce(new ApiError(0, 'network', null)).mockResolvedValueOnce(result);
    invoke(counted(render()).props.onChange, 25_000);
    expect(locked(render())).toBe(false);
    // pressed twice before the dialog has drawn "saving": one try
    const save = primary(render());
    invoke(save.props.onClick);
    invoke(save.props.onClick);
    await settle();
    expect(api.correctStock).toHaveBeenCalledTimes(1);
    const first = vi.mocked(api.correctStock).mock.calls[0]!;
    expect(first).toEqual(['i1', { warehouseId: 'w1', mode: 'set', qtyMilli: 25_000, reason: 'found', lang: 'en' }, { key: 'key-1' }]);
    // maybe made, maybe not: nothing can be changed, the note says why, and the button sends that correction again
    let nodes = render();
    expect(locked(nodes)).toBe(true);
    expect(nodes.some((n) => n.props.role === 'alert' && n.props.children === 'sc_unsure')).toBe(true);
    expect(words(primary(nodes))).toEqual(['sc_tryAgain']);
    // a change that got in anyway (the count) is not sent: the request held goes again, with its key
    invoke(counted(nodes).props.onChange, 30_000);
    invoke(primary(render()).props.onClick);
    await settle();
    expect(vi.mocked(api.correctStock).mock.calls).toEqual([first, first]);
    // the server answered (the first try's document, or this one's): done once, and nothing is held any more
    expect(fixture.done).toEqual([result]);
    expect(fixture.toasts).toEqual(['sc_done']);
    nodes = render();
    expect(locked(nodes)).toBe(false);
    expect(nodes.some((n) => n.props.children === 'sc_unsure')).toBe(false);
  });

  it('stays held while the server fails on its way, and lets go once it refuses: then a changed correction gets a new key', async () => {
    vi.mocked(api.correctStock)
      .mockRejectedValueOnce(new ApiError(503, 'database_unavailable', null))
      .mockRejectedValueOnce(new ApiError(400, 'validation', [{ code: 'correction_no_change' }]))
      .mockResolvedValueOnce(result);
    invoke(counted(render()).props.onChange, 25_000);
    invoke(primary(render()).props.onClick);
    await settle();
    expect(locked(render())).toBe(true);
    invoke(primary(render()).props.onClick);
    await settle();
    // refused: nothing was made, so the form is free again, its error shown
    let nodes = render();
    expect(locked(nodes)).toBe(false);
    expect(words(primary(nodes))).toEqual(['sc_save']);
    expect(nodes.find((n) => n.type === 'ErrorBox')!.props.error).toMatchObject({ status: 400 });
    invoke(counted(nodes).props.onChange, 26_000);
    invoke(primary(render()).props.onClick);
    await settle();
    expect(vi.mocked(api.correctStock).mock.calls.map((c) => [c[1].qtyMilli, c[2]!.key])).toEqual([[25_000, 'key-1'], [25_000, 'key-1'], [26_000, 'key-2']]);
    expect(fixture.done).toEqual([result]);
  });
});

describe("a scale label's weight from the new-item form (a market)", () => {
  const LABEL = '2100017012503'; // item 2100017, 1.250 kg
  const tomato = {
    id: 't1', code: 'I-0100', barcode: '2100017', name: { ar: 'طماطة', en: 'Tomatoes', ku: 'تەماتە' }, unit: 'kg', salePrice: 1_500, saleCurrency: 'IQD',
    trackStock: true, active: true, qtyMilli: 0, value: 0, units: [], trackBatches: false, trackExpiry: false, categoryId: null
  } as unknown as ItemView;
  const render = () => {
    fixture.cursor = 0;
    return flatten(QuickItemForm({ typed: LABEL, onDone: (item, qtyMilli) => { fixture.done.push([item.id, qtyMilli]); }, onClose: () => {} }));
  };
  beforeEach(() => { fixture.data = { settings: { businessTypes: ['market'], defaultRateX100: 142_000 }, seesCost: true }; });

  it('goes back to the page with the item made for the label', async () => {
    vi.mocked(api.items).mockResolvedValue([]);
    vi.mocked(api.createItem).mockResolvedValue(tomato);
    let nodes = render();
    // the form started from the label: its first seven digits, in kilograms
    expect(nodes.find((n) => n.type === 'input' && n.props.dir === 'ltr')!.props.value).toBe('2100017');
    invoke(nodes.find((n) => n.type === 'input' && n.props.autoFocus)!.props.onChange, { target: { value: 'Tomatoes' } });
    invoke(render().find((n) => n.type === 'AmountInput' && n.props.ariaLabel === 'salePrice')!.props.onChange, 1_500);
    invoke(primary(render()).props.onClick);
    await settle();
    expect(api.createItem).toHaveBeenCalledWith(expect.objectContaining({ barcode: '2100017', unit: 'kg' }), expect.anything());
    expect(fixture.done).toEqual([['t1', 1_250]]);
    nodes = render();
    expect(nodes.some((n) => n.type === 'ErrorBox' && n.props.error)).toBe(false);
  });

  it('goes back with the item already there that was chosen for it, and with none for an item that is not the label’s', async () => {
    const other = { ...tomato, id: 'o1', code: 'I-0101', barcode: '', unit: 'piece', name: { ar: 'Tomatoes', en: 'Tomatoes', ku: 'Tomatoes' } } as ItemView;
    vi.mocked(api.items).mockResolvedValue([tomato, other]);
    invoke(render().find((n) => n.type === 'input' && n.props.autoFocus)!.props.onChange, { target: { value: 'Tomatoes' } });
    invoke(render().find((n) => n.type === 'AmountInput' && n.props.ariaLabel === 'salePrice')!.props.onChange, 1_500);
    invoke(primary(render()).props.onClick);
    await settle();
    // the same barcode and the same name are there: "Use this one" on each
    const uses = render().filter((n) => n.type === 'button' && n.props.children === 'qa_useThis');
    expect(uses).toHaveLength(2);
    invoke(uses[0]!.props.onClick);
    invoke(uses[1]!.props.onClick);
    await settle();
    expect(api.createItem).not.toHaveBeenCalled();
    expect(fixture.done).toEqual([['t1', 1_250], ['o1', null]]);
  });
});

describe('the stock typed in the new-item form ("In stock now"), whose answer was lost', () => {
  const mango = {
    id: 'm1', code: 'I-0200', barcode: '', name: { ar: 'Mango juice', en: 'Mango juice', ku: 'Mango juice' }, unit: 'piece', salePrice: 2_000, saleCurrency: 'IQD',
    purchasePrice: 1_400, purchaseCurrency: 'IQD', trackStock: true, active: true, qtyMilli: 0, value: 0, units: [], trackBatches: false, trackExpiry: false, categoryId: null
  } as unknown as ItemView;
  const tea = { ...mango, id: 't1', code: 'I-0007', name: { ar: 'Tea', en: 'Tea', ku: 'Tea' } } as ItemView;
  const entered = (item: ItemView, qtyMilli: number): StockCorrectionResult => ({
    document: { type: 'stock_doc', id: 'd1', number: 'OPN-2026-0001', status: 'posted' }, posted: true, diffMilli: qtyMilli,
    item: { ...item, qtyMilli, value: qtyMilli * 2, stock: [], moves: [] } as unknown as ItemDetail
  });
  // a sale from warehouse w1: the form asks what is on the shelf now
  const render = (typed: string) => {
    fixture.cursor = 0;
    return flatten(QuickItemForm({ typed, sale: true, warehouseId: 'w1', onDone: (item, qtyMilli) => { fixture.done.push([item.id, item.qtyMilli, qtyMilli]); }, onClose: () => {} }));
  };
  /** Types a number into one of the form's boxes (a price, the stock on the shelf). */
  const enter = (typed: string, label: string, value: number) =>
    invoke(render(typed).find((n) => (n.type === 'AmountInput' || n.type === 'QtyInput') && n.props.ariaLabel === label)!.props.onChange, value);
  beforeEach(() => { fixture.data = { settings: { defaultRateX100: 142_000 }, seesCost: true }; });

  it('of a new item goes again unchanged with its key, while the stock, the prices and the rest stay locked', async () => {
    vi.mocked(api.items).mockResolvedValue([]);
    vi.mocked(api.createItem).mockResolvedValue(mango);
    vi.mocked(api.correctStock).mockRejectedValueOnce(new ApiError(0, 'network', null)).mockResolvedValueOnce(entered(mango, 12_000));
    enter('Mango juice', 'salePrice', 2_000);
    enter('Mango juice', 'it_purchasePrice', 1_400);
    enter('Mango juice', 'iq_stockNow', 12_000);
    expect(locked(render('Mango juice'))).toBe(false);
    invoke(primary(render('Mango juice')).props.onClick);
    await settle();
    expect(api.createItem).toHaveBeenCalledTimes(1);
    const first = vi.mocked(api.correctStock).mock.calls[0]!;
    expect(first).toEqual(['m1', { warehouseId: 'w1', mode: 'set', qtyMilli: 12_000, reason: 'opening', unitCost: 1_400, lang: 'en' }, { key: 'key-2' }]);
    // maybe entered, maybe not: nothing in the form can change, the note says why, and the button sends it again
    let nodes = render('Mango juice');
    expect(locked(nodes)).toBe(true);
    expect(nodes.some((n) => n.props.role === 'alert' && n.props.children === 'iq_stockUnsure')).toBe(true);
    expect(nodes.some((n) => n.props.children === 'iq_stockFailed')).toBe(false);
    expect(words(primary(nodes))).toEqual(['sc_tryAgain']);
    // a stock or a price that got in anyway is not sent: the entry held goes again with its key, once however often pressed
    enter('Mango juice', 'iq_stockNow', 15_000);
    enter('Mango juice', 'it_purchasePrice', 1_500);
    const again = primary(render('Mango juice'));
    invoke(again.props.onClick);
    invoke(again.props.onClick);
    await settle();
    expect(vi.mocked(api.correctStock).mock.calls).toEqual([first, first]);
    // entered once: the item goes on the line with its stock, made once
    expect(fixture.done).toEqual([['m1', 12_000, null]]);
    expect(api.createItem).toHaveBeenCalledTimes(1);
    nodes = render('Mango juice');
    expect(locked(nodes)).toBe(false);
    expect(nodes.some((n) => n.props.children === 'iq_stockUnsure')).toBe(false);
  });

  it('of an item already there stays held while the server fails on its way, and lets go once it refuses', async () => {
    vi.mocked(api.items).mockResolvedValue([tea]);
    vi.mocked(api.item).mockResolvedValue({ ...tea, stock: [{ warehouseId: 'w1', warehouseCode: 'MAIN', warehouseName: tea.name, qtyMilli: 5_000, value: 10_000 }], moves: [] } as unknown as ItemDetail);
    vi.mocked(api.correctStock)
      .mockRejectedValueOnce(new ApiError(503, 'database_unavailable', null))
      .mockRejectedValueOnce(new ApiError(400, 'validation', [{ code: 'period_locked' }]))
      .mockResolvedValueOnce(entered(tea, 13_000));
    enter('Tea', 'salePrice', 2_000);
    enter('Tea', 'it_purchasePrice', 1_400);
    enter('Tea', 'iq_stockNow', 12_000);
    invoke(primary(render('Tea')).props.onClick);
    await settle();
    // the same name is there: "Use this one" counts what was typed as on the shelf for it (5 there: a count to 12)
    const use = () => render('Tea').find((n) => n.type === 'button' && n.props.children === 'qa_useThis')!;
    invoke(use().props.onClick);
    await settle();
    const first = vi.mocked(api.correctStock).mock.calls[0]!;
    expect(first).toEqual(['t1', { warehouseId: 'w1', mode: 'set', qtyMilli: 12_000, reason: 'found', lang: 'en' }, { key: 'key-2' }]);
    // the server failed on its way: maybe entered, so the form (and "Use this one" in it) is locked
    expect(locked(render('Tea'))).toBe(true);
    invoke(primary(render('Tea')).props.onClick);
    await settle();
    expect(vi.mocked(api.correctStock).mock.calls).toEqual([first, first]);
    // refused: nothing was entered, and the form is free again, the server's reason shown
    const nodes = render('Tea');
    expect(locked(nodes)).toBe(false);
    expect(words(primary(nodes))).toEqual(['qa_add']);
    expect(nodes.find((n) => n.type === 'ErrorBox')!.props.error).toMatchObject({ status: 400 });
    // another stock now is another entry, with a key of its own
    enter('Tea', 'iq_stockNow', 13_000);
    invoke(primary(render('Tea')).props.onClick);
    await settle();
    invoke(use().props.onClick);
    await settle();
    const calls = vi.mocked(api.correctStock).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[2]![1]).toEqual({ warehouseId: 'w1', mode: 'set', qtyMilli: 13_000, reason: 'found', lang: 'en' });
    expect(calls[2]![2]!.key).not.toBe(first[2]!.key);
    expect(fixture.done).toEqual([['t1', 13_000, null]]);
    expect(api.createItem).not.toHaveBeenCalled();
  });
});
