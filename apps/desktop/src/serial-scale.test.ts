import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chosenDevice, listScalePorts, pickScalePort, portKey, portLabel, readChosenPort, serialAllowed, writeChosenPort } from './serial-scale.ts';

const COM1 = { portId: 'a', portName: 'COM1' };
const USB = { portId: 'b', portName: 'COM4', displayName: 'USB-SERIAL CH340', vendorId: '1a86', productId: '7523' };

describe('the weighing scale port', () => {
  it('is never picked by a guess: only the port chosen for this PC is handed to the page', () => {
    // nothing chosen: the request is cancelled (2.0 first took a USB adapter, else the first port: COM1 could be a modem)
    expect(pickScalePort([], '')).toBe('');
    expect(pickScalePort([COM1, USB], '')).toBe('');
    expect(pickScalePort([COM1, USB], portKey(USB))).toBe('b');
    // the chosen port is not plugged in now: none, never another one
    expect(pickScalePort([COM1], portKey(USB))).toBe('');
    // the session's port id changes at each start; the key does not
    expect(pickScalePort([{ ...USB, portId: 'zz' }], portKey(USB))).toBe('zz');
  });

  it('lists the ports by what tells them apart, with names an admin can read', () => {
    expect(listScalePorts([COM1, USB, { ...USB, portId: 'again' }])).toEqual([
      { key: 'COM1|||', label: 'COM1' },
      { key: 'COM4|1a86|7523|', label: 'COM4 · USB-SERIAL CH340' }
    ]);
    expect(portLabel({ portName: 'COM3', displayName: 'COM3' })).toBe('COM3');
    // a name can't smuggle the separator or control characters into the key
    expect(portKey({ portName: 'COM|9\n', vendorId: '1' })).toBe('COM9|1||');
  });

  it('lets the app page use serial and nothing else, no other page, and only the chosen device', () => {
    expect(serialAllowed('serial', 'http://127.0.0.1:4100', 'http://127.0.0.1:4100')).toBe(true);
    expect(serialAllowed('media', 'http://127.0.0.1:4100', 'http://127.0.0.1:4100')).toBe(false);
    expect(serialAllowed('serial', 'https://evil.example', 'http://127.0.0.1:4100')).toBe(false);
    expect(serialAllowed('serial', '', '')).toBe(false);
    expect(chosenDevice(USB, portKey(USB))).toBe(true);
    expect(chosenDevice(COM1, portKey(USB))).toBe(false);
    expect(chosenDevice(USB, '')).toBe(false);
    expect(chosenDevice(null, portKey(USB))).toBe(false);
  });

  it('keeps the choice for this PC, and reads a file that was edited as no choice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qasa-scale-'));
    try {
      expect(readChosenPort(dir)).toBe('');
      writeChosenPort(dir, portKey(USB));
      expect(readChosenPort(dir)).toBe('COM4|1a86|7523|');
      writeChosenPort(dir, '');
      expect(readChosenPort(dir)).toBe('');
      writeFileSync(join(dir, 'scale-port.json'), '{"key": 5}');
      expect(readChosenPort(dir)).toBe('');
      writeFileSync(join(dir, 'scale-port.json'), 'not json');
      expect(readChosenPort(dir)).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
