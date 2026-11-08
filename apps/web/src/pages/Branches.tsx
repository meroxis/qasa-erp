import { useState } from 'react';
import { api, type AccountView, type UserView, type WarehouseView } from '../api.ts';
import { EmptyState, ErrorBox, Icon, Modal, useLoad, usePageNav, useToast } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { branchesApi, type BranchView } from '../industry/branches-api.ts';

/**
 * System → Branches (Business): make branches, give each its warehouses and safes, and limit users to branches.
 * On another plan everything set up before stays visible (and in force) but can't be changed, except lifting a limit.
 */
export function Branches() {
  const i18n = useI18n();
  const { t } = i18n;
  usePageNav({ key: 'bn_title', group: 'gSystem' });
  const data = useLoad(() => branchesApi.list(), []);
  const warehouses = useLoad(() => api.warehouses(), []);
  const accounts = useLoad(() => api.accounts(), []);
  const users = useLoad(() => api.users(), []);
  const [editing, setEditing] = useState<BranchView | 'new' | null>(null);
  const [picking, setPicking] = useState<{ branch: BranchView; what: 'warehouses' | 'accounts' } | null>(null);
  const available = !!data.data?.available;
  const branches = data.data?.branches ?? [];
  const safes = (accounts.data ?? []).filter((a) => a.postable && a.code.startsWith('18'));
  const reload = () => data.reload();

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <p className="muted" style={{ margin: 0 }}>{t('bn_help')}</p>
      {!available && data.data && <div className="alert">{t('bn_needsBusiness')}</div>}
      <ErrorBox error={data.error} />
      <div className="row">
        <button type="button" className="btn primary" disabled={!available} onClick={() => setEditing('new')}><Icon name="plus" size={16} />{t('bn_new')}</button>
      </div>
      {branches.length === 0 && data.data && <div className="card"><EmptyState icon="branch" title={t('es_branches')} text={t('es_branchesText')} /></div>}
      <div className="grid-2">
        {branches.map((b) => (
          <div key={b.id} className="card pad stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{b.name}</strong> <span className="muted ltr">{b.code}</span>
                {b.city && <div className="small muted">{b.city}</div>}
              </div>
              <div className="row">
                <span className={'chip ' + (b.active ? 'ok' : 'warn')}>{t(b.active ? 'bn_active' : 'bn_inactive')}</span>
                <button type="button" className="btn subtle" disabled={!available} onClick={() => setEditing(b)}><Icon name="edit" size={16} />{t('bn_edit')}</button>
              </div>
            </div>
            <Assigned
              label={t('bn_warehouses')} disabled={!available} onPick={() => setPicking({ branch: b, what: 'warehouses' })}
              items={b.warehouses.map((w) => { const full = warehouses.data?.find((x) => x.id === w.id); return full ? `${full.code} — ${nameOf(full)}` : w.code; })}
            />
            <Assigned
              label={t('bn_safes')} disabled={!available} onPick={() => setPicking({ branch: b, what: 'accounts' })}
              items={b.accounts.map((code) => { const a = safes.find((x) => x.code === code); return a ? `${code} — ${accountName(a)}` : code; })}
            />
            <div className="small">
              <div className="label">{t('bn_users')}</div>
              {b.users.length ? b.users.map((u) => u.name || u.username).join('، ') : <span className="muted">{t('bn_none')}</span>}
            </div>
          </div>
        ))}
      </div>
      {branches.length > 0 && <p className="small muted">{t('bn_unassignedNote')}</p>}
      {branches.length > 0 && users.data && (
        <UserLimits users={users.data} branches={branches} available={available} onChanged={reload} />
      )}

      {editing && <BranchEditor branch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {picking && (
        <Picker
          title={`${picking.branch.name} — ${t(picking.what === 'warehouses' ? 'bn_warehouses' : 'bn_safes')}`}
          options={picking.what === 'warehouses'
            ? (warehouses.data ?? []).map((w) => ({ id: w.id, label: `${w.code} — ${nameOf(w)}`, other: branches.some((b) => b.id !== picking.branch.id && b.warehouses.some((x) => x.id === w.id)) }))
            : safes.map((a) => ({ id: a.code, label: `${a.code} — ${accountName(a)}`, other: branches.some((b) => b.id !== picking.branch.id && b.accounts.includes(a.code)) }))}
          chosen={picking.what === 'warehouses' ? picking.branch.warehouses.map((w) => w.id) : picking.branch.accounts}
          onClose={() => setPicking(null)}
          onSave={async (ids) => {
            if (picking.what === 'warehouses') await branchesApi.setWarehouses(picking.branch.id, ids);
            else await branchesApi.setAccounts(picking.branch.id, ids);
            setPicking(null);
            reload();
          }}
        />
      )}
    </div>
  );

  function nameOf(w: WarehouseView): string {
    return i18n.name(w.name);
  }
  function accountName(a: AccountView): string {
    return i18n.name(a.name);
  }
}

function Assigned({ label, items, onPick, disabled }: { label: string; items: string[]; onPick(): void; disabled: boolean }) {
  const { t } = useI18n();
  return (
    <div className="small">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label">{label}</span>
        <button type="button" className="btn subtle" disabled={disabled} onClick={onPick}>{t('bn_assign')}</button>
      </div>
      {items.length ? <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>{items.map((x) => <li key={x}>{x}</li>)}</ul> : <span className="muted">{t('bn_none')}</span>}
    </div>
  );
}

function BranchEditor({ branch, onClose, onSaved }: { branch: BranchView | null; onClose(): void; onSaved(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [code, setCode] = useState(branch?.code ?? '');
  const [name, setName] = useState(branch?.name ?? '');
  const [city, setCity] = useState(branch?.city ?? '');
  const [active, setActive] = useState(branch?.active ?? true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const input = { code, name, city, active };
      if (branch) await branchesApi.update(branch.id, input);
      else await branchesApi.create(input);
      toast(t('saved'));
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={branch ? branch.name : t('bn_new')} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <label className="field"><span>{t('bn_code')}</span><input className="input ltr" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} /></label>
          <label className="field"><span>{t('bn_name')}</span><input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>{t('bn_city')}</span><input className="input" value={city} maxLength={120} onChange={(e) => setCity(e.target.value)} /></label>
          <label className="field row"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span>{t('bn_active')}</span></label>
        </div>
        <ErrorBox error={error} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={busy || !code.trim() || !name.trim()} onClick={() => void save()}>{t('save')}</button>
        </div>
      </div>
    </Modal>
  );
}

function Picker({ title, options, chosen, onClose, onSave }: {
  title: string; options: { id: string; label: string; other: boolean }[]; chosen: string[]; onClose(): void; onSave(ids: string[]): Promise<void>;
}) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string[]>(chosen);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        {options.map((o) => (
          <label key={o.id} className="row" style={{ opacity: o.other ? 0.55 : 1 }}>
            <input type="checkbox" disabled={o.other} checked={picked.includes(o.id)}
              onChange={(e) => setPicked((p) => (e.target.checked ? [...p, o.id] : p.filter((x) => x !== o.id)))} />
            <span>{o.label}</span>{o.other && <span className="small muted">({t('bn_inOther')})</span>}
          </label>
        ))}
        <ErrorBox error={error} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={async () => {
            setBusy(true);
            setError(null);
            try { await onSave(picked); } catch (e) { setError(e); } finally { setBusy(false); }
          }}>{t('save')}</button>
        </div>
      </div>
    </Modal>
  );
}

function UserLimits({ users, branches, available, onChanged }: { users: UserView[]; branches: BranchView[]; available: boolean; onChanged(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [error, setError] = useState<unknown>(null);
  const limitsOf = (u: UserView) => branches.filter((b) => b.users.some((x) => x.id === u.id)).map((b) => b.id);
  async function toggle(u: UserView, branchId: string, on: boolean) {
    setError(null);
    const now = limitsOf(u);
    const next = on ? [...now, branchId] : now.filter((x) => x !== branchId);
    try {
      await branchesApi.setUserBranches(u.id, next);
      toast(t('saved'));
      onChanged();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <section className="card pad stack">
      <div>
        <h3 style={{ margin: 0 }}>{t('bn_userLimits')}</h3>
        <p className="small muted" style={{ margin: 0 }}>{t('bn_userLimitsHelp')}</p>
      </div>
      <ErrorBox error={error} />
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr><th>{t('bn_name')}</th>{branches.map((b) => <th key={b.id}>{b.name}</th>)}<th /></tr>
          </thead>
          <tbody>
            {users.filter((u) => u.active).map((u) => {
              const admin = u.roles.includes('admin');
              const mine = limitsOf(u);
              return (
                <tr key={u.id}>
                  <td>{u.name || u.username} <span className="muted ltr small">{u.username}</span></td>
                  {branches.map((b) => (
                    <td key={b.id}>
                      <input type="checkbox" aria-label={`${u.username} — ${b.name}`} disabled={admin || (!available && !mine.includes(b.id))}
                        checked={mine.includes(b.id)} onChange={(e) => void toggle(u, b.id, e.target.checked)} />
                    </td>
                  ))}
                  <td className="small muted">{admin ? t('bn_admin') : mine.length ? '' : t('bn_allBranches')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
