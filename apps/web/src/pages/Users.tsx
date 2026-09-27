import { useState, type FormEvent } from 'react';
import { todayIso } from '@qasa/core';
import { api, ROLES, type Me, type Role, type UserView } from '../api.ts';
import { ErrorBox, Icon, Logo, Modal, useData, useLoad, useToast } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';

/** The page shown instead of the app while nobody is signed in. */
export function SignIn({ company, onSignedIn }: { company: string; onSignedIn(me: Me): void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.login(username.trim(), password));
    } catch (err) {
      setError(err);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin-page">
      <form className="card pad stack signin-card" onSubmit={submit}>
        <div className="row"><Logo size={40} /><div><div className="brand-name" style={{ color: 'var(--ink)' }}>{t('appName')}</div><div className="muted small">{t('tagline')}</div></div></div>
        <h2>{company ? t('signInTitle', { c: company }) : t('signIn')}</h2>
        <label className="field"><span>{t('username')}</span>
          <input className="input ltr" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={32} />
        </label>
        <label className="field"><span>{t('password')}</span>
          <input className="input ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={200} />
        </label>
        <ErrorBox error={error} />
        <button type="submit" className="btn primary" disabled={busy || !username.trim() || !password}>{t('signIn')}</button>
      </form>
    </div>
  );
}

/** Change your own password (the current one is asked for when there is one). */
export function PasswordModal({ onClose, needsCurrent }: { onClose(): void; needsCurrent: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(needsCurrent ? current : undefined, next);
      toast(t('passwordChanged'));
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('changePassword')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {needsCurrent && <label className="field"><span>{t('currentPassword')}</span><input className="input ltr" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>}
        <label className="field"><span>{t('newPassword')}</span><input className="input ltr" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
        <p className="muted small" style={{ margin: 0 }}>{t('passwordHelp')}</p>
        <ErrorBox error={error} />
        <div className="row">
          <button type="submit" className="btn primary" disabled={busy || !next}>{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </form>
    </Modal>
  );
}

interface Editing { id?: string; username: string; name: string; roles: Role[]; active: boolean; password: string }

/** المستخدمون: people, their roles and passwords, the sign-in switch and "separate duties". */
export function Users({ me, onMeChanged }: { me: Me; onMeChanged(me: Me | null): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { plan } = useData();
  const users = useLoad(() => api.users(), []);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [passwordFor, setPasswordFor] = useState<UserView | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [formError, setFormError] = useState<unknown>(null);

  const list = users.data ?? [];
  const self = list.find((u) => u.id === me.user?.id);
  const ownerFirst = list[0]?.id;
  const hasRoles = !!plan?.features.includes('roles');

  async function run(fn: () => Promise<unknown>, message: string, after?: () => void) {
    setBusy(true);
    setError(null);
    setFormError(null);
    try {
      await fn();
      toast(message);
      after?.();
      users.reload();
    } catch (e) {
      if (editing || passwordFor) setFormError(e); else setError(e);
    } finally {
      setBusy(false);
    }
  }

  function saveUser(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const body = { username: editing.username.trim(), name: editing.name.trim(), roles: editing.roles };
    void run(
      () => editing.id ? api.updateUser(editing.id, { ...body, active: editing.active }) : api.createUser({ ...body, ...(editing.password ? { password: editing.password } : {}) }),
      t('saved'), () => setEditing(null)
    );
  }

  function toggleRole(role: Role) {
    if (!editing) return;
    setEditing({ ...editing, roles: editing.roles.includes(role) ? editing.roles.filter((r) => r !== role) : [...editing.roles, role] });
  }

  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      {me.demo && <div className="alert info">{t('demoSignInNote')}</div>}

      <div className="card pad stack">
        <div className="row">
          <h2>{t('signInSetting')}</h2>
          <span className={'chip ' + (me.signInRequired ? 'ok' : '')}>{me.signInRequired ? t('switchedOn') : t('switchedOff')}</span>
        </div>
        <p style={{ margin: 0 }}>{me.signInRequired ? t('signInOnNote') : t('signInOffNote')}</p>
        {!me.demo && (
          <div className="row">
            {me.signInRequired ? (
              <button type="button" className="btn" disabled={busy} onClick={() => { if (window.confirm(t('signInOffConfirm'))) void run(async () => onMeChanged(await api.setSignIn(false)), t('saved')); }}>{t('signInTurnOff')}</button>
            ) : self?.hasPassword ? (
              <button type="button" className="btn primary" disabled={busy} onClick={() => void run(async () => { await api.setSignIn(true); onMeChanged(null); }, t('saved'))}>{t('signInTurnOn')}</button>
            ) : (
              <>
                <span className="muted">{t('signInNeedsPassword')}</span>
                {self && <button type="button" className="btn primary" onClick={() => { setPasswordFor(self); setNewPassword(''); }}>{t('setPassword')}</button>}
              </>
            )}
          </div>
        )}
        <ErrorBox error={error} />
      </div>

      <div className="card pad stack">
        <div className="row">
          <h2>{t('separateDutiesTitle')}</h2>
          {!hasRoles && <a className="chip plan-pro" href={href('plans')}>Pro</a>}
          <span className="spacer" />
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={me.separateDuties} disabled={busy || (!hasRoles && !me.separateDuties)}
              onChange={(e) => void run(async () => onMeChanged(await api.setSeparateDuties(e.target.checked)), t('saved'))} />
            {t('active')}
          </label>
        </div>
        <p className="muted" style={{ margin: 0 }}>{t('separateDutiesHelp')}</p>
      </div>

      <div className="card">
        <div className="row" style={{ padding: '14px 16px 8px' }}>
          <h2>{t('users')}</h2>
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={() => { setFormError(null); setEditing({ username: '', name: '', roles: ['preparer'], active: true, password: '' }); }}>
            <Icon name="plus" size={16} />{t('addUser')}
          </button>
        </div>
        {plan?.plan === 'free' && <p className="muted small" style={{ padding: '0 16px', margin: 0 }}>{t('usersPlanNote')}</p>}
        <table className="table">
          <thead>
            <tr><th>{t('name')}</th><th>{t('username')}</th><th>{t('roles')}</th><th>{t('lastSignIn')}</th><th>{t('colStatus')}</th><th /></tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.name}</strong>
                  {u.id === ownerFirst && <span className="chip" style={{ marginInlineStart: 6 }}>{t('owner')}</span>}
                  {u.id === me.user?.id && <span className="chip info" style={{ marginInlineStart: 6 }}>{t('you')}</span>}
                </td>
                <td className="ltr" style={{ textAlign: 'start' }}>{u.username}</td>
                <td>{u.roles.map((r) => <span key={r} className="chip" style={{ marginInlineEnd: 4 }}>{t(`role_${r}` as Key)}</span>)}</td>
                <td className="num">{u.lastLoginAt ? i18n.date(todayIso(new Date(u.lastLoginAt))) : '—'}</td>
                <td>
                  {u.active ? <span className="chip ok">{t('userActive')}</span> : <span className="chip bad">{t('inactive')}</span>}
                  {!u.hasPassword && <span className="chip warn" style={{ marginInlineStart: 4 }}>{t('noPassword')}</span>}
                </td>
                <td className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn small" onClick={() => { setFormError(null); setEditing({ id: u.id, username: u.username, name: u.name, roles: u.roles, active: u.active, password: '' }); }}>{t('actEdit')}</button>
                  {!me.demo && <button type="button" className="btn small" onClick={() => { setFormError(null); setPasswordFor(u); setNewPassword(''); }}>{u.hasPassword ? t('changePassword') : t('setPassword')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing.id ? t('editUser') : t('addUser')} onClose={() => setEditing(null)}>
          <form className="stack" onSubmit={saveUser}>
            <div className="grid-2">
              <label className="field"><span>{t('name')}</span><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={100} /></label>
              <label className="field"><span>{t('username')}</span><input className="input ltr" value={editing.username} autoComplete="off" onChange={(e) => setEditing({ ...editing, username: e.target.value })} maxLength={32} /></label>
            </div>
            <fieldset className="role-list">
              <legend>{t('roles')}</legend>
              {ROLES.map((r) => (
                <label key={r} className="role-option">
                  <input type="checkbox" checked={editing.roles.includes(r)} onChange={() => toggleRole(r)} />
                  <span><strong>{t(`role_${r}` as Key)}</strong><span className="muted small"> — {t(`roleHelp_${r}` as Key)}</span></span>
                </label>
              ))}
            </fieldset>
            {!editing.id && !me.demo && (
              <label className="field"><span>{t('password')}</span><input className="input ltr" type="password" autoComplete="new-password" value={editing.password} onChange={(e) => setEditing({ ...editing, password: e.target.value })} /></label>
            )}
            {editing.id && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />{t('userActive')}</label>}
            <ErrorBox error={formError} />
            <div className="row">
              <button type="submit" className="btn primary" disabled={busy}>{t('save')}</button>
              <button type="button" className="btn" onClick={() => setEditing(null)}>{t('cancel')}</button>
            </div>
          </form>
        </Modal>
      )}

      {passwordFor && (
        <Modal title={`${passwordFor.hasPassword ? t('changePassword') : t('setPassword')} — ${passwordFor.name}`} onClose={() => setPasswordFor(null)}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(() => api.setUserPassword(passwordFor.id, newPassword), t('passwordChanged'), () => setPasswordFor(null)); }}>
            <label className="field"><span>{t('newPassword')}</span><input className="input ltr" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label>
            <p className="muted small" style={{ margin: 0 }}>{t('passwordHelp')}</p>
            <ErrorBox error={formError} />
            <div className="row">
              <button type="submit" className="btn primary" disabled={busy || !newPassword}>{t('save')}</button>
              <button type="button" className="btn" onClick={() => setPasswordFor(null)}>{t('cancel')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
