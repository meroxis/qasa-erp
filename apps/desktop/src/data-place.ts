/**
 * Where the company's data is, for the app window to say truthfully (1.4): on this PC, or on the office PC this one
 * is connected to (File → Connect to an office server…). The page gets the same words the File menu shows, never the
 * server's fingerprint or a whole office ID.
 */
import { OFFICE_PORT, type Remote } from './office.ts';

export type DataPlace = { role: 'local' } | { role: 'client'; host: string; relay: boolean };

/** The office PC as shown: "192.168.1.20" (the usual port is left out), "192.168.1.20:5000", or "Qasa Relay · 12345-67890". */
export function officeName(remote: Remote): string {
  if (remote.relay) return `Qasa Relay · ${remote.relay.office.slice(0, 5)}-${remote.relay.office.slice(5)}`;
  return remote.port === OFFICE_PORT ? remote.host : `${remote.host}:${remote.port}`;
}

export function dataPlaceOf(remote: Remote | null): DataPlace {
  return remote ? { role: 'client', host: officeName(remote).slice(0, 120), relay: !!remote.relay } : { role: 'local' };
}
