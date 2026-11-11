import { useEffect, useState } from 'react';
import { APP_VERSION } from '@qasa/core';
import { Modal } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { ReleaseNotes } from './UpdateBanner.tsx';
import { upd } from './updates.ts';

/**
 * "What's new in <version>" (1.1): once, the first time the Windows app opens after an update (never after a fresh
 * install: the main process knows which, whats-new.ts), and again from Settings → About. The notes are the release
 * notes bundled with this build (apps/desktop/release-notes), so they show offline, in the reader's language, as text
 * only (release-notes.ts), never as HTML.
 */

const BUNDLED = import.meta.glob('../../../desktop/release-notes/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** This build's notes for a version, or null. */
export function bundledNotes(version: string, files: Record<string, string> = BUNDLED): string | null {
  const hit = Object.entries(files).find(([path]) => path.endsWith(`/${version}.md`));
  return hit ? hit[1] : null;
}

interface DesktopWhatsNew { whatsNew?: () => Promise<{ current: string; previous: string | null } | null>; whatsNewSeen?: () => Promise<boolean> }
const desktop = (): DesktopWhatsNew | undefined => (window as unknown as { qasaDesktop?: DesktopWhatsNew }).qasaDesktop;

export function WhatsNewDialog({ version, onClose }: { version: string; onClose(): void }) {
  const { lang } = useI18n();
  const notes = bundledNotes(version);
  return (
    <Modal title={upd(lang, 'up_whatsNewTitle', { v: version })} onClose={onClose}>
      <div className="stack">
        {notes ? <ReleaseNotes text={notes} /> : <p>{upd(lang, 'up_noNotes')}</p>}
        <div className="row"><button type="button" className="btn primary" onClick={onClose}>{upd(lang, 'up_gotIt')}</button></div>
      </div>
    </Modal>
  );
}

/** Asks the Windows app once at the start; shows the dialog when this is the first start after an update. */
export function WhatsNewAfterUpdate() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    const d = desktop();
    if (!d?.whatsNew) return;
    let live = true;
    d.whatsNew().then((w) => {
      if (!live || !w?.previous || w.current !== APP_VERSION) return;
      // a version this build has no notes for: nothing to show, and nothing to ask again
      if (!bundledNotes(w.current)) { void d.whatsNewSeen?.(); return; }
      setVersion(w.current);
    }, () => {});
    return () => { live = false; };
  }, []);
  if (!version) return null;
  return <WhatsNewDialog version={version} onClose={() => { setVersion(null); void desktop()?.whatsNewSeen?.(); }} />;
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
