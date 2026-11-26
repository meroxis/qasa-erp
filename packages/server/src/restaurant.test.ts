import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { rsEvenShares, rsLineAmount } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';

// Restaurants and cafés (2.1): the room's areas and tables, orders per table (or to take away, or to deliver), kitchen
// tickets, a line cancelled by a supervisor, moving and merging tables, and paying at the till's own sale, whole or in
// parts, behind the plan and the permissions.

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
async function menu() {
  const item = async (code: string, price: number, extra: object = {}) => {
    const made = await call('POST', '/api/items', { code, name: n(code), unit: 'piece', salePrice: price, saleCurrency: 'IQD', trackStock: false, ...extra });
    expect(made.statusCode, made.body).toBe(201);
    return made.json() as { id: string };
  };
  return { kebab: await item('KEBAB', 12_000), tea: await item('TEA', 1_000), cola: await item('COLA', 1_500) };
}
async function room() {
  const made = await call('POST', '/api/restaurant/room', { tables: 4, family: 2 });
  expect(made.statusCode, made.body).toBe(200);
  return made.json() as { areas: { id: string; family: boolean }[]; tables: { id: string; name: string; areaId: string }[] };
}
async function shift() {
  const made = await call('POST', '/api/pos/shifts', { register: 'Counter 1', cashAccountCode: '1811', warehouseId, openingCash: 50_000 });
  expect(made.statusCode, made.body).toBe(201);
  return made.json() as { id: string };
}
async function openAt(tableId: string, extra: object = {}) {
  const made = await call('POST', '/api/restaurant/orders', { kind: 'table', tableId, guests: 3, ...extra });
  expect(made.statusCode, made.body).toBe(201);
  return made.json() as { id: string; number: string };
}

describe('restaurant (core)', () => {
  it('shares a bill evenly to the dinar, and works out a line', () => {
    expect(rsEvenShares(10_000, 3)).toEqual([3_334, 3_333, 3_333]);
    expect(rsEvenShares(10_000, 3).reduce((s, x) => s + x, 0)).toBe(10_000);
    expect(rsEvenShares(0, 3)).toEqual([]);
    expect(rsEvenShares(5_000, 0)).toEqual([]);
    expect(rsLineAmount(1_500, 12_000)).toBe(18_000);
  });
});

describe('the room', () => {
  it('needs the plan to change anything, and reading stays open', async () => {
    expect((await call('POST', '/api/restaurant/room', { tables: 4, family: 0 })).json().error).toBe('plan_limit');
    expect((await call('GET', '/api/restaurant')).json()).toMatchObject({ available: false, areas: [], tables: [] });
    expect((await call('GET', '/api/restaurant/floor')).statusCode).toBe(200);
  });

  it('starts with a hall and a family section; tables are named once in an area', async () => {
    await trial();
    const r = await room();
    expect(r.areas.map((a) => a.family)).toEqual([false, true]);
    expect(r.tables.map((t) => t.name)).toEqual(['1', '2', '3', '4', 'F1', 'F2']);
    expect((await call('POST', '/api/restaurant/room', { tables: 2, family: 0 })).statusCode).toBe(409);
    const hall = r.areas[0]!.id;
    expect((await call('POST', '/api/restaurant/tables', { areaId: hall, name: '4' })).json().error).toBe('rs_table_name_taken');
    const terrace = await call('POST', '/api/restaurant/areas', { name: { ar: 'التراس', en: 'Terrace', ku: '' } });
    expect(terrace.statusCode, terrace.body).toBe(201);
    expect(terrace.json().name.ku).toBe('التراس');
    expect((await call('POST', '/api/restaurant/tables', { areaId: terrace.json().id, name: '4', seats: 6 })).statusCode).toBe(201);
    const floor = (await call('GET', '/api/restaurant/floor')).json();
    expect(floor.areas.map((a: { tables: unknown[] }) => a.tables.length)).toEqual([4, 2, 1]);
  });
});

describe('orders and the kitchen', () => {
  it('one open order a table; lines with notes go to the kitchen as numbered tickets, and change only before', async () => {
    await trial();
    const { tables } = await room();
    const { kebab, tea } = await menu();
    const order = await openAt(tables[0]!.id);
    const again = await call('POST', '/api/restaurant/orders', { kind: 'table', tableId: tables[0]!.id });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'rs_table_busy', details: { orderId: order.id } });

    let o = (await call('POST', `/api/restaurant/orders/${order.id}/lines`, { lines: [{ itemId: kebab.id, qtyMilli: 2_000, note: 'no onion' }, { itemId: tea.id, qtyMilli: 3_000 }] })).json();
    expect(o).toMatchObject({ total: 27_000, unpaid: 27_000, unsent: 2 });
    const sent = (await call('POST', `/api/restaurant/orders/${order.id}/send`)).json();
    expect(sent.tickets).toHaveLength(1);
    expect(sent.tickets[0]).toMatchObject({ ticket: 1, type: 'order', tableName: '1', guests: 3, station: 'kitchen' });
    expect(sent.tickets[0].lines.map((l: { code: string; qtyMilli: number; note: string | null }) => [l.code, l.qtyMilli, l.note])).toEqual([['KEBAB', 2_000, 'no onion'], ['TEA', 3_000, null]]);
    // nothing new: no ticket
    expect((await call('POST', `/api/restaurant/orders/${order.id}/send`)).json().tickets).toEqual([]);
    // a sent line is cooking: no change, no taking off
    const kebabLine = sent.order.lines[0].id;
    expect((await call('PUT', `/api/restaurant/orders/${order.id}/lines/${kebabLine}`, { qtyMilli: 1_000 })).json().error).toBe('rs_line_sent');
    expect((await call('DELETE', `/api/restaurant/orders/${order.id}/lines/${kebabLine}`)).json().error).toBe('rs_line_sent');
    // one more tea, changed and taken off freely before it is sent; then another, sent on ticket 2
    o = (await call('POST', `/api/restaurant/orders/${order.id}/lines`, { lines: [{ itemId: tea.id, qtyMilli: 1_000 }] })).json();
    const extra = o.lines[2].id;
    expect((await call('PUT', `/api/restaurant/orders/${order.id}/lines/${extra}`, { qtyMilli: 2_000, note: 'light' })).json().lines[2]).toMatchObject({ qtyMilli: 2_000, note: 'light' });
    expect((await call('DELETE', `/api/restaurant/orders/${order.id}/lines/${extra}`)).json().lines).toHaveLength(2);
    await call('POST', `/api/restaurant/orders/${order.id}/lines`, { lines: [{ itemId: tea.id, qtyMilli: 1_000 }] });
    const second = (await call('POST', `/api/restaurant/orders/${order.id}/send`)).json();
    expect(second.tickets[0]).toMatchObject({ ticket: 2 });
    expect(second.tickets[0].lines).toHaveLength(1);
    // the kitchen lost ticket 1: printed again as it was
    expect((await call('GET', `/api/restaurant/orders/${order.id}/ticket?n=1`)).json().tickets[0].lines).toHaveLength(2);
  });

  it('a line the kitchen has is cancelled by a supervisor only, with a reason, in part or whole; the kitchen gets a cancel ticket', async () => {
    await trial();
    const { tables } = await room();
    const { kebab } = await menu();
    const order = await openAt(tables[0]!.id);
    await call('POST', `/api/restaurant/orders/${order.id}/lines`, { lines: [{ itemId: kebab.id, qtyMilli: 3_000 }] });
    const line = (await call('POST', `/api/restaurant/orders/${order.id}/send`)).json().order.lines[0].id;
    expect((await call('POST', `/api/restaurant/orders/${order.id}/lines/${line}/void`, { reason: ' ' })).statusCode).toBe(400);
    const part = await call('POST', `/api/restaurant/orders/${order.id}/lines/${line}/void`, { reason: 'Guest changed their mind', qtyMilli: 1_000 });
    expect(part.statusCode, part.body).toBe(200);
    expect(part.json().ticket).toMatchObject({ type: 'cancel', ticket: 1, lines: [{ code: 'KEBAB', qtyMilli: 1_000, reason: 'Guest changed their mind' }] });
    expect(part.json().order).toMatchObject({ total: 24_000 });
    expect(part.json().order.lines.map((l: { qtyMilli: number; voided: unknown }) => [l.qtyMilli, !!l.voided])).toEqual([[2_000, false], [1_000, true]]);
    // a line not sent yet is just taken off, not cancelled
    const fresh = (await call('POST', `/api/restaurant/orders/${order.id}/lines`, { lines: [{ itemId: kebab.id, qtyMilli: 1_000 }] })).json().lines[2].id;
    expect((await call('POST', `/api/restaurant/orders/${order.id}/lines/${fresh}/void`, { reason: 'x' })).json().error).toBe('rs_line_not_sent');
  });

  it('moves to a free table, merges two tables into one, and cancels an order nobody pays for', async () => {
    await trial();
    const { tables } = await room();
    const { kebab, tea } = await menu();
    const a = await openAt(tables[0]!.id, { guests: 2 });
    const b = await openAt(tables[1]!.id, { guests: 3 });
    await call('POST', `/api/restaurant/orders/${a.id}/lines`, { lines: [{ itemId: kebab.id, qtyMilli: 1_000 }] });
    await call('POST', `/api/restaurant/orders/${a.id}/send`);
    await call('POST', `/api/restaurant/orders/${b.id}/lines`, { lines: [{ itemId: tea.id, qtyMilli: 2_000 }] });
    await call('POST', `/api/restaurant/orders/${b.id}/send`);
    expect((await call('POST', `/api/restaurant/orders/${a.id}/move`, { tableId: tables[1]!.id })).json().error).toBe('rs_table_busy');
    const moved = await call('POST', `/api/restaurant/orders/${a.id}/move`, { tableId: tables[2]!.id });
    expect(moved.json(), moved.body).toMatchObject({ tableName: '3' });
    const merged = (await call('POST', `/api/restaurant/orders/${a.id}/merge`, { intoId: b.id })).json();
    expect(merged).toMatchObject({ id: b.id, guests: 5, total: 14_000, tickets: 2 });
    expect(merged.lines.map((l: { code: string; ticket: number }) => [l.code, l.ticket])).toEqual([['TEA', 1], ['KEBAB', 2]]);
    expect((await call('GET', `/api/restaurant/orders/${a.id}`)).json()).toMatchObject({ status: 'cancelled', cancelReason: `merged:${b.number}` });
    // the kitchen has some of it: only a supervisor cancels it (the owner here is an admin)
    expect((await call('POST', `/api/restaurant/orders/${b.id}/cancel`, { reason: 'Left' })).json()).toMatchObject({ status: 'cancelled' });
    const floor = (await call('GET', '/api/restaurant/floor')).json();
    expect(floor.areas[0].tables.every((t: { order: unknown }) => t.order === null)).toBe(true);
  });
});

describe('paying at the till', () => {
  it('pays a part (each guest what they had), then the rest; the order closes, and the sales are the till\'s', async () => {
    await trial();
    const { tables } = await room();
    const { kebab, tea } = await menu();
    const s = await shift();
    const order = await openAt(tables[0]!.id);
    const o = (await call('POST', `/api/restaurant/orders/${order.id}/lines`, { lines: [{ itemId: kebab.id, qtyMilli: 2_000 }, { itemId: tea.id, qtyMilli: 2_000 }] })).json();
    await call('POST', `/api/restaurant/orders/${order.id}/send`);
    const [kebabLine, teaLine] = o.lines.map((l: { id: string }) => l.id);
    // one guest pays a kebab and a tea
    const first = await call('POST', `/api/restaurant/orders/${order.id}/pay`, { shiftId: s.id, lines: [{ lineId: kebabLine, qtyMilli: 1_000 }, { lineId: teaLine, qtyMilli: 1_000 }] });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().invoice).toMatchObject({ kind: 'sale', status: 'posted', total: 13_000, notes: `1 · #${order.number}` });
    expect(first.json().order).toMatchObject({ status: 'open', total: 26_000, paid: 13_000, unpaid: 13_000 });
    // more than is left of a line is refused
    expect((await call('POST', `/api/restaurant/orders/${order.id}/pay`, { shiftId: s.id, lines: [{ lineId: kebabLine, qtyMilli: 2_000 }] })).json().error).toBe('validation');
    // the rest: the order closes and the table is free
    const rest = (await call('POST', `/api/restaurant/orders/${order.id}/pay`, { shiftId: s.id })).json();
    expect(rest.invoice.total).toBe(13_000);
    expect(rest.order).toMatchObject({ status: 'closed', unpaid: 0, sales: [{ total: 13_000 }, { total: 13_000 }] });
    expect((await call('GET', '/api/restaurant/floor')).json().areas[0].tables[0].order).toBeNull();
    // the shift expects that cash; the sales are on its report
    expect((await call('GET', `/api/pos/shifts/${s.id}`)).json().expected.IQD).toBe(50_000 + 26_000);
    expect((await call('POST', `/api/restaurant/orders/${order.id}/pay`, { shiftId: s.id })).json().error).toBe('rs_order_closed');
  });

  it('a café\'s counter: takeaway, paid at once, its lines sent to the kitchen with the payment', async () => {
    await trial();
    const { tea, cola } = await menu();
    const s = await shift();
    const made = await call('POST', '/api/restaurant/orders', { kind: 'takeaway' });
    expect(made.statusCode, made.body).toBe(201);
    await call('POST', `/api/restaurant/orders/${made.json().id}/lines`, { lines: [{ itemId: tea.id, qtyMilli: 2_000 }, { itemId: cola.id, qtyMilli: 1_000 }] });
    const paid = (await call('POST', `/api/restaurant/orders/${made.json().id}/pay`, { shiftId: s.id, tendered: 5_000 })).json();
    expect(paid.tickets[0]).toMatchObject({ ticket: 1, kind: 'takeaway', tableName: null });
    expect(paid.order).toMatchObject({ status: 'closed', unsent: 0 });
    expect(paid.invoice.total).toBe(3_500);
    expect((await call('GET', '/api/restaurant/floor')).json().orders).toEqual([]);
  });

  it('a payment sent again with its key is the same sale; one that fails leaves the order as it was', async () => {
    await trial();
    const { tables } = await room();
    const { kebab } = await menu();
    const s = await shift();
    const order = await openAt(tables[0]!.id);
    await call('POST', `/api/restaurant/orders/${order.id}/lines`, { lines: [{ itemId: kebab.id, qtyMilli: 1_000 }] });
    // a payment that fails (more cards than the till takes): nothing is sent to the kitchen, nothing is paid
    const bad = await call('POST', `/api/restaurant/orders/${order.id}/pay`, { shiftId: s.id, payments: [{ method: 'cash', amount: 1 }] });
    expect(bad.statusCode).toBe(400);
    expect((await call('GET', `/api/restaurant/orders/${order.id}`)).json()).toMatchObject({ unsent: 1, unpaid: 12_000, tickets: 0 });
    const key = { ...owner, 'x-qasa-idempotency': '11111111-2222-4333-8444-555555555555' };
    const one = await call('POST', `/api/restaurant/orders/${order.id}/pay`, { shiftId: s.id }, key);
    const two = await call('POST', `/api/restaurant/orders/${order.id}/pay`, { shiftId: s.id }, key);
    expect(one.statusCode, one.body).toBe(200);
    expect(two.statusCode, two.body).toBe(200);
    expect(two.json().invoice.id).toBe(one.json().invoice.id);
    expect(Number((db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE kind = 'sale'").get() as { n: number }).n)).toBe(1);
  });

  it('a sale that paid it cancelled: the order is reopened by a supervisor to take the money again', async () => {
    await trial();
    const { tables } = await room();
    const { kebab } = await menu();
    const s = await shift();
    const order = await openAt(tables[0]!.id);
    await call('POST', `/api/restaurant/orders/${order.id}/lines`, { lines: [{ itemId: kebab.id, qtyMilli: 1_000 }] });
    const paid = (await call('POST', `/api/restaurant/orders/${order.id}/pay`, { shiftId: s.id })).json();
    expect((await call('POST', `/api/restaurant/orders/${order.id}/reopen`)).json().error).toBe('rs_order_paid');
    db.prepare("UPDATE invoices SET status = 'cancelled' WHERE id = ?").run(paid.invoice.id);
    const reopened = await call('POST', `/api/restaurant/orders/${order.id}/reopen`);
    expect(reopened.statusCode, reopened.body).toBe(200);
    expect(reopened.json()).toMatchObject({ status: 'open', unpaid: 12_000, sales: [{ status: 'cancelled' }] });
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

  it('a sales rep takes orders and sends them; only a cashier pays, only a supervisor cancels what is cooking, only an admin sets the room', async () => {
    await trial();
    const { tables } = await room();
    const { kebab } = await menu();
    const who = await people({ waiter: ['sales'], cashier: ['pos'], boss: ['pos', 'supervisor'], keeper: ['storekeeper'] });
    as = who.waiter!;
    expect((await call('POST', '/api/restaurant/tables', { areaId: tables[0]!.areaId, name: '9' })).statusCode).toBe(403);
    const order = await openAt(tables[0]!.id);
    await call('POST', `/api/restaurant/orders/${order.id}/lines`, { lines: [{ itemId: kebab.id, qtyMilli: 2_000 }] });
    const line = (await call('POST', `/api/restaurant/orders/${order.id}/send`)).json().order.lines[0].id;
    expect((await call('POST', `/api/restaurant/orders/${order.id}/lines/${line}/void`, { reason: 'x' })).statusCode).toBe(403);
    expect((await call('POST', `/api/restaurant/orders/${order.id}/cancel`, { reason: 'x' })).statusCode).toBe(403);
    expect((await call('POST', `/api/restaurant/orders/${order.id}/pay`, { shiftId: 'x' })).statusCode).toBe(403);
    // the waiter: the kitchen screen and "served", never the kitchen's settings or a recipe
    expect((await call('GET', '/api/restaurant/kitchen')).statusCode).toBe(200);
    expect((await call('POST', `/api/restaurant/orders/${order.id}/served`, {})).statusCode).toBe(200);
    expect((await call('PUT', '/api/restaurant/kitchen-settings', { tickets: 'screen', stations: [] })).statusCode).toBe(403);
    expect((await call('PUT', `/api/restaurant/recipes/${kebab.id}`, { parts: [] })).statusCode).toBe(403);
    // a storekeeper takes no orders and says nothing is ready (the screen is read as the floor is); a recipe is theirs
    as = who.keeper!;
    expect((await call('POST', '/api/restaurant/orders', { kind: 'takeaway' })).statusCode).toBe(403);
    expect((await call('GET', '/api/restaurant/kitchen')).statusCode).toBe(200);
    expect((await call('POST', `/api/restaurant/orders/${order.id}/ready`, { ticket: 1, station: 'kitchen', ready: true })).statusCode).toBe(403);
    expect((await call('PUT', `/api/restaurant/recipes/${kebab.id}`, { parts: [] })).statusCode).toBe(200);
    // the supervisor cancels a kebab; the cashier pays on their own shift
    as = who.boss!;
    expect((await call('POST', `/api/restaurant/orders/${order.id}/lines/${line}/void`, { reason: 'Burnt', qtyMilli: 1_000 })).statusCode).toBe(200);
    as = who.cashier!;
    const s = await shift();
    const paid = await call('POST', `/api/restaurant/orders/${order.id}/pay`, { shiftId: s.id });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json().order).toMatchObject({ status: 'closed', total: 12_000 });
  });
});

describe('stations, the kitchen screen, ready and served', () => {
  it('sends each category to its station, one ticket each, and the kitchen screen shows what cooks until it is ready', async () => {
    await trial();
    const m = await menu();
    const r = await room();
    const drinks = (await call('POST', '/api/item-categories', { name: n('Drinks') })).json() as { id: string };
    const juice = await call('POST', '/api/items', { code: 'JUICE', name: n('JUICE'), unit: 'piece', salePrice: 2_000, saleCurrency: 'IQD', trackStock: false, categoryId: drinks.id });
    expect(juice.statusCode, juice.body).toBe(201);
    // an admin's: drinks to the bar, tickets on the screen only
    const saved = await call('PUT', '/api/restaurant/kitchen-settings', { tickets: 'screen', stations: [{ categoryId: drinks.id, station: 'bar' }] });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await call('GET', '/api/restaurant')).json().kitchen).toEqual({ tickets: 'screen', stations: [{ categoryId: drinks.id, station: 'bar' }] });
    expect((await call('PUT', '/api/restaurant/kitchen-settings', { tickets: 'print', stations: [{ categoryId: 'nope', station: 'bar' }] })).json().error).toBe('validation');

    const order = await openAt(r.tables[0]!.id);
    await call('POST', `/api/restaurant/orders/${order.id}/lines`, { lines: [{ itemId: m.kebab.id, qtyMilli: 2_000 }, { itemId: juice.json().id, qtyMilli: 3_000 }] });
    const sent = (await call('POST', `/api/restaurant/orders/${order.id}/send`)).json();
    expect(sent.tickets.map((t: { station: string; lines: unknown[] }) => [t.station, t.lines.length])).toEqual([['kitchen', 1], ['bar', 1]]);
    // printed again: both stations' parts
    expect((await call('GET', `/api/restaurant/orders/${order.id}/ticket?n=1`)).json().tickets).toHaveLength(2);

    const bar = (await call('GET', '/api/restaurant/kitchen?station=bar')).json();
    expect(bar.tickets).toBe('screen');
    expect(bar.cooking.map((t: { station: string; lines: { code: string }[] }) => [t.station, t.lines.map((l) => l.code)])).toEqual([['bar', ['JUICE']]]);
    expect((await call('GET', '/api/restaurant/kitchen')).json().cooking).toHaveLength(2);
    expect((await call('GET', '/api/restaurant/kitchen?station=oven')).statusCode).toBe(400);

    // the bar says the tea is ready: off its screen into "done", and the table shows something to take
    expect((await call('POST', `/api/restaurant/orders/${order.id}/ready`, { ticket: 1, station: 'bar', ready: true })).statusCode).toBe(200);
    const after = (await call('GET', '/api/restaurant/kitchen?station=bar')).json();
    expect(after.cooking).toEqual([]);
    expect(after.done[0]).toMatchObject({ ticket: 1, station: 'bar' });
    const table = () => call('GET', '/api/restaurant/floor').then((f) => f.json().areas[0].tables[0].order);
    expect((await table()).ready).toBe(1);
    // pressed by mistake: back to cooking; then ready again, and the waiter takes it
    await call('POST', `/api/restaurant/orders/${order.id}/ready`, { ticket: 1, station: 'bar', ready: false });
    expect((await call('GET', '/api/restaurant/kitchen?station=bar')).json().cooking).toHaveLength(1);
    await call('POST', `/api/restaurant/orders/${order.id}/ready`, { ticket: 1, station: 'bar', ready: true });
    const served = await call('POST', `/api/restaurant/orders/${order.id}/served`, {});
    expect(served.statusCode, served.body).toBe(200);
    expect(served.json().lines.find((l: { code: string }) => l.code === 'JUICE').servedAt).not.toBeNull();
    expect((await table()).ready).toBe(0);
    // once served, "not ready" changes nothing
    await call('POST', `/api/restaurant/orders/${order.id}/ready`, { ticket: 1, station: 'bar', ready: false });
    expect((await call('GET', '/api/restaurant/kitchen?station=bar')).json().cooking).toEqual([]);
  });

  it('keeps a dish cancelled while it cooks on its ticket, crossed out, and never makes it ready', async () => {
    await trial();
    const m = await menu();
    const r = await room();
    const order = await openAt(r.tables[0]!.id);
    await call('POST', `/api/restaurant/orders/${order.id}/lines`, { lines: [{ itemId: m.kebab.id, qtyMilli: 2_000 }] });
    await call('POST', `/api/restaurant/orders/${order.id}/send`);
    const line = (await call('GET', `/api/restaurant/orders/${order.id}`)).json().lines[0];
    await call('POST', `/api/restaurant/orders/${order.id}/lines/${line.id}/void`, { reason: 'Changed', qtyMilli: 1_000 });
    const cooking = (await call('GET', '/api/restaurant/kitchen')).json().cooking;
    expect(cooking[0].lines.map((l: { qtyMilli: number; voided: boolean }) => [l.qtyMilli, l.voided])).toEqual([[1_000, false], [1_000, true]]);
    // ready: the cancelled part stays cancelled, never "ready"
    await call('POST', `/api/restaurant/orders/${order.id}/ready`, { ticket: 1, station: 'kitchen', ready: true });
    expect((await call('GET', `/api/restaurant/orders/${order.id}`)).json().lines.map((l: { readyAt: string | null }) => l.readyAt !== null)).toEqual([true, false]);
  });
});

describe('recipes', () => {
  async function stockItem(code: string, unit: string, qtyMilli: number, unitCost: number) {
    const made = await call('POST', '/api/items', { code, name: n(code), unit, salePrice: 0, saleCurrency: 'IQD', trackStock: true });
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json().id as string;
    const doc = await call('POST', '/api/stock-docs', { kind: 'opening', date: new Date().toISOString().slice(0, 10), warehouseId, counterAccountCode: '21', lines: [{ itemId: id, qtyMilli, unitCost }] });
    expect(doc.statusCode, doc.body).toBe(201);
    expect((await call('POST', `/api/stock-docs/${doc.json().id}/post`)).statusCode).toBe(200);
    return id;
  }
  const stockOf = (id: string) => (db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q, COALESCE(SUM(value), 0) AS v FROM stock_moves WHERE item_id = ?').get(id) as { q: number; v: number });

  it('takes a dish\'s ingredients out of stock when it is sold, at their cost, and gives them back when the sale is cancelled', async () => {
    await trial();
    const m = await menu();
    const meat = await stockItem('MEAT', 'kg', 10_000, 20_000);
    const bread = await stockItem('BREAD', 'piece', 100_000, 250);
    // refused: a dish that keeps stock, itself as an ingredient, an untracked ingredient, twice the same
    expect((await call('PUT', `/api/restaurant/recipes/${meat}`, { parts: [{ ingredientId: bread, qtyMilli: 1_000 }] })).json().details[0].code).toBe('recipe_item_keeps_stock');
    const bad = await call('PUT', `/api/restaurant/recipes/${m.kebab.id}`, { parts: [{ ingredientId: m.kebab.id, qtyMilli: 1 }, { ingredientId: m.tea.id, qtyMilli: 1 }, { ingredientId: meat, qtyMilli: 1 }, { ingredientId: meat, qtyMilli: 2 }] });
    expect(bad.json().details.map((d: { code: string }) => d.code)).toEqual(['recipe_self', 'recipe_ingredient_no_stock', 'recipe_duplicate']);
    // a kebab plate: 250 g of meat and 2 breads
    const saved = await call('PUT', `/api/restaurant/recipes/${m.kebab.id}`, { parts: [{ ingredientId: meat, qtyMilli: 250 }, { ingredientId: bread, qtyMilli: 2_000 }] });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().recipe).toMatchObject({ itemId: m.kebab.id, cost: 5_000 + 500 });
    expect((await call('GET', '/api/restaurant/recipes')).json()).toHaveLength(1);

    // three plates sold at the till: 750 g of meat and 6 breads come out, and the plates cost what went into them
    const sh = await shift();
    const sale = await call('POST', `/api/pos/shifts/${sh.id}/sales`, { lines: [{ itemId: m.kebab.id, qtyMilli: 3_000, unitPrice: 12_000 }], payment: 'cash', currency: 'IQD' });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(stockOf(meat)).toEqual({ q: 9_250, v: 185_000 });
    expect(stockOf(bread)).toEqual({ q: 94_000, v: 23_500 });
    const invoiceId = sale.json().invoice.id as string;
    expect((db.prepare('SELECT cost FROM invoice_lines WHERE invoice_id = ?').get(invoiceId) as { cost: number }).cost).toBe(16_500);

    // cancelled: both come back at what they took
    const cancelled = await call('POST', `/api/invoices/${invoiceId}/cancel`, {});
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(stockOf(meat)).toEqual({ q: 10_000, v: 200_000 });
    expect(stockOf(bread)).toEqual({ q: 100_000, v: 25_000 });
    // an ingredient can't be deleted while a recipe takes it
    expect((await call('DELETE', `/api/items/${bread}`)).json().error).toBe('item_has_moves');
  });

  it('never stops a sale for an ingredient the count is behind on: what there is comes out, never below none', async () => {
    await trial();
    const m = await menu();
    const rice = await stockItem('RICE', 'kg', 1_000, 3_000);
    await call('PUT', `/api/restaurant/recipes/${m.kebab.id}`, { parts: [{ ingredientId: rice, qtyMilli: 400 }] });
    const sh = await shift();
    const sale = await call('POST', `/api/pos/shifts/${sh.id}/sales`, { lines: [{ itemId: m.kebab.id, qtyMilli: 4_000, unitPrice: 12_000 }], payment: 'cash', currency: 'IQD' });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(stockOf(rice)).toEqual({ q: 0, v: 0 });
    expect((db.prepare('SELECT cost FROM invoice_lines WHERE invoice_id = ?').get(sale.json().invoice.id) as { cost: number }).cost).toBe(3_000);
    // a recipe taken away: the dish sells with no cost again
    expect((await call('PUT', `/api/restaurant/recipes/${m.kebab.id}`, { parts: [] })).json().recipe).toBeNull();
  });
});
