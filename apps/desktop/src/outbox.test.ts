import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeSecretBox } from './secrets.ts';
import { newPcCode, offlineReference, OUTBOX_MAX_BODY, openOutbox, OutboxRefusal, PC_CODE, registerTag, writeDurably, type NewOutboxEntry } from './outbox.ts';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'qasa-outbox-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const KEY = randomBytes(32).toString('hex');
const SERVER = 'ab'.repeat(32);
const BOOKS = 'cd'.repeat(16);
const box = (key = KEY) => makeSecretBox(key, tmp());
/** The list's code in a reference: OFF-<register>-<code>-0001. */
const codeOf = (reference: string | null) => reference?.split('-')[2] ?? '';

const sale = (over: Partial<NewOutboxEntry> = {}): NewOutboxEntry => ({
  id: randomUUID(), kind: 'pos_sale', path: '/api/pos/shifts/0c6f7d1e-1111-4222-8333-944455556666/sales',
  body: { currency: 'IQD', discount: 0, lines: [{ itemId: 'tea', qtyMilli: 2000, unitPrice: 2_500 }] }, books: BOOKS,
  user: { id: 'u-mer', name: 'Mer' }, summary: { total: 5_000, currency: 'IQD', lines: 1, register: 'Counter 1' }, ...over
});

describe('the outbox of a PC on the office network', () => {
  it('keeps what waits encrypted on disk, in order, and gives each till sale a temporary reference per register', () => {
    const dir = tmp();
    const secrets = box();
    const store = openOutbox({ dir, server: SERVER, box: secrets });
    const at = new Date(2026, 10, 11, 9, 30, 0);
    const a = store.add(sale(), at);
    const b = store.add(sale({ body: { currency: 'IQD', notes: 'Raz', lines: [] } }), at);
    const other = store.add(sale({ summary: { total: 1_000, currency: 'IQD', lines: 1, register: 'الكاشير 2' } }), at);
    // the register, this list's own code, and the count
    const pc = codeOf(a.reference);
    expect(pc).toMatch(PC_CODE);
    expect([a.reference, b.reference, other.reference]).toEqual([`OFF-Counter1-${pc}-0001`, `OFF-Counter1-${pc}-0002`, `OFF-الكاشير2-${pc}-0001`]);
    // the sale carries its reference and the till's time and date when it was sold
    expect(a.body.offline).toEqual({ reference: `OFF-Counter1-${pc}-0001`, soldAt: at.toISOString(), soldOn: '2026-11-11' });
    const voucher = store.add({ ...sale(), kind: 'voucher', path: '/api/vouchers', body: { kind: 'receipt', items: [] } }, at);
    expect(voucher.reference).toBeNull();
    expect(voucher.body.offline).toBeUndefined();
    expect(store.list().map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(store.status()).toEqual({ available: true, waiting: 4, refused: 0, damaged: false });

    // nothing readable on disk: not the names, the amounts or the items
    const files = readdirSync(dir);
    expect(files).toEqual([`outbox-${SERVER.slice(0, 16)}.qob`]);
    const raw = readFileSync(join(dir, files[0]!), 'utf8');
    expect(raw).toMatch(/^q1:/);
    // (words long enough that random ciphertext never spells them by chance)
    for (const word of ['u-mer', 'itemId', 'qtyMilli', 'pos_sale', '/api/pos', 'Counter', 'register']) expect(raw).not.toContain(word);

    // a restart (the same Windows user) finds them all, and the count goes on
    const again = openOutbox({ dir, server: SERVER, box: secrets });
    expect(again.list().map((e) => e.id)).toEqual([a.id, b.id, other.id, voucher.id]);
    expect(again.add(sale(), at).reference).toBe(`OFF-Counter1-${pc}-0003`);
    // another Windows user (another key) can't read it, and it is kept aside, not written over
    const stranger = openOutbox({ dir, server: SERVER, box: box(randomBytes(32).toString('hex')) });
    expect(stranger.list()).toEqual([]);
    expect(stranger.status().damaged).toBe(true);
    expect(readdirSync(dir).some((f) => f.includes('.damaged-'))).toBe(true);
  });

  it('survives a crash in the middle of a write: the last complete list, or the newer one when it was written whole', () => {
    const dir = tmp();
    const secrets = box();
    const store = openOutbox({ dir, server: SERVER, box: secrets });
    const first = store.add(sale());
    const file = join(dir, `outbox-${SERVER.slice(0, 16)}.qob`);

    // the power went while the new copy was being written: half a file beside the old one
    writeFileSync(`${file}.next`, readFileSync(file, 'utf8').slice(0, 40));
    const afterCut = openOutbox({ dir, server: SERVER, box: secrets });
    expect(afterCut.list().map((e) => e.id)).toEqual([first.id]);
    expect(existsSync(`${file}.next`)).toBe(false);

    // the power went after the new copy was on the disk, before it replaced the old one: the newer one counts
    const before = readFileSync(file, 'utf8');
    const second = sale();
    const text = (() => {
      // what add() would write, made by a store in another folder that is then copied as the half-done write
      const side = tmp();
      writeFileSync(join(side, `outbox-${SERVER.slice(0, 16)}.qob`), before);
      const s = openOutbox({ dir: side, server: SERVER, box: secrets });
      s.add(second);
      return readFileSync(join(side, `outbox-${SERVER.slice(0, 16)}.qob`), 'utf8');
    })();
    writeFileSync(`${file}.next`, text);
    expect(readFileSync(file, 'utf8')).toBe(before);
    const restarted = openOutbox({ dir, server: SERVER, box: secrets });
    expect(restarted.list().map((e) => e.id)).toEqual([first.id, second.id]);
    expect(restarted.status().damaged).toBe(false);
  });

  it('writes a new file before it replaces the old one, so a failure half way changes nothing', () => {
    const dir = tmp();
    const file = join(dir, 'x.qob');
    writeDurably(file, 'one');
    expect(() => writeDurably(file, 'two', { afterWrite: () => { throw new Error('power cut'); } })).toThrow('power cut');
    expect(readFileSync(file, 'utf8')).toBe('one');
    writeDurably(file, 'three');
    expect(readFileSync(file, 'utf8')).toBe('three');
    expect(readdirSync(dir)).toEqual(['x.qob']);
  });

  it('removes what was sent, keeps a refusal for a person, counts failures, and a retry or a discard is a person\'s', () => {
    const store = openOutbox({ dir: tmp(), server: SERVER, box: box() });
    const a = store.add(sale());
    const b = store.add(sale());
    const c = store.add(sale());
    expect(store.result(a.id, { kind: 'sent' })).toBeNull();
    const refused = store.result(b.id, { kind: 'refused', error: { status: 400, code: 'validation', details: [{ code: 'stock_insufficient', line: 1 }] } })!;
    expect(refused).toMatchObject({ state: 'refused', attempts: 1, error: { status: 400, code: 'validation' } });
    expect(store.result(c.id, { kind: 'failed' })).toMatchObject({ state: 'waiting', attempts: 1, error: null });
    expect(store.status()).toMatchObject({ waiting: 1, refused: 1 });
    expect(store.retry(b.id)).toMatchObject({ state: 'waiting', attempts: 0 });
    store.discard(c.id);
    expect(store.list().map((e) => e.id)).toEqual([b.id]);
    expect(() => store.discard(c.id)).toThrow(OutboxRefusal);
    expect(store.result('nope', { kind: 'sent' })).toBeNull();
  });

  it('checks everything the window hands it', () => {
    const store = openOutbox({ dir: tmp(), server: SERVER, box: box() });
    const bad: Partial<NewOutboxEntry>[] = [
      { id: 'not-a-key' }, { kind: 'payment' as never }, { path: '/api/users' }, { path: '/api/pos/shifts/../../x/sales' },
      { kind: 'voucher', path: '/api/pos/shifts/x/sales' }, { books: 'nope' }, { body: [] as never }, { body: null as never },
      { summary: { total: -1, currency: 'IQD', lines: 1 } }, { summary: { total: 1, currency: 'EUR' as never, lines: 1 } },
      { body: { notes: 'x'.repeat(OUTBOX_MAX_BODY) } }
    ];
    for (const over of bad) expect(() => store.add(sale(over)), JSON.stringify(over).slice(0, 80)).toThrow(OutboxRefusal);
    const one = sale();
    store.add(one);
    expect(() => store.add(one)).toThrow(expect.objectContaining({ code: 'outbox_duplicate' }));
    expect(store.list()).toHaveLength(1);
    // a name with control characters is cleaned
    expect(store.add(sale({ user: { id: null, name: 'Las\u0000\n' } })).user).toEqual({ id: null, name: 'Las' });
  });

  it('keeps one list per office server: another server never gets this one\'s', () => {
    const dir = tmp();
    const secrets = box();
    openOutbox({ dir, server: SERVER, box: secrets }).add(sale());
    expect(openOutbox({ dir, server: 'ef'.repeat(32), box: secrets }).list()).toEqual([]);
    expect(openOutbox({ dir, server: SERVER, box: secrets }).list()).toHaveLength(1);
    expect(() => openOutbox({ dir, server: 'nope', box: secrets })).toThrow(OutboxRefusal);
  });

  it('without a key from Windows it keeps nothing in the clear', () => {
    const store = openOutbox({ dir: tmp(), server: SERVER, box: makeSecretBox(null, tmp()) });
    expect(() => store.add(sale())).toThrow(/cannot protect/);
    expect(store.list()).toEqual([]);
  });

  it('never prints the same reference twice: not from two PCs on one register, nor after a list is made again', () => {
    const at = new Date(2026, 10, 11, 9, 30, 0);
    const secrets = box();
    // two PCs (each its own list) selling on the same register, on the same day or another
    const pc1 = openOutbox({ dir: tmp(), server: SERVER, box: secrets });
    const pc2 = openOutbox({ dir: tmp(), server: SERVER, box: secrets });
    const one = [pc1.add(sale(), at), pc1.add(sale(), at)].map((e) => e.reference);
    const two = [pc2.add(sale(), at), pc2.add(sale(), at)].map((e) => e.reference);
    expect(codeOf(one[0]!)).not.toBe(codeOf(two[0]!));
    expect(new Set([...one, ...two]).size).toBe(4);
    // registers whose names are alike in their first 16 letters and digits, or differ by a space or a dash, share one count
    const store = openOutbox({ dir: tmp(), server: SERVER, box: secrets });
    const names = ['صندوق الفرع الرئيسي 1', 'صندوق الفرع الرئيسي 2', 'Till 1', 'Till-1'];
    expect(registerTag(names[0])).toBe(registerTag(names[1]));
    const refs = names.map((register) => store.add(sale({ summary: { total: 1_000, currency: 'IQD', lines: 1, register } }), at).reference);
    expect(new Set(refs).size).toBe(4);
    expect(refs.map((r) => r!.slice(-4))).toEqual(['0001', '0002', '0001', '0002']);
    // the list made again (the old one could not be read and was kept aside): its count starts from 1 under a new code
    const dir = tmp();
    const first = openOutbox({ dir, server: SERVER, box: secrets }).add(sale(), at).reference;
    const fresh = openOutbox({ dir, server: SERVER, box: box(randomBytes(32).toString('hex')) });
    expect(fresh.status().damaged).toBe(true);
    const after = fresh.add(sale(), at).reference;
    expect(after!.slice(-4)).toBe('0001');
    expect(after).not.toBe(first);
    // and for another office server's certificate (another list)
    expect(openOutbox({ dir, server: 'ef'.repeat(32), box: secrets }).add(sale(), at).reference).not.toBe(first);
  });

  it("keeps the list's code across restarts, and gives a list from before the code one of its own", () => {
    const dir = tmp();
    const secrets = box();
    const at = new Date(2026, 10, 11, 9, 30, 0);
    const code = codeOf(openOutbox({ dir, server: SERVER, box: secrets }).add(sale(), at).reference);
    expect(codeOf(openOutbox({ dir, server: SERVER, box: secrets }).add(sale(), at).reference)).toBe(code);
    // a list written before the code: it reads, and goes on with a code from then on
    const file = join(dir, `outbox-${SERVER.slice(0, 16)}.qob`);
    const saved = JSON.parse(secrets.reveal(readFileSync(file, 'utf8'))) as Record<string, unknown>;
    delete saved.pc;
    writeFileSync(file, secrets.protect(JSON.stringify(saved)));
    const old = openOutbox({ dir, server: SERVER, box: secrets });
    expect(old.list()).toHaveLength(2);
    const next = old.add(sale(), at).reference!;
    expect(codeOf(next)).toMatch(PC_CODE);
    expect(next.slice(-4)).toBe('0003');
    expect(codeOf(openOutbox({ dir, server: SERVER, box: secrets }).add(sale(), at).reference)).toBe(codeOf(next));
  });

  it("makes list codes from letters and digits that can't be misread, at random", () => {
    const codes = Array.from({ length: 200 }, () => newPcCode());
    for (const c of codes) expect(c).toMatch(PC_CODE);
    expect(codes.join('')).not.toMatch(/[ILOU]/);
    expect(new Set(codes).size).toBe(200);
    expect(offlineReference('Counter1', 'K7Q3MX', 12)).toBe('OFF-Counter1-K7Q3MX-0012');
    // what the office server takes (packages/server/src/pos.ts, OFFLINE_REFERENCE)
    const server = /^OFF-[\p{L}\p{N}]{1,16}-(?:[0-9A-HJKMNP-TV-Z]{6}-)?\d{4,9}$/u;
    expect(offlineReference(registerTag('صندوق الفرع الرئيسي 1'), newPcCode(), 1)).toMatch(server);
    expect(offlineReference(registerTag(null), newPcCode(), 123_456_789)).toMatch(server);
  });

  it('names a register by its letters and digits, in any script', () => {
    expect(registerTag('Counter 1')).toBe('Counter1');
    expect(registerTag('کاشێر 3')).toBe('کاشێر3');
    expect(registerTag('  --  ')).toBe('R');
    expect(registerTag('A'.repeat(40))).toHaveLength(16);
    expect(registerTag(null)).toBe('R');
  });
});
