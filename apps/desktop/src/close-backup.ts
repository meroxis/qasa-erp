import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Back up when Qasa ERP closes (1.1, Settings → Backups, Pro), in the main process. When it is on and the books
 * changed, closing waits for the backup (and its copy and upload) with a small "Backing up…" box and a Skip button,
 * never longer than CLOSE_BACKUP_LIMIT_MS: then the app closes anyway. A failure is noted and said at the next start.
 * Windows shutting down or signing out skips it (a copy cut off there must never be mistaken for a backup: the Pro
 * module writes each file under a temporary name and renames it only once it is whole). Not on a PC connected to an
 * office server: the books are not on it.
 */

export const CLOSE_BACKUP_LIMIT_MS = 60_000;
const NOTE = 'close-backup-failed.json';

export type CloseOutcome = { kind: 'none' } | { kind: 'done'; file: string } | { kind: 'skipped' } | { kind: 'failed'; error: string };

export interface CloseBackupDeps {
  /** this PC keeps the books, and Windows is not shutting down */
  allowed: boolean;
  needed(): Promise<boolean>;
  backup(): Promise<{ ok: boolean; file?: string; error?: string }>;
  /** shows the box; resolves when the person presses Skip; the AbortSignal closes it */
  showBox(signal: AbortSignal): Promise<void>;
  limitMs?: number;
}

export async function backupOnClose(deps: CloseBackupDeps): Promise<CloseOutcome> {
  if (!deps.allowed) return { kind: 'none' };
  let needed = false;
  try { needed = await deps.needed(); } catch { needed = false; }
  if (!needed) return { kind: 'none' };
  const box = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = deps.backup().then(
      (r): CloseOutcome => (r.ok ? { kind: 'done', file: r.file ?? '' } : { kind: 'failed', error: String(r.error ?? 'error').slice(0, 200) }),
      (e: unknown): CloseOutcome => ({ kind: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
    );
    const skipped = deps.showBox(box.signal).then((): CloseOutcome => ({ kind: 'skipped' }), (): CloseOutcome => ({ kind: 'skipped' }));
    const late = new Promise<CloseOutcome>((resolve) => { timer = setTimeout(() => resolve({ kind: 'failed', error: 'timeout' }), deps.limitMs ?? CLOSE_BACKUP_LIMIT_MS); });
    return await Promise.race([work, skipped, late]);
  } finally {
    if (timer) clearTimeout(timer);
    box.abort();
  }
}

/** Notes a failed backup at closing for the next start (written whole: a temporary name, then renamed). */
export function noteCloseFailure(dir: string, error: string, at = new Date()): void {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, NOTE + '.tmp');
  writeFileSync(tmp, JSON.stringify({ at: at.toISOString(), error: error.slice(0, 200) }));
  renameSync(tmp, join(dir, NOTE));
}

/** At the start: the failure noted at the last closing (and the note is removed), or null. */
export function takeCloseFailure(dir: string): { at: string; error: string } | null {
  const file = join(dir, NOTE);
  let note: { at?: unknown; error?: unknown } | null = null;
  try { note = JSON.parse(readFileSync(file, 'utf8')) as { at?: unknown; error?: unknown }; } catch { return null; } finally { rmSync(file, { force: true }); }
  return typeof note?.at === 'string' ? { at: note.at, error: typeof note.error === 'string' ? note.error.slice(0, 200) : '' } : null;
}
