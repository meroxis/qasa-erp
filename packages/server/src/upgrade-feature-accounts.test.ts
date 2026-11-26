import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayIso } from '@qasa/core';
import { buildApp } from './app.ts';
import { keepFeatureAccounts, openDatabase, type Db } from './db.ts';
import { readSetting, writeSetting } from './settings.ts';

// Upgrading to 2.0 (books review #7). From 2.0 a feature never takes an account of its standard code that the company
// made itself — but on 1.x cheques did post into a company's own 162 and the petrol station into its own 1379. Version
// 18's data step writes the feature's setting for such a company, so 2.0 keeps posting where 1.x did; an account of the
// same code the feature never used stays the company's.

let db: Db;
let app: FastifyInstance;
const headers = { 'x-qasa-client': '1', 'x-qasa-user': encodeURIComponent('Mer') };
const post = (url: string, body: unknown = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
const day = (offset: number) => new Date(Date.parse(todayIso() + 'T00:00:00Z') + offset * 86_400_000).toISOString().slice(0, 10);
const L = (litres: number) => Math.round(litres * 1000);

beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
});

/** As a company on 1.6 had it: the account is its own (not a standard one), and nothing says which feature uses it. */
function asOn16(code: string, setting: string): void {
  db.prepare('UPDATE accounts SET "system" = 0 WHERE code = ?').run(code);
  db.prepare('DELETE FROM settings WHERE "key" = ?').run(setting);
}

describe('upgrade to 2.0: the accounts 1.x features were already posting to', () => {
  it("cheques keep the company's own 162 they were posting into", async () => {
    const customerId = (await post('/api/parties', { type: 'customer', name: 'Bazaar Trading Company' })).json().id;
    const cheque = { direction: 'received', partyId: customerId, number: 'C-1', bank: 'Rafidain', amount: 2_000_000, currency: 'IQD', rateX100: 100, issueDate: day(-1), dueDate: day(5) };
    const first = await post('/api/banking/cheques', cheque);
    expect(first.statusCode, first.body).toBe(201);
    asOn16('162', 'banking_notes_receivable');

    // without the step, 2.0 refuses the company's own 162: no further cheque, and the one in hand can't move
    expect((await post('/api/banking/cheques', { ...cheque, number: 'C-2' })).json().error).toBe('bk_notes_receivable_missing');

    keepFeatureAccounts(db);
    expect(readSetting(db, 'banking_notes_receivable')).toBe('162');
    const second = await post('/api/banking/cheques', { ...cheque, number: 'C-2' });
    expect(second.statusCode, second.body).toBe(201);
    expect(db.prepare("SELECT COUNT(*) AS n FROM entry_lines WHERE account_code = '162'").get()).toEqual({ n: 2 });
    // still the company's account: the step chooses it, it does not take it over
    expect(db.prepare("SELECT \"system\" AS s FROM accounts WHERE code = '162'").get()).toEqual({ s: 0 });
  });

  it("an own 162 no cheque ever touched stays the company's, and a choice already made is kept", async () => {
    asOn16('162', 'banking_notes_receivable');
    keepFeatureAccounts(db);
    expect(readSetting(db, 'banking_notes_receivable') ?? null).toBeNull();
    const customerId = (await post('/api/parties', { type: 'customer', name: 'Bazaar Trading Company' })).json().id;
    const r = await post('/api/banking/cheques', { direction: 'received', partyId: customerId, number: 'C-1', bank: 'Rafidain', amount: 1_000_000, currency: 'IQD', rateX100: 100, issueDate: day(-1), dueDate: day(5) });
    expect(r.json().error).toBe('bk_notes_receivable_missing');

    writeSetting(db, 'banking_notes_receivable', '1611');
    keepFeatureAccounts(db);
    expect(readSetting(db, 'banking_notes_receivable')).toBe('1611');
  });

  it("the petrol station keeps the company's own 1379 its tanks were posted into, and its other settings", async () => {
    expect((await post('/api/plan/trial')).statusCode).toBe(200);
    // the company's own 1379, which 1.x took for the fuel stock (here: by the settings naming it, taken away again below)
    db.prepare("INSERT INTO accounts (code, name_ar, name_en, name_ku, \"system\", created_at) VALUES ('1379', 'وقود', 'Fuel', 'سووتەمەنی', 0, '2026-01-01T00:00:00Z')").run();
    writeSetting(db, 'fuel_settings', JSON.stringify({ stockAccount: '1379' }));
    const fuel = (await post('/api/fuel/types', { code: 'B-REG', name: { ar: 'بنزين عادي', en: 'Regular benzine', ku: 'بەنزینی ئاسایی' }, price: 850 })).json();
    const tank = await post('/api/fuel/tanks', { code: 'T1', name: 'Benzine', fuelTypeId: fuel.id, capacityMilli: L(40_000), openingMilli: L(20_000), openingCost: 780, openingDate: day(-10) });
    expect(tank.statusCode, tank.body).toBe(201);
    // 1.6: the account is the company's own, no audit row says the petrol station made it, the settings name no stock account
    writeSetting(db, 'fuel_settings', JSON.stringify({ dipToleranceBp: 80 }));
    const supplierId = (await post('/api/parties', { type: 'supplier', name: 'Kar Fuel' })).json().id;
    const delivery = { date: day(-1), tankId: tank.json().id, supplierId, noteNo: 'WS-100', qtyMilli: L(5_000), costPerLitre: 810, payment: 'credit', lang: 'en' };
    expect((await post('/api/fuel/deliveries', delivery)).json().error).toBe('fuel_stock_account_missing');

    keepFeatureAccounts(db);
    expect(JSON.parse(readSetting(db, 'fuel_settings')!)).toEqual({ dipToleranceBp: 80, stockAccount: '1379' });
    const d = await post('/api/fuel/deliveries', delivery);
    expect(d.statusCode, d.body).toBe(201);
    expect(db.prepare("SELECT COUNT(*) AS n FROM entry_lines WHERE account_code = '1379' AND entry_id = ?").get(d.json().entry.id)).toEqual({ n: 1 });
  });

  it("an own 1379 the petrol station never used stays the company's", () => {
    db.prepare("INSERT INTO accounts (code, name_ar, name_en, name_ku, \"system\", created_at) VALUES ('1379', 'أخرى', 'Other stock', 'تر', 0, '2026-01-01T00:00:00Z')").run();
    keepFeatureAccounts(db);
    expect(readSetting(db, 'fuel_settings') ?? null).toBeNull();
  });
});
