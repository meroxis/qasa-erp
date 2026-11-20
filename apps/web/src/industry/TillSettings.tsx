import { useEffect, useState } from 'react';
import { api, type WarehouseView } from '../api.ts';
import { AccountCombo, ErrorBox, Icon, useLoad, useToast } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { tillsApi, type PosAccounts, type TillInput, type TillView } from './pos-api.ts';
import { keepScalePrefixes } from './till.ts';

/**
 * Settings → Sales and point of sale (2.0), for admins: the shop's named tills, the accounts card and wallet payments
 * go into (the till offers each once it has one), and the scale prefixes whose labels carry a price.
 */
export function TillSettings({ admin }: { admin: boolean }) {
  if (!admin) return null;
  return <><TillsCard /><PayAccountsCard /><ScalePricesCard /></>;
}

function TillsCard() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { data, reload } = useLoad(() => tillsApi.list(), []);
  const { data: warehouses } = useLoad(() => api.warehouses(), []);
  const [editing, setEditing] = useState<TillView | 'new' | null>(null);
  const tills = data?.tills ?? [];
  return (
    <div className="settings-group" data-setting="pos-tills">
      <div className="setting">
        <Icon name="cart" size={20} className="setting-icon" />
        <div className="setting-text"><strong>{t('tl_tills')}</strong><span>{t('tl_tillsHelp')}</span><span className="small muted">{t('tl_drawerHelp')}</span></div>
        <div className="setting-ctl stack" style={{ gap: 8 }}>
          {tills.length === 0 && <p className="small muted" style={{ margin: 0 }}>{t('tl_noTills')}</p>}
          {tills.map((x) => (
            <div key={x.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <strong>{x.name}</strong>
              <span className="small muted">{x.cashAccountCode} · {x.drawer === 'cash' ? t('tl_drawerCash') : t('tl_drawerOff')}{x.customerDisplay ? ` · ${t('tl_display')}` : ''}</span>
              {!x.active && <span className="chip">{t('inactive')}</span>}
              {x.openShiftId && <span className="chip info">{t('pos_statusOpen')}</span>}
              <span className="spacer" />
              <button type="button" className="btn small" onClick={() => setEditing(x)}><Icon name="edit" size={14} />{t('editTitle')}</button>
            </div>
          ))}
          {!editing && <div><button type="button" className="btn small" onClick={() => setEditing('new')}><Icon name="plus" size={14} />{t('tl_add')}</button></div>}
          {data && !data.multiTill && tills.filter((x) => x.active).length >= 1 && <p className="small muted" style={{ margin: 0 }}>{t('tl_multiNeedsPlan')}</p>}
          {editing && (
            <TillForm till={editing === 'new' ? null : editing} warehouses={warehouses ?? []}
              onDone={() => { setEditing(null); reload(); toast(t('tl_saved')); }} onCancel={() => setEditing(null)} />
          )}
        </div>
      </div>
    </div>
  );
}

function TillForm({ till, warehouses, onDone, onCancel }: { till: TillView | null; warehouses: WarehouseView[]; onDone(): void; onCancel(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const active = warehouses.filter((w) => w.active);
  const [form, setForm] = useState<TillInput>(() => till
    ? { name: till.name, cashAccountCode: till.cashAccountCode, warehouseId: till.warehouseId, drawer: till.drawer, customerDisplay: till.customerDisplay, active: till.active }
    : { name: '', cashAccountCode: '1811', warehouseId: '', drawer: 'off', customerDisplay: false, active: true });
  useEffect(() => { if (!form.warehouseId && active[0]) setForm((f) => ({ ...f, warehouseId: active[0]!.id })); }, [active.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (till) await tillsApi.update(till.id, form); else await tillsApi.create(form);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card pad stack" style={{ gap: 8 }}>
      <div className="grid-2">
        <label className="field"><span>{t('tl_name')}</span><input className="input" maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <div className="field"><span>{t('pos_cashAccount')}</span><AccountCombo value={form.cashAccountCode} onChange={(v) => setForm({ ...form, cashAccountCode: v })} filter={(a) => a.code.startsWith('18')} ariaLabel={t('pos_cashAccount')} /></div>
        <label className="field"><span>{t('pos_warehouse')}</span>
          <select className="input" value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}>
            {active.map((w) => <option key={w.id} value={w.id}>{w.code} — {i18n.name(w.name)}</option>)}
          </select>
        </label>
        <label className="field"><span>{t('tl_drawer')}</span>
          <select className="input" value={form.drawer} onChange={(e) => setForm({ ...form, drawer: e.target.value === 'cash' ? 'cash' : 'off' })}>
            <option value="off">{t('tl_drawerOff')}</option>
            <option value="cash">{t('tl_drawerCash')}</option>
          </select>
        </label>
      </div>
      <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!form.customerDisplay} onChange={(e) => setForm({ ...form, customerDisplay: e.target.checked })} />{t('tl_display')}</label>
      <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} />{t('tl_active')}</label>
      <ErrorBox error={error} />
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !form.name.trim() || !form.warehouseId} onClick={() => void save()}>{t('save')}</button>
        <button type="button" className="btn" onClick={onCancel}>{t('pos_cancel')}</button>
      </div>
    </div>
  );
}

const PAY_METHODS = ['card', 'fib', 'zaincash', 'qi'] as const;

function PayAccountsCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { data } = useLoad(() => tillsApi.paymentAccounts(), []);
  const [accounts, setAccounts] = useState<PosAccounts | null>(null);
  useEffect(() => { if (data) setAccounts(data.accounts); }, [data]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!accounts) return null;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setAccounts((await tillsApi.setPaymentAccounts(accounts)).accounts);
      toast(t('saved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-group" data-setting="pos-pay-accounts">
      <div className="setting">
        <Icon name="wallet" size={20} className="setting-icon" />
        <div className="setting-text"><strong>{t('tl_payAccounts')}</strong><span>{t('tl_payAccountsHelp')}</span></div>
        <div className="setting-ctl stack" style={{ gap: 8 }}>
          <div className="grid-2">
            {PAY_METHODS.map((m) => (
              <div key={m} className="field"><span>{t(`pay_${m}` as Key)}</span>
                <AccountCombo value={accounts[m] ?? ''} onChange={(v) => setAccounts({ ...accounts, [m]: v })} filter={(a) => a.code.startsWith('18')} ariaLabel={t(`pay_${m}` as Key)} />
              </div>
            ))}
          </div>
          <ErrorBox error={error} />
          <div><button type="button" className="btn small primary" disabled={busy} onClick={() => void save()}>{t('save')}</button></div>
        </div>
      </div>
    </div>
  );
}

function ScalePricesCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { data } = useLoad(() => tillsApi.scale(), []);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { if (data) setText(data.pricePrefixes.join(', ')); }, [data]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (text === null) return null;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const list = text.split(/[\s,،]+/).map((s) => s.trim()).filter(Boolean);
      const saved = await tillsApi.setScale(list);
      keepScalePrefixes(saved.pricePrefixes);
      setText(saved.pricePrefixes.join(', '));
      toast(t('saved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-group" data-setting="pos-scale-prices">
      <div className="setting">
        <Icon name="scale" size={20} className="setting-icon" />
        <div className="setting-text"><strong>{t('tl_scaleTitle')}</strong><span>{t('tl_scaleHelp')}</span></div>
        <div className="setting-ctl stack" style={{ gap: 8 }}>
          <label className="field"><span>{t('tl_scalePrefixes')}</span><input className="input num ltr" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} /></label>
          <ErrorBox error={error} />
          <div><button type="button" className="btn small primary" disabled={busy} onClick={() => void save()}>{t('save')}</button></div>
        </div>
      </div>
    </div>
  );
}
