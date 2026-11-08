// Copies the phone link protocol from the Pro module (pro/src/phone/protocol.ts, the one source of truth) into the
// app. The app's copy is committed, so the app builds without the private Pro module; test/protocol.test.ts checks
// that the two stay the same whenever pro/ is present.
//   node scripts/sync-protocol.mjs
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', '..', '..', 'pro', 'src', 'phone', 'protocol.ts');
const target = join(here, '..', 'src', 'protocol.ts');
if (!existsSync(source)) {
  console.log('pro/ is not here (public checkout): keeping src/protocol.ts as it is');
} else {
  copyFileSync(source, target);
  console.log('src/protocol.ts updated from pro/src/phone/protocol.ts');
}
