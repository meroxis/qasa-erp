import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { resetLoginThrottle } from './auth.ts';
import { openDatabase, type Db } from './db.ts';
import { fetchGoogleSheet, fromBase64, googleSheetCsvUrl, imageMime, MAX_IMAGE_BYTES, mediaApi, suggestAccounts, toBase64 } from './media.ts';
import { loadAccounts } from './accounts.ts';

let db: Db;
let app: FastifyInstance;
let itemId: string;

const headers = { 'x-qasa-user': encodeURIComponent('Mer Las'), 'x-qasa-client': '1' };
const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) =>
  app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body as object }) });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 8, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  itemId = (await send('POST', '/api/items', { code: 'P-1', name: { ar: 'فلتر زيت', en: 'Oil filter', ku: 'فلتەری زەیت' }, unit: 'piece', salePrice: 15000, saleCurrency: 'IQD' })).json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('item pictures', () => {
  it('knows a picture by its first bytes, not by what the client says', () => {
    expect(imageMime(PNG)).toBe('image/png');
    expect(imageMime(JPEG)).toBe('image/jpeg');
    expect(imageMime(WEBP)).toBe('image/webp');
    expect(imageMime(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
    expect(imageMime(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(fromBase64('not base64!!')).toBeNull();
    expect(Array.from(fromBase64(toBase64(JPEG))!)).toEqual(Array.from(JPEG));
  });

  it('saves, replaces, reads back and removes a picture', async () => {
    expect((await send('GET', `/api/items/${itemId}/image`)).statusCode).toBe(404);
    const saved = await send('PUT', `/api/items/${itemId}/image`, { data: toBase64(PNG) });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ mime: 'image/png', bytes: PNG.length });
    const replaced = await send('PUT', `/api/items/${itemId}/image`, { data: 'data:image/jpeg;base64,' + toBase64(JPEG) });
    expect(replaced.json().mime).toBe('image/jpeg');
    const read = (await send('GET', `/api/items/${itemId}/image`)).json();
    expect(read).toMatchObject({ itemId, mime: 'image/jpeg', data: toBase64(JPEG) });
    expect((await send('GET', '/api/item-images')).json()).toEqual([{ itemId, updatedAt: read.updatedAt }]);
    expect((await send('DELETE', `/api/items/${itemId}/image`)).statusCode).toBe(204);
    expect((await send('GET', '/api/item-images')).json()).toEqual([]);
  });

  it('refuses what isn\'t a JPEG, PNG or WebP, pictures over 400 KB, and unknown items', async () => {
    const svg = await send('PUT', `/api/items/${itemId}/image`, { data: toBase64(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')) });
    expect(svg.statusCode).toBe(400);
    expect(svg.json().details).toEqual([{ code: 'md_image_invalid' }]);
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(JPEG);
    const tooBig = await send('PUT', `/api/items/${itemId}/image`, { data: toBase64(big) });
    expect(tooBig.statusCode).toBe(400);
    expect(tooBig.json().details).toEqual([{ code: 'md_image_too_large' }]);
    expect((await send('PUT', '/api/items/nope/image', { data: toBase64(PNG) })).statusCode).toBe(404);
  });
});

describe('import', () => {
  const run = (kind: string, rows: object[], dryRun = false, options?: object) => send('POST', '/api/import', { kind, rows, dryRun, ...(options ? { options } : {}) });

  it('checks a dry run without keeping anything, then imports customers and skips those already there', async () => {
    await send('POST', '/api/parties', { type: 'customer', name: 'Sanos Company' });
    const rows = [{ name: 'Raz Store', phone: '0750 111 2222' }, { name: 'sanos company' }, { name: 'Hemn Trading', creditLimit: '5,000,000' }];
    const dry = await run('customers', rows, true);
    expect(dry.statusCode, dry.body).toBe(200);
    expect(dry.json()).toMatchObject({ dryRun: true, rows: 3, created: 2, skipped: [{ line: 3, reason: 'exists' }] });
    expect((await send('GET', '/api/parties?type=customer')).json()).toHaveLength(1);
    const real = await run('customers', rows);
    expect(real.json()).toMatchObject({ dryRun: false, created: 2 });
    const customers = (await send('GET', '/api/parties?type=customer')).json() as { name: string; creditLimit: number | null }[];
    expect(customers.map((c) => c.name).sort()).toEqual(['Hemn Trading', 'Raz Store', 'Sanos Company']);
    expect(customers.find((c) => c.name === 'Hemn Trading')!.creditLimit).toBe(5_000_000);
  });

  it('is all or nothing, with the sheet row of every problem', async () => {
    const res = await run('items', [
      { code: 'A-1', nameAr: 'بطارية', unit: 'قطعة', price: '٨٥٬٠٠٠' },
      { code: 'A-2', nameEn: 'Brake pads', unit: 'barrel', price: '12' },
      { code: 'A-1', nameKu: 'تایە', price: 'abc', currency: 'euro' },
      { code: 'A-4' }
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().details).toEqual(expect.arrayContaining([
      { code: 'md_unit_invalid', line: 3 },
      { code: 'md_currency_invalid', line: 4 },
      { code: 'md_price_invalid', line: 4 },
      { code: 'md_duplicate_in_file', line: 4, other: 2 },
      { code: 'md_name_required', line: 5 }
    ]));
    expect((await send('GET', '/api/items')).json()).toHaveLength(1);
  });

  it('imports items with one name for all three languages, words for units and currencies, and Arabic digits', async () => {
    const res = await run('items', [
      { code: 'A-1', nameAr: 'بطارية 70 أمبير', unit: 'قطعة', price: '٨٥٬٠٠٠', barcode: '٦٢٨١٠٠٠٠١' },
      { code: 'A-2', nameEn: 'Brake pads', unit: 'set', price: '12.50', currency: 'دولار' },
      { code: 'P-1', nameEn: 'Oil filter again' }
    ]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ created: 2, skipped: [{ line: 4, reason: 'exists' }] });
    const items = (await send('GET', '/api/items?q=A-')).json() as { code: string; name: Record<string, string>; salePrice: number; saleCurrency: string; barcode: string; unit: string }[];
    const battery = items.find((i) => i.code === 'A-1')!;
    expect(battery).toMatchObject({ salePrice: 85_000, saleCurrency: 'IQD', barcode: '628100001', unit: 'piece', name: { ar: 'بطارية 70 أمبير', en: 'بطارية 70 أمبير', ku: 'بطارية 70 أمبير' } });
    expect(items.find((i) => i.code === 'A-2')).toMatchObject({ salePrice: 1250, saleCurrency: 'USD', unit: 'set' });
  });

  it('makes opening stock a draft document, found by code, barcode or name', async () => {
    await send('POST', '/api/items', { code: 'P-2', barcode: '111', name: { ar: 'إطار', en: 'Tyre', ku: 'تایە' }, unit: 'piece', salePrice: 90000, saleCurrency: 'IQD' });
    const bad = await run('opening_stock', [{ item: 'P-1', qty: '10', cost: '9000' }, { item: 'nothing', qty: '1' }, { item: 'Tyre', qty: '-2' }]);
    expect(bad.json().details).toEqual([{ code: 'md_item_not_found', line: 3 }, { code: 'md_qty_invalid', line: 4 }]);
    const res = await run('opening_stock', [{ item: 'P-1', qty: '10', cost: '9,000' }, { item: '111', qty: '4.5', cost: '70000' }], false, { date: '2026-01-01' });
    expect(res.statusCode, res.body).toBe(200);
    const doc = (await send('GET', `/api/stock-docs/${res.json().documents[0].id}`)).json();
    expect(doc).toMatchObject({ kind: 'opening', status: 'draft', date: '2026-01-01', counterAccountCode: '21' });
    expect(doc.lines.map((l: { qtyMilli: number; unitCost: number }) => [l.qtyMilli, l.unitCost])).toEqual([[10_000, 9000], [4500, 70_000]]);
  });

  it('makes opening balances a balanced draft entry per currency against capital', async () => {
    const raz = (await send('POST', '/api/parties', { type: 'customer', name: 'Raz' })).json();
    await send('POST', '/api/parties', { type: 'customer', name: 'Kawan' });
    expect((await run('opening_balances', [{ party: 'Raz', amount: '1' }])).json().details).toEqual([{ code: 'md_party_type_required' }]);
    expect((await run('opening_balances', [{ party: 'Raz', amount: '100', currency: 'USD' }], false, { partyType: 'customer' })).json().details)
      .toEqual([{ code: 'md_rate_required' }]);
    const res = await run('opening_balances', [
      { party: raz.code, amount: '2,500,000' }, { party: 'kawan', amount: '(500,000)' }, { party: 'Raz', amount: '0', currency: 'USD' }
    ], false, { partyType: 'customer', date: '2026-01-01' });
    expect(res.json().details?.[0]).toMatchObject({ code: 'md_duplicate_in_file', line: 4 });
    const ok = await run('opening_balances', [{ party: raz.code, amount: '2,500,000' }, { party: 'kawan', amount: '(500,000)' }], false, { partyType: 'customer', date: '2026-01-01' });
    expect(ok.statusCode, ok.body).toBe(200);
    const entry = (await send('GET', `/api/entries/${ok.json().documents[0].id}`)).json();
    expect(entry).toMatchObject({ type: 'journal', status: 'draft', currency: 'IQD' });
    const lines = entry.lines.map((l: { accountCode: string; debit: number; credit: number; partyName: string | null }) => [l.accountCode, l.debit, l.credit, l.partyName]);
    expect(lines).toEqual([['1611', 2_500_000, 0, 'Raz'], ['1611', 0, 500_000, 'Kawan'], ['21', 0, 2_000_000, null]]);
  });

  it('refuses empty files and too many rows', async () => {
    expect((await run('customers', [])).json().details).toEqual([{ code: 'md_no_rows' }]);
    expect((await run('customers', Array.from({ length: 5001 }, (_, i) => ({ name: 'C' + i })))).statusCode).toBe(400);
  });
});

describe('who may do what, once sign-in is on', () => {
  it('lets a storekeeper change pictures, a salesperson only look, and only an admin import', async () => {
    resetLoginThrottle();
    const ownerId = (await send('GET', '/api/users')).json()[0].id;
    await send('POST', '/api/plan/trial');
    await send('POST', `/api/users/${ownerId}/password`, { password: 'owner-pass-1' });
    for (const [username, roles] of [['store', ['storekeeper']], ['sale', ['sales']]] as const) {
      expect((await send('POST', '/api/users', { username, name: username, roles, password: `${username}-pass-1` })).statusCode).toBe(201);
    }
    await send('PUT', '/api/auth/signin', { on: true });
    const as = async (username: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-qasa-client': '1' }, payload: { username, password: `${username}-pass-1` } });
      return { 'x-qasa-client': '1', cookie: String(res.headers['set-cookie']).split(';')[0]! };
    };
    const store = await as('store');
    const sale = await as('sale');
    const put = (h: Record<string, string>) => app.inject({ method: 'PUT', url: `/api/items/${itemId}/image`, headers: h, payload: { data: toBase64(PNG) } });
    expect((await put(sale)).statusCode).toBe(403);
    expect((await put(store)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/items/${itemId}/image`, headers: sale })).statusCode).toBe(200);
    const imp = await app.inject({ method: 'POST', url: '/api/import', headers: store, payload: { kind: 'customers', rows: [{ name: 'X' }], dryRun: true } });
    expect(imp.statusCode).toBe(403);
  });
});

describe('a trial balance from another program', () => {
  it('suggests where each account belongs: same code, a code it starts with, the usual words, and alike names', () => {
    const chart = loadAccounts(db);
    expect(suggestAccounts(chart, { code: '1811', name: 'whatever' })[0]).toMatchObject({ code: '1811', score: 1 });
    expect(suggestAccounts(chart, { code: '18115', name: '' })[0]!.code).toBe('1811');
    expect(suggestAccounts(chart, { name: 'الصندوق' })[0]!.code).toBe('1811');
    expect(suggestAccounts(chart, { name: 'Accounts receivable' })[0]!.code).toBe('1611');
    expect(suggestAccounts(chart, { name: 'رأس المال' })[0]!.code).toBe('21');
    expect(suggestAccounts(chart, { name: 'Furniture & office equipment' })[0]!.code).toBe('116');
    expect(suggestAccounts(chart, { name: 'zzzz qqqq' })).toEqual([]);
  });

  const rows = [
    { account: 'Cash', target: '1811', debit: '5,000,000', credit: '' },
    { account: 'Toyota pickup', target: '114', newName: 'Toyota pickup', debit: '20000000', credit: '' },
    { account: 'Capital', target: '21', debit: '', credit: '25000000' },
    { account: 'Empty', target: '1811', debit: '0', credit: '0' }
  ];

  it('makes one balanced draft opening entry, with a new sub-account where asked, all or nothing', async () => {
    const check = await send('POST', '/api/import', { kind: 'trial_balance', rows, dryRun: true });
    expect(check.statusCode, check.body).toBe(200);
    expect(check.json()).toMatchObject({ created: 3, skipped: [{ line: 5, reason: 'zero' }] });
    // the dry run made nothing, not even the sub-account
    expect(db.prepare("SELECT 1 FROM accounts WHERE code = '1141'").get()).toBeUndefined();
    const res = await send('POST', '/api/import', { kind: 'trial_balance', rows, dryRun: false });
    expect(res.statusCode, res.body).toBe(200);
    const entry = (await send('GET', `/api/entries/${res.json().documents[0].id}`)).json();
    expect(entry).toMatchObject({ status: 'draft', type: 'journal' });
    expect(entry.lines.map((l: { accountCode: string; debit: number; credit: number }) => [l.accountCode, l.debit, l.credit]))
      .toEqual([['1811', 5_000_000, 0], ['1141', 20_000_000, 0], ['21', 0, 25_000_000]]);
  });

  it('says by how much it is out of balance, or puts the difference where it is told', async () => {
    const short = rows.slice(0, 2);
    const res = await send('POST', '/api/import', { kind: 'trial_balance', rows: short, dryRun: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().details[0]).toMatchObject({ code: 'md_not_balanced', a: 25_000_000 });
    const ok = await send('POST', '/api/import', { kind: 'trial_balance', rows: short, dryRun: true, options: { counterAccountCode: '21' } });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('refuses a group account without a new sub-account, and a row with no account chosen', async () => {
    const res = await send('POST', '/api/import', { kind: 'trial_balance', dryRun: true, rows: [
      { account: 'Banks', target: '18', debit: '100', credit: '' },
      { account: 'Mystery', target: '', debit: '', credit: '100' }
    ] });
    expect(res.statusCode).toBe(400);
    expect(res.json().details).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'md_account_not_postable', line: 2 }),
      expect.objectContaining({ code: 'md_account_not_chosen', line: 3 })
    ]));
  });

  it('serves the suggestions to admins', async () => {
    const res = await send('POST', '/api/import/suggest-accounts', { accounts: [{ name: 'Bank' }, { code: '261', name: '' }] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()[0][0].code).toBe('1831');
    expect(res.json()[1][0].code).toBe('261');
  });
});

describe('a Google Sheet shared by link', () => {
  it('builds the CSV address from the sheet link only', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    expect(googleSheetCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`))
      .toBe(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=0`);
    expect(googleSheetCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=777`)).toContain('gid=777');
    expect(googleSheetCsvUrl(`https://docs.google.com/spreadsheets/d/e/2PACX-${id}/pubhtml`))
      .toBe(`https://docs.google.com/spreadsheets/d/e/2PACX-${id}/pub?output=csv&gid=0`);
    for (const bad of ['http://docs.google.com/spreadsheets/d/' + id, 'https://evil.com/spreadsheets/d/' + id, 'https://docs.google.com.evil.com/spreadsheets/d/' + id, 'https://docs.google.com/document/d/' + id, 'not a link']) {
      expect(googleSheetCsvUrl(bad)).toBeNull();
    }
  });

  const link = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit';
  const reply = (status: number, body: string, h: Record<string, string> = {}) => new Response(status >= 300 && status < 400 ? null : body, { status, headers: h });

  it('follows Google redirects, and reads the CSV', async () => {
    const seen: string[] = [];
    const fake = (async (url: string) => {
      seen.push(url);
      return seen.length === 1 ? reply(307, '', { location: 'https://doc-0s-1c.googleusercontent.com/export/abc' }) : reply(200, 'name,phone\nRaz,0750', { 'content-type': 'text/csv' });
    }) as unknown as typeof fetch;
    expect(await fetchGoogleSheet(link, fake)).toEqual({ csv: 'name,phone\nRaz,0750' });
    expect(seen[1]).toBe('https://doc-0s-1c.googleusercontent.com/export/abc');
  });

  it('never follows a redirect off Google, and says when the sheet is not shared', async () => {
    const off = (async () => reply(302, '', { location: 'http://169.254.169.254/latest' })) as unknown as typeof fetch;
    await expect(fetchGoogleSheet(link, off)).rejects.toMatchObject({ details: [{ code: 'md_sheet_not_shared' }] });
    const signIn = (async () => reply(200, '<html>Sign in</html>', { 'content-type': 'text/html; charset=utf-8' })) as unknown as typeof fetch;
    await expect(fetchGoogleSheet(link, signIn)).rejects.toMatchObject({ details: [{ code: 'md_sheet_not_shared' }] });
    await expect(fetchGoogleSheet('https://example.com/x', signIn)).rejects.toMatchObject({ details: [{ code: 'md_sheet_link_invalid' }] });
  });
});
