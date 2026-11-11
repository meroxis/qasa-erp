import { useState } from 'react';
import { Icon, Modal } from '../components.tsx';
import { isKey, useI18n } from '../i18n.ts';

/**
 * Settings → Start over with empty books (1.1), for admins in the Windows app on the PC that keeps the books. It asks
 * the Windows app itself (window.qasaDesktop.startOver), never the server over HTTP: a backup is made first (nothing
 * happens when it fails), the old company file is kept aside in the data folder, and the app restarts empty.
 */
type StartOverCall = (username: string, password: string, confirmation: string) => Promise<{ ok: boolean; error?: string; retryAfterSeconds?: number }>;

export function startOverCall(): StartOverCall | null {
  const desktop = (window as unknown as { qasaDesktop?: { startOver?: unknown } }).qasaDesktop;
  return typeof desktop?.startOver === 'function' ? (desktop.startOver as StartOverCall) : null;
}

export function StartOverCard({ call = startOverCall() }: { call?: StartOverCall | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!call) return null;
  return (
    <section className="card pad stack" aria-labelledby="start-over-title" style={{ borderInlineStart: '4px solid var(--bad, #A4271A)' }}>
      <h2 id="start-over-title">{t('so_title')}</h2>
      <p className="muted" style={{ margin: 0 }}>{t('so_help')}</p>
      <div className="row"><button type="button" className="btn danger" onClick={() => setOpen(true)}><Icon name="undo" size={16} />{t('so_button')}</button></div>
      {open && <StartOverDialog call={call} onClose={() => setOpen(false)} />}
    </section>
  );
}

export function StartOverDialog({ call, onClose }: { call: StartOverCall; onClose(): void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await call(username.trim(), password, confirmation);
      if (r.ok) { setDone(true); return; }
      const key = `so_err_${r.error ?? 'error'}`;
      setError(isKey(key) ? t(key, { s: r.retryAfterSeconds ?? '' }) : t('so_err_error'));
    } catch {
      setError(t('so_err_error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('so_title')} onClose={busy || done ? () => {} : onClose}>
      <div className="stack">
        {done ? <div className="alert info" role="status">{t('so_done')}</div> : (
          <>
            <div className="alert bad">{t('so_warning')}</div>
            <label className="field"><span>{t('so_username')}</span><input className="input ltr" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
            <label className="field"><span>{t('so_password')}</span><input className="input ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <label className="field"><span>{t('so_confirm')}</span><input className="input" dir="auto" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>
            {error && <div className="alert bad" role="alert">{error}</div>}
            <div className="row">
              <button type="button" className="btn danger" disabled={busy || !password || !confirmation.trim()} onClick={() => void go()}>{busy ? t('so_working') : t('so_button')}</button>
              <button type="button" className="btn" disabled={busy} onClick={onClose}>{t('cancel')}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
