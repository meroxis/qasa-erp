import { useState } from 'react';
import { Modal } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { blocks, pickNotes, type Inline } from './release-notes.ts';
import { desktopUpdates, upd, useUpdates } from './updates.ts';

/** "Later" hides the bar for this version until the app is started again (the update still installs on quit). */
const HIDDEN_KEY = 'qasa.updateHidden';
function hiddenFor(): string | null {
  try { return sessionStorage.getItem(HIDDEN_KEY); } catch { return null; }
}

function Parts({ parts }: { parts: Inline[] }) {
  return <>{parts.map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}</>;
}

/** The release notes of a version, in the reader's language, as text (never HTML). */
export function ReleaseNotes({ text }: { text: string }) {
  const { lang } = useI18n();
  const list = blocks(pickNotes(text, lang));
  return (
    <div className="stack" style={{ gap: 6, maxHeight: '60vh', overflow: 'auto', lineHeight: 1.6 }}>
      {list.map((b, i) =>
        b.kind === 'heading' ? <h4 key={i} style={{ margin: '10px 0 2px', fontSize: 14 }}><Parts parts={b.parts} /></h4>
          : b.kind === 'item' ? <div key={i} style={{ display: 'flex', gap: 8 }}><span aria-hidden="true">•</span><span><Parts parts={b.parts} /></span></div>
            : <p key={i} style={{ margin: '4px 0' }}><Parts parts={b.parts} /></p>
      )}
    </div>
  );
}

/**
 * A calm bar at the top of the window while an update downloads and once it is ready: "Restart to update", "What's
 * new", "Later". It never restarts by itself, never takes the focus, and isn't printed. Windows app only.
 */
export function UpdateBanner() {
  const { lang } = useI18n();
  const state = useUpdates();
  const [hidden, setHidden] = useState<string | null>(hiddenFor);
  const [notesOpen, setNotesOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  if (!state || state.fromStore || !state.version) return null;
  if (state.status !== 'downloading' && state.status !== 'ready') return null;
  const key = `${state.version}:${state.status}`;
  if (hidden === key) return null;
  const hide = () => {
    try { sessionStorage.setItem(HIDDEN_KEY, key); } catch { /* not kept */ }
    setHidden(key);
  };
  const ready = state.status === 'ready';
  const install = () => {
    setInstalling(true);
    desktopUpdates()?.install().catch(() => setInstalling(false));
  };
  return (
    <div className="no-print" role="status" aria-live="polite"
      style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 14px', background: ready ? 'var(--info-bg)' : 'var(--layer)', borderBlockEnd: '1px solid var(--line)', fontSize: 'var(--fs-small)', color: 'var(--ink)' }}>
      <span style={{ fontWeight: 600 }}>
        {installing ? upd(lang, 'up_restarting') : ready ? upd(lang, 'up_ready', { v: state.version }) : upd(lang, 'up_available', { v: state.version })}
      </span>
      {state.channel === 'beta' && <span className="chip warn">{upd(lang, 'up_betaChip')}</span>}
      {!ready && state.percent !== null && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ inlineSize: 120, blockSize: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden', display: 'inline-block' }}>
            <span style={{ display: 'block', blockSize: '100%', inlineSize: `${state.percent}%`, background: 'var(--accent)' }} />
          </span>
          <span className="ltr">{state.percent}%</span>
        </span>
      )}
      <span style={{ flex: 1 }} />
      {state.notes && <button type="button" className="btn subtle" onClick={() => setNotesOpen(true)}>{upd(lang, 'up_whatsNew')}</button>}
      {ready && <button type="button" className="btn primary" disabled={installing} onClick={install}>{upd(lang, 'up_restart')}</button>}
      {!installing && (
        <button type="button" className="btn subtle" onClick={hide} title={ready ? upd(lang, 'up_laterHelp') : undefined}>
          {ready ? upd(lang, 'up_later') : upd(lang, 'up_dismiss')}
        </button>
      )}
      {notesOpen && (
        <Modal title={upd(lang, 'up_whatsNewTitle', { v: state.version })} onClose={() => setNotesOpen(false)}>
          {state.notes ? <ReleaseNotes text={state.notes} /> : <p>{upd(lang, 'up_noNotes')}</p>}
          <div className="actions" style={{ marginBlockStart: 12 }}>
            {ready && <button type="button" className="btn primary" disabled={installing} onClick={install}>{upd(lang, 'up_restart')}</button>}
            <button type="button" className="btn" onClick={() => setNotesOpen(false)}>{upd(lang, 'up_close')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
