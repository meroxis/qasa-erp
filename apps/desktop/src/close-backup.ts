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

// ——— 1.4: "Back up before closing?" ———
// When the automatic backup at closing above is not on, closing asks instead: the books changed and no backup was
// made since (nor today). [Back up and close] [Close without backup] [Cancel], with "Don't ask again" (Settings →
// Backups turns it back on). A backup that fails never keeps the app open: the error is shown and the person closes.
// Only on the PC that keeps the books, and never while Windows shuts down.

/** Should closing ask? Not when nothing ever changed, when a backup was made since the last change, or one was made today. */
export function closeAskNeeded(input: { lastChangeAt: string | null; lastBackupAt: string | null; now?: Date }): boolean {
  const changed = input.lastChangeAt ? Date.parse(input.lastChangeAt) : NaN;
  if (!Number.isFinite(changed)) return false;
  const backup = input.lastBackupAt ? Date.parse(input.lastBackupAt) : NaN;
  if (!Number.isFinite(backup)) return true;
  if (backup >= changed) return false;
  const now = input.now ?? new Date();
  // "today" is the day on this PC's clock
  return new Date(backup).toDateString() !== now.toDateString();
}

const ASK_FILE = 'close-ask.json';

/** Settings → Backups → "Ask to back up when I close": on unless the person turned it off. */
export function readCloseAsk(dir: string): boolean {
  try {
    return (JSON.parse(readFileSync(join(dir, ASK_FILE), 'utf8')) as { ask?: unknown }).ask !== false;
  } catch {
    return true;
  }
}

export function saveCloseAsk(dir: string, ask: boolean, at = new Date()): void {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, ASK_FILE + '.tmp');
  writeFileSync(tmp, JSON.stringify({ ask, at: at.toISOString() }));
  renameSync(tmp, join(dir, ASK_FILE));
}

export type AskChoice = 'backup' | 'close' | 'cancel';

export interface CloseFlowDeps {
  /** this PC keeps the books, and Windows is not shutting down */
  allowed: boolean;
  /** the automatic backup at closing (Pro, Settings → Backups): when it is due it is made without a question */
  autoNeeded(): Promise<boolean>;
  autoBackup(): Promise<{ ok: boolean; file?: string; error?: string }>;
  /** "Ask to back up when I close" is on */
  askOn(): boolean;
  /** the books changed and no backup was made since, nor today */
  askNeeded(): Promise<boolean>;
  /** the question; `never` is its "Don't ask again" box */
  prompt(): Promise<{ choice: AskChoice; never: boolean }>;
  askOff(): void;
  /** a backup now (the normal one) */
  backupNow(): Promise<{ ok: boolean; file?: string; error?: string }>;
  showBox(signal: AbortSignal): Promise<void>;
  /** says the backup failed; the person closes anyway or goes back to the app */
  failed(error: string): Promise<'close' | 'stay'>;
  limitMs?: number;
}

export interface CloseFlowResult {
  /** false: the person cancelled, and the app stays open */
  proceed: boolean;
  outcome: CloseOutcome;
  /** the person was asked (so a failure was already shown, and needs no note for the next start) */
  asked: boolean;
}

export async function closeFlow(deps: CloseFlowDeps): Promise<CloseFlowResult> {
  const none: CloseFlowResult = { proceed: true, outcome: { kind: 'none' }, asked: false };
  if (!deps.allowed) return none;
  const auto = await backupOnClose({ allowed: true, needed: deps.autoNeeded, backup: deps.autoBackup, showBox: deps.showBox, ...(deps.limitMs !== undefined ? { limitMs: deps.limitMs } : {}) });
  if (auto.kind !== 'none') return { proceed: true, outcome: auto, asked: false };
  let ask = false;
  try { ask = deps.askOn() && await deps.askNeeded(); } catch { ask = false; }
  if (!ask) return none;
  let answer: { choice: AskChoice; never: boolean };
  // a question that can't be shown never keeps the app open
  try { answer = await deps.prompt(); } catch { return none; }
  if (answer.choice === 'cancel') return { proceed: false, outcome: { kind: 'none' }, asked: true };
  if (answer.never) { try { deps.askOff(); } catch { /* asked again next time */ } }
  if (answer.choice !== 'backup') return { proceed: true, outcome: { kind: 'none' }, asked: true };
  const made = await backupOnClose({ allowed: true, needed: async () => true, backup: deps.backupNow, showBox: deps.showBox, ...(deps.limitMs !== undefined ? { limitMs: deps.limitMs } : {}) });
  if (made.kind !== 'failed') return { proceed: true, outcome: made, asked: true };
  let next: 'close' | 'stay' = 'close';
  try { next = await deps.failed(made.error); } catch { next = 'close'; }
  return { proceed: next !== 'stay', outcome: made, asked: true };
}
