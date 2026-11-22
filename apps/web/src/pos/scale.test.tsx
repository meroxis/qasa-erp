import { describe, expect, it } from 'vitest';
import { DEFAULT_SCALE, readWeight, scaleProblem, ScaleError, settledWeight, unstableLine, wholeLines, type PortLike, type SerialLike } from './scale.ts';

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
