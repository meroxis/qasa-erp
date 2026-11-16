/**
 * The offices this PC remembers (File → Connect to an office server…), so going back to one needs no pairing code
 * (no Electron here, so it can be tested on its own). Kept in offices.json next to network.json, in the app's own
 * folder of this Windows user. What is kept is what network.json keeps for the office in use: the address (or the
 * office ID through Qasa Relay), the relay's address, and the server's certificate fingerprint, which is public (any
 * visitor sees the certificate) and is what the window pins. Never the pairing code, never a session key.
 *
 * The connect page never sees a fingerprint and never names an address to trust: it gets each office's id, its shown
 * name and when it was last used, and asks to connect to (or forget) an office by its id.
 */
import { randomBytes } from 'node:crypto';
import { officeName } from './data-place.ts';
import { parseAddress, parseOfficeId, type Remote } from './office.ts';

export const MAX_OFFICES = 10;
export const OFFICES_FILE = 'offices.json';
const ID = /^[0-9a-f]{16}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;

export interface RememberedOffice {
  id: string;
  remote: Remote;
  /** ISO date and time, when this PC last connected to it. */
  lastUsed: string;
}

/** What the connect page may see of one: no fingerprint, no relay address. */
export interface OfficeView {
  id: string;
  name: string;
  /** What to type in the address box to pair with it again: the address, or the office ID. */
  address: string;
  relay: boolean;
  lastUsed: string;
  current: boolean;
}

/** An office server as network.json and offices.json keep it, checked the same way (readRemote in main.ts). */
export function validRemote(raw: unknown): Remote | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.host !== 'string' || !parseAddress(r.host) || !Number.isInteger(r.port) || typeof r.fingerprint !== 'string' || !FINGERPRINT.test(r.fingerprint)) return null;
  // through Qasa Relay: the tunnel's local port is chosen when the app starts
  const relay = r.relay as { url?: unknown; office?: unknown } | undefined;
  if (relay && typeof relay.url === 'string' && /^https:\/\//.test(relay.url) && relay.url.length <= 300 && typeof relay.office === 'string' && parseOfficeId(relay.office)) {
    return { host: '127.0.0.1', port: 0, fingerprint: r.fingerprint, relay: { url: relay.url, office: parseOfficeId(relay.office)! } };
  }
  const port = r.port as number;
  if (port < 1 || port > 65535) return null;
  return { host: r.host, port, fingerprint: r.fingerprint };
}

/** One office server, whatever its certificate: the same address, or the same office ID through the relay. */
export function placeKey(remote: Remote): string {
  return remote.relay ? `relay:${remote.relay.office}` : `${remote.host}:${remote.port}`;
}

/** offices.json as read from disk: anything that doesn't check out is left out (null: no file yet). */
export function parseOffices(text: string | null): RememberedOffice[] | null {
  if (text === null) return null;
  let data: unknown;
  try { data = JSON.parse(text); } catch { return []; }
  const list = (data as { offices?: unknown } | null)?.offices;
  if (!Array.isArray(list)) return [];
  const out: RememberedOffice[] = [];
  const seen = new Set<string>();
  for (const item of list.slice(0, MAX_OFFICES * 2)) {
    const o = item as Record<string, unknown> | null;
    if (!o || typeof o.id !== 'string' || !ID.test(o.id) || typeof o.lastUsed !== 'string' || Number.isNaN(Date.parse(o.lastUsed))) continue;
    const remote = validRemote(o.remote);
    if (!remote || seen.has(o.id) || seen.has(placeKey(remote))) continue;
    seen.add(o.id);
    seen.add(placeKey(remote));
    out.push({ id: o.id, remote, lastUsed: new Date(o.lastUsed).toISOString() });
  }
  return sortOffices(out).slice(0, MAX_OFFICES);
}

export function serializeOffices(list: RememberedOffice[]): string {
  return JSON.stringify({ offices: list.map((o) => ({ id: o.id, lastUsed: o.lastUsed, remote: stored(o.remote) })) }, null, 2);
}

/** Only the fields network.json has: never a tunnel's port, nothing else that came along. */
function stored(remote: Remote): Remote {
  return remote.relay
    ? { host: '127.0.0.1', port: 0, fingerprint: remote.fingerprint, relay: { url: remote.relay.url, office: remote.relay.office } }
    : { host: remote.host, port: remote.port, fingerprint: remote.fingerprint };
}

const sortOffices = (list: RememberedOffice[]) => [...list].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));

/**
 * Remembers an office (or the new certificate of one already remembered, after pairing with its code again) as used
 * now. The oldest goes when there are more than ten.
 */
export function rememberOffice(list: RememberedOffice[], remote: Remote, now: Date, newId: () => string = () => randomBytes(8).toString('hex')): RememberedOffice[] {
  const key = placeKey(remote);
  const old = list.find((o) => placeKey(o.remote) === key);
  const entry: RememberedOffice = { id: old?.id ?? newId(), remote: stored(remote), lastUsed: now.toISOString() };
  return sortOffices([entry, ...list.filter((o) => o !== old)]).slice(0, MAX_OFFICES);
}

/** The office in use, as used now (when it is remembered). */
export function touchOffice(list: RememberedOffice[], remote: Remote, now: Date): RememberedOffice[] {
  const key = placeKey(remote);
  return sortOffices(list.map((o) => (placeKey(o.remote) === key && o.remote.fingerprint === remote.fingerprint ? { ...o, lastUsed: now.toISOString() } : o)));
}

export function forgetOffice(list: RememberedOffice[], id: string): RememberedOffice[] {
  return list.filter((o) => o.id !== id);
}

/** Paired with "Remember this office" unticked: an older entry for the same server goes too. */
export function forgetPlace(list: RememberedOffice[], remote: Remote): RememberedOffice[] {
  const key = placeKey(remote);
  return list.filter((o) => placeKey(o.remote) !== key);
}

/** An id from the connect page: only one of the right shape that is in the list. */
export function findOffice(list: RememberedOffice[], id: unknown): RememberedOffice | null {
  if (typeof id !== 'string' || !ID.test(id)) return null;
  return list.find((o) => o.id === id) ?? null;
}

export function officeViews(list: RememberedOffice[], current: Remote | null): OfficeView[] {
  const now = current ? placeKey(current) : '';
  return list.map((o) => ({
    id: o.id,
    name: officeName(o.remote).slice(0, 120),
    address: o.remote.relay ? `${o.remote.relay.office.slice(0, 5)}-${o.remote.relay.office.slice(5)}` : officeName(o.remote),
    relay: !!o.remote.relay,
    lastUsed: o.lastUsed,
    current: placeKey(o.remote) === now && o.remote.fingerprint === current?.fingerprint
  }));
}

/** Reading and writing offices.json, given the file system (main.ts passes node:fs; tests pass a map). */
export interface OfficeFiles {
  read(): string | null;
  write(text: string): void;
}

export function officeMemory(files: OfficeFiles) {
  const load = (): RememberedOffice[] | null => {
    try { return parseOffices(files.read()); } catch { return []; }
  };
  const save = (list: RememberedOffice[]) => files.write(serializeOffices(list));
  return {
    list: (): RememberedOffice[] => load() ?? [],
    /**
     * A PC that was connected to an office before this version: that office is remembered once, when there is no
     * offices.json yet (after that, what the person chose stands, even an empty list).
     */
    adopt(current: Remote | null, now: Date): void {
      if (load() !== null) return;
      save(current ? rememberOffice([], current, now) : []);
    },
    remember(remote: Remote, now: Date): void { save(rememberOffice(load() ?? [], remote, now)); },
    forgetPlace(remote: Remote): void { save(forgetPlace(load() ?? [], remote)); },
    forget(id: string): boolean {
      const list = load() ?? [];
      const next = forgetOffice(list, id);
      if (next.length === list.length) return false;
      save(next);
      return true;
    },
    touch(remote: Remote, now: Date): void {
      const list = load();
      if (list && list.some((o) => placeKey(o.remote) === placeKey(remote))) save(touchOffice(list, remote, now));
    }
  };
}
