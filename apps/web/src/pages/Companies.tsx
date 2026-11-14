import { useState } from 'react';
import { ErrorBox, Icon, Modal, useLoad, usePageNav, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';
import { canSwitchCompanies, companiesApi, type CompanyView } from '../industry/companies-api.ts';

/**
 * System → Companies (Windows app): every company on this PC, each in its own file. Make one (Free 1, Pro and the free
 * first month 3, Business unlimited), rename it in the list, open it (the app closes this company and opens that one;
 * its own sign-in asks again), or back it up to a folder.
 */
export function Companies() {
  const i18n = useI18n();
  const { t } = i18n;
  usePageNav({ key: 'co_title', group: 'gSystem' });
  const available = canSwitchCompanies();
  const data = useLoad(() => (available ? companiesApi.list() : Promise.resolve(null)), [available]);
  const toast = useToast();
  const [editing, setEditing] = useState<CompanyView | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  // a browser has no list of companies: it says where they are managed
  if (!available) return <div className="card pad muted stack"><span>{t('co_help')}</span><span>{t('co_browser')}</span></div>;
  const view = data.data;

  async function open(c: CompanyView) {
    if (!window.confirm(t('co_openConfirm', { name: c.name }))) return;
    setBusy(c.id);
    setError(null);
    try {
      await companiesApi.open(c.id);
      // the Windows app now closes this company and reloads the window on the other one
      setOpening(c.name);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  async function backup(c: CompanyView) {
    setBusy(c.id);
    setError(null);
    try {
      const r = await companiesApi.backup(c.id);
      if (r.saved) toast(t('co_backedUp', { file: r.saved.split(/[\\/]/).pop() ?? r.saved }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  if (opening) {
    return (
      <div className="card pad stack" role="status" style={{ maxWidth: 640 }}>
        <strong>{t('co_opening', { name: opening })}</strong>
      </div>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <p className="muted" style={{ margin: 0 }}>{t('co_help')}</p>
      <ErrorBox error={data.error ?? error} />
      {view && (
        <div className="row">
          <button type="button" className="btn primary" disabled={!view.canAdd} onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('co_new')}</button>
          <span className="small muted">
            {view.limit === null ? t('co_unlimited') : t('co_limit', { n: i18n.int(view.limit) })}
            {!view.canAdd && view.limit !== null && <> · <a href={href('plans')}>{t('co_upgrade')}</a></>}
          </span>
        </div>
      )}
      <div className="grid-2">
        {view?.list.map((c) => (
          <div key={c.id} className="card pad stack">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <strong className="bidi">{c.name}</strong>
                <div className="small muted">{t('co_since', { d: i18n.date(c.createdAt.slice(0, 10)) })}</div>
              </div>
              {c.current && <span className="chip ok">{t('co_current')}</span>}
            </div>
            <div className="row">
              {!c.current && <button type="button" className="btn primary" disabled={!!busy} onClick={() => void open(c)}><Icon name="swap" size={16} />{t('co_open')}</button>}
              <button type="button" className="btn" disabled={!!busy} onClick={() => void backup(c)}><Icon name="download" size={16} />{t('co_backup')}</button>
              <button type="button" className="btn subtle" disabled={!!busy} onClick={() => setEditing(c)}><Icon name="edit" size={16} />{t('co_rename')}</button>
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <CompanyEditor
          company={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(made) => {
            setEditing(null);
            data.reload();
            if (made) void open(made);
          }}
        />
      )}
    </div>
  );
}

function CompanyEditor({ company, onClose, onSaved }: { company: CompanyView | null; onClose(): void; onSaved(openNow: CompanyView | null): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState(company?.name ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function save(openAfter: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (company) {
        await companiesApi.rename(company.id, name);
        toast(t('co_saved'));
        onSaved(null);
      } else {
        const after = await companiesApi.create(name);
        toast(t('co_created'));
        // a new company is added at the end of the list
        onSaved(openAfter ? after.list[after.list.length - 1] ?? null : null);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={company ? company.name : t('co_new')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(!company); }}>
        <label className="field">
          <span>{t('co_name')}</span>
          <input className="input" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        {!company && <p className="small muted" style={{ margin: 0 }}>{t('co_nameHelp')}</p>}
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          {!company && <button type="button" className="btn" disabled={busy || !name.trim()} onClick={() => void save(false)}>{t('co_create')}</button>}
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>{company ? t('save') : t('co_createOpen')}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Settings: a row that leads to Companies (Windows app, admins only). */
export function CompaniesSetting() {
  const { t } = useI18n();
  if (!canSwitchCompanies()) return null;
  return (
    <div className="settings-group">
      <div className="setting">
        <Icon name="building" size={20} className="setting-icon" />
        <div className="setting-text"><strong>{t('co_title')}</strong><span>{t('co_settingsHelp')}</span></div>
        <div className="setting-ctl"><a className="btn" href={href('companies')}>{t('co_manage')}</a></div>
      </div>
    </div>
  );
}
