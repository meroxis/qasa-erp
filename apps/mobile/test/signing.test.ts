import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseApksigner, parseBadging, RELEASE_CERT_SHA256 } from '../scripts/check-release-apk.mjs';

/**
 * A local release build is signed with the Qasa release key, named only by environment variables: nothing secret in
 * the project. Without the key a release build stops (1.0.2), unless it is an EAS build (EAS signs it) or a local test
 * build asked for by name; and scripts/check-release-apk.mjs checks the built APK's certificate.
 */
const plugin = createRequire(__filename)('../plugins/with-release-signing.js') as { addReleaseSigning: (gradle: string) => string; MISSING_KEY: string };
const app = JSON.parse(readFileSync(join(__dirname, '..', 'app.json'), 'utf8')) as { expo: { plugins: unknown[] } };

// the part of the build.gradle that `expo prebuild` writes (Expo SDK 58)
const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}

dependencies {
    implementation("com.facebook.react:react-android")
}
`;

describe('release signing', () => {
  it('is applied by the app\'s config', () => {
    expect(app.expo.plugins).toContain('./plugins/with-release-signing.js');
  });

  it('signs the release build with the key the environment names, and the debug build as before', () => {
    const out = plugin.addReleaseSigning(TEMPLATE);
    expect(out).toContain("System.getenv('QASA_ANDROID_KEYSTORE')");
    expect(out).toContain("System.getenv('QASA_ANDROID_KEYSTORE_PASSWORD_FILE')");
    expect(out).toMatch(/release \{[\s\S]*signingConfig System\.getenv\('QASA_ANDROID_KEYSTORE'\) \? signingConfigs\.qasa : signingConfigs\.debug/);
    expect(out).toMatch(/debug \{\s*signingConfig signingConfigs\.debug\s*\}/);
    // no password, path or alias other than the default is written into the project
    expect(out).not.toMatch(/\.qasa-keys|storePassword '(?!android)/);
    // applied twice (prebuild again): the same file
    expect(plugin.addReleaseSigning(out)).toBe(out);
  });

  it('stops a release build without the key, except an EAS build or a local test build asked for by name', () => {
    const out = plugin.addReleaseSigning(TEMPLATE);
    // the first step of every release build (an APK, a bundle, an install)
    const guard = /tasks\.matching \{ it\.name == 'preReleaseBuild' \}\.configureEach \{\s*doFirst \{\s*if \((.*)\) \{\s*throw new GradleException\('([^']*)'\)/.exec(out);
    expect(guard, out).not.toBeNull();
    expect(guard![1]).toBe("!System.getenv('QASA_ANDROID_KEYSTORE') && System.getenv('EAS_BUILD') != 'true' && System.getenv('QASA_ANDROID_DEBUG_SIGNED') != '1'");
    // the message says what to set, inside a Groovy string (no quote of its own), and never a path or a password
    expect(guard![2]).toBe(plugin.MISSING_KEY);
    expect(plugin.MISSING_KEY).not.toMatch(/['\\$]/);
    expect(plugin.MISSING_KEY).toMatch(/QASA_ANDROID_KEYSTORE and QASA_ANDROID_KEYSTORE_PASSWORD_FILE/);
    expect(plugin.MISSING_KEY).toMatch(/QASA_ANDROID_DEBUG_SIGNED=1/);
    // after the android block, once
    expect(out.indexOf('preReleaseBuild')).toBeGreaterThan(out.indexOf('buildTypes'));
    expect(out.match(/preReleaseBuild/g)).toHaveLength(1);
  });

  it('refuses a build.gradle it does not recognise rather than leave the release build unsigned by the key', () => {
    expect(() => plugin.addReleaseSigning('android { }')).toThrow(/signingConfigs/);
  });
});

describe('the check of a built APK (scripts/check-release-apk.mjs)', () => {
  it('expects the Qasa release key\'s certificate, the one the desktop shows (PHONE_APP.certSha256)', () => {
    expect(RELEASE_CERT_SHA256).toMatch(/^[0-9a-f]{64}$/);
    const settings = join(__dirname, '..', '..', 'web', 'src', 'pages', 'Settings.tsx');
    if (!existsSync(settings)) return;
    expect(readFileSync(settings, 'utf8')).toContain(`certSha256: '${RELEASE_CERT_SHA256}'`);
  });

  it('reads what apksigner says: verified, how, and by whom', () => {
    const out = [
      'Verifies',
      'Verified using v1 scheme (JAR signing): false',
      'Verified using v2 scheme (APK Signature Scheme v2): true',
      'Verified using v3 scheme (APK Signature Scheme v3): false',
      'Number of signers: 1',
      'Signer #1 certificate DN: CN=Meroxis, O=Meroxis, C=IQ',
      `Signer #1 certificate SHA-256 digest: ${RELEASE_CERT_SHA256}`,
      'Signer #1 certificate SHA-1 digest: 0000000000000000000000000000000000000000',
      'WARNING: META-INF/com/android/build/gradle/app-metadata.properties not protected by signature.'
    ].join('\r\n');
    expect(parseApksigner(out)).toEqual({
      verifies: true, v2: true, v3: false, count: 1, signers: [{ dn: 'CN=Meroxis, O=Meroxis, C=IQ', sha256: RELEASE_CERT_SHA256 }]
    });
    // with --verbose apksigner names the scheme instead (what scripts/check-release-apk.mjs runs; build-tools 37)
    const verbose = out.replace('Signer #1 certificate DN:', 'V2 Signer: certificate DN:').replace('Signer #1 certificate SHA-256', 'V2 Signer: certificate SHA-256');
    expect(parseApksigner(verbose)).toEqual(parseApksigner(out));
    expect(parseApksigner('Verifies\nNumber of signers: 2\nV2 Signer #2: certificate SHA-256 digest: AB\nV2 Signer #1: certificate SHA-256 digest: CD\n').signers)
      .toEqual([{ sha256: 'cd' }, { sha256: 'ab' }]);
    // another key (React Native's public debug key, say) is told apart; so is an APK that does not verify
    const other = parseApksigner('Verifies\nVerified using v2 scheme (APK Signature Scheme v2): true\nNumber of signers: 1\nSigner #1 certificate DN: C=US, O=Android, CN=Android Debug\nSigner #1 certificate SHA-256 digest: ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789\n');
    expect(other.signers[0]!.sha256).toBe('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789');
    expect(parseApksigner('DOES NOT VERIFY\nERROR: Missing META-INF/MANIFEST.MF\n')).toMatchObject({ verifies: false, count: 0 });
  });

  it('reads what aapt2 says of the package', () => {
    const out = "package: name='iq.qasaerp.mobile' versionCode='3' versionName='1.0.2' platformBuildVersionName='17'\r\n"
      + "minSdkVersion:'24'\r\ntargetSdkVersion:'36'\r\nuses-permission: name='android.permission.INTERNET'\r\nuses-permission: name='android.permission.CAMERA'\r\n";
    expect(parseBadging(out)).toEqual({
      package: 'iq.qasaerp.mobile', versionCode: 3, versionName: '1.0.2', minSdk: 24, targetSdk: 36,
      permissions: ['android.permission.CAMERA', 'android.permission.INTERNET']
    });
  });
});
