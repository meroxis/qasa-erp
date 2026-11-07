// electron-builder afterPack: signs the packed app.asar's SHA-256 ("QINT1.<hex>", Ed25519) into resources/app.asar.sig,
// which the licence addon (native/licence, verify_integrity) checks against the build key embedded in it. A second
// check next to Electron's own asar integrity fuse. Needs QASA_INTEGRITY_KEY (the build key's private half, PKCS#8 PEM)
// from the release's secrets; without it nothing is signed and the app treats the check as not configured.
const { createHash, createPrivateKey, sign } = require('node:crypto');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
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
};
