import { useState } from 'react';
import { Icon, Modal } from '../components.tsx';
import { ChoiceTiles } from '../ChoiceTiles.tsx';
import { useI18n } from '../i18n.ts';
import { ReleaseNotes } from './UpdateBanner.tsx';
import { desktopUpdates, upd, useUpdates, type UpdateState } from './updates.ts';

/**
 * Settings → Updates (Windows app only): the version, checking now with the last check's time, and joining or leaving
 * the beta. A Microsoft Store copy says the Store updates it.
 */
export function UpdateSettings() {
  const { lang, dateTime } = useI18n();
  const live = useUpdates();
  const [local, setLocal] = useState<UpdateState | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const api = desktopUpdates();
  const state = live ?? local;
  if (!api || !state) return null;

  const when = state.lastChecked
    ? upd(lang, 'up_lastChecked', { d: dateTime(state.lastChecked) })
    : upd(lang, 'up_never');
  const status =
    state.development ? upd(lang, 'up_devBuild')
      : state.status === 'checking' ? upd(lang, 'up_checking')
        : state.status === 'none' ? upd(lang, 'up_upToDate')
          : state.status === 'error' ? upd(lang, 'up_failed')
            : state.status === 'downloading' ? upd(lang, 'up_downloading', { v: state.version ?? '', p: state.percent ?? 0 })
              : state.status === 'ready' ? upd(lang, 'up_ready', { v: state.version ?? '' })
                : '';
  const check = () => {
    setBusy(true);
    api.check().then((s) => { if (s) setLocal(s); }).catch(() => undefined).finally(() => setBusy(false));
  };
  const channel = (c: 'stable' | 'beta') => {
    setBusy(true);
    api.setChannel(c).then((s) => { if (s) setLocal(s); setLeft(c === 'stable'); }).catch(() => undefined).finally(() => { setBusy(false); setAsking(false); });
  };
  const beta = state.channel === 'beta';

  return (
    <section className="stack" aria-label={upd(lang, 'up_title')}>
      <div className="section-head">
        <p>{state.fromStore ? upd(lang, 'up_storeHelp') : upd(lang, 'up_help')}</p>
      </div>
      <div className="settings-group">
        <div className="setting">
          <Icon name="download" size={20} className="setting-icon" />
          <div className="setting-text">
            <strong>{upd(lang, 'up_version')}: <span className="ltr">{state.current}</span>{beta && <> <span className="chip warn">{upd(lang, 'up_betaChip')}</span></>}</strong>
            {state.fromStore ? <span>{upd(lang, 'up_store')}</span> : <span role="status">{status ? `${status} · ` : ''}{when}</span>}
          </div>
          <div className="setting-ctl" style={{ display: 'flex', gap: 8 }}>
            {state.fromStore
              ? <button type="button" className="btn" onClick={() => api.openStore()}>{upd(lang, 'up_openStore')}</button>
              : <>
                {state.status === 'ready' && state.notes && <button type="button" className="btn subtle" onClick={() => setNotesOpen(true)}>{upd(lang, 'up_whatsNew')}</button>}
                {state.status === 'ready'
                  ? <button type="button" className="btn primary" onClick={() => { setBusy(true); void api.install(); }} disabled={busy}>{upd(lang, 'up_restart')}</button>
                  : <button type="button" className="btn" onClick={check} disabled={busy || state.development || state.status === 'checking' || state.status === 'downloading'}>{upd(lang, 'up_checkNow')}</button>}
              </>}
          </div>
        </div>
        {!state.fromStore && !state.development && (
          <div className="setting">
            <Icon name="branch" size={20} className="setting-icon" />
            <div className="setting-text">
              <strong>{upd(lang, 'up_beta')}</strong>
              <span>{upd(lang, 'up_betaHelp')}</span>
              {left && <span role="status">{upd(lang, 'up_betaLeft')}</span>}
            </div>
            <div className="setting-ctl">
              {/* joining asks first (the warnings in the dialog below); leaving is at once */}
              <ChoiceTiles
                label={upd(lang, 'up_beta')} value={beta ? 'beta' : 'stable'} disabled={busy} busy={busy}
                onChange={(v) => { if (v === 'beta') setAsking(true); else channel('stable'); }}
                options={[{ value: 'beta', label: upd(lang, 'up_betaOn'), icon: 'zap' }, { value: 'stable', label: upd(lang, 'up_betaOff'), icon: 'x' }]}
              />
            </div>
          </div>
        )}
      </div>
      {asking && (
        <Modal title={upd(lang, 'up_betaJoinTitle')} onClose={() => setAsking(false)}>
          <ul style={{ margin: '0 0 12px', paddingInlineStart: 18, lineHeight: 1.7 }}>
            <li>{upd(lang, 'up_betaWarn1')}</li>
            <li><strong>{upd(lang, 'up_betaWarn2')}</strong></li>
            <li>{upd(lang, 'up_betaWarn3')}</li>
          </ul>
          <div className="actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => channel('beta')}>{upd(lang, 'up_betaJoin')}</button>
            <button type="button" className="btn" onClick={() => setAsking(false)}>{upd(lang, 'up_cancel')}</button>
          </div>
        </Modal>
      )}
      {notesOpen && state.notes && (
        <Modal title={upd(lang, 'up_whatsNewTitle', { v: state.version ?? '' })} onClose={() => setNotesOpen(false)}>
          <ReleaseNotes text={state.notes} />
          <div className="actions" style={{ marginBlockStart: 12 }}>
            <button type="button" className="btn" onClick={() => setNotesOpen(false)}>{upd(lang, 'up_close')}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
