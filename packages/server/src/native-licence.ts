import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The compiled licence checks (native/licence, Rust, a Node-API addon). Official Windows builds ship it next to the
 * app; builds from the public source may not have it, so callers get null and decide what that means.
 */
export interface NativeLicence {
  /** Strict Ed25519 check with a given public key (base64url). */
  verifyEd25519(publicKey: string, message: Buffer, signature: string): boolean;
  /** "QASA1.…" signed with a key embedded in the addon: its payload as JSON text, else null. */
  verifyLicence(key: string): string | null;
  /** "QACT1.…" from the portal for this machine: its payload as JSON text, else null. */
  verifyActivation(token: string, expectedMachine: string): string | null;
  /** The licence keys embedded in the addon (kept equal to license.ts by a test). */
  publicKeys(): string[];
  /** The activation keys embedded in the addon. */
  activationKeys(): string[];
  /** This PC's ID for activation (32 hex characters), from Windows' MachineGuid and the installation's ID. */
  machineId(installId: string): string;
  /** Seals a small state against editing (tied to this PC). */
  seal(data: string, keyMaterial: string): string;
  /** The data `seal` sealed with the same key material on this PC, else null. */
  open(sealed: string, keyMaterial: string): string | null;
  /** SHA-256 (hex) of a file (the running app.asar), else null. */
  integrity(path: string): string | null;
  /**
   * Whether the file (the running app.asar) is what the official build signed (resources/app.asar.sig, base64url).
   * False when it changed, the signature is wrong, or the addon has no build key embedded yet.
   */
  verifyIntegrity(path: string, signature: string): boolean;
}

const FILE = 'qasa_licence.node';

/**
 * Where the addon may be: next to the Windows app (resources), QASA_NATIVE_LICENCE (the server process sets it to that
 * same file; development and tests), or a local build in the repository. Where Electron gives resourcesPath the variable
 * is never read: anything could set it before starting the app, and require() runs whatever it names with full
 * rights. Only Node-API addons (.node) are ever loaded, never a script.
 */
export function nativeCandidates(env: string | undefined, resources: string | undefined, moduleDirs: string[]): string[] {
  const list: string[] = [];
  if (resources) list.push(join(resources, FILE));
  else if (env) list.push(env);
  list.push(...moduleDirs.map((dir) => join(dir, FILE)));
  return list.filter((file) => file.toLowerCase().endsWith('.node'));
}

function candidates(): string[] {
  const dirs: string[] = [];
  try {
    dirs.push(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'native', 'licence', 'dist'));
  } catch {
    // bundled as CommonJS: no import.meta.url
  }
  if (typeof __dirname === 'string') dirs.push(__dirname);
  return nativeCandidates(process.env.QASA_NATIVE_LICENCE, (process as { resourcesPath?: string }).resourcesPath, dirs);
}

let loaded: NativeLicence | null | undefined;

/** The addon, or null when this build doesn't have one (or it can't be loaded on this system). */
export function loadNative(): NativeLicence | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  const req = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
  for (const file of candidates()) {
    if (!existsSync(file)) continue;
    try {
      const mod = req(file) as Partial<NativeLicence>;
      if (typeof mod.verifyLicence === 'function' && typeof mod.machineId === 'function') {
        loaded = mod as NativeLicence;
        break;
      }
    } catch {
      // a broken or foreign file: as if absent
    }
  }
  return loaded;
}

/** Tests load a specific build, or none. */
export function resetNativeForTests(): void {
  loaded = undefined;
}
