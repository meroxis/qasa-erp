import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { rateFromX100, rateToX100, todayIso, toWesternDigits, type CurrencyCode } from '@qasa/core';
import { api, ApiError, type GuarantorInput, type GuarantorView, type PartyView } from '../api.ts';
import { EmptyState, AccountCombo, AmountInput, ErrorBox, Icon, Modal, SearchCombo, useData, useLoad, usePageNav, useToast, type PickOption } from '../components.tsx';
import { useI18n, type I18n } from '../i18n.ts';
import {
  realEstateApi, UNIT_KINDS, type ReProjectDetail, type ReProjectView, type ReSummary, type ReUnitInput, type ReUnitView, type UnitKind, type UnitStatus
} from '../industry/real-estate-api.ts';
import { go, href } from '../router.ts';
import { UnitDeposits } from '../industry/RealEstateDeposits.tsx';

/**
 * العقارات (Business): projects and their units on a map — available, reserved for a customer, or sold — with reserving,
 * releasing and selling (cash, or by installments through the installment contracts). The API comes with the Pro
 * module; without it these pages say so.
 */

const STATUS_CHIP: Record<UnitStatus, string> = { available: 'ok', reserved: 'warn', sold: '' };

/** The colours of the map: green for available, amber and dashed for reserved, dark for sold. */
const TILE: Record<UnitStatus, CSSProperties> = {
  available: { background: 'var(--ok-bg)', color: 'var(--ok)', border: '1px solid var(--ok-stroke)' },
  reserved: { background: 'var(--warn-bg)', color: 'var(--warn)', border: '1px dashed var(--warn)' },
  sold: { background: 'var(--ink-2)', color: 'var(--surface)', border: '1px solid var(--ink-2)' }
};

const label = (u: Pick<ReUnitView, 'building' | 'code'>) => (u.building ? `${u.building}-${u.code}` : u.code);
const isMissing = (e: unknown) => e instanceof ApiError && e.status === 404 && e.code === 'not_found' && !(e.details as { what?: string } | null)?.what;
const area = (i18n: I18n, x100: number) => i18n.digitsOf((x100 / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const nextMonth = (iso: string) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
};

/** An Iraqi mobile number as WhatsApp wants it (9647…), or null. */
function whatsappNumber(phone: string): string | null {
  const d = toWesternDigits(phone).replace(/\D/g, '');
  if (/^9647\d{9}$/.test(d)) return d;
  if (/^07\d{9}$/.test(d)) return '964' + d.slice(1);
  if (/^7\d{9}$/.test(d)) return '964' + d;
  return null;
}

function NotAvailable() {
  const { t } = useI18n();
  return <div className="alert info">{t('re_official')}</div>;
}

function NeedsBusiness() {
  const { t } = useI18n();
  return <div className="alert">{t('re_needsBusiness')} <a href={href('plans')}>{t('planLicense')}</a></div>;
}

export function UnitStatusChip({ unit }: { unit: Pick<ReUnitView, 'status' | 'expired'> }) {
  const { t } = useI18n();
  if (unit.expired) return <span className="chip bad">{t('re_expired')}</span>;
  return <span className={'chip ' + STATUS_CHIP[unit.status]}>{t(`re_st_${unit.status}`)}</span>;
}

function Bar({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ blockSize: 6, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' }} aria-hidden="true">
      <div style={{ inlineSize: `${pct}%`, blockSize: '100%', background: 'var(--ok)' }} />
    </div>
  );
}

/* ---------- projects ---------- */

export function RealEstate() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [summary, setSummary] = useState<ReSummary | null>(null);
  const [absent, setAbsent] = useState(false);
  const [creating, setCreating] = useState(false);
  const { data, error } = useLoad(() => realEstateApi.projects(), []);

  useEffect(() => {
    realEstateApi.summary().then(setSummary, (e) => { if (e instanceof ApiError && e.status === 404) setAbsent(true); });
  }, []);
  if (absent) return <NotAvailable />;

  const money = (m: ReSummary['soldValue']) => (m.USD && m.IQD ? `${i18n.money(m.USD, 'USD')} · ${i18n.money(m.IQD, 'IQD')}` : m.USD ? i18n.money(m.USD, 'USD') : i18n.money(m.IQD, 'IQD'));

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('re_help')}</p>
      {summary && !summary.available && <NeedsBusiness />}
      {summary && (
        <div className="grid-4">
          <div className="card pad tile"><div className="label">{t('re_tileProjects')}</div><div className="value num">{i18n.int(summary.projects)}</div></div>
          <div className="card pad tile"><div className="label">{t('re_tileAvailable')}</div><div className="value num" style={{ color: 'var(--ok)' }}>{i18n.int(summary.counts.available)}</div><div className="small muted num">{money(summary.availableValue)}</div></div>
          <div className="card pad tile">
            <div className="label">{t('re_tileReserved')}</div><div className="value num" style={{ color: 'var(--warn)' }}>{i18n.int(summary.counts.reserved)}</div>
            {summary.expiredReservations > 0 && <div className="small num" style={{ color: 'var(--bad)' }}>{t('re_expiredCount', { n: i18n.int(summary.expiredReservations) })}</div>}
          </div>
          <div className="card pad tile"><div className="label">{t('re_tileSold')}</div><div className="value num">{i18n.int(summary.counts.sold)}</div><div className="small muted num">{money(summary.soldValue)}</div></div>
        </div>
      )}
      <div className="row">
        {summary?.available && <button type="button" className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />{t('re_newProject')}</button>}
      </div>
      <ErrorBox error={error} />
      {data && !data.length && <div className="card"><EmptyState icon="building" title={t('es_projects')} text={t('es_projectsText')} /></div>}
      {data && data.length > 0 && (
        <div className="grid-3">
          {data.map((p) => <ProjectCard key={p.id} project={p} />)}
        </div>
      )}
      {creating && (
        <ProjectModal onClose={() => setCreating(false)} onDone={(p) => { setCreating(false); toast(p.name); go(`real-estate-project/${p.id}`); }} />
      )}
    </div>
  );
}

function ProjectCard({ project: p }: { project: ReProjectView }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <div className="card pad tile" style={p.active ? undefined : { opacity: 0.6 }}>
      <div className="label"><span className="ico"><Icon name="building" size={18} /></span><a href={href(`real-estate-project/${p.id}`)}>{p.name}</a></div>
      <div className="small muted">{[p.code, p.city].filter(Boolean).join(' · ')}{!p.active && ` · ${t('inactive')}`}</div>
      <Bar value={p.counts.sold} total={p.counts.total} />
      <div className="row small" style={{ gap: 12 }}>
        <span><span className="chip ok">{i18n.int(p.counts.available)}</span></span>
        <span><span className="chip warn">{i18n.int(p.counts.reserved)}</span></span>
        <span><span className="chip">{i18n.int(p.counts.sold)}</span></span>
        <span className="spacer" />
        <span className="muted num">{i18n.int(p.counts.total)} {t('re_units')}</span>
      </div>
      <div className="small"><span className="muted">{t('re_soldValue')}:</span> <span className="num">{i18n.money(p.soldValue, p.currency)}</span></div>
      {p.expiredReservations > 0 && <div className="small" style={{ color: 'var(--bad)' }}>{t('re_expiredCount', { n: i18n.int(p.expiredReservations) })}</div>}
    </div>
  );
}

function ProjectModal({ project, onClose, onDone }: { project?: ReProjectDetail; onClose(): void; onDone(p: ReProjectDetail): void }) {
  const { t } = useI18n();
  const [code, setCode] = useState(project?.code ?? '');
  const [name, setName] = useState(project?.name ?? '');
  const [city, setCity] = useState(project?.city ?? '');
  const [address, setAddress] = useState(project?.address ?? '');
  const [currency, setCurrency] = useState<CurrencyCode>(project?.currency ?? 'USD');
  const [notes, setNotes] = useState(project?.notes ?? '');
  const [active, setActive] = useState(project?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body = { name, ...(city.trim() ? { city } : {}), ...(address.trim() ? { address } : {}), ...(notes.trim() ? { notes } : {}) };
      onDone(project ? await realEstateApi.updateProject(project.id, { ...body, active }) : await realEstateApi.createProject({ ...body, code, currency }));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={project ? t('re_editProject') : t('re_newProject')} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <label className="field"><span>{t('re_projectCode')}</span><input className="input ltr" maxLength={20} value={code} disabled={!!project} onChange={(e) => setCode(e.target.value)} /></label>
          <label className="field"><span>{t('re_projectName')}</span><input className="input" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>{t('re_city')}</span><input className="input" maxLength={100} value={city} onChange={(e) => setCity(e.target.value)} /></label>
          <label className="field">
            <span>{t('currency')}</span>
            <select className="input" value={currency} disabled={!!project} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
              <option value="USD">USD</option><option value="IQD">IQD</option>
            </select>
          </label>
        </div>
        {!project && <p className="muted small" style={{ margin: 0 }}>{t('re_projectCurrencyHelp')}</p>}
        <label className="field"><span>{t('address')}</span><input className="input" maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        <label className="field"><span>{t('notes')}</span><textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {project && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {t('re_projectActive')}</label>}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !name.trim() || !code.trim()} onClick={() => void submit()}>{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- one project: the unit map ---------- */

type Dialog = 'edit' | 'generate' | 'unit' | 'reserve' | 'release' | 'sell' | null;

export function RealEstateProject({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { reloadAccounts } = useData();
  const [summary, setSummary] = useState<ReSummary | null>(null);
  const { data, error, reload } = useLoad(() => realEstateApi.project(id), [id]);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<UnitStatus | ''>('');
  const [beds, setBeds] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  usePageNav(data ? { key: 're_title', group: 'gIndustry' } : null);

  useEffect(() => { realEstateApi.summary().then(setSummary, () => undefined); }, []);

  const unit = data?.units.find((u) => u.id === selected) ?? null;
  const bedroomOptions = useMemo(() => [...new Set((data?.units ?? []).map((u) => u.bedrooms))].sort((a, b) => a - b), [data]);
  // buildings, each with its floors from the top down
  const buildings = useMemo(() => {
    const map = new Map<string, Map<number, ReUnitView[]>>();
    for (const u of data?.units ?? []) {
      const floors = map.get(u.building) ?? new Map<number, ReUnitView[]>();
      floors.set(u.floor, [...(floors.get(u.floor) ?? []), u]);
      map.set(u.building, floors);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([building, floors]) => ({
      building, floors: [...floors.entries()].sort(([a], [b]) => b - a)
    }));
  }, [data]);

  if (error) return isMissing(error) ? <NotAvailable /> : <ErrorBox error={error} />;
  if (!data) return null;
  const p = data;

  const done = async (message?: string, keepSelection = true) => {
    setDialog(null);
    if (!keepSelection) setSelected(null);
    await reloadAccounts();
    if (message) toast(message);
    reload();
  };
  const matches = (u: ReUnitView) => (!status || u.status === status) && (beds === null || u.bedrooms === beds);

  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="btn" onClick={() => go('real-estate')}>{t('back')}</button>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{p.name}</div>
          <div className="small muted">{[p.code, p.city, p.address].filter(Boolean).join(' · ')} · {p.currency}</div>
        </div>
        <span className="spacer" />
        {p.actions.includes('addUnits') && <button type="button" className="btn primary" onClick={() => setDialog('generate')}><Icon name="plus" size={16} />{t('re_generate')}</button>}
        {p.actions.includes('edit') && <button type="button" className="btn" onClick={() => setDialog('edit')}><Icon name="edit" size={16} />{t('re_editProject')}</button>}
      </div>
      {summary && !summary.available && <NeedsBusiness />}

      <div className="grid-4">
        <div className="card pad tile"><div className="label">{t('re_tileAvailable')}</div><div className="value num" style={{ color: 'var(--ok)' }}>{i18n.int(p.counts.available)}</div><div className="small muted num">{i18n.money(p.availableValue, p.currency)}</div></div>
        <div className="card pad tile">
          <div className="label">{t('re_tileReserved')}</div><div className="value num" style={{ color: 'var(--warn)' }}>{i18n.int(p.counts.reserved)}</div>
          {p.expiredReservations > 0 && <div className="small num" style={{ color: 'var(--bad)' }}>{t('re_expiredCount', { n: i18n.int(p.expiredReservations) })}</div>}
        </div>
        <div className="card pad tile"><div className="label">{t('re_tileSold')}</div><div className="value num">{i18n.int(p.counts.sold)}</div><div className="small muted num">{i18n.money(p.soldValue, p.currency)}</div></div>
        <div className="card pad tile">
          <div className="label">{t('re_progress')}</div>
          <div className="value num">{p.counts.total ? i18n.int(Math.round((p.counts.sold / p.counts.total) * 100)) : i18n.int(0)}%</div>
          <Bar value={p.counts.sold} total={p.counts.total} />
        </div>
      </div>

      <div className="row">
        <div className="track">
          {(['', 'available', 'reserved', 'sold'] as const).map((s) => (
            <button key={s || 'all'} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s ? t(`re_st_${s}`) : t('re_allStatuses')}</button>
          ))}
        </div>
        {bedroomOptions.length > 1 && (
          <div className="track">
            <button type="button" aria-pressed={beds === null} onClick={() => setBeds(null)}>{t('re_anyBedrooms')}</button>
            {bedroomOptions.map((b) => <button key={b} type="button" aria-pressed={beds === b} onClick={() => setBeds(b)}>{t('re_bedroomsShort', { n: i18n.int(b) })}</button>)}
          </div>
        )}
        <span className="spacer" />
        <div className="row small" style={{ gap: 10 }} aria-label={t('re_legend')}>
          {(['available', 'reserved', 'sold'] as const).map((s) => (
            <span key={s} className="row" style={{ gap: 4 }}><span style={{ ...TILE[s], inlineSize: 14, blockSize: 14, borderRadius: 3, display: 'inline-block' }} />{t(`re_st_${s}`)}</span>
          ))}
        </div>
      </div>

      <div className="grid-aside">
        <div className="card pad stack">
          <div>
            <h2 style={{ margin: 0 }}>{t('re_unitMap')}</h2>
            <div className="small muted">{t('re_mapHelp')}</div>
          </div>
          {!p.units.length && <div className="muted">{t('re_noUnits')}</div>}
          {buildings.map(({ building, floors }) => (
            <div key={building || '-'} className="stack" style={{ gap: 6 }}>
              {building && <div style={{ fontWeight: 700 }}>{t('re_building')} {building}</div>}
              {floors.map(([floor, units]) => (
                <div key={floor} style={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', gap: 8, alignItems: 'stretch' }}>
                  <div className="small muted num" style={{ alignSelf: 'center' }}>{floor === 0 ? t('re_ground') : t('re_floorN', { n: i18n.int(floor) })}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 6 }}>
                    {units.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        aria-pressed={selected === u.id}
                        aria-label={`${t('re_unit')} ${label(u)}, ${t(`re_st_${u.status}`)}`}
                        onClick={() => setSelected(u.id)}
                        style={{
                          ...TILE[u.status], borderRadius: 'var(--r-md)', padding: '6px 8px', minBlockSize: 52, cursor: 'pointer', textAlign: 'start',
                          display: 'flex', flexDirection: 'column', gap: 2, font: 'inherit',
                          opacity: matches(u) ? 1 : 0.25,
                          outline: selected === u.id ? '2px solid var(--accent)' : undefined, outlineOffset: 2,
                          ...(u.expired ? { borderColor: 'var(--bad)' } : {})
                        }}
                      >
                        <span className="ltr" style={{ fontWeight: 700 }}>{u.code}</span>
                        <span className="small num" style={{ opacity: 0.85 }}>{u.bedrooms ? t('re_bedroomsShort', { n: i18n.int(u.bedrooms) }) + ' · ' : ''}{area(i18n, u.areaX100)} m²</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="card pad stack" style={{ position: 'sticky', insetBlockStart: 16 }}>
          {unit ? <UnitPanel unit={unit} project={p} onAction={setDialog} onChanged={() => void done()} /> : <div className="muted">{t('re_mapHelp')}</div>}
        </div>
      </div>

      {dialog === 'edit' && <ProjectModal project={p} onClose={() => setDialog(null)} onDone={() => void done()} />}
      {dialog === 'generate' && <GenerateModal project={p} onClose={() => setDialog(null)} onDone={(n) => void done(t('re_unitsAdded', { n: i18n.int(n) }))} />}
      {dialog === 'unit' && unit && <UnitModal unit={unit} currency={p.currency} onClose={() => setDialog(null)} onDone={(deleted) => void done(undefined, !deleted)} />}
      {dialog === 'reserve' && unit && <ReserveModal unit={unit} onClose={() => setDialog(null)} onDone={() => void done(t('re_reservedDone', { n: label(unit) }))} />}
      {dialog === 'release' && unit && <ReleaseModal unit={unit} onClose={() => setDialog(null)} onDone={() => void done(t('re_releasedDone', { n: label(unit) }))} />}
      {dialog === 'sell' && unit && <SellModal unit={unit} project={p} onClose={() => setDialog(null)} onDone={() => void done(t('re_saleDone', { n: label(unit) }))} />}
    </div>
  );
}

function UnitPanel({ unit: u, project: p, onAction, onChanged }: { unit: ReUnitView; project: ReProjectDetail; onAction(d: Dialog): void; onChanged(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const wa = u.party?.phone ? whatsappNumber(u.party.phone) : null;
  const rows: [string, string][] = [
    [t('re_kind'), t(`re_kind_${u.kind}`)],
    [t('re_floor'), u.floor === 0 ? t('re_ground') : i18n.int(u.floor)],
    ...(u.bedrooms ? [[t('re_bedrooms'), i18n.int(u.bedrooms)] as [string, string]] : []),
    [t('re_area'), area(i18n, u.areaX100)],
    ...(u.view ? [[t('re_view'), u.view] as [string, string]] : [])
  ];
  return (
    <>
      <div className="row">
        <div style={{ fontWeight: 700, fontSize: 22 }} className="ltr">{label(u)}</div>
        <span className="spacer" />
        <UnitStatusChip unit={u} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '6px 12px' }}>
        {rows.map(([k, v]) => <Fragment key={k}><span className="muted small">{k}</span><span className="num">{v}</span></Fragment>)}
      </div>
      <div className="row" style={{ borderBlockStart: '1px solid var(--line)', paddingBlockStart: 10 }}>
        <span className="muted small">{u.status === 'sold' && u.invoice ? t('re_agreedPrice') : t('re_askingPrice')}</span>
        <span className="spacer" />
        <strong className="num" style={{ fontSize: 18 }}>{i18n.money(u.status === 'sold' && u.invoice ? u.invoice.total : u.price, p.currency)}</strong>
      </div>
      {u.party && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="muted small">{u.status === 'sold' ? t('re_soldTo') : t('re_reservedFor')}</span>
          <a href={href(`party/${u.party.id}`)} style={{ fontWeight: 600 }}>{u.party.name}</a>
          {u.party.phone && <span className="small ltr">{i18n.digitsOf(u.party.phone)}{wa && <> · <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">{t('re_whatsapp')}</a></>}</span>}
          {u.reservedUntil && <span className="small">{t('re_reservedUntil')} <span className="num">{i18n.date(u.reservedUntil)}</span></span>}
        </div>
      )}
      {u.invoice && <div className="small"><span className="muted">{t('re_saleInvoice')}:</span> <a className="ltr" href={href(`invoice/${u.invoice.id}`)}>{u.invoice.number ?? '—'}</a>{u.invoice.status === 'cancelled' && <span className="chip bad" style={{ marginInlineStart: 6 }}>{t('cancelled')}</span>}</div>}
      {u.contract && <div className="small"><span className="muted">{t('re_installmentContract')}:</span> <a className="ltr" href={href(`installment/${u.contract.id}`)}>{u.contract.number}</a></div>}
      {u.notes && <div className="small muted">{u.notes}</div>}
      {u.status === 'sold' && !u.actions.includes('release') && <p className="small muted" style={{ margin: 0 }}>{t('re_soldUndoHelp')}</p>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {u.actions.includes('sell') && <button type="button" className="btn primary" onClick={() => onAction('sell')}><Icon name="check" size={16} />{t('re_sell')}</button>}
        {u.actions.includes('reserve') && <button type="button" className="btn" onClick={() => onAction('reserve')}><Icon name="cal" size={16} />{t('re_reserve')}</button>}
        {u.actions.includes('release') && <button type="button" className="btn" onClick={() => onAction('release')}><Icon name="undo" size={16} />{u.status === 'sold' ? t('re_releaseSold') : t('re_release')}</button>}
        {u.actions.includes('edit') && <button type="button" className="btn" onClick={() => onAction('unit')}><Icon name="edit" size={16} />{t('re_editUnit')}</button>}
      </div>
      {u.status === 'reserved' && u.depositHeld > 0 && !u.actions.includes('release') && <p className="small muted" style={{ margin: 0 }}>{t('dep_releaseHelp')}</p>}
      <UnitDeposits unit={u} currency={p.currency} onChanged={onChanged} />
    </>
  );
}

/* ---------- dialogs ---------- */

const digits = (s: string) => toWesternDigits(s).replace(/[^\d-]/g, '');
const areaX100Of = (s: string) => Math.round((Number(toWesternDigits(s).replace(/[^\d.]/g, '')) || 0) * 100);

function GenerateModal({ project: p, onClose, onDone }: { project: ReProjectDetail; onClose(): void; onDone(n: number): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [building, setBuilding] = useState('');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('10');
  const [letters, setLetters] = useState('A B C D');
  const [kind, setKind] = useState<UnitKind>('apartment');
  const [bedrooms, setBedrooms] = useState('2');
  const [areaText, setAreaText] = useState('120');
  const [price, setPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const list = useMemo<ReUnitInput[]>(() => {
    const a = Number(digits(from));
    const b = Number(digits(to));
    const codes = toWesternDigits(letters).split(/[\s,،]+/).map((s) => s.trim()).filter(Boolean);
    if (!Number.isInteger(a) || !Number.isInteger(b) || b < a || b - a > 200 || !codes.length) return [];
    const out: ReUnitInput[] = [];
    for (let floor = a; floor <= b; floor++) {
      for (const c of codes) {
        out.push({ ...(building.trim() ? { building: building.trim() } : {}), code: `${floor}${c}`, floor, kind, bedrooms: Number(digits(bedrooms)) || 0, areaX100: areaX100Of(areaText), price: price ?? 0 });
      }
    }
    return out;
  }, [building, from, to, letters, kind, bedrooms, areaText, price]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const added = await realEstateApi.addUnits(p.id, list);
      onDone(added.length);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={t('re_generate')} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('re_generateHelp')}</p>
        <div className="grid-3">
          <label className="field"><span>{t('re_building')}</span><input className="input ltr" maxLength={40} value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="A" /></label>
          <label className="field"><span>{t('re_floorFrom')}</span><input className="input num ltr" inputMode="numeric" value={from} onChange={(e) => setFrom(digits(e.target.value))} /></label>
          <label className="field"><span>{t('re_floorTo')}</span><input className="input num ltr" inputMode="numeric" value={to} onChange={(e) => setTo(digits(e.target.value))} /></label>
        </div>
        <p className="muted small" style={{ margin: 0 }}>{t('re_buildingHelp')}</p>
        <label className="field"><span>{t('re_letters')}</span><input className="input ltr" maxLength={100} value={letters} onChange={(e) => setLetters(e.target.value)} /></label>
        <div className="grid-2">
          <label className="field">
            <span>{t('re_kind')}</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as UnitKind)}>
              {UNIT_KINDS.map((k) => <option key={k} value={k}>{t(`re_kind_${k}`)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('re_bedrooms')}</span><input className="input num ltr" inputMode="numeric" value={bedrooms} onChange={(e) => setBedrooms(digits(e.target.value))} /></label>
          <label className="field"><span>{t('re_area')}</span><input className="input num ltr" inputMode="decimal" value={areaText} onChange={(e) => setAreaText(e.target.value)} /></label>
          <label className="field"><span>{t('re_askingPrice')}</span><AmountInput value={price} currency={p.currency} onChange={setPrice} ariaLabel={t('re_askingPrice')} /></label>
        </div>
        <div className="small">{t('re_willMake', { n: i18n.int(list.length) })}</div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !list.length || !price} onClick={() => void submit()}><Icon name="plus" size={16} />{t('re_generate')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function UnitModal({ unit: u, currency, onClose, onDone }: { unit: ReUnitView; currency: CurrencyCode; onClose(): void; onDone(deleted: boolean): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const sold = u.status === 'sold';
  const [building, setBuilding] = useState(u.building);
  const [code, setCode] = useState(u.code);
  const [floor, setFloor] = useState(String(u.floor));
  const [kind, setKind] = useState<UnitKind>(u.kind);
  const [bedrooms, setBedrooms] = useState(String(u.bedrooms));
  const [areaText, setAreaText] = useState(String(u.areaX100 / 100));
  const [price, setPrice] = useState<number | null>(u.price);
  const [view, setView] = useState(u.view);
  const [notes, setNotes] = useState(u.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(work: () => Promise<unknown>, deleted: boolean) {
    setBusy(true);
    setError(null);
    try {
      await work();
      onDone(deleted);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  const save = () => run(() => realEstateApi.updateUnit(u.id, {
    building, code, floor: Number(digits(floor)) || 0, kind, bedrooms: Number(digits(bedrooms)) || 0, areaX100: areaX100Of(areaText), price: price ?? 0,
    ...(view.trim() ? { view } : {}), ...(notes.trim() ? { notes } : {})
  }), false);
  const remove = () => { if (window.confirm(t('re_deleteConfirm', { n: label(u) }))) void run(() => realEstateApi.deleteUnit(u.id), true); };

  return (
    <Modal title={`${t('re_editUnit')} — ${label(u)}`} onClose={onClose}>
      <div className="stack">
        {sold && <p className="muted small" style={{ margin: 0 }}>{t('re_soldTermsHelp')}</p>}
        <div className="grid-3">
          <label className="field"><span>{t('re_building')}</span><input className="input ltr" maxLength={40} value={building} onChange={(e) => setBuilding(e.target.value)} /></label>
          <label className="field"><span>{t('code')}</span><input className="input ltr" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <label className="field"><span>{t('re_floor')}</span><input className="input num ltr" inputMode="numeric" value={floor} onChange={(e) => setFloor(digits(e.target.value))} /></label>
          <label className="field">
            <span>{t('re_kind')}</span>
            <select className="input" value={kind} disabled={sold} onChange={(e) => setKind(e.target.value as UnitKind)}>
              {UNIT_KINDS.map((k) => <option key={k} value={k}>{t(`re_kind_${k}`)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('re_bedrooms')}</span><input className="input num ltr" inputMode="numeric" value={bedrooms} onChange={(e) => setBedrooms(digits(e.target.value))} /></label>
          <label className="field"><span>{t('re_area')}</span><input className="input num ltr" inputMode="decimal" disabled={sold} value={areaText} onChange={(e) => setAreaText(e.target.value)} /></label>
        </div>
        <div className="grid-2">
          <label className="field"><span>{t('re_askingPrice')}</span>{sold ? <input className="input num" disabled value={i18n.money(u.price, currency)} /> : <AmountInput value={price} currency={currency} onChange={setPrice} ariaLabel={t('re_askingPrice')} />}</label>
          <label className="field"><span>{t('re_view')}</span><input className="input" maxLength={100} value={view} onChange={(e) => setView(e.target.value)} /></label>
        </div>
        <label className="field"><span>{t('notes')}</span><textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !code.trim()} onClick={() => void save()}>{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <span className="spacer" />
          {u.actions.includes('delete') && <button type="button" className="btn danger" disabled={busy} onClick={remove}>{t('re_deleteUnit')}</button>}
        </div>
      </div>
    </Modal>
  );
}

function useCustomers(): PickOption[] {
  const customers = useLoad(() => api.parties({ type: 'customer', active: 'true' }), []);
  return (customers.data ?? []).map((p: PartyView) => ({ id: p.id, code: p.code, label: p.name, search: p.phone }));
}

function ReserveModal({ unit: u, onClose, onDone }: { unit: ReUnitView; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const customers = useCustomers();
  const [partyId, setPartyId] = useState('');
  const [until, setUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await realEstateApi.reserve(u.id, { partyId, ...(until ? { until } : {}), ...(notes.trim() ? { notes } : {}) });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={t('re_reserveTitle', { n: label(u) })} onClose={onClose}>
      <div className="stack">
        <div className="field"><span>{t('customer')}</span><SearchCombo value={partyId} options={customers} onChange={setPartyId} placeholder={t('customer')} /></div>
        <label className="field"><span>{t('re_reservedUntil')}</span><input className="input" type="date" min={todayIso()} value={until} onChange={(e) => setUntil(e.target.value)} /></label>
        <p className="muted small" style={{ margin: 0 }}>{t('re_reserveUntilHelp')}</p>
        <label className="field"><span>{t('notes')}</span><input className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !partyId} onClick={() => void submit()}><Icon name="cal" size={16} />{t('re_reserve')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function ReleaseModal({ unit: u, onClose, onDone }: { unit: ReUnitView; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await realEstateApi.release(u.id, reason.trim() || undefined);
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={t('re_releaseTitle', { n: label(u) })} onClose={onClose}>
      <div className="stack">
        {u.party && <p style={{ margin: 0 }}>{u.status === 'sold' ? t('re_soldTo') : t('re_reservedFor')}: <strong>{u.party.name}</strong></p>}
        <label className="field"><span>{t('re_releaseReason')}</span><input className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}><Icon name="undo" size={16} />{u.status === 'sold' ? t('re_releaseSold') : t('re_release')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function SellModal({ unit: u, project: p, onClose, onDone }: { unit: ReUnitView; project: ReProjectDetail; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const customers = useCustomers();
  const guarantors = useLoad(() => api.guarantors().catch(() => [] as GuarantorView[]), []);
  const [partyId, setPartyId] = useState(u.party?.id ?? '');
  const [date, setDate] = useState(todayIso());
  const [price, setPrice] = useState<number | null>(u.price);
  const [payment, setPayment] = useState<'cash' | 'installments'>('cash');
  const [cashAccount, setCashAccount] = useState(settings?.postingAccounts.cash ?? '');
  const [rate, setRate] = useState(settings ? String(rateFromX100(settings.defaultRateX100)) : '');
  const [down, setDown] = useState<number | null>(0);
  const [months, setMonths] = useState('24');
  const [firstDue, setFirstDue] = useState(nextMonth(todayIso()));
  const [guarantorMode, setGuarantorMode] = useState<'new' | 'existing' | 'none'>('none');
  const [guarantorId, setGuarantorId] = useState('');
  const [g, setG] = useState<GuarantorInput>({ name: '', phone: '', idNumber: '' });
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<{ seq: number; dueDate: string; amount: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => { if (!cashAccount && settings) setCashAccount(settings.postingAccounts.cash); }, [settings, cashAccount]);
  useEffect(() => { if (!rate && settings) setRate(String(rateFromX100(settings.defaultRateX100))); }, [settings, rate]);

  const monthsN = Number(toWesternDigits(months)) || 0;
  const terms = useMemo(() => ({ date, firstDue, total: price ?? 0, downPayment: down ?? 0, months: monthsN, currency: p.currency }), [date, firstDue, price, down, monthsN, p.currency]);
  useEffect(() => {
    if (payment !== 'installments' || !terms.total || !terms.months) { setPreview(null); return; }
    const timer = window.setTimeout(() => { api.previewInstallments(terms).then(setPreview, () => setPreview(null)); }, 250);
    return () => window.clearTimeout(timer);
  }, [terms, payment]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await realEstateApi.sell(u.id, {
        date, partyId, payment, lang: i18n.lang,
        ...(price !== null && price !== u.price ? { price } : {}),
        ...(cashAccount && (payment === 'cash' || (down ?? 0) > 0) ? { cashAccountCode: cashAccount } : {}),
        ...(p.currency === 'USD' && rate ? { rateX100: rateToX100(Number(toWesternDigits(rate))) } : {}),
        ...(payment === 'installments' ? {
          downPayment: down ?? 0, months: monthsN, firstDue,
          ...(guarantorMode === 'existing' && guarantorId ? { guarantorId } : {}),
          ...(guarantorMode === 'new' ? { guarantor: g } : {})
        } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {})
      });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const guarantorOptions: PickOption[] = (guarantors.data ?? []).map((x) => ({ id: x.id, code: '', label: x.name, search: `${x.phone} ${x.idNumber}` }));
  const setGuarantor = (k: keyof GuarantorInput) => (e: { target: { value: string } }) => setG({ ...g, [k]: e.target.value });

  return (
    <Modal title={t('re_sellTitle', { n: label(u) })} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <div className="field">
            <span>{t('customer')}</span>
            {u.status === 'reserved' && u.party ? <input className="input" disabled value={u.party.name} /> : <SearchCombo value={partyId} options={customers} onChange={setPartyId} placeholder={t('customer')} />}
          </div>
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>{t('re_agreedPrice')}</span><AmountInput value={price} currency={p.currency} onChange={setPrice} ariaLabel={t('re_agreedPrice')} /></label>
          {p.currency === 'USD' && <label className="field"><span>{t('exchangeRate')}</span><input className="input num ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>}
        </div>
        <div className="track">
          <button type="button" aria-pressed={payment === 'cash'} onClick={() => setPayment('cash')}>{t('re_payCash')}</button>
          <button type="button" aria-pressed={payment === 'installments'} onClick={() => setPayment('installments')}>{t('re_payInstallments')}</button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>{payment === 'cash' ? t('re_cashHelp') : t('re_installmentsHelp')}</p>
        {u.depositHeld > 0 && <div className="alert info">{t(payment === 'cash' ? 'dep_inSaleCash' : 'dep_inSaleInstallments', { a: i18n.money(u.depositHeld, p.currency) })}</div>}
        {payment === 'installments' && (
          <div className="grid-3">
            <label className="field"><span>{t('downPayment')}</span><AmountInput value={down} currency={p.currency} onChange={setDown} ariaLabel={t('downPayment')} /></label>
            <label className="field"><span>{t('monthsCount')}</span><input className="input num ltr" inputMode="numeric" maxLength={3} value={months} onChange={(e) => setMonths(toWesternDigits(e.target.value).replace(/\D/g, ''))} /></label>
            <label className="field"><span>{t('firstDue')}</span><input className="input" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></label>
          </div>
        )}
        {(payment === 'cash' || (down ?? 0) > 0) && (
          <div className="field">
            <span>{payment === 'cash' ? t('cashAccount') : t('re_downInto')}</span>
            <AccountCombo value={cashAccount} onChange={setCashAccount} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} />
          </div>
        )}
        {payment === 'installments' && (
          <div className="stack" style={{ gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{t('guarantor')}</span>
            <div className="track">
              <button type="button" aria-pressed={guarantorMode === 'none'} onClick={() => setGuarantorMode('none')}>{t('noGuarantor')}</button>
              <button type="button" aria-pressed={guarantorMode === 'new'} onClick={() => setGuarantorMode('new')}>{t('newGuarantor')}</button>
              <button type="button" aria-pressed={guarantorMode === 'existing'} onClick={() => setGuarantorMode('existing')}>{t('guarantors')}</button>
            </div>
            {guarantorMode === 'existing' && <SearchCombo value={guarantorId} options={guarantorOptions} onChange={setGuarantorId} placeholder={t('guarantor')} />}
            {guarantorMode === 'new' && (
              <div className="grid-3">
                <label className="field"><span>{t('guarantorName')}</span><input className="input" maxLength={200} value={g.name} onChange={setGuarantor('name')} /></label>
                <label className="field"><span>{t('phone')}</span><input className="input ltr" maxLength={50} value={g.phone ?? ''} onChange={setGuarantor('phone')} /></label>
                <label className="field"><span>{t('idNumber')}</span><input className="input ltr" maxLength={50} value={g.idNumber ?? ''} onChange={setGuarantor('idNumber')} /></label>
              </div>
            )}
          </div>
        )}
        <label className="field"><span>{t('notes')}</span><input className="input" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {preview && (
          <div style={{ maxBlockSize: 220, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}>
            <table className="table">
              <tbody>
                {preview.map((r) => (
                  <tr key={r.seq}>
                    <td className="num" style={{ width: 90 }}>{r.seq === 0 ? t('downPayment') : i18n.int(r.seq)}</td>
                    <td className="num">{i18n.date(r.dueDate)}</td>
                    <td className="amount">{i18n.money(r.amount, p.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !partyId || !price || (payment === 'cash' && !cashAccount)} onClick={() => void submit()}><Icon name="check" size={16} />{t('re_confirmSale')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}
