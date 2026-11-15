// Signs a local release build (npx expo prebuild, then gradlew assembleRelease on the owner's PC) with the Qasa
// release key, read at build time from outside the repository:
//   QASA_ANDROID_KEYSTORE                the keystore file (PKCS12), kept outside every repository
//   QASA_ANDROID_KEYSTORE_PASSWORD_FILE  a file next to it holding its password (the same for the key)
//   QASA_ANDROID_KEY_ALIAS               the key's alias (qasa-mobile when not set)
// Nothing secret is written into the project: the generated build.gradle names only these variables. Without them
// (an EAS build, which signs with its own credentials, or a developer's machine) the build is signed as before.
//
// A local config plugin (no extra package): Expo applies it when it builds the native project (eas build, prebuild).

const MARK = '// qasa: release signing from the environment';

/** The app's build.gradle with a "qasa" signing config, used by the release build when the variables are set. */
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
  // the release build type: the Qasa key when it is given, else what the template had
  const release = /(release\s*\{[^{}]*?)signingConfig\s+signingConfigs\.debug/;
  if (!release.test(out)) throw new Error('with-release-signing: the release build type has no signingConfig to replace');
  out = out.replace(release, (_m, head) => `${head}signingConfig System.getenv('QASA_ANDROID_KEYSTORE') ? signingConfigs.qasa : signingConfigs.debug`);
  return out;
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
