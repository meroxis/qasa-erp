/**
 * Reading a weighing scale at the till (2.0): a scale on a serial or USB-serial port of this PC, through Web Serial in
 * the Windows app (apps/desktop/src/serial-scale.ts lets only the app's page use a serial port). Off until it is turned
 * on for this PC; the settings belong to the PC (they follow the scale plugged into it), kept in this browser.
 *
 * Scales speak many small protocols. Most send the weight by themselves, a few times a second, as text such as
 * "ST,GS,  1.250kg"; others answer a request byte (often ENQ, 05, or "W"). So: an optional request (hex bytes), then the
 * text read for a moment, and the last weight in it that matches the pattern.
 */

export interface ScaleSettings {
  on: boolean;
  baud: number;
  /** bytes sent to ask for the weight, as hex ("05", "57 0D"); '' = the scale sends by itself */
  request: string;
  /** a regular expression whose first group is the weight */
  pattern: string;
  /** what the number is in */
  unit: 'kg' | 'g';
}

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
      unit: v.unit === 'g' ? 'g' : 'kg'
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

/**
 * The weight in kilograms the text read from the scale ends with (the last match: a scale streaming the weight sends
 * the newest last), or null. A comma is a decimal point; a negative or absurd weight (over 1,000 kg) is no reading.
 */
export function parseScaleText(text: string, s: Pick<ScaleSettings, 'pattern' | 'unit'>): number | null {
  if (!validPattern(s.pattern)) return null;
  const re = new RegExp(s.pattern, 'g');
  let last: string | null = null;
  for (const m of text.matchAll(re)) if (m[1] ?? m[0]) last = (m[1] ?? m[0])!;
  if (last === null) return null;
  const n = Number(last.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const kg = s.unit === 'g' ? n / 1000 : n;
  return kg > 1000 ? null : kg;
}

/** Whether this window can reach a serial port at all (the Windows app, or a browser with Web Serial). */
export const serialHere = (): boolean => typeof navigator !== 'undefined' && 'serial' in navigator;

interface SerialLike {
  getPorts(): Promise<PortLike[]>;
  requestPort(): Promise<PortLike>;
}
interface PortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

/** One reading: opens the port, asks if it must, reads for up to `ms`, closes it. The weight in kg, or null. */
export async function readWeight(s: ScaleSettings, ms = 1500): Promise<number | null> {
  const serial = (navigator as unknown as { serial?: SerialLike }).serial;
  if (!serial) return null;
  const ports = await serial.getPorts();
  const port = ports[0] ?? await serial.requestPort();
  await port.open({ baudRate: s.baud });
  let text = '';
  try {
    const ask = hexBytes(s.request);
    if (ask?.length && port.writable) {
      const w = port.writable.getWriter();
      try { await w.write(ask); } finally { w.releaseLock(); }
    }
    if (!port.readable) return null;
    const reader = port.readable.getReader();
    const decoder = new TextDecoder('latin1');
    const timer = setTimeout(() => { void reader.cancel(); }, ms);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) text += decoder.decode(value, { stream: true });
        if (text.length > 4096) text = text.slice(-2048);
        // a scale that answered once (a request): its line is in, no need to wait
        if (ask?.length && /[\r\n]/.test(text) && parseScaleText(text, s) !== null) break;
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
  } finally {
    await port.close().catch(() => {});
  }
  return parseScaleText(text, s);
}
