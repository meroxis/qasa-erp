import { describe, expect, it } from 'vitest';
import { OfficeError, officeApi } from '../src/api';
import { LinkError, OfficeLink } from '../src/link';
import { Outbox, OUTBOX_MAX, openOutbox, outcomeOf, sealOutbox, type OutboxItem, type OutboxStorage } from '../src/outbox';
import { generateKeyPair } from '../src/protocol';
import { UUID_V4 } from '../src/uuid';
import { fakeOffice, waitFor } from './fake-office';

/** The phone's storage in the test: a file and a secure-storage key, in memory (what store.ts keeps on the phone). */
function memory(): OutboxStorage & { file: string | null; key: string | null } {
  const m = {
    file: null as string | null,
    key: null as string | null,
    read: async () => m.file,
    write: async (text: string) => { m.file = text; },
    remove: async () => { m.file = null; },
    readKey: async () => m.key,
    writeKey: async (k: string) => { m.key = k; },
    removeKey: async () => { m.key = null; }
  };
  return m;
}

const summary = { title: 'Las', amount: 10_000, currency: 'IQD' as const };

describe('the outbox on the phone', () => {
  it('is written encrypted before anything is sent, and read back after the app starts again', async () => {
    const disk = memory();
    const box = new Outbox(disk);
    await box.load();
    const item = await box.add('sale', { kind: 'sale', notes: 'Mer' }, { title: 'Mer — كابل — کێبڵ', amount: 5000, currency: 'IQD' });
    expect(item.id).toMatch(UUID_V4);
    expect(disk.file).toMatch(/^qasa-outbox:1:/);
    // nothing readable on the disk: not the customer, not the body
    expect(disk.file).not.toContain('Mer');
    expect(disk.key).toBeTruthy();

    const again = new Outbox(disk);
    const list = await again.load();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: item.id, kind: 'sale', body: { kind: 'sale', notes: 'Mer' }, summary: { title: 'Mer — كابل — کێبڵ' }, attempts: 0 });
  });

  it('can\'t be read with another key or after a change to the file', async () => {
    const key = new Uint8Array(32).fill(1);
    const items: OutboxItem[] = [{ id: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4', kind: 'receipt', body: {}, summary, createdAt: '2026-11-11T10:00:00Z', attempts: 0 }];
    const sealed = sealOutbox(items, key);
    expect(openOutbox(sealed, key)).toEqual(items);
    expect(openOutbox(sealed, new Uint8Array(32).fill(2))).toBeNull();
    const altered = sealed.slice(0, -3) + (sealed.endsWith('A') ? 'B' : 'A') + sealed.slice(-2);
    expect(openOutbox(altered, key)).toBeNull();
    expect(openOutbox('{"plain":true}', key)).toBeNull();
    // a file that can't be read: a new, empty outbox (nothing crashes)
    const disk = memory();
    disk.key = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
    disk.file = altered;
    expect(await new Outbox(disk).load()).toEqual([]);
  });

  it('counts the office\'s answers: away or busy waits, a refusal is kept with its reason', () => {
    expect(outcomeOf(new LinkError('closed'))).toBe('wait');
    expect(outcomeOf(new LinkError('timeout'))).toBe('wait');
    expect(outcomeOf(new OfficeError(503, 'error', null))).toBe('wait');
    expect(outcomeOf(new OfficeError(429, 'too_many_attempts', null))).toBe('wait');
    expect(outcomeOf(new OfficeError(409, 'in_progress', null))).toBe('wait');
    expect(outcomeOf(new OfficeError(409, 'period_locked', null))).toEqual({ refused: 'period_locked' });
    expect(outcomeOf(new OfficeError(403, 'forbidden', null))).toEqual({ refused: 'forbidden' });
    expect(outcomeOf(new OfficeError(400, 'validation', null))).toEqual({ refused: 'validation' });
  });

  it('sends oldest first, stops at the first that must wait, keeps refusals aside, and retries them when asked', async () => {
    const disk = memory();
    const changes: string[] = [];
    const box = new Outbox(disk, (items) => changes.push(items.map((i) => i.kind).join(',')));
    await box.load();
    const a = await box.add('sale', { n: 1 }, summary);
    const b = await box.add('receipt', { n: 2 }, summary);
    const c = await box.add('count', { n: 3 }, summary);
    const tried: string[] = [];
    // a is refused, b can't go now: c waits behind b
    const result = await box.replay(async (item) => {
      tried.push(item.id);
      if (item.id === a.id) throw new OfficeError(403, 'forbidden', null);
      if (item.id === b.id) throw new LinkError('closed');
    });
    expect(result).toEqual({ sent: 0, refused: 1 });
    expect(tried).toEqual([a.id, b.id]);
    expect(box.list().map((i) => [i.kind, i.error ?? null, i.attempts])).toEqual([['sale', 'forbidden', 1], ['receipt', null, 1], ['count', null, 0]]);
    expect(box.waiting()).toBe(2);

    // the office is back: b and c go, a stays until the user asks
    expect(await box.replay(async () => {})).toEqual({ sent: 2, refused: 0 });
    expect(box.list().map((i) => i.id)).toEqual([a.id]);
    await box.retry(a.id);
    expect(await box.replay(async () => {})).toEqual({ sent: 1, refused: 0 });
    expect(box.list()).toEqual([]);
    expect(changes.length).toBeGreaterThan(3);
  });

  it('keeps one run at a time, and a full outbox refuses more', async () => {
    const box = new Outbox(memory());
    await box.load();
    await box.add('sale', {}, summary);
    let running = 0;
    let most = 0;
    const send = async () => { running++; most = Math.max(most, running); await new Promise((r) => setTimeout(r, 10)); running--; };
    await Promise.all([box.replay(send), box.replay(send), box.replay(send)]);
    expect(most).toBe(1);

    const full = new Outbox(memory());
    await full.load();
    for (let i = 0; i < OUTBOX_MAX; i++) await full.add('count', {}, summary);
    await expect(full.add('count', {}, summary)).rejects.toThrow(/outbox_full/);
  });

  it('is wiped with its key when the phone is unpaired', async () => {
    const disk = memory();
    const box = new Outbox(disk);
    await box.load();
    await box.add('sale', {}, summary);
    await box.wipe();
    expect(disk.file).toBeNull();
    expect(disk.key).toBeNull();
    expect(box.list()).toEqual([]);
  });

  it('a sale whose answer was lost is sent again with the same key, so the office makes it once', async () => {
    const made = new Map<string, number>();
    let loseNext = true;
    const o = fakeOffice({
      reply: (m) => {
        const k = String(m.k);
        if (!made.has(k)) made.set(k, made.size + 1);
        // the first answer never comes back (the Wi-Fi dropped right after the office made the sale)
        if (loseNext) { loseNext = false; return null; }
        return { s: 201, b: { id: `inv-${made.get(k)}` } };
      }
    });
    const link = new OfficeLink({ office: o.office, phone: generateKeyPair(), name: 'Raz', socket: o.socket, reconnectMs: [10] });
    const api = officeApi(link);
    const box = new Outbox(memory());
    await box.load();
    const item = await box.add('sale', { kind: 'sale' }, summary);
    const send = async (i: OutboxItem) => { await api.draftSale(i.body, i.id); };

    // first try: no answer within the time → the link is closed and the sale waits (shortened here by dropping it)
    const first = box.sendOne(item.id, send);
    await waitFor(() => o.seen.some((m) => m.k === item.id));
    for (const s of o.sockets) s.close();
    expect(await first).toBe('wait');
    expect(box.waiting()).toBe(1);

    await waitFor(() => link.state === 'online');
    expect(await box.replay(send)).toEqual({ sent: 1, refused: 0 });
    const tries = o.seen.filter((m) => m.m === 'POST');
    expect(tries).toHaveLength(2);
    expect(tries.every((m) => m.k === item.id)).toBe(true);
    expect(made.size).toBe(1);
    link.close();
  });
});
