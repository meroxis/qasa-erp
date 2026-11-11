import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pair } from './office.ts';

// The pairing code is 128 bits now (pro/src/cert.ts pairingCode); a PC paired before keeps its pinned fingerprint.
const html = readFileSync(new URL('./connect.html', import.meta.url), 'utf8');
const texts = (key: string): string[] => {
  const m = new RegExp(`\\n\\s+${key}: \\[('(?:[^'\\\\]|\\\\.)*'), ('(?:[^'\\\\]|\\\\.)*'), ('(?:[^'\\\\]|\\\\.)*')\\]`).exec(html);
  expect(m, key).not.toBeNull();
  return m!.slice(1, 4).map((s) => s.slice(1, -1));
};

describe('the 128-bit pairing code', () => {
  it('is refused when it has only the 16 digits of before, before anything is sent to the address', async () => {
    expect(await pair('127.0.0.1:1', '3F9A-1C22-7B0E-44D1', 2000)).toEqual({ error: 'code' });
    expect(await pair('127.0.0.1:1', '3F9A-1C22-7B0E-44D1-5BE0-C7A9-6D2F-1E8', 2000)).toEqual({ error: 'code' });
    expect(await pair('127.0.0.1:1', '3F9A-1C22-7B0E-44D1-5BE0-C7A9-6D2F-1E8G', 2000)).toEqual({ error: 'code' });
    // the whole code goes on to the address (nothing answers there)
    expect(await pair('127.0.0.1:1', '3F9A-1C22-7B0E-44D1-5BE0-C7A9-6D2F-1E83', 2000)).toEqual({ error: 'unreachable' });
  });

  it('is asked for in the connect window with room for all eight groups, in Arabic, English and Kurdish', () => {
    expect(html).toContain('placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"');
    const max = Number(/<input id="code"[^>]*maxlength="(\d+)"/.exec(html)?.[1]);
    expect(max).toBeGreaterThanOrEqual('3F9A 1C22 7B0E 44D1 5BE0 C7A9 6D2F 1E83'.length + 8);
    const [ar, en, ku] = texts('e_code');
    expect(en).toMatch(/32 letters and digits, like 3F9A-1C22-7B0E-44D1-5BE0-C7A9-6D2F-1E83/);
    expect(en).toMatch(/update Qasa ERP on the server PC/);
    expect(ar).toContain('32 حرفاً');
    expect(ku).toContain('٣٢ پیت');
    for (const text of [ar, en, ku]) expect(text).not.toMatch(/\b16 letters|16 حرفاً ورقماً، مثل|١٦ پیت و ژمارەیە/);
    expect(new Set(texts('codeHint')).size).toBe(3);
    expect(html).toContain('<small data-t="codeHint"></small>');
  });
});
