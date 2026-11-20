import { useEffect, useState } from 'react';
import { api, type WarehouseView } from '../api.ts';
import { AccountCombo, AmountInput, ErrorBox, Icon, useData, useLoad } from '../components.tsx';
import { useI18n } from '../i18n.ts';
import { href } from '../router.ts';
import { posApi, tillsApi, type Money2, type ShiftView, type TillView } from '../industry/pos-api.ts';
import { setThisTill, thisTill } from '../industry/till.ts';
import { money2, remember, remembered, shiftTime } from './shared.ts';

/* ---------- opening a shift ---------- */

export function OpenShift({ onOpened }: { onOpened(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const [register, setRegister] = useState(remembered() || t('pos_defaultRegister'));
  const [cashAccount, setCashAccount] = useState(settings?.postingAccounts.cash ?? '1811');
  const [warehouseId, setWarehouseId] = useState('');
  const [opening, setOpening] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { data: warehouses } = useLoad(() => api.warehouses(), []);
  const { data: recent } = useLoad(() => posApi.shifts({ limit: '10' }), []);
  // 2.0: the shop's named tills; this PC remembers which one it is
  const { data: tillList } = useLoad(() => tillsApi.list().catch(() => ({ tills: [] as TillView[], multiTill: false })), []);
  const tills = (tillList?.tills ?? []).filter((x) => x.active);
  const [tillId, setTillId] = useState(thisTill());
  const till = tills.find((x) => x.id === tillId) ?? null;
  useEffect(() => {
    if (!warehouseId && warehouses?.length) setWarehouseId((warehouses.find((w: WarehouseView) => w.active) ?? warehouses[0]!).id);
  }, [warehouses, warehouseId]);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      if (till) {
        await posApi.open({ tillId: till.id, register: till.name, cashAccountCode: till.cashAccountCode, warehouseId: till.warehouseId, openingCash: opening ?? 0 });
        setThisTill(till.id);
      } else {
        await posApi.open({ register: register.trim(), cashAccountCode: cashAccount, warehouseId, openingCash: opening ?? 0 });
        remember(register.trim());
        setThisTill('');
      }
      onOpened();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack pos-open">
      <div className="card pad stack">
        <h2 style={{ margin: 0 }}>{t('pos_openTitle')}</h2>
        <p className="muted" style={{ margin: 0 }}>{t('pos_openHelp')}</p>
        {tills.length > 0 && (
          <label className="field"><span>{t('tl_pickTill')}</span>
            <select className="input pos-big-input" value={till ? till.id : ''} onChange={(e) => setTillId(e.target.value)}>
              {tills.map((x) => <option key={x.id} value={x.id} disabled={!!x.openShiftId}>{x.name}{x.openShiftId ? ` (${t('pos_statusOpen')})` : ''}</option>)}
              <option value="">{t('tl_byName')}</option>
            </select>
          </label>
        )}
        <div className="grid-2">
          {!till && <label className="field"><span>{t('pos_register')}</span><input className="input pos-big-input" maxLength={60} value={register} onChange={(e) => setRegister(e.target.value)} /></label>}
          <label className="field"><span>{t('pos_openingCash')}</span><AmountInput value={opening} currency="IQD" onChange={setOpening} ariaLabel={t('pos_openingCash')} /></label>
          {!till && <div className="field"><span>{t('pos_cashAccount')}</span><AccountCombo value={cashAccount} onChange={setCashAccount} filter={(a) => a.code.startsWith('18')} ariaLabel={t('pos_cashAccount')} /></div>}
          {!till && (
            <label className="field"><span>{t('pos_warehouse')}</span>
              <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                {(warehouses ?? []).filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.code} — {i18n.name(w.name)}</option>)}
              </select>
            </label>
          )}
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary pos-touch" disabled={busy || (!till && !warehouseId) || !!till?.openShiftId} onClick={() => void open()}>
            <Icon name="wallet" size={18} />{t('pos_openButton')}
          </button>
        </div>
      </div>
      <TillsToday />
      {recent && recent.length > 0 && <ShiftList shifts={recent} />}
    </div>
  );
}

/** 2.0: today's shifts till by till (whoever keeps the books: every till; a cashier: their own shifts). */
function TillsToday() {
  const i18n = useI18n();
  const { t } = i18n;
  const { data } = useLoad(() => tillsApi.summary().catch(() => null), []);
  if (!data || data.rows.length < 2) return null;
  return (
    <div className="card pad stack">
      <h3 style={{ margin: 0 }}>{t('tl_today')}</h3>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('tl_till')}</th><th className="num">{t('tl_shifts')}</th><th className="num">{t('pos_salesCount')}</th><th className="num">{t('pos_sales')}</th><th className="num">{t('tl_noSaleCol')}</th><th className="num">{t('tl_diff')}</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.tillId ?? r.register}>
                <td>{r.register}</td><td className="num">{i18n.int(r.shifts)}</td><td className="num">{i18n.int(r.count)}</td>
                <td className="num">{money2(i18n, r.sales)}</td><td className="num">{i18n.int(r.noSale)}</td><td className="num"><DiffText d={r.difference} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShiftList({ shifts }: { shifts: ShiftView[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <div className="card">
      <div className="card-head"><h3 style={{ margin: 0 }}>{t('pos_recentShifts')}</h3></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('pos_shift')}</th><th>{t('pos_register')}</th><th>{t('pos_cashier')}</th><th>{t('pos_opened')}</th><th>{t('pos_salesCount')}</th><th className="num">{t('pos_sales')}</th><th>{t('pos_difference')}</th></tr></thead>
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id}>
                <td><a href={href(`pos-shift/${s.id}`)}>{s.number}</a> {s.status === 'open' && <span className="chip info">{t('pos_statusOpen')}</span>}</td>
                <td>{s.register}</td>
                <td>{s.openedBy}</td>
                <td className="num">{shiftTime(i18n, s.openedAt)}</td>
                <td className="num">{i18n.int(s.count)}</td>
                <td className="num">{money2(i18n, s.sales)}</td>
                <td className="num">{s.difference ? <DiffText d={s.difference} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DiffText({ d }: { d: Money2 }) {
  const i18n = useI18n();
  const bad = d.IQD !== 0 || d.USD !== 0;
  return <span style={{ color: bad ? 'var(--bad)' : 'var(--ok)' }}>{money2(i18n, d)}</span>;
}

