// Writes THIRD_PARTY_NOTICES.md: every open-source component Qasa ERP ships or builds with, its version and licence.
//   node scripts/third-party-notices.mjs
// Sources: the npm lockfiles of the app (package-lock.json), the Pro module (pro/package-lock.json, when present) and
// the phone app (apps/mobile/package-lock.json), and the Rust licence module (native/licence/Cargo.lock, with the
// licence read from each crate's Cargo.toml in the local cargo registry when it has been built here).
// Run it before each release and commit the result; the app shows it under Settings → About & legal.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Packages from an npm v2/v3 lockfile: name → { version, licence, dev }. Workspace links and the root are skipped. */
function npmPackages(lockFile) {
  const out = new Map();
  if (!existsSync(lockFile)) return out;
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  for (const [path, p] of Object.entries(lock.packages ?? {})) {
    if (!path.includes('node_modules/') || p.link) continue;
    const name = p.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const licence = typeof p.license === 'string' ? p.license : Array.isArray(p.licenses) ? p.licenses.map((l) => l.type ?? l).join(' OR ') : 'see package';
    const key = `${name}@${p.version}`;
    const seen = out.get(key);
    // a package is a runtime one if any copy of it is
    out.set(key, { name, version: p.version ?? '?', licence, dev: seen ? seen.dev && !!p.dev : !!p.dev });
  }
  return out;
}

/** Licences of crates only downloaded on Windows (so not in a Linux build's registry), from crates.io. */
const KNOWN_CRATES = { winreg: 'MIT', 'windows-sys': 'MIT OR Apache-2.0', 'windows-targets': 'MIT OR Apache-2.0' };
const knownCrate = (name) => KNOWN_CRATES[name] ?? (/^windows_(aarch64|i686|x86_64)_/.test(name) ? 'MIT OR Apache-2.0' : null);

/** Crates from Cargo.lock, with the licence from the cargo registry when the crate was downloaded on this machine. */
function crates(lockFile) {
  const out = new Map();
  if (!existsSync(lockFile)) return out;
  const text = readFileSync(lockFile, 'utf8');
  const registry = join(process.env.CARGO_HOME ?? join(homedir(), '.cargo'), 'registry', 'src');
  const indexes = existsSync(registry) ? readdirSync(registry).map((d) => join(registry, d)) : [];
  for (const block of text.split('[[package]]').slice(1)) {
    const name = /name = "([^"]+)"/.exec(block)?.[1];
    const version = /version = "([^"]+)"/.exec(block)?.[1];
    if (!name || !version || !/source = "registry/.test(block)) continue; // our own crate has no registry source
    let licence = knownCrate(name) ?? 'see crate';
    for (const index of indexes) {
      const toml = join(index, `${name}-${version}`, 'Cargo.toml');
      if (existsSync(toml)) {
        licence = /^license\s*=\s*"([^"]+)"/m.exec(readFileSync(toml, 'utf8'))?.[1] ?? licence;
        break;
      }
    }
    out.set(`${name}@${version}`, { name, version, licence, dev: false });
  }
  return out;
}

const escape = (s) => String(s).replace(/\|/g, '\\|');

function table(title, note, packages) {
  const rows = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  if (!rows.length) return '';
  const lines = rows.map((p) => `| ${escape(p.name)} | ${escape(p.version)} | ${escape(p.licence)} | ${p.dev ? 'build only' : 'shipped'} |`);
  return `## ${title}\n\n${note}\n\n| Component | Version | Licence | Use |\n|---|---|---|---|\n${lines.join('\n')}\n`;
}

const sections = [
  table('The Windows app and its server', 'From `package-lock.json` (the app, the server, the web screens and the desktop shell).', npmPackages(join(root, 'package-lock.json'))),
  table('The Pro module', 'From `pro/package-lock.json` (official builds only).', npmPackages(join(root, 'pro', 'package-lock.json'))),
  table('The licence module (Rust)', 'From `native/licence/Cargo.lock`.', crates(join(root, 'native', 'licence', 'Cargo.lock'))),
  table('The phone app', 'From `apps/mobile/package-lock.json`.', npmPackages(join(root, 'apps', 'mobile', 'package-lock.json')))
].filter(Boolean);

const all = sections.join('\n');
const licences = new Map();
for (const m of all.matchAll(/^\| [^|]+ \| [^|]+ \| ([^|]+) \| shipped \|$/gm)) licences.set(m[1].trim(), (licences.get(m[1].trim()) ?? 0) + 1);
const summary = [...licences.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => `- ${l}: ${n}`).join('\n');

writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), `# Third-party notices

Qasa ERP is © Meroxis. Its core is free software under the GNU Affero General Public License, version 3 or later (see
LICENSE and NOTICE); the Pro module and the licence module of the official builds are proprietary. Qasa ERP is built
with the open-source components listed below, each under its own licence. This file is generated by
\`node scripts/third-party-notices.mjs\` from the lockfiles; "build only" components are used to build or test and are
not shipped. The full licence texts are in each component's package.

Fonts: IBM Plex Sans, Noto Sans Arabic and Noto Kufi Arabic (via @fontsource) — SIL Open Font License 1.1.
The Node.js runtime and Chromium are part of Electron — MIT and BSD-style licences; SQLite (built into Node.js) is in
the public domain.

## Licences of the shipped components

${summary}

${all}`);
console.log(`THIRD_PARTY_NOTICES.md: ${sections.length} sections, ${[...all.matchAll(/^\| (?!Component|---)/gm)].length} components`);
