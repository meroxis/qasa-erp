// Writes THIRD_PARTY_NOTICES.md: every open-source component Qasa ERP ships or builds with, its version and licence,
// and the licence texts of what ships with the Windows app.
//   node scripts/third-party-notices.mjs
// Sources: the npm lockfiles of the app (package-lock.json) and the Pro module (pro/package-lock.json, when present),
// and the Rust licence module (native/licence/Cargo.lock, with the
// licence read from each crate's Cargo.toml in the local cargo registry when it has been built here). The licence
// texts come from the installed packages (node_modules, the cargo registry).
// The release run (.github/workflows/release.yml) runs it after building the Rust module, so the copy shipped with
// the app (electron-builder.yml extraResources) has every text; the app shows it under Settings → About & legal.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'THIRD_PARTY_NOTICES.md');

/**
 * Build-time packages whose code is in the app all the same: Electron is the runtime itself, and electron-updater
 * (with what it needs at run time) is bundled into the desktop shell by esbuild.
 */
const SHIPPED_WITH_DEPS = ['electron-updater'];
const SHIPPED_ALONE = ['electron'];

/** The lockfile path a package at `from` gets for `dep`, as Node resolves it (nearest node_modules first). */
function resolveIn(packages, from, dep) {
  let base = from;
  for (;;) {
    const candidate = (base ? base + '/' : '') + 'node_modules/' + dep;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut < 0 ? '' : base.slice(0, cut);
  }
}

/** Lockfile paths of the packages in SHIPPED_WITH_DEPS and everything they need at run time. */
function shippedClosure(packages) {
  const out = new Set(SHIPPED_ALONE.map((n) => 'node_modules/' + n).filter((p) => packages[p]));
  const queue = SHIPPED_WITH_DEPS.map((n) => 'node_modules/' + n).filter((p) => packages[p]);
  while (queue.length) {
    const path = queue.pop();
    if (out.has(path)) continue;
    out.add(path);
    const p = packages[path];
    for (const dep of Object.keys({ ...p.dependencies, ...p.optionalDependencies })) {
      const found = resolveIn(packages, path, dep);
      if (found && !out.has(found)) queue.push(found);
    }
  }
  return out;
}

const LICENCE_FILE = /^(licen[cs]e|copying|unlicense)([.\-_].*)?$/i;

/** The licence text(s) in a package or crate folder, or null when there is none. */
function licenceText(dir) {
  if (!dir || !existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => LICENCE_FILE.test(f)).sort();
  if (!files.length) return null;
  return files.map((f) => readFileSync(join(dir, f), 'utf8').replace(/\r\n?/g, '\n').trim()).join('\n\n');
}

/** Packages from an npm v2/v3 lockfile: name → { version, licence, dev, dir }. Workspace links and the root are skipped. */
function npmPackages(lockFile) {
  const out = new Map();
  if (!existsSync(lockFile)) return out;
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  const packages = lock.packages ?? {};
  const shipped = lockFile === join(root, 'package-lock.json') ? shippedClosure(packages) : new Set();
  for (const [path, p] of Object.entries(packages)) {
    if (!path.includes('node_modules/') || p.link) continue;
    const name = p.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const licence = typeof p.license === 'string' ? p.license : Array.isArray(p.licenses) ? p.licenses.map((l) => l.type ?? l).join(' OR ') : 'see package';
    const key = `${name}@${p.version}`;
    const seen = out.get(key);
    const dev = !!p.dev && !shipped.has(path);
    // a package is a runtime one if any copy of it is
    out.set(key, { name, version: p.version ?? '?', licence, dev: seen ? seen.dev && dev : dev, dir: seen?.dir ?? join(dirname(lockFile), path) });
  }
  return out;
}

/** Crate licences from the notices written before, for a machine whose cargo registry doesn't have the crate. */
function earlierCrateLicences() {
  const out = new Map();
  if (!existsSync(OUT)) return out;
  const text = readFileSync(OUT, 'utf8');
  const start = text.indexOf('## The licence module (Rust)');
  if (start < 0) return out;
  const end = text.indexOf('\n## ', start + 1);
  for (const m of text.slice(start, end < 0 ? undefined : end).matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]+) \| /gm)) {
    const licence = m[3].trim();
    if (licence !== 'see crate' && m[1].trim() !== 'Component') out.set(`${m[1].trim()}@${m[2].trim()}`, licence);
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
  const earlier = earlierCrateLicences();
  for (const block of text.split('[[package]]').slice(1)) {
    const name = /name = "([^"]+)"/.exec(block)?.[1];
    const version = /version = "([^"]+)"/.exec(block)?.[1];
    if (!name || !version || !/source = "registry/.test(block)) continue; // our own crate has no registry source
    let licence = knownCrate(name) ?? earlier.get(`${name}@${version}`) ?? 'see crate';
    let dir = null;
    for (const index of indexes) {
      const toml = join(index, `${name}-${version}`, 'Cargo.toml');
      if (existsSync(toml)) {
        licence = /^license\s*=\s*"([^"]+)"/m.exec(readFileSync(toml, 'utf8'))?.[1] ?? licence;
        dir = dirname(toml);
        break;
      }
    }
    out.set(`${name}@${version}`, { name, version, licence, dev: false, dir });
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

/** The licence texts of the shipped components, one block per distinct text with every component that uses it. */
function texts(groups) {
  const byText = new Map();
  const missing = [];
  for (const packages of groups) {
    for (const p of packages.values()) {
      if (p.dev) continue;
      const text = licenceText(p.dir);
      if (!text) { missing.push(`${p.name} ${p.version} (${p.licence})`); continue; }
      const names = byText.get(text) ?? new Set();
      names.add(`${p.name} ${p.version}`);
      byText.set(text, names);
    }
  }
  const blocks = [...byText.entries()]
    .map(([text, names]) => ({ names: [...names].sort(), text }))
    .sort((a, b) => a.names[0].localeCompare(b.names[0]))
    .map(({ names, text }) => `### ${names.join(', ')}\n\n\`\`\`text\n${text.replace(/```/g, "'''")}\n\`\`\`\n`);
  const gap = missing.length
    ? `\nThese shipped components have no licence file in their package here; their licence is the one named in the tables above:\n\n${missing.sort().map((m) => `- ${m}`).join('\n')}\n`
    : '';
  return `## Licence texts\n\nThe licence texts of the components shipped with the Windows app, as each one gives it.\n${gap}\n${blocks.join('\n')}`;
}

const app = npmPackages(join(root, 'package-lock.json'));
const pro = npmPackages(join(root, 'pro', 'package-lock.json'));
const rust = crates(join(root, 'native', 'licence', 'Cargo.lock'));
const sections = [
  table('The Windows app and its server', 'From `package-lock.json` (the app, the server, the web screens and the desktop shell).', app),
  table('The Pro module', 'From `pro/package-lock.json` (official builds only).', pro),
  table('The licence module (Rust)', 'From `native/licence/Cargo.lock`: the open-source crates the proprietary licence module is built with (the module itself is not listed).', rust)
  // The phone app (apps/mobile) is not part of 1.0: its components are listed here again once it ships.
].filter(Boolean);

const all = sections.join('\n');
const licences = new Map();
for (const m of all.matchAll(/^\| [^|]+ \| [^|]+ \| ([^|]+) \| shipped \|$/gm)) licences.set(m[1].trim(), (licences.get(m[1].trim()) ?? 0) + 1);
const summary = [...licences.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l, n]) => `- ${l}: ${n}`).join('\n');

writeFileSync(OUT, `# Third-party notices

Qasa ERP is © Meroxis. Its core is free software under the GNU Affero General Public License, version 3 or later (see
LICENSE and NOTICE). The Pro module and the licence module (native/licence) of the official builds are not open source:
they are proprietary to Meroxis, all rights reserved (native/licence/LICENSE). Qasa ERP is built
with the open-source components listed below, each under its own licence. This file is generated by
\`node scripts/third-party-notices.mjs\` from the lockfiles; "build only" components are used to build or test and are
not shipped. The licence texts of the components shipped with the Windows app are at the end of this file, and this
file is installed with the app.

Fonts: IBM Plex Sans, Noto Sans Arabic and Noto Kufi Arabic (via @fontsource) — SIL Open Font License 1.1.
The Node.js runtime and Chromium are part of Electron — MIT and BSD-style licences; SQLite (built into Node.js) is in
the public domain.

## Licences of the shipped components

${summary}

${all}
${texts([app, pro, rust])}`);
console.log(`THIRD_PARTY_NOTICES.md: ${sections.length} sections, ${[...all.matchAll(/^\| (?!Component|---)/gm)].length} components`);
