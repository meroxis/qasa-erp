// Checks a release APK before it goes to phones (README.md, "Build an APK on this PC"):
//   - Android's apksigner verifies its signature, and its one signing certificate is the Qasa release key's: the
//     fingerprint phones already have and the desktop's Settings shows (PHONE_APP.certSha256 in
//     apps/web/src/pages/Settings.tsx, RELEASE_CERT_SHA256 here; a test keeps the two the same). An APK signed with any
//     other key (React Native's public debug key, a new key) is refused here: Android would not update the app with it;
//   - it is the version app.json says;
//   - none of Google's usage reporting is in it (plugins/with-no-usage-metrics.js): not in the manifest, not in the code;
// then prints what the download page and PHONE_APP need: the APK's SHA-256 and size, its SDK levels and permissions.
//   node scripts/check-release-apk.mjs <file.apk>
// Needs Java (JAVA_HOME, or java on the PATH) and an Android SDK (ANDROID_HOME or ANDROID_SDK_ROOT) with build-tools
// (apksigner, aapt2). It reads the APK only: no key, no password.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';

/** The Qasa release key's certificate (CN=Meroxis, O=Meroxis, C=IQ): SHA-256 of its DER encoding, as apksigner prints it. */
export const RELEASE_CERT_SHA256 = '6d8fb6a65d85d9f82b026b5ef6aa00acfd956cef63d555cf6fffd3596a4b3129';

const here = dirname(fileURLToPath(import.meta.url));
const { REMOVED_FROM_MANIFEST } = createRequire(import.meta.url)('../plugins/with-no-usage-metrics.js');

/**
 * What must not be in the app's code: the two halves of Google's reporting address (firebaselogging.googleapis.com,
 * kept split in Google's library) and of its older one, and Google's sender itself.
 */
export const FORBIDDEN_IN_CODE = [
  'hts/frbslgiggolai.o/0clgbthfra=snpoo', 'tp:/ieaeogn.ogepscmvc/o/ac?omtjo_rt3',
  'hts/frbslgigp.ogepscmv/ieo/eaybtho', 'tp:/ieaeogn-agolai.o/1frlglgc/aclg',
  'firebaselogging', 'CctBackendFactory', 'Missing endpoint in CCTDestination extras'
];
/** What must not be in the manifest: the transport's sender and the unused scanners (and their module). */
export const FORBIDDEN_IN_MANIFEST = [...REMOVED_FROM_MANIFEST.map(([, name]) => name), 'CctBackendFactory', 'barcode_ui'];
/** The libraries left out, as each leaves a file of its name in an APK. */
export const FORBIDDEN_FILES = ['transport-backend-cct.properties', 'play-services-code-scanner.properties', 'play-services-mlkit-document-scanner.properties'];

// ——— the APK as a ZIP file (no package needed) ———

/** The files in a ZIP: name → where its data is and how it is stored. */
export function zipEntries(zip) {
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 65_535); at--) {
    if (zip.readUInt32LE(at) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new Error('not a ZIP file (no end of central directory)');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('broken ZIP central directory');
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    entries.set(zip.toString('utf8', at + 46, at + 46 + nameLength), { method, compressed, local });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** One file's bytes out of a ZIP (stored or deflated). */
export function zipRead(zip, entry) {
  if (zip.readUInt32LE(entry.local) !== 0x04034b50) throw new Error('broken ZIP local header');
  const start = entry.local + 30 + zip.readUInt16LE(entry.local + 26) + zip.readUInt16LE(entry.local + 28);
  const data = zip.subarray(start, start + entry.compressed);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`unsupported ZIP method ${entry.method}`);
}

/** Which of the forbidden texts the app's code (every classes*.dex) holds. */
export function forbiddenCode(zip, entries = zipEntries(zip)) {
  const found = new Set();
  for (const [name, entry] of entries) {
    if (!/^classes\d*\.dex$/.test(name)) continue;
    const dex = zipRead(zip, entry);
    for (const text of FORBIDDEN_IN_CODE) if (dex.includes(Buffer.from(text, 'utf8'))) found.add(text);
  }
  return [...found];
}

// ——— what apksigner and aapt2 say ———

/**
 * apksigner verify --verbose --print-certs: whether it verifies, by which schemes, and each signer's certificate. The
 * signer lines read "Signer #1 certificate DN: …" without --verbose and "V2 Signer: certificate DN: …" (one set per
 * scheme, "V2 Signer #2: …" when there are more signers) with it.
 */
export function parseApksigner(text) {
  const lines = text.split(/\r?\n/);
  const signers = [];
  for (const line of lines) {
    const m = /^(?:Signer #(\d+)|V[\d.]+ Signer(?: #(\d+))?:) certificate (DN|SHA-256 digest): (.+)$/.exec(line.trim());
    if (!m) continue;
    const i = Number(m[1] ?? m[2] ?? 1) - 1;
    signers[i] = signers[i] ?? {};
    if (m[3] === 'DN') signers[i].dn = m[4];
    else signers[i].sha256 = m[4].toLowerCase();
  }
  const scheme = (v) => lines.some((l) => new RegExp(`^Verified using ${v} scheme .*: true$`).test(l.trim()));
  return {
    verifies: lines.some((l) => l.trim() === 'Verifies'),
    v2: scheme('v2'), v3: scheme('v3'),
    count: Number(/^Number of signers: (\d+)$/m.exec(text.replace(/\r/g, ''))?.[1] ?? signers.length),
    signers
  };
}

/** aapt2 dump badging: the package, its version, SDK levels and permissions. */
export function parseBadging(text) {
  const t = text.replace(/\r/g, '');
  const attr = (line, name) => new RegExp(`${name}='([^']*)'`).exec(line)?.[1] ?? null;
  const pkg = /^package: .*$/m.exec(t)?.[0] ?? '';
  return {
    package: attr(pkg, 'name'), versionCode: Number(attr(pkg, 'versionCode')), versionName: attr(pkg, 'versionName'),
    minSdk: Number(/^(?:minSdkVersion|sdkVersion):'(\d+)'/m.exec(t)?.[1]), targetSdk: Number(/^targetSdkVersion:'(\d+)'/m.exec(t)?.[1]),
    permissions: [...t.matchAll(/^uses-permission: name='([^']+)'/gm)].map((m) => m[1]).sort()
  };
}

// ——— the tools ———

/** The newest build-tools of the SDK that has apksigner and aapt2. */
function buildTools() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('set ANDROID_HOME (or ANDROID_SDK_ROOT) to the Android SDK');
  const root = join(sdk, 'build-tools');
  const versions = readdirSync(root).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  for (const v of versions) {
    const dir = join(root, v);
    const aapt2 = join(dir, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2');
    const apksigner = join(dir, 'lib', 'apksigner.jar');
    if (existsSync(aapt2) && existsSync(apksigner)) return { aapt2, apksigner, version: v };
  }
  throw new Error(`no build-tools with apksigner and aapt2 in ${root}`);
}

const java = () => (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java');
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/** Every check on one APK: { ok, problems, facts }. */
export function checkApk(apk, { expected = RELEASE_CERT_SHA256, appJson = join(here, '..', 'app.json') } = {}) {
  const problems = [];
  const zip = readFileSync(apk);
  const tools = buildTools();
  const signed = parseApksigner(run(java(), ['-jar', tools.apksigner, 'verify', '--verbose', '--print-certs', apk]));
  if (!signed.verifies) problems.push('apksigner: the signature does not verify');
  if (!signed.v2 && !signed.v3) problems.push('not signed with APK Signature Scheme v2 or v3');
  if (signed.count !== 1) problems.push(`${signed.count} signers (one is expected: the Qasa release key)`);
  if (signed.signers[0]?.sha256 !== expected) problems.push(`signed with another certificate (${signed.signers[0]?.sha256 ?? 'none'}), not the Qasa release key (${expected})`);
  const badging = parseBadging(run(tools.aapt2, ['dump', 'badging', apk]));
  if (existsSync(appJson)) {
    const app = JSON.parse(readFileSync(appJson, 'utf8')).expo;
    if (badging.versionName !== app.version || badging.versionCode !== app.android.versionCode) {
      problems.push(`version ${badging.versionName} (${badging.versionCode}), but app.json says ${app.version} (${app.android.versionCode})`);
    }
  }
  const manifest = run(tools.aapt2, ['dump', 'xmltree', '--file', 'AndroidManifest.xml', apk]);
  for (const name of FORBIDDEN_IN_MANIFEST) if (manifest.includes(name)) problems.push(`the manifest still has ${name}`);
  const entries = zipEntries(zip);
  for (const name of FORBIDDEN_FILES) if (entries.has(name)) problems.push(`the APK still has ${name}`);
  for (const text of forbiddenCode(zip, entries)) problems.push(`the code still has "${text}"`);
  return {
    ok: problems.length === 0, problems,
    facts: {
      file: resolve(apk), bytes: statSync(apk).size, sha256: createHash('sha256').update(zip).digest('hex'),
      certificate: signed.signers[0] ?? null, schemes: { v2: signed.v2, v3: signed.v3 }, buildTools: tools.version, ...badging
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const apk = process.argv[2];
  if (!apk || !existsSync(apk)) {
    console.error('usage: node scripts/check-release-apk.mjs <file.apk>');
    process.exit(2);
  }
  const result = checkApk(apk);
  const f = result.facts;
  console.log(`${f.file}
  package      ${f.package} ${f.versionName} (versionCode ${f.versionCode})
  SDK          min ${f.minSdk}, target ${f.targetSdk}
  permissions  ${f.permissions.join(', ')}
  signed by    ${f.certificate?.dn ?? '?'} (v2 ${f.schemes.v2}, v3 ${f.schemes.v3})
  certificate  SHA-256 ${f.certificate?.sha256 ?? '?'}
  APK          ${f.bytes} bytes, SHA-256 ${f.sha256}`);
  if (!result.ok) {
    for (const p of result.problems) console.error(`NOT OK: ${p}`);
    process.exit(1);
  }
  console.log('OK: signed with the Qasa release key, and no usage reporting to Google in it');
}
