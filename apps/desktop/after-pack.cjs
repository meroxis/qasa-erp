// electron-builder afterPack: signs the packed app.asar's SHA-256 ("QINT1.<hex>", Ed25519) into resources/app.asar.sig,
// which the licence addon (native/licence, verify_integrity) checks against the build key embedded in it. A second
// check next to Electron's own asar integrity fuse. Needs QASA_INTEGRITY_KEY (the build key's private half, PKCS#8 PEM)
// from the release's secrets; without it nothing is signed and the app treats the check as not configured.
const { createHash, createPrivateKey, sign } = require('node:crypto');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

/**
 * The app.asar self-check is OFF in 1.0 (owner decision): this step signs nothing, even when QASA_INTEGRITY_KEY is
 * set, so no build carries app.asar.sig and nothing in the app checks one. Electron's own asar integrity fuse
 * (electron-builder.yml) is separate and stays on. Turn this on only together with a build key in INTEGRITY_KEYS
 * (native/licence/src/lib.rs) and the QASA_INTEGRITY_KEY secret (native/licence/README.md).
 */
const INTEGRITY_CHECK = false;

async function afterPack(context) {
  if (!INTEGRITY_CHECK) {
    console.log('  • app.asar signature: off in this release (INTEGRITY_CHECK in after-pack.cjs)');
    return;
  }
  const pem = process.env.QASA_INTEGRITY_KEY;
  const resources = join(context.appOutDir, 'resources');
  const asar = join(resources, 'app.asar');
  if (!pem || !existsSync(asar)) {
    console.log('  • app.asar signature: skipped (no QASA_INTEGRITY_KEY)');
    return;
  }
  const hash = createHash('sha256').update(readFileSync(asar)).digest('hex');
  const signature = sign(null, Buffer.from(`QINT1.${hash}`), createPrivateKey(pem.replace(/\\n/g, '\n')));
  writeFileSync(join(resources, 'app.asar.sig'), signature.toString('base64url'));
  console.log('  • app.asar signature: written');
}

exports.default = afterPack;
exports.INTEGRITY_CHECK = INTEGRITY_CHECK;
