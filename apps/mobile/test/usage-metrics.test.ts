import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { OfficeLink } from '../src/link';
import { generateKeyPair } from '../src/protocol';
import { FORBIDDEN_FILES, FORBIDDEN_IN_CODE, FORBIDDEN_IN_MANIFEST, forbiddenCode, zipEntries, zipRead } from '../scripts/check-release-apk.mjs';
import { fakeOffice } from './fake-office';

/**
 * 1.0.2: the app sends Google nothing. Barcode scanning runs Google ML Kit on the phone, which also reports how it is
 * used (firebaselogging.googleapis.com) through Google's data transport; plugins/with-no-usage-metrics.js leaves that
 * sender out of the build and scripts/check-release-apk.mjs checks a built APK for it.
 */
type Manifest = { manifest: { $?: Record<string, string>; application: Record<string, { $: Record<string, string> }[] | undefined>[] } };
const plugin = createRequire(__filename)('../plugins/with-no-usage-metrics.js') as {
  addNoUsageMetrics(gradle: string): string;
  removeUsageMetrics(manifest: Manifest): Manifest;
  REMOVED_FROM_MANIFEST: [string, string][];
  STAND_IN: { from: string; to: string[] };
};
const root = join(__dirname, '..');
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')) as { expo: { version: string; android: { versionCode: number }; plugins: unknown[] } };

const GRADLE = `android {
    namespace 'iq.qasaerp.mobile'
}

dependencies {
    implementation("com.facebook.react:react-android")
}
`;

describe('no usage reports to Google', () => {
  it('is applied by the app\'s config, after expo-camera (whose ML Kit it concerns)', () => {
    const names = app.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).toContain('./plugins/with-no-usage-metrics.js');
    expect(names.indexOf('./plugins/with-no-usage-metrics.js')).toBeGreaterThan(names.indexOf('expo-camera'));
  });

  it('leaves Google\'s sender and the two unused scanners out of the build, and compiles the stand-in against the transport\'s API', () => {
    const out = plugin.addNoUsageMetrics(GRADLE);
    expect(out.startsWith(GRADLE.trimEnd())).toBe(true);
    for (const [group, module] of [
      ['com.google.android.datatransport', 'transport-backend-cct'],
      ['com.google.android.gms', 'play-services-code-scanner'],
      ['com.google.android.gms', 'play-services-mlkit-document-scanner']
    ]) expect(out).toContain(`exclude group: '${group}', module: '${module}'`);
    // only compiled against: the app has the transport's runtime through ML Kit, as before (no new library in it)
    expect(out).toMatch(/compileOnly 'com\.google\.android\.datatransport:transport-runtime:\d+\.\d+\.\d+'/);
    expect(out).not.toMatch(/implementation '/);
    // ML Kit's barcode scanning itself stays: nothing of it is excluded
    expect(out).not.toMatch(/barcode-scanning|mlkit:|camera-mlkit/);
    expect(plugin.addNoUsageMetrics(out)).toBe(out);
  });

  it('takes the transport\'s sender, its backends and the unused scanners out of the manifest', () => {
    const manifest: Manifest = {
      manifest: {
        $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
        application: [{ activity: [{ $: { 'android:name': '.MainActivity' } }], 'meta-data': [{ $: { 'android:name': 'expo.modules.updates.ENABLED', 'android:value': 'false' } }] }]
      }
    };
    const out = plugin.removeUsageMetrics(manifest);
    expect(out.manifest.$!['xmlns:tools']).toBe('http://schemas.android.com/tools');
    const removed = Object.entries(out.manifest.application[0]!).flatMap(([element, list]) => (list ?? []).filter((e) => e.$['tools:node'] === 'remove').map((e) => [element, e.$['android:name']]));
    expect(removed.sort()).toEqual([
      ['activity', 'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity'],
      ['activity', 'com.google.mlkit.vision.documentscanner.internal.GmsDocumentScanningDelegateActivity'],
      ['meta-data', 'com.google.mlkit.vision.DEPENDENCIES'],
      ['receiver', 'com.google.android.datatransport.runtime.scheduling.jobscheduling.AlarmManagerSchedulerBroadcastReceiver'],
      ['service', 'com.google.android.datatransport.runtime.backends.TransportBackendDiscovery'],
      ['service', 'com.google.android.datatransport.runtime.scheduling.jobscheduling.JobInfoSchedulerService']
    ]);
    // the app's own entries are kept as they were
    expect(out.manifest.application[0]!.activity![0]!.$).toEqual({ 'android:name': '.MainActivity' });
    expect(out.manifest.application[0]!['meta-data']![0]!.$['tools:node']).toBeUndefined();
    // applied again: nothing more
    expect(plugin.removeUsageMetrics(structuredClone(out))).toEqual(out);
  });

  it('puts in a stand-in for Google\'s destination that has no address and names no backend the app has', () => {
    const java = readFileSync(plugin.STAND_IN.from, 'utf8');
    expect(plugin.STAND_IN.to.join('/')).toBe('app/src/main/java/com/google/android/datatransport/cct/CCTDestination.java');
    expect(java).toMatch(/^package com\.google\.android\.datatransport\.cct;/);
    expect(java).toMatch(/public final class CCTDestination implements EncodedDestination/);
    // what ML Kit's reporting asks for (common 18.11, vision-common 17.3, barcode 18.3): INSTANCE and its encodings
    expect(java).toMatch(/public static final CCTDestination INSTANCE = /);
    expect(java).toMatch(/public Set<Encoding> getSupportedEncodings\(\)/);
    expect(java).toMatch(/Encoding\.of\("proto"\), Encoding\.of\("json"\)/);
    expect(java).toMatch(/public byte\[\] getExtras\(\) \{\s*return null;/);
    expect(java).toMatch(/DESTINATION_NAME = "qasa-none"/);
    // no address, no key, no network
    expect(java).not.toMatch(/https?:|googleapis|\.com\b|java\.net|HttpURLConnection|okhttp/i);
    for (const text of FORBIDDEN_IN_CODE) expect(java).not.toContain(text);
  });

  it('a built APK is checked for all of it: the manifest, the code and the libraries left out', () => {
    expect(FORBIDDEN_IN_MANIFEST).toEqual(expect.arrayContaining([...plugin.REMOVED_FROM_MANIFEST.map(([, name]) => name), 'CctBackendFactory', 'barcode_ui']));
    expect(FORBIDDEN_FILES).toEqual(['transport-backend-cct.properties', 'play-services-code-scanner.properties', 'play-services-mlkit-document-scanner.properties']);
    // the halves of firebaselogging.googleapis.com as Google's library keeps them (interleaved, so a search for the
    // address itself finds nothing)
    const merge = (a: string, b: string) => [...a].map((c, i) => c + (b[i] ?? '')).join('');
    expect(merge(FORBIDDEN_IN_CODE[0]!, FORBIDDEN_IN_CODE[1]!)).toBe('https://firebaselogging.googleapis.com/v0cc/log/batch?format=json_proto3');
    expect(merge(FORBIDDEN_IN_CODE[2]!, FORBIDDEN_IN_CODE[3]!)).toMatch(/^https:\/\/firebaselogging-pa\.googleapis\.com\//);
  });

  it('finds the forbidden texts in an APK\'s code (stored or compressed), and nothing in a clean one', () => {
    const dirty = Buffer.from(`dex\n035\0...${FORBIDDEN_IN_CODE[0]}...${FORBIDDEN_IN_CODE[1]}...com.google.android.datatransport.cct.CctBackendFactory`);
    const apk = zip({ 'AndroidManifest.xml': Buffer.from('<manifest/>'), 'classes.dex': Buffer.from('dex\n035\0clean'), 'classes2.dex': dirty }, { 'classes2.dex': true });
    const entries = zipEntries(apk);
    expect([...entries.keys()]).toEqual(['AndroidManifest.xml', 'classes.dex', 'classes2.dex']);
    expect(zipRead(apk, entries.get('classes2.dex')).equals(dirty)).toBe(true);
    expect(forbiddenCode(apk).sort()).toEqual([FORBIDDEN_IN_CODE[0], FORBIDDEN_IN_CODE[1], 'CctBackendFactory'].sort());
    expect(forbiddenCode(zip({ 'classes.dex': Buffer.from('dex\n035\0clean') }))).toEqual([]);
  });
});

describe('the app\'s version on the office PC', () => {
  it('is said to the office in the handshake: the version and build of app.json (1.0.2, build 3)', async () => {
    expect(app.expo.version).toBe('1.0.2');
    expect(app.expo.android.versionCode).toBe(3);
    // what App.tsx gives the link
    expect(readFileSync(join(root, 'App.tsx'), 'utf8')).toMatch(/const APP = \{ version: VERSION, build: APP_JSON\.expo\.android\.versionCode \};[\s\S]*new OfficeLink\(\{[^}]*app: APP,/);
    const o = fakeOffice();
    const link = new OfficeLink({ office: o.office, phone: generateKeyPair(), name: 'Samsung', socket: o.socket, app: { version: app.expo.version, build: app.expo.android.versionCode } });
    await link.connect();
    expect(o.claims).toHaveLength(1);
    expect(o.claims[0]).toMatchObject({ name: 'Samsung', appVersion: '1.0.2', appBuild: 3 });
    link.close();
    // a link without it (as 1.0.1 was): the office takes it as not said
    const quiet = new OfficeLink({ office: o.office, phone: generateKeyPair(), name: 'Samsung', socket: o.socket });
    await quiet.connect();
    expect(o.claims[1]).toMatchObject({ appVersion: null, appBuild: null });
    quiet.close();
  });
});

/** A ZIP of these files (`deflate`: the ones to compress), as an APK is. */
function zip(files: Record<string, Buffer>, deflate: Record<string, boolean> = {}): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, plain] of Object.entries(files)) {
    const data = deflate[name] ? deflateRawSync(plain) : plain;
    const method = deflate[name] ? 8 : 0;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(n.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(plain.length, 24);
    entry.writeUInt16LE(n.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, n, data);
    central.push(entry, n);
    offset += 30 + n.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
