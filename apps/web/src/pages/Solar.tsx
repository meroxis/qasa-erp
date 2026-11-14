import { useEffect, useMemo, useState } from 'react';
import { addDays, lineAmount, todayIso, toBase, type CurrencyCode } from '@qasa/core';
import { api, ApiError, type ItemView } from '../api.ts';
import { EmptyState, AccountCombo, AmountInput, ErrorBox, Icon, Modal, QtyInput, SearchCombo, useData, useLoad, useMay, usePageNav, useToast, type PickOption } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { ItemImage } from '../industry/ItemImage.tsx';
import {
  solarApi, type BatteryType, type Charge, type Load, type PlanView, type QuoteLine, type SizingResult, type SolarSummaryView, type SystemView,
  type VisitKind, type WarrantyRow
} from '../industry/solar-api.ts';
import { worksApi, type JobSummaryView, type LineUnit } from '../industry/works-api.ts';
import { go, href } from '../router.ts';

/**
 * الكهرباء والطاقة الشمسية (Pro): the solar system builder (need → equipment → suggested counts → quote), electrical
 * wiring quotes, selling a finished system (cash, credit or installments), installed equipment with warranty, and
 * maintenance plans and visits. An installation is a job order underneath, so its stages, deposits and costs are on the
 * job page. Routes: `solar` (home), `solar/new`, `solar/electrical`, `solar/maintenance`, `solar/warranty`, and
 * `solar-system/:id` (one system).
 */

import { SOLAR_TABS, type SolarTab } from './tabs.ts';
import { printDocument } from '../industry/printing.ts';
export { isSolarTab, type SolarTab } from './tabs.ts';
const TABS = SOLAR_TABS;
const NAV = { key: 'sl_title' as Key, group: 'gIndustry' as Key };
const isAbsent = (e: unknown) => e instanceof ApiError && e.status === 404 && !(e.details as { what?: string } | null)?.what;

function useCustomers(): PickOption[] {
  const customers = useLoad(() => api.parties({ type: 'customer', active: 'true' }), []);
  return useMemo(() => (customers.data ?? []).map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone })), [customers.data]);
}

function useItems(): { items: ItemView[]; options: PickOption[] } {
  const { lang } = useI18n();
  const items = useLoad(() => api.items({ active: 'true' }), []);
  const list = (items.data ?? []).filter((i) => i.unit !== 'service');
  return {
    items: list,
    options: list.map((i) => ({ id: i.id, code: i.code, label: i.name[lang] || i.name.en || i.name.ar, search: `${i.name.ar} ${i.name.en} ${i.name.ku} ${i.barcode}` }))
  };
}

/** An item's sale price in the quote's currency (at the company's default rate when they differ). */
function priceIn(item: ItemView | undefined, currency: CurrencyCode, rateX100: number): number {
  if (!item) return 0;
  if (item.saleCurrency === currency) return item.salePrice;
  return currency === 'IQD' ? toBase(item.salePrice, 'USD', rateX100) : Math.round((item.salePrice * 10000) / rateX100);
}

/** Reads "550W", "6 kW", "5.12 kWh", "Gel" from an item's name to prefill its specification. */
function specOf(item: ItemView | undefined) {
  const name = item ? `${item.name.en} ${item.name.ar} ${item.name.ku}` : '';
  const num = (re: RegExp) => { const m = re.exec(name); return m ? Number(m[1]) : null; };
  return {
    watts: num(/(\d+(?:\.\d+)?)\s*w(?!h)\b/i),
    kw: num(/(\d+(?:\.\d+)?)\s*kw(?!h)/i),
    kwh: num(/(\d+(?:\.\d+)?)\s*kwh/i),
    gel: /gel|agm|جل|جێل/i.test(name)
  };
}

function waLink(phone: string, text: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '964' + digits.slice(1);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function NotAvailable() {
  const { t } = useI18n();
  return <div className="alert info">{t('sl_notAvailable')}</div>;
}

/* ---------- the page and its tabs ---------- */

export function Solar({ tab = 'home' }: { tab?: SolarTab }) {
  const can = useMay();
  const { t } = useI18n();
  usePageNav(NAV);
  const [summary, setSummary] = useState<SolarSummaryView | null>(null);
  const [absent, setAbsent] = useState(false);
  useEffect(() => { solarApi.summary().then(setSummary, (e) => { if (isAbsent(e)) setAbsent(true); }); }, [tab]);
  if (absent) return <NotAvailable />;
  return (
    <div className="stack">
      <div className="track no-print" role="tablist" aria-label={t('sl_title')}>
        {TABS.filter((x) => (x !== 'new' && x !== 'electrical') || can('solarSystem')).map((x) => (
          <a key={x} role="tab" aria-selected={tab === x} aria-pressed={tab === x} href={href(x === 'home' ? 'solar' : `solar/${x}`)}
            className={'btn small' + (tab === x ? ' primary' : '')}>{t(`sl_tab_${x}` as Key)}</a>
        ))}
      </div>
      {summary && !summary.available && <div className="alert">{t('sl_needsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      {tab === 'home' && <Home summary={summary} />}
      {tab === 'new' && <SystemBuilder />}
      {tab === 'electrical' && <WiringQuote />}
      {tab === 'maintenance' && <Maintenance />}
      {tab === 'warranty' && <Warranty />}
    </div>
  );
}

function Home({ summary }: { summary: SolarSummaryView | null }) {
  const can = useMay();
  const i18n = useI18n();
  const { t } = i18n;
  const solar = useLoad(() => worksApi.jobs({ status: 'open', category: 'solar' }), []);
  const electrical = useLoad(() => worksApi.jobs({ status: 'open', category: 'electrical' }), []);
  const due = useLoad(() => solarApi.plans({ due: true, days: 7 }), []);
  const tiles = summary ? [
    { label: t('sl_tileOpen'), value: i18n.int(summary.openJobs.solar + summary.openJobs.electrical), sub: `${t('sl_kindSolar')} ${i18n.int(summary.openJobs.solar)} · ${t('sl_kindElectrical')} ${i18n.int(summary.openJobs.electrical)}` },
    { label: t('sl_tileMonth'), value: `${i18n.digitsOf(String(summary.month.kwp))} kWp`, sub: t('sl_tileSystems', { n: summary.month.systems }) },
    { label: t('sl_tileVisits'), value: i18n.int(summary.visitsDueThisWeek), sub: summary.visitsOverdue ? t('sl_tileOverdue', { n: summary.visitsOverdue }) : '', bad: summary.visitsOverdue > 0 },
    { label: t('sl_tileWarranty'), value: i18n.int(summary.warrantiesExpiring), sub: t('sl_tileWarrantySub') }
  ] : [];
  const jobs = [...(solar.data ?? []), ...(electrical.data ?? [])];
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('sl_help')}</p>
      {summary && (
        <div className="grid-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="card pad tile">
              <div className="label">{tile.label}</div>
              <div className="value num" style={tile.bad ? { color: 'var(--bad)' } : undefined}>{tile.value}</div>
              {tile.sub && <div className="small muted num">{tile.sub}</div>}
            </div>
          ))}
        </div>
      )}
      {summary?.available && can('solarSystem') && (
        <div className="row">
          <a className="btn primary big" href={href('solar/new')}><Icon name="sun" size={18} />{t('sl_newSystem')}</a>
          <a className="btn big" href={href('solar/electrical')}><Icon name="zap" size={18} />{t('sl_newWiring')}</a>
        </div>
      )}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2 style={{ margin: 0, padding: '14px 16px 6px' }}>{t('sl_openJobs')}</h2>
          <ErrorBox error={solar.error && !isAbsent(solar.error) ? solar.error : null} />
          {jobs.length === 0 ? <EmptyState compact icon="sun" title={t('es_solar')} text={t('es_solarText')} /> : <JobsList jobs={jobs} />}
        </div>
        <div className="card">
          <h2 style={{ margin: 0, padding: '14px 16px 6px' }}>{t('sl_dueVisits')}</h2>
          {(due.data ?? []).length === 0 ? <div className="pad muted small">{t('sl_noDue')}</div> : <PlansTable plans={due.data ?? []} onChanged={due.reload} />}
        </div>
      </div>
    </div>
  );
}

function JobsList({ jobs }: { jobs: JobSummaryView[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <table className="table">
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id} className="click" onClick={() => go(`solar-system/${j.id}`)}>
            <td><a className="ltr num" href={href(`solar-system/${j.id}`)} onClick={(e) => e.stopPropagation()}>{j.number}</a><div className="small muted">{j.title}</div></td>
            <td>{j.party.name}<div className="small muted">{t(j.category === 'solar' ? 'sl_kindSolar' : 'sl_kindElectrical')}</div></td>
            <td><span className="chip">{t(`ew_st_${j.status}` as Key)}</span></td>
            <td className="amount">{i18n.money(j.total, j.currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------- the solar system builder ---------- */

interface LoadRow extends Load { key: string }

const COMMON_LOADS: { key: string; watts: number; hours: number; nightHours: number }[] = [
  { key: 'fridge', watts: 150, hours: 24, nightHours: 12 },
  { key: 'freezer', watts: 200, hours: 24, nightHours: 12 },
  { key: 'ac1', watts: 1100, hours: 6, nightHours: 2 },
  { key: 'ac15', watts: 1500, hours: 6, nightHours: 2 },
  { key: 'ac2', watts: 2000, hours: 6, nightHours: 2 },
  { key: 'cooler', watts: 250, hours: 8, nightHours: 4 },
  { key: 'fan', watts: 75, hours: 10, nightHours: 6 },
  { key: 'lights', watts: 10, hours: 6, nightHours: 5 },
  { key: 'tv', watts: 100, hours: 5, nightHours: 3 },
  { key: 'washer', watts: 500, hours: 1, nightHours: 0 },
  { key: 'pump', watts: 750, hours: 1, nightHours: 0 },
  { key: 'router', watts: 15, hours: 24, nightHours: 12 },
  { key: 'computer', watts: 150, hours: 6, nightHours: 2 }
];

interface Pick { itemId: string; spec: number | null }

function SystemBuilder() {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const { settings } = useData();
  const toast = useToast();
  const customers = useCustomers();
  const { items, options } = useItems();
  const rate = settings?.defaultRateX100 ?? 142000;
  const [head, setHead] = useState({ partyId: '', title: '', site: '', currency: 'IQD' as CurrencyCode, date: todayIso() });
  const [mode, setMode] = useState<'appliances' | 'energy'>('appliances');
  const [loads, setLoads] = useState<LoadRow[]>(() => COMMON_LOADS.map((l) => ({ key: l.key, name: '', watts: l.watts, qty: 0, hours: l.hours, nightHours: l.nightHours })));
  const [energy, setEnergy] = useState({ daily: 10, night: 4, peak: 3 });
  const [sunHours, setSunHours] = useState(5);
  const [panel, setPanel] = useState<Pick>({ itemId: '', spec: 550 });
  const [inverter, setInverter] = useState<Pick>({ itemId: '', spec: 6 });
  const [battery, setBattery] = useState<Pick>({ itemId: '', spec: 5 });
  const [batteryType, setBatteryType] = useState<BatteryType>('lithium');
  const [result, setResult] = useState<SizingResult | null>(null);
  const [lines, setLines] = useState<(QuoteLine & { key: number })[]>([]);
  const [discount, setDiscount] = useState<number | null>(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const itemOf = (id: string) => items.find((i) => i.id === id);
  const nameOf = (id: string) => { const it = itemOf(id); return it ? it.name[lang] || it.name.en || it.name.ar : ''; };

  // picking an item fills its specification from its name when it says (550W, 6 kW, 5 kWh, Gel)
  const pick = (which: 'panel' | 'inverter' | 'battery', itemId: string) => {
    const s = specOf(itemOf(itemId));
    if (which === 'panel') setPanel({ itemId, spec: s.watts ?? panel.spec });
    if (which === 'inverter') setInverter({ itemId, spec: s.kw ?? inverter.spec });
    if (which === 'battery') { setBattery({ itemId, spec: s.kwh ?? battery.spec }); setBatteryType(s.gel ? 'gel' : 'lithium'); }
  };

  async function calculate() {
    setError(null);
    try {
      const used = loads.filter((l) => l.qty > 0).map((l) => ({ name: l.key, watts: l.watts, qty: l.qty, hours: l.hours, nightHours: l.nightHours }));
      const r = await solarApi.size({
        ...(mode === 'appliances' ? { loads: used } : { dailyKwh: energy.daily, nightKwh: energy.night, peakKw: energy.peak }),
        sunHours, panelWatts: panel.spec ?? 0, inverterKw: inverter.spec ?? 0, ...(battery.spec ? { batteryKwh: battery.spec, batteryType } : {})
      });
      setResult(r);
      let k = 0;
      const line = (description: string, unit: LineUnit, qty: number, unitPrice: number, itemId?: string): QuoteLine & { key: number } =>
        ({ key: ++k, description, unit, qtyMilli: Math.round(qty * 1000), unitPrice, ...(itemId ? { itemId } : {}) });
      const out = [
        line(panel.itemId ? nameOf(panel.itemId) : t('sl_linePanels', { w: panel.spec ?? 0 }), 'piece', r.panels, priceIn(itemOf(panel.itemId), head.currency, rate), panel.itemId || undefined),
        line(inverter.itemId ? nameOf(inverter.itemId) : t('sl_lineInverter', { kw: inverter.spec ?? 0 }), 'piece', r.inverters, priceIn(itemOf(inverter.itemId), head.currency, rate), inverter.itemId || undefined),
        ...(r.batteries > 0 ? [line(battery.itemId ? nameOf(battery.itemId) : t('sl_lineBattery', { kwh: battery.spec ?? 0 }), 'piece', r.batteries, priceIn(itemOf(battery.itemId), head.currency, rate), battery.itemId || undefined)] : []),
        line(t('sl_lineMounting'), 'lump', 1, 0),
        line(t('sl_lineCables'), 'lump', 1, 0),
        line(t('sl_lineProtection'), 'lump', 1, 0),
        line(t('sl_lineInstall'), 'lump', 1, 0)
      ];
      setLines(out);
      if (!head.title) setHead((h) => ({ ...h, title: t('sl_titleDefault', { kwp: i18n.digitsOf(String(r.installedKwp)) }) }));
    } catch (e) {
      setError(e);
    }
  }

  const subtotal = lines.reduce((s, l) => s + lineAmount(l.qtyMilli, l.unitPrice), 0);
  const total = subtotal - (discount ?? 0);
  const update = (key: number, patch: Partial<QuoteLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const sys = await solarApi.createSystem({
        kind: 'solar', date: head.date, partyId: head.partyId, title: head.title, site: head.site, currency: head.currency, discount: discount ?? 0,
        lines: lines.filter((l) => l.description.trim() && l.qtyMilli > 0).map(({ key: _k, ...l }) => l), sizing: result
      });
      toast(t('sl_created', { n: sys.job.number }));
      go(`solar-system/${sys.job.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 1080 }}>
      <div className="card pad stack">
        <h2 style={{ margin: 0 }}>1 · {t('sl_stepCustomer')}</h2>
        <div className="grid-2">
          <div className="field"><span>{t('customer')}</span>
            <SearchCombo value={head.partyId} options={customers} onChange={(v) => setHead((h) => ({ ...h, partyId: v }))} placeholder={t('sl_pickCustomer')} ariaLabel={t('customer')} />
          </div>
          <label className="field"><span>{t('sl_site')}</span><input className="input" maxLength={300} value={head.site} onChange={(e) => setHead((h) => ({ ...h, site: e.target.value }))} /></label>
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={head.date} onChange={(e) => setHead((h) => ({ ...h, date: e.target.value }))} /></label>
          <label className="field"><span>{t('currency')}</span>
            <select className="input" value={head.currency} onChange={(e) => setHead((h) => ({ ...h, currency: e.target.value as CurrencyCode }))}>
              <option value="IQD">{t('iqdName')}</option><option value="USD">{t('usdName')}</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card pad stack">
        <h2 style={{ margin: 0 }}>2 · {t('sl_stepNeed')}</h2>
        <div className="track" role="group">
          <button type="button" aria-pressed={mode === 'appliances'} onClick={() => setMode('appliances')}>{t('sl_byAppliances')}</button>
          <button type="button" aria-pressed={mode === 'energy'} onClick={() => setMode('energy')}>{t('sl_byEnergy')}</button>
        </div>
        {mode === 'appliances' ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('sl_appliance')}</th><th>{t('sl_count')}</th><th>{t('sl_watts')}</th><th>{t('sl_hours')}</th><th>{t('sl_nightHours')}</th></tr></thead>
              <tbody>
                {loads.map((l, i) => {
                  const set = (patch: Partial<LoadRow>) => setLoads((ls) => ls.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  return (
                    <tr key={l.key + i} style={l.qty > 0 ? { background: 'var(--ok-bg)' } : undefined}>
                      <td>{l.key.startsWith('custom') ? <input className="input" value={l.name} onChange={(e) => set({ name: e.target.value })} /> : t(`sl_load_${l.key}` as Key)}</td>
                      <td style={{ width: 120 }}>
                        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                          <button type="button" className="btn small icon" aria-label="−" onClick={() => set({ qty: Math.max(0, l.qty - 1) })}>−</button>
                          <span className="num" style={{ minWidth: 24, textAlign: 'center' }}>{i18n.int(l.qty)}</span>
                          <button type="button" className="btn small icon" aria-label="+" onClick={() => set({ qty: l.qty + 1 })}>+</button>
                        </div>
                      </td>
                      <td><input className="input num" type="number" min={1} value={l.watts} onChange={(e) => set({ watts: Number(e.target.value) || 0 })} style={{ width: 90 }} /></td>
                      <td><input className="input num" type="number" min={0} max={24} value={l.hours} onChange={(e) => set({ hours: Number(e.target.value) || 0 })} style={{ width: 70 }} /></td>
                      <td><input className="input num" type="number" min={0} max={24} value={l.nightHours} onChange={(e) => set({ nightHours: Number(e.target.value) || 0 })} style={{ width: 70 }} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button type="button" className="btn small" onClick={() => setLoads((ls) => [...ls, { key: `custom${ls.length}`, name: '', watts: 100, qty: 1, hours: 4, nightHours: 0 }])}>
              <Icon name="plus" size={14} />{t('sl_addAppliance')}
            </button>
          </div>
        ) : (
          <div className="grid-3">
            <label className="field"><span>{t('sl_dailyKwh')}</span><input className="input num" type="number" min={0} step={0.1} value={energy.daily} onChange={(e) => setEnergy((x) => ({ ...x, daily: Number(e.target.value) }))} /></label>
            <label className="field"><span>{t('sl_nightKwh')}</span><input className="input num" type="number" min={0} step={0.1} value={energy.night} onChange={(e) => setEnergy((x) => ({ ...x, night: Number(e.target.value) }))} /></label>
            <label className="field"><span>{t('sl_peakKw')}</span><input className="input num" type="number" min={0} step={0.1} value={energy.peak} onChange={(e) => setEnergy((x) => ({ ...x, peak: Number(e.target.value) }))} /></label>
          </div>
        )}
        <label className="field" style={{ maxWidth: 260 }}><span>{t('sl_sunHours')}</span><input className="input num" type="number" min={1} max={10} step={0.1} value={sunHours} onChange={(e) => setSunHours(Number(e.target.value) || 5)} /></label>
      </div>

      <div className="card pad stack">
        <h2 style={{ margin: 0 }}>3 · {t('sl_stepEquipment')}</h2>
        <div className="grid-3">
          {([['panel', panel, setPanel, 'sl_panel', 'sl_panelWatts'], ['inverter', inverter, setInverter, 'sl_inverter', 'sl_inverterKw'], ['battery', battery, setBattery, 'sl_battery', 'sl_batteryKwh']] as const).map(([which, value, setter, label, specLabel]) => (
            <div key={which} className="card pad stack" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                {value.itemId && <ItemImage itemId={value.itemId} name={nameOf(value.itemId)} size={44} />}
                <strong>{t(label)}</strong>
              </div>
              <SearchCombo value={value.itemId} options={options} onChange={(v) => pick(which, v)} placeholder={t('sl_pickItem')} ariaLabel={t(label)} emptyLabel={t('sl_noItem')} />
              {value.itemId && <span className="small muted num">{t('sl_inStock', { q: i18n.int(Math.floor((itemOf(value.itemId)?.qtyMilli ?? 0) / 1000)) })}</span>}
              <label className="field"><span>{t(specLabel)}</span>
                <input className="input num" type="number" min={0} step={0.01} value={value.spec ?? ''} onChange={(e) => (setter as (p: Pick) => void)({ ...value, spec: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
              {which === 'battery' && (
                <select className="input" value={batteryType} onChange={(e) => setBatteryType(e.target.value as BatteryType)} aria-label={t('sl_batteryType')}>
                  <option value="lithium">{t('sl_lithium')}</option><option value="gel">{t('sl_gel')}</option>
                </select>
              )}
            </div>
          ))}
        </div>
        <ErrorBox error={error} />
        <div className="row"><button type="button" className="btn primary big" onClick={() => void calculate()}><Icon name="chart" size={18} />{t('sl_calculate')}</button></div>
      </div>

      {result && (
        <>
          <SystemCard sizing={result} />
          <div className="card pad stack">
            <h2 style={{ margin: 0 }}>4 · {t('sl_stepQuote')}</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{t('description')}</th><th>{t('qty')}</th><th>{t('sl_price')}</th><th className="amount">{t('amount')}</th><th /></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key}>
                      <td><input className="input" value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />{l.itemId && <div className="small muted">{t('sl_fromStock')}</div>}</td>
                      <td style={{ width: 110 }}><QtyInput value={l.qtyMilli || null} onChange={(v) => update(l.key, { qtyMilli: v ?? 0 })} ariaLabel={t('qty')} /></td>
                      <td style={{ width: 170 }}><AmountInput value={l.unitPrice} currency={head.currency} onChange={(v) => update(l.key, { unitPrice: v ?? 0 })} ariaLabel={t('sl_price')} /></td>
                      <td className="amount">{i18n.money(lineAmount(l.qtyMilli, l.unitPrice), head.currency)}</td>
                      <td style={{ width: 44 }}><button type="button" className="btn small icon" aria-label={t('sl_remove')} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Icon name="x" size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row">
              <button type="button" className="btn small" onClick={() => setLines((ls) => [...ls, { key: Date.now(), description: '', unit: 'piece', qtyMilli: 1000, unitPrice: 0 }])}><Icon name="plus" size={14} />{t('sl_addLine')}</button>
              <span className="spacer" />
              <label className="field" style={{ width: 200 }}><span>{t('discount')}</span><AmountInput value={discount} currency={head.currency} onChange={setDiscount} ariaLabel={t('discount')} /></label>
            </div>
            <label className="field"><span>{t('sl_jobTitle')}</span><input className="input" maxLength={200} value={head.title} onChange={(e) => setHead((h) => ({ ...h, title: e.target.value }))} /></label>
            <div className="row">
              <strong className="num" style={{ fontSize: 20 }}>{t('total')}: {i18n.money(total, head.currency)}</strong>
              <span className="spacer" />
              <button type="button" className="btn primary big" disabled={busy || !head.partyId || !head.title.trim() || total < 0 || !lines.length} onClick={() => void create()}>
                <Icon name="check" size={18} />{t('sl_createQuote')}
              </button>
            </div>
            <ErrorBox error={error} />
          </div>
        </>
      )}
    </div>
  );
}

/** The system at a glance: the sizes, labelled as estimates. */
function SystemCard({ sizing }: { sizing: SizingResult }) {
  const i18n = useI18n();
  const { t } = i18n;
  const n = (x: number) => i18n.digitsOf(String(x));
  const cells = [
    { label: t('sl_sysKwp'), value: `${n(sizing.installedKwp)} kWp`, sub: t('sl_sysPanels', { n: sizing.panels }) },
    { label: t('sl_sysInverter'), value: `${n(sizing.inverterTotalKw)} kW`, sub: t('sl_sysUnits', { n: sizing.inverters }) },
    { label: t('sl_sysBattery'), value: `${n(sizing.batteryTotalKwh)} kWh`, sub: sizing.batteries ? t('sl_sysUsable', { kwh: n(sizing.usableBatteryKwh), n: sizing.batteries }) : t('sl_sysNoBattery') },
    { label: t('sl_sysProduction'), value: `${n(sizing.expectedDailyKwh)} kWh`, sub: t('sl_sysNeed', { d: n(sizing.dailyKwh), night: n(sizing.nightKwh) }) }
  ];
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <div className="grid-4">
        {cells.map((c) => (
          <div key={c.label} className="tile">
            <div className="label">{c.label}</div>
            <div className="value num">{c.value}</div>
            <div className="small muted num">{c.sub}</div>
          </div>
        ))}
      </div>
      <div className="small muted">{t('sl_estimateNote', { h: n(sizing.assumptions.sunHours), e: n(Math.round(sizing.assumptions.efficiency * 100)) })}</div>
    </div>
  );
}

/* ---------- electrical wiring quote ---------- */

const WIRING: { key: string; unit: LineUnit }[] = [
  { key: 'sockets', unit: 'piece' }, { key: 'lightPoints', unit: 'piece' }, { key: 'switches', unit: 'piece' }, { key: 'acPoints', unit: 'piece' },
  { key: 'panel', unit: 'piece' }, { key: 'breakers', unit: 'piece' }, { key: 'cable', unit: 'm' }, { key: 'earthing', unit: 'lump' }, { key: 'labour', unit: 'lump' }
];

function WiringQuote() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const customers = useCustomers();
  const [head, setHead] = useState({ partyId: '', title: '', site: '', currency: 'IQD' as CurrencyCode, date: todayIso() });
  const [rows, setRows] = useState(() => WIRING.map((w) => ({ ...w, qtyMilli: 0, unitPrice: 0 })));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const total = rows.reduce((s, r) => s + lineAmount(r.qtyMilli, r.unitPrice), 0);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const sys = await solarApi.createSystem({
        kind: 'electrical', date: head.date, partyId: head.partyId, title: head.title || t('sl_wiringTitle'), site: head.site, currency: head.currency,
        lines: rows.filter((r) => r.qtyMilli > 0).map((r) => ({ description: t(`sl_w_${r.key}` as Key), unit: r.unit, qtyMilli: r.qtyMilli, unitPrice: r.unitPrice }))
      });
      toast(t('sl_created', { n: sys.job.number }));
      go(`solar-system/${sys.job.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 960 }}>
      <p className="muted" style={{ margin: 0 }}>{t('sl_wiringHelp')}</p>
      <div className="card pad grid-2">
        <div className="field"><span>{t('customer')}</span>
          <SearchCombo value={head.partyId} options={customers} onChange={(v) => setHead((h) => ({ ...h, partyId: v }))} placeholder={t('sl_pickCustomer')} ariaLabel={t('customer')} />
        </div>
        <label className="field"><span>{t('sl_jobTitle')}</span><input className="input" placeholder={t('sl_wiringTitle')} value={head.title} onChange={(e) => setHead((h) => ({ ...h, title: e.target.value }))} /></label>
        <label className="field"><span>{t('sl_site')}</span><input className="input" value={head.site} onChange={(e) => setHead((h) => ({ ...h, site: e.target.value }))} /></label>
        <label className="field"><span>{t('currency')}</span>
          <select className="input" value={head.currency} onChange={(e) => setHead((h) => ({ ...h, currency: e.target.value as CurrencyCode }))}><option value="IQD">{t('iqdName')}</option><option value="USD">{t('usdName')}</option></select>
        </label>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>{t('description')}</th><th>{t('qty')}</th><th>{t('sl_price')}</th><th className="amount">{t('amount')}</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const set = (patch: Partial<typeof r>) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <tr key={r.key}>
                  <td>{t(`sl_w_${r.key}` as Key)}</td>
                  <td style={{ width: 120 }}><QtyInput value={r.qtyMilli || null} onChange={(v) => set({ qtyMilli: v ?? 0 })} ariaLabel={t('qty')} /></td>
                  <td style={{ width: 170 }}><AmountInput value={r.unitPrice} currency={head.currency} onChange={(v) => set({ unitPrice: v ?? 0 })} ariaLabel={t('sl_price')} /></td>
                  <td className="amount">{i18n.money(lineAmount(r.qtyMilli, r.unitPrice), head.currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ErrorBox error={error} />
      <div className="row">
        <strong className="num" style={{ fontSize: 20 }}>{t('total')}: {i18n.money(total, head.currency)}</strong>
        <span className="spacer" />
        <button type="button" className="btn primary big" disabled={busy || !head.partyId || total <= 0} onClick={() => void create()}><Icon name="check" size={18} />{t('sl_createQuote')}</button>
      </div>
    </div>
  );
}

/* ---------- one system ---------- */

export function SolarSystem({ id }: { id: string }) {
  const can = useMay();
  const i18n = useI18n();
  const { t, lang } = i18n;
  const { settings } = useData();
  const toast = useToast();
  usePageNav(NAV);
  const { data, error, reload } = useLoad(() => solarApi.system(id), [id]);
  const [modal, setModal] = useState<'equipment' | 'sell' | null>(null);
  if (error) return isAbsent(error) ? <NotAvailable /> : <ErrorBox error={error} />;
  if (!data) return null;
  const { job: j, design, installed } = data;
  const company = settings ? i18n.name(settings.companyName) : '';
  const done = (msg: string) => { setModal(null); toast(msg); reload(); };

  return (
    <div className="stack" style={{ maxWidth: 1080 }}>
      <div className="row no-print">
        <button type="button" className="btn" onClick={() => history.back()}>{t('back')}</button>
        <span className="spacer" />
        <a className="btn" href={href(`job/${j.id}`)}><Icon name="swap" size={16} />{t('sl_openJob')}</a>
        {j.status !== 'cancelled' && can('solarSystem') && <button type="button" className="btn" onClick={() => setModal('equipment')}><Icon name="plus" size={16} />{t('sl_addEquipment')}</button>}
        {j.actions.includes('invoice') && <button type="button" className="btn primary" onClick={() => setModal('sell')}><Icon name="invoice" size={16} />{t('sl_sell')}</button>}
        <button type="button" className="btn" onClick={() => void printDocument('quote')}><Icon name="printer" size={16} />{t('sl_print')}</button>
      </div>
      {!j.actions.includes('invoice') && j.status !== 'invoiced' && j.status !== 'cancelled' && (
        <div className="alert info no-print">{t('sl_sellWhenDone', { s: t(`ew_st_${j.status}` as Key) })}</div>
      )}

      <div className="paper">
        <div className="paper-head">
          <div style={{ flex: 1 }}>
            <div className="company-line">{company}</div>
            <div className="paper-title">{t(design?.kind === 'electrical' ? 'sl_quoteElectrical' : 'sl_quoteSolar')}</div>
          </div>
          <div className="paper-meta">
            <span className="muted">{t('number')}</span><strong className="ltr">{j.number}</strong>
            <span className="muted">{t('date')}</span><strong className="num">{i18n.date(j.date)}</strong>
          </div>
        </div>
        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div>
            <div className="muted small">{t('customer')}</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{j.party.name}</div>
            {j.party.phone && <div className="small ltr">{i18n.digitsOf(j.party.phone)}</div>}
          </div>
          <div>
            <div className="muted small">{t('sl_jobTitle')}</div>
            <div style={{ fontWeight: 700 }}>{j.title}</div>
            {j.site && <div className="small">{j.site}</div>}
          </div>
        </div>
        {design?.sizing && <SystemCard sizing={design.sizing} />}
        <table className="table" style={{ marginTop: 12 }}>
          <thead><tr><th>#</th><th>{t('description')}</th><th>{t('qty')}</th><th>{t('sl_price')}</th><th className="amount">{t('amount')}</th></tr></thead>
          <tbody>
            {j.lines.map((l) => (
              <tr key={l.seq}>
                <td className="num">{i18n.int(l.seq)}</td><td>{l.description}</td>
                <td className="num">{i18n.digitsOf(String(l.qtyMilli / 1000))}</td>
                <td className="amount">{i18n.money(l.unitPrice, j.currency)}</td><td className="amount">{i18n.money(l.amount, j.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {j.discount > 0 && <tr><td colSpan={4}>{t('discount')}</td><td className="amount">−{i18n.money(j.discount, j.currency)}</td></tr>}
            <tr><th colSpan={4}>{t('total')}</th><th className="amount">{i18n.money(j.total, j.currency)}</th></tr>
          </tfoot>
        </table>
        <p className="small muted" style={{ marginTop: 12 }}>{t('sl_quoteTerms')}</p>
      </div>

      <div className="grid-2 no-print" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2 style={{ margin: 0, padding: '14px 16px 6px' }}>{t('sl_equipment')}</h2>
          {installed.length === 0 ? <div className="pad muted small">{t('sl_noEquipment')}</div> : (
            <table className="table">
              <tbody>
                {installed.map((e) => (
                  <tr key={e.serial}>
                    <td><span className="ltr num">{e.serial}</span><div className="small muted">{e.itemName[lang] || e.itemName.en}</div></td>
                    <td className="small">
                      {e.pending
                        ? <span className="chip warn">{t('sl_pending', { m: e.warrantyMonths ?? 0 })}</span>
                        : e.warrantyUntil ? <>{t('sl_warrantyUntil')} <span className="num">{i18n.date(e.warrantyUntil)}</span></> : '—'}
                    </td>
                    <td style={{ width: 44 }}>
                      {e.pending && can('solarSystem') && (
                        <button type="button" className="btn small icon" aria-label={t('sl_remove')}
                          onClick={() => void solarApi.removePending(j.id, e.serial).then(() => { toast(t('saved')); reload(); })}><Icon name="x" size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card pad stack" style={{ gap: 6 }}>
          <h2 style={{ margin: 0 }}>{t('sl_payment')}</h2>
          <div className="row"><span className="muted">{t('total')}</span><span className="spacer" /><strong className="num">{i18n.money(j.total, j.currency)}</strong></div>
          <div className="row"><span className="muted">{t('sl_paid')}</span><span className="spacer" /><strong className="num" style={{ color: 'var(--ok)' }}>{i18n.money(j.paid, j.currency)}</strong></div>
          <div className="row"><span className="muted">{t('sl_remaining')}</span><span className="spacer" /><strong className="num">{i18n.money(j.remaining, j.currency)}</strong></div>
          {j.invoice && <div className="small">{t('sl_billed')}: <a className="ltr num" href={href(`invoice/${j.invoice.id}`)}>{j.invoice.number}</a></div>}
        </div>
      </div>
      {modal === 'equipment' && <EquipmentModal system={data} onClose={() => setModal(null)} onDone={() => done(t('saved'))} />}
      {modal === 'sell' && <SellModal system={data} onClose={() => setModal(null)} onDone={() => done(t('sl_sold'))} />}
    </div>
  );
}

function EquipmentModal({ system, onClose, onDone }: { system: SystemView; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const { options } = useItems();
  // the stock items on the quote come first: what is usually installed
  const quoted = new Set(system.design?.itemLines.map((l) => l.itemId) ?? []);
  const sorted = [...options].sort((a, b) => Number(quoted.has(b.id)) - Number(quoted.has(a.id)));
  const [itemId, setItemId] = useState(system.design?.itemLines[0]?.itemId ?? '');
  const [months, setMonths] = useState(24);
  const [serials, setSerials] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const list = serials.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await solarApi.registerEquipment(system.job.id, list.map((serial) => ({ itemId, serial, warrantyMonths: months })));
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <Modal title={t('sl_addEquipment')} onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>{t(system.job.invoice ? 'sl_equipmentSoldHelp' : 'sl_equipmentPendingHelp')}</p>
        <div className="field"><span>{t('sl_item')}</span><SearchCombo value={itemId} options={sorted} onChange={setItemId} placeholder={t('sl_pickItem')} ariaLabel={t('sl_item')} /></div>
        <label className="field"><span>{t('sl_serials')}</span>
          <textarea className="input ltr" rows={5} placeholder={t('sl_serialsPh')} value={serials} onChange={(e) => setSerials(e.target.value)} />
          <span className="small muted">{t('sl_serialsCount', { n: list.length })}</span>
        </label>
        <label className="field" style={{ maxWidth: 220 }}><span>{t('sl_warrantyMonths')}</span>
          <input className="input num" type="number" min={0} max={300} value={months} onChange={(e) => setMonths(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !itemId || !list.length} onClick={() => void save()}>{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function SellModal({ system, onClose, onDone }: { system: SystemView; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const { settings } = useData();
  const j = system.job;
  const [date, setDate] = useState(todayIso());
  const [payment, setPayment] = useState<'cash' | 'credit' | 'installments'>('cash');
  const [cash, setCash] = useState('1811');
  const [rate, setRate] = useState<number>(settings?.defaultRateX100 ?? 142000);
  const [down, setDown] = useState<number | null>(0);
  const [months, setMonths] = useState(12);
  const [firstDue, setFirstDue] = useState(addDays(todayIso(), 30));
  const [guarantor, setGuarantor] = useState({ name: '', phone: '' });
  const [maint, setMaint] = useState({ on: true, every: 6, price: 0 });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function sell() {
    setBusy(true);
    setError(null);
    try {
      await solarApi.sell(j.id, {
        date, payment, lang, ...(j.currency === 'USD' ? { rateX100: rate } : {}),
        ...(payment !== 'credit' ? { cashAccountCode: cash } : {}),
        ...(payment === 'installments' ? { downPayment: down ?? 0, months, firstDue, ...(guarantor.name.trim() ? { guarantor: { name: guarantor.name.trim(), phone: guarantor.phone.trim() } } : {}) } : {}),
        ...(maint.on ? { maintenance: { everyMonths: maint.every, price: maint.price } } : {})
      });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t('sl_sell')} — ${j.number}`} onClose={onClose}>
      <div className="stack">
        <div className="row"><span className="muted">{t('sl_remaining')}</span><span className="spacer" /><strong className="num" style={{ fontSize: 18 }}>{i18n.money(j.remaining, j.currency)}</strong></div>
        <div className="track" role="group" aria-label={t('sl_payment')}>
          {(['cash', 'installments', 'credit'] as const).map((p) => (
            <button key={p} type="button" aria-pressed={payment === p} onClick={() => setPayment(p)}>{t(`sl_pay_${p}` as Key)}</button>
          ))}
        </div>
        <p className="small muted" style={{ margin: 0 }}>{t(`sl_payHelp_${payment}` as Key)}</p>
        <div className="grid-2">
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {payment !== 'credit' && <div className="field"><span>{t('cashAccount')}</span><AccountCombo value={cash} onChange={setCash} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} /></div>}
          {j.currency === 'USD' && <label className="field"><span>{t('sl_rate')}</span><input className="input num" type="number" value={rate / 100} onChange={(e) => setRate(Math.round(Number(e.target.value) * 100))} /></label>}
        </div>
        {payment === 'installments' && (
          <div className="grid-2">
            <label className="field"><span>{t('sl_downPayment')}</span><AmountInput value={down} currency={j.currency} onChange={setDown} ariaLabel={t('sl_downPayment')} /></label>
            <label className="field"><span>{t('sl_months')}</span><input className="input num" type="number" min={1} max={120} value={months} onChange={(e) => setMonths(Math.max(1, Number(e.target.value) || 1))} /></label>
            <label className="field"><span>{t('sl_firstDue')}</span><input className="input" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></label>
            <label className="field"><span>{t('sl_guarantor')}</span><input className="input" value={guarantor.name} onChange={(e) => setGuarantor((g) => ({ ...g, name: e.target.value }))} /></label>
            <label className="field"><span>{t('sl_guarantorPhone')}</span><input className="input ltr" value={guarantor.phone} onChange={(e) => setGuarantor((g) => ({ ...g, phone: e.target.value }))} /></label>
          </div>
        )}
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={maint.on} onChange={(e) => setMaint((m) => ({ ...m, on: e.target.checked }))} />
          <span>{t('sl_maintWithSale')}</span>
        </label>
        {maint.on && (
          <div className="grid-2">
            <label className="field"><span>{t('sl_everyMonths')}</span><input className="input num" type="number" min={1} max={24} value={maint.every} onChange={(e) => setMaint((m) => ({ ...m, every: Math.max(1, Number(e.target.value) || 1) }))} /></label>
            <label className="field"><span>{t('sl_visitPrice')}</span><AmountInput value={maint.price} currency={j.currency} onChange={(v) => setMaint((m) => ({ ...m, price: v ?? 0 }))} ariaLabel={t('sl_visitPrice')} /></label>
          </div>
        )}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary big" disabled={busy} onClick={() => void sell()}>{t('sl_sell')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- maintenance ---------- */

function Maintenance() {
  const can = useMay();
  const { t } = useI18n();
  const [filter, setFilter] = useState<'due' | 'all'>('due');
  const plans = useLoad(() => (filter === 'due' ? solarApi.plans({ due: true, days: 30 }) : solarApi.plans()), [filter]);
  const visits = useLoad(() => solarApi.visits({ from: addDays(todayIso(), -60) }), []);
  const [modal, setModal] = useState<'plan' | 'visit' | null>(null);
  const toast = useToast();
  const reload = () => { plans.reload(); visits.reload(); };
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('sl_maintHelp')}</p>
      <div className="row">
        {can('solarSystem') && <button type="button" className="btn primary" onClick={() => setModal('plan')}><Icon name="plus" size={16} />{t('sl_newPlan')}</button>}
        {can('solarSystem') && <button type="button" className="btn" onClick={() => setModal('visit')}><Icon name="plus" size={16} />{t('sl_newVisit')}</button>}
        <span className="spacer" />
        <div className="track">
          <button type="button" aria-pressed={filter === 'due'} onClick={() => setFilter('due')}>{t('sl_dueMonth')}</button>
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{t('all')}</button>
        </div>
      </div>
      <ErrorBox error={plans.error && !isAbsent(plans.error) ? plans.error : null} />
      <div className="card">{(plans.data ?? []).length === 0 ? <div className="pad muted small">{t('sl_noDue')}</div> : <PlansTable plans={plans.data ?? []} onChanged={reload} />}</div>
      <div className="card">
        <h2 style={{ margin: 0, padding: '14px 16px 6px' }}>{t('sl_recentVisits')}</h2>
        <VisitsTable visits={visits.data ?? []} onChanged={reload} />
      </div>
      {modal === 'plan' && <PlanModal onClose={() => setModal(null)} onDone={() => { setModal(null); toast(t('saved')); reload(); }} />}
      {modal === 'visit' && <VisitModal onClose={() => setModal(null)} onDone={() => { setModal(null); toast(t('saved')); reload(); }} />}
    </div>
  );
}

function reminderText(i18n: I18n, p: PlanView, company: string): string {
  return i18n.t('sl_reminder', { name: p.party.name, title: p.title, date: i18n.date(p.nextDate), company });
}

function PlansTable({ plans, onChanged }: { plans: PlanView[]; onChanged(): void }) {
  const can = useMay();
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const company = settings ? i18n.name(settings.companyName) : '';
  const [visitFor, setVisitFor] = useState<PlanView | null>(null);
  const toast = useToast();
  return (
    <>
      <table className="table">
        <thead><tr><th>{t('customer')}</th><th>{t('sl_system')}</th><th>{t('sl_nextVisit')}</th><th>{t('sl_every')}</th><th /></tr></thead>
        <tbody>
          {plans.map((p) => (
            <tr key={p.id}>
              <td>{p.party.name}{p.party.phone && <div className="small muted ltr">{i18n.digitsOf(p.party.phone)}</div>}</td>
              <td>{p.title}{p.site && <div className="small muted">{p.site}</div>}{p.status !== 'active' && <span className="chip">{t(`sl_ps_${p.status}` as Key)}</span>}</td>
              <td className="num" style={p.overdue ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>
                {i18n.date(p.nextDate)}{p.overdue && <div className="small">{t('sl_overdue')}</div>}
              </td>
              <td className="num">{t('sl_everyN', { n: p.everyMonths })}<div className="small muted">{p.price ? i18n.money(p.price, p.currency) : t('sl_free')}</div></td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {p.status === 'active' && can('solarSystem') && <button type="button" className="btn small primary" onClick={() => setVisitFor(p)}>{t('sl_recordVisit')}</button>}
                {p.party.phone && <a className="btn small" target="_blank" rel="noreferrer" href={waLink(p.party.phone, reminderText(i18n, p, company))}>WhatsApp</a>}
                {!can('solarSystem') ? null : p.status === 'active'
                  ? <button type="button" className="btn small" onClick={() => void solarApi.updatePlan(p.id, { status: 'paused' }).then(() => { toast(t('saved')); onChanged(); })}>{t('sl_pause')}</button>
                  : p.status === 'paused' && <button type="button" className="btn small" onClick={() => void solarApi.updatePlan(p.id, { status: 'active' }).then(() => { toast(t('saved')); onChanged(); }, () => toast(t('sl_needsPro')))}>{t('sl_resume')}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {visitFor && <VisitModal plan={visitFor} onClose={() => setVisitFor(null)} onDone={() => { setVisitFor(null); toast(t('saved')); onChanged(); }} />}
    </>
  );
}

function VisitsTable({ visits, onChanged }: { visits: { id: string; number: string; date: string; party: { name: string }; kind: VisitKind; status: string; technician: string; workDone: string; invoice: { id: string; total: number; currency: CurrencyCode } | null }[]; onChanged(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const can = useMay();
  if (!visits.length) return <div className="pad muted small">—</div>;
  return (
    <table className="table">
      <tbody>
        {visits.map((v) => (
          <tr key={v.id}>
            <td><span className="ltr num">{v.number}</span><div className="small muted num">{i18n.date(v.date)}</div></td>
            <td>{v.party.name}<div className="small muted">{t(`sl_vk_${v.kind}` as Key)}{v.technician ? ` · ${v.technician}` : ''}</div></td>
            <td className="small">{v.workDone || '—'}</td>
            <td><span className={'chip ' + (v.status === 'done' ? 'ok' : v.status === 'cancelled' ? 'bad' : 'info')}>{t(`sl_vs_${v.status}` as Key)}</span></td>
            <td className="amount">{v.invoice ? <a href={href(`invoice/${v.invoice.id}`)}>{i18n.money(v.invoice.total, v.invoice.currency)}</a> : ''}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {v.status === 'scheduled' && can('solarSystem') && (
                <>
                  <button type="button" className="btn small primary" onClick={() => void solarApi.completeVisit(v.id, {}).then(() => { toast(t('saved')); onChanged(); }, () => toast(t('sl_needsPro')))}>{t('sl_markDone')}</button>
                  <button type="button" className="btn small" onClick={() => void solarApi.completeVisit(v.id, { cancel: true }).then(() => { toast(t('saved')); onChanged(); })}>{t('cancel')}</button>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlanModal({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const customers = useCustomers();
  const [form, setForm] = useState({ partyId: '', title: '', site: '', everyMonths: 6, nextDate: addDays(todayIso(), 30), currency: 'IQD' as CurrencyCode, price: 0 as number | null, notes: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await solarApi.createPlan({ ...form, price: form.price ?? 0 });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <Modal title={t('sl_newPlan')} onClose={onClose}>
      <div className="stack">
        <div className="field"><span>{t('customer')}</span><SearchCombo value={form.partyId} options={customers} onChange={(v) => set('partyId', v)} placeholder={t('sl_pickCustomer')} ariaLabel={t('customer')} /></div>
        <div className="grid-2">
          <label className="field"><span>{t('sl_system')}</span><input className="input" placeholder={t('sl_planTitlePh')} value={form.title} onChange={(e) => set('title', e.target.value)} /></label>
          <label className="field"><span>{t('sl_site')}</span><input className="input" value={form.site} onChange={(e) => set('site', e.target.value)} /></label>
          <label className="field"><span>{t('sl_everyMonths')}</span><input className="input num" type="number" min={1} max={24} value={form.everyMonths} onChange={(e) => set('everyMonths', Math.max(1, Number(e.target.value) || 1))} /></label>
          <label className="field"><span>{t('sl_nextVisit')}</span><input className="input" type="date" value={form.nextDate} onChange={(e) => set('nextDate', e.target.value)} /></label>
          <label className="field"><span>{t('currency')}</span><select className="input" value={form.currency} onChange={(e) => set('currency', e.target.value as CurrencyCode)}><option value="IQD">{t('iqdName')}</option><option value="USD">{t('usdName')}</option></select></label>
          <label className="field"><span>{t('sl_visitPrice')}</span><AmountInput value={form.price} currency={form.currency} onChange={(v) => set('price', v)} ariaLabel={t('sl_visitPrice')} /></label>
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !form.partyId || !form.title.trim()} onClick={() => void save()}>{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function VisitModal({ plan, onClose, onDone }: { plan?: PlanView; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const customers = useCustomers();
  const [form, setForm] = useState({
    partyId: plan?.party.id ?? '', date: todayIso(), kind: 'service' as VisitKind, status: 'done' as 'done' | 'scheduled', technician: '', findings: '', workDone: ''
  });
  const [charge, setCharge] = useState<{ on: boolean; amount: number | null; payment: 'cash' | 'credit'; cash: string }>({ on: !!plan?.price, amount: plan?.price ?? 0, payment: 'cash', cash: '1811' });
  const currency = plan?.currency ?? 'IQD';
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const c: Charge | undefined = charge.on && form.status === 'done' && charge.amount
        ? { amount: charge.amount, payment: charge.payment, currency, ...(charge.payment === 'cash' ? { cashAccountCode: charge.cash } : {}) } : undefined;
      await solarApi.recordVisit({
        ...(plan ? { planId: plan.id } : { partyId: form.partyId }), date: form.date, kind: form.kind, status: form.status, technician: form.technician,
        findings: form.findings, workDone: form.workDone, ...(c ? { charge: c } : {})
      });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <Modal title={plan ? `${t('sl_recordVisit')} — ${plan.party.name}` : t('sl_newVisit')} onClose={onClose}>
      <div className="stack">
        {!plan && <div className="field"><span>{t('customer')}</span><SearchCombo value={form.partyId} options={customers} onChange={(v) => set('partyId', v)} placeholder={t('sl_pickCustomer')} ariaLabel={t('customer')} /></div>}
        <div className="track" role="group">
          <button type="button" aria-pressed={form.status === 'done'} onClick={() => set('status', 'done')}>{t('sl_vs_done')}</button>
          <button type="button" aria-pressed={form.status === 'scheduled'} onClick={() => set('status', 'scheduled')}>{t('sl_vs_scheduled')}</button>
        </div>
        <div className="grid-2">
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></label>
          <label className="field"><span>{t('sl_visitKind')}</span>
            <select className="input" value={form.kind} onChange={(e) => set('kind', e.target.value as VisitKind)}>
              {(['service', 'repair', 'inspection', 'installation'] as const).map((k) => <option key={k} value={k}>{t(`sl_vk_${k}` as Key)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('sl_technician')}</span><input className="input" value={form.technician} onChange={(e) => set('technician', e.target.value)} /></label>
        </div>
        {form.status === 'done' && (
          <>
            <label className="field"><span>{t('sl_findings')}</span><textarea className="input" rows={2} placeholder={t('sl_findingsPh')} value={form.findings} onChange={(e) => set('findings', e.target.value)} /></label>
            <label className="field"><span>{t('sl_workDone')}</span><textarea className="input" rows={2} value={form.workDone} onChange={(e) => set('workDone', e.target.value)} /></label>
            <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={charge.on} onChange={(e) => setCharge((c) => ({ ...c, on: e.target.checked }))} /><span>{t('sl_chargeVisit')}</span></label>
            {charge.on && (
              <div className="grid-2">
                <label className="field"><span>{t('amount')}</span><AmountInput value={charge.amount} currency={currency} onChange={(v) => setCharge((c) => ({ ...c, amount: v }))} ariaLabel={t('amount')} /></label>
                <label className="field"><span>{t('sl_payment')}</span>
                  <select className="input" value={charge.payment} onChange={(e) => setCharge((c) => ({ ...c, payment: e.target.value as 'cash' | 'credit' }))}>
                    <option value="cash">{t('sl_pay_cash')}</option><option value="credit">{t('sl_pay_credit')}</option>
                  </select>
                </label>
                {charge.payment === 'cash' && <div className="field"><span>{t('cashAccount')}</span><AccountCombo value={charge.cash} onChange={(v) => setCharge((c) => ({ ...c, cash: v }))} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} /></div>}
              </div>
            )}
          </>
        )}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || (!plan && !form.partyId)} onClick={() => void save()}>{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- warranty ---------- */

function Warranty() {
  const i18n = useI18n();
  const { t } = i18n;
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<WarrantyRow[] | null>(null);
  const expiring = useLoad(() => solarApi.expiring(), []);
  useEffect(() => {
    if (q.trim().length < 2) { setRows(null); return; }
    const timer = setTimeout(() => { solarApi.warranty(q).then(setRows, () => setRows([])); }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  return (
    <div className="stack">
      <input className="input big" type="search" autoFocus placeholder={t('sl_warrantySearch')} aria-label={t('sl_warrantySearch')} value={q} onChange={(e) => setQ(e.target.value)} />
      {rows && <div className="card">{rows.length ? <WarrantyTable rows={rows} /> : <div className="pad muted small">{t('sl_noResults')}</div>}</div>}
      <div className="card">
        <h2 style={{ margin: 0, padding: '14px 16px 6px' }}>{t('sl_expiring')}</h2>
        {(expiring.data ?? []).length ? <WarrantyTable rows={expiring.data ?? []} /> : <div className="pad muted small">—</div>}
      </div>
    </div>
  );
}

function WarrantyTable({ rows }: { rows: WarrantyRow[] }) {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const chip = { active: 'ok', expiring: 'warn', expired: 'bad', none: '' } as const;
  return (
    <table className="table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.serial}>
            <td><span className="ltr num">{r.serial}</span><div className="small muted">{r.item.name[lang] || r.item.name.en}</div></td>
            <td>{r.party?.name ?? '—'}{r.party?.phone && <div className="small muted ltr">{i18n.digitsOf(r.party.phone)}</div>}</td>
            <td className="num">{r.soldAt ? i18n.date(r.soldAt) : '—'}</td>
            <td><span className={'chip ' + chip[r.state]}>{t(`sl_ws_${r.state}` as Key)}</span>{r.warrantyUntil && <div className="small muted num">{i18n.date(r.warrantyUntil)}</div>}</td>
            <td>{r.invoice && <a className="ltr num" href={href(`invoice/${r.invoice.id}`)}>{r.invoice.number}</a>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
