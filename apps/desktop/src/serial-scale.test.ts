import { describe, expect, it } from 'vitest';
import { pickScalePort, serialAllowed } from './serial-scale.ts';

describe('the weighing scale port', () => {
  it('takes a USB-serial adapter first, else the first port, and none when there is none', () => {
    expect(pickScalePort([])).toBe('');
    expect(pickScalePort([{ portId: 'a', portName: 'COM1' }, { portId: 'b', portName: 'COM4', displayName: 'USB-SERIAL CH340' }])).toBe('b');
    expect(pickScalePort([{ portId: 'a', portName: 'COM1' }, { portId: 'b', portName: 'COM2' }])).toBe('a');
  });

  it('lets the app page use serial and nothing else, and no other page', () => {
    expect(serialAllowed('serial', 'http://127.0.0.1:4100', 'http://127.0.0.1:4100')).toBe(true);
    expect(serialAllowed('media', 'http://127.0.0.1:4100', 'http://127.0.0.1:4100')).toBe(false);
    expect(serialAllowed('serial', 'https://evil.example', 'http://127.0.0.1:4100')).toBe(false);
    expect(serialAllowed('serial', '', '')).toBe(false);
  });
});
