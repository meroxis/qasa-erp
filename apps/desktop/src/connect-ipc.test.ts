import { describe, expect, it } from 'vitest';
import { connectHandlers, type ConnectDeps } from './connect-ipc.ts';
import { officeMemory, rememberOffice, serializeOffices } from './office-memory.ts';
import type { CheckResult, PairResult, Remote } from './office.ts';

const FP = 'a'.repeat(64);
const lan: Remote = { host: '192.168.1.20', port: 47420, fingerprint: FP };
const relay: Remote = { host: '127.0.0.1', port: 0, fingerprint: 'c'.repeat(64), relay: { url: 'https://relay.qasaerp.com', office: 'ABCDEFGH23' } };
const PAGE = { from: 'connect' };
const OTHER = { from: 'app' };
const now = () => new Date(Date.UTC(2026, 10, 17, 9, 40));

function setup(opts: { offices?: Remote[]; current?: Remote | null; pair?: PairResult; check?: CheckResult } = {}) {
  const list = (opts.offices ?? []).reduce((l, r, i) => rememberOffice(l, r, new Date(Date.UTC(2026, 10, 10 + i)), () => `${i}`.padStart(16, '0')), [] as ReturnType<typeof rememberOffice>);
  const box = { text: opts.offices ? serializeOffices(list) : null as string | null };
  const calls = { saved: [] as Remote[], restarts: 0, checked: [] as Remote[], paired: [] as [string, string][], logs: [] as string[] };
  const deps: ConnectDeps<typeof PAGE> = {
    fromConnectPage: (event) => event === PAGE,
    memory: officeMemory({ read: () => box.text, write: (t) => { box.text = t; } }),
    current: () => opts.current ?? null,
    pair: async (address, code) => { calls.paired.push([address, code]); return opts.pair ?? { ok: true, remote: lan }; },
    check: async (remote) => { calls.checked.push(remote); return opts.check ?? { ok: true }; },
    useRemote: (remote) => { calls.saved.push(remote); },
    restart: () => { calls.restarts++; },
    log: (...parts) => { calls.logs.push(parts.join(' ')); },
    now
  };
  return { handlers: connectHandlers(deps), calls, box };
}

describe('the connect window’s calls', () => {
  it('answer only the connect window’s own page', async () => {
    const { handlers, calls } = setup({ offices: [lan] });
    const id = handlers.offices(PAGE)![0]!.id;
    expect(handlers.offices(OTHER)).toBeNull();
    expect(await handlers.pair(OTHER, '192.168.1.20', 'x'.repeat(32), true)).toEqual({ error: 'address' });
    expect(await handlers.use(OTHER, id)).toEqual({ error: 'gone' });
    expect(handlers.forget(OTHER, id)).toBeNull();
    expect(handlers.offices(PAGE)).toHaveLength(1);
    expect(calls.saved).toEqual([]);
    expect(calls.paired).toEqual([]);
  });

  it('pairing checks every value and remembers the office when asked to (the default)', async () => {
    const { handlers, calls, box } = setup();
    for (const [a, c, r] of [[1, 'c', true], ['a', null, true], ['a', 'c', 'yes'], ['a', 'c', undefined]] as const) {
      expect(await handlers.pair(PAGE, a, c, r)).toEqual({ error: 'address' });
    }
    expect(calls.paired).toEqual([]);
    expect(await handlers.pair(PAGE, '192.168.1.20', 'CODE', true)).toEqual({ ok: true, remote: lan });
    expect(calls.saved).toEqual([lan]);
    expect(calls.restarts).toBe(1);
    expect(handlers.offices(PAGE)!.map((o) => o.name)).toEqual(['192.168.1.20']);
    expect(box.text).not.toContain('CODE');
    expect(calls.logs.join('\n')).not.toMatch(/CODE|aaaa/);
  });

  it('pairing with "Remember" unticked connects, and an older entry for that server goes', async () => {
    const { handlers, calls } = setup({ offices: [lan, relay] });
    expect(await handlers.pair(PAGE, '192.168.1.20', 'CODE', false)).toEqual({ ok: true, remote: lan });
    expect(calls.saved).toEqual([lan]);
    expect(handlers.offices(PAGE)!.map((o) => o.name)).toEqual(['Qasa Relay · ABCDE-FGH23']);
  });

  it('a failed pairing changes nothing', async () => {
    const { handlers, calls } = setup({ pair: { error: 'mismatch' } });
    expect(await handlers.pair(PAGE, '192.168.1.20', 'CODE', true)).toEqual({ error: 'mismatch' });
    expect(calls.saved).toEqual([]);
    expect(calls.restarts).toBe(0);
    expect(handlers.offices(PAGE)).toEqual([]);
  });

  it('goes back to a remembered office by its id, after checking the saved certificate', async () => {
    const { handlers, calls } = setup({ offices: [lan, relay] });
    const office = handlers.offices(PAGE)!.find((o) => o.relay)!;
    expect(await handlers.use(PAGE, office.id)).toEqual({ ok: true });
    expect(calls.checked).toEqual([relay]);
    expect(calls.saved).toEqual([relay]);
    expect(calls.restarts).toBe(1);
    expect(handlers.offices(PAGE)![0]!.lastUsed).toBe(now().toISOString());
  });

  it('a changed certificate (or no answer) leaves this PC as it was', async () => {
    for (const error of ['mismatch', 'unreachable', 'offline', 'not_qasa'] as const) {
      const { handlers, calls } = setup({ offices: [lan], check: { error } });
      expect(await handlers.use(PAGE, handlers.offices(PAGE)![0]!.id)).toEqual({ error });
      expect(calls.saved).toEqual([]);
      expect(calls.restarts).toBe(0);
    }
  });

  it('refuses anything but a remembered office’s id: no address or certificate from the page', async () => {
    const { handlers, calls } = setup({ offices: [lan] });
    for (const bad of [undefined, 7, '192.168.1.20', { host: '10.0.0.9', fingerprint: FP }, 'f'.repeat(16), '0'.repeat(15)]) {
      expect(await handlers.use(PAGE, bad)).toEqual({ error: 'gone' });
    }
    expect(calls.checked).toEqual([]);
  });

  it('does not reconnect to the office already in use', async () => {
    const { handlers, calls } = setup({ offices: [lan], current: lan });
    const [view] = handlers.offices(PAGE)!;
    expect(view!.current).toBe(true);
    expect(await handlers.use(PAGE, view!.id)).toEqual({ error: 'current' });
    expect(calls.checked).toEqual([]);
  });

  it('forgets by id and returns the list that is left', () => {
    const { handlers } = setup({ offices: [lan, relay] });
    const [first, second] = handlers.offices(PAGE)!;
    expect(handlers.forget(PAGE, first!.id)).toEqual([second]);
    expect(handlers.forget(PAGE, 'nonsense')).toEqual([second]);
  });

  it('one check at a time', async () => {
    let release!: () => void;
    // a check that waits: a second click meanwhile is told to wait
    const waiting = new Promise<void>((r) => { release = r; });
    const gate = connectHandlersWithGate(waiting);
    const [a, b] = gate.offices(PAGE)!;
    const first = gate.use(PAGE, a!.id);
    expect(await gate.use(PAGE, b!.id)).toEqual({ error: 'busy' });
    release();
    expect(await first).toEqual({ ok: true });
  });
});

function connectHandlersWithGate(gate: Promise<void>) {
  const offices = [lan, relay].reduce((l, r, i) => rememberOffice(l, r, new Date(Date.UTC(2026, 10, 10 + i)), () => `${i}`.padStart(16, '0')), [] as ReturnType<typeof rememberOffice>);
  let text: string | null = serializeOffices(offices);
  return connectHandlers<typeof PAGE>({
    fromConnectPage: (event) => event === PAGE,
    memory: officeMemory({ read: () => text, write: (t) => { text = t; } }),
    current: () => null,
    pair: async () => ({ error: 'unreachable' }),
    check: async () => { await gate; return { ok: true }; },
    useRemote: () => {},
    restart: () => {},
    log: () => {},
    now
  });
}
