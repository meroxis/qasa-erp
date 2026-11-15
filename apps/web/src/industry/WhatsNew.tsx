import { Fragment, useEffect, useState } from 'react';
import { APP_VERSION, type Lang } from '@qasa/core';
import { Modal } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { pickNotes } from './release-notes.ts';
import { NOTES_BOX, NotesBlocks } from './UpdateBanner.tsx';
import { upd } from './updates.ts';

/**
 * "What's new in <version>" (1.1): once, the first time the Windows app opens after an update (never after a fresh
 * install: the main process knows which, whats-new.ts), and again from Settings → About. The notes are the release
 * notes bundled with this build (apps/desktop/release-notes), so they show offline, in the reader's language, as text
 * only (release-notes.ts), never as HTML. After an update that skipped versions (1.4.0 → 1.4.2, as a Microsoft Store
 * copy often does), the notes of every version since the one before show too, newest first, without repeating a
 * section a newer version already showed.
 */

const BUNDLED = import.meta.glob('../../../desktop/release-notes/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** This build's notes for a version, or null. */
export function bundledNotes(version: string, files: Record<string, string> = BUNDLED): string | null {
  const hit = Object.entries(files).find(([path]) => path.endsWith(`/${version}.md`));
  return hit ? hit[1] : null;
}

/** A version as the app names it (whats-new.ts): 1.4.2, or a beta such as 1.5.0-beta.1. */
const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:-([0-9A-Za-z.]{1,32}))?$/;
/** The version a notes file is for, from its name (…/release-notes/1.4.2.md). */
const NOTES_FILE = /\/(\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,32})?)\.md$/;

/** Orders two versions as releases do: 1.4.9 before 1.4.10, and a beta before its release (1.5.0-beta.2 before 1.5.0). */
export function compareVersions(a: string, b: string): number {
  const x = VERSION.exec(a);
  const y = VERSION.exec(b);
  if (!x || !y) return 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return d;
  }
  const p = x[4]?.split('.') ?? [];
  const q = y[4]?.split('.') ?? [];
  // a release comes after its betas
  if (!p.length || !q.length) return q.length - p.length;
  for (let i = 0; i < Math.min(p.length, q.length); i++) {
    const s = p[i]!;
    const t = q[i]!;
    if (s === t) continue;
    const sNum = /^\d+$/.test(s);
    const tNum = /^\d+$/.test(t);
    if (sNum && tNum) {
      const d = Number(s) - Number(t);
      if (d !== 0) return d;
      continue;
    }
    if (sNum !== tNum) return sNum ? -1 : 1;
    return s < t ? -1 : 1;
  }
  return p.length - q.length;
}

/**
 * The versions whose notes show after an update from `previous` to `current`, newest first: every version this build
 * has notes for after `previous` and up to `current`, so a PC that skipped versions also reads what came in between
 * (1.4.0 → 1.4.2 shows 1.4.2, then 1.4.1). A beta's notes only on a beta: a release's notes already cover its betas
 * (docs/releasing.md). When the version before is not known ('earlier': an update from before 1.1, or a record that
 * could not be read) or is not older than this one, only this version's notes.
 */
export function versionsSince(previous: string, current: string, files: Record<string, string> = BUNDLED): string[] {
  const own = bundledNotes(current, files) !== null ? [current] : [];
  if (!VERSION.test(previous) || !VERSION.test(current) || compareVersions(previous, current) >= 0) return own;
  const beta = current.includes('-');
  const found = new Set<string>();
  for (const path of Object.keys(files)) {
    const v = NOTES_FILE.exec(path)?.[1];
    if (!v || (!beta && v.includes('-'))) continue;
    if (compareVersions(v, previous) > 0 && compareVersions(v, current) <= 0) found.add(v);
  }
  return [...found].sort((a, b) => compareVersions(b, a));
}

/** Notes in one language cut into sections: what comes before the first heading, then each heading with what follows. */
function sections(notes: string): string[] {
  const out: string[][] = [[]];
  for (const line of notes.split('\n')) {
    if (/^#{1,6}\s/.test(line.trim())) out.push([]);
    out[out.length - 1]!.push(line);
  }
  return out.map((lines) => lines.join('\n').trim()).filter(Boolean);
}

/** A section's words as two versions are compared: its lines trimmed, blank lines left out. */
const wording = (section: string) => section.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

/**
 * The notes of `versions` (newest first) as a reader of `lang` sees them: each version's notes in that language, less
 * any section a newer version in the list already showed word for word (every release since 1.0 repeats the one for
 * 0.1.8 licences), and no version that has nothing of its own left. A version alone keeps all its notes.
 */
export function notesToShow(versions: readonly string[], lang: Lang, files: Record<string, string> = BUNDLED): { v: string; notes: string }[] {
  const seen = new Set<string>();
  const out: { v: string; notes: string }[] = [];
  for (const v of versions) {
    const text = bundledNotes(v, files);
    if (text === null) continue;
    const own = sections(pickNotes(text, lang));
    const kept = own.filter((s) => !seen.has(wording(s)));
    for (const s of own) seen.add(wording(s));
    if (kept.length) out.push({ v, notes: kept.join('\n\n') });
  }
  return out;
}

interface DesktopWhatsNew { whatsNew?: () => Promise<{ current: string; previous: string | null } | null>; whatsNewSeen?: () => Promise<boolean> }
const desktop = (): DesktopWhatsNew | undefined => (window as unknown as { qasaDesktop?: DesktopWhatsNew }).qasaDesktop;

/** The notes of `versions` (newest first; this version alone when not given), under the title of this version. */
export function WhatsNewDialog({ version, versions, onClose }: { version: string; versions?: readonly string[]; onClose(): void }) {
  const { lang } = useI18n();
  const shown = notesToShow(versions ?? [version], lang);
  // one version's notes as before; after an update that skipped versions, each under its own heading, in one box
  const only = shown.length === 1 && shown[0]!.v === version;
  return (
    <Modal title={upd(lang, 'up_whatsNewTitle', { v: version })} onClose={onClose}>
      <div className="stack">
        {!shown.length ? <p>{upd(lang, 'up_noNotes')}</p> : (
          <div className="stack" style={NOTES_BOX}>
            {shown.map(({ v, notes }, i) => (
              <Fragment key={v}>
                {!only && (
                  <h4 style={{ margin: i ? '12px 0 0' : 0, paddingBlockStart: i ? 12 : 0, borderBlockStart: i ? '1px solid var(--line)' : 'none', fontSize: 'var(--fs-h2)' }}>
                    {upd(lang, 'up_notesOf', { v })}
                  </h4>
                )}
                <NotesBlocks notes={notes} />
              </Fragment>
            ))}
          </div>
        )}
        <div className="row"><button type="button" className="btn primary" onClick={onClose}>{upd(lang, 'up_gotIt')}</button></div>
      </div>
    </Modal>
  );
}

/** Asks the Windows app once at the start; shows the dialog when this is the first start after an update. */
export function WhatsNewAfterUpdate() {
  const [versions, setVersions] = useState<string[] | null>(null);
  useEffect(() => {
    const d = desktop();
    if (!d?.whatsNew) return;
    let live = true;
    d.whatsNew().then((w) => {
      if (!live || !w?.previous || w.current !== APP_VERSION) return;
      const since = versionsSince(w.previous, w.current);
      // no notes in this build for any of them: nothing to show, and nothing to ask again
      if (!since.length) { void d.whatsNewSeen?.(); return; }
      setVersions(since);
    }, () => {});
    return () => { live = false; };
  }, []);
  if (!versions) return null;
  return <WhatsNewDialog version={APP_VERSION} versions={versions} onClose={() => { setVersions(null); void desktop()?.whatsNewSeen?.(); }} />;
}

/** Settings → About: the notes of this version, again. */
export function WhatsNewButton() {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  if (!bundledNotes(APP_VERSION)) return null;
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>{upd(lang, 'up_whatsNewTitle', { v: APP_VERSION })}</button>
      {open && <WhatsNewDialog version={APP_VERSION} onClose={() => setOpen(false)} />}
    </>
  );
}
