import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The office-Wi-Fi route is plain ws:// (the phone link's own encryption runs inside it). Android release builds refuse
 * cleartext unless the app allows it, so the Play Store build would only ever reach the office through the relay.
 */
const root = join(__dirname, '..');
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')) as { expo: { plugins: unknown[]; ios: { infoPlist: Record<string, unknown> } } };
const plugin = createRequire(__filename)('../plugins/with-lan-cleartext.js') as { allowCleartext: (m: unknown) => { manifest: { application: { $: Record<string, string> }[] } } };

describe('plain ws:// to the office PC on the Wi-Fi', () => {
  it('is allowed in release builds on Android (the plugin is in app.json and sets usesCleartextTraffic)', () => {
    expect(app.expo.plugins).toContain('./plugins/with-lan-cleartext.js');
    const manifest = { manifest: { $: { package: 'iq.qasaerp.mobile' }, application: [{ $: { 'android:name': '.MainApplication' } }] } };
    expect(plugin.allowCleartext(manifest).manifest.application[0]!.$).toEqual({ 'android:name': '.MainApplication', 'android:usesCleartextTraffic': 'true' });
    expect(() => plugin.allowCleartext({ manifest: {} })).toThrow(/application/);
  });

  it('is allowed to local addresses on iOS', () => {
    expect(app.expo.ios.infoPlist.NSAppTransportSecurity).toEqual({ NSAllowsLocalNetworking: true });
  });
});
