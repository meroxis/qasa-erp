import { describe, expect, it } from 'vitest';
import { checkRemembered, type Remote } from './office.ts';
import {
  findOffice, forgetOffice, MAX_OFFICES, officeMemory, officeViews, parseOffices, rememberOffice, serializeOffices, touchOffice, validRemote, type RememberedOffice
} from './office-memory.ts';

const FP = 'a'.repeat(64);
const FP2 = 'b'.repeat(64);
const lan: Remote = { host: '192.168.1.20', port: 47420, fingerprint: FP };
const relay: Remote = { host: '127.0.0.1', port: 0, fingerprint: FP2, relay: { url: 'https://relay.qasaerp.com', office: 'ABCDEFGH23' } };
const day = (d: number) => new Date(Date.UTC(2026, 10, d, 9, 40));
let n = 0;
const ids = () => (++n).toString(16).padStart(16, '0');

function files(initial: string | null = null) {
  const box = { text: initial, writes: 0 };
  return { box, memory: officeMemory({ read: () => box.text, write: (t) => { box.text = t; box.writes++; } }) };
}

describe('remembered offices (offices.json)', () => {
  it('keeps the address, the relay and the certificate fingerprint only: no pairing code, no session key, no tunnel port', () => {
    const list = rememberOffice([], { ...relay, port: 51234 }, day(15), ids);
    const text = serializeOffices(rememberOffice(list, lan, day(17), ids));
    const data = JSON.parse(text) as { offices: Record<string, unknown>[] };
    expect(data.offices).toHaveLength(2);
    for (const o of data.offices) expect(Object.keys(o).sort()).toEqual(['id', 'lastUsed', 'remote']);
    expect(data.offices[0]!.remote).toEqual(lan);
    expect(data.offices[1]!.remote).toEqual({ host: '127.0.0.1', port: 0, fingerprint: FP2, relay: { url: 'https://relay.qasaerp.com', office: 'ABCDEFGH23' } });
    expect(text).not.toMatch(/code|session|key|password|51234/i);
  });

  it('reads back only what checks out, like network.json', () => {
    const good = { id: '0123456789abcdef', lastUsed: day(17).toISOString(), remote: lan };
    const text = JSON.stringify({ offices: [
      good,
      { ...good, id: '1123456789abcdef' }, // the same office twice: the first stays
      { id: 'BAD', lastUsed: day(1).toISOString(), remote: { ...lan, host: '10.0.0.9' } },
      { id: '2123456789abcdef', lastUsed: 'yesterday', remote: { ...lan, host: '10.0.0.8' } },
      { id: '3123456789abcdef', lastUsed: day(2).toISOString(), remote: { ...lan, host: 'evil host', fingerprint: FP } },
      { id: '4123456789abcdef', lastUsed: day(2).toISOString(), remote: { ...lan, host: '10.0.0.7', fingerprint: 'abc' } },
      { id: '5123456789abcdef', lastUsed: day(2).toISOString(), remote: { ...lan, host: '10.0.0.6', port: 70000 } },
      { id: '6123456789abcdef', lastUsed: day(2).toISOString(), remote: { ...relay, relay: { url: 'http://relay.example', office: 'ABCDEFGH23' } } },
      { id: '7123456789abcdef', lastUsed: day(2).toISOString(), remote: { ...relay, relay: { url: 'https://relay.qasaerp.com', office: 'not-an-id!' } } }
    ] });
    const list = parseOffices(text)!;
    expect(list.map((o) => o.id)).toEqual(['0123456789abcdef']);
    // a relay with an http:// address isn't a relay: what is left is the tunnel's own address with no port
    expect(validRemote({ ...relay, relay: { url: 'http://relay.example', office: 'ABCDEFGH23' } })).toBeNull();
    expect(parseOffices('not json')).toEqual([]);
    expect(parseOffices('{"offices":5}')).toEqual([]);
    expect(parseOffices(null)).toBeNull();
  });

  it('keeps at most ten, the oldest going first, and the newest at the top', () => {
    let list: RememberedOffice[] = [];
    for (let i = 1; i <= MAX_OFFICES + 2; i++) list = rememberOffice(list, { ...lan, host: `10.0.0.${i}` }, day(i), ids);
    expect(list).toHaveLength(MAX_OFFICES);
    expect(list[0]!.remote.host).toBe('10.0.0.12');
    expect(list.some((o) => o.remote.host === '10.0.0.1' || o.remote.host === '10.0.0.2')).toBe(false);
  });

  it('pairing again with a new certificate replaces the old one under the same id', () => {
    const first = rememberOffice([], lan, day(1), ids);
    const again = rememberOffice(first, { ...lan, fingerprint: FP2 }, day(2), ids);
    expect(again).toHaveLength(1);
    expect(again[0]!.id).toBe(first[0]!.id);
    expect(again[0]!.remote.fingerprint).toBe(FP2);
  });

  it('touch moves "last used" only for the same server with the same certificate', () => {
    const list = rememberOffice([], lan, day(1), ids);
    expect(touchOffice(list, lan, day(9))[0]!.lastUsed).toBe(day(9).toISOString());
    expect(touchOffice(list, { ...lan, fingerprint: FP2 }, day(9))[0]!.lastUsed).toBe(day(1).toISOString());
  });

  it('shows the page a name, the address to type, the kind and the date, never a fingerprint or the relay address', () => {
    const list = rememberOffice(rememberOffice([], relay, day(15), ids), lan, day(17), ids);
    const views = officeViews(list, { ...relay, port: 51234 });
    expect(views.map(({ id: _id, ...v }) => v)).toEqual([
      { name: '192.168.1.20', address: '192.168.1.20', relay: false, lastUsed: day(17).toISOString(), current: false },
      { name: 'Qasa Relay · ABCDE-FGH23', address: 'ABCDE-FGH23', relay: true, lastUsed: day(15).toISOString(), current: true }
    ]);
    expect(JSON.stringify(views)).not.toMatch(/aaaa|bbbb|relay\.qasaerp\.com|fingerprint/);
  });

  it('finds an office only by an id of the right shape', () => {
    const list = rememberOffice([], lan, day(1), () => '00ab00cd00ef0012');
    expect(findOffice(list, list[0]!.id)).toBe(list[0]);
    for (const bad of [undefined, null, 5, {}, '', '192.168.1.20', list[0]!.id.toUpperCase(), `${list[0]!.id}0`]) expect(findOffice(list, bad)).toBeNull();
    expect(forgetOffice(list, list[0]!.id)).toEqual([]);
  });

  it('a PC paired before this version remembers its office once; after that the person’s choice stands', () => {
    const { box, memory } = files();
    memory.adopt(lan, day(1));
    expect(memory.list().map((o) => o.remote.host)).toEqual(['192.168.1.20']);
    memory.forget(memory.list()[0]!.id);
    memory.adopt(lan, day(2));
    expect(memory.list()).toEqual([]);
    expect(box.text).toBe(serializeOffices([]));
  });

  it('a new PC with no office starts an empty list, and a damaged file reads as empty', () => {
    const fresh = files();
    fresh.memory.adopt(null, day(1));
    expect(fresh.memory.list()).toEqual([]);
    const damaged = files('{{{');
    expect(damaged.memory.list()).toEqual([]);
    damaged.memory.adopt(lan, day(1)); // a file is there: nothing is added
    expect(damaged.box.writes).toBe(0);
  });
});

describe('going back to a remembered office', () => {
  it('needs the whole fingerprint before anything is sent', async () => {
    expect(await checkRemembered({ ...lan, fingerprint: FP.slice(0, 32) }, 500)).toEqual({ error: 'mismatch' });
    expect(await checkRemembered({ ...lan, fingerprint: 'not hex'.padEnd(64, 'x') }, 500)).toEqual({ error: 'mismatch' });
  });

  it('says unreachable when nothing answers', async () => {
    expect(await checkRemembered({ host: '127.0.0.1', port: 1, fingerprint: FP }, 1000)).toEqual({ error: 'unreachable' });
  });
});
