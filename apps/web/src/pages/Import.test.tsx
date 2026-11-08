import { deflateRawSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { colIndex, MAX_INFLATED_BYTES, readXlsx } from './Import.tsx';

// A sheet received from someone else must not be able to exhaust the window's memory (and leave it blank).
it('reads column letters up to Excel’s last column and refuses references past it', () => {
  expect(colIndex('A1')).toBe(0);
  expect(colIndex('AA10')).toBe(26);
  expect(colIndex('XFD1')).toBe(16_383);
  expect(() => colIndex('XFE1')).toThrow('format');
  expect(() => colIndex('ZZZZZZZZ1')).toThrow('format');
});

/** A one-file .zip (an .xlsx is one), deflated, for readXlsx. */
function zipOne(name: string, content: Buffer): ArrayBuffer {
  const data = deflateRawSync(content);
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(0, 42);
  const centralAt = local.length + nameBytes.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12); end.writeUInt32LE(centralAt, 16);
  const all = Buffer.concat([local, nameBytes, data, central, nameBytes, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length) as ArrayBuffer;
}

it('stops a small .xlsx that inflates past the limit before it fills the memory', async () => {
  // the same check as the 100 MB default, at a 1 MB limit so the test stays quick under a full parallel run
  const limit = 1024 * 1024;
  const bomb = zipOne('xl/worksheets/sheet1.xml', Buffer.alloc(2 * limit, 0x20));
  expect(bomb.byteLength).toBeLessThan(limit / 50);
  await expect(readXlsx(bomb, { maxInflated: limit })).rejects.toThrow('too_large');
  // the default limit is the one the app uses
  expect(MAX_INFLATED_BYTES).toBe(100 * 1024 * 1024);
});
