import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { internalBarcode, sellThroughBp, variantCode, variantNames } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';

// Clothing and shoes (2.0): colours, models whose sizes and colours are real items, the stock grid, grid lines for a
// purchase or a sale, an exchange at the till (a return from the drawer and a new sale in one go), the reports, behind
// the plan and the permissions.

let db: Db;
let app: FastifyInstance;
type H = Record<string, string>;
const owner: H = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
let as: H = owner;
let warehouseId = '';
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, h: H = as) =>
  app.inject({ method, url, headers: h, ...(body === undefined ? {} : { payload: body as object }) });
const n = (en: string) => ({ ar: en, en, ku: en });

beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  as = owner;
  warehouseId = (await call('GET', '/api/warehouses')).json()[0].id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function trial() {
  expect((await call('POST', '/api/plan/trial', {})).statusCode).toBe(200);
}
async function colors() {
  const black = await call('POST', '/api/clothing/colors', { code: 'blk', name: { ar: 'أسود', en: 'Black', ku: 'ڕەش' }, hex: '#000000', sort: 1 });
  expect(black.statusCode, black.body).toBe(201);
  const white = await call('POST', '/api/clothing/colors', { code: 'WHT', name: { ar: 'أبيض', en: 'White', ku: 'سپی' }, sort: 2 });
  return { black: black.json(), white: white.json() };
}
async function polo(extra: object = {}) {
  const { black, white } = await colors();
  const made = await call('POST', '/api/clothing/models', {
    code: 'POLO', name: { ar: 'قميص بولو', en: 'Polo shirt', ku: 'کراسی پۆلۆ' }, sizes: ['s', 'M', 'L', 'XL'], colorIds: [white.id, black.id],
    season: 'Summer 2026', salePrice: 25_000, saleCurrency: 'IQD', purchasePrice: 12_000, sizePrices: { XL: 28_000 }, ...extra
  });
  expect(made.statusCode, made.body).toBe(201);
  return { model: made.json(), black, white };
}

describe('clothing models (core)', () => {
  it('makes codes, names, barcodes and sell-through the one way', () => {
    expect(variantCode('POLO', 'XL', 'BLK')).toBe('POLO-XL-BLK');
    expect(variantCode('SHOE', '42.5', null)).toBe('SHOE-42-5');
    expect(variantNames(n('Polo'), 'M', { ar: 'أسود', en: 'Black', ku: 'ڕەش' }).ar).toBe('Polo · M · أسود');
    const code = internalBarcode(7);
    expect(code).toMatch(/^04\d{11}$/);
    expect(code).toBe('0400000000077');
    expect(sellThroughBp(3_000, 1_000)).toBe(7_500);
    expect(sellThroughBp(0, 0)).toBeNull();
  });
});

describe('clothing models', () => {
  it('needs the plan to change anything, and reading stays open', async () => {
    expect((await call('POST', '/api/clothing/colors', { code: 'R', name: n('Red') })).json().error).toBe('plan_limit');
    expect((await call('GET', '/api/clothing')).json()).toMatchObject({ available: false, colors: [] });
  });

  it('makes a model as a grid of real items: codes, names, barcodes of the shop\'s own, a size\'s own price', async () => {
    await trial();
    const { model, black, white } = await polo();
    expect(model).toMatchObject({ code: 'POLO', sizes: ['S', 'M', 'L', 'XL'], colorIds: [black.id, white.id], variantCount: 8, season: 'Summer 2026' });
    // sizes in the model's order, colours in the shop's (black sorts first)
    expect(model.variants.map((v: { code: string }) => v.code)).toEqual(['POLO-S-BLK', 'POLO-S-WHT', 'POLO-M-BLK', 'POLO-M-WHT', 'POLO-L-BLK', 'POLO-L-WHT', 'POLO-XL-BLK', 'POLO-XL-WHT']);
    expect(model.variants.find((v: { code: string }) => v.code === 'POLO-XL-BLK').salePrice).toBe(28_000);
    expect(model.variants.find((v: { code: string }) => v.code === 'POLO-M-BLK').salePrice).toBe(25_000);
    for (const v of model.variants) expect(v.barcode).toMatch(/^04\d{11}$/);
    expect(new Set(model.variants.map((v: { barcode: string }) => v.barcode)).size).toBe(8);
    // each one an item of its own, found by its barcode as any item
    const item = (await call('GET', `/api/items/${model.variants[0].itemId}`)).json();
    expect(item).toMatchObject({ code: 'POLO-S-BLK', name: { en: 'Polo shirt · S · Black' }, salePrice: 25_000 });
    // the same code twice is refused
    expect((await call('POST', '/api/clothing/models', { code: 'POLO', name: n('Again'), sizes: ['M'], colorIds: [], salePrice: 1, saleCurrency: 'IQD' })).json().error).toBe('cl_model_code_taken');
    // a colour code is upper case and short; one already taken is refused
    expect((await call('POST', '/api/clothing/colors', { code: 'blk', name: n('Black 2') })).json().error).toBe('cl_color_code_taken');
    expect((await call('POST', '/api/clothing/colors', { code: 'BL K', name: n('x') })).statusCode).toBe(400);
  });

  it('grows the grid, and a new price follows to every variant (a size\'s own price still wins)', async () => {
    await trial();
    const { model } = await polo();
    const red = (await call('POST', '/api/clothing/colors', { code: 'RED', name: n('Red'), sort: 3 })).json();
    const grown = await call('PUT', `/api/clothing/models/${model.id}`, { addSizes: ['XXL'], addColorIds: [red.id], salePrice: 27_000, sizePrices: { XXL: 30_000 } });
    expect(grown.statusCode, grown.body).toBe(200);
    const m = grown.json();
    expect(m.sizes).toEqual(['S', 'M', 'L', 'XL', 'XXL']);
    expect(m.variantCount).toBe(15);
    expect(m.variants.find((v: { code: string }) => v.code === 'POLO-XXL-RED').salePrice).toBe(30_000);
    expect(m.variants.find((v: { code: string }) => v.code === 'POLO-XL-BLK').salePrice).toBe(27_000);
    // a colour in use keeps its code
    expect((await call('PUT', `/api/clothing/colors/${red.id}`, { code: 'RD', name: n('Red') })).json().error).toBe('cl_color_in_use');
  });

  it('turns a grid into lines, buys them, shows stock as the grid, and refuses a cell the model does not have', async () => {
    await trial();
    const { model, black, white } = await polo();
    const supplier = (await call('POST', '/api/parties', { type: 'supplier', name: 'Bazaar', accountCode: '2611' })).json();
    const grid = await call('POST', `/api/clothing/models/${model.id}/lines`, {
      kind: 'purchase', cells: [{ size: 'm', colorId: black.id, qtyMilli: 5_000 }, { size: 'L', colorId: white.id, qtyMilli: 3_000 }, { size: 'S', colorId: black.id, qtyMilli: 0 }]
    });
    expect(grid.statusCode, grid.body).toBe(200);
    const lines = grid.json().lines as { itemId: string; qtyMilli: number; unitPrice: number; code: string }[];
    expect(lines.map((l) => [l.code, l.qtyMilli, l.unitPrice])).toEqual([['POLO-M-BLK', 5_000, 12_000], ['POLO-L-WHT', 3_000, 12_000]]);
    expect((await call('POST', `/api/clothing/models/${model.id}/lines`, { kind: 'sale', cells: [{ size: 'XXS', colorId: black.id, qtyMilli: 1_000 }] })).statusCode).toBe(400);
    const inv = await call('POST', '/api/invoices', {
      kind: 'purchase', date: '2026-11-01', partyId: supplier.id, warehouseId, currency: 'IQD', rateX100: 100, payment: 'credit', discount: 0,
      lines: lines.map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice }))
    });
    expect(inv.statusCode, inv.body).toBe(201);
    expect((await call('POST', `/api/invoices/${inv.json().id}/post`)).statusCode).toBe(200);
    const after = (await call('GET', `/api/clothing/models/${model.id}`)).json();
    expect(after.onHandMilli).toBe(8_000);
    const mBlk = after.variants.find((v: { code: string }) => v.code === 'POLO-M-BLK');
    expect(mBlk.onHandMilli).toBe(5_000);
    expect(after.stock).toEqual([{ warehouseId, byItem: { [mBlk.itemId]: 5_000, [lines[1]!.itemId]: 3_000 } }]);
    // the purchase's variants, for labels in one go
    expect((await call('GET', `/api/clothing/invoices/${inv.json().id}/variants`)).json().lines).toEqual([{ itemId: mBlk.itemId, qtyMilli: 5_000 }, { itemId: lines[1]!.itemId, qtyMilli: 3_000 }]);
    // a model whose goods were bought can't be deleted (it is switched off instead)
    expect((await call('DELETE', `/api/clothing/models/${model.id}`)).json().error).toBe('item_has_moves');
    expect((await call('PUT', `/api/clothing/models/${model.id}`, { active: false })).json().active).toBe(false);
    // one with nothing done goes, with its items
    const plain = (await call('POST', '/api/clothing/models', { name: n('Scarf'), sizes: ['ONE'], colorIds: [], salePrice: 5_000, saleCurrency: 'IQD', barcodes: false })).json();
    expect(plain.variants[0]).toMatchObject({ code: `${plain.code}-ONE`, barcode: null, colorId: null });
    expect((await call('DELETE', `/api/clothing/models/${plain.id}`)).statusCode).toBe(204);
    expect((await call('GET', `/api/items/${plain.variants[0].itemId}`)).statusCode).toBe(404);
  });

  it('exchanges at the till: the size brought back is returned to the drawer and the new one sold, the drawer gives the difference', async () => {
    await trial();
    const { model, black } = await polo();
    const v = (code: string) => model.variants.find((x: { code: string }) => x.code === code);
    // opening stock of the shirts
    const doc = await call('POST', '/api/stock-docs', {
      kind: 'opening', date: '2026-01-01', warehouseId, counterAccountCode: '21',
      lines: [{ itemId: v('POLO-M-BLK').itemId, qtyMilli: 3_000, unitCost: 12_000 }, { itemId: v('POLO-XL-BLK').itemId, qtyMilli: 3_000, unitCost: 12_000 }]
    });
    expect((await call('POST', `/api/stock-docs/${doc.json().id}/post`)).statusCode).toBe(200);
    const shift = (await call('POST', '/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId, openingCash: 100_000 })).json();
    const sold = await call('POST', `/api/pos/shifts/${shift.id}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: v('POLO-M-BLK').itemId, qtyMilli: 1_000, unitPrice: 25_000 }] });
    expect(sold.statusCode, sold.body).toBe(201);
    const sale = sold.json().invoice;
    // M is too small: XL instead (28,000), 3,000 more to pay
    const ex = await call('POST', `/api/clothing/shifts/${shift.id}/exchange`, {
      invoiceId: sale.id, back: [{ lineNo: 1, qtyMilli: 1_000 }],
      sale: { discount: 0, lines: [{ itemId: v('POLO-XL-BLK').itemId, qtyMilli: 1_000, unitPrice: 28_000 }] }
    });
    expect(ex.statusCode, ex.body).toBe(201);
    expect(ex.json().difference).toBe(3_000);
    const after = (await call('GET', `/api/pos/shifts/${shift.id}`)).json();
    // opening 100,000 + 25,000 + 28,000 − 25,000 refunded
    expect(after.expected.IQD).toBe(128_000);
    const m = (await call('GET', `/api/clothing/models/${model.id}`)).json();
    expect(m.variants.find((x: { code: string }) => x.code === 'POLO-M-BLK').onHandMilli).toBe(3_000);
    expect(m.variants.find((x: { code: string }) => x.code === 'POLO-XL-BLK').onHandMilli).toBe(2_000);
    // the report: by model, size and colour, with sell-through
    const rep = (await call('GET', '/api/clothing/reports?from=2026-01-01&to=2099-12-31')).json();
    expect(rep.models[0]).toMatchObject({ code: 'POLO', soldMilli: 1_000, sales: 28_000, onHandMilli: 5_000 });
    expect(rep.models[0].sellThroughBp).toBe(1_667);
    expect(rep.sizes.map((s: { size: string; soldMilli: number }) => [s.size, s.soldMilli])).toEqual([['XL', 1_000], ['M', 0]]);
    expect(rep.colors[0]).toMatchObject({ colorId: black.id, soldMilli: 1_000 });
    // a sale that is not a till sale can't be exchanged at the till
    expect((await call('POST', `/api/clothing/shifts/${shift.id}/exchange`, { invoiceId: ex.json().returnId, back: [{ lineNo: 1, qtyMilli: 1_000 }] })).statusCode).toBe(409);
  });
});

describe('who may do what', () => {
  async function people(roles: Record<string, string[]>): Promise<Record<string, H>> {
    const ownerUser = (await call('GET', '/api/users')).json()[0];
    expect((await call('POST', `/api/users/${ownerUser.id}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
    for (const [username, r] of Object.entries(roles)) {
      const made = await call('POST', '/api/users', { username, name: username, password: `${username}-pass-123`, roles: r });
      expect(made.statusCode, made.body).toBe(201);
    }
    expect((await call('PUT', '/api/auth/signin', { on: true })).statusCode).toBe(200);
    const login = async (username: string, password: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password }, headers: { 'x-qasa-client': '1' } });
      expect(res.statusCode, res.body).toBe(200);
      return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    };
    const out: Record<string, H> = { admin: await login(ownerUser.username, 'admin-pass-123') };
    for (const username of Object.keys(roles)) out[username] = await login(username, `${username}-pass-123`);
    return out;
  }

  it('a cashier reads models and sale lines but makes no model and sees no purchase price', async () => {
    await trial();
    const { model, black } = await polo();
    const p = await people({ cash: ['pos'], store: ['storekeeper'] });
    const read = (await call('GET', `/api/clothing/models/${model.id}`, undefined, p.cash!)).json();
    expect(read.variantCount).toBe(8);
    expect(read).not.toHaveProperty('purchasePrice');
    expect((await call('POST', '/api/clothing/models', { name: n('X'), sizes: ['M'], colorIds: [], salePrice: 1, saleCurrency: 'IQD' }, p.cash!)).statusCode).toBe(403);
    expect((await call('POST', `/api/clothing/models/${model.id}/lines`, { kind: 'sale', cells: [{ size: 'M', colorId: black.id, qtyMilli: 1_000 }] }, p.cash!)).statusCode).toBe(200);
    expect((await call('POST', `/api/clothing/models/${model.id}/lines`, { kind: 'purchase', cells: [{ size: 'M', colorId: black.id, qtyMilli: 1_000 }] }, p.cash!)).statusCode).toBe(403);
    // a storekeeper makes models
    expect((await call('POST', '/api/clothing/models', { name: n('Cap'), sizes: ['ONE'], colorIds: [], salePrice: 1_000, saleCurrency: 'IQD' }, p.store!)).statusCode).toBe(201);
  });
});
