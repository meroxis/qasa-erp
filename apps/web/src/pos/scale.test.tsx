import { describe, expect, it } from 'vitest';
import { DEFAULT_SCALE, parseScaleText, readScaleSettings, readWeight, scaleProblem, ScaleError, settledWeight, unstableLine, wholeLines, type PortLike, type SerialLike } from './scale.ts';

const enc = new TextEncoder();
/** A scale on a port: sends the given chunks (a streaming scale), or one line for each request written (answers). */
function fakeSerial(o: { chunks?: string[]; answers?: string[]; ports?: number } = {}) {
  const log = { opened: 0, closed: 0, written: [] as number[][], asked: 0 };
  const port = (): PortLike => {
    let push: ((line: string) => void) | null = null;
    return {
      open: async () => { log.opened++; },
      close: async () => { log.closed++; },
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of o.chunks ?? []) controller.enqueue(enc.encode(chunk));
          push = (line) => controller.enqueue(enc.encode(line));
        }
      }),
      writable: new WritableStream<Uint8Array>({
        write(bytes) {
          log.written.push([...bytes]);
          const next = o.answers?.shift();
          if (next !== undefined) push?.(next);
        }
      })
    };
  };
  const serial: SerialLike = {
    getPorts: async () => Array.from({ length: o.ports ?? 1 }, port),
    requestPort: async () => { log.asked++; return port(); }
  };
  return { serial, log };
}

describe('a weight that begins with its decimal point (round four of the review)', () => {
  it('reads ".250kg" as a quarter of a kilogram, never as 250 kg', () => {
    expect(parseScaleText('.250kg', DEFAULT_SCALE)).toBe(0.25);
    expect(parseScaleText('ST,GS,   .250kg', DEFAULT_SCALE)).toBe(0.25);
    expect(parseScaleText('ST,GS,   ,250 kg', DEFAULT_SCALE)).toBe(0.25);
    expect(parseScaleText('W .075', DEFAULT_SCALE)).toBe(0.075);
    expect(parseScaleText('.500 g', DEFAULT_SCALE)).toBe(0.0005);
    expect(parseScaleText('.5 lb', { ...DEFAULT_SCALE, unit: 'lb' })).toBe(0.226796);
    expect(settledWeight('ST,GS,   .250kg\r\nST,GS,   .250kg\r\n', DEFAULT_SCALE).kg).toBe(0.25);
    // what it read before is unchanged
    expect(parseScaleText('ST,GS,  1.250kg', DEFAULT_SCALE)).toBe(1.25);
    expect(parseScaleText('0,750', DEFAULT_SCALE)).toBe(0.75);
    expect(parseScaleText('750', { ...DEFAULT_SCALE, unit: 'g' })).toBe(0.75);
    expect(parseScaleText('2 kg', DEFAULT_SCALE)).toBe(2);
    // a minus before it is still no reading; nor is a point with nothing after it
    expect(parseScaleText('-.250kg', DEFAULT_SCALE)).toBeNull();
    expect(parseScaleText('ST,GS, .kg', DEFAULT_SCALE)).toBeNull();
  });

  it('gives a PC that kept the pattern of before the new one, and leaves a pattern someone wrote alone', () => {
    const kept = (pattern: string) => readScaleSettings({ getItem: () => JSON.stringify({ on: true, baud: 9600, request: '', pattern, unit: 'kg' }) });
    expect(kept('([0-9]+[.,][0-9]+|[0-9]+)\\s*(?:kg|KG|g|G)?').pattern).toBe(DEFAULT_SCALE.pattern);
    expect(parseScaleText('.250kg', kept('([0-9]+[.,][0-9]+|[0-9]+)\\s*(?:kg|KG|g|G)?'))).toBe(0.25);
    expect(kept('W(\\d+)').pattern).toBe('W(\\d+)');
  });
});

describe('reading the scale (reliability review, finding 5)', () => {
  it('takes whole lines only: a number cut off at the end of what was read is never a weight', () => {
    expect(wholeLines('ST,GS,  1.250kg\r\nST,GS,  1.2')).toEqual(['ST,GS,  1.250kg']);
    expect(wholeLines('\x02ST,GS, 0.500kg\x03')).toEqual(['ST,GS, 0.500kg']);
    // the stream ended in the middle of the second line: 1.2 kg and 1 kg used to come out of these
    expect(settledWeight('ST,GS,  1.250kg\r\nST,GS,  1.2', DEFAULT_SCALE).kg).toBeNull();
    expect(settledWeight('ST,GS,  1.250kg\r\nST,GS,  1.250kg\r\nST,GS,  1', DEFAULT_SCALE).kg).toBe(1.25);
    expect(settledWeight('ST,GS,  1', DEFAULT_SCALE)).toEqual({ kg: null, lines: 0 });
  });

  it('needs two readings in a row that agree, and never counts a line the scale marks unstable', () => {
    expect(unstableLine('US,GS,  1.250kg')).toBe(true);
    expect(unstableLine('ST,GS,  1.250kg')).toBe(false);
    expect(unstableLine('OL')).toBe(true);
    // one reading alone is not enough
    expect(settledWeight('ST,GS,  1.250kg\r\n', DEFAULT_SCALE)).toEqual({ kg: null, lines: 1 });
    // still moving: 1.240 then 1.250
    expect(settledWeight('ST,GS,  1.240kg\r\nST,GS,  1.250kg\r\n', DEFAULT_SCALE).kg).toBeNull();
    expect(settledWeight('ST,GS,  1.240kg\r\nST,GS,  1.250kg\r\nST,GS,  1.250kg\r\n', DEFAULT_SCALE).kg).toBe(1.25);
    // unstable lines never count, even when they repeat, and one between two equal readings breaks the run
    expect(settledWeight('US,GS,  1.250kg\r\nUS,GS,  1.250kg\r\n', DEFAULT_SCALE).kg).toBeNull();
    expect(settledWeight('ST,GS,  1.250kg\r\nUS,GS,  1.300kg\r\nST,GS,  1.250kg\r\n', DEFAULT_SCALE).kg).toBeNull();
    // grams, and a decimal comma
    expect(settledWeight('750\n750\n', { pattern: '(\\d+)', unit: 'g' }).kg).toBe(0.75);
    expect(settledWeight('W 0,750\rW 0,750\r', DEFAULT_SCALE).kg).toBe(0.75);
  });

  it('reads a streaming scale until it settles, and closes the port', async () => {
    const { serial, log } = fakeSerial({ chunks: ['ST,GS,  1.2', '40kg\r\nUS,GS,  1.2', '45kg\r\nST,GS,  1.250kg\r\nST,GS,  1.25', '0kg\r\n'] });
    expect(await readWeight(DEFAULT_SCALE, 500, serial)).toBe(1.25);
    expect(log).toMatchObject({ opened: 1, closed: 1, written: [], asked: 0 });
  });

  it('asks a scale that answers requests again, for the second reading that must agree', async () => {
    const { serial, log } = fakeSerial({ answers: ['  2.000 kg\r\n', '  2.000 kg\r\n'] });
    expect(await readWeight({ ...DEFAULT_SCALE, request: '05' }, 500, serial)).toBe(2);
    expect(log.written).toEqual([[5], [5]]);
  });

  it('with no port chosen it says so, and neither asks for one nor writes anything anywhere', async () => {
    const { serial, log } = fakeSerial({ ports: 0, answers: ['1.000kg\r\n'] });
    const failed = await readWeight({ ...DEFAULT_SCALE, request: '05' }, 200, serial).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(ScaleError);
    expect(scaleProblem(failed)).toBe('sc_noPort');
    expect(log).toEqual({ opened: 0, closed: 0, written: [], asked: 0 });
    expect(scaleProblem(await readWeight(DEFAULT_SCALE, 200, null).catch((e: unknown) => e))).toBe('sc_noPort');
  });

  it('says plainly when nothing came, and when the weight did not settle, instead of a guessed weight', async () => {
    const silent = fakeSerial({ chunks: [] });
    expect(scaleProblem(await readWeight(DEFAULT_SCALE, 60, silent.serial).catch((e: unknown) => e))).toBe('sc_timeout');
    expect(silent.log.closed).toBe(1);
    const moving = fakeSerial({ chunks: ['US,GS,  1.100kg\r\nUS,GS,  1.180kg\r\nST,GS,  1.2'] });
    expect(scaleProblem(await readWeight(DEFAULT_SCALE, 60, moving.serial).catch((e: unknown) => e))).toBe('sc_unstable');
    expect(scaleProblem(new Error('port busy'))).toBe('sc_failed');
  });
});

describe('what the scale says is a weight (verify report, finding 12)', () => {
  const kg = { pattern: DEFAULT_SCALE.pattern, unit: 'kg' as const };

  it('never reads a negative weight as a weight', () => {
    // more taken off the pan than the tare: the scale shows a minus
    expect(parseScaleText('ST,NT,-  0.250kg', kg)).toBeNull();
    expect(parseScaleText('ST,NT,-0.250kg', kg)).toBeNull();
    expect(parseScaleText('ST,NT,\u22120.250 kg', kg)).toBeNull();
    expect(settledWeight('ST,NT,-  0.250kg\r\nST,NT,-  0.250kg\r\n', kg).kg).toBeNull();
    // a plus, or a minus that belongs to an earlier field, is not one
    expect(parseScaleText('ST,GS,+  1.250kg', kg)).toBe(1.25);
    expect(parseScaleText('A-1,ST,GS, 1.250kg', kg)).toBe(1.25);
    expect(parseScaleText('0.000kg', kg)).toBeNull();
  });

  it('takes the number that has the unit, never one that follows it on the line', () => {
    // a count, a code or a time after the weight used to be read as the weight: 12 kg, 59 kg
    expect(parseScaleText('ST,GS,  1.250kg,0012', kg)).toBe(1.25);
    expect(parseScaleText('ST,GS,  1.250 kg  PLU 0042  14:59', kg)).toBe(1.25);
    expect(settledWeight('ST,GS, 1.250kg,0012\r\nST,GS, 1.250kg,0013\r\n', kg).kg).toBe(1.25);
    // the newest line is still the one read, and a later weight with its unit on the same line (net after gross) wins
    expect(parseScaleText('ST,GS,  1.250kg,0012\r\nST,GS,  1.300kg,0013\r\n', kg)).toBe(1.3);
    expect(parseScaleText('G 1.350kg T 0.100kg N 1.250kg', kg)).toBe(1.25);
    // a line with no unit at all: its last number, in the unit set for this PC (as before)
    expect(parseScaleText('01 1.250', kg)).toBe(1.25);
    expect(parseScaleText('1250', { pattern: '(\\d+)', unit: 'g' })).toBe(1.25);
    // "GS" and a lone capital G (gross) are not grams
    expect(parseScaleText('1.250 GS', kg)).toBe(1.25);
    expect(parseScaleText('1.250 G', kg)).toBe(1.25);
  });

  it('reads the unit the scale names: grams on a PC set to kg, and pounds or ounces only where the PC is set to them', () => {
    expect(parseScaleText('ST,GS,  750g', kg)).toBe(0.75);
    expect(parseScaleText('ST,GS,  0.750kg', { ...kg, unit: 'g' })).toBe(0.75);
    // a scale switched to pounds on a PC set to kilograms: no reading (2.2 lb is not 2.2 kg)
    expect(parseScaleText('ST,GS,  2.20lb', kg)).toBeNull();
    expect(parseScaleText('ST,GS,  16 oz', kg)).toBeNull();
    expect(parseScaleText('ST,GS,  2.20 LBS', { ...kg, unit: 'g' })).toBeNull();
    expect(settledWeight('ST,GS, 2.20lb\r\nST,GS, 2.20lb\r\n', kg).kg).toBeNull();
    // set to pounds or ounces, they are turned into kilograms
    expect(parseScaleText('ST,GS,  2.20lb', { ...kg, unit: 'lb' })).toBeCloseTo(0.997903, 6);
    expect(parseScaleText('ST,GS,  16 oz', { ...kg, unit: 'lb' })).toBeCloseTo(0.453592, 6);
    expect(parseScaleText('  2.5', { ...kg, unit: 'lb' })).toBeCloseTo(1.133981, 6);
    expect(parseScaleText('  8', { pattern: '(\\d+)', unit: 'oz' })).toBeCloseTo(0.226796, 6);
    // … and a line in kilograms is still kilograms there
    expect(parseScaleText('ST,GS,  1.250kg', { ...kg, unit: 'lb' })).toBe(1.25);
    // the setting keeps lb and oz, and anything else is kg
    const store = (unit: string) => ({ getItem: () => JSON.stringify({ on: true, unit }) });
    expect(['kg', 'g', 'lb', 'oz', 'stone'].map((u) => readScaleSettings(store(u)).unit)).toEqual(['kg', 'g', 'lb', 'oz', 'kg']);
  });
});
