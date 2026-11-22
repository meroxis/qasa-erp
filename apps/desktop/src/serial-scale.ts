/**
 * The weighing scale (2.0): the till reads a scale on a serial or USB-serial port through the browser's Web Serial in
 * the app window (apps/web/src/pos/scale.ts). Electron asks the app which port to use and whether the page may use
 * serial at all: only the app's own page, for serial alone (no camera, microphone or anything else, as before), and
 * only the one port an admin chose for this PC (Settings → Tills and till rules → Weighing scale). No port is ever picked
 * by a guess: the page could then write its request bytes to another device (a modem, a card reader on COM1).
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SerialPortChoice { portId: string; portName?: string; displayName?: string; vendorId?: string; productId?: string; serialNumber?: string }

const clean = (text: string | undefined, max: number) => (text ?? '').replace(/[\x00-\x1f|]/g, '').trim().slice(0, max);

/**
 * What tells a port apart across restarts (the portId changes each time): its name ("COM4") and, for a USB adapter, its
 * vendor, product and serial number. A scale moved to another USB socket may get another COM name: it is chosen again.
 */
export function portKey(p: Omit<SerialPortChoice, 'portId'>): string {
  return [clean(p.portName, 40), clean(p.vendorId, 12), clean(p.productId, 12), clean(p.serialNumber, 60)].join('|');
}

/** How a port is shown to the admin: "COM4 · USB-SERIAL CH340". */
export function portLabel(p: Omit<SerialPortChoice, 'portId'>): string {
  const name = clean(p.portName, 40);
  const what = clean(p.displayName, 80);
  return [name, what && what !== name ? what : ''].filter(Boolean).join(' · ') || '?';
}

/** The port to hand the page: the one chosen for this PC when it is plugged in, else none ('' cancels the request). */
export function pickScalePort(ports: readonly SerialPortChoice[], chosenKey: string): string {
  if (!chosenKey) return '';
  return ports.find((p) => portKey(p) === chosenKey)?.portId ?? '';
}

/** The ports as the settings page lists them (no ids of the session, only what tells them apart and their names). */
export function listScalePorts(ports: readonly SerialPortChoice[]): { key: string; label: string }[] {
  const seen = new Set<string>();
  const out: { key: string; label: string }[] = [];
  for (const p of ports) {
    const key = portKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: portLabel(p) });
  }
  return out.slice(0, 64);
}

/** Serial alone, for the app's own page alone. */
export const serialAllowed = (permission: string, requestOrigin: string, appOrigin: string): boolean =>
  permission === 'serial' && !!appOrigin && requestOrigin === appOrigin;

/** A device the page may reach without asking again: the chosen port and no other. */
export const chosenDevice = (device: unknown, chosenKey: string): boolean =>
  !!chosenKey && !!device && typeof device === 'object' && portKey(device as SerialPortChoice) === chosenKey;

const FILE = 'scale-port.json';

/** The port chosen for this PC (kept in the app's own folder, for every company on it): '' when none. */
export function readChosenPort(userDataDir: string): string {
  try {
    const file = join(userDataDir, FILE);
    if (!existsSync(file)) return '';
    const key = (JSON.parse(readFileSync(file, 'utf8')) as { key?: unknown }).key;
    return typeof key === 'string' && key.length <= 200 && key.split('|').length === 4 ? key : '';
  } catch {
    return '';
  }
}

export function writeChosenPort(userDataDir: string, key: string): void {
  const file = join(userDataDir, FILE);
  writeFileSync(file + '.tmp', JSON.stringify({ key }));
  renameSync(file + '.tmp', file);
}
