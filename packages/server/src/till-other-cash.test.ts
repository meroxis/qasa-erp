import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { getShift } from './pos.ts';
import { resetDisplayTries } from './till-rules.ts';

// Before 2.0: cash that goes into or out of a till's safe beside its own sales. A supplier or an expense paid out of
// the drawer, a customer's debt collected into it, cash carried to another safe: the shift expects that money too
// ("other cash in" / "other cash out", with the documents behind it), so the drawer does not close short or over for
// it. What a shift expects is its opening cash plus what the ledger moved on its safe while it was open.

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let teaId: string;
let supplierId: string;
let clock: number;

const owner = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
type H = Record<string, string>;
/** every request a second after the last, as at a till */
const tick = () => { clock += 1_000; vi.setSystemTime(clock); };
const post = (url: string, body: unknown, h: H = owner) => { tick(); return app.inject({ method: 'POST', url, payload: body as object, headers: h }); };
const put = (url: string, body: unknown, h: H = owner) => { tick(); return app.inject({ method: 'PUT', url, payload: body as object, headers: h }); };
const get = (url: string, h: H = owner) => { tick(); return app.inject({ url, headers: h }); };
const ok = async (res: ReturnType<typeof post>) => { const r = await res; expect(r.statusCode, r.body).toBeLessThan(300); return r.json(); };
const TODAY = () => todayIso(new Date(clock));
const RATE = 142_000;

const ledger = (safe: string, currency: 'IQD' | 'USD'): number => Number((db.prepare(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM entry_lines l JOIN entries e ON e.id = l.entry_id
  WHERE l.account_code = ? AND e.currency = ? AND e.status = 'approved'`).get(safe, currency) as { v: number }).v);

beforeEach(async () => {
  resetLoginThrottle();
  resetDisplayTries();
  const start = new Date(); start.setHours(9, 0, 0, 0);
  clock = start.getTime();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
  db = openDatabase(':memory:');
  app = buildApp(db);
  await ok(post('/api/plan/trial', {}));
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  teaId = (await ok(post('/api/items', { code: 'TEA', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 2_750, saleCurrency: 'IQD' }))).id;
  const doc = await ok(post('/api/stock-docs', { kind: 'opening', date: '2026-01-01', warehouseId, counterAccountCode: '21', lines: [{ itemId: teaId, qtyMilli: 1_000_000, unitCost: 1_500 }] }));
  await ok(post(`/api/stock-docs/${doc.id}/post`, {}));
  await ok(post('/api/accounts', { parentCode: '181', code: '1812', name: { ar: 'قاصة ثانية', en: 'Second safe', ku: 'قاسەی دووەم' } }));
  supplierId = (await ok(post('/api/parties', { type: 'supplier', name: 'Las' }))).id;
});

afterEach(async () => {
  await app.close();
  db.close();
  vi.useRealTimers();
});

const openShift = async (h: H = owner, register = 'C1', safe = '1811', openingCash = 100_000) =>
  (await ok(post('/api/pos/shifts', { register, cashAccountCode: safe, warehouseId, openingCash }, h))) as { id: string };
const sell = (shiftId: string, h: H = owner) => ok(post(`/api/pos/shifts/${shiftId}/sales`, { currency: 'IQD', discount: 0, lines: [{ itemId: teaId, qtyMilli: 1000, unitPrice: 2_750 }] }, h));
/** a purchase paid in cash out of a safe, posted */
async function purchase(amount: number, safe = '1811', h: H = owner): Promise<{ id: string }> {
  const draft = await ok(post('/api/invoices', {
    kind: 'purchase', date: TODAY(), partyId: supplierId, warehouseId, currency: 'IQD', rateX100: 100, payment: 'cash', cashAccountCode: safe, discount: 0,
    lines: [{ itemId: teaId, qtyMilli: 10_000, unitPrice: amount / 10 }]
  }, h));
  await ok(post(`/api/invoices/${draft.id}/post`, {}, h));
  return draft;
}
const voucherBody = (kind: 'receipt' | 'payment', amount: number, extra: object = {}) => ({
  kind, date: TODAY(), cashAccountCode: '1811', description: kind === 'payment' ? 'Shop rent' : 'Debt collected', currency: 'IQD', rateX100: 100,
  items: [{ accountCode: kind === 'payment' ? '33' : '42', amount }], ...extra
});
/** a voucher as its preparer leaves it (a draft) */
const draftVoucher = async (kind: 'receipt' | 'payment', amount: number, extra: object = {}, h: H = owner) => (await ok(post('/api/vouchers', voucherBody(kind, amount, extra), h))) as { id: string; status: string };
/** checked and approved: posted */
async function approve(id: string, h: H = owner): Promise<void> {
  await ok(post(`/api/entries/${id}/check`, {}, h));
  await ok(post(`/api/entries/${id}/approve`, {}, h));
}
const moved = (shiftId: string) => {
  const s = getShift(db, shiftId);
  return { IQD: s.expected.IQD - s.openingCash + s.usdTaken.iqd, USD: s.expected.USD - s.usdTaken.usd };
};

/** Sign-in on, with these people (password `<username>-pass-123`); the owner is "admin". */
async function signIn(people: Record<string, string[]>): Promise<Record<string, H>> {
  const ownerId = (await get('/api/users')).json()[0].id;
  await ok(post(`/api/users/${ownerId}/password`, { password: 'admin-pass-123' }));
  for (const [username, roles] of Object.entries(people)) {
    await ok(post('/api/users', { username, name: username[0]!.toUpperCase() + username.slice(1), password: `${username}-pass-123`, roles }));
  }
  await ok(put('/api/auth/signin', { on: true }));
  const out: Record<string, H> = {};
  for (const username of ['admin', ...Object.keys(people)]) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: `${username}-pass-123` }, headers: { 'x-qasa-client': '1' } });
    expect(res.statusCode, res.body).toBe(200);
    out[username] = { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
  }
  return out;
}

describe('cash paid out of and into a till\'s safe beside its sales', () => {
  it('a supplier and an expense paid out of the drawer are expected out of it, a debt collected into it', async () => {
    const shift = await openShift();
    await sell(shift.id);
    const bought = await purchase(30_000);
    const expense = await ok(post('/api/expenses', { category: 'fuel', amount: 5_000, currency: 'IQD', cashAccountCode: '1811', date: TODAY(), note: 'Generator diesel', lang: 'en' }));
    // a draft is no money yet
    expect(getShift(db, shift.id).expected.IQD).toBe(100_000 + 2_750 - 30_000);
    await approve(expense.id);
    const receipt = await draftVoucher('receipt', 12_000);
    await approve(receipt.id);
    const dollars = await draftVoucher('payment', 2_000, { currency: 'USD', rateX100: RATE, description: 'Paid in dollars' });
    await approve(dollars.id);
    // cash carried to the second safe
    const carried = await ok(post('/api/banking/transfers', { date: TODAY(), from: '1811', to: '1812', currency: 'IQD', amount: 10_000, lang: 'en' }));
    await approve(carried.id);

    const view = getShift(db, shift.id);
    expect(view.expected).toEqual({ IQD: 100_000 + 2_750 - 30_000 - 5_000 + 12_000 - 10_000, USD: -2_000 });
    expect(view.cashMoves.in).toEqual({ IQD: 12_000, USD: 0 });
    expect(view.cashMoves.out).toEqual({ IQD: 45_000, USD: 2_000 });
    expect(view.cashMoves.count).toBe(5);
    expect(view.cashMoves.lines.map((l) => [l.type, l.currency, l.amount, l.by])).toEqual([
      ['purchase', 'IQD', -30_000, 'Mer'], ['payment', 'IQD', -5_000, 'Mer'], ['receipt', 'IQD', 12_000, 'Mer'], ['payment', 'USD', -2_000, 'Mer'], ['journal', 'IQD', -10_000, 'Mer']
    ]);
    expect(view.cashMoves.lines.every((l) => !!l.number && !!l.at && !!l.entryId)).toBe(true);
    expect(view.cashMoves.lines[1]!.description).toBe('Generator diesel');
    // what the shift expects beyond its opening cash is what the ledger moved on its safe
    expect(moved(shift.id)).toEqual({ IQD: ledger('1811', 'IQD'), USD: ledger('1811', 'USD') });
    // the till's own sales are not "other cash"
    expect(view.sales.IQD).toBe(2_750);

    // the purchase cancelled and the rent reversed: the money is back in the drawer, as two more lines
    await ok(post(`/api/invoices/${bought.id}/cancel`, {}));
    await ok(post(`/api/entries/${expense.id}/reverse`, {}));
    const after = getShift(db, shift.id);
    expect(after.expected.IQD).toBe(100_000 + 2_750 + 12_000 - 10_000);
    expect(after.cashMoves.in.IQD).toBe(12_000 + 30_000 + 5_000);
    expect(after.cashMoves.lines.slice(-2).map((l) => [l.type, l.amount])).toEqual([['reversal', 30_000], ['reversal', 5_000]]);
    expect(moved(shift.id)).toEqual({ IQD: ledger('1811', 'IQD'), USD: ledger('1811', 'USD') });

    // a list has an open shift's other cash
    expect((await ok(get('/api/pos/shifts')))[0].cashMoves.count).toBe(7);

    // closed: what was expected stays, with its lines on the Z report
    const closed = await ok(post(`/api/pos/shifts/${shift.id}/close`, { countedCash: after.expected.IQD, countedUsd: 0 }));
    expect(closed.difference).toEqual({ IQD: 0, USD: 2_000 });
    const report = await ok(get(`/api/pos/shifts/${shift.id}`));
    expect(report.cashMoves.count).toBe(7);
    expect(report.cashMoves.out).toEqual({ IQD: 45_000, USD: 2_000 });
    // a list leaves a closed shift's documents out (the shift itself has them); what it expected is the same
    const listed = (await ok(get('/api/pos/shifts')))[0];
    expect(listed.cashMoves).toBeUndefined();
    expect(listed.expected).toEqual(report.expected);
    expect(listed.difference).toEqual({ IQD: 0, USD: 2_000 });
  });

  it('a voucher counts when it is approved: in the shift open on the safe then, in none when there is none', async () => {
    const first = await openShift();
    const rent = await draftVoucher('payment', 40_000);
    const late = await draftVoucher('payment', 7_000);
    expect(getShift(db, first.id).cashMoves.count).toBe(0);
    // the first shift closes with the rent still a draft: it expected nothing out
    const closed = await ok(post(`/api/pos/shifts/${first.id}/close`, { countedCash: 100_000 }));
    expect(closed.expected.IQD).toBe(100_000);
    // approved with no shift open on the safe: it is in no shift (the safe's own account still has it)
    await approve(late.id);
    const second = await openShift(owner, 'C1', '1811', 50_000);
    expect(getShift(db, second.id).cashMoves.count).toBe(0);
    // approved while the second shift is open: out of that drawer, whenever it was written
    await approve(rent.id);
    expect(getShift(db, second.id).expected.IQD).toBe(50_000 - 40_000);
    expect(getShift(db, second.id).cashMoves.lines.map((l) => l.amount)).toEqual([-40_000]);
    expect(getShift(db, first.id).expected.IQD).toBe(100_000);
    expect(getShift(db, first.id).cashMoves.count).toBe(0);
    // a voucher on another safe is not this drawer's
    const other = await draftVoucher('payment', 9_000, { cashAccountCode: '1812' });
    await approve(other.id);
    expect(getShift(db, second.id).expected.IQD).toBe(10_000);
  });

  it('two shifts open on one safe: the money is on the shift of whoever paid it, else on the oldest; never on both', async () => {
    const who = await signIn({ las: ['pos', 'preparer', 'purchasing'], raz: ['pos', 'preparer', 'purchasing'] });
    const admin = (await get('/api/auth/me', who.admin!)).json().user.name as string;
    const a = await openShift(who.las!, 'C1');
    const b = await openShift(who.raz!, 'C2');
    // Raz pays a supplier out of the drawer: it is Raz's, though Las's shift is the older one
    await purchase(20_000, '1811', who.raz!);
    // Raz writes an expense, the admin approves it: still Raz's drawer
    const expense = await draftVoucher('payment', 6_000, {}, who.raz!);
    await approve(expense.id, who.admin!);
    // someone with no shift (the admin) writes a voucher and approves it: the oldest shift open on the safe
    const office = await draftVoucher('payment', 3_000, {}, who.admin!);
    await approve(office.id, who.admin!);
    // Las collects a debt
    const debt = await draftVoucher('receipt', 8_000, {}, who.las!);
    await approve(debt.id, who.admin!);

    expect(getShift(db, b.id).cashMoves.lines.map((l) => [l.amount, l.by])).toEqual([[-20_000, 'Raz'], [-6_000, 'Raz']]);
    expect(getShift(db, a.id).cashMoves.lines.map((l) => [l.amount, l.by])).toEqual([[-3_000, admin], [8_000, 'Las']]);
    const sum = { IQD: moved(a.id).IQD + moved(b.id).IQD, USD: 0 };
    expect(sum).toEqual({ IQD: ledger('1811', 'IQD'), USD: 0 });
    // Raz's shift closes; what Raz writes now is on the shift still open
    const mine = getShift(db, b.id).expected.IQD;
    await ok(post(`/api/pos/shifts/${b.id}/close`, { countedCash: mine }, who.raz!));
    const later = await draftVoucher('payment', 1_000, {}, who.raz!);
    await approve(later.id, who.admin!);
    expect(getShift(db, a.id).cashMoves.lines.map((l) => l.amount)).toEqual([-3_000, 8_000, -1_000]);
    expect(getShift(db, b.id).cashMoves.count).toBe(2);
    expect(moved(a.id).IQD + moved(b.id).IQD).toBe(ledger('1811', 'IQD'));
  });

  it('"Vouchers need approval": an expense that waits is no money; approved, it is out of its writer\'s drawer at that moment', async () => {
    const who = await signIn({ las: ['pos', 'preparer'], raz: ['pos'] });
    await ok(put('/api/voucher-approval', { on: true }, who.admin!));
    const hers = await openShift(who.las!, 'C1');
    const his = await openShift(who.raz!, 'C2');
    const waits = await ok(post('/api/expenses', { category: 'fuel', amount: 15_000, currency: 'IQD', cashAccountCode: '1811', date: TODAY(), lang: 'ar' }, who.las!));
    expect(waits.status).not.toBe('approved');
    expect(getShift(db, hers.id).cashMoves.count + getShift(db, his.id).cashMoves.count).toBe(0);
    // one that is rejected never was money
    const refused = await ok(post('/api/expenses', { category: 'other', amount: 99_000, currency: 'IQD', cashAccountCode: '1811', date: TODAY(), lang: 'ar' }, who.las!));
    await ok(post(`/api/entries/${refused.id}/reject`, { reason: 'Not ours' }, who.admin!));
    await ok(post(`/api/entries/${waits.id}/approve-waiting`, {}, who.admin!));
    expect(getShift(db, hers.id).cashMoves).toMatchObject({ out: { IQD: 15_000, USD: 0 }, count: 1 });
    expect(getShift(db, hers.id).cashMoves.lines[0]).toMatchObject({ type: 'payment', amount: -15_000, by: 'Las' });
    expect(getShift(db, his.id).cashMoves.count).toBe(0);
    expect(moved(hers.id).IQD + moved(his.id).IQD).toBe(ledger('1811', 'IQD'));
  });

  it('a cashier who closes blind sees none of it; a supervisor and whoever keeps the books do', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    await ok(put('/api/pos/rules', { blindClose: true }, who.admin!));
    const shift = await openShift(who.las!);
    // the owner pays the rent out of Las's drawer
    const rent = await draftVoucher('payment', 40_000, {}, who.admin!);
    await approve(rent.id, who.admin!);
    for (const url of [`/api/pos/shifts/${shift.id}`, '/api/pos/current', '/api/pos/shifts?status=open']) {
      const answer = await ok(get(url, who.las!));
      const blind = Array.isArray(answer) ? answer[0] : answer.shift ?? answer;
      expect(blind.blind, url).toBe(true);
      expect(blind.cashMoves, url).toEqual({ in: { IQD: 0, USD: 0 }, out: { IQD: 0, USD: 0 }, count: 0, lines: [] });
      expect(blind.expected, url).toEqual({ IQD: 0, USD: 0 });
      expect(JSON.stringify(blind), url).not.toContain('40000');
    }
    const day = await ok(get(`/api/brief/day-close?date=${TODAY()}`, who.las!));
    expect(JSON.stringify(day.registers)).not.toContain('40000');
    expect(day.registers[0].cashMoves).toBeUndefined();
    for (const h of [who.raz!, who.admin!]) {
      const seen = await ok(get(`/api/pos/shifts/${shift.id}`, h));
      expect(seen.cashMoves.out.IQD).toBe(40_000);
      expect(seen.expected.IQD).toBe(60_000);
    }
    // the cashier counts 60,000: nothing short, though they never saw the figure
    const closed = await ok(post(`/api/pos/shifts/${shift.id}/close`, { countedCash: 60_000 }, who.las!));
    expect(closed.blind).toBe(true);
    expect(getShift(db, shift.id).difference).toEqual({ IQD: 0, USD: 0 });
  });

  it('the day close lists each register\'s other cash', async () => {
    const shift = await openShift();
    await purchase(30_000);
    const receipt = await draftVoucher('receipt', 12_000);
    await approve(receipt.id);
    const day = await ok(get(`/api/brief/day-close?date=${TODAY()}`));
    expect(day.registers).toHaveLength(1);
    expect(day.registers[0].expected.IQD).toBe(82_000);
    expect(day.registers[0].cashMoves).toMatchObject({ in: { IQD: 12_000, USD: 0 }, out: { IQD: 30_000, USD: 0 }, count: 2 });
    expect(day.registers[0].cashMoves.lines.map((l: { type: string; amount: number }) => [l.type, l.amount])).toEqual([['purchase', -30_000], ['receipt', 12_000]]);
    // a register with none has no such part
    await ok(post(`/api/pos/shifts/${shift.id}/close`, { countedCash: 82_000 }));
    const quiet = await openShift(owner, 'C3', '1812', 0);
    const again = await ok(get(`/api/brief/day-close?date=${TODAY()}`));
    expect(again.registers.find((r: { shiftId: string }) => r.shiftId === quiet.id).cashMoves).toBeUndefined();
    expect(again.registers.find((r: { shiftId: string }) => r.shiftId === shift.id).cashMoves.count).toBe(2);
  });

  it('a revaluation of the dollars in the safe is no cash: the drawer expects the same notes', async () => {
    const shift = await openShift();
    const dollars = await draftVoucher('receipt', 10_000, { currency: 'USD', rateX100: RATE, description: 'Dollars in' });
    await approve(dollars.id);
    const before = getShift(db, shift.id).expected;
    expect(before).toEqual({ IQD: 100_000, USD: 10_000 });
    await ok(post('/api/fx/rates', { date: TODAY(), rateX100: 150_000 }));
    const report = await ok(get(`/api/fx/revaluation?date=${TODAY()}`));
    expect(report.rows.some((r: { accountCode: string }) => r.accountCode === '1811')).toBe(true);
    const entry = await ok(post('/api/fx/revaluation', { date: TODAY(), lang: 'en' }));
    await approve(entry.id);
    // the books moved dinars on the safe's account; no note came into the drawer
    expect(ledger('1811', 'IQD')).not.toBe(0);
    expect(getShift(db, shift.id).expected).toEqual(before);
    expect(getShift(db, shift.id).cashMoves.count).toBe(1);
  });
});
