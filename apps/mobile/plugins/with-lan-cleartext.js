// Lets the Android app open plain ws:// to the office PC on the same Wi-Fi (ws://<address>:47421/phone).
//
// Android release builds refuse cleartext connections by default ("CLEARTEXT communication not permitted"); debug
// builds allow them, so without this only the Play Store build would fail on the Wi-Fi and show the office as offline.
// Android's network security config can only name host names, not private IP ranges, and the office PC's address is
// whatever its Wi-Fi gives it, so cleartext is allowed for the app as a whole. Nothing readable goes over it: the phone
// link runs its own end-to-end encrypted, authenticated session inside the WebSocket (src/protocol.ts), and the relay
// route is wss://.
//
// A local config plugin (no extra package): Expo applies it when it builds the native project (eas build, prebuild).

/** Sets android:usesCleartextTraffic="true" on <application> in the AndroidManifest that Expo hands the plugin. */
function allowCleartext(androidManifest) {
  const application = androidManifest && androidManifest.manifest && androidManifest.manifest.application && androidManifest.manifest.application[0];
  if (!application) throw new Error('with-lan-cleartext: the AndroidManifest has no <application>');
  application.$ = application.$ || {};
  application.$['android:usesCleartextTraffic'] = 'true';
  return androidManifest;
}

function withLanCleartext(config) {
  // (required here, not at the top: the app's tests load this file without Expo installed)
  const { withAndroidManifest } = require('expo/config-plugins');
  return withAndroidManifest(config, (c) => {
    allowCleartext(c.modResults);
    return c;
  });
}

module.exports = withLanCleartext;
module.exports.allowCleartext = allowCleartext;
