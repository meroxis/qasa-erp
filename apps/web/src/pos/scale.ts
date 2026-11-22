/**
 * Reading a weighing scale at the till (2.0): a scale on a serial or USB-serial port of this PC, through Web Serial in
 * the Windows app (apps/desktop/src/serial-scale.ts lets only the app's page use a serial port). Off until it is turned
 * on for this PC; the settings belong to the PC (they follow the scale plugged into it), kept in this browser.
 *
 * Scales speak many small protocols. Most send the weight by themselves, a few times a second, as text such as
 * "ST,GS,  1.250kg"; others answer a request byte (often ENQ, 05, or "W"). So: an optional request (hex bytes), then the
 * lines read for a moment. A weight counts only from a whole line (never from one cut off in the middle: "1.2" of
 * "1.250"), only when the scale does not mark it unstable, and only once two readings in a row agree.
 *
 * The port is the one chosen for this PC (ScalePort.tsx; in the Windows app the choice is kept by the app, which lets
 * the page reach that port alone). Nothing is ever written to a port nobody chose.
 */

export interface ScaleSettings {
  on: boolean;
  baud: number;
  /** bytes sent to ask for the weight, as hex ("05", "57 0D"); '' = the scale sends by itself */
  request: string;
  /** a regular expression whose first group is the weight */
  pattern: string;
  /**
   * what the number is in when the scale names no unit beside it; a scale set to pounds or ounces is read only when
   * this says so (lb, oz): on a PC set to kg or g a weight the scale sends in lb or oz is no reading
   */
  unit: ScaleUnit;
}
export type ScaleUnit = 'kg' | 'g' | 'lb' | 'oz';
export const SCALE_UNITS: readonly ScaleUnit[] = ['kg', 'g', 'lb', 'oz'];
/** one of each unit in kilograms (the international pound and ounce) */
const KG_PER: Record<ScaleUnit, number> = { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 };

export const SCALE_KEY = 'qasa.pos.scale';
export const DEFAULT_SCALE: ScaleSettings = { on: false, baud: 9600, request: '', pattern: '([0-9]+[.,][0-9]+|[0-9]+)\\s*(?:kg|KG|g|G)?', unit: 'kg' };
export const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const;

export function readScaleSettings(store: Pick<Storage, 'getItem'> | null = storage()): ScaleSettings {
  try {
    const v = JSON.parse(store?.getItem(SCALE_KEY) ?? 'null') as Partial<ScaleSettings> | null;
    if (!v) return { ...DEFAULT_SCALE };
    return {
      on: v.on === true,
      baud: (BAUDS as readonly number[]).includes(v.baud as number) ? v.baud! : DEFAULT_SCALE.baud,
      request: typeof v.request === 'string' && hexBytes(v.request) ? v.request : '',
      pattern: typeof v.pattern === 'string' && validPattern(v.pattern) ? v.pattern : DEFAULT_SCALE.pattern,
      unit: SCALE_UNITS.includes(v.unit as ScaleUnit) ? v.unit as ScaleUnit : 'kg'
    };
  } catch {
    return { ...DEFAULT_SCALE };
  }
}

export function writeScaleSettings(s: ScaleSettings, store: Pick<Storage, 'setItem'> | null = storage()): void {
  try { store?.setItem(SCALE_KEY, JSON.stringify(s)); } catch { /* not available */ }
}

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** "05", "57 0d" → bytes; '' → none; anything else → null. */
export function hexBytes(text: string): Uint8Array | null {
  const t = text.replace(/\s+/g, '');
  if (!t) return new Uint8Array();
  if (!/^([0-9a-fA-F]{2}){1,16}$/.test(t)) return null;
  return Uint8Array.from(t.match(/../g)!.map((h) => parseInt(h, 16)));
}

export function validPattern(p: string): boolean {
  if (!p || p.length > 200) return false;
  try { new RegExp(p); return true; } catch { return false; }
}

/** The unit a scale names right after a number ("1.250kg", "500 g", "2.75 lb"); a lone capital G is not one (gross). */
function unitAfter(text: string): ScaleUnit | null {
  const m = /^[ \t]*(kg|KG|Kg|g|lbs?|LBS?|Lbs?|oz|OZ|Oz)(?![A-Za-z])/.exec(text);
  if (!m) return null;
  const u = m[1]!.toLowerCase();
  return u === 'kg' ? 'kg' : u === 'g' ? 'g' : u.startsWith('lb') ? 'lb' : 'oz';
}

/**
 * The weight in kilograms the text read from the scale ends with (the last match: a scale streaming the weight sends
 * the newest last), or null. A comma is a decimal point.
 *
 * - The weight is the number the scale names a unit beside: on a line with one, numbers without a unit (a count, a
 *   code, a time after the weight) are never the weight. A line with no unit at all: its last number, in the unit set
 *   for this PC.
 * - A unit the scale names is the one the number is in. Pounds and ounces are turned into kilograms only on a PC set to
 *   lb or oz; on one set to kg or g such a line is no reading (a scale switched to pounds by a wrong key must not sell
 *   2.2 lb as 2.2 kg).
 * - A weight with a minus before it (more taken off than the tare), zero, or an absurd one (over 1,000 kg) is no reading.
 */
export function parseScaleText(text: string, s: Pick<ScaleSettings, 'pattern' | 'unit'>): number | null {
  if (!validPattern(s.pattern)) return null;
  const re = new RegExp(s.pattern, 'g');
  let last: { n: string; unit: ScaleUnit | null; minus: boolean } | null = null;
  for (const m of text.matchAll(re)) {
    const n = m[1] ?? m[0];
    if (!n) continue;
    const at = (m.index ?? 0) + Math.max(0, m[0].indexOf(n));
    const read = { n, unit: unitAfter(text.slice(at + n.length)), minus: /[-\u2212][ \t]*$/.test(text.slice(0, at)) };
    // a number with its unit is never replaced by a bare one that follows it on the same line
    if (last?.unit && !read.unit && !/[\r\n\x03]/.test(text.slice(text.lastIndexOf(last.n, at), at))) continue;
    last = read;
  }
  if (last === null || last.minus) return null;
  const n = Number(last.n.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const metric = (u: ScaleUnit) => u === 'kg' || u === 'g';
  if (last.unit && !metric(last.unit) && metric(s.unit)) return null;
  // (to the gram: a pound is not a round number of kilograms)
  const kg = Math.round(n * KG_PER[last.unit ?? s.unit] * 1_000_000) / 1_000_000;
  return kg > 1000 ? null : kg;
}

/** What stood in the way of a reading: no port was chosen, nothing came, or the weight did not settle. */
export class ScaleError extends Error {
  constructor(readonly code: 'scale_no_port' | 'scale_timeout' | 'scale_unstable') {
    super(code);
  }
}

/** The whole lines of what the scale sent so far (ended by CR, LF or ETX); a last piece still coming is left out. */
export function wholeLines(text: string): string[] {
  const parts = text.split(/[\r\n\x03]/);
  parts.pop();
  // eslint-disable-next-line no-control-regex
  return parts.map((line) => line.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim()).filter(Boolean);
}

/** A line the scale marks as not settled yet ("US,GS, 1.250kg"; ST is stable) or as over its range. */
export const unstableLine = (line: string): boolean => /(^|[,;\s])(US|OL)([,;\s]|$)/i.test(line);

/**
 * The weight (kg) the scale has settled on, from the text read so far: the last two readings, each from a whole line the
 * scale does not mark unstable, must be the same. `lines` says how many whole lines came (to tell "nothing came" from
 * "it did not settle").
 */
export function settledWeight(text: string, s: Pick<ScaleSettings, 'pattern' | 'unit'>): { kg: number | null; lines: number } {
  const lines = wholeLines(text);
  let last: number | null = null;
  let kg: number | null = null;
  for (const line of lines) {
    // an unstable line breaks the run: the two that agree must follow one another
    const reading = unstableLine(line) ? null : parseScaleText(line, s);
    kg = reading !== null && reading === last ? reading : null;
    last = reading;
  }
  return { kg, lines: lines.length };
}

/** Whether this window can reach a serial port at all (the Windows app, or a browser with Web Serial). */
export const serialHere = (): boolean => typeof navigator !== 'undefined' && 'serial' in navigator;

export interface SerialLike {
  getPorts(): Promise<PortLike[]>;
  requestPort(): Promise<PortLike>;
}
export interface PortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

const serialOf = (): SerialLike | null => (typeof navigator === 'undefined' ? null : (navigator as unknown as { serial?: SerialLike }).serial ?? null);

/**
 * One reading: opens the chosen port, asks if it must, reads until two readings in a row agree (at most `ms`), closes
 * it. The weight in kg. Throws a ScaleError when no port was chosen for this PC (it never asks for one here, and never
 * writes to a port nobody chose), when nothing came, or when the weight did not settle in time.
 */
export async function readWeight(s: ScaleSettings, ms = 2500, serial: SerialLike | null = serialOf()): Promise<number> {
  if (!serial) throw new ScaleError('scale_no_port');
  const ports = await serial.getPorts();
  const port = ports[0];
  if (!port) throw new ScaleError('scale_no_port');
  await port.open({ baudRate: s.baud });
  let text = '';
  let seen = 0;
  try {
    const ask = hexBytes(s.request);
    const request = async () => {
      if (!ask?.length || !port.writable) return;
      const w = port.writable.getWriter();
      try { await w.write(ask); } finally { w.releaseLock(); }
    };
    await request();
    if (!port.readable) throw new ScaleError('scale_timeout');
    const reader = port.readable.getReader();
    const decoder = new TextDecoder('latin1');
    const timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, ms);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = value ? decoder.decode(value, { stream: true }) : '';
        text += chunk;
        if (text.length > 4096) {
          // keep the newest whole lines: cut at a line end, never inside a number
          const newest = text.slice(-2048);
          text = newest.slice(newest.search(/[\r\n\x03]/) + 1);
        }
        const now = settledWeight(text, s);
        if (now.kg !== null) return now.kg;
        // a scale that answers a request sends one line for each: ask again for the reading that must agree
        const ended = (chunk.match(/[\r\n\x03]+/g) ?? []).length;
        if (ended) { seen += ended; await request(); }
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
  } finally {
    await port.close().catch(() => {});
  }
  throw new ScaleError(wholeLines(text).length ? 'scale_unstable' : 'scale_timeout');
}

/** The text key that says what went wrong with a reading (i18n/scale.ts). */
export function scaleProblem(error: unknown): 'sc_noPort' | 'sc_timeout' | 'sc_unstable' | 'sc_failed' {
  const code = error instanceof ScaleError ? error.code : '';
  return code === 'scale_no_port' ? 'sc_noPort' : code === 'scale_timeout' ? 'sc_timeout' : code === 'scale_unstable' ? 'sc_unstable' : 'sc_failed';
}

/* ---------- the port chosen for this PC ---------- */

export interface ScalePort { key: string; label: string }
interface DesktopScale {
  serialPorts?(): Promise<{ ports: ScalePort[]; chosen: string }>;
  chooseSerialPort?(key: string): Promise<boolean>;
}
/** The Windows app's own keeping of the choice (app-preload.ts); null in a browser, which keeps what its own chooser granted. */
export function desktopScale(): Required<DesktopScale> | null {
  const till = typeof window === 'undefined' ? undefined : (window as unknown as { qasaDesktop?: { till?: DesktopScale } }).qasaDesktop?.till;
  return till?.serialPorts && till.chooseSerialPort ? { serialPorts: till.serialPorts.bind(till), chooseSerialPort: till.chooseSerialPort.bind(till) } : null;
}

/**
 * Asks for a port (a click must have led here). In a browser its own chooser shows. In the Windows app this hands the
 * app the list of ports, and is granted only the port chosen for this PC; with none chosen yet it is refused, which is
 * expected: the list is then shown for the admin to pick from (ScalePort.tsx).
 */
export async function askForPort(serial: SerialLike | null = serialOf()): Promise<boolean> {
  if (!serial) return false;
  try {
    await serial.requestPort();
    return true;
  } catch {
    return false;
  }
}

/** Whether a port is chosen for this PC now (the page can reach it). */
export async function portChosen(serial: SerialLike | null = serialOf()): Promise<boolean> {
  try {
    return !!serial && (await serial.getPorts()).length > 0;
  } catch {
    return false;
  }
}
