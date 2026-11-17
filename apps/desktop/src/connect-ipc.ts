/**
 * What the "Connect to an office server" window may ask of the app (main.ts wires these to ipcMain; no Electron here,
 * so they can be tested on their own). Every call comes from that window's page only, and every value it sends is
 * checked here: an address and a pairing code (as before), whether to remember the office, and a remembered office's
 * id. The page can never name a host or a certificate to trust: a remembered office is looked up here by its id, and
 * this PC goes back to it only when the server shows exactly the certificate it was paired with.
 */
import type { CheckResult, PairResult, Remote } from './office.ts';
import { findOffice, officeViews, placeKey, type OfficeView, type officeMemory } from './office-memory.ts';

type Memory = ReturnType<typeof officeMemory>;

export type UseResult = { ok: true } | { error: 'gone' | 'current' | 'busy' | 'unreachable' | 'mismatch' | 'not_qasa' | 'offline' };

export interface ConnectDeps<E> {
  /** The call came from the connect window's own page. */
  fromConnectPage(event: E): boolean;
  memory: Memory;
  /** The office server this PC works on now (null: its own company file). */
  current(): Remote | null;
  pair(address: string, code: string): Promise<PairResult>;
  check(remote: Remote): Promise<CheckResult>;
  /** network.json: this PC works on that office server from its next start. */
  useRemote(remote: Remote): void;
  /** Restarts the app (after the page has had a moment to say so). */
  restart(): void;
  log(...parts: unknown[]): void;
  now?: () => Date;
}

export function connectHandlers<E>(deps: ConnectDeps<E>) {
  const now = deps.now ?? (() => new Date());
  let busy = false;
  const views = (): OfficeView[] => officeViews(deps.memory.list(), deps.current());

  return {
    offices(event: E): OfficeView[] | null {
      return deps.fromConnectPage(event) ? views() : null;
    },

    async pair(event: E, address: unknown, code: unknown, remember: unknown): Promise<PairResult> {
      if (!deps.fromConnectPage(event) || typeof address !== 'string' || typeof code !== 'string' || typeof remember !== 'boolean') return { error: 'address' };
      if (busy) return { error: 'unreachable' };
      busy = true;
      try {
        const result = await deps.pair(address.slice(0, 300), code.slice(0, 100));
        if ('ok' in result) {
          deps.useRemote(result.remote);
          if (remember) deps.memory.remember(result.remote, now());
          else deps.memory.forgetPlace(result.remote);
          deps.log(result.remote.relay ? `paired with office ${result.remote.relay.office} through Qasa Relay` : `paired with the office server ${result.remote.host}:${result.remote.port}`);
          deps.restart();
        }
        return result;
      } finally {
        busy = false;
      }
    },

    async use(event: E, id: unknown): Promise<UseResult> {
      if (!deps.fromConnectPage(event)) return { error: 'gone' };
      const office = findOffice(deps.memory.list(), id);
      if (!office) return { error: 'gone' };
      const current = deps.current();
      if (current && placeKey(current) === placeKey(office.remote) && current.fingerprint === office.remote.fingerprint) return { error: 'current' };
      if (busy) return { error: 'busy' };
      busy = true;
      try {
        // the saved certificate, and nothing else: a changed one needs the pairing code again
        const checked = await deps.check(office.remote);
        if ('error' in checked) {
          deps.log(`a remembered office did not check out: ${checked.error}`);
          return checked;
        }
        deps.useRemote(office.remote);
        deps.memory.touch(office.remote, now());
        deps.log(office.remote.relay ? `back to office ${office.remote.relay.office} through Qasa Relay` : `back to the office server ${office.remote.host}:${office.remote.port}`);
        deps.restart();
        return { ok: true };
      } finally {
        busy = false;
      }
    },

    forget(event: E, id: unknown): OfficeView[] | null {
      if (!deps.fromConnectPage(event)) return null;
      const office = findOffice(deps.memory.list(), id);
      if (office) deps.memory.forget(office.id);
      return views();
    }
  };
}
