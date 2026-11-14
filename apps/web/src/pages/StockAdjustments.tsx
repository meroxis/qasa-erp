import { useEffect, useMemo, useRef, useState } from 'react';
import { lineAmount, todayIso, type UnitCode } from '@qasa/core';
import { api, type ItemView } from '../api.ts';
import {
  AccountCombo, AmountInput, ErrorBox, Icon, InvoiceStatusChip, Modal, QtyInput, SearchCombo, downloadCsv, useData, useLoad, useToast, type PickOption
} from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { go, href } from '../router.ts';
import { averageCost, qtyText, unitName } from './Items.tsx';
import {
  ADJUSTMENT_REASONS, adjustmentsApi, parseCountText,
  type AdjustmentAccounts, type AdjustmentInput, type AdjustmentReason, type AdjustmentView, type CountSheetRow
} from '../industry/adjustments-api.ts';
import { worksApi, type JobSummaryView } from '../industry/works-api.ts';
import { reverseDefaultDate } from '../industry/ReverseModal.tsx';
import { printDocument } from '../industry/printing.ts';
import { CountSaver, costFor, fromSession, nothingToCount, useLeaveGuard, type CountSessionView, type SaveState } from '../industry/count-session.ts';
import { brandLabel, brandsApi, categoriesApi, categoryLabel, inCategory } from '../industry/categories-api.ts';
import { CategoryOptions } from '../industry/CatalogPickers.tsx';
import type { CountScope } from '../industry/adjustments-api.ts';
import { UnitPicker } from '../industry/UnitPicker.tsx';
import { baseQty, inUnits, type LineUnit } from '../industry/units.ts';
import { BatchInFields, BatchPick } from '../industry/BatchFields.tsx';

/**
 * تسوية المخزون — stock adjustments (damaged, lost, expired, used, issued to a job) and the stock count.
 * Routes: stock-adjustments, new-stock-adjustment, edit-stock-adjustment/:id, stock-adjustment/:id, stock-count.
 */

const reasonKey = (r: AdjustmentReason) => `adj_r_${r}` as Key;

function useActiveWarehouses() {
  const warehouses = useLoad(() => api.warehouses(), []);
  return (warehouses.data ?? []).filter((w) => w.active);
}

// ——— list ———

export function StockAdjustments() {
  const i18n = useI18n();
  const { t } = i18n;
  const [reason, setReason] = useState<AdjustmentReason | ''>('');
  const [status, setStatus] = useState<'' | 'draft' | 'posted' | 'cancelled'>('');
  // 1.4: what went out and came in is worth is not sent to someone who may not see cost: no such columns
  const cost = useData().seesCost !== false;
  const { data, error } = useLoad(() => adjustmentsApi.list({ ...(reason ? { reason } : {}), ...(status ? { status } : {}) }), [reason, status]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('adj_help')}</p>
      <div className="row">
        <a className="btn primary" href={href('new-stock-adjustment')}><Icon name="plus" size={16} />{t('adj_new')}</a>
        <a className="btn" href={href('stock-count')}><Icon name="rows" size={16} />{t('adj_count')}</a>
        <button type="button" className="btn" onClick={() => setSettingsOpen(true)}><Icon name="gear" size={16} />{t('adj_settings')}</button>
        <span className="spacer" />
        <select className="input" style={{ width: 'auto' }} value={reason} onChange={(e) => setReason(e.target.value as AdjustmentReason | '')} aria-label={t('adj_reason')}>
          <option value="">{t('adj_reason')}: {t('all')}</option>
          {ADJUSTMENT_REASONS.map((r) => <option key={r} value={r}>{t(reasonKey(r))}</option>)}
        </select>
        <div className="track">
          {(['', 'draft', 'posted', 'cancelled'] as const).map((s) => (
            <button key={s || 'all'} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s ? t(s) : t('all')}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {data && (data.length === 0 ? <p className="muted" style={{ padding: '14px 16px', margin: 0 }}>{t('adj_none')}</p> : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('colNumber')}</th><th>{t('colDate')}</th><th>{t('adj_reason')}</th><th>{t('warehouse')}</th>
                {cost && <th className="amount">{t('adj_valueOut')}</th>}{cost && <th className="amount">{t('adj_valueIn')}</th>}<th>{t('colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} className="click" onClick={() => go(`stock-adjustment/${d.id}`)}>
                  <td>{d.number ? <a href={href(`stock-adjustment/${d.id}`)} className="ltr num" onClick={(e) => e.stopPropagation()}>{d.number}</a> : <span className="muted">{t('draft')}</span>}</td>
                  <td className="num">{i18n.date(d.date)}</td>
                  <td>{t(reasonKey(d.reason))}{d.job && <span className="muted small"> · <span className="ltr">{d.job.number}</span></span>}</td>
                  <td>{i18n.name(d.warehouseName)}</td>
                  {cost && <td className="amount">{d.valueOut ? i18n.money(d.valueOut, 'IQD') : ''}</td>}
                  {cost && <td className="amount">{d.valueIn ? i18n.money(d.valueIn, 'IQD') : ''}</td>}
                  <td><InvoiceStatusChip status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      {settingsOpen && <AccountsSettings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

const SETTING_KEYS: { key: keyof AdjustmentAccounts; label: Key }[] = [
  { key: 'damaged', label: 'adj_r_damaged' }, { key: 'lost', label: 'adj_r_lost' }, { key: 'expired', label: 'adj_r_expired' },
  { key: 'internal_use', label: 'adj_r_internal_use' }, { key: 'job', label: 'adj_r_job' }, { key: 'other', label: 'adj_r_other' },
  { key: 'count', label: 'adj_countShortage' }, { key: 'gain', label: 'adj_gainAccount' }
];

function AccountsSettings({ onClose }: { onClose(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [accounts, setAccounts] = useState<AdjustmentAccounts | null>(null);
  const [defaults, setDefaults] = useState<AdjustmentAccounts | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    adjustmentsApi.settings().then((s) => { setAccounts(s.accounts); setDefaults(s.defaults); }, setError);
  }, []);

  async function save() {
    if (!accounts) return;
    setBusy(true);
    setError(null);
    try {
      await adjustmentsApi.saveSettings(accounts);
      toast(t('saved'));
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('adj_settings')} onClose={onClose}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{t('adj_settingsHelp')}</p>
        {accounts && SETTING_KEYS.map(({ key, label }) => (
          <div className="field" key={key}>
            <span>{t(label)}</span>
            <AccountCombo value={accounts[key]} onChange={(code) => setAccounts({ ...accounts, [key]: code })} filter={(a) => !a.code.startsWith('13')} ariaLabel={t(label)} />
          </div>
        ))}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !accounts} onClick={save}>{busy ? t('saving') : t('save')}</button>
          {defaults && <button type="button" className="btn" onClick={() => setAccounts(defaults)}>{t('adj_restoreDefaults')}</button>}
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

// ——— editor ———

/**
 * qtyMilli: as typed in the line's unit (null: the base unit); unitCost: per that unit. Batches: a line going out may be
 * pinned to one batch (batchId, '' automatic: earliest expiry first); a line coming in names its batch and expiry.
 */
interface Row { key: number; itemId: string; dir: 'out' | 'in'; qtyMilli: number | null; unitCost: number | null; unit?: LineUnit; batchId?: string; batchNo?: string; expiry?: string }
let rowKey = 1;
const emptyRow = (dir: 'out' | 'in' = 'out'): Row => ({ key: rowKey++, itemId: '', dir, qtyMilli: 1000, unitCost: null });

/**
 * An editor line against the stock on hand, both in the item's base unit: the quantity typed in a box is that many
 * boxes (a quantity that is no whole thousandth of the base counts as 0 here; saving refuses it).
 */
export function stockAfter(item: Pick<ItemView, 'qtyMilli' | 'units'>, r: Pick<Row, 'dir' | 'qtyMilli' | 'unit'>): { short: boolean; after: number } {
  const base = baseQty(item, r.unit ?? null, r.qtyMilli ?? 0) ?? 0;
  return { short: r.dir === 'out' && base > item.qtyMilli, after: item.qtyMilli + (r.dir === 'out' ? -base : base) };
}

/** The batch part of an adjustment line as sent: out, the batch picked by hand (if any); in, its number and expiry date. */
export function adjustmentBatch(r: Pick<Row, 'dir' | 'batchId' | 'batchNo' | 'expiry'>): { batchId?: string; batchNo?: string; expiry?: string } {
  if (r.dir === 'out') return r.batchId ? { batchId: r.batchId } : {};
  return { ...(r.batchNo?.trim() ? { batchNo: r.batchNo.trim() } : {}), ...(r.expiry ? { expiry: r.expiry } : {}) };
}

/** A draft line coming in, valued as posting will: its cost is per the unit it was typed in. */
export function draftInValue(l: { qtyMilli: number; unitCost?: number | null; lineUnit: UnitCode | null; unitQtyMilli: number | null }): number | null {
  if (l.qtyMilli <= 0 || l.unitCost === null || l.unitCost === undefined) return null;
  return lineAmount(l.lineUnit && l.unitQtyMilli !== null ? l.unitQtyMilli : l.qtyMilli, l.unitCost);
}

/** A draft or posted count adjustment made by a count limited to some categories and brands says which. */
function CountScopeNote({ scope }: { scope: CountScope | null }) {
  const i18n = useI18n();
  const categories = useLoad(() => (scope ? categoriesApi.list() : Promise.resolve([])), [!!scope]);
  const brands = useLoad(() => (scope ? brandsApi.list() : Promise.resolve([])), [!!scope]);
  if (!scope) return null;
  const names = [
    ...scope.categoryIds.map((id) => categoryLabel(categories.data ?? [], id, i18n.name)),
    ...scope.brandIds.map((id) => brandLabel((brands.data ?? []).find((b) => b.id === id), i18n.lang))
  ].filter(Boolean).join(i18n.lang === 'en' ? ', ' : '، ');
  return <div className="alert info" role="status">{i18n.t('cs_limited', { s: names })}</div>;
}

export function StockAdjustmentEditor({ id }: { id?: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { reloadAccounts } = useData();
  const [savedId, setSavedId] = useState<string | undefined>(id);
  const [ready, setReady] = useState(!id);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [date, setDate] = useState(todayIso());
  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState<AdjustmentReason>('damaged');
  const [accountOverride, setAccountOverride] = useState<string | null>(null);
  const [jobId, setJobId] = useState('');
  const [notes, setNotes] = useState('');
  const [countScope, setCountScope] = useState<CountScope | null>(null);
  const [rows, setRows] = useState<Row[]>(() => [emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const active = useActiveWarehouses();
  const settings = useLoad(() => adjustmentsApi.settings(), []);
  const items = useLoad(() => api.items({ active: 'true', ...(warehouseId ? { warehouseId } : {}) }), [warehouseId]);
  // jobs come from Engineering works (Pro); without it there are none to pick
  const jobs = useLoad(() => worksApi.jobs({ status: 'open' }).catch((): JobSummaryView[] => []), []);

  useEffect(() => {
    if (!warehouseId && active[0]) setWarehouseId(active[0].id);
  }, [active, warehouseId]);

  useEffect(() => {
    if (!id) return;
    adjustmentsApi.get(id).then((d: AdjustmentView) => {
      if (!d.actions.includes('edit')) { go(`stock-adjustment/${d.id}`); return; }
      setDate(d.date);
      setWarehouseId(d.warehouseId);
      setReason(d.reason);
      setJobId(d.job?.id ?? '');
      setNotes(d.notes);
      setCountScope(d.countScope ?? null);
      setRows(d.lines.map((l) => ({
        key: rowKey++, itemId: l.itemId, dir: l.qtyMilli < 0 ? 'out' : 'in',
        qtyMilli: Math.abs(l.lineUnit && l.unitQtyMilli !== null ? l.unitQtyMilli : l.qtyMilli), unitCost: l.unitCost ?? null, unit: l.lineUnit,
        // a write-off draft's lines are pinned to their expired batches: they stay pinned when it is edited
        batchId: l.batchId ?? '', batchNo: l.batchNo ?? '', expiry: l.expiry ?? ''
      })));
      setReady(true);
    }, setLoadError);
  }, [id]);

  // the saved document's own account (when it differs from the reason's default) shows as an override
  useEffect(() => {
    if (!id || !settings.data) return;
    adjustmentsApi.get(id).then((d) => {
      if (d.accountCode !== settings.data!.accounts[d.reason]) setAccountOverride(d.accountCode);
    }, () => {});
  }, [id, settings.data]);

  const defaultAccount = settings.data?.accounts[reason] ?? '';
  const account = accountOverride ?? defaultAccount;
  const allowIn = reason !== 'job';

  const itemById = useMemo(() => new Map((items.data ?? []).map((it) => [it.id, it])), [items.data]);
  const itemOptions: PickOption[] = (items.data ?? []).filter((it) => it.trackStock).map((it) => ({
    id: it.id, code: it.code, label: i18n.name(it.name), search: `${it.name.ar} ${it.name.en} ${it.name.ku} ${it.barcode}`,
    hint: `${qtyText(i18n, it.qtyMilli)} ${unitName(i18n, it.unit)}`
  }));
  const jobOptions: PickOption[] = (jobs.data ?? []).map((j) => ({ id: j.id, code: j.number, label: j.title, hint: j.party.name, search: j.party.name }));

  const lines = rows.filter((r) => r.itemId);
  const valueOf = (r: Row) => {
    const it = itemById.get(r.itemId);
    if (!it) return 0;
    if (r.dir === 'in' && r.unitCost !== null) return lineAmount(r.qtyMilli ?? 0, r.unitCost);
    return lineAmount(baseQty(it, r.unit ?? null, r.qtyMilli ?? 0) ?? 0, averageCost(it.qtyMilli, it.value ?? 0));
  };
  const totalOut = lines.filter((r) => r.dir === 'out').reduce((s, r) => s + valueOf(r), 0);
  const totalIn = lines.filter((r) => r.dir === 'in').reduce((s, r) => s + valueOf(r), 0);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [emptyRow()]));
  function pickItem(key: number, itemId: string) {
    setRows((rs) => {
      const next = rs.map((r) => (r.key === key ? { ...r, itemId, batchId: '', batchNo: '', expiry: '' } : r));
      const last = next[next.length - 1];
      return last?.itemId ? [...next, emptyRow(last.dir)] : next;
    });
  }
  function changeReason(r: AdjustmentReason) {
    setReason(r);
    setAccountOverride(null);
    if (r !== 'job') setJobId('');
    if (r === 'job') setRows((rs) => rs.map((x) => ({ ...x, dir: 'out' })));
  }

  function input(): AdjustmentInput {
    return {
      date, warehouseId, reason, notes,
      ...(accountOverride && accountOverride !== defaultAccount ? { accountCode: accountOverride } : {}),
      ...(reason === 'job' && jobId ? { jobId } : {}),
      lines: lines.map((r) => ({
        itemId: r.itemId,
        qtyMilli: (r.dir === 'out' ? -1 : 1) * ((r.unit ? baseQty(itemById.get(r.itemId), r.unit, r.qtyMilli ?? 0) : r.qtyMilli) ?? 0),
        ...(r.unit ? { unit: r.unit, unitQtyMilli: (r.dir === 'out' ? -1 : 1) * (r.qtyMilli ?? 0) } : {}),
        ...(r.dir === 'in' && r.unitCost !== null ? { unitCost: r.unitCost } : {}),
        ...adjustmentBatch(r)
      }))
    };
  }

  async function save(post: boolean) {
    if (post && !window.confirm(t('adj_postConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      const body = input();
      const saved = savedId ? await adjustmentsApi.update(savedId, body) : await adjustmentsApi.create(body);
      setSavedId(saved.id);
      if (post) {
        await adjustmentsApi.post(saved.id, i18n.lang);
        await reloadAccounts();
        toast(t('a_post'));
      } else {
        toast(t('saved'));
      }
      go(`stock-adjustment/${saved.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <ErrorBox error={loadError} />;
  if (!ready) return null;

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <div className="card pad stack">
        <h2 style={{ fontSize: 18 }}>{savedId ? `${t('editTitle')} — ${t('adj_one')}` : t('adj_new')}</h2>
        <CountScopeNote scope={countScope} />
        <div className="field">
          <span>{t('adj_reason')}</span>
          <div className="track" style={{ flexWrap: 'wrap' }}>
            {ADJUSTMENT_REASONS.filter((r) => r !== 'count' || reason === 'count').map((r) => (
              <button key={r} type="button" aria-pressed={reason === r} onClick={() => changeReason(r)}>{t(reasonKey(r))}</button>
            ))}
          </div>
        </div>
        <div className="grid-3">
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field">
            <span>{t('warehouse')}</span>
            <select className="input" value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setRows((rs) => rs.map((r) => ({ ...r, batchId: '' }))); }}>
              {active.map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
            </select>
          </label>
          {reason === 'job' ? (
            <div className="field">
              <span>{t('adj_job')}</span>
              {jobOptions.length
                ? <SearchCombo value={jobId} options={jobOptions} onChange={setJobId} placeholder={t('adj_chooseJob')} ariaLabel={t('adj_job')} />
                : <span className="muted small">{t('adj_noJobs')}</span>}
            </div>
          ) : (
            <div className="field">
              <span>{t('adj_account')}</span>
              {settings.data && <AccountCombo value={account} onChange={setAccountOverride} filter={(a) => !a.code.startsWith('13')} ariaLabel={t('adj_account')} />}
              <span className="muted small">{t('adj_accountHint')}</span>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div style={{ padding: '14px 16px 8px' }}><h2>{t('adj_lines')}</h2></div>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th style={{ width: '34%' }}>{t('item')}</th>
              {allowIn && <th style={{ width: 150 }}>{t('adj_direction')}</th>}
              <th className="amount" style={{ width: 130 }}>{t('qty')}</th>
              <th className="amount" style={{ width: 170 }}>{t('unitCost')}</th>
              <th className="amount">{t('moveValue')}</th>
              <th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const it = itemById.get(r.itemId);
              const check = it ? stockAfter(it, r) : null;
              const short = !!check?.short;
              const avg = it ? averageCost(it.qtyMilli, it.value ?? 0) : 0;
              return (
                <tr key={r.key}>
                  <td className="muted num">{i18n.int(i + 1)}</td>
                  <td>
                    <SearchCombo value={r.itemId} options={itemOptions} onChange={(v) => pickItem(r.key, v)} placeholder={t('chooseItem')} ariaLabel={t('item')} />
                    {it && (
                      <div className="small" style={{ marginTop: 3, color: short ? 'var(--bad)' : undefined }}>
                        <span className={short ? '' : 'muted'}>{t('adj_onHand')}: {qtyText(i18n, it.qtyMilli)}</span>
                        <span className="muted"> · {t('adj_after')}: {qtyText(i18n, check!.after)}</span>
                      </div>
                    )}
                    {r.dir === 'out'
                      ? <BatchPick item={it} warehouseId={warehouseId} value={r.batchId ?? ''} onChange={(batchId) => update(r.key, { batchId })} />
                      : <BatchInFields item={it} batchNo={r.batchNo ?? ''} expiry={r.expiry ?? ''} date={date} onChange={(v) => update(r.key, v)} />}
                  </td>
                  {allowIn && (
                    <td>
                      <div className="track">
                        <button type="button" aria-pressed={r.dir === 'out'} onClick={() => update(r.key, { dir: 'out' })}>{t('adj_outShort')} −</button>
                        <button type="button" aria-pressed={r.dir === 'in'} onClick={() => update(r.key, { dir: 'in' })}>{t('adj_inShort')} +</button>
                      </div>
                    </td>
                  )}
                  <td>
                    <QtyInput value={r.qtyMilli} onChange={(v) => update(r.key, { qtyMilli: v })} ariaLabel={t('qty')} />
                    <UnitPicker item={it} value={r.unit ?? null} onChange={(unit) => update(r.key, { unit })} />
                  </td>
                  <td>
                    {r.dir === 'in'
                      ? <AmountInput value={r.unitCost} currency="IQD" onChange={(v) => update(r.key, { unitCost: v })} ariaLabel={t('unitCost')} />
                      : <div className="amount muted" title={t('adj_avgCost')}>{it ? i18n.money(avg, 'IQD') : ''}</div>}
                  </td>
                  <td className="amount" style={{ color: r.itemId ? (r.dir === 'out' ? 'var(--bad)' : 'var(--ok)') : undefined }}>
                    {r.itemId ? i18n.money(r.dir === 'out' ? -valueOf(r) : valueOf(r), 'IQD', { plus: true }) : ''}
                  </td>
                  <td><button type="button" className="btn icon danger" onClick={() => remove(r.key)} aria-label={t('removeLine')} title={t('removeLine')}><Icon name="x" size={16} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row" style={{ padding: '10px 16px 14px' }}>
          <button type="button" className="btn small" onClick={() => setRows((rs) => [...rs, emptyRow()])}><Icon name="plus" size={15} />{t('addLine')}</button>
          <span className="spacer" />
          <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
            {totalOut > 0 && <div className="totals"><span>{t('adj_valueOut')}</span><strong className="num">{i18n.money(totalOut, 'IQD')}</strong></div>}
            {totalIn > 0 && <div className="totals"><span>{t('adj_valueIn')}</span><strong className="num">{i18n.money(totalIn, 'IQD')}</strong></div>}
            {(totalOut > 0 || totalIn > 0) && <span className="muted small">{t('adj_estimate')}</span>}
          </div>
        </div>
        {allowIn && <p className="muted small" style={{ margin: 0, padding: '0 16px 14px' }}>{t('adj_costHint')}</p>}
      </div>

      <label className="field"><span>{t('notes')}</span><input className="input" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></label>

      <ErrorBox error={error} />
      <div className="row">
        <button type="button" className="btn primary" onClick={() => save(true)} disabled={busy || lines.length === 0}><Icon name="check" size={16} />{t('adj_post')}</button>
        <button type="button" className="btn" onClick={() => save(false)} disabled={busy || lines.length === 0}>{busy ? t('saving') : t('saveDraft')}</button>
        <button type="button" className="btn" onClick={() => history.back()}>{t('cancel')}</button>
      </div>
    </div>
  );
}

// ——— detail ———

export function StockAdjustmentDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, reloadAccounts, seesCost } = useData();
  // 1.4: the value of each line is not sent to someone who may not see cost: no such column, no totals
  const cost = seesCost !== false;
  const { data, error, reload } = useLoad(() => adjustmentsApi.get(id), [id]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelDate, setCancelDate] = useState(todayIso());

  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const d = data;
  const company = settings ? i18n.name(settings.companyName) : '';
  const hasIn = d.lines.some((l) => l.qtyMilli > 0);

  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await reloadAccounts();
      toast(message);
      setCancelling(false);
      reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t('confirmDelete'))) return;
    setBusy(true);
    try {
      await adjustmentsApi.remove(id);
      toast(t('a_delete'));
      go('stock-adjustments');
    } catch (e) {
      setActionError(e);
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <div className="row no-print">
        <button type="button" className="btn" onClick={() => history.back()}>{t('back')}</button>
        <span className="spacer" />
        {d.actions.includes('edit') && <a className="btn" href={href(`edit-stock-adjustment/${d.id}`)}>{t('actEdit')}</a>}
        {d.actions.includes('delete') && <button type="button" className="btn danger" disabled={busy} onClick={remove}>{t('actDelete')}</button>}
        {d.actions.includes('post') && (
          <button type="button" className="btn primary" disabled={busy} onClick={() => { if (window.confirm(t('adj_postConfirm'))) void act(() => adjustmentsApi.post(id, i18n.lang), t('a_post')); }}>
            <Icon name="check" size={16} />{t('adj_post')}
          </button>
        )}
        {d.actions.includes('cancel') && <button type="button" className="btn danger" disabled={busy} onClick={() => { setCancelDate(reverseDefaultDate(d.date)); setCancelling(true); }}><Icon name="undo" size={16} />{t('adj_cancel')}</button>}
        <button type="button" className="btn" onClick={() => void printDocument('voucher')}><Icon name="printer" size={16} />{t('print')}</button>
      </div>
      <ErrorBox error={cancelling ? null : actionError} />
      {d.status === 'posted' && <div className="alert info no-print">{t('adj_postedNote')}</div>}

      <div className="paper">
        <div className="paper-head">
          <div style={{ flex: 1 }}>
            <div className="company-line">{company}</div>
            <div className="paper-title">{t('adj_one')} — {t(reasonKey(d.reason))}</div>
            <div style={{ marginTop: 4 }} className="no-print"><InvoiceStatusChip status={d.status} /></div>
            {d.status === 'cancelled' && <div className="print-only" style={{ color: 'var(--bad)', fontWeight: 700 }}>{t('cancelled')}</div>}
          </div>
          <div className="paper-meta">
            <span className="muted">{t('number')}</span><strong className="ltr">{d.number ?? t('draft')}</strong>
            <span className="muted">{t('date')}</span><strong className="num">{i18n.date(d.date)}</strong>
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: 14 }}>
          <div>
            <div className="muted small">{t('warehouse')}</div>
            <div style={{ fontWeight: 700 }}>{i18n.name(d.warehouseName)}</div>
          </div>
          <div>
            {d.job ? (
              <><div className="muted small">{t('adj_job')}</div><div><span className="ltr">{d.job.number}</span> — {d.job.title}</div></>
            ) : (
              <><div className="muted small">{t('adj_account')}</div><div><span className="tree-code">{d.accountCode}</span> {d.accountName ? i18n.name(d.accountName) : ''}</div></>
            )}
            {hasIn && <div className="muted small" style={{ marginTop: 4 }}>{t('adj_gainAccount')}: <span className="tree-code">{d.gainAccountCode}</span></div>}
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th><th style={{ width: 90 }}>{t('code')}</th><th>{t('item')}</th>
              <th>{t('adj_direction')}</th><th className="amount">{t('qty')}</th>{cost && <th className="amount">{t('moveValue')}</th>}
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.seq}>
                <td className="num">{i18n.int(l.seq)}</td>
                <td><span className="ltr">{l.itemCode}</span></td>
                <td>{i18n.name(l.itemName)}</td>
                <td><span className={`chip ${l.qtyMilli < 0 ? 'bad' : 'ok'}`}>{l.qtyMilli < 0 ? t('adj_outShort') : t('adj_inShort')}</span></td>
                <td className="amount">
                  {l.lineUnit && l.unitQtyMilli !== null
                    ? <>{qtyText(i18n, Math.abs(l.unitQtyMilli))} <span className="muted small">{unitName(i18n, l.lineUnit)}</span></>
                    : <>{qtyText(i18n, Math.abs(l.qtyMilli))} <span className="muted small">{unitName(i18n, l.unit)}</span></>}
                </td>
                {cost && (
                  <td className="amount">
                    {l.value !== null && l.value !== undefined ? i18n.money(Math.abs(l.value), 'IQD') : (() => { const v = draftInValue(l); return v === null ? '' : i18n.money(v, 'IQD'); })()}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {cost && d.status !== 'draft' && (
            <tfoot>
              {(d.valueOut ?? 0) > 0 && <tr><td colSpan={5}>{t('adj_valueOut')}</td><td className="amount">{i18n.money(d.valueOut ?? 0, 'IQD')}</td></tr>}
              {(d.valueIn ?? 0) > 0 && <tr><td colSpan={5}>{t('adj_valueIn')}</td><td className="amount">{i18n.money(d.valueIn ?? 0, 'IQD')}</td></tr>}
            </tfoot>
          )}
        </table>
        {d.notes && <p className="small"><span className="muted">{t('notes')}: </span>{d.notes}</p>}
        <CountScopeNote scope={d.countScope ?? null} />
        <div className="sigs" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div className="sig done"><div className="muted small">{t('preparedBy')}</div><div className="who">{d.createdBy}</div></div>
          <div className="sig"><div className="muted small">{t('warehouse')}</div><div className="who">&nbsp;</div></div>
        </div>
      </div>

      {(d.entry || d.reversal) && (
        <div className="card pad no-print row">
          {d.entry && <span>{t('postingEntry')}: <a href={href(`entry/${d.entry.id}`)} className="ltr">{d.entry.number}</a></span>}
          {d.reversal && <span>· {t('cancelEntry')}: <a href={href(`entry/${d.reversal.id}`)} className="ltr">{d.reversal.number}</a></span>}
        </div>
      )}

      {cancelling && (
        <Modal title={t('adj_cancel')} onClose={() => setCancelling(false)}>
          <div className="stack">
            <p style={{ margin: 0 }}>{t('adj_cancelHelp')}</p>
            <label className="field"><span>{t('cancelDate')}</span><input className="input" type="date" min={d.date} value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} /></label>
            <ErrorBox error={actionError} />
            <div className="row">
              <button type="button" className="btn danger" disabled={busy} onClick={() => act(() => adjustmentsApi.cancel(id, cancelDate), t('a_cancel'))}>{t('confirm')}</button>
              <button type="button" className="btn" onClick={() => setCancelling(false)}>{t('cancel')}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ——— stock count ———

/** The day of a moment on this PC's calendar (the server keeps UTC times). */
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * The count is kept on the server as it is typed (count-session.ts): leaving the page and coming back, or another PC
 * opening the same warehouse, carries on where it stopped. Each item's book quantity is frozen when it is first
 * counted, so what is sold meanwhile is not taken for a surplus.
 */
const NO_ROWS: CountSheetRow[] = [];

export function StockCount() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const active = useActiveWarehouses();
  const [warehouseId, setWarehouseId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [counted, setCounted] = useState<Map<string, number>>(new Map());
  // unit costs for surpluses of items the books show none of (their average cost is unknown)
  const [costs, setCosts] = useState<Map<string, number>>(new Map());
  // the book quantity the server froze when each item was first counted
  const [frozen, setFrozen] = useState<Map<string, number>>(new Map());
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'all' | 'counted' | 'diff'>('all');
  const [full, setFull] = useState(false);
  const [notes, setNotes] = useState('');
  const [pasting, setPasting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [resumed, setResumed] = useState<CountSessionView | null>(null);
  const [ready, setReady] = useState(false);
  // bumped when the count was closed on another PC: the warehouse's count is read again
  const [reopen, setReopen] = useState(0);
  const scanRef = useRef<HTMLInputElement>(null);
  const saverRef = useRef<CountSaver | null>(null);
  // 1.1: a count limited to some categories and brands, chosen before it starts; an open count keeps its own
  const categories = useLoad(() => categoriesApi.list(), []);
  const brands = useLoad(() => brandsApi.list(), []);
  const [scope, setScope] = useState<CountScope>({ categoryIds: [], brandIds: [] });
  const [sessionScope, setSessionScope] = useState<CountScope | null>(null);
  const scopeRef = useRef<CountScope>(scope);
  scopeRef.current = scope;

  useEffect(() => {
    if (!warehouseId && active[0]) setWarehouseId(active[0].id);
  }, [active, warehouseId]);
  // the sheet says which warehouse it is of: while another one loads, the last one's quantities are never used
  const sheet = useLoad(() => (warehouseId ? adjustmentsApi.countSheet(warehouseId) : Promise.resolve([] as CountSheetRow[])).then((list) => ({ warehouseId, rows: list })), [warehouseId]);

  /** A fresh count of the warehouse, or the one still open there. */
  function openSaver(session: CountSessionView | null) {
    saverRef.current?.dispose();
    const f = session ? fromSession(session) : { counted: new Map<string, number>(), costs: new Map<string, number>(), frozen: new Map<string, number>() };
    setCounted(f.counted);
    setCosts(f.costs);
    setFrozen(f.frozen);
    setResumed(session && session.lines.length ? session : null);
    setSessionScope(session?.scope ?? null);
    const meta = session ? { date: session.date, notes: session.notes, full: session.full } : { date, notes, full };
    if (session) { setDate(session.date); setNotes(session.notes); setFull(session.full); }
    setSaveState('saved');
    // an old saver (another warehouse, or a count already finished) may still answer: only the current one is heard
    const saver: CountSaver = new CountSaver(
      {
        // a new count takes the scope chosen when it starts
        start: (body) => adjustmentsApi.startCount({ ...body, ...(scopeRef.current.categoryIds.length || scopeRef.current.brandIds.length ? { scope: scopeRef.current } : {}) }),
        save: adjustmentsApi.saveCount
      }, warehouseId, meta,
      {
        saved: (s) => { if (saverRef.current === saver) { setFrozen(fromSession(s).frozen); setSessionScope(s.scope ?? null); } },
        state: (state) => { if (saverRef.current === saver) setSaveState(state); },
        closed: () => {
          if (saverRef.current !== saver) return;
          setMessage(t('adj_countClosedElsewhere'));
          setReopen((n) => n + 1);
          sheet.reload();
        }
      },
      session?.id ?? null
    );
    saver.frozen = f.frozen;
    saverRef.current = saver;
  }

  useEffect(() => {
    if (!warehouseId) return;
    let live = true;
    setReady(false);
    saverRef.current?.dispose();
    saverRef.current = null;
    adjustmentsApi.openCount(warehouseId).then((session) => {
      if (!live) return;
      openSaver(session);
      setReady(true);
    }, (e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [warehouseId, reopen]);
  // leaving the page: what is still waiting goes to the server
  useEffect(() => () => saverRef.current?.dispose(), []);
  useLeaveGuard(() => !!saverRef.current?.dirty, t('adj_leaveCount'));

  const catList = categories.data ?? [];
  // the count's own scope once it started, else the one chosen for it
  const limit = sessionScope ?? (scope.categoryIds.length || scope.brandIds.length ? scope : null);
  const inLimit = (r: CountSheetRow) => !limit
    || ((!limit.categoryIds.length || limit.categoryIds.some((c) => inCategory(catList, r.categoryId, c))) && (!limit.brandIds.length || limit.brandIds.includes(r.brandId ?? '')));
  const allRows = sheet.data && sheet.data.warehouseId === warehouseId ? sheet.data.rows : NO_ROWS;
  const rows = useMemo(() => (limit ? allRows.filter(inLimit) : allRows), [allRows, limit, catList]);
  // the scope can be chosen only before anything of the count is on the server
  const scopeOpen = ready && !sessionScope && !saverRef.current?.sessionId && counted.size === 0;
  const scopeText = (s: CountScope) => [
    ...s.categoryIds.map((id) => categoryLabel(catList, id, i18n.name)),
    ...s.brandIds.map((id) => brandLabel((brands.data ?? []).find((b) => b.id === id), i18n.lang))
  ].filter(Boolean).join(i18n.lang === 'en' ? ', ' : '، ');
  const byCode = useMemo(() => {
    const m = new Map<string, CountSheetRow>();
    for (const r of rows) {
      m.set(r.code.trim().toUpperCase(), r);
      if (r.barcode) m.set(r.barcode.trim().toUpperCase(), r);
    }
    return m;
  }, [rows]);

  const bookOf = (r: CountSheetRow) => frozen.get(r.itemId) ?? r.stockMilli;
  const countedOf = (r: CountSheetRow) => counted.get(r.itemId) ?? (full ? 0 : null);
  const diffOf = (r: CountSheetRow) => {
    const c = countedOf(r);
    return c === null ? null : c - bookOf(r);
  };
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (q && !`${r.code} ${r.barcode} ${r.name.ar} ${r.name.en} ${r.name.ku}`.toLowerCase().includes(q)) return false;
    if (view === 'counted' && !counted.has(r.itemId)) return false;
    if (view === 'diff' && !diffOf(r)) return false;
    return true;
  });
  const differences = rows.filter((r) => !!diffOf(r)).length;

  /**
   * Sends one item's count (and its cost, for a surplus) on its way to the server, against the book quantity the
   * current saver froze for its own warehouse (or this warehouse's sheet for an item not counted before).
   */
  function queue(itemId: string, v: number | null, typedCost?: number | null) {
    // a cost just cleared (null) goes as no cost, never as the one kept before it
    const cost = costFor(costs, itemId, typedCost);
    saverRef.current?.count(itemId, v, cost, rows.find((r) => r.itemId === itemId)?.stockMilli);
  }

  function applyCounts(next: Map<string, number>, changed: Iterable<string>) {
    setCounted(next);
    for (const itemId of changed) queue(itemId, next.get(itemId) ?? null);
  }

  const setOne = (itemId: string, v: number | null) => {
    const next = new Map(counted);
    if (v === null) next.delete(itemId); else next.set(itemId, v);
    applyCounts(next, [itemId]);
  };

  const setCost = (itemId: string, v: number | null) => {
    const next = new Map(costs);
    if (v === null) next.delete(itemId); else next.set(itemId, v);
    setCosts(next);
    queue(itemId, counted.get(itemId) ?? null, v);
  };

  function setMeta(patch: { date?: string; notes?: string; full?: boolean }) {
    if (patch.date !== undefined) setDate(patch.date);
    if (patch.notes !== undefined) setNotes(patch.notes);
    if (patch.full !== undefined) setFull(patch.full);
    saverRef.current?.setMeta(patch);
  }

  /** A scanner types the code and Enter: one more of that item. */
  function scan() {
    const hit = byCode.get(query.trim().toUpperCase());
    if (!hit) return;
    setOne(hit.itemId, (counted.get(hit.itemId) ?? 0) + 1000);
    setQuery('');
    scanRef.current?.focus();
  }

  function applyText(text: string) {
    const parsed = parseCountText(text);
    if (!Array.isArray(parsed)) { setMessage(t('adj_badRow', { n: parsed.badRow })); return; }
    const unknown: string[] = [];
    const next = new Map(counted);
    const changed = new Set<string>();
    for (const p of parsed) {
      const hit = byCode.get(p.code.trim().toUpperCase());
      if (!hit) { unknown.push(p.code); continue; }
      next.set(hit.itemId, (next.get(hit.itemId) ?? 0) + p.countedMilli);
      changed.add(hit.itemId);
    }
    applyCounts(next, changed);
    setMessage([t('adj_applied', { n: parsed.length }), unknown.length ? t('adj_unknownCodes', { c: unknown.slice(0, 20).join(', ') }) : ''].filter(Boolean).join(' '));
    setPasting(false);
  }

  function exportSheet() {
    downloadCsv(`count-sheet-${date}.csv`, [
      ['code', 'barcode', 'name', 'books', 'counted'],
      ...rows.map((r) => [r.code, r.barcode, i18n.name(r.name), bookOf(r) / 1000, ''])
    ]);
  }

  async function makeDraft() {
    const saver = saverRef.current;
    if (!saver) return;
    // nothing counted and not "count all": nothing to finish, so no count is started on the server for it
    if (nothingToCount(full, counted)) { setMessage(t('adj_nothingCounted')); return; }
    setBusy(true);
    setError(null);
    try {
      // a full count with nothing typed still needs its session on the server
      if (!saver.sessionId) saver.setMeta({ full });
      await saver.flush();
      const result = await adjustmentsApi.finishCount(saver.sessionId!);
      openSaver(null);
      if (result.adjustment) {
        toast(t('saved'));
        go(`stock-adjustment/${result.adjustment.id}`);
      } else {
        setMessage(t('adj_noDifferences'));
      }
    } catch (e) {
      // closed on another PC: the page has said so and reads the warehouse again
      if (saver.state !== 'closed') setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    const saver = saverRef.current;
    if (!saver || !window.confirm(t('adj_discardCountQ'))) return;
    setBusy(true);
    setError(null);
    try {
      await saver.flush().catch(() => {});
      // closed on another PC meanwhile: the page has said so and reads the warehouse again
      if (saver.state === 'closed') return;
      if (saver.sessionId) await adjustmentsApi.discardCount(saver.sessionId);
      openSaver(null);
      setMessage('');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const saveText = saveState === 'closed' ? t('adj_countClosedElsewhere') : saveState === 'saving' ? t('adj_countSaving') : saveState === 'pending' ? t('adj_countUnsaved') : saveState === 'error' ? t('adj_countSaveFailed') : t('adj_countSaved');

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <div className="card pad stack">
        <h2 style={{ fontSize: 18 }}>{t('adj_count')}</h2>
        <p className="muted" style={{ margin: 0 }}>{t('adj_countHelp')} {t('adj_countKept')}</p>
        <div className="grid-3">
          <label className="field">
            <span>{t('warehouse')}</span>
            <select className="input" value={warehouseId} disabled={busy} onChange={(e) => { if (!saverRef.current?.dirty || window.confirm(t('adj_leaveCount'))) setWarehouseId(e.target.value); }}>
              {active.map((w) => <option key={w.id} value={w.id}>{i18n.name(w.name)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} disabled={!ready} onChange={(e) => setMeta({ date: e.target.value })} /></label>
          <label className="field"><span>{t('notes')}</span><input className="input" value={notes} maxLength={500} disabled={!ready} onChange={(e) => setMeta({ notes: e.target.value })} /></label>
        </div>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={full} disabled={!ready} onChange={(e) => setMeta({ full: e.target.checked })} />
          <span>{t('adj_full')}</span>
        </label>
        {scopeOpen && ((categories.data?.length ?? 0) > 0 || (brands.data?.length ?? 0) > 0) && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="small"><strong>{t('cs_limit')}</strong> <span className="muted">{t('cs_limitHelp')}</span></span>
            <div className="row">
              {(categories.data?.length ?? 0) > 0 && (
                <select className="input" style={{ width: 220 }} value="" aria-label={t('cs_addCategory')}
                  onChange={(e) => { const v = e.target.value; if (v) setScope((s) => ({ ...s, categoryIds: s.categoryIds.includes(v) ? s.categoryIds : [...s.categoryIds, v].slice(0, 50) })); }}>
                  <option value="">{t('cs_addCategory')}</option>
                  <CategoryOptions list={catList} />
                </select>
              )}
              {(brands.data?.length ?? 0) > 0 && (
                <select className="input" style={{ width: 200 }} value="" aria-label={t('cs_addBrand')}
                  onChange={(e) => { const v = e.target.value; if (v) setScope((s) => ({ ...s, brandIds: s.brandIds.includes(v) ? s.brandIds : [...s.brandIds, v].slice(0, 50) })); }}>
                  <option value="">{t('cs_addBrand')}</option>
                  {(brands.data ?? []).filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{brandLabel(b, i18n.lang)}</option>)}
                </select>
              )}
              {[...scope.categoryIds.map((id) => ({ id, kind: 'c' as const })), ...scope.brandIds.map((id) => ({ id, kind: 'b' as const }))].map((x) => (
                <button key={x.kind + x.id} type="button" className="chip" aria-label={t('un_remove')}
                  onClick={() => setScope((s) => (x.kind === 'c' ? { ...s, categoryIds: s.categoryIds.filter((i) => i !== x.id) } : { ...s, brandIds: s.brandIds.filter((i) => i !== x.id) }))}>
                  <bdi>{x.kind === 'c' ? categoryLabel(catList, x.id, i18n.name) : brandLabel((brands.data ?? []).find((b) => b.id === x.id), i18n.lang)}</bdi> <Icon name="x" size={12} />
                </button>
              ))}
            </div>
          </div>
        )}
        {sessionScope && <div className="alert info" role="status">{t('cs_limited', { s: scopeText(sessionScope) })}</div>}
        {resumed && (
          <div className="alert info" role="status">
            {t('adj_countResumed', { who: resumed.updatedBy, when: i18n.date(localDay(resumed.updatedAt)), n: String(resumed.lines.length) })}
          </div>
        )}
      </div>

      <div className="row no-print">
        <input
          ref={scanRef} className="input" style={{ maxWidth: 340 }} value={query} placeholder={t('adj_searchCount')} aria-label={t('adj_searchCount')}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (ready) scan(); } }}
        />
        <div className="track">
          <button type="button" aria-pressed={view === 'all'} onClick={() => setView('all')}>{t('all')}</button>
          <button type="button" aria-pressed={view === 'counted'} onClick={() => setView('counted')}>{t('adj_onlyCounted')}</button>
          <button type="button" aria-pressed={view === 'diff'} onClick={() => setView('diff')}>{t('adj_onlyDiff')}</button>
        </div>
        <span className="spacer" />
        <button type="button" className="btn" disabled={!ready} onClick={() => setPasting(true)}><Icon name="upload" size={16} />{t('adj_paste')}</button>
        <button type="button" className="btn" onClick={exportSheet} disabled={!rows.length}><Icon name="download" size={16} />{t('adj_exportSheet')}</button>
        <button type="button" className="btn" onClick={() => void printDocument('report')}><Icon name="printer" size={16} />{t('adj_printSheet')}</button>
      </div>
      {message && <div className="alert info">{message}</div>}
      <ErrorBox error={sheet.error ?? error} />

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 100 }}>{t('code')}</th><th>{t('item')}</th>
              <th className="amount" title={t('adj_frozenHelp')}>{t('adj_books')}</th><th className="amount" style={{ width: 150 }}>{t('adj_counted')}</th><th className="amount">{t('adj_difference')}</th>
              <th className="amount" style={{ width: 170 }} title={t('adj_countCostHelp')}>{t('unitCost')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const diff = diffOf(r);
              const book = bookOf(r);
              const moved = frozen.has(r.itemId) && book !== r.stockMilli;
              return (
                <tr key={r.itemId}>
                  <td><span className="ltr">{r.code}</span></td>
                  <td>{i18n.name(r.name)} <span className="muted small">{unitName(i18n, r.unit)}</span></td>
                  <td className="amount" title={moved ? t('adj_frozenNow', { n: qtyText(i18n, r.stockMilli) }) : undefined}>
                    {qtyText(i18n, book)}{moved && <span className="muted small"> *</span>}
                    {(r.units?.length ?? 0) > 0 && book > 0 && <div className="muted small">{inUnits(i18n, { unit: r.unit, units: r.units ?? [] }, book)}</div>}
                  </td>
                  <td><QtyInput value={counted.get(r.itemId) ?? null} onChange={(v) => { if (ready) setOne(r.itemId, v); }} ariaLabel={`${t('adj_counted')} ${r.code}`} /></td>
                  <td className="amount" style={{ color: diff ? (diff < 0 ? 'var(--bad)' : 'var(--ok)') : undefined, fontWeight: diff ? 700 : undefined }}>
                    {diff === null ? '' : i18n.qty(diff, { plus: true })}
                  </td>
                  <td>{diff !== null && diff > 0 && book <= 0 && (
                    <AmountInput value={costs.get(r.itemId) ?? null} currency="IQD" ariaLabel={`${t('unitCost')} ${r.code}`} onChange={(v) => setCost(r.itemId, v)} />
                  )}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="row no-print">
        <button type="button" className="btn primary" disabled={busy || !ready || (!full && counted.size === 0)} onClick={makeDraft}><Icon name="check" size={16} />{t('adj_makeDraft')}</button>
        <span className="muted">{t('adj_countedSummary', { n: counted.size })} · {t('adj_diffSummary', { n: differences })}</span>
        <span className={'small' + (saveState === 'error' ? '' : ' muted')} style={saveState === 'error' ? { color: 'var(--bad)', fontWeight: 600 } : undefined} role="status" aria-live="polite">{saveText}</span>
        <span className="spacer" />
        <button type="button" className="btn" disabled={busy || !ready || (!saverRef.current?.sessionId && counted.size === 0)} onClick={() => void discard()}>{t('adj_discardCount')}</button>
        <button type="button" className="btn" onClick={() => history.back()}>{t('back')}</button>
      </div>

      {pasting && <PasteCounts onApply={applyText} onClose={() => setPasting(false)} />}
    </div>
  );
}

function PasteCounts({ onApply, onClose }: { onApply(text: string): void; onClose(): void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  async function readFile(file: File | undefined) {
    if (!file || file.size > 5_000_000) return;
    setText(await file.text());
  }
  return (
    <Modal title={t('adj_paste')} onClose={onClose}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{t('adj_pasteHelp')}</p>
        <textarea className="input ltr" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'PIPE-1, 12\n6260000000011, 4'} style={{ fontFamily: 'monospace' }} />
        <label className="btn" style={{ alignSelf: 'flex-start' }}>
          <Icon name="upload" size={16} />{t('adj_importCsv')}
          <input type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={(e) => void readFile(e.target.files?.[0])} />
        </label>
        <div className="row">
          <button type="button" className="btn primary" disabled={!text.trim()} onClick={() => onApply(text)}>{t('adj_apply')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}
