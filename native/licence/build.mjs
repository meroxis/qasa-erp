// Builds the licence addon and puts it where the app looks for it: dist/qasa_licence.node.
//   node native/licence/build.mjs        (needs Rust: https://rustup.rs; on Windows the MSVC toolchain)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// --locked: exactly the crate versions in Cargo.lock, never newer ones picked up at build time
execFileSync('cargo', ['build', '--release', '--locked'], { cwd: here, stdio: 'inherit' });
const built = { win32: 'qasa_licence.dll', darwin: 'libqasa_licence.dylib' }[process.platform] ?? 'libqasa_licence.so';
const from = join(here, 'target', 'release', built);
if (!existsSync(from)) throw new Error(`cargo did not make ${from}`);
mkdirSync(join(here, 'dist'), { recursive: true });
copyFileSync(from, join(here, 'dist', 'qasa_licence.node'));
console.log('licence addon: native/licence/dist/qasa_licence.node');
