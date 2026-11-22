import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { resetLoginThrottle } from './auth.ts';
import { resetDisplayTries } from './till-rules.ts';

// The "Verify the review fixes" report on the till (before 2.0): one regression test for each finding.

let db: Db;
let app: FastifyInstance;
let warehouseId: string;
let teaId: string;

const TODAY = todayIso();
const owner = { 'x-qasa-user': encodeURIComponent('Mer'), 'x-qasa-client': '1' };
type H = Record<string, string>;
const post = (url: string, body: unknown, h: H = owner) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const put = (url: string, body: unknown, h: H = owner) => app.inject({ method: 'PUT', url, payload: body as object, headers: h });
const get = (url: string, h: H = owner) => app.inject({ url, headers: h });
const balanceOf = (code: string) => Number((db.prepare('SELECT COALESCE(SUM(base_debit) - SUM(base_credit), 0) AS v FROM entry_lines l JOIN entries e ON e.id = l.entry_id WHERE l.account_code = ?').get(code) as { v: number }).v);
const tea = (qty = 1, price = 2_750) => ({ itemId: teaId, qtyMilli: qty * 1000, unitPrice: price });
const PIN = '407193';
const RULES = { lineDelete: false, void: false, price: false, discountPct: 0, noSale: false, refund: false, creditOver: false };

beforeEach(async () => {
  resetLoginThrottle();
  resetDisplayTries();
  db = openDatabase(':memory:');
  app = buildApp(db);
  warehouseId = (await get('/api/warehouses')).json()[0].id;
  teaId = (await post('/api/items', { code: 'TEA', name: { ar: 'شاي', en: 'Tea', ku: 'چا' }, unit: 'piece', salePrice: 2_750, saleCurrency: 'IQD' })).json().id;
  const doc = await post('/api/stock-docs', { kind: 'opening', date: '2026-01-01', warehouseId, counterAccountCode: '21', lines: [{ itemId: teaId, qtyMilli: 1_000_000, unitCost: 1_500 }] });
  expect((await post(`/api/stock-docs/${doc.json().id}/post`, {})).statusCode).toBe(200);
  expect((await post('/api/accounts', { parentCode: '181', code: '1812', name: { ar: 'قاصة ثانية', en: 'Second safe', ku: 'قاسەی دووەم' } })).statusCode).toBe(201);
});

afterEach(async () => {
  await app.close();
  db.close();
});

/** Sign-in on, with these people (password `<username>-pass-123`); the owner is "admin". */
async function signIn(people: Record<string, string[]>): Promise<Record<string, H>> {
  await post('/api/plan/trial', {});
  const ownerId = (await get('/api/users')).json()[0].id;
  expect((await post(`/api/users/${ownerId}/password`, { password: 'admin-pass-123' })).statusCode).toBe(200);
  for (const [username, roles] of Object.entries(people)) {
    const made = await post('/api/users', { username, name: username[0]!.toUpperCase() + username.slice(1), password: `${username}-pass-123`, roles });
    expect(made.statusCode, made.body).toBe(201);
  }
  expect((await put('/api/auth/signin', { on: true })).statusCode).toBe(200);
  const out: Record<string, H> = {};
  for (const username of ['admin', ...Object.keys(people)]) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: `${username}-pass-123` }, headers: { 'x-qasa-client': '1' } });
    expect(res.statusCode, res.body).toBe(200);
    out[username] = { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
  }
  return out;
}

const openShift = async (h: H = owner, register = 'C1', cashAccountCode = '1811') => {
  const r = await post('/api/pos/shifts', { register, cashAccountCode, warehouseId, openingCash: 0 }, h);
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string };
};
const sell = (shiftId: string, body: object, h: H = owner) => post(`/api/pos/shifts/${shiftId}/sales`, { currency: 'IQD', discount: 0, ...body }, h);
const voucher = async (shiftId: string, amount: number, extra: object = {}) => {
  const r = await post(`/api/pos/shifts/${shiftId}/gift-vouchers`, { amount, ...extra });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string; code: string };
};
const voucherRow = (id: string) => db.prepare('SELECT amount, balance, status, entry_id, cancel_entry_id FROM gift_vouchers WHERE id = ?').get(id) as
  { amount: number; balance: number; status: string; entry_id: string | null; cancel_entry_id: string | null };
const approve = async (h: H, body: object) => (await post('/api/pos/approve', { pin: PIN, ...body }, h)).json() as { token: string };
const needsSupervisor = (action: string) => ({ details: [{ code: 'pos_needs_supervisor', action }] });
const wrongPin = (shiftId: string, i: number, h: H) => post('/api/pos/approve', { shiftId, action: 'void', pin: `9000${10 + i}` }, h);
const rightPin = (shiftId: string, h: H) => post('/api/pos/approve', { shiftId, action: 'void', pin: PIN }, h);
/** time passes for the counts of wrong PINs: everything they hold moves `minutes` into the past */
function later(minutes: number): void {
  const back = (iso: string | null) => iso === null ? null : new Date(Date.parse(iso) - minutes * 60_000).toISOString();
  for (const r of db.prepare('SELECT k, since, locked_until FROM pos_pin_tries').all() as { k: string; since: string; locked_until: string | null }[]) {
    db.prepare('UPDATE pos_pin_tries SET since = ?, locked_until = ? WHERE k = ?').run(back(r.since), back(r.locked_until), r.k);
  }
}

describe('2 · a sales return cancelled, that had put money back on gift vouchers', () => {
  it('takes it off the vouchers again, so the same money is not on the voucher and back in the sale', async () => {
    const shift = await openShift();
    const v = await voucher(shift.id, 6_000);
    // two teas, 5,500, all by the voucher (500 stays on it)
    const sale = (await sell(shift.id, { lines: [tea(2)], vouchers: [{ code: v.code, amount: 5_500 }] })).json();
    const back = await post(`/api/pos/shifts/${shift.id}/returns`, { invoiceId: sale.invoice.id, lines: [{ lineNo: 1, qtyMilli: 2_000 }] });
    expect(back.statusCode, back.body).toBe(201);
    expect(voucherRow(v.id).balance).toBe(6_000);
    expect(balanceOf('263')).toBe(-6_000);
    // the return is cancelled: the sale stands again, paid by the voucher, which holds 500 as before the return
    const cancelled = await post(`/api/invoices/${back.json().id ?? back.json().invoice?.id}/cancel`, {});
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(voucherRow(v.id).balance).toBe(500);
    expect(balanceOf('263')).toBe(-500);
    expect((await get('/api/pos/gift-vouchers')).json()).toMatchObject({ sold: 6_000, used: 5_500, outstanding: 500 });
    // … and a new return gives the voucher its share again, no more than it paid
    const again = await post(`/api/pos/shifts/${shift.id}/returns`, { invoiceId: sale.invoice.id, lines: [{ lineNo: 1, qtyMilli: 1_000 }] });
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json().voucherBack).toEqual([{ code: v.code, amount: 2_750, made: false }]);
    expect(voucherRow(v.id).balance).toBe(3_250);
  });

  it('is refused once the voucher spent what the return gave it, with words in three languages', async () => {
    const shift = await openShift();
    const v = await voucher(shift.id, 5_500);
    const sale = (await sell(shift.id, { lines: [tea(2)], vouchers: [{ code: v.code, amount: 5_500 }] })).json();
    const back = await post(`/api/pos/shifts/${shift.id}/returns`, { invoiceId: sale.invoice.id, lines: [{ lineNo: 1, qtyMilli: 2_000 }] });
    const returnId = back.json().id ?? back.json().invoice?.id;
    // the customer spends the 5,500 that came back on other goods
    expect((await sell(shift.id, { lines: [tea(2)], vouchers: [{ code: v.code, amount: 5_500 }] })).statusCode).toBe(201);
    const refused = await post(`/api/invoices/${returnId}/cancel`, {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'gv_return_spent', details: { voucher: v.code } });
    // nothing changed: the return stands, the voucher is empty, the books hold nothing for it
    expect((await get(`/api/invoices/${returnId}`)).json().status).toBe('posted');
    expect(voucherRow(v.id).balance).toBe(0);
    expect(balanceOf('263')).toBe(0);
  });

  it('cancels the voucher the return made, when the first one was past its date', async () => {
    const shift = await openShift();
    const v = await voucher(shift.id, 5_500, { expiresOn: addDays(TODAY, 10) });
    const sale = (await sell(shift.id, { lines: [tea(2)], vouchers: [{ code: v.code, amount: 5_500 }] })).json();
    db.prepare('UPDATE gift_vouchers SET created_at = ?, expires_on = ? WHERE id = ?').run(`${addDays(TODAY, -51)}T08:00:00.000Z`, addDays(TODAY, -1), v.id);
    const back = await post(`/api/pos/shifts/${shift.id}/returns`, { invoiceId: sale.invoice.id, lines: [{ lineNo: 1, qtyMilli: 2_000 }] });
    const [made] = back.json().voucherBack as { code: string; amount: number; made: boolean }[];
    const fresh = (await get(`/api/pos/gift-vouchers/lookup?code=${made!.code}`)).json();
    expect(fresh).toMatchObject({ balance: 5_500, usable: true });
    expect((await post(`/api/invoices/${back.json().id ?? back.json().invoice?.id}/cancel`, {})).statusCode).toBe(200);
    expect(voucherRow(fresh.id)).toMatchObject({ balance: 0, status: 'cancelled' });
    expect((await sell(shift.id, { lines: [tea(1)], vouchers: [{ code: made!.code, amount: 2_750 }] })).statusCode).toBe(400);
    expect(balanceOf('263')).toBe(0);
  });
});

describe('3 · a voucher a refund made', () => {
  it('keeps no entry of the return; cancelling it pays the customer with its own entry and never reverses the return', async () => {
    const shift = await openShift();
    const v = await voucher(shift.id, 5_500, { expiresOn: addDays(TODAY, 10) });
    const sale = (await sell(shift.id, { lines: [tea(2)], vouchers: [{ code: v.code, amount: 5_500 }] })).json();
    db.prepare('UPDATE gift_vouchers SET created_at = ?, expires_on = ? WHERE id = ?').run(`${addDays(TODAY, -51)}T08:00:00.000Z`, addDays(TODAY, -1), v.id);
    const back = await post(`/api/pos/shifts/${shift.id}/returns`, { invoiceId: sale.invoice.id, lines: [{ lineNo: 1, qtyMilli: 2_000 }] });
    const returnId = back.json().id ?? back.json().invoice?.id;
    const ret = (await get(`/api/invoices/${returnId}`)).json();
    const [made] = back.json().voucherBack as { code: string }[];
    const fresh = (await get(`/api/pos/gift-vouchers/lookup?code=${made!.code}`)).json();
    expect(voucherRow(fresh.id).entry_id).toBeNull();
    // the return's entry is the return's alone: the journal does not say a gift voucher owns it
    expect((await get(`/api/entries/${ret.entryId}`)).json().owner ?? null).not.toBe('gift_voucher');
    expect(balanceOf('263')).toBe(-5_500);
    const safe = balanceOf('1811');
    // an admin cancels the unused voucher: 5,500 paid out of the safe, the liability gone, the return untouched
    const cancelled = await post(`/api/pos/gift-vouchers/${fresh.id}/cancel`, { cashAccountCode: '1811' });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(balanceOf('263')).toBe(0);
    expect(balanceOf('1811')).toBe(safe - 5_500);
    expect((await get(`/api/invoices/${returnId}`)).json()).toMatchObject({ status: 'posted', entryId: ret.entryId });
    const row = voucherRow(fresh.id);
    expect(row).toMatchObject({ status: 'cancelled', balance: 0 });
    expect(row.cancel_entry_id).not.toBeNull();
    expect(row.cancel_entry_id).not.toBe(ret.entryId);
    const entry = db.prepare('SELECT type, status, reverses_id FROM entries WHERE id = ?').get(row.cancel_entry_id) as { type: string; status: string; reverses_id: string | null };
    expect(entry).toMatchObject({ type: 'payment', status: 'approved', reverses_id: null });
    // that payment is the voucher's: not reversed from the journal
    expect((await post(`/api/entries/${row.cancel_entry_id}/reverse`, {})).statusCode).toBeGreaterThanOrEqual(400);
    // a voucher from before this fix that kept the return's entry does not own it either
    const old = await voucher(shift.id, 1_000);
    db.prepare('UPDATE gift_vouchers SET shift_id = NULL, entry_id = ? WHERE id = ?').run(ret.entryId, old.id);
    expect(db.prepare('SELECT 1 AS x FROM gift_vouchers WHERE (entry_id = ? AND shift_id IS NOT NULL)').get(ret.entryId)).toBeUndefined();
  });

  it('still reverses the receipt of a voucher sold at a till', async () => {
    const shift = await openShift();
    const v = await voucher(shift.id, 4_000);
    expect(balanceOf('1811')).toBe(4_000);
    expect((await post(`/api/pos/gift-vouchers/${v.id}/cancel`, {})).statusCode).toBe(200);
    expect(balanceOf('1811')).toBe(0);
    expect(balanceOf('263')).toBe(0);
    const row = voucherRow(v.id);
    expect(db.prepare('SELECT reverses_id FROM entries WHERE id = ?').get(row.cancel_entry_id)).toMatchObject({ reverses_id: row.entry_id });
  });
});

describe('4 · the locks wrong PINs leave', () => {
  it('starts a cashier\'s count again when a supervisor types the right PIN', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 4; i++) expect((await wrongPin(shift.id, round * 4 + i, who.las!)).json()).toMatchObject({ details: [{ code: 'pin_wrong' }] });
      expect((await rightPin(shift.id, who.las!)).json()).toMatchObject({ approver: 'Raz' });
    }
    expect(db.prepare("SELECT n, locked_until FROM pos_pin_tries WHERE k <> 'all'").get()).toMatchObject({ n: 0, locked_until: null });
  });

  it('counts within fifteen minutes of the first wrong PIN: a typo every ten minutes never locks', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    for (let i = 0; i < 6; i++) {
      expect((await wrongPin(shift.id, i, who.las!)).json()).toMatchObject({ details: [{ code: 'pin_wrong' }] });
      later(10);
    }
    expect((await rightPin(shift.id, who.las!)).json()).toMatchObject({ approver: 'Raz' });
    // five within the fifteen minutes still lock, for fifteen minutes from the fifth
    for (let i = 0; i < 5; i++) { expect((await wrongPin(shift.id, 20 + i, who.las!)).json()).toMatchObject({ details: [{ code: 'pin_wrong' }] }); later(2); }
    expect((await rightPin(shift.id, who.las!)).json()).toMatchObject({ error: 'pin_locked' });
    later(10);
    expect((await rightPin(shift.id, who.las!)).json()).toMatchObject({ error: 'pin_locked' });
    later(4);
    expect((await rightPin(shift.id, who.las!)).json()).toMatchObject({ approver: 'Raz' });
  });

  it('with sign-in off counts by till, not by the owner every PC is: one till\'s lock leaves the others working, and no till stops for a day', async () => {
    // sign-in is off: both PCs are the owner
    const ali = { 'x-qasa-user': encodeURIComponent('Ali'), 'x-qasa-client': '1' };
    expect((await put('/api/pos/pin', { pin: PIN })).statusCode).toBe(200);
    const one = await openShift(owner, 'C1');
    const two = await openShift(ali, 'C2', '1812');
    for (let i = 0; i < 5; i++) expect((await wrongPin(one.id, i, owner)).json()).toMatchObject({ details: [{ code: 'pin_wrong' }] });
    expect((await rightPin(one.id, owner)).json()).toMatchObject({ error: 'pin_locked' });
    expect((await rightPin(two.id, ali)).statusCode).toBe(200);
    expect((db.prepare("SELECT k FROM pos_pin_tries WHERE k <> 'all' ORDER BY k").all() as { k: string }[]).map((r) => r.k)).toEqual(['t:c1', 't:c2']);
    // twenty slow wrong PINs at one till: the short lock comes and goes, the till never stops until tomorrow
    for (let i = 5; i < 25; i++) {
      later(16);
      db.prepare("UPDATE pos_pin_tries SET n = 0 WHERE k = 'all'").run();
      expect((await wrongPin(one.id, i, owner)).json()).toMatchObject({ details: [{ code: 'pin_wrong' }] });
    }
    later(16);
    expect((await rightPin(one.id, owner)).statusCode).toBe(200);
  });

  it('lets an admin lift the locks (the fifteen minutes and the day), in the audit log; nobody else', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    for (let i = 0; i < 5; i++) await wrongPin(shift.id, i, who.las!);
    expect((await rightPin(shift.id, who.las!)).json()).toMatchObject({ error: 'pin_locked' });
    expect((await get('/api/pos/rules', who.admin!)).json()).toMatchObject({ pinLocked: true });
    expect((await post('/api/pos/pin-unlock', {}, who.las!)).statusCode).toBe(403);
    expect((await post('/api/pos/pin-unlock', {}, who.raz!)).statusCode).toBe(403);
    expect((await post('/api/pos/pin-unlock', {}, who.admin!)).statusCode).toBe(200);
    expect((await get('/api/pos/rules', who.admin!)).json()).toMatchObject({ pinLocked: false, pinAlert: null });
    expect((await rightPin(shift.id, who.las!)).json()).toMatchObject({ approver: 'Raz' });
    expect(db.prepare("SELECT user FROM audit_log WHERE action = 'pin_unlock'").get()).toMatchObject({ user: 'Admin' });
    // a count left from yesterday is no lock today
    db.prepare("UPDATE pos_pin_tries SET day_n = 15, day_on = ? WHERE k <> 'all'").run(addDays(TODAY, -1));
    expect((await get('/api/pos/rules', who.admin!)).json()).toMatchObject({ pinLocked: false });
    expect((await rightPin(shift.id, who.las!)).json()).toMatchObject({ approver: 'Raz' });
    // the day's lock too
    db.prepare("UPDATE pos_pin_tries SET day_n = 15, day_on = ? WHERE k <> 'all'").run(TODAY);
    expect((await rightPin(shift.id, who.las!)).json()).toMatchObject({ error: 'pin_locked' });
    expect((await post('/api/pos/pin-unlock', {}, who.admin!)).statusCode).toBe(200);
    expect((await rightPin(shift.id, who.las!)).json()).toMatchObject({ approver: 'Raz' });
  });
});

describe('5 · the rate of dollars at the till', () => {
  it('holds dollar notes and dollar sales to today\'s rate on the rate board (else the company\'s): 3% free, to 15% a supervisor\'s, beyond refused', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    // the till is told the rate it is held to: the company's while the board has none for today
    expect((await get('/api/pos/rules', who.las!)).json().rate).toMatchObject({ referenceX100: 142_000, freePct: 3, bandPct: 15 });
    // today's rate on the board: 1,500
    expect((await post('/api/fx/rates', { date: TODAY, rateX100: 150_000 }, who.admin!)).statusCode).toBeLessThan(300);
    expect((await get('/api/pos/rules', who.las!)).json().rate.referenceX100).toBe(150_000);
    const notes = (rateX100: number, approvals: string[] = []) => sell(shift.id, { lines: [tea(10)], usdCash: { amount: 2000, rateX100 }, approvals }, who.las!);
    const dollars = (rateX100: number, approvals: string[] = []) => sell(shift.id, { currency: 'USD', rateX100, lines: [tea(1, 200)], approvals }, who.las!);
    // within 3% of 1,500, above or below: taken
    expect((await notes(154_500)).statusCode).toBe(201);
    expect((await notes(145_500)).statusCode).toBe(201);
    expect((await dollars(151_000)).statusCode).toBe(201);
    // further: a supervisor approves that very rate, for that kind of sale, once
    expect((await notes(154_600)).json()).toMatchObject(needsSupervisor('rate'));
    expect((await dollars(140_000)).json()).toMatchObject(needsSupervisor('rate'));
    const ok = await approve(who.las!, { shiftId: shift.id, action: 'rate', rate: { kind: 'notes', rateX100: 140_000 } });
    expect((await notes(139_000, [ok.token])).json()).toMatchObject(needsSupervisor('rate'));
    expect((await dollars(140_000, [ok.token])).json()).toMatchObject(needsSupervisor('rate'));
    expect((await notes(140_000, [ok.token])).statusCode).toBe(201);
    expect((await notes(140_000, [ok.token])).json()).toMatchObject(needsSupervisor('rate'));
    const sale = await approve(who.las!, { shiftId: shift.id, action: 'rate', rate: { kind: 'sale', rateX100: 160_000 } });
    expect((await dollars(160_000, [sale.token])).statusCode).toBe(201);
    // an approval with no rate named is not given
    expect((await post('/api/pos/approve', { shiftId: shift.id, action: 'rate', pin: PIN }, who.las!)).json()).toMatchObject({ details: [{ code: 'pos_approval_incomplete' }] });
    // beyond 15%: refused whoever approves, with the day's rate for the till to show
    expect((await notes(172_600)).json()).toMatchObject({ details: [{ code: 'pos_usd_rate_far', rateX100: 150_000 }] });
    expect((await dollars(127_400)).json()).toMatchObject({ details: [{ code: 'pos_rate_far', rateX100: 150_000 }] });
  });

  it('keeps a sale a cut-off till made at a rate that needs a supervisor waiting for one', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    const kept = (reference: string, rateX100: number) => sell(shift.id, {
      lines: [tea(10)], usdCash: { amount: 2000, rateX100 }, offline: { reference, soldAt: new Date().toISOString(), soldOn: TODAY }
    }, who.las!);
    expect((await kept('OFF-C1-000001', 141_000)).statusCode).toBe(201);
    expect((await kept('OFF-C1-000002', 125_000)).json()).toMatchObject({ details: [{ code: 'pos_offline_supervisor' }] });
    // the rate of the day it was sold: yesterday's board rate (1,300), though today's is 1,500
    db.prepare('UPDATE pos_shifts SET opened_at = ? WHERE id = ?').run(`${addDays(TODAY, -1)}T06:00:00.000Z`, shift.id);
    db.prepare('INSERT INTO fx_rates (date, rate_x100, source, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(addDays(TODAY, -1), 130_000, 'test', 'Mer', new Date().toISOString());
    expect((await post('/api/fx/rates', { date: TODAY, rateX100: 150_000 }, who.admin!)).statusCode).toBeLessThan(300);
    // (a service: stock sold today is not sold again on an earlier date)
    const wash = (await post('/api/items', { code: 'WASH', name: { ar: 'غسيل', en: 'Wash', ku: 'شۆردن' }, unit: 'service', salePrice: 27_500, saleCurrency: 'IQD', trackStock: false }, who.admin!)).json();
    const yesterday = (reference: string, rateX100: number) => sell(shift.id, {
      lines: [{ itemId: wash.id, qtyMilli: 1000, unitPrice: 27_500 }], usdCash: { amount: 2000, rateX100 }, offline: { reference, soldAt: `${addDays(TODAY, -1)}T10:00:00.000Z`, soldOn: addDays(TODAY, -1) }
    }, who.las!);
    // (round four) yesterday's own rate is 13% from today's: not taken unseen, it waits for a supervisor
    expect((await yesterday('OFF-C1-000003', 130_000)).json()).toMatchObject({ details: [{ code: 'pos_offline_supervisor' }] });
    expect((await yesterday('OFF-C1-000004', 140_000)).json()).toMatchObject({ details: [{ code: 'pos_offline_supervisor' }] });
    // today's rate on a sale of yesterday (15.4% from yesterday's): the same, never refused for good
    expect((await yesterday('OFF-C1-000006', 150_000)).json()).toMatchObject({ details: [{ code: 'pos_offline_supervisor' }] });
    // sold today, it is held to today's
    expect((await kept('OFF-C1-000005', 150_000)).statusCode).toBe(201);
  });

  it('takes a kept sale of a past day freely only at a rate within 3% of that day\'s rate and of today\'s; any other waits for a supervisor, none is a dead end (round four)', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    const day = (n: number) => addDays(TODAY, -n);
    db.prepare('UPDATE pos_shifts SET opened_at = ? WHERE id = ?').run(`${day(3)}T06:00:00.000Z`, shift.id);
    const board = (date: string, rateX100: number) => db.prepare('INSERT INTO fx_rates (date, rate_x100, source, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(date, rateX100, 'test', 'Mer', new Date().toISOString());
    // the board: 1,400 three days ago, nothing two days ago, 1,440 yesterday; today 1,450
    board(day(3), 140_000); board(day(1), 144_000);
    expect((await post('/api/fx/rates', { date: TODAY, rateX100: 145_000 }, who.admin!)).statusCode).toBeLessThan(300);
    const wash = (await post('/api/items', { code: 'WASH', name: { ar: 'غسيل', en: 'Wash', ku: 'شۆردن' }, unit: 'service', salePrice: 27_500, saleCurrency: 'IQD', trackStock: false }, who.admin!)).json();
    let n = 100;
    const kept = (ago: number, body: object, reference = `OFF-C1-000${++n}`) => sell(shift.id, {
      lines: [{ itemId: wash.id, qtyMilli: 1000, unitPrice: 27_500 }], ...body, offline: { reference, soldAt: `${day(ago)}T10:00:00.000Z`, soldOn: day(ago) }
    }, who.las!);
    const notes = (rateX100: number) => ({ usdCash: { amount: 1900, rateX100 } });
    const waits = { details: [{ code: 'pos_offline_supervisor' }] };
    // two days ago the board had no rate of its own: the latest before it (1,400) is that day's, not the company's
    // rate of today. 1,410 is within 3% of 1,400 and of 1,450: taken
    { const r = await kept(2, notes(141_000)); expect(r.statusCode, r.body).toBe(201); }
    // 1,360 is within 3% of 1,400 but 6.2% from today's: waits
    expect((await kept(2, notes(136_000))).json()).toMatchObject(waits);
    // 1,490 is within 3% of today's but 6.4% from that day's: waits (naming an old day buys no better rate)
    expect((await kept(2, notes(149_000))).json()).toMatchObject(waits);
    // a dollar sale the same: its own rate against both
    { const r = await kept(1, { currency: 'USD', rateX100: 144_500, lines: [{ itemId: wash.id, qtyMilli: 1000, unitPrice: 1_900 }] }); expect(r.statusCode, r.body).toBe(201); }
    expect((await kept(1, { currency: 'USD', rateX100: 150_000, lines: [{ itemId: wash.id, qtyMilli: 1000, unitPrice: 1_900 }] })).json()).toMatchObject(waits);
    // far from both (a slip of a digit at the cut-off till): it was sold, so it waits for a supervisor too, and is
    // taken as it was kept once one approves that very receipt
    const slip = () => kept(2, notes(114_000), 'OFF-C1-000199');
    expect((await slip()).json()).toMatchObject(waits);
    const ok = await post('/api/pos/approve', { shiftId: shift.id, action: 'offline_sale', pin: PIN, reference: 'OFF-C1-000199', amount: 27_500 }, who.las!);
    expect(ok.statusCode, ok.body).toBeLessThan(300);
    { const r = await slip(); expect(r.statusCode, r.body).toBe(201); }
    const log = db.prepare("SELECT details FROM audit_log WHERE action = 'offline_sale_accepted'").all() as { details: string }[];
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0]!.details)).toMatchObject({ approver: 'Raz', needs: ['rate'], rate: 'notes:114000', dayRateX100: 140_000, todayRateX100: 145_000 });
    // a sale made now (not kept) is still refused beyond 15%, with the day's rate for the till to show
    expect((await sell(shift.id, { lines: [tea(10)], usdCash: { amount: 1900, rateX100: 114_000 } }, who.las!)).json()).toMatchObject({ details: [{ code: 'pos_usd_rate_far', rateX100: 145_000 }] });
  });
});

describe('6 · what a discount or a price approval is for', () => {
  it('never lets a discount approved on a large basket become a larger share of a smaller one', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    expect((await put('/api/pos/rules', { supervisor: { ...RULES, discountPct: 10 } }, who.admin!)).statusCode).toBe(200);
    const shift = await openShift(who.las!);
    // 8,000 off twenty teas (55,000): 14.5%
    const ok = await approve(who.las!, { shiftId: shift.id, action: 'discount', amount: 8_000, gross: 55_000 });
    // … is not 8,000 off three teas (8,250), nor 2,000 off three teas (24%)
    expect((await sell(shift.id, { discount: 8_000, lines: [tea(3)], approvals: [ok.token] }, who.las!)).json()).toMatchObject(needsSupervisor('discount'));
    expect((await sell(shift.id, { discount: 2_000, lines: [tea(3)], approvals: [ok.token] }, who.las!)).json()).toMatchObject(needsSupervisor('discount'));
    // a basket that grew, or the same share of a smaller one, is covered
    expect((await sell(shift.id, { discount: 8_000, lines: [tea(21)], approvals: [ok.token] }, who.las!)).statusCode).toBe(201);
    const again = await approve(who.las!, { shiftId: shift.id, action: 'discount', amount: 8_000, gross: 55_000 });
    expect((await sell(shift.id, { discount: 4_000, lines: [tea(10)], approvals: [again.token] }, who.las!)).statusCode).toBe(201);
    // an approval that names no basket, or a discount above it, is not given
    for (const body of [{ amount: 8_000 }, { amount: 8_000, gross: 5_000 }]) {
      expect((await post('/api/pos/approve', { shiftId: shift.id, action: 'discount', pin: PIN, ...body }, who.las!)).json()).toMatchObject({ details: [{ code: 'pos_approval_incomplete' }] });
    }
  });

  it('holds a price approval to the currency it was given in', async () => {
    const who = await signIn({ las: ['pos'], raz: ['supervisor'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    expect((await put('/api/pos/rules', { supervisor: { ...RULES, price: true } }, who.admin!)).statusCode).toBe(200);
    const phone = (await post('/api/items', { code: 'PH', name: { ar: 'هاتف', en: 'Phone', ku: 'مۆبایل' }, unit: 'piece', salePrice: 10_000, saleCurrency: 'USD', trackStock: false }, who.admin!)).json();
    const shift = await openShift(who.las!);
    // 90.00 dollars approved for a phone listed at 100.00
    const usd = await approve(who.las!, { shiftId: shift.id, action: 'price', itemId: phone.id, amount: 9_000, currency: 'USD' });
    // … is not 9,000 dinars
    expect((await sell(shift.id, { lines: [{ itemId: phone.id, qtyMilli: 1000, unitPrice: 9_000 }], approvals: [usd.token] }, who.las!)).json()).toMatchObject(needsSupervisor('price'));
    expect((await sell(shift.id, { currency: 'USD', rateX100: 142_000, lines: [{ itemId: phone.id, qtyMilli: 1000, unitPrice: 9_000 }], approvals: [usd.token] }, who.las!)).statusCode).toBe(201);
    // one with no currency is not given
    expect((await post('/api/pos/approve', { shiftId: shift.id, action: 'price', pin: PIN, itemId: phone.id, amount: 9_000 }, who.las!)).json()).toMatchObject({ details: [{ code: 'pos_approval_incomplete' }] });
  });
});

describe('7 · a refund asked on the invoice screens', () => {
  it('is approved by a supervisor\'s PIN there, for someone with no till: that invoice, those lines, once, never by themselves', async () => {
    const who = await signIn({ sam: ['sales'], kay: ['pos'], raz: ['supervisor', 'sales'], vic: ['viewer'] });
    expect((await put('/api/pos/pin', { pin: PIN }, who.raz!)).statusCode).toBe(200);
    expect((await put('/api/pos/rules', { supervisor: { ...RULES, refund: true } }, who.admin!)).statusCode).toBe(200);
    // Kay's shift is open on the safe; Sam (sales, no till) sold on the invoice screen into it
    await openShift(who.kay!);
    const made = async () => {
      const draft = await post('/api/invoices', { kind: 'sale', date: TODAY, warehouseId, currency: 'IQD', rateX100: 100, payment: 'cash', cashAccountCode: '1811', discount: 0, lines: [tea(2)] }, who.sam!);
      expect((await post(`/api/invoices/${draft.json().id}/post`, {}, who.sam!)).statusCode).toBe(200);
      return draft.json().id as string;
    };
    const a = await made();
    const b = await made();
    const one = [{ lineNo: 1, qtyMilli: 1_000 }];
    const ret = { date: TODAY, payment: 'cash', cashAccountCode: '1811', lines: one };
    expect((await post(`/api/invoices/${a}/returns`, ret, who.sam!)).json()).toMatchObject(needsSupervisor('refund'));
    // Sam has no shift: the till's own approval is not theirs to ask
    expect((await post('/api/pos/approve', { shiftId: 'none', action: 'refund', invoiceId: a, lines: one, pin: PIN }, who.sam!)).statusCode).toBeGreaterThanOrEqual(403);
    // a supervisor types their PIN on the invoice screen
    expect((await post('/api/refund-approvals', { invoiceId: a, lines: one, pin: '555555' }, who.sam!)).json()).toMatchObject({ details: [{ code: 'pin_wrong' }] });
    expect((await post('/api/refund-approvals', { invoiceId: 'no-such', lines: one, pin: PIN }, who.sam!)).json()).toMatchObject({ details: [{ code: 'pos_approval_incomplete' }] });
    expect((await post('/api/refund-approvals', { invoiceId: a, lines: one, pin: PIN }, who.vic!)).statusCode).toBe(403);
    const ok = await post('/api/refund-approvals', { invoiceId: a, lines: one, pin: PIN }, who.sam!);
    expect(ok.json()).toMatchObject({ approver: 'Raz', action: 'refund', used: false });
    const token = ok.json().token as string;
    expect(db.prepare('SELECT shift_id, cashier, subject FROM till_approvals WHERE id = ?').get(token)).toMatchObject({ shift_id: null, cashier: 'Sam', subject: a });
    // for that invoice and those lines only, for Sam only, once
    expect((await post(`/api/invoices/${b}/returns`, { ...ret, approvals: [token] }, who.sam!)).json()).toMatchObject(needsSupervisor('refund'));
    expect((await post(`/api/invoices/${a}/returns`, { ...ret, lines: [{ lineNo: 1, qtyMilli: 2_000 }], approvals: [token] }, who.sam!)).json()).toMatchObject(needsSupervisor('refund'));
    expect((await post(`/api/invoices/${a}/cancel`, { approvals: [token] }, who.sam!)).json()).toMatchObject(needsSupervisor('refund'));
    expect((await post(`/api/invoices/${a}/returns`, { ...ret, approvals: [token] }, who.sam!)).statusCode).toBe(201);
    expect((await post(`/api/invoices/${a}/returns`, { ...ret, approvals: [token] }, who.sam!)).json()).toMatchObject(needsSupervisor('refund'));
    // a cancel: an approval for the whole invoice
    const whole = await post('/api/refund-approvals', { invoiceId: b, pin: PIN }, who.sam!);
    expect((await post(`/api/invoices/${b}/cancel`, { approvals: [whole.json().token] }, who.sam!)).statusCode).toBe(200);
    // it is in the audit log with both names
    expect(db.prepare("SELECT user, details FROM audit_log WHERE action = 'supervisor_ok' AND entity = 'invoice' ORDER BY at LIMIT 1").get()).toMatchObject({ user: 'Sam' });
    // five wrong PINs there lock Sam's approvals, as at a till
    for (let i = 0; i < 5; i++) await post('/api/refund-approvals', { invoiceId: a, lines: one, pin: `9000${10 + i}` }, who.sam!);
    expect((await post('/api/refund-approvals', { invoiceId: a, lines: one, pin: PIN }, who.sam!)).json()).toMatchObject({ error: 'pin_locked' });
  });
});
