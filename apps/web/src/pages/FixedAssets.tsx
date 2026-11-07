import { useEffect, useState } from 'react';
import { todayIso, toWesternDigits } from '@qasa/core';
import { AccountCombo, AmountInput, EmptyState, ErrorBox, Icon, Modal, useLoad, usePageNav, useToast, downloadCsv } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { assetsApi, type AssetCategory, type AssetDefaults, type AssetDetail, type AssetView, type EntryRef, type RunView } from '../industry/assets-api.ts';
import { go, href } from '../router.ts';

/**
 * الموجودات الثابتة: the asset register and monthly straight-line depreciation. Routes: 'fixed-assets',
 * 'fixed-assets/runs' and 'fixed-asset/:id'. The purchase itself stays an ordinary invoice or voucher.
 */

const NAV = { key: 'fa_title' as const, group: 'gAccounting' as const };
const CATS: AssetCategory[] = ['buildings', 'machinery', 'vehicles', 'tools', 'furniture', 'computers', 'land'];
const catKey = (c: AssetCategory | null): Key => (c ? (`fa_cat_${c}` as Key) : 'fa_cat_other');
const iqd = (i18n: I18n, n: number) => i18n.money(n, 'IQD');
const month = (i18n: I18n, p: string) => i18n.digitsOf(p);

function EntryLink({ entry }: { entry: EntryRef | null }) {
  const { t } = useI18n();
  if (!entry) return <span className="muted">—</span>;
  return (
    <a href={href(`entry/${entry.id}`)} className="ltr num">
      {entry.number ?? t('fa_draft')}{entry.status === 'draft' && entry.number ? ` · ${t('fa_draft')}` : ''}
    </a>
  );
}

export function FixedAssets({ tab = 'register' }: { tab?: 'register' | 'runs' }) {
  const { t } = useI18n();
  usePageNav(NAV);
  return (
    <div className="stack">
      <div className="tabs" role="group">
        <button type="button" aria-pressed={tab === 'register'} onClick={() => go('fixed-assets')}>{t('fa_tabRegister')}</button>
        <button type="button" aria-pressed={tab === 'runs'} onClick={() => go('fixed-assets/runs')}>{t('fa_tabRuns')}</button>
      </div>
      {tab === 'register' ? <Register /> : <Runs />}
    </div>
  );
}

/* ---------- register ---------- */

function Register() {
  const i18n = useI18n();
  const { t } = i18n;
  const [status, setStatus] = useState<'active' | 'disposed' | ''>('active');
  const [q, setQ] = useState('');
  const list = useLoad(() => assetsApi.list({ ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) }), [status, q]);
  const summary = useLoad(() => assetsApi.summary(), []);
  const [creating, setCreating] = useState(false);
  const s = summary.data;

  function exportCsv() {
    const rows = (list.data ?? []).map((a) => [a.code, a.name, t(catKey(a.category)), a.assetAccount.code, a.acquired, a.cost, a.salvage, a.lifeMonths,
      a.accumulated, a.bookValue, a.location, t(a.status === 'active' ? 'fa_active' : 'fa_disposed'), a.disposedOn ?? '']);
    downloadCsv(`fixed-assets-${todayIso()}.csv`, [[t('fa_code'), t('fa_name'), t('fa_category'), t('fa_assetAccount'), t('fa_acquired'), t('fa_cost'),
      t('fa_salvage'), t('fa_life'), t('fa_accumulated'), t('fa_bookValue'), t('fa_location'), t('fa_status'), t('fa_disposeDate')], ...rows]);
  }

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('fa_help')}</p>
      {s && (
        <div className="grid-4">
          <div className="card pad tile"><div className="label">{t('fa_assets')}</div><div className="value num">{i18n.int(s.active)}</div></div>
          <div className="card pad tile"><div className="label">{t('fa_cost')}</div><div className="value num">{iqd(i18n, s.cost)}</div></div>
          <div className="card pad tile"><div className="label">{t('fa_accumulated')}</div><div className="value num">{iqd(i18n, s.accumulated)}</div></div>
          <div className="card pad tile"><div className="label">{t('fa_bookValue')}</div><div className="value num">{iqd(i18n, s.bookValue)}</div>
            <div className="small muted">{t('fa_lastRun')}: {s.lastRun ? month(i18n, s.lastRun) : '—'}</div></div>
        </div>
      )}
      <div className="row">
        <div className="track">
          {(['active', 'disposed', ''] as const).map((v) => (
            <button key={v || 'all'} type="button" aria-pressed={status === v} onClick={() => setStatus(v)}>{t(v === 'active' ? 'fa_active' : v === 'disposed' ? 'fa_disposed' : 'fa_all')}</button>
          ))}
        </div>
        <input className="input" style={{ maxWidth: 240 }} placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="spacer" />
        <button type="button" className="btn" disabled={!list.data?.length} onClick={exportCsv}><Icon name="download" size={16} />{t('fa_exportCsv')}</button>
        <button type="button" className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />{t('fa_new')}</button>
      </div>
      <ErrorBox error={list.error} />
      {list.data && (list.data.length ? (
        <div className="card">
          <table className="table">
            <thead><tr>
              <th>{t('fa_code')}</th><th>{t('fa_name')}</th><th>{t('fa_category')}</th><th>{t('fa_acquired')}</th>
              <th className="num">{t('fa_cost')}</th><th className="num">{t('fa_accumulated')}</th><th className="num">{t('fa_bookValue')}</th><th>{t('fa_location')}</th>
            </tr></thead>
            <tbody>
              {list.data.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => go(`fixed-asset/${a.id}`)}>
                  <td><a href={href(`fixed-asset/${a.id}`)} className="ltr num" onClick={(e) => e.stopPropagation()}>{a.code}</a></td>
                  <td>{a.name}{a.status === 'disposed' && <span className="chip small" style={{ marginInlineStart: 6 }}>{t('fa_disposed')}</span>}</td>
                  <td>{t(catKey(a.category))}</td>
                  <td>{i18n.date(a.acquired)}</td>
                  <td className="num">{iqd(i18n, a.cost)}</td>
                  <td className="num">{iqd(i18n, a.accumulated)}</td>
                  <td className="num"><strong>{iqd(i18n, a.bookValue)}</strong></td>
                  <td>{a.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState icon="building" title={t('fa_empty')} text={t('fa_emptyText')} />)}
      {creating && <AssetForm onClose={() => setCreating(false)} onDone={(a) => { setCreating(false); go(`fixed-asset/${a.id}`); }} />}
    </div>
  );
}

/* ---------- the form (new and edit) ---------- */

function AssetForm({ asset, onClose, onDone }: { asset?: AssetDetail; onClose(): void; onDone(a: AssetDetail): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const defaults = useLoad(() => assetsApi.defaults(), []);
  const locked = !!asset && !asset.actions.includes('editAll');
  const [category, setCategory] = useState<AssetCategory | ''>(asset?.category ?? '');
  const [name, setName] = useState(asset?.name ?? '');
  const [assetAccount, setAssetAccount] = useState(asset?.assetAccount.code ?? '');
  const [accumAccount, setAccumAccount] = useState(asset?.accumAccount.code ?? '');
  const [expenseAccount, setExpenseAccount] = useState(asset?.expenseAccount.code ?? '');
  const [acquired, setAcquired] = useState(asset?.acquired ?? todayIso());
  const [cost, setCost] = useState<number | null>(asset?.cost ?? null);
  const [salvage, setSalvage] = useState<number | null>(asset?.salvage ?? 0);
  const [life, setLife] = useState(asset ? String(asset.lifeMonths) : '');
  const [opening, setOpening] = useState<number | null>(asset?.openingAccum ?? 0);
  const [location, setLocation] = useState(asset?.location ?? '');
  const [notes, setNotes] = useState(asset?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // a new asset starts from the defaults of the chosen category
  useEffect(() => {
    if (asset || !defaults.data) return;
    if (!accumAccount) setAccumAccount(defaults.data.accumAccount);
    if (!expenseAccount) setExpenseAccount(defaults.data.expenseAccount);
  }, [defaults.data]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickCategory(c: AssetCategory | '', d: AssetDefaults | null) {
    setCategory(c);
    const def = d?.categories.find((x) => x.id === c);
    if (def) { setAssetAccount(def.account); setLife(String(def.lifeMonths)); }
  }

  const lifeMonths = Number(life);
  const def = defaults.data?.categories.find((x) => x.id === category);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const common = { name, location, notes };
      const figures = { assetAccount, accumAccount, expenseAccount, acquired, cost: cost ?? 0, salvage: salvage ?? 0, lifeMonths, openingAccum: opening ?? 0 };
      const saved = asset
        ? await assetsApi.update(asset.id, locked ? common : { ...common, ...figures })
        : await assetsApi.create({ ...common, ...figures });
      onDone(saved);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t(asset ? 'fa_edit' : 'fa_new')} onClose={onClose}>
      <div className="stack">
        {locked && <p className="muted small" style={{ margin: 0 }}>{t('fa_lockedNote')}</p>}
        <div className="grid-2">
          <label className="field"><span>{t('fa_name')}</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label className="field">
            <span>{t('fa_category')}</span>
            <select className="input" value={category} disabled={locked} onChange={(e) => pickCategory(e.target.value as AssetCategory | '', defaults.data)}>
              <option value="">—</option>
              {CATS.map((c) => <option key={c} value={c}>{t(catKey(c))}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('fa_acquired')}</span><input className="input" type="date" max={todayIso()} disabled={locked} value={acquired} onChange={(e) => setAcquired(e.target.value)} /></label>
          <label className="field"><span>{t('fa_location')}</span><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
          {!locked && <>
            <div className="field"><span>{t('fa_cost')}</span><AmountInput value={cost} currency="IQD" onChange={setCost} ariaLabel={t('fa_cost')} /></div>
            <div className="field"><span>{t('fa_salvage')}</span><AmountInput value={salvage} currency="IQD" onChange={setSalvage} ariaLabel={t('fa_salvage')} /></div>
            <label className="field">
              <span>{t('fa_life')}{def && Number(life) === def.lifeMonths ? ` · ${t('fa_default')}` : ''}</span>
              <input className="input num ltr" inputMode="numeric" value={life} onChange={(e) => setLife(toWesternDigits(e.target.value).replace(/\D/g, ''))} />
              {lifeMonths > 0 && <small className="muted">{t('fa_lifeYears', { n: Math.round((lifeMonths / 12) * 10) / 10 })}</small>}
            </label>
            <div className="field"><span>{t('fa_openingAccum')}</span><AmountInput value={opening} currency="IQD" onChange={setOpening} ariaLabel={t('fa_openingAccum')} />
              <small className="muted">{t('fa_openingHelp')}</small></div>
            <div className="field"><span>{t('fa_assetAccount')}</span><AccountCombo value={assetAccount} onChange={setAssetAccount} filter={(a) => a.code.startsWith('11')} ariaLabel={t('fa_assetAccount')} /></div>
            <div className="field"><span>{t('fa_accumAccount')}</span><AccountCombo value={accumAccount} onChange={setAccumAccount} filter={(a) => a.code.startsWith('23')} ariaLabel={t('fa_accumAccount')} /></div>
            <div className="field"><span>{t('fa_expenseAccount')}</span><AccountCombo value={expenseAccount} onChange={setExpenseAccount} filter={(a) => a.code.startsWith('3')} ariaLabel={t('fa_expenseAccount')} /></div>
          </>}
          <label className="field"><span>{t('notes')}</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
        {!locked && <p className="muted small" style={{ margin: 0 }}>{t('fa_defaultsNote')}</p>}
        <ErrorBox error={error ?? defaults.error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !name.trim() || (!locked && (!cost || !(lifeMonths > 0)))} onClick={() => void save()}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- one asset ---------- */

export function FixedAssetDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  usePageNav(NAV);
  const toast = useToast();
  const asset = useLoad(() => assetsApi.get(id), [id]);
  const [editing, setEditing] = useState(false);
  const [disposing, setDisposing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const a = asset.data;

  async function undispose() {
    setError(null);
    try { await assetsApi.undispose(id); toast(t('saved')); asset.reload(); } catch (e) { setError(e); }
  }

  function exportSchedule() {
    if (!a) return;
    downloadCsv(`${a.code}-schedule.csv`, [[t('fa_month'), t('fa_amount'), t('fa_accumulated'), t('fa_bookValue'), t('fa_status')],
      ...a.schedule.map((r) => [r.period, r.amount, r.accumulated, r.bookValue, t(r.state === 'run' ? 'fa_stateRun' : r.state === 'planned' ? 'fa_statePlanned' : 'fa_stateOpening')])]);
  }

  return (
    <div className="stack">
      <div className="row"><a className="btn ghost small" href={href('fixed-assets')}><Icon name="chevron" size={16} />{t('fa_title')}</a></div>
      <ErrorBox error={asset.error ?? error} />
      {a && <>
        <div className="card pad stack">
          <div className="row">
            <h2 style={{ margin: 0 }}><span className="ltr num">{a.code}</span> — {a.name}</h2>
            {a.status === 'disposed' && <span className="chip">{t('fa_disposed')}</span>}
            <span className="spacer" />
            {a.actions.includes('edit') && <button type="button" className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={16} />{t('actEdit')}</button>}
            {a.actions.includes('dispose') && <button type="button" className="btn" onClick={() => setDisposing(true)}><Icon name="x" size={16} />{t('fa_dispose')}</button>}
            {a.actions.includes('undispose') && <button type="button" className="btn" onClick={() => void undispose()}><Icon name="undo" size={16} />{t('fa_undispose')}</button>}
            {a.actions.includes('delete') && <button type="button" className="btn danger" onClick={() => setDeleting(true)}>{t('actDelete')}</button>}
          </div>
          <div className="grid-4">
            <div className="tile"><div className="label">{t('fa_cost')}</div><div className="value num">{iqd(i18n, a.cost)}</div></div>
            <div className="tile"><div className="label">{t('fa_accumulated')}</div><div className="value num">{iqd(i18n, a.accumulated)}</div></div>
            <div className="tile"><div className="label">{t('fa_bookValue')}</div><div className="value num">{iqd(i18n, a.bookValue)}</div></div>
            <div className="tile"><div className="label">{t('fa_monthly')}</div><div className="value num">{a.depreciated ? iqd(i18n, a.monthly) : t('fa_notDepreciated')}</div></div>
          </div>
          <dl className="grid-2 small">
            <div><dt className="muted">{t('fa_category')}</dt><dd>{t(catKey(a.category))}</dd></div>
            <div><dt className="muted">{t('fa_acquired')}</dt><dd>{i18n.date(a.acquired)}</dd></div>
            <div><dt className="muted">{t('fa_life')}</dt><dd className="num">{t('fa_months', { n: a.lifeMonths })} — {a.depreciated ? t('fa_period', { a: a.startMonth, b: a.endMonth }) : t('fa_notDepreciated')}</dd></div>
            <div><dt className="muted">{t('fa_salvage')}</dt><dd className="num">{iqd(i18n, a.salvage)}</dd></div>
            {a.openingAccum > 0 && <div><dt className="muted">{t('fa_openingAccum')}</dt><dd className="num">{iqd(i18n, a.openingAccum)}</dd></div>}
            <div><dt className="muted">{t('fa_assetAccount')}</dt><dd><span className="ltr num">{a.assetAccount.code}</span> {i18n.name(a.assetAccount.name)}</dd></div>
            <div><dt className="muted">{t('fa_accumAccount')}</dt><dd><span className="ltr num">{a.accumAccount.code}</span> {i18n.name(a.accumAccount.name)}</dd></div>
            <div><dt className="muted">{t('fa_expenseAccount')}</dt><dd><span className="ltr num">{a.expenseAccount.code}</span> {i18n.name(a.expenseAccount.name)}</dd></div>
            {a.location && <div><dt className="muted">{t('fa_location')}</dt><dd>{a.location}</dd></div>}
            {a.notes && <div><dt className="muted">{t('notes')}</dt><dd>{a.notes}</dd></div>}
          </dl>
          {a.disposal && (
            <div className="alert">
              {t('fa_disposedOn', { d: i18n.date(a.disposal.date) })} · {t('fa_proceeds')}: <span className="num">{iqd(i18n, a.disposal.proceeds)}</span> ·{' '}
              {t(a.disposal.gain >= 0 ? 'fa_gain' : 'fa_loss')}: <span className="num">{iqd(i18n, Math.abs(a.disposal.gain))}</span> · {t('fa_entry')}: <EntryLink entry={a.disposal.entry} />
            </div>
          )}
        </div>

        {a.depreciated && (
          <div className="card pad stack">
            <div className="row">
              <strong>{t('fa_schedule')}</strong>
              <span className="spacer" />
              <button type="button" className="btn" disabled={!a.schedule.length} onClick={exportSchedule}><Icon name="download" size={16} />{t('fa_exportCsv')}</button>
            </div>
            <table className="table">
              <thead><tr><th>{t('fa_month')}</th><th className="num">{t('fa_amount')}</th><th className="num">{t('fa_accumulated')}</th><th className="num">{t('fa_bookValue')}</th><th>{t('fa_status')}</th></tr></thead>
              <tbody>
                {a.schedule.map((r, i) => (
                  <tr key={r.period || 'opening-' + i} className={r.state === 'planned' ? 'muted' : undefined}>
                    <td className="num">{r.period ? month(i18n, r.period) : t('fa_stateOpening')}</td>
                    <td className="num">{iqd(i18n, r.amount)}</td>
                    <td className="num">{iqd(i18n, r.accumulated)}</td>
                    <td className="num">{iqd(i18n, r.bookValue)}</td>
                    <td>{t(r.state === 'run' ? 'fa_stateRun' : r.state === 'planned' ? 'fa_statePlanned' : 'fa_stateOpening')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {editing && <AssetForm asset={a} onClose={() => setEditing(false)} onDone={() => { setEditing(false); toast(t('saved')); asset.reload(); }} />}
        {disposing && <Dispose asset={a} onClose={() => setDisposing(false)} onDone={() => { setDisposing(false); toast(t('saved')); asset.reload(); }} />}
        {deleting && (
          <Modal title={t('fa_deleteConfirm')} onClose={() => setDeleting(false)}>
            <div className="stack">
              <p><span className="ltr num">{a.code}</span> — {a.name}</p>
              <ErrorBox error={error} />
              <div className="row">
                <button type="button" className="btn danger" onClick={() => { assetsApi.remove(a.id).then(() => go('fixed-assets'), setError); }}>{t('actDelete')}</button>
                <button type="button" className="btn" onClick={() => setDeleting(false)}>{t('cancel')}</button>
              </div>
            </div>
          </Modal>
        )}
      </>}
    </div>
  );
}

function Dispose({ asset, onClose, onDone }: { asset: AssetView; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const defaults = useLoad(() => assetsApi.defaults(), []);
  const [date, setDate] = useState(todayIso());
  const [proceeds, setProceeds] = useState<number | null>(0);
  const [proceedsAccount, setProceedsAccount] = useState('');
  const [gainAccount, setGainAccount] = useState('');
  const [lossAccount, setLossAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const gain = (proceeds ?? 0) - asset.bookValue;

  useEffect(() => {
    if (!defaults.data) return;
    setGainAccount((g) => g || defaults.data!.gainAccount);
    setLossAccount((l) => l || defaults.data!.lossAccount);
  }, [defaults.data]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await assetsApi.dispose(asset.id, {
        date, lang: i18n.lang, ...(proceeds ? { proceeds, proceedsAccount } : {}),
        ...(gainAccount ? { gainAccount } : {}), ...(lossAccount ? { lossAccount } : {})
      });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('fa_dispose')} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('fa_disposeHelp')}</p>
        <div className="grid-2">
          <label className="field"><span>{t('fa_disposeDate')}</span><input className="input" type="date" min={asset.acquired} max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <div className="field"><span>{t('fa_proceeds')}</span><AmountInput value={proceeds} currency="IQD" onChange={setProceeds} ariaLabel={t('fa_proceeds')} /></div>
          {!!proceeds && <div className="field"><span>{t('fa_proceedsAccount')}</span>
            <AccountCombo value={proceedsAccount} onChange={setProceedsAccount} filter={(a) => a.code.startsWith('18') || a.code.startsWith('16')} ariaLabel={t('fa_proceedsAccount')} /></div>}
          <div className="field"><span>{t(gain >= 0 ? 'fa_gainAccount' : 'fa_lossAccount')}</span>
            {gain >= 0
              ? <AccountCombo value={gainAccount} onChange={setGainAccount} filter={(a) => a.code.startsWith('4')} ariaLabel={t('fa_gainAccount')} />
              : <AccountCombo value={lossAccount} onChange={setLossAccount} filter={(a) => a.code.startsWith('3')} ariaLabel={t('fa_lossAccount')} />}
          </div>
        </div>
        <p className="small" style={{ margin: 0 }}>
          {t('fa_bookValue')}: <span className="num">{iqd(i18n, asset.bookValue)}</span> · {t(gain >= 0 ? 'fa_gain' : 'fa_loss')}: <strong className="num">{iqd(i18n, Math.abs(gain))}</strong>
        </p>
        <p className="muted small" style={{ margin: 0 }}>{t('fa_gainNote')}</p>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || (!!proceeds && !proceedsAccount)} onClick={() => void save()}><Icon name="check" size={16} />{t('fa_dispose')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- monthly runs ---------- */

function Runs() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const summary = useLoad(() => assetsApi.summary(), []);
  const runs = useLoad(() => assetsApi.runs(), []);
  const [period, setPeriod] = useState('');
  const effective = period || summary.data?.nextPeriod || todayIso().slice(0, 7);
  const preview = useLoad(() => assetsApi.preview(effective), [effective]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [cancelling, setCancelling] = useState<RunView | null>(null);
  const p = preview.data;

  async function runNow() {
    setBusy(true);
    setError(null);
    try {
      await assetsApi.runMonth(effective, i18n.lang);
      toast(t('saved'));
      setPeriod('');
      summary.reload(); runs.reload(); preview.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card pad stack">
        <strong>{t('fa_runMonth')}</strong>
        <p className="muted small" style={{ margin: 0 }}>{t('fa_runHelp')}</p>
        <div className="row">
          <label className="field"><span>{t('fa_month')}</span>
            <input className="input" type="month" max={todayIso().slice(0, 7)} value={effective} onChange={(e) => setPeriod(e.target.value)} /></label>
          <span className="spacer" />
          {summary.data && <span className="small muted">{t('fa_lastRun')}: {summary.data.lastRun ? month(i18n, summary.data.lastRun) : '—'}</span>}
        </div>
        <ErrorBox error={preview.error ?? error} />
        {p && (p.alreadyRun ? <p className="muted">{t('fa_alreadyRun')}</p> : p.lines.length ? (
          <>
            <table className="table">
              <thead><tr><th>{t('fa_code')}</th><th>{t('fa_name')}</th><th>{t('fa_category')}</th><th className="num">{t('fa_amount')}</th></tr></thead>
              <tbody>
                {p.lines.map((l) => (
                  <tr key={l.assetId}><td className="ltr num">{l.code}</td><td>{l.name}</td><td>{t(catKey(l.category))}</td><td className="num">{iqd(i18n, l.amount)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><th colSpan={3}>{t('total')} · {i18n.date(p.date)}</th><th className="num">{iqd(i18n, p.total)}</th></tr></tfoot>
            </table>
            <div className="row">
              <button type="button" className="btn primary" disabled={busy} onClick={() => void runNow()}><Icon name="check" size={16} />{t('fa_runNow')}</button>
            </div>
          </>
        ) : <p className="muted">{t('fa_nothing')}</p>)}
      </div>

      <div className="card pad stack">
        <strong>{t('fa_runs')}</strong>
        <ErrorBox error={runs.error} />
        {runs.data && (runs.data.length ? (
          <table className="table">
            <thead><tr><th>{t('fa_month')}</th><th className="num">{t('fa_amount')}</th><th>{t('fa_assets')}</th><th>{t('fa_entry')}</th><th>{t('fa_by')}</th><th /></tr></thead>
            <tbody>
              {runs.data.map((r) => (
                <tr key={r.id}>
                  <td className="num">{month(i18n, r.period)}</td>
                  <td className="num">{iqd(i18n, r.total)}</td>
                  <td className="num">{i18n.int(r.lines.length)}</td>
                  <td><EntryLink entry={r.entry} /></td>
                  <td>{r.createdBy}</td>
                  <td className="num">{r.actions.includes('cancel') && (
                    <button type="button" className="btn subtle small" onClick={() => setCancelling(r)}>{t('fa_cancelRun')}</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">{t('fa_noRuns')}</p>)}
      </div>

      {cancelling && (
        <Modal title={t('fa_cancelRunConfirm')} onClose={() => setCancelling(null)}>
          <div className="stack">
            <p><span className="num">{month(i18n, cancelling.period)}</span> — <span className="num">{iqd(i18n, cancelling.total)}</span></p>
            <p className="muted small">{t('fa_cancelRunNote')}</p>
            <ErrorBox error={error} />
            <div className="row">
              <button type="button" className="btn danger" onClick={() => {
                assetsApi.cancelRun(cancelling.id).then(() => { setCancelling(null); summary.reload(); runs.reload(); preview.reload(); }, setError);
              }}>{t('fa_cancelRun')}</button>
              <button type="button" className="btn" onClick={() => setCancelling(null)}>{t('cancel')}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
