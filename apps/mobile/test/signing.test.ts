import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A local release build is signed with the Qasa release key, named only by environment variables: nothing secret in
 * the project, and an EAS build (no variables) signs with its own credentials as before.
 */
const plugin = createRequire(__filename)('../plugins/with-release-signing.js') as { addReleaseSigning: (gradle: string) => string };
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
}`;

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

  it('refuses a build.gradle it does not recognise rather than leave the release build unsigned by the key', () => {
    expect(() => plugin.addReleaseSigning('android { }')).toThrow(/signingConfigs/);
  });
});
