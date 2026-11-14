import { useEffect, useState } from 'react';
import { formatQty } from '@qasa/core';
import { AmountInput, ErrorBox, Icon, Modal, QtyInput, downloadCsv, useData, useLoad, useMay, useToast } from '../components.tsx';
import { isKey, useI18n, type I18n } from '../i18n.ts';
import { href } from '../router.ts';
import {
  PART_ORIGINS, partsApi, type Fitment, type PartHit, type PartImportKind, type PartImportReport, type PartNumber, type PartView
} from '../industry/parts-api.ts';
import { BrandPicker } from '../industry/CatalogPickers.tsx';
import { qtyText, unitName } from './Items.tsx';

/** A value that follows `value` once it stops changing for `ms` (typing in the search box). */
function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** An origin code shown in the current language; free text as written. */
export function originName(i18n: I18n, origin: string): string {
  const key = `pt_o_${origin}`;
  return origin && isKey(key) ? i18n.t(key) : origin;
}

/**
 * Why part data cannot be changed here, to say the true reason: 'plan' when the plan lacks the feature (the notice
 * names the plans that have it), 'role' when the plan has it and this person may not change stock data (a neutral
 * note: no plan would change that), null when they can.
 */
export function partsNotice(planHasParts: boolean, mayChange: boolean): 'plan' | 'role' | null {
  if (!planHasParts) return 'plan';
  return mayChange ? null : 'role';
}

function usePartsNotice(): 'plan' | 'role' | null {
  const { plan } = useData();
  const can = useMay();
  // part numbers and fitments are the stock's data: the plan has the feature, and the person may change them
  return partsNotice(!!plan?.features.includes('autoParts'), can('partData'));
}

/** قطع غيار السيارات: counter search, vehicle finder and reorder list */
export function CarParts() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'counter' | 'vehicle' | 'reorder'>('counter');
  const [open, setOpen] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [tick, setTick] = useState(0);
  const notice = usePartsNotice();
  const canEdit = notice === null;

  return (
    <div className="stack">
      <div className="row">
        <div className="tabs">
          <button type="button" aria-pressed={tab === 'counter'} onClick={() => setTab('counter')}>{t('pt_tabCounter')}</button>
          <button type="button" aria-pressed={tab === 'vehicle'} onClick={() => setTab('vehicle')}>{t('pt_tabVehicle')}</button>
          <button type="button" aria-pressed={tab === 'reorder'} onClick={() => setTab('reorder')}>{t('pt_tabReorder')}</button>
        </div>
        <span className="spacer" />
        {canEdit && <button type="button" className="btn" onClick={() => setImporting(true)}><Icon name="download" size={16} />{t('pt_import')}</button>}
        <a className="btn" href={href('items')}><Icon name="box" size={16} />{t('items')}</a>
      </div>
      {notice === 'plan' && <div className="alert info">{t('pt_needsPro')}</div>}
      {notice === 'role' && <p className="muted small" style={{ margin: 0 }}>{t('pt_readOnly')}</p>}

      {tab === 'counter' && <CounterSearch key={tick} onOpen={setOpen} />}
      {tab === 'vehicle' && <VehicleFinder key={tick} onOpen={setOpen} />}
      {tab === 'reorder' && <ReorderList key={tick} onOpen={setOpen} />}

      {open && <PartCard id={open} canEdit={canEdit} onOpen={setOpen} onClose={() => setOpen(null)} onSaved={() => setTick((n) => n + 1)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={() => setTick((n) => n + 1)} />}
    </div>
  );
}

function CounterSearch({ onOpen }: { onOpen(id: string): void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const found = useLoad(() => (query ? partsApi.search(query) : Promise.resolve(null)), [query]);
  return (
    <>
      <div className="card" style={{ padding: 'var(--sp-4)' }}>
        <label className="field">
          <span>{t('search')}</span>
          <input
            className="input" type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('pt_searchHint')}
            aria-label={t('pt_searchHint')} style={{ fontSize: 18, minBlockSize: 48 }}
            onKeyDown={(e) => { if (e.key === 'Enter' && found.data?.length === 1) onOpen(found.data[0]!.id); }}
          />
        </label>
      </div>
      <ErrorBox error={found.error} />
      {!query && <p className="muted" style={{ margin: 0 }}>{t('pt_typeToSearch')}</p>}
      {query && found.data && <HitsTable hits={found.data} empty={t('pt_noHits')} onOpen={onOpen} showMatch />}
    </>
  );
}

function MatchChip({ match }: { match: PartHit['match'] }) {
  const { t } = useI18n();
  const cls = match === 'number' || match === 'barcode' || match === 'code' ? 'ok' : match === 'interchange' ? 'info' : '';
  return <span className={'chip ' + cls}>{t(`pt_match_${match}`)}</span>;
}

function Numbers({ numbers, max = 3 }: { numbers: PartNumber[]; max?: number }) {
  if (!numbers.length) return null;
  const shown = numbers.slice(0, max);
  return (
    <div className="muted small ltr" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
      {shown.map((n) => <span key={n.number} title={n.maker}>{n.kind === 'oem' ? <strong>{n.number}</strong> : n.number}</span>)}
      {numbers.length > max && <span>+{numbers.length - max}</span>}
    </div>
  );
}

function HitsTable({ hits, empty, onOpen, showMatch }: { hits: PartHit[]; empty: string; onOpen(id: string): void; showMatch?: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      {hits.length === 0 && <p className="muted" style={{ padding: '14px 16px', margin: 0 }}>{empty}</p>}
      {hits.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>{t('pt_part')}</th>
              <th>{t('pt_brandOrigin')}</th>
              <th style={{ width: 90 }}>{t('pt_shelf')}</th>
              <th className="amount">{t('available')}</th>
              <th className="amount">{t('pt_retail')}</th>
              <th className="amount">{t('pt_wholesale')}</th>
              {showMatch && <th style={{ width: 120 }} />}
            </tr>
          </thead>
          <tbody>
            {hits.map((h) => (
              <tr key={h.id} className="click" onClick={() => onOpen(h.id)}>
                <td>
                  <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                    <span className="tree-code">{h.code}</span>
                    <strong>{i18n.name(h.name)}</strong>
                    {!h.active && <span className="chip">{t('inactive')}</span>}
                  </div>
                  <Numbers numbers={h.numbers} />
                </td>
                <td>{h.brand}{h.brand && h.origin ? ' · ' : ''}<span className="muted">{originName(i18n, h.origin)}</span></td>
                <td><span className="ltr">{h.shelf}</span></td>
                <td className="amount">
                  <span style={{ color: h.qtyMilli <= 0 ? 'var(--bad)' : undefined }}>{qtyText(i18n, h.qtyMilli)}</span>{' '}
                  <span className="muted small">{unitName(i18n, h.unit)}</span>
                </td>
                <td className="amount">{i18n.money(h.salePrice, h.saleCurrency)}</td>
                <td className="amount">{h.wholesalePrice === null ? '' : i18n.money(h.wholesalePrice, h.saleCurrency)}</td>
                {showMatch && <td><MatchChip match={h.match} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function VehicleFinder({ onOpen }: { onOpen(id: string): void }) {
  const { t } = useI18n();
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [engine, setEngine] = useState('');
  const [q, setQ] = useState('');
  const options = useLoad(() => partsApi.vehicles(make || undefined), [make]);
  const yearNumber = /^\d{4}$/.test(year) ? Number(year) : undefined;
  const filter = useDebounced({ engine: engine.trim(), q: q.trim() });
  const parts = useLoad(
    () => (make ? partsApi.byVehicle({ make, ...(model ? { model } : {}), ...(yearNumber ? { year: yearNumber } : {}), ...(filter.engine ? { engine: filter.engine } : {}), ...(filter.q ? { q: filter.q } : {}) }) : Promise.resolve(null)),
    [make, model, yearNumber, filter.engine, filter.q]
  );
  const years = options.data?.years;
  const yearList = years ? Array.from({ length: Math.min(years.max, new Date().getFullYear() + 1) - years.min + 1 }, (_, i) => years.min + i).reverse() : [];

  return (
    <>
      <ErrorBox error={options.error} />
      {options.data && options.data.makes.length === 0 && <div className="alert info">{t('pt_noFitments')}</div>}
      {options.data && options.data.makes.length > 0 && (
        <div className="card" style={{ padding: 'var(--sp-4)' }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ minInlineSize: 180 }}>
              <span>{t('pt_make')}</span>
              <select className="input" value={make} onChange={(e) => { setMake(e.target.value); setModel(''); }} autoFocus>
                <option value="">{t('pt_chooseMake')}</option>
                {options.data.makes.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="field" style={{ minInlineSize: 180 }}>
              <span>{t('pt_model')}</span>
              <select className="input" value={model} disabled={!make} onChange={(e) => setModel(e.target.value)}>
                <option value="">{t('pt_allModels')}</option>
                {options.data.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="field" style={{ minInlineSize: 120 }}>
              <span>{t('pt_year')}</span>
              <select className="input" value={year} disabled={!make} onChange={(e) => setYear(e.target.value)}>
                <option value="">{t('pt_anyYear')}</option>
                {yearList.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label className="field" style={{ inlineSize: 120 }}>
              <span>{t('pt_engine')}</span>
              <input className="input ltr" value={engine} disabled={!make} placeholder="1.8" onChange={(e) => setEngine(e.target.value)} />
            </label>
            <span className="spacer" />
            <input className="input" style={{ width: 220 }} type="search" disabled={!make} placeholder={t('pt_filterParts')} aria-label={t('pt_filterParts')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      )}
      <ErrorBox error={parts.error} />
      {make && parts.data && <HitsTable hits={parts.data} empty={t('pt_noVehicleParts')} onOpen={onOpen} />}
    </>
  );
}

export function ReorderList({ onOpen }: { onOpen(id: string): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const list = useLoad(() => partsApi.reorder(), []);
  // the last price paid, and to whom: left out by the server for someone who may not see cost
  const cost = (list.data ?? []).some((r) => r.lastPurchase !== undefined);
  const exportCsv = () => downloadCsv('reorder.csv', [
    [t('code'), t('name'), t('pt_numbers'), t('pt_brand'), t('pt_shelf'), t('available'), t('pt_reorderAt'), ...(cost ? [t('supplier'), t('pt_lastPurchase'), t('pt_lastPrice')] : [])],
    ...(list.data ?? []).map((r) => [
      r.code, i18n.name(r.name), r.numbers.map((n) => n.number).join(' / '), r.brand, r.shelf, formatQty(r.qtyMilli), formatQty(r.reorderMilli),
      ...(cost ? [r.lastPurchase?.supplier ?? '', r.lastPurchase?.date ?? '', r.lastPurchase?.unitPrice ?? ''] : [])
    ])
  ]);
  return (
    <>
      <div className="row">
        <span className="spacer" />
        <button type="button" className="btn" disabled={!list.data?.length} onClick={exportCsv}><Icon name="download" size={16} />{t('exportExcel')}</button>
      </div>
      <ErrorBox error={list.error} />
      <div className="card" style={{ overflowX: 'auto' }}>
        {list.data && list.data.length === 0 && <p className="muted" style={{ padding: '14px 16px', margin: 0 }}>{t('pt_reorderEmpty')}</p>}
        {list.data && list.data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>{t('pt_part')}</th>
                <th style={{ width: 90 }}>{t('pt_shelf')}</th>
                <th className="amount">{t('available')}</th>
                <th className="amount">{t('pt_reorderAt')}</th>
                {cost && <th>{t('pt_lastPurchase')}</th>}
              </tr>
            </thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id} className="click" onClick={() => onOpen(r.id)}>
                  <td>
                    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><span className="tree-code">{r.code}</span><strong>{i18n.name(r.name)}</strong></div>
                    <Numbers numbers={r.numbers} />
                  </td>
                  <td><span className="ltr">{r.shelf}</span></td>
                  <td className="amount" style={{ color: 'var(--bad)' }}>{qtyText(i18n, r.qtyMilli)}</td>
                  <td className="amount">{qtyText(i18n, r.reorderMilli)}</td>
                  {cost && <td>
                    {r.lastPurchase
                      ? <><span className="bidi">{r.lastPurchase.supplier}</span><div className="muted small">{i18n.date(r.lastPurchase.date)} · {i18n.money(r.lastPurchase.unitPrice, r.lastPurchase.currency)}</div></>
                      : <span className="muted">—</span>}
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

const ORIGIN_CODES: readonly string[] = PART_ORIGINS;

/** The part card: stock, interchangeable parts, and (with the plan) its details, numbers and cars to edit. */
function PartCard({ id, canEdit, onOpen, onClose, onSaved }: { id: string; canEdit: boolean; onOpen(id: string): void; onClose(): void; onSaved(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const part = useLoad(() => partsApi.part(id), [id]);
  const p = part.data;
  return (
    <Modal title={p ? `${p.code} — ${i18n.name(p.name)}` : t('pt_card')} onClose={onClose}>
      <div className="stack return-modal">
        <ErrorBox error={part.error} />
        {p && (
          <>
            <div className="grid-2">
              <div className="stack" style={{ gap: 6 }}>
                <strong>{t('pt_stockByWarehouse')}</strong>
                {p.stock.length === 0 && <span className="muted">{qtyText(i18n, 0)}</span>}
                {p.stock.map((w) => (
                  <div key={w.warehouseId} className="row" style={{ justifyContent: 'space-between' }}>
                    <span>{i18n.name(w.warehouseName)}</span>
                    <span className="num">{qtyText(i18n, w.qtyMilli)} <span className="muted small">{unitName(i18n, p.unit)}</span></span>
                  </div>
                ))}
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">{t('pt_retail')}</span><strong className="num">{i18n.money(p.salePrice, p.saleCurrency)}</strong></div>
                {p.wholesalePrice !== null && <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">{t('pt_wholesale')}</span><strong className="num">{i18n.money(p.wholesalePrice, p.saleCurrency)}</strong></div>}
                {p.barcode && <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">{t('barcode')}</span><span className="ltr">{p.barcode}</span></div>}
              </div>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <strong>{t('pt_interchangeable')}</strong>
              {p.interchangeable.length === 0 && <span className="muted">{t('pt_noInterchange')}</span>}
              {p.interchangeable.map((h) => (
                <button key={h.id} type="button" className="btn ghost" style={{ justifyContent: 'flex-start' }} onClick={() => onOpen(h.id)}>
                  <span className="tree-code">{h.code}</span>
                  <span>{i18n.name(h.name)}</span>
                  <span className="muted">{h.brand}</span>
                  <span className="spacer" />
                  <span className="num">{qtyText(i18n, h.qtyMilli)}</span>
                  <span className="num">{i18n.money(h.salePrice, h.saleCurrency)}</span>
                </button>
              ))}
            </div>
            <PartForm key={p.id} part={p} canEdit={canEdit} onCancel={onClose} onSaved={() => { part.reload(); onSaved(); }} />
          </>
        )}
      </div>
    </Modal>
  );
}

const emptyNumber = (): PartNumber => ({ number: '', kind: 'alt', maker: '' });
const emptyFitment = (): Fitment => ({ make: '', model: '', yearFrom: null, yearTo: null, engine: '' });
const yearOf = (text: string): number | null => (/^\d{4}$/.test(text.trim()) ? Number(text.trim()) : null);

function PartForm({ part, canEdit, onCancel, onSaved }: { part: PartView; canEdit: boolean; onCancel(): void; onSaved(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [shelf, setShelf] = useState(part.shelf);
  // 1.1: the brand comes from the one brand list (the item's own)
  const [brandId, setBrandId] = useState(part.brandId ?? '');
  const known = !part.origin || ORIGIN_CODES.includes(part.origin);
  const [originCode, setOriginCode] = useState(known ? part.origin : 'custom');
  const [originText, setOriginText] = useState(known ? '' : part.origin);
  const [wholesale, setWholesale] = useState<number | null>(part.wholesalePrice);
  const [reorder, setReorder] = useState<number | null>(part.reorderMilli);
  const [numbers, setNumbers] = useState<PartNumber[]>(part.numbers.length ? part.numbers : [emptyNumber()]);
  const [fitments, setFitments] = useState<Fitment[]>(part.fitments);
  const [years, setYears] = useState(part.fitments.map((f) => ({ from: f.yearFrom?.toString() ?? '', to: f.yearTo?.toString() ?? '' })));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const makes = useLoad(() => partsApi.vehicles(), []);
  const listId = `pt-makes-${part.id}`;

  const setNumber = (i: number, patch: Partial<PartNumber>) => setNumbers(numbers.map((n, k) => (k === i ? { ...n, ...patch } : n)));
  const setFitment = (i: number, patch: Partial<Fitment>) => setFitments(fitments.map((f, k) => (k === i ? { ...f, ...patch } : f)));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await partsApi.save(part.id, {
        details: { shelf, brand: '', brandId: brandId || null, origin: originCode === 'custom' ? originText : originCode, wholesalePrice: wholesale, reorderMilli: reorder },
        numbers: numbers.filter((n) => n.number.trim() || n.maker.trim()),
        fitments: fitments.map((f, i) => ({ ...f, yearFrom: yearOf(years[i]?.from ?? ''), yearTo: yearOf(years[i]?.to ?? '') }))
      });
      toast(t('saved'));
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const ro = !canEdit;
  return (
    <div className="stack">
      <div className="grid-2">
        <label className="field"><span>{t('pt_shelf')}</span><input className="input ltr" value={shelf} disabled={ro} placeholder="A-12" onChange={(e) => setShelf(e.target.value)} /></label>
        <div className="field"><span>{t('pt_brand')}</span><BrandPicker value={brandId} disabled={ro} onChange={setBrandId} /></div>
        <label className="field">
          <span>{t('pt_origin')}</span>
          <select className="input" value={originCode} disabled={ro} onChange={(e) => setOriginCode(e.target.value)}>
            <option value="" />
            {ORIGIN_CODES.map((o) => <option key={o} value={o}>{originName(i18n, o)}</option>)}
            <option value="custom">{t('pt_otherOrigin')}…</option>
          </select>
        </label>
        {originCode === 'custom'
          ? <label className="field"><span>{t('pt_otherOrigin')}</span><input className="input" value={originText} disabled={ro} onChange={(e) => setOriginText(e.target.value)} /></label>
          : <span />}
        <div className="field">
          <span>{t('pt_wholesale')} ({part.saleCurrency === 'IQD' ? t('iqdName') : '$'})</span>
          {ro ? <input className="input amount" disabled value={wholesale === null ? '' : i18n.money(wholesale, part.saleCurrency)} />
            : <AmountInput value={wholesale} currency={part.saleCurrency} onChange={setWholesale} ariaLabel={t('pt_wholesale')} />}
        </div>
        <div className="field">
          <span>{t('pt_reorderAt')}</span>
          {ro ? <input className="input amount" disabled value={reorder === null ? '' : qtyText(i18n, reorder)} />
            : <QtyInput value={reorder} onChange={setReorder} ariaLabel={t('pt_reorderAt')} />}
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>{t('pt_reorderHelp')}</p>

      <div className="stack" style={{ gap: 8 }}>
        <strong>{t('pt_numbers')}</strong>
        {numbers.map((n, i) => (
          <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input ltr" style={{ flex: 2 }} value={n.number} disabled={ro} aria-label={`${t('pt_number')} ${i + 1}`} placeholder="04465-02220" onChange={(e) => setNumber(i, { number: e.target.value })} />
            <div className="track">
              <button type="button" disabled={ro} aria-pressed={n.kind === 'oem'} onClick={() => setNumber(i, { kind: 'oem' })}>{t('pt_oem')}</button>
              <button type="button" disabled={ro} aria-pressed={n.kind === 'alt'} onClick={() => setNumber(i, { kind: 'alt' })}>{t('pt_alt')}</button>
            </div>
            <input className="input ltr" style={{ flex: 1 }} value={n.maker} disabled={ro} aria-label={`${t('pt_maker')} ${i + 1}`} placeholder={t('pt_maker')} onChange={(e) => setNumber(i, { maker: e.target.value })} />
            {!ro && <button type="button" className="btn icon ghost" title={t('pt_remove')} aria-label={t('pt_remove')} onClick={() => setNumbers(numbers.filter((_, k) => k !== i))}><Icon name="x" size={16} /></button>}
          </div>
        ))}
        {!ro && <div><button type="button" className="btn" onClick={() => setNumbers([...numbers, emptyNumber()])}><Icon name="plus" size={16} />{t('pt_addNumber')}</button></div>}
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <strong>{t('pt_fitments')}</strong>
        <datalist id={listId}>{(makes.data?.makes ?? []).map((m) => <option key={m} value={m} />)}</datalist>
        {fitments.map((f, i) => (
          <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input ltr" style={{ flex: 2 }} list={listId} value={f.make} disabled={ro} aria-label={`${t('pt_make')} ${i + 1}`} placeholder="Toyota" onChange={(e) => setFitment(i, { make: e.target.value })} />
            <input className="input ltr" style={{ flex: 2 }} value={f.model} disabled={ro} aria-label={`${t('pt_model')} ${i + 1}`} placeholder="Corolla" onChange={(e) => setFitment(i, { model: e.target.value })} />
            <input className="input ltr num" style={{ inlineSize: 76 }} inputMode="numeric" value={years[i]?.from ?? ''} disabled={ro} aria-label={`${t('pt_yearFrom')} ${i + 1}`} placeholder="2014" onChange={(e) => setYears(years.map((y, k) => (k === i ? { ...y, from: e.target.value } : y)))} />
            <input className="input ltr num" style={{ inlineSize: 76 }} inputMode="numeric" value={years[i]?.to ?? ''} disabled={ro} aria-label={`${t('pt_yearTo')} ${i + 1}`} placeholder="2018" onChange={(e) => setYears(years.map((y, k) => (k === i ? { ...y, to: e.target.value } : y)))} />
            <input className="input ltr" style={{ inlineSize: 70 }} value={f.engine} disabled={ro} aria-label={`${t('pt_engine')} ${i + 1}`} placeholder="1.8" onChange={(e) => setFitment(i, { engine: e.target.value })} />
            {!ro && <button type="button" className="btn icon ghost" title={t('pt_remove')} aria-label={t('pt_remove')} onClick={() => { setFitments(fitments.filter((_, k) => k !== i)); setYears(years.filter((_, k) => k !== i)); }}><Icon name="x" size={16} /></button>}
          </div>
        ))}
        {!ro && <div><button type="button" className="btn" onClick={() => { setFitments([...fitments, emptyFitment()]); setYears([...years, { from: '', to: '' }]); }}><Icon name="plus" size={16} />{t('pt_addFitment')}</button></div>}
      </div>

      <ErrorBox error={error} />
      <div className="row">
        {!ro && <button type="button" className="btn primary" disabled={busy} onClick={save}><Icon name="check" size={16} />{t('save')}</button>}
        <button type="button" className="btn" onClick={onCancel}>{t(ro ? 'back' : 'cancel')}</button>
      </div>
    </div>
  );
}

const HEADINGS: Record<PartImportKind, string> = {
  numbers: 'item_code,number,kind,maker',
  fitments: 'item_code,make,model,year_from,year_to,engine'
};

function ImportDialog({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [kind, setKind] = useState<PartImportKind>('numbers');
  const [text, setText] = useState('');
  const [report, setReport] = useState<PartImportReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const r = await partsApi.import(kind, text, dryRun);
      setReport(r);
      if (r.applied) { toast(t('pt_imported')); onDone(); }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    setText(await file.text());
    setReport(null);
  }

  return (
    <Modal title={t('pt_import')} onClose={onClose}>
      <div className="stack return-modal">
        <div className="field">
          <span>{t('pt_importWhat')}</span>
          <div className="track" style={{ alignSelf: 'flex-start' }}>
            <button type="button" aria-pressed={kind === 'numbers'} onClick={() => { setKind('numbers'); setReport(null); }}>{t('pt_numbers')}</button>
            <button type="button" aria-pressed={kind === 'fitments'} onClick={() => { setKind('fitments'); setReport(null); }}>{t('pt_fitments')}</button>
          </div>
        </div>
        <p className="muted" style={{ margin: 0 }}>{t('pt_importHelp')} <code className="ltr">{HEADINGS[kind]}</code></p>
        <p className="muted small" style={{ margin: 0 }}>{t('pt_importNote')}</p>
        <label className="btn" style={{ alignSelf: 'flex-start' }}>
          <Icon name="doc" size={16} />{t('pt_chooseFile')}
          <input type="file" accept=".csv,.txt,text/csv,text/plain" style={{ display: 'none' }} onChange={(e) => void readFile(e.target.files?.[0])} />
        </label>
        <textarea className="input ltr" rows={10} value={text} aria-label={t('pt_import')} placeholder={HEADINGS[kind]} onChange={(e) => { setText(e.target.value); setReport(null); }} style={{ fontFamily: 'var(--font-num)' }} />
        <ErrorBox error={error} />
        {report && (
          <div className={'alert ' + (report.applied ? 'ok' : 'info')}>
            {t('pt_importResult', { r: report.rows, a: report.added, s: report.skipped, p: report.parts })}
          </div>
        )}
        <div className="row">
          <button type="button" className="btn" disabled={busy || !text.trim()} onClick={() => run(true)}><Icon name="check" size={16} />{t('pt_importCheck')}</button>
          <button type="button" className="btn primary" disabled={busy || !text.trim() || report?.applied === true} onClick={() => run(false)}><Icon name="download" size={16} />{t('pt_importApply')}</button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t(report?.applied ? 'back' : 'cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}
