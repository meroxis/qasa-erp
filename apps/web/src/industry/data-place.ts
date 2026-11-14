import { useEffect, useState } from 'react';
import type { Key } from '../i18n.ts';

/**
 * Where the company's data is (1.4): on this PC, or on the office PC this one is connected to (File → Connect to an
 * office server…). On a connected PC the app's pages come from the office PC, so nothing may say "the data is on this
 * PC" there, and nothing may suggest that a backup of this PC protects the books.
 *
 * The Windows app says which it is (app-preload.ts → qasaDesktop.dataPlace, the same name the File menu shows). An
 * older Windows app only says so in its support details; a browser on the office network is told by its address.
 */
export type DataPlace = { kind: 'local' } | { kind: 'office'; host: string; relay: boolean };

interface DesktopPlace {
  dataPlace?: () => Promise<unknown>;
  supportInfo?: () => Promise<unknown>;
}

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i;
/** A name fit to show: printable, not long. Anything else is left out (the text then names no PC). */
const shown = (v: unknown): string => (typeof v === 'string' && v.length <= 120 && !/[\u0000-\u001f\u007f<>]/.test(v) ? v.trim() : ''); // eslint-disable-line no-control-regex

/**
 * The place, from what the Windows app answered (`answer`, null when it has no such call), what an older app's support
 * details say (`role`), and the page's own address.
 */
export function readDataPlace(answer: unknown, role: unknown, location: { hostname: string; host: string }): DataPlace {
  const fromAddress = LOOPBACK.test(location.hostname) ? '' : shown(location.host);
  if (answer && typeof answer === 'object') {
    const a = answer as { role?: unknown; host?: unknown; relay?: unknown };
    if (a.role === 'client') return { kind: 'office', host: shown(a.host) || fromAddress, relay: a.relay === true };
    if (a.role === 'local') return { kind: 'local' };
  }
  if (role === 'client') return { kind: 'office', host: fromAddress, relay: fromAddress === '' };
  // no Windows app (a browser), or one that could not say: pages that come from another machine have their data there
  return fromAddress ? { kind: 'office', host: fromAddress, relay: false } : { kind: 'local' };
}

function desktop(): DesktopPlace | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { qasaDesktop?: DesktopPlace }).qasaDesktop ?? null;
}

let asked: Promise<DataPlace> | null = null;

/** Asked once per window: the place never changes while the app runs (connecting elsewhere restarts it). */
export function loadDataPlace(): Promise<DataPlace> {
  asked ??= (async () => {
    const d = desktop();
    const location = typeof window !== 'undefined' && window.location ? { hostname: window.location.hostname ?? '', host: window.location.host ?? '' } : { hostname: '', host: '' };
    let answer: unknown = null;
    let role: unknown = null;
    try {
      if (typeof d?.dataPlace === 'function') answer = await d.dataPlace();
      else if (typeof d?.supportInfo === 'function') role = ((await d.supportInfo()) as { role?: unknown } | null)?.role;
    } catch { /* the address says what it can */ }
    return readDataPlace(answer, role, location);
  })();
  return asked;
}

export function resetDataPlaceForTests(): void {
  asked = null;
}

/** null until the Windows app has answered (a moment); in the website demo the data is in the browser: 'local'. */
export function useDataPlace(): DataPlace | null {
  const [place, setPlace] = useState<DataPlace | null>(null);
  useEffect(() => {
    let live = true;
    if (import.meta.env.MODE === 'demo') { setPlace({ kind: 'local' }); return; }
    void loadDataPlace().then((p) => { if (live) setPlace(p); });
    return () => { live = false; };
  }, []);
  return place;
}

/** The office PC's name, kept left to right inside Arabic and Kurdish text and never turned into other digits. */
export const officeHost = (place: DataPlace | null): string => (place?.kind === 'office' && place.host ? `⁦${place.host}⁩` : '');

/**
 * A text that names the office PC: `named` has {h}; `bare` is used when the PC's name isn't known. The name is put in
 * after the translation, so an address keeps its own digits.
 */
export function officeText(t: (key: Key, vars?: Record<string, string>) => string, place: DataPlace | null, named: Key, bare?: Key): string {
  const host = officeHost(place);
  if (!host && bare) return t(bare);
  return t(named, { h: '{h}' }).replace('{h}', host).replace(/ {2,}/g, ' ').replace(/ ([،,.:])/g, '$1').replace(/:$/, '').trim();
}

/** What the status line at the bottom says while the server answers: where the data is (nothing until that is known). */
export function dataPlaceLine(t: (key: Key, vars?: Record<string, string>) => string, place: DataPlace | null): string {
  if (!place) return '';
  return place?.kind === 'office' ? officeText(t, place, 's14_dataOffice', 's14_dataOfficeNoName') : t('localMode');
}
