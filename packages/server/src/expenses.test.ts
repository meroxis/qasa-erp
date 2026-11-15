import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, todayIso } from '@qasa/core';
import { openDatabase, type Db } from './db.ts';
import { buildApp } from './app.ts';
import { resetLoginThrottle } from './auth.ts';
import { setLicensePublicKeyForTests } from './license.ts';
import { EXPENSE_WORDS, MAX_PHOTO_SIDE, stripJpegMetadata } from './expenses.ts';
import { getEntry, listEntries } from './journal.ts';
import { expenseAccounts, EXPENSE_CATEGORIES } from './brief.ts';
import { writeSetting } from './settings.ts';

// 1.5: an expense with the photo of its paper receipt (POST /api/expenses), as the phone app sends it

let db: Db;
let app: FastifyInstance;
type Headers = Record<string, string>;
const OWNER: Headers = { 'x-qasa-user': encodeURIComponent('Mer') };
const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, headers: Headers = OWNER) =>
  app.inject({ method, url, headers: { 'x-qasa-client': '1', ...headers }, ...(body !== undefined ? { payload: body as object } : {}) });

const today = todayIso();
const yesterday = addDays(today, -1);

/** A JPEG as a phone's camera makes one: JFIF, then (here) EXIF with a location and a comment, tables, the frame and a scan. */
function jpeg(o: { width?: number; height?: number; exif?: boolean; comment?: boolean; scan?: number; end?: boolean } = {}): Uint8Array {
  const { width = 1200, height = 1600, exif = true, comment = true, scan = 2000, end = true } = o;
  const seg = (marker: number, body: number[]) => [0xff, marker, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body];
  const text = (s: string) => [...Buffer.from(s, 'latin1')];
  const parts = [
    0xff, 0xd8,
    ...seg(0xe0, [...text('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(exif ? seg(0xe1, [...text('Exif\0\0'), ...text('GPS 36.1911N 44.0092E Raz phone model X')]) : []),
    ...(comment ? seg(0xfe, text('taken by Las at the shop')) : []),
    ...seg(0xdb, [0, ...new Array<number>(64).fill(1)]),
    ...seg(0xc0, [8, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ...seg(0xc4, [0, ...new Array<number>(16).fill(0), 0]),
    ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
    ...Array.from({ length: scan }, (_, i) => (i * 7) % 250),
    ...(end ? [0xff, 0xd9] : [])
  ];
  return new Uint8Array(parts);
}
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const contains = (hay: Uint8Array, needle: string) => Buffer.from(hay).includes(Buffer.from(needle, 'latin1'));

const expense = (extra: object = {}) => ({ category: 'fuel', amount: 75_000, currency: 'IQD', cashAccountCode: '1811', date: today, note: 'Generator diesel', lang: 'en', ...extra });

beforeEach(async () => {
  resetLoginThrottle();
  db = openDatabase(':memory:');
  app = buildApp(db);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

/** Users with these roles, signed in (the company signs in from here on), and its owner (an admin) as `owner`. */
async function signedIn(...users: { username: string; roles: string[] }[]): Promise<Record<string, Headers>> {
  // (more than one user: the trial's plan)
  writeSetting(db, 'trial_started', today);
  const owner = (await req('GET', '/api/users')).json()[0] as { id: string; username: string };
  await req('POST', `/api/users/${owner.id}/password`, { password: 'owner-pass-1' });
  for (const u of users) {
    const made = await req('POST', '/api/users', { username: u.username, name: u.username, roles: u.roles, password: `${u.username}-pass-1` });
    expect(made.statusCode, made.body).toBe(201);
  }
  expect((await req('PUT', '/api/auth/signin', { on: true })).statusCode).toBe(200);
  const out: Record<string, Headers> = {};
  for (const [name, password] of [...users.map((u) => [u.username, `${u.username}-pass-1`]), [owner.username, 'owner-pass-1']] as [string, string][]) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: name, password }, headers: { 'x-qasa-client': '1' } });
    expect(res.statusCode, res.body).toBe(200);
    out[name === owner.username ? 'owner' : name] = { cookie: String(res.headers['set-cookie']).split(';')[0]! };
  }
  return out;
}

describe('a receipt\'s photo, as the office keeps it', () => {
  it('walks the JPEG and leaves out EXIF, GPS, the other APP segments and comments; the frame and the scan stay', () => {
    const raw = jpeg();
    expect(contains(raw, 'GPS 36.1911N')).toBe(true);
    const clean = stripJpegMetadata(raw)!;
    expect(clean).not.toBeNull();
    expect(contains(clean, 'GPS')).toBe(false);
    expect(contains(clean, 'Exif')).toBe(false);
    expect(contains(clean, 'taken by Las')).toBe(false);
    expect(contains(clean, 'JFIF')).toBe(true);
    // what remains is the same picture: everything from the scan on, byte for byte
    const scanAt = (b: Uint8Array) => Buffer.from(b).indexOf(Buffer.from([0xff, 0xda]));
    expect(Buffer.from(clean.subarray(scanAt(clean))).equals(Buffer.from(raw.subarray(scanAt(raw))))).toBe(true);
    expect(clean.length).toBeLessThan(raw.length);
    // a photo without metadata comes out as it was
    const plain = jpeg({ exif: false, comment: false });
    expect(Buffer.from(stripJpegMetadata(plain)!).equals(Buffer.from(plain))).toBe(true);
  });

  it('refuses a file it can\'t walk', () => {
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(stripJpegMetadata(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBeNull();
    // a segment that says it is longer than the file
    const raw = jpeg();
    expect(stripJpegMetadata(raw.subarray(0, 30))).toBeNull();
    // no scan at all
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xd9]))).toBeNull();
  });

  it('writes the kind\'s words on the voucher in the desktop\'s own words (br_exp_*)', () => {
    const file = join(import.meta.dirname, '..', '..', '..', 'apps', 'web', 'src', 'i18n', 'brief.ts');
    expect(Object.keys(EXPENSE_WORDS.en).sort()).toEqual([...EXPENSE_CATEGORIES].sort());
    if (!existsSync(file)) return;
    const source = readFileSync(file, 'utf8');
    for (const c of EXPENSE_CATEGORIES) {
      const m = new RegExp(`br_exp_${c}: \\['([^']*)', '([^']*)', '([^']*)'\\]`).exec(source);
      expect(m, c).not.toBeNull();
      expect([EXPENSE_WORDS.ar[c], EXPENSE_WORDS.en[c], EXPENSE_WORDS.ku[c]], c).toEqual([m![1], m![2], m![3]]);
    }
  });
});

describe('an expense recorded through POST /api/expenses', () => {
  it('is a payment voucher from the safe to the account the company set for its kind, with the photo kept without its metadata', async () => {
    const res = await req('POST', '/api/expenses', expense({ photo: b64(jpeg()) }));
    expect(res.statusCode, res.body).toBe(201);
    const made = res.json();
    const accounts = expenseAccounts(db);
    expect(made).toMatchObject({ type: 'payment', status: 'draft', date: today, currency: 'IQD', cashAccountCode: '1811', description: 'Generator diesel', total: 75_000 });
    expect(made.lines.map((l: { accountCode: string; debit: number; credit: number }) => [l.accountCode, l.debit, l.credit])).toEqual([[accounts.fuel, 75_000, 0], ['1811', 0, 75_000]]);
    expect(made.lines.some((l: { partyId: string | null }) => l.partyId)).toBe(false);
    expect(made.image).toMatchObject({ createdBy: 'Mer' });
    const photo = (await req('GET', `/api/entries/${made.id}/image`)).json();
    expect(photo).toMatchObject({ mime: 'image/jpeg', createdBy: 'Mer' });
    const kept = Buffer.from(photo.data, 'base64');
    expect(kept.length).toBe(photo.bytes);
    expect(made.image.bytes).toBe(photo.bytes);
    expect(kept.includes(Buffer.from('GPS'))).toBe(false);
    expect(kept.includes(Buffer.from('JFIF'))).toBe(true);
    // the audit log says a photo was added, its size and hash (never the picture)
    const line = db.prepare("SELECT user, entity_id, details FROM audit_log WHERE action = 'attach_photo'").get() as { user: string; entity_id: string; details: string };
    expect(line).toMatchObject({ user: 'Mer', entity_id: made.id });
    expect(JSON.parse(line.details)).toMatchObject({ bytes: kept.length, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    // the journal says which vouchers have a photo; the voucher says what it is
    expect(listEntries(db).find((e) => e.id === made.id)).toMatchObject({ hasImage: true });
    expect(listEntries(db).find((e) => e.id === made.id)).not.toHaveProperty('image');
    expect(getEntry(db, made.id).image).toEqual(made.image);
  });

  it('maps each kind with the company\'s own expense accounts, and writes the kind\'s words when no note is typed', async () => {
    const accounts = expenseAccounts(db);
    for (const category of EXPENSE_CATEGORIES) {
      const made = (await req('POST', '/api/expenses', expense({ category, note: undefined, lang: 'ku' }))).json();
      expect(made.lines[0].accountCode, category).toBe(accounts[category]);
      expect(made.description, category).toBe(EXPENSE_WORDS.ku[category]);
    }
    // the company sends rent elsewhere: the next rent goes there
    const other = (await req('GET', '/api/accounts')).json().find((a: { code: string; postable: boolean }) => a.postable && a.code.startsWith('3') && a.code !== accounts.rent).code;
    expect((await req('PUT', '/api/brief/settings', { expenseAccounts: { rent: other } })).statusCode).toBe(200);
    expect((await req('POST', '/api/expenses', expense({ category: 'rent' }))).json().lines[0].accountCode).toBe(other);
    // control characters in a note become spaces
    expect((await req('POST', '/api/expenses', expense({ note: 'Fuel\u0000for\nthe generator' }))).json().description).toBe('Fuel for the generator');
  });

  it('follows the approval rules of every voucher: a draft, waiting for approval, or posted at once', async () => {
    const { las, raz, owner } = await signedIn({ username: 'las', roles: ['preparer'] }, { username: 'raz', roles: ['preparer', 'checker', 'approver'] });
    // the setting off: a preparer's is a draft; one who may approve vouchers too: a draft also (as POST /api/vouchers)
    expect((await req('POST', '/api/expenses', expense(), las)).json()).toMatchObject({ status: 'draft', approval: null });
    expect((await req('POST', '/api/expenses', expense(), raz)).json()).toMatchObject({ status: 'draft', approval: null });
    expect((await req('PUT', '/api/voucher-approval', { on: true }, owner)).statusCode).toBe(200);
    // on: a preparer's waits for approval; an approver's is posted at once
    expect((await req('POST', '/api/expenses', expense(), las)).json()).toMatchObject({ status: 'draft', approval: { state: 'waiting', requestedBy: 'las' } });
    expect((await req('POST', '/api/expenses', expense(), raz)).json()).toMatchObject({ status: 'approved', number: expect.stringMatching(/^PV-/) });
    // under separate duties nobody approves their own: a draft for someone else, as with POST /api/vouchers
    expect((await req('PUT', '/api/auth/separate-duties', { on: true }, owner)).statusCode).toBe(200);
    const own = (await req('POST', '/api/expenses', expense(), raz)).json();
    expect(own).toMatchObject({ status: 'draft', number: null });
    const voucher = (await req('POST', '/api/vouchers', { kind: 'payment', date: today, cashAccountCode: '1811', description: 'x', currency: 'IQD', rateX100: 100, items: [{ accountCode: own.lines[0].accountCode, amount: 1000 }] }, raz)).json();
    expect(own.approval).toEqual(voucher.approval);
  });

  it('needs the preparer\'s permission, as a payment voucher does', async () => {
    const { las, raz, owner } = await signedIn({ username: 'las', roles: ['sales'] }, { username: 'raz', roles: ['preparer'] });
    expect((await req('POST', '/api/expenses', expense(), las)).statusCode).toBe(403);
    expect((await req('POST', '/api/expenses', expense(), raz)).statusCode).toBe(201);
    // the photo of a voucher is the books: refused to whoever may not read them
    const made = (await req('POST', '/api/expenses', expense({ photo: b64(jpeg()) }), owner)).json();
    expect((await req('GET', `/api/entries/${made.id}/image`, undefined, las)).statusCode).toBe(403);
    expect((await req('GET', `/api/entries/${made.id}/image`, undefined, raz)).statusCode).toBe(200);
    expect((await req('GET', `/api/entries/${made.id}/image`, undefined, owner)).statusCode).toBe(200);
  });

  it('books a dollar expense at the office\'s rate of its own day, never at a rate sent with it', async () => {
    const day = (n: number) => addDays(today, -n);
    // no rate on the board yet: the company's default rate
    const defaultRate = (await req('GET', '/api/settings')).json().defaultRateX100 as number;
    const before = (await req('POST', '/api/expenses', expense({ currency: 'USD', amount: 5_000, date: day(10) }))).json();
    expect(before.rateX100).toBe(defaultRate);
    expect((await req('POST', '/api/fx/rates', { date: day(5), rateX100: 145_000 })).statusCode).toBe(201);
    expect((await req('POST', '/api/fx/rates', { date: day(2), rateX100: 147_500 })).statusCode).toBe(201);
    // that day's rate, or the latest before it
    expect((await req('POST', '/api/expenses', expense({ currency: 'USD', amount: 5_000, date: day(5) }))).json().rateX100).toBe(145_000);
    expect((await req('POST', '/api/expenses', expense({ currency: 'USD', amount: 5_000, date: day(3) }))).json().rateX100).toBe(145_000);
    const latest = (await req('POST', '/api/expenses', expense({ currency: 'USD', amount: 5_000, date: today }))).json();
    expect(latest.rateX100).toBe(147_500);
    // $50.00 at 1,475 dinars a dollar
    expect(latest.baseTotal).toBe(73_750);
    // a rate in the body is refused (the form has none)
    const named = await req('POST', '/api/expenses', expense({ currency: 'USD', rateX100: 100 }));
    expect(named.statusCode).toBe(400);
  });

  it('refuses a day still to come, a body with anything else in it, and a safe that is not one', async () => {
    const future = await req('POST', '/api/expenses', expense({ date: addDays(today, 1) }));
    expect(future.statusCode).toBe(400);
    expect(future.json().details).toEqual([{ code: 'date_future' }]);
    expect((await req('POST', '/api/expenses', expense({ partyId: 'x' }))).statusCode).toBe(400);
    expect((await req('POST', '/api/expenses', expense({ accountCode: '1811' }))).statusCode).toBe(400);
    expect((await req('POST', '/api/expenses', expense({ category: 'gifts' }))).statusCode).toBe(400);
    const notSafe = await req('POST', '/api/expenses', expense({ cashAccountCode: '33' }));
    expect(notSafe.statusCode).toBe(400);
    expect(JSON.stringify(notSafe.json().details)).toContain('cash_account_invalid');
    expect((await req('POST', '/api/expenses', expense({ date: yesterday }))).statusCode).toBe(201);
  });

  it('takes a JPEG only, whole, up to 400 KB and 2048 pixels a side', async () => {
    const refused = async (photo: string) => {
      const res = await req('POST', '/api/expenses', expense({ photo }));
      expect(res.statusCode, res.body).toBe(400);
      return (res.json().details as { code: string }[])[0]!.code;
    };
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(40).fill(0)]);
    expect(await refused(png.toString('base64'))).toBe('photo_invalid');
    expect(await refused('not base64 at all!')).toBe('photo_invalid');
    // cut off before its end
    expect(await refused(b64(jpeg({ end: false })))).toBe('photo_invalid');
    // a small file that says it is 4000 × 4000 pixels
    expect(await refused(b64(jpeg({ width: 4000, height: 3000 })))).toBe('photo_invalid');
    expect(await refused(b64(jpeg({ width: MAX_PHOTO_SIDE + 1, height: 100 })))).toBe('photo_invalid');
    expect(await refused(b64(jpeg({ scan: 401 * 1024 })))).toBe('photo_too_large');
    // more text than a 400 KB photo can be: refused before it is read
    expect(await refused('A'.repeat(560_004))).toBe('schema');
    // nothing of a refused one was kept
    expect(listEntries(db)).toEqual([]);
    expect((await req('POST', '/api/expenses', expense({ photo: b64(jpeg({ width: MAX_PHOTO_SIDE, height: MAX_PHOTO_SIDE, scan: 350 * 1024 })) }))).statusCode).toBe(201);
  });

  it('makes one voucher and keeps one photo when the same request comes again with its key', async () => {
    const key = { ...OWNER, 'x-qasa-idempotency': '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4' };
    const body = expense({ photo: b64(jpeg()) });
    const first = await req('POST', '/api/expenses', body, key);
    const second = await req('POST', '/api/expenses', body, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(first.json().id);
    expect(second.json().image).toEqual(first.json().image);
    expect(listEntries(db)).toHaveLength(1);
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM entry_images').get() as { n: number }).n)).toBe(1);
  });

  it('a deleted draft takes its photo with it; a posted voucher keeps its photo, which is never changed', async () => {
    const draft = (await req('POST', '/api/expenses', expense({ photo: b64(jpeg()) }))).json();
    expect((await req('DELETE', `/api/entries/${draft.id}`)).statusCode).toBe(204);
    expect(db.prepare('SELECT 1 FROM entry_images WHERE entry_id = ?').get(draft.id)).toBeUndefined();
    expect((await req('GET', `/api/entries/${draft.id}/image`)).statusCode).toBe(404);

    const kept = (await req('POST', '/api/expenses', expense({ photo: b64(jpeg()) }))).json();
    expect((await req('POST', `/api/entries/${kept.id}/check`)).statusCode).toBe(200);
    expect((await req('POST', `/api/entries/${kept.id}/approve`)).statusCode).toBe(200);
    expect(() => db.prepare('UPDATE entry_images SET created_by = ? WHERE entry_id = ?').run('Raz', kept.id)).toThrow(/entry_image_is_permanent/);
    expect(() => db.prepare('DELETE FROM entry_images WHERE entry_id = ?').run(kept.id)).toThrow(/entry_image_is_permanent/);
    expect((await req('GET', `/api/entries/${kept.id}/image`)).json()).toMatchObject({ mime: 'image/jpeg' });
    // a voucher without a photo answers so
    const bare = (await req('POST', '/api/expenses', expense())).json();
    expect(bare.image).toBeNull();
    const none = await req('GET', `/api/entries/${bare.id}/image`);
    expect(none.statusCode).toBe(404);
    expect(none.json()).toMatchObject({ error: 'not_found', details: { what: 'entry_image' } });
  });
});

describe('an expense by a user limited to a branch', () => {
  let businessKey: string;
  beforeAll(() => {
    const pair = generateKeyPairSync('ed25519');
    setLicensePublicKeyForTests(pair.publicKey.export({ format: 'jwk' }).x!);
    const body = `QASA1.${Buffer.from(JSON.stringify({ v: 1, id: 'QL-TEST-business', plan: 'business', to: 'Test Company', issued: '2026-01-01', expires: null })).toString('base64url')}`;
    businessKey = `${body}.${sign(null, Buffer.from(body), pair.privateKey).toString('base64url')}`;
  });

  it('is paid from a safe of that branch only', async () => {
    expect((await req('POST', '/api/plan/license', { key: businessKey })).statusCode).toBe(200);
    const erbil = (await req('POST', '/api/warehouses', { code: 'ERB', name: { ar: 'أربيل', en: 'Erbil', ku: 'هەولێر' } })).json().id;
    expect((await req('POST', '/api/accounts', { parentCode: '181', code: '1812', name: { ar: 'قاصة أربيل', en: 'Erbil safe', ku: 'قاسەی هەولێر' } })).statusCode).toBe(201);
    const branch = (await req('POST', '/api/branches', { code: 'ERB', name: 'Erbil', city: 'Erbil' })).json().id;
    expect((await req('PUT', `/api/branches/${branch}/warehouses`, { warehouseIds: [erbil] })).statusCode).toBe(200);
    expect((await req('PUT', `/api/branches/${branch}/accounts`, { accounts: ['1812'] })).statusCode).toBe(200);
    const { las, owner } = await signedIn({ username: 'las', roles: ['preparer'] });
    const lasId = (await req('GET', '/api/users', undefined, owner)).json().find((u: { username: string }) => u.username === 'las').id;
    expect((await req('PUT', `/api/users/${lasId}/branches`, { branchIds: [branch] }, owner)).statusCode).toBe(200);
    expect((await req('POST', '/api/expenses', expense({ cashAccountCode: '1811' }), las)).statusCode).toBe(403);
    expect((await req('POST', '/api/expenses', expense({ cashAccountCode: '1812' }), las)).statusCode).toBe(201);
  });
});
