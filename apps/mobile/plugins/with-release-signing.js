// Signs a local release build (npx expo prebuild, then gradlew assembleRelease on the owner's PC) with the Qasa
// release key, read at build time from outside the repository:
//   QASA_ANDROID_KEYSTORE                the keystore file (PKCS12), kept outside every repository
//   QASA_ANDROID_KEYSTORE_PASSWORD_FILE  a file next to it holding its password (the same for the key)
//   QASA_ANDROID_KEY_ALIAS               the key's alias (qasa-mobile when not set)
// Nothing secret is written into the project: the generated build.gradle names only these variables.
//
// A release build without QASA_ANDROID_KEYSTORE stops with a message saying so (1.0.2): before, it was signed with
// React Native's public debug key without a word, and such an APK must never reach a phone (Android refuses every
// later update signed with the Qasa key, so the app would have to be uninstalled, with what it has not sent). Two
// builds may go on without it, each only when asked for by name:
//   EAS_BUILD=true                an EAS build (EAS sets it), signed with the credentials EAS keeps
//   QASA_ANDROID_DEBUG_SIGNED=1   a local test build signed with the debug key, never handed out
// After a build, scripts/check-release-apk.mjs checks that the APK carries the Qasa release key's certificate.
//
// A local config plugin (no extra package): Expo applies it when it builds the native project (eas build, prebuild).

const MARK = '// qasa: release signing from the environment';
const GUARD = '// qasa: a release build is signed with the Qasa release key, or it stops';

/** What the build says when the key is missing (names the variables only, never a path or a password). */
const MISSING_KEY = 'Release build without the Qasa release key: set QASA_ANDROID_KEYSTORE and QASA_ANDROID_KEYSTORE_PASSWORD_FILE '
  + '(apps/mobile/README.md, "Build an APK on this PC"). Only for a test build that never goes to a phone in use: '
  + 'QASA_ANDROID_DEBUG_SIGNED=1 signs it with the public debug key.';

/** The app's build.gradle with a "qasa" signing config for the release build, and the release build stopped without it. */
function addReleaseSigning(gradle) {
  if (gradle.includes(MARK)) return gradle;
  const configs = /signingConfigs\s*\{/;
  if (!configs.test(gradle)) throw new Error('with-release-signing: build.gradle has no signingConfigs block');
  let out = gradle.replace(configs, (m) => `${m}
        ${MARK}
        qasa {
            def store = System.getenv('QASA_ANDROID_KEYSTORE')
            if (store) {
                def passwordFile = System.getenv('QASA_ANDROID_KEYSTORE_PASSWORD_FILE')
                if (!passwordFile) throw new GradleException('QASA_ANDROID_KEYSTORE_PASSWORD_FILE is not set')
                def password = new File(passwordFile).getText('UTF-8').trim()
                storeFile file(store)
                storeType 'pkcs12'
                storePassword password
                keyAlias System.getenv('QASA_ANDROID_KEY_ALIAS') ?: 'qasa-mobile'
                keyPassword password
            }
        }`);
  // the release build type: the Qasa key when it is given; else the debug key, for the two builds the guard lets through
  const release = /(release\s*\{[^{}]*?)signingConfig\s+signingConfigs\.debug/;
  if (!release.test(out)) throw new Error('with-release-signing: the release build type has no signingConfig to replace');
  out = out.replace(release, (_m, head) => `${head}signingConfig System.getenv('QASA_ANDROID_KEYSTORE') ? signingConfigs.qasa : signingConfigs.debug`);
  // the guard: the first step of every release build (an APK, a bundle, an install) stops without the key
  return `${out.replace(/\s*$/, '')}

${GUARD}
tasks.matching { it.name == 'preReleaseBuild' }.configureEach {
    doFirst {
        if (!System.getenv('QASA_ANDROID_KEYSTORE') && System.getenv('EAS_BUILD') != 'true' && System.getenv('QASA_ANDROID_DEBUG_SIGNED') != '1') {
            throw new GradleException('${MISSING_KEY}')
        }
    }
}
`;
}

function withReleaseSigning(config) {
  // (required here, not at the top: the app's tests load this file without Expo installed)
  const { withAppBuildGradle } = require('expo/config-plugins');
  return withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== 'groovy') throw new Error('with-release-signing: expected a Groovy build.gradle');
    c.modResults.contents = addReleaseSigning(c.modResults.contents);
    return c;
  });
}

module.exports = withReleaseSigning;
module.exports.addReleaseSigning = addReleaseSigning;
module.exports.MISSING_KEY = MISSING_KEY;
