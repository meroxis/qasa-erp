import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { openDatabase, type Db } from './db.ts';
import { assetsApi, monthAmount, scheduled, startMonthOf } from './assets.ts';
import { writeSetting } from './settings.ts';

let db: Db;
let app: FastifyInstance;

const headers = { 'x-qasa-client': '1', 'x-qasa-user': encodeURIComponent('Mer Las') };
type H = Record<string, string>;
const post = (url: string, body: unknown = {}, h: H = headers) => app.inject({ method: 'POST', url, payload: body as object, headers: h });
const put = (url: string, body: unknown, h: H = headers) => app.inject({ method: 'PUT', url, payload: body as object, headers: h });
const get = (url: string, h: H = headers) => app.inject({ url, headers: h });
const del = (url: string, h: H = headers) => app.inject({ method: 'DELETE', url, headers: h });

const vehicle = (over: Record<string, unknown> = {}) => ({
  name: 'Pickup truck', assetAccount: '114', accumAccount: '231', expenseAccount: '37',
  acquired: '2025-01-10', cost: 6_000_000, salvage: 0, lifeMonths: 60, location: 'Erbil', ...over
});
const addAsset = async (over: Record<string, unknown> = {}) => {
  const res = await post('/api/assets', vehicle(over));
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
};
const run = async (period: string) => {
  const res = await post('/api/assets/depreciation', { period, lang: 'en' });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
};
const entry = async (id: string) => (await get(`/api/entries/${id}`)).json();

beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
});

describe('straight-line arithmetic', () => {
  it('starts in the acquisition month up to the 15th, else the next month', () => {
    expect(startMonthOf('2025-01-15')).toBe('2025-01');
    expect(startMonthOf('2025-01-16')).toBe('2025-02');
    expect(startMonthOf('2025-12-31')).toBe('2026-01');
  });

  it('spreads the depreciable amount so the months add up exactly', () => {
    const months = Array.from({ length: 7 }, (_, i) => scheduled(1000, 7, i + 1));
    expect(months.reduce((s, m) => s + m, 0)).toBe(1000);
    expect(Math.max(...months) - Math.min(...months)).toBeLessThanOrEqual(1);
    expect(scheduled(1000, 7, 8)).toBe(0);
  });

  it('never takes more than what is left', () => {
    const a = { acquired: '2025-01-01', cost: 1200, salvage: 0, lifeMonths: 12 };
    expect(monthAmount({ ...a, accumulated: 0 }, '2025-01')).toBe(100);
    expect(monthAmount({ ...a, accumulated: 1150 }, '2025-03')).toBe(50);
    expect(monthAmount({ ...a, accumulated: 1200 }, '2025-04')).toBe(0);
    expect(monthAmount({ ...a, accumulated: 0 }, '2024-12')).toBe(0);
    expect(monthAmount({ ...a, accumulated: 0 }, '2026-01')).toBe(0);
  });
});

describe('fixed assets', () => {
  it('registers assets with FA codes and posts nothing on registration', async () => {
    const a = await addAsset();
    const b = await addAsset({ name: 'Desk', assetAccount: '116', lifeMonths: 120 });
    expect(a.code).toBe('FA-0001');
    expect(b.code).toBe('FA-0002');
    expect(a.category).toBe('vehicles');
    expect(a.bookValue).toBe(6_000_000);
    expect(a.monthly).toBe(100_000);
    expect(a.startMonth).toBe('2025-01');
    expect((await get('/api/entries')).json()).toHaveLength(0);
  });

  it('rejects accounts outside the right groups, and bad figures', async () => {
    const bad = await post('/api/assets', vehicle({ assetAccount: '231', accumAccount: '114', expenseAccount: '49', salvage: 6_000_000 }));
    expect(bad.statusCode).toBe(400);
    const codes = bad.json().details.map((d: { code: string }) => d.code);
    expect(codes).toContain('fa_account_invalid');
    expect(codes).toContain('fa_salvage_invalid');
    expect((await post('/api/assets', vehicle({ acquired: '2999-01-01' }))).statusCode).toBe(400);
    expect((await post('/api/assets', vehicle({ openingAccum: 7_000_000 }))).statusCode).toBe(400);
  });

  it('runs a month as a balanced draft entry, Dr expense / Cr accumulated depreciation, per category', async () => {
    await addAsset();
    await addAsset({ name: 'Second truck', cost: 3_000_000 });
    await addAsset({ name: 'Office desks', assetAccount: '116', cost: 1_200_000, lifeMonths: 120 });
    await addAsset({ name: 'Plot', assetAccount: '111', cost: 50_000_000, lifeMonths: 1200 });
    await addAsset({ name: 'Bought late', acquired: '2025-01-20' });

    const preview = (await get('/api/assets/depreciation/preview?period=2025-01')).json();
    expect(preview.total).toBe(100_000 + 50_000 + 10_000); // no land, nothing yet for the one bought after the 15th
    expect(preview.lines).toHaveLength(3);

    const r = await run('2025-01');
    expect(r.total).toBe(160_000);
    const e = await entry(r.entry.id);
    expect(e.status).toBe('draft');
    expect(e.date).toBe('2025-01-31');
    const debit = e.lines.reduce((s: number, l: { debit: number }) => s + l.debit, 0);
    const credit = e.lines.reduce((s: number, l: { credit: number }) => s + l.credit, 0);
    expect(debit).toBe(160_000);
    expect(credit).toBe(160_000);
    const lines = e.lines.map((l: { accountCode: string; debit: number; credit: number }) => [l.accountCode, l.debit, l.credit]);
    expect(lines).toEqual(expect.arrayContaining([['37', 150_000, 0], ['37', 10_000, 0], ['231', 0, 150_000], ['231', 0, 10_000]]));
    expect(lines).toHaveLength(4);

    // February picks up the late one too
    expect((await get('/api/assets/depreciation/preview?period=2025-02')).json().total).toBe(260_000);
  });

  it('runs a month only once; cancelling the draft frees it', async () => {
    await addAsset();
    const r = await run('2025-01');
    const again = await post('/api/assets/depreciation', { period: '2025-01' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('fa_period_done');
    expect((await post('/api/assets/depreciation', { period: '2999-01' })).statusCode).toBe(400);

    expect((await post(`/api/assets/depreciation/${r.id}/cancel`)).statusCode).toBe(204);
    expect((await get(`/api/entries/${r.entry.id}`)).statusCode).toBe(404);
    expect((await get('/api/assets')).json()[0].accumulated).toBe(0);
    const again2 = await run('2025-01');

    // once the entry is approved, the month stays
    expect((await post(`/api/entries/${again2.entry.id}/check`)).statusCode).toBe(200);
    expect((await post(`/api/entries/${again2.entry.id}/approve`)).statusCode).toBe(200);
    expect((await post(`/api/assets/depreciation/${again2.id}/cancel`)).statusCode).toBe(409);
  });

  it('counts opening accumulated depreciation and stops at cost less salvage', async () => {
    // 1,200,000 over 12 months with 200,000 salvage → 1,000,000 depreciable; 950,000 taken before Qasa
    const a = await addAsset({ cost: 1_200_000, salvage: 200_000, lifeMonths: 12, openingAccum: 950_000 });
    expect(a.bookValue).toBe(250_000);
    const r = await run('2025-01');
    expect(r.total).toBe(50_000); // the schedule says 83,333 but only 50,000 is left
    expect((await get('/api/assets/depreciation/preview?period=2025-02')).json().total).toBe(0);
    const after = (await get(`/api/assets/${a.id}`)).json();
    expect(after.accumulated).toBe(1_000_000);
    expect(after.bookValue).toBe(200_000);
    expect(after.schedule.map((s: { state: string }) => s.state)).toEqual(['opening', 'run']);
    // figures are locked once a month has been run; the name is not
    expect((await put(`/api/assets/${a.id}`, { cost: 2_000_000 })).statusCode).toBe(409);
    expect((await put(`/api/assets/${a.id}`, { name: 'Renamed' })).json().name).toBe('Renamed');
    expect((await del(`/api/assets/${a.id}`)).statusCode).toBe(409);
  });

  it('plans the schedule to the end of the life', async () => {
    const a = await addAsset({ cost: 1_000, lifeMonths: 7, acquired: '2025-03-01' });
    await run('2025-03');
    const s = (await get(`/api/assets/${a.id}`)).json().schedule;
    expect(s.reduce((t: number, r: { amount: number }) => t + r.amount, 0)).toBe(1_000);
    expect(s.at(-1).bookValue).toBe(0);
    expect(s.length).toBe(7);
  });

  it('disposes at a gain: removes cost and accumulated depreciation, books the gain to 49', async () => {
    const a = await addAsset({ cost: 1_200_000, lifeMonths: 12, acquired: '2025-01-01' });
    await run('2025-01');
    await run('2025-02'); // 200,000 accumulated, book value 1,000,000
    const res = await post(`/api/assets/${a.id}/dispose`, { date: '2025-03-10', proceeds: 1_100_000, proceedsAccount: '1811', lang: 'en' });
    expect(res.statusCode, res.body).toBe(200);
    const d = res.json();
    expect(d.status).toBe('disposed');
    expect(d.disposal.gain).toBe(100_000);
    const e = await entry(d.disposal.entry.id);
    expect(e.status).toBe('draft');
    const lines = e.lines.map((l: { accountCode: string; debit: number; credit: number }) => [l.accountCode, l.debit, l.credit]);
    expect(lines).toEqual([['231', 200_000, 0], ['1811', 1_100_000, 0], ['114', 0, 1_200_000], ['49', 0, 100_000]]);
    // no more depreciation for it from the disposal month on
    expect((await get('/api/assets/depreciation/preview?period=2025-03')).json().total).toBe(0);
  });

  it('disposes at a loss to 39, can be taken back while a draft, and refuses months already run after it', async () => {
    const a = await addAsset({ cost: 1_200_000, lifeMonths: 12, acquired: '2025-01-01' });
    await run('2025-01');
    await run('2025-02');
    expect((await post(`/api/assets/${a.id}/dispose`, { date: '2025-01-20', lang: 'en' })).json().error).toBe('fa_runs_after_disposal');
    const d = (await post(`/api/assets/${a.id}/dispose`, { date: '2025-02-28', lang: 'en' })).json(); // scrapped, nothing received
    expect(d.disposal.gain).toBe(-1_000_000);
    const lines = (await entry(d.disposal.entry.id)).lines.map((l: { accountCode: string; debit: number; credit: number }) => [l.accountCode, l.debit, l.credit]);
    expect(lines).toEqual([['231', 200_000, 0], ['114', 0, 1_200_000], ['39', 1_000_000, 0]]);
    expect(d.actions).toEqual(['undispose']);
    const back = (await post(`/api/assets/${a.id}/undispose`)).json();
    expect(back.status).toBe('active');
    expect(back.disposal).toBeNull();
    expect((await get(`/api/entries/${d.disposal.entry.id}`)).statusCode).toBe(404);
    // proceeds need a cash, bank or debtor account
    expect((await post(`/api/assets/${a.id}/dispose`, { date: '2025-03-01', proceeds: 5, proceedsAccount: '37', lang: 'en' })).statusCode).toBe(400);
  });

  it('lets signed-in users look, and only an admin change anything', async () => {
    const a = await addAsset();
    writeSetting(db, 'trial_started', new Date().toISOString().slice(0, 10)); // more than one user is Pro
    const owner = (await get('/api/users')).json()[0].id;
    await post(`/api/users/${owner}/password`, { password: 'owner-pass-1' });
    expect((await post('/api/users', { username: 'sara', name: 'Sara', roles: ['preparer', 'checker', 'approver'], password: 'sara-pass-1' })).statusCode).toBeLessThan(300);
    expect((await put('/api/auth/signin', { on: true })).statusCode).toBe(200);
    const signIn = async (username: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: `${username}-pass-1` }, headers: { 'x-qasa-client': '1' } });
      expect(res.statusCode, res.body).toBe(200);
      return { cookie: String(res.headers['set-cookie']).split(';')[0]!, 'x-qasa-client': '1' };
    };
    const sara = await signIn('sara');
    expect((await get('/api/assets', sara)).statusCode).toBe(200);
    expect((await get(`/api/assets/${a.id}`, sara)).statusCode).toBe(200);
    expect((await post('/api/assets', vehicle(), sara)).statusCode).toBe(403);
    expect((await post('/api/assets/depreciation', { period: '2025-01' }, sara)).statusCode).toBe(403);
    expect((await post(`/api/assets/${a.id}/dispose`, { date: '2025-03-01' }, sara)).statusCode).toBe(403);
  });
});
