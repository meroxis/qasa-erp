import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')) as { expo: Record<string, any> };

describe('the app\'s build settings', () => {
  it('follows the phone\'s light or dark setting, keeps its data off backups, and asks for no more than it uses', () => {
    expect(app.expo.userInterfaceStyle).toBe('automatic');
    expect(app.expo.android.allowBackup).toBe(false);
    expect(app.expo.android.permissions.sort()).toEqual(['android.permission.CAMERA', 'android.permission.USE_BIOMETRIC', 'android.permission.VIBRATE']);
    expect(app.expo.android.blockedPermissions).toContain('android.permission.RECORD_AUDIO');
    expect(app.expo.android.package).toBe('iq.qasaerp.mobile');
    expect(app.expo.android.adaptiveIcon.backgroundColor).toBe('#F2A33A');
    expect(app.expo.plugins).toContainEqual(['expo-local-authentication', { faceIDPermission: app.expo.ios.infoPlist.NSFaceIDUsageDescription }]);
  });

  it('says why it asks for the camera, the office network and Face ID in Arabic, English and Kurdish', () => {
    const locales = app.expo.locales as Record<string, string>;
    expect(Object.keys(locales).sort()).toEqual(['ar', 'ckb', 'en']);
    const texts = Object.fromEntries(Object.entries(locales).map(([l, f]) => [l, JSON.parse(readFileSync(join(root, f), 'utf8')) as Record<string, string>]));
    for (const l of ['ar', 'ckb', 'en']) {
      expect(Object.keys(texts[l]!).sort()).toEqual(['NSCameraUsageDescription', 'NSFaceIDUsageDescription', 'NSLocalNetworkUsageDescription']);
    }
    expect(texts.ckb!.NSCameraUsageDescription).not.toMatch(/[يك]/);
    expect(texts.en!.NSLocalNetworkUsageDescription).toBe(app.expo.ios.infoPlist.NSLocalNetworkUsageDescription);
  });
});

/** The pixels of one of the app's own PNGs (scripts/icons.mjs writes 8-bit RGB or RGBA, no filters). */
function pixels(file: string): { size: number; alpha(x: number, y: number): number } {
  const b = readFileSync(join(root, 'assets', file));
  const size = b.readUInt32BE(16);
  const channels = b[25] === 6 ? 4 : 3;
  const chunks: Buffer[] = [];
  for (let at = 8; at < b.length;) {
    const len = b.readUInt32BE(at);
    if (b.toString('latin1', at + 4, at + 8) === 'IDAT') chunks.push(b.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  return { size, alpha: (x, y) => (channels === 4 ? raw[y * (size * 4 + 1) + 1 + x * 4 + 3]! : 255) };
}

describe('the app icon (the Qasa mark)', () => {
  it('has the sizes the stores ask for', () => {
    expect(pixels('icon.png').size).toBe(1024);
    expect(pixels('android-icon-foreground.png').size).toBe(512);
    expect(pixels('android-icon-monochrome.png').size).toBe(432);
  });

  it('keeps the whole glyph inside the circle every Android launcher shows (66 of 108 dp)', () => {
    for (const file of ['android-icon-foreground.png', 'android-icon-monochrome.png']) {
      const { size, alpha } = pixels(file);
      const r = (size * 33) / 108;
      let outside = 0;
      let inside = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (!alpha(x, y)) continue;
          if (Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) > r) outside++;
          else inside++;
        }
      }
      expect(outside, file).toBe(0);
      expect(inside, file).toBeGreaterThan(size * size * 0.03);
    }
  });
});
