// Keeps ML Kit's own usage reports to Google out of the app (1.0.2).
//
// Barcode scanning (expo-camera's onBarcodeScanned) runs Google ML Kit on the phone itself: the barcode model is bundled
// in the app and nothing is needed from Google to read a code, and the codes never go to Google. ML Kit also reports how
// its APIs are used straight to Google (firebaselogging.googleapis.com, through Google's data transport library), which
// the app has no need of. (Its brief scanner statistics through Google Play services' own telemetry stay: README.md,
// "Scanning and Google".) Applied when the native project is made (npx expo prebuild, eas build), this:
//   - leaves out the transport's Google backend (com.google.android.datatransport:transport-backend-cct, the code that
//     holds the address and sends) and puts in its place a destination of the app's own
//     (plugins/no-usage-metrics/CCTDestination.java) that names no backend there is and holds no address: the transport
//     drops each report on the phone before storing it, so nothing is sent;
//   - takes the transport's backend list, its JobScheduler service and its alarm receiver (the background sender) out of
//     the app's manifest, so nothing is scheduled or sent later either;
//   - leaves out Google's code scanner and document scanner (play-services-code-scanner and the ML Kit document scanner,
//     with their screens, and the "barcode_ui" module Google Play services would download for them): the app never
//     opens them (it scans with the camera view).
// scripts/check-release-apk.mjs checks a built APK for every one of these.
//
// A local config plugin (no extra package), like the other two in this folder.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const MARK = '// qasa: no usage reports to Google';

/** The transport's backend: Google's sender and address. Its place is taken by plugins/no-usage-metrics. */
const TRANSPORT_BACKEND = { group: 'com.google.android.datatransport', module: 'transport-backend-cct' };
/** Google's scanners with their own screens, which the app does not use. */
const UNUSED_SCANNERS = [
  { group: 'com.google.android.gms', module: 'play-services-code-scanner' },
  { group: 'com.google.android.gms', module: 'play-services-mlkit-document-scanner' }
];
/**
 * The transport's API the stand-in destination is compiled against (only compiled against: the app gets the library
 * through ML Kit, as before). The version ML Kit asks for in expo-camera 58.
 */
const TRANSPORT_RUNTIME = 'com.google.android.datatransport:transport-runtime:2.2.6';

/** What leaves the manifest: [element, android:name]. */
const REMOVED_FROM_MANIFEST = [
  ['service', 'com.google.android.datatransport.runtime.backends.TransportBackendDiscovery'],
  ['service', 'com.google.android.datatransport.runtime.scheduling.jobscheduling.JobInfoSchedulerService'],
  ['receiver', 'com.google.android.datatransport.runtime.scheduling.jobscheduling.AlarmManagerSchedulerBroadcastReceiver'],
  ['activity', 'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity'],
  ['activity', 'com.google.mlkit.vision.documentscanner.internal.GmsDocumentScanningDelegateActivity'],
  // expo-camera asks Google Play services to download the code scanner's module ("barcode_ui") when the app is installed
  ['meta-data', 'com.google.mlkit.vision.DEPENDENCIES']
];

/** Where the stand-in goes in the native project, and where it is kept in this folder. */
const STAND_IN = {
  from: join(__dirname, 'no-usage-metrics', 'CCTDestination.java'),
  to: ['app', 'src', 'main', 'java', 'com', 'google', 'android', 'datatransport', 'cct', 'CCTDestination.java']
};

/** The app's build.gradle without the transport's backend and the two scanners, compiled with the stand-in. */
function addNoUsageMetrics(gradle) {
  if (gradle.includes(MARK)) return gradle;
  const excludes = [TRANSPORT_BACKEND, ...UNUSED_SCANNERS].map((d) => `    exclude group: '${d.group}', module: '${d.module}'`).join('\n');
  return `${gradle.replace(/\s*$/, '')}

${MARK} (plugins/with-no-usage-metrics.js)
configurations.configureEach {
${excludes}
}
dependencies {
    compileOnly '${TRANSPORT_RUNTIME}'
}
`;
}

/** The AndroidManifest (as Expo hands it to a plugin) with the transport's sender and the unused scanners removed. */
function removeUsageMetrics(androidManifest) {
  const manifest = androidManifest && androidManifest.manifest;
  const application = manifest && manifest.application && manifest.application[0];
  if (!application) throw new Error('with-no-usage-metrics: the AndroidManifest has no <application>');
  manifest.$ = manifest.$ || {};
  manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  for (const [element, name] of REMOVED_FROM_MANIFEST) {
    const list = (application[element] = application[element] || []);
    const found = list.find((e) => e.$ && e.$['android:name'] === name);
    if (found) found.$['tools:node'] = 'remove';
    else list.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
  }
  return androidManifest;
}

function withNoUsageMetrics(config) {
  // (required here, not at the top: the app's tests load this file without Expo installed)
  const { withAndroidManifest, withAppBuildGradle, withDangerousMod, withGradleProperties, AndroidConfig } = require('expo/config-plugins');
  const { mkdirSync, writeFileSync } = require('node:fs');
  // expo-camera's own switch for its document scanner (compiled against, not shipped)
  config = withGradleProperties(config, (c) => {
    c.modResults = AndroidConfig.BuildProperties.updateAndroidBuildProperty(c.modResults, 'expo.camera.document-scanner-enabled', 'false');
    return c;
  });
  config = withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== 'groovy') throw new Error('with-no-usage-metrics: expected a Groovy build.gradle');
    c.modResults.contents = addNoUsageMetrics(c.modResults.contents);
    return c;
  });
  config = withAndroidManifest(config, (c) => {
    removeUsageMetrics(c.modResults);
    return c;
  });
  return withDangerousMod(config, ['android', (c) => {
    const target = join(c.modRequest.platformProjectRoot, ...STAND_IN.to);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, readFileSync(STAND_IN.from));
    return c;
  }]);
}

module.exports = withNoUsageMetrics;
module.exports.addNoUsageMetrics = addNoUsageMetrics;
module.exports.removeUsageMetrics = removeUsageMetrics;
module.exports.REMOVED_FROM_MANIFEST = REMOVED_FROM_MANIFEST;
module.exports.STAND_IN = STAND_IN;
