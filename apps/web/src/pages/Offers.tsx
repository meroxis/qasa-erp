import { useData } from '../components.tsx';
import { useState } from 'react';
import { OFFER_KINDS, formatQty, parseQty, todayIso, type Names, type OfferKind } from '@qasa/core';
import { api } from '../api.ts';
import { EmptyState, ErrorBox, Icon, Modal, downloadCsv, useLoad, usePageNav, useToast } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { go } from '../router.ts';
import { categoriesApi } from '../industry/categories-api.ts';
import { branchesApi } from '../industry/branches-api.ts';
import { offersApi, type OfferInput, type OfferView } from '../industry/offers-api.ts';
import { wholeOf } from '../industry/Loyalty.tsx';
import { LockedFeature } from '../industry/LockedFeature.tsx';

/**
 * العروض — offers a sale gets by itself at the till and on sale invoices (1.7, Starter and up): the list with what is
 * on now, the form for one offer, and the discount each offer gave. Route: `offers` (and `offers/report`).
 */

export type OfferState = 'off' | 'onNow' | 'scheduled' | 'ended';

/** Where an offer stands today: switched off, ended, not yet (or not at this hour or on this day), or on now. */
export function offerState(o: Pick<OfferView, 'active' | 'startsOn' | 'endsOn' | 'weekdays' | 'fromTime' | 'toTime'>, now: Date = new Date()): OfferState {
  if (!o.active) return 'off';
  const today = todayIso(now);
  if (o.endsOn && o.endsOn < today) return 'ended';
  if (o.startsOn && o.startsOn > today) return 'scheduled';
  if (o.weekdays?.length && !o.weekdays.includes(now.getDay())) return 'scheduled';
  if (o.fromTime && o.toTime) {
    const m = now.getHours() * 60 + now.getMinutes();
    const from = Number(o.fromTime.slice(0, 2)) * 60 + Number(o.fromTime.slice(3));
    const to = Number(o.toTime.slice(0, 2)) * 60 + Number(o.toTime.slice(3));
    if (from < to ? !(m >= from && m < to) : !(m >= from || m < to)) return 'scheduled';
  }
  return 'onNow';
}

const STATE_CHIP: Record<OfferState, string> = { onNow: 'ok', scheduled: 'warn', ended: '', off: '' };
const STATE_KEY: Record<OfferState, Key> = { onNow: 'of_onNow', scheduled: 'of_scheduled', ended: 'of_ended', off: 'of_off' };

/** One line saying what an offer gives: "Buy 2 get 1 free", "Any 3 for 10,000 IQD", "750 IQD a unit", "10% off". */
export function offerSummary(i18n: I18n, o: Pick<OfferView, 'kind' | 'buyMilli' | 'getMilli' | 'getPercent' | 'bundleMilli' | 'bundlePrice' | 'price' | 'percentOff'>): string {
  const q = (m: number | null) => i18n.qty(m ?? 0);
  if (o.kind === 'buyGet') {
    const pct = o.getPercent ?? 100;
    return `${i18n.t('of_buyQty')} ${q(o.buyMilli)} · ${i18n.t('of_getQty')} ${q(o.getMilli)}${pct === 100 ? '' : ` (−${i18n.int(pct)}%)`}`;
  }
  if (o.kind === 'bundle') return `${q(o.bundleMilli)} → ${i18n.money(o.bundlePrice ?? 0, 'IQD')}`;
  return o.percentOff !== null ? `−${i18n.int(o.percentOff)}%` : i18n.money(o.price ?? 0, 'IQD');
}

const emptyOffer = (): OfferInput => ({
  code: '', names: { ar: '', en: '', ku: '' }, kind: 'buyGet', priority: 0, exclusive: false, maxPerSale: null,
  startsOn: todayIso(), endsOn: null, weekdays: null, fromTime: null, toTime: null, branchIds: null,
  items: [], categories: [], getItems: [], getCategories: [],
  buyMilli: 2000, getMilli: 1000, getPercent: 100, bundleMilli: 3000, bundlePrice: null, price: null, percentOff: 10, notes: ''
});

function inputOf(o: OfferView): OfferInput {
  const { id: _id, used: _used, createdAt: _c, updatedAt: _u, ...rest } = o;
  return rest;
}

/** 2.0.0: without the plan, what the page does and how to get it (LockedFeature), not its tabs over an empty page. */
export function Offers(props: { admin: boolean; tab: 'list' | 'report' }) {
  const { plan } = useData();
  if (plan && !plan.features.includes('promotions')) return <LockedFeature feature="promotions" icon="tag" />;
  return <OffersPage {...props} />;
}

function OffersPage({ admin, tab }: { admin: boolean; tab: 'list' | 'report' }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  usePageNav({ key: 'of_title', group: 'gSales' });
  const { data, error, reload } = useLoad(() => offersApi.list(), []);
  const [editing, setEditing] = useState<{ id: string | null; input: OfferInput } | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  async function act(fn: () => Promise<unknown>, done: Key = 'saved') {
    setActionError(null);
    try {
      await fn();
      toast(t(done));
      reload();
    } catch (e) {
      setActionError(e);
    }
  }

  const available = data?.available ?? false;
  return (
    <div className="stack">
      <p className="muted no-print" style={{ margin: 0 }}>{t('of_help')}</p>
      {data && !available && <div className="alert info small" role="status">{t('of_needsPlan')}</div>}
      <div className="row no-print">
        <div className="tabs">
          <button type="button" aria-pressed={tab === 'list'} onClick={() => go('offers')}>{t('of_list')}</button>
          <button type="button" aria-pressed={tab === 'report'} onClick={() => go('offers/report')}>{t('of_report')}</button>
        </div>
        <span className="spacer" />
        {tab === 'list' && admin && available && (
          <button type="button" className="btn primary" onClick={() => setEditing({ id: null, input: emptyOffer() })}><Icon name="plus" size={16} />{t('of_new')}</button>
        )}
      </div>
      <ErrorBox error={error ?? actionError} />
      {tab === 'report' ? <OffersReport /> : data && (
        data.offers.length === 0 ? <EmptyState icon="tag" title={t('of_title')} text={t('of_none')} /> : (
          <div className="card">
            <table className="table">
              <thead>
                <tr><th>{t('of_code')}</th><th>{t('of_name')}</th><th>{t('of_kind')}</th><th>{t('of_when')}</th><th /><th className="no-print" /></tr>
              </thead>
              <tbody>
                {data.offers.map((o) => {
                  const state = offerState(o);
                  return (
                    <tr key={o.id}>
                      <td className="ltr">{o.code}</td>
                      <td>{i18n.name(o.names)}{o.used > 0 && <div className="small muted">{t('of_used', { n: i18n.int(o.used) })}</div>}</td>
                      <td>{t(`of_k_${o.kind}` as Key)}<div className="small muted num">{offerSummary(i18n, o)}</div></td>
                      <td className="small">
                        {o.startsOn ? i18n.date(o.startsOn) : '…'} – {o.endsOn ? i18n.date(o.endsOn) : '…'}
                        {o.fromTime && <div className="num">{i18n.digitsOf(`${o.fromTime}–${o.toTime}`)}</div>}
                      </td>
                      <td><span className={`chip ${STATE_CHIP[state]}`}>{t(STATE_KEY[state])}</span></td>
                      <td className="no-print">
                        {admin && (
                          <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                            {available && <button type="button" className="btn small" onClick={() => setEditing({ id: o.id, input: inputOf(o) })}>{t('actEdit')}</button>}
                            {(o.active || available) && (
                              <button type="button" className="btn small" onClick={() => void act(() => offersApi.setActive(o.id, !o.active))}>{t(o.active ? 'of_switchOff' : 'of_switchOn')}</button>
                            )}
                            {o.used === 0 && (
                              <button type="button" className="btn small" aria-label={t('actDelete')}
                                onClick={() => { if (window.confirm(t('of_deleteConfirm'))) void act(() => offersApi.remove(o.id), 'a_delete'); }}><Icon name="trash" size={14} /></button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
      {editing && <OfferForm id={editing.id} initial={editing.input} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast(t('saved')); reload(); }} />}
    </div>
  );
}

function OffersReport() {
  const i18n = useI18n();
  const { t } = i18n;
  const today = todayIso();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const { data, error } = useLoad(() => offersApi.report(from, to), [from, to]);
  const exportCsv = () => data && downloadCsv(`offers-${from}-${to}.csv`, [
    [t('of_code'), t('of_name'), t('of_sales'), t('of_given'), t('of_returned'), t('of_net')],
    ...data.rows.map((r) => [r.code, i18n.name(r.names), r.sales, r.given, r.returned, r.net])
  ]);
  return (
    <div className="stack">
      <div className="row no-print">
        <label className="field"><span>{t('of_startsOn')}</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>{t('of_endsOn')}</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <span className="spacer" />
        <button type="button" className="btn" onClick={exportCsv} disabled={!data?.rows.length}><Icon name="download" size={16} />CSV</button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>{t('of_reportHelp')}</p>
      <ErrorBox error={error} />
      {data && (data.rows.length === 0 ? <EmptyState icon="tag" title={t('of_report')} text={t('of_none')} compact /> : (
        <div className="card">
          <table className="table">
            <thead><tr><th>{t('of_code')}</th><th>{t('of_name')}</th><th className="num">{t('of_sales')}</th><th className="num">{t('of_given')}</th><th className="num">{t('of_returned')}</th><th className="num">{t('of_net')}</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.offerId}>
                  <td className="ltr">{r.code}</td><td>{i18n.name(r.names)}</td>
                  <td className="num">{i18n.int(r.sales)}</td><td className="num">{i18n.money(r.given, 'IQD')}</td>
                  <td className="num">{i18n.money(r.returned, 'IQD')}</td><td className="num"><strong>{i18n.money(r.net, 'IQD')}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={5}>{t('total')}</td><td className="num"><strong>{i18n.money(data.total, 'IQD')}</strong></td></tr></tfoot>
          </table>
        </div>
      ))}
    </div>
  );
}

/** A list of items and categories, picked from the company's (chips to take one off). */
function GoodsPicker({ label, items, categories, onChange }: {
  label: string; items: string[]; categories: string[]; onChange(next: { items: string[]; categories: string[] }): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const allItems = useLoad(() => api.items({ active: 'true' }), []);
  const allCats = useLoad(() => categoriesApi.list({ active: 'true' }), []);
  const itemName = (id: string) => { const it = allItems.data?.find((x) => x.id === id); return it ? `${it.code} · ${i18n.name(it.name)}` : id; };
  const catName = (id: string) => { const c = allCats.data?.find((x) => x.id === id); return c ? i18n.name(c.name) : id; };
  return (
    <fieldset className="stack" style={{ gap: 6 }}>
      <legend>{label}</legend>
      <div className="row" style={{ gap: 6 }}>
        <select className="input" value="" aria-label={t('of_items')} onChange={(e) => { if (e.target.value && !items.includes(e.target.value)) onChange({ items: [...items, e.target.value], categories }); }}>
          <option value="">{t('of_addItem')}…</option>
          {(allItems.data ?? []).map((it) => <option key={it.id} value={it.id}>{it.code} · {i18n.name(it.name)}</option>)}
        </select>
        <select className="input" value="" aria-label={t('of_categories')} onChange={(e) => { if (e.target.value && !categories.includes(e.target.value)) onChange({ items, categories: [...categories, e.target.value] }); }}>
          <option value="">{t('of_categories')}…</option>
          {(allCats.data ?? []).map((c) => <option key={c.id} value={c.id}>{i18n.name(c.name)}</option>)}
        </select>
      </div>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        {categories.map((c) => (
          <button key={`c${c}`} type="button" className="chip" onClick={() => onChange({ items, categories: categories.filter((x) => x !== c) })}>{catName(c)} ✕</button>
        ))}
        {items.map((id) => (
          <button key={`i${id}`} type="button" className="chip" onClick={() => onChange({ items: items.filter((x) => x !== id), categories })}>{itemName(id)} ✕</button>
        ))}
      </div>
    </fieldset>
  );
}

function OfferForm({ id, initial, onClose, onSaved }: { id: string | null; initial: OfferInput; onClose(): void; onSaved(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [o, setO] = useState<OfferInput>(initial);
  const [priceMode, setPriceMode] = useState<'fixed' | 'percent'>(initial.price !== null ? 'fixed' : 'percent');
  const [hours, setHours] = useState(!!initial.fromTime);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const branches = useLoad(() => branchesApi.list().catch(() => ({ available: false, branches: [] })), []);
  const set = (patch: Partial<OfferInput>) => setO((x) => ({ ...x, ...patch }));
  const qtyField = (key: 'buyMilli' | 'getMilli' | 'bundleMilli', label: Key) => (
    <label className="field"><span>{t(label)}</span>
      <input className="input num" inputMode="decimal" defaultValue={o[key] === null ? '' : formatQty(o[key]!)} onChange={(e) => set({ [key]: parseQty(e.target.value) } as Partial<OfferInput>)} />
    </label>
  );
  const wholeField = (key: 'getPercent' | 'bundlePrice' | 'price' | 'percentOff' | 'priority' | 'maxPerSale', label: Key) => (
    <label className="field"><span>{t(label)}</span>
      <input className="input num" inputMode="numeric" value={o[key] === null ? '' : String(o[key])}
        onChange={(e) => { const n = wholeOf(e.target.value); set({ [key]: key === 'priority' ? n ?? 0 : n } as Partial<OfferInput>); }} />
    </label>
  );
  const name = (lang: keyof Names, label: string) => (
    <label className="field"><span>{t('of_name')} · {label}</span>
      <input className="input" dir={lang === 'en' ? 'ltr' : 'rtl'} value={o.names[lang]} maxLength={120} onChange={(e) => set({ names: { ...o.names, [lang]: e.target.value } })} />
    </label>
  );

  async function save() {
    setBusy(true);
    setError(null);
    const body: OfferInput = {
      ...o, code: o.code.trim(),
      price: o.kind === 'price' && priceMode === 'fixed' ? o.price : null,
      percentOff: o.kind === 'price' && priceMode === 'percent' ? o.percentOff : null,
      fromTime: hours ? o.fromTime : null, toTime: hours ? o.toTime : null,
      weekdays: o.weekdays?.length ? o.weekdays : null,
      branchIds: o.branchIds?.length ? o.branchIds : null
    };
    try {
      if (id) await offersApi.update(id, body);
      else await offersApi.create(body);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const days = o.weekdays ?? [];
  return (
    <Modal title={t(id ? 'of_edit' : 'of_new')} onClose={onClose}>
      <div className="stack" style={{ minWidth: 'min(640px, 90vw)' }}>
        <div className="grid2">
          <label className="field"><span>{t('of_code')}</span><input className="input ltr" value={o.code} maxLength={24} onChange={(e) => set({ code: e.target.value })} /></label>
          <label className="field"><span>{t('of_kind')}</span>
            <select className="input" value={o.kind} onChange={(e) => set({ kind: e.target.value as OfferKind })}>
              {OFFER_KINDS.map((k) => <option key={k} value={k}>{t(`of_k_${k}` as Key)}</option>)}
            </select>
          </label>
          {name('ar', 'العربية')}{name('en', 'English')}{name('ku', 'کوردی')}
        </div>
        <p className="muted small" style={{ margin: 0 }}>{t(`of_k_${o.kind}_help` as Key)}</p>
        <GoodsPicker label={t(o.kind === 'buyGet' ? 'of_goodsBuy' : 'of_goods')} items={o.items} categories={o.categories} onChange={(g) => set(g)} />
        {o.kind === 'buyGet' && (
          <>
            <div className="grid2">{qtyField('buyMilli', 'of_buyQty')}{qtyField('getMilli', 'of_getQty')}{wholeField('getPercent', 'of_getPercent')}</div>
            <GoodsPicker label={t('of_goodsGet')} items={o.getItems} categories={o.getCategories} onChange={(g) => set({ getItems: g.items, getCategories: g.categories })} />
          </>
        )}
        {o.kind === 'bundle' && <div className="grid2">{qtyField('bundleMilli', 'of_bundleQty')}{wholeField('bundlePrice', 'of_bundlePrice')}</div>}
        {o.kind === 'price' && (
          <div className="grid2">
            <label className="field"><span>{t('of_priceMode')}</span>
              <select className="input" value={priceMode} onChange={(e) => setPriceMode(e.target.value as 'fixed' | 'percent')}>
                <option value="percent">{t('of_pricePercent')}</option>
                <option value="fixed">{t('of_priceFixed')}</option>
              </select>
            </label>
            {priceMode === 'fixed' ? wholeField('price', 'of_priceFixed') : wholeField('percentOff', 'of_pricePercent')}
          </div>
        )}
        <fieldset className="stack" style={{ gap: 6 }}>
          <legend>{t('of_when')}</legend>
          <div className="grid2">
            <label className="field"><span>{t('of_startsOn')}</span><input className="input" type="date" value={o.startsOn ?? ''} onChange={(e) => set({ startsOn: e.target.value || null })} /></label>
            <label className="field"><span>{t('of_endsOn')}</span><input className="input" type="date" value={o.endsOn ?? ''} onChange={(e) => set({ endsOn: e.target.value || null })} /></label>
          </div>
          <div className="small">{t('of_days')}</div>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {[6, 0, 1, 2, 3, 4, 5].map((d) => (
              <button key={d} type="button" className="chip" aria-pressed={days.includes(d)}
                onClick={() => set({ weekdays: days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort() })}>{t(`of_d${d}` as Key)}</button>
            ))}
          </div>
          <label className="check"><input type="checkbox" checked={hours} onChange={(e) => { setHours(e.target.checked); if (e.target.checked && !o.fromTime) set({ fromTime: '16:00', toTime: '18:00' }); }} /> {t('of_hours')}</label>
          {hours && (
            <div className="grid2">
              <label className="field"><span>{t('of_fromTime')}</span><input className="input" type="time" value={o.fromTime ?? ''} onChange={(e) => set({ fromTime: e.target.value || null })} /></label>
              <label className="field"><span>{t('of_toTime')}</span><input className="input" type="time" value={o.toTime ?? ''} onChange={(e) => set({ toTime: e.target.value || null })} /></label>
            </div>
          )}
          {branches.data?.available && branches.data.branches.length > 0 && (
            <>
              <div className="small">{t('of_branches')}</div>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {branches.data.branches.map((b) => {
                  const on = o.branchIds?.includes(b.id) ?? false;
                  return <button key={b.id} type="button" className="chip" aria-pressed={on} onClick={() => set({ branchIds: on ? (o.branchIds ?? []).filter((x) => x !== b.id) : [...(o.branchIds ?? []), b.id] })}>{b.name}</button>;
                })}
              </div>
            </>
          )}
        </fieldset>
        <fieldset className="stack" style={{ gap: 6 }}>
          <legend>{t('of_rules')}</legend>
          <div className="grid2">{wholeField('priority', 'of_priority')}{wholeField('maxPerSale', 'of_maxPerSale')}</div>
          <p className="muted small" style={{ margin: 0 }}>{t('of_maxPerSale_help')}</p>
          <label className="check"><input type="checkbox" checked={o.exclusive} onChange={(e) => set({ exclusive: e.target.checked })} /> {t('of_exclusive')}</label>
          <p className="muted small" style={{ margin: 0 }}>{t('of_exclusive_help')}</p>
          <label className="field"><span>{t('of_notes')}</span><input className="input" value={o.notes ?? ''} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} /></label>
        </fieldset>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{t('save')}</button>
        </div>
      </div>
    </Modal>
  );
}
