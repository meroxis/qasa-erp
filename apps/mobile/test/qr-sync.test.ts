import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeQr, qrSvgPath } from '../src/qr';

// The phone's QR code encoder is the desktop's own (apps/web/src/industry/qr.ts), copied: no QR library in the app.

describe('the QR code encoder', () => {
  it('is the same file as the desktop\'s, when the monorepo is here', () => {
    const desktop = join(__dirname, '..', '..', 'web', 'src', 'industry', 'qr.ts');
    if (!existsSync(desktop)) return;
    const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    expect(read(join(__dirname, '..', 'src', 'qr.ts'))).toBe(read(desktop));
  });

  it('draws a code for an invoice\'s address', () => {
    const modules = encodeQr('https://qasaerp.com/v/#eyJ2IjoxfQ.c2ln', 'M');
    expect(modules.length).toBeGreaterThanOrEqual(21);
    expect(modules.every((row) => row.length === modules.length)).toBe(true);
    const { path, size } = qrSvgPath(modules, 2);
    expect(size).toBe(modules.length + 4);
    expect(path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
  });
});
