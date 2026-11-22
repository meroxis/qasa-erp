import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { getShift } from './pos.ts';
import { resetDisplayTries, resetPinFailures } from './till-rules.ts';

// Round four of the review before 2.0: the cash the tills expect is the cash the books say their safes hold.
//
// Random days at three tills on two safes (two tills share the first safe), with every kind of money movement the
// tills know: cash sales in dinars (rounded to the notes) and in dollars, dollar notes on a dinar sale, sales on a
// customer's account, gift vouchers sold, used, given back by a return (a new voucher when the first is past its
// date) and cancelled by an admin, returns at the till and on the invoice screen, returns cancelled, sales cancelled,
// cash sales made on the invoice screen, shifts closed and opened again. After every step, for each safe and each
// currency: what its shifts expect (less their opening cash, with dollar notes counted as the dinars they stood for)
// is exactly what the ledger moved on that safe. A step the server refuses changes nothing, and is checked as well.
//
// The seeds are fixed, so a failure names the seed and the step and can be run again as it was. More seeds:
// QASA_CASH_SEEDS=150 npx vitest run packages/server/src/till-cash-ledger.test.ts

const SEEDS = Number(process.env.QASA_CASH_SEEDS ?? '') || 8;
const STEPS = 110;
const RATE = 142_000;
const SAFES = ['1811', '1812'] as const;

let db: Db;
let app: FastifyInstance;
let clock: number;

const owner = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
/** every request a second after the last: nothing in a day at a till happens in the same millisecond as a closing */
const call = (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => {
  clock += 1_000;
  vi.setSystemTime(clock);
  return app.inject({ method, url, headers: owner, ...(body === undefined ? {} : { payload: body as object }) });
};
async function must(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  const r = await call(method, url, body);
  expect(r.statusCode, `${method} ${url}: ${r.body}`).toBeLessThan(300);
  return r.json();
}

/** mulberry32: the same numbers for the same seed, everywhere */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

beforeEach(() => {
  resetLoginThrottle(); resetDisplayTries(); resetPinFailures();
  // the day starts at eight in the morning: the steps of one seed never reach midnight
  const start = new Date(); start.setHours(8, 0, 0, 0);
  clock = start.getTime();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
  db = openDatabase(':memory:');
  app = buildApp(db);
});
afterEach(async () => {
  await app.close();
  db.close();
  vi.useRealTimers();
});

/** what the ledger moved on a safe, in one currency (every entry on it, reversals too) */
const ledger = (safe: string, currency: 'IQD' | 'USD'): number => Number((db.prepare(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM entry_lines l JOIN entries e ON e.id = l.entry_id
  WHERE l.account_code = ? AND e.currency = ? AND e.status = 'approved'`).get(safe, currency) as { v: number }).v);

/** what the shifts of a safe expect in their drawers beyond their opening cash, as the ledger counts it */
function expectedOn(safe: string): { IQD: number; USD: number } {
  const ids = db.prepare('SELECT id FROM pos_shifts WHERE cash_account = ?').all(safe) as { id: string }[];
  const sum = { IQD: 0, USD: 0 };
  for (const { id } of ids) {
    const s = getShift(db, id);
    // dollar notes taken for a dinar sale: the ledger holds the dinars they stood for, the drawer the notes
    sum.IQD += s.expected.IQD - s.openingCash + s.usdTaken.iqd;
    sum.USD += s.expected.USD - s.usdTaken.usd;
  }
  return sum;
}

type Kind = 'sale' | 'usdNotes' | 'usdSale' | 'credit' | 'voucherSold' | 'voucherPaid' | 'tillReturn' | 'screenReturn' | 'returnCancel' | 'saleCancel'
  | 'screenSale' | 'closeOpen' | 'voucherCancel' | 'voucherExpire';

async function day(seed: number, done: Map<Kind, number>): Promise<void> {
  const rnd = random(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
  const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const today = todayIso(new Date(clock));

  await must('POST', '/api/plan/trial', {});
  const warehouseId = (await must('GET', '/api/warehouses'))[0].id as string;
  // prices that are no round number of notes, so the dinar rounding has work to do both ways
  const items: { id: string; price: number }[] = [];
  for (const [code, price] of [['TEA', 2_730], ['RICE', 1_115], ['OIL', 7_400]] as const) {
    const made = await must('POST', '/api/items', { code, name: { ar: code, en: code, ku: code }, unit: 'piece', salePrice: price, saleCurrency: 'IQD' });
    items.push({ id: made.id, price });
  }
  const stock = await must('POST', '/api/stock-docs', { kind: 'opening', date: '2026-01-01', warehouseId, counterAccountCode: '21', lines: items.map((i) => ({ itemId: i.id, qtyMilli: 5_000_000, unitCost: Math.round(i.price * 0.6) })) });
  await must('POST', `/api/stock-docs/${stock.id}/post`, {});
  await must('POST', '/api/accounts', { parentCode: '181', code: '1812', name: { ar: 'قاصة ثانية', en: 'Second safe', ku: 'قاسەی دووەم' } });
  const customer = await must('POST', '/api/parties', { type: 'customer', name: 'Saman' });
  await must('PUT', '/api/pos/rules', { rounding: { step: pick([250, 500, 1000] as const), mode: pick(['nearest', 'up', 'down'] as const) } });

  // three tills: two on the first safe, one on the second; each with some opening cash
  const tills = [{ register: 'C1', safe: '1811' }, { register: 'C2', safe: '1811' }, { register: 'C3', safe: '1812' }];
  const shifts: { id: string; register: string; safe: string }[] = [];
  const open = async (t: { register: string; safe: string }) => {
    const s = await must('POST', '/api/pos/shifts', { register: t.register, cashAccountCode: t.safe, warehouseId, openingCash: between(0, 4) * 25_000 });
    shifts.push({ register: t.register, safe: t.safe, id: s.id });
  };
  for (const t of tills) await open(t);
  const base = { '1811': { IQD: ledger('1811', 'IQD'), USD: ledger('1811', 'USD') }, '1812': { IQD: ledger('1812', 'IQD'), USD: ledger('1812', 'USD') } };

  const sales: { id: string; lines: number; cancelled?: boolean }[] = [];
  const returns: { id: string; cancelled?: boolean }[] = [];
  const vouchers: { id: string; code: string }[] = [];
  const cart = () => Array.from({ length: between(1, 3) }, () => { const i = pick(items); return { itemId: i.id, qtyMilli: between(1, 4) * 1000, unitPrice: i.price }; });
  const totalOf = (lines: { qtyMilli: number; unitPrice: number }[]) => lines.reduce((s, l) => s + Math.round((l.qtyMilli * l.unitPrice) / 1000), 0);
  const tick = (kind: Kind) => done.set(kind, (done.get(kind) ?? 0) + 1);

  const kinds: [Kind, number][] = [['sale', 16], ['usdNotes', 7], ['usdSale', 7], ['credit', 5], ['voucherSold', 8], ['voucherPaid', 10], ['tillReturn', 10], ['screenReturn', 8],
    ['returnCancel', 9], ['saleCancel', 6], ['screenSale', 8], ['closeOpen', 5], ['voucherCancel', 5], ['voucherExpire', 3]];
  const weight = kinds.reduce((s, [, w]) => s + w, 0);

  for (let step = 0; step < STEPS; step++) {
    let at = rnd() * weight;
    const kind = kinds.find(([, w]) => (at -= w) < 0)![0];
    const shift = pick(shifts);
    let res: { statusCode: number; body: string; json(): any } | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (kind === 'sale' || kind === 'usdNotes' || kind === 'credit' || kind === 'voucherPaid') {
      const lines = cart();
      const discount = rnd() < 0.25 ? between(1, 5) * 100 : 0;
      const total = totalOf(lines) - discount;
      const v = kind === 'voucherPaid' && vouchers.length ? pick(vouchers) : null;
      if (kind === 'voucherPaid' && !v) continue;
      const balance = v ? Number((db.prepare('SELECT balance FROM gift_vouchers WHERE id = ?').get(v.id) as { balance: number }).balance) : 0;
      const byVoucher = v ? Math.min(balance, rnd() < 0.5 ? total : Math.ceil(total / 2)) : 0;
      if (v && byVoucher <= 0) continue;
      res = await call('POST', `/api/pos/shifts/${shift.id}/sales`, {
        currency: 'IQD', discount, lines,
        ...(kind === 'credit' ? { partyId: customer.id, payments: [{ method: 'account', amount: total }] } : {}),
        ...(kind === 'usdNotes' ? { usdCash: { amount: between(1, 3) * 100, rateX100: RATE } } : {}),
        ...(v ? { vouchers: [{ code: v.code, amount: byVoucher }] } : {})
      });
      if (res.statusCode < 300) sales.push({ id: res.json().invoice.id, lines: lines.length });
    } else if (kind === 'usdSale') {
      const lines = cart().map((l) => ({ ...l, unitPrice: Math.round((l.unitPrice * 10_000) / RATE) }));
      res = await call('POST', `/api/pos/shifts/${shift.id}/sales`, { currency: 'USD', rateX100: RATE, discount: 0, lines });
      if (res.statusCode < 300) sales.push({ id: res.json().invoice.id, lines: lines.length });
    } else if (kind === 'screenSale') {
      const lines = cart();
      const usd = rnd() < 0.3;
      const draft = await must('POST', '/api/invoices', {
        kind: 'sale', date: today, warehouseId, currency: usd ? 'USD' : 'IQD', rateX100: usd ? RATE : 100, payment: 'cash', cashAccountCode: pick(SAFES), discount: 0,
        lines: usd ? lines.map((l) => ({ ...l, unitPrice: Math.round((l.unitPrice * 10_000) / RATE) })) : lines
      });
      res = await call('POST', `/api/invoices/${draft.id}/post`, {});
      if (res.statusCode < 300) sales.push({ id: draft.id, lines: lines.length });
    } else if (kind === 'voucherSold') {
      res = await call('POST', `/api/pos/shifts/${shift.id}/gift-vouchers`, { amount: between(1, 6) * 2_500, ...(rnd() < 0.5 ? { expiresOn: today } : {}) });
      if (res.statusCode < 300) vouchers.push({ id: res.json().id, code: res.json().code });
    } else if (kind === 'voucherExpire') {
      // a voucher past its date (the day after it was bought): a return onto it then makes a new voucher
      if (!vouchers.length) continue;
      db.prepare("UPDATE gift_vouchers SET expires_on = '2020-01-01' WHERE id = ? AND expires_on IS NOT NULL").run(pick(vouchers).id);
    } else if (kind === 'tillReturn' || kind === 'screenReturn') {
      const live = sales.filter((s) => !s.cancelled);
      if (!live.length) continue;
      const sale = pick(live);
      const lines = [{ lineNo: between(1, sale.lines), qtyMilli: 1000 }];
      res = kind === 'tillReturn'
        ? await call('POST', `/api/pos/shifts/${shift.id}/returns`, { invoiceId: sale.id, lines })
        : await call('POST', `/api/invoices/${sale.id}/returns`, { date: today, lines, ...(rnd() < 0.8 ? { payment: 'cash', cashAccountCode: pick(SAFES) } : { payment: 'credit' }) });
      if (res.statusCode < 300) {
        returns.push({ id: res.json().id });
        // a voucher the return made is one more voucher an admin can cancel
        for (const made of db.prepare("SELECT v.id, v.code FROM gift_voucher_moves m JOIN gift_vouchers v ON v.id = m.voucher_id WHERE m.invoice_id = ? AND m.kind = 'returned'").all(res.json().id) as { id: string; code: string }[]) {
          if (!vouchers.some((v) => v.id === made.id)) vouchers.push(made);
        }
      }
    } else if (kind === 'returnCancel') {
      const live = returns.filter((r) => !r.cancelled);
      if (!live.length) continue;
      const ret = pick(live);
      res = await call('POST', `/api/invoices/${ret.id}/cancel`, {});
      if (res.statusCode < 300) ret.cancelled = true;
    } else if (kind === 'saleCancel') {
      const live = sales.filter((s) => !s.cancelled);
      if (!live.length) continue;
      const sale = pick(live);
      res = await call('POST', `/api/invoices/${sale.id}/cancel`, {});
      if (res.statusCode < 300) sale.cancelled = true;
    } else if (kind === 'voucherCancel') {
      if (!vouchers.length) continue;
      const v = pick(vouchers);
      // (the safe is used for a voucher a refund made; one sold at a till goes back out of the safe it was paid into)
      res = await call('POST', `/api/pos/gift-vouchers/${v.id}/cancel`, { cashAccountCode: pick(SAFES) });
    } else {
      // the shift closes with what it expects, and its till opens again at once: its safe is never without a shift
      const now = getShift(db, shift.id);
      res = await call('POST', `/api/pos/shifts/${shift.id}/close`, { countedCash: Math.max(0, now.expected.IQD), countedUsd: Math.max(0, now.expected.USD) });
      expect(res.statusCode, res.body).toBe(200);
      shifts.splice(shifts.indexOf(shift), 1);
      await open(shift);
    }
    // never a crash: a step is done or refused with a reason
    if (res) expect(res.statusCode, `seed ${seed} step ${step} ${kind}: ${res.body}`).toBeLessThan(500);
    if (res && res.statusCode < 300) tick(kind);
    for (const safe of SAFES) {
      const moved = { IQD: ledger(safe, 'IQD') - base[safe].IQD, USD: ledger(safe, 'USD') - base[safe].USD };
      expect(expectedOn(safe), `seed ${seed} step ${step} (${kind}${res ? ` → ${res.statusCode}` : ''}) safe ${safe}`).toEqual(moved);
    }
  }
}

describe('what the tills expect in their drawers is what the ledger moved on their safes', () => {
  const done = new Map<Kind, number>();
  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`seed ${seed}: ${STEPS} random steps at three tills on two safes`, async () => {
      await day(seed, done);
    }, 120_000);
  }
  it('went through every kind of step', () => {
    for (const kind of ['sale', 'usdNotes', 'usdSale', 'credit', 'voucherSold', 'voucherPaid', 'tillReturn', 'screenReturn', 'returnCancel', 'saleCancel', 'screenSale', 'closeOpen', 'voucherCancel'] as const) {
      expect(done.get(kind) ?? 0, kind).toBeGreaterThan(0);
    }
  });
});
