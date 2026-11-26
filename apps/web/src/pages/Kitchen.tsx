import { useEffect, useMemo, useRef, useState } from 'react';
import { formatQty, parseQty, RS_STATIONS, type RsStation, type RsTicketMode, type UnitCode } from '@qasa/core';
import { api } from '../api.ts';
import { EmptyState, ErrorBox, Icon, Modal, SearchCombo, useLoad, useToast, type PickOption } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { categoriesApi } from '../industry/categories-api.ts';
import { unitLabel } from '../industry/units.ts';
import { restaurantApi, type KitchenSettings, type KitchenTicketView, type RecipeView } from '../industry/restaurant-api.ts';
import type { RestaurantPeople } from './Restaurant.tsx';
import '../pos.css';

/**
 * Restaurants and cafés, the kitchen's side (2.1): the kitchen screen (what each station cooks, the oldest first, with
 * "Ready"), the kitchen settings (paper tickets or the screen only, and which station makes each category), and the
 * recipes (what one of a dish takes of each ingredient: recipes.ts on the server takes them out of stock when it sells).
 */

/** How often the kitchen screen reads again: a new ticket shows within seconds. */
export const KITCHEN_REFRESH_MS = 5_000;
/** A ticket waiting this long turns amber, then red. */
export const LATE_MINUTES = 15;
export const VERY_LATE_MINUTES = 25;

export const stationKey = (s: RsStation | 'all'): Key => (s === 'all' ? 'rs_all' : (`rs_st_${s}` as Key));

const STATION_STORE = 'qasa.kitchen.station';
function savedStation(): RsStation | 'all' {
  try {
    const v = window.localStorage.getItem(STATION_STORE);
    return v === 'kitchen' || v === 'grill' || v === 'bar' ? v : 'all';
  } catch { return 'all'; }
}

/** Minutes since a moment (never below none). */
export const minutesAgo = (iso: string, now: number): number => Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
/** How late a ticket is: on time, late, very late. */
export const lateness = (minutes: number): '' | 'late' | 'very-late' => (minutes >= VERY_LATE_MINUTES ? 'very-late' : minutes >= LATE_MINUTES ? 'late' : '');

/** A short beep when a new ticket comes (a browser that allows no sound stays quiet). */
function beep(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => { void ctx.close(); };
  } catch { /* no sound here */ }
}

/* ---------------- the kitchen screen ---------------- */

export function KitchenScreen({ who }: { who: RestaurantPeople }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [station, setStation] = useState<RsStation | 'all'>(savedStation);
  const view = useLoad(() => restaurantApi.kitchen(station), [station]);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => { view.reload(); setNow(Date.now()); }, KITCHEN_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [station]); // eslint-disable-line react-hooks/exhaustive-deps
  // a beep for a ticket not seen before (none for what was there when the screen opened)
  useEffect(() => {
    const cooking = view.data?.cooking;
    if (!cooking) return;
    const keys = new Set(cooking.map(ticketKey));
    if (seen.current && [...keys].some((k) => !seen.current!.has(k))) beep();
    seen.current = keys;
  }, [view.data]);

  const pick = (s: RsStation | 'all') => {
    setStation(s);
    seen.current = null;
    try { window.localStorage.setItem(STATION_STORE, s); } catch { /* kept for this visit only */ }
  };
  const mark = async (tk: KitchenTicketView, ready: boolean) => {
    setBusy(ticketKey(tk));
    try {
      await restaurantApi.ready(tk.orderId, tk.ticket, tk.station, ready);
      view.reload();
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const data = view.data;
  return (
    <div className="stack rs-kitchen">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="pos-cats" role="tablist" aria-label={t('rs_station')}>
          {(['all', ...RS_STATIONS] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={station === s} className={'btn' + (station === s ? ' primary' : '')} onClick={() => pick(s)}>{t(stationKey(s))}</button>
          ))}
        </div>
        <span className="spacer" />
        {data && <span className="chip info">{t('rs_cookingN', { n: i18n.int(data.cooking.length) })}</span>}
      </div>
      {view.error && !data ? <ErrorBox error={view.error} /> : !data ? null : data.cooking.length === 0 ? (
        <EmptyState icon="chef" title={t('rs_kitchenEmpty')} text={t('rs_kitchenEmptyText')} />
      ) : (
        <div className="rs-kitchen-grid">
          {data.cooking.map((tk) => {
            const minutes = minutesAgo(tk.sentAt, now);
            return (
              <article key={ticketKey(tk)} className={'card rs-kticket ' + lateness(minutes)} aria-label={`${whereOf(i18n, tk)} · ${t('rs_ticketN', { n: i18n.int(tk.ticket) })}`}>
                <header className="rs-kticket-head">
                  <strong>{whereOf(i18n, tk)}</strong>
                  <span className="num">{t('rs_minutes', { n: i18n.int(minutes) })}</span>
                </header>
                <div className="muted small">#{tk.number} · {t('rs_ticketN', { n: i18n.int(tk.ticket) })}{station === 'all' ? ` · ${t(stationKey(tk.station))}` : ''} · {tk.by}</div>
                <ul className="rs-kticket-lines">
                  {tk.lines.map((l) => (
                    <li key={l.id} className={l.voided ? 'voided' : ''}>
                      <span className="num rs-kqty">{formatQty(l.qtyMilli)}×</span> <span>{i18n.name(l.name)}</span>
                      {l.voided && <span className="chip bad small">{t('rs_kCancelled')}</span>}
                      {l.note && <div className="rs-ticket-note">» {l.note}</div>}
                    </li>
                  ))}
                </ul>
                {tk.notes && <div className="small muted">{tk.notes}</div>}
                {who.waiter && (
                  <button type="button" className="btn primary pos-touch" disabled={busy !== null} onClick={() => void mark(tk, true)}>
                    <Icon name="check" size={18} />{t('rs_markReady')}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
      {data && data.done.length > 0 && (
        <section className="stack" style={{ gap: 6 }} aria-label={t('rs_kitchenDone')}>
          <h3 style={{ margin: 0 }}>{t('rs_kitchenDone')}</h3>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {data.done.map((tk) => (
              <span key={ticketKey(tk)} className="chip ok rs-kdone">
                {whereOf(i18n, tk)} · {t('rs_ticketN', { n: i18n.int(tk.ticket) })}
                {who.waiter && !tk.lines.some((l) => l.served) && (
                  <button type="button" className="btn ghost small" disabled={busy !== null} onClick={() => void mark(tk, false)}>{t('rs_notReady')}</button>
                )}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const ticketKey = (tk: KitchenTicketView) => `${tk.orderId}|${tk.ticket}|${tk.station}`;
export function whereOf(i18n: I18n, tk: Pick<KitchenTicketView, 'tableName' | 'kind'>): string {
  return tk.tableName ? i18n.t('rs_table', { t: tk.tableName }) : tk.kind === 'delivery' ? i18n.t('rs_delivery') : i18n.t('rs_takeaway');
}

/* ---------------- the kitchen settings ---------------- */

/** Paper tickets or the screen only, and which station makes each category's dishes (an admin's). */
export function KitchenSetup({ onClose }: { onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const info = useLoad(() => restaurantApi.info(), []);
  const cats = useLoad(() => categoriesApi.list({ active: 'true' }), []);
  const [draft, setDraft] = useState<KitchenSettings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (info.data && !draft) setDraft(info.data.kitchen); }, [info.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const stationOf = (categoryId: string): RsStation => draft?.stations.find((s) => s.categoryId === categoryId)?.station ?? 'kitchen';
  const setStation = (categoryId: string, station: RsStation) => setDraft((d) => d && ({
    ...d, stations: [...d.stations.filter((s) => s.categoryId !== categoryId), ...(station === 'kitchen' ? [] : [{ categoryId, station }])]
  }));
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await restaurantApi.saveKitchen(draft);
      toast(t('rs_kitchenSaved'));
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={t('rs_kitchenSettings')} onClose={onClose}>
      {!draft ? null : (
        <div className="stack">
          <fieldset className="stack" style={{ gap: 6 }}>
            <legend>{t('rs_ticketsHow')}</legend>
            {(['print', 'screen'] as RsTicketMode[]).map((m) => (
              <label key={m} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <input type="radio" name="rs-tickets" checked={draft.tickets === m} onChange={() => setDraft({ ...draft, tickets: m })} />
                <span><strong>{t(`rs_tickets_${m}` as Key)}</strong><br /><span className="muted small">{t(`rs_tickets_${m}_help` as Key)}</span></span>
              </label>
            ))}
          </fieldset>
          <fieldset className="stack" style={{ gap: 6 }}>
            <legend>{t('rs_stationsTitle')}</legend>
            <p className="muted small" style={{ margin: 0 }}>{t('rs_stationsHelp')}</p>
            {(cats.data ?? []).length === 0 ? <p className="muted small">{t('rs_noCategories')}</p> : (
              <table className="table">
                <tbody>
                  {(cats.data ?? []).map((c) => (
                    <tr key={c.id}>
                      <td>{i18n.name(c.name)}</td>
                      <td>
                        <select className="input" aria-label={`${t('rs_station')} — ${i18n.name(c.name)}`} value={stationOf(c.id)} onChange={(e) => setStation(c.id, e.target.value as RsStation)}>
                          {RS_STATIONS.map((s) => <option key={s} value={s}>{t(stationKey(s))}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </fieldset>
          {error !== null && <ErrorBox error={error} />}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{t('save')}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- recipes ---------------- */

interface PartDraft { ingredientId: string; qty: string }

/** "0.25" kg → 250 thousandths; null when it is no quantity. */
export function partMilli(text: string): number | null {
  const q = parseQty(text.trim());
  return q !== null && q > 0 ? q : null;
}

/** What one plate brings in over what goes into it, as a share of its price (null: no price or no cost). */
export function marginOf(price: number, cost: number | null | undefined): number | null {
  if (cost === null || cost === undefined || price <= 0) return null;
  return Math.round(((price - cost) / price) * 100);
}

export function Recipes({ who }: { who: RestaurantPeople }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const items = useLoad(() => api.items({ active: 'true' }), []);
  const recipes = useLoad(() => restaurantApi.recipes(), []);
  const [q, setQ] = useState('');
  const [dishId, setDishId] = useState<string | null>(null);
  const [parts, setParts] = useState<PartDraft[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const editable = who.admin || who.stock;

  const dishes = useMemo(() => (items.data ?? []).filter((it) => !it.trackStock && it.salePrice > 0), [items.data]);
  const ingredients = useMemo(() => (items.data ?? []).filter((it) => it.trackStock && !it.trackBatches), [items.data]);
  const byId = useMemo(() => new Map((items.data ?? []).map((it) => [it.id, it])), [items.data]);
  const recipeOf = useMemo(() => new Map((recipes.data ?? []).map((r) => [r.itemId, r])), [recipes.data]);
  const options = useMemo((): PickOption[] => ingredients.filter((it) => !parts.some((p) => p.ingredientId === it.id)).map((it) => ({
    id: it.id, code: it.code, label: i18n.name(it.name), hint: unitLabel(i18n, it.unit as UnitCode), search: `${it.barcode ?? ''} ${it.name.ar} ${it.name.en} ${it.name.ku}`
  })), [ingredients, parts, i18n]);

  const open = (id: string) => {
    setDishId(id);
    setError(null);
    const r = recipeOf.get(id);
    setParts(r ? r.parts.map((p) => ({ ingredientId: p.ingredientId, qty: formatQty(p.qtyMilli) })) : []);
  };
  const save = async (list: PartDraft[]) => {
    if (!dishId) return;
    const bad = list.findIndex((p) => partMilli(p.qty) === null);
    if (bad >= 0) { setError(new Error(t('rs_recipeQtyBad', { n: i18n.int(bad + 1) }))); return; }
    setBusy(true);
    setError(null);
    try {
      await restaurantApi.saveRecipe(dishId, list.map((p) => ({ ingredientId: p.ingredientId, qtyMilli: partMilli(p.qty)! })));
      recipes.reload();
      toast(t('rs_recipeSaved'));
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  if (items.error && !items.data) return <ErrorBox error={items.error} />;
  const query = q.trim().toLowerCase();
  const shown = dishes.filter((d) => !query || `${d.code} ${d.name.ar} ${d.name.en} ${d.name.ku}`.toLowerCase().includes(query)).slice(0, 300);
  const dish = dishId ? byId.get(dishId) : undefined;
  const saved: RecipeView | undefined = dishId ? recipeOf.get(dishId) : undefined;
  return (
    <div className="rs-recipes">
      <section className="card pad stack" aria-label={t('rs_dishes')}>
        <p className="muted small" style={{ margin: 0 }}>{t('rs_recipesHelp')}</p>
        <input className="input" type="search" placeholder={t('rs_searchMenu')} aria-label={t('rs_searchMenu')} value={q} onChange={(e) => setQ(e.target.value)} />
        {items.data && dishes.length === 0 ? <EmptyState icon="cup" title={t('rs_dishes')} text={t('rs_noDishes')} /> : (
          <ul className="rs-dish-list">
            {shown.map((d) => {
              const r = recipeOf.get(d.id);
              return (
                <li key={d.id}>
                  <button type="button" className={'rs-dish' + (dishId === d.id ? ' on' : '')} onClick={() => open(d.id)}>
                    <span>{i18n.name(d.name)}</span>
                    {r ? <span className="chip ok small">{t('rs_recipeN', { n: i18n.int(r.parts.length) })}</span> : <span className="chip small">{t('rs_noRecipe')}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="card pad stack" aria-label={t('rs_recipe')}>
        {!dish ? <p className="muted">{t('rs_pickDish')}</p> : (
          <>
            <h3 style={{ margin: 0 }}>{i18n.name(dish.name)}</h3>
            {parts.length === 0 && <p className="muted small" style={{ margin: 0 }}>{t('rs_recipeEmpty')}</p>}
            {parts.length > 0 && (
              <table className="table">
                <thead><tr><th>{t('rs_ingredient')}</th><th>{t('rs_perDish')}</th><th>{t('rs_inStock')}</th>{saved?.cost !== undefined && <th>{t('rs_cost')}</th>}<th /></tr></thead>
                <tbody>
                  {parts.map((p, i) => {
                    const it = byId.get(p.ingredientId);
                    const was = saved?.parts.find((x) => x.ingredientId === p.ingredientId);
                    return (
                      <tr key={p.ingredientId}>
                        <td>{it ? i18n.name(it.name) : p.ingredientId}</td>
                        <td>
                          <span className="row" style={{ gap: 4 }}>
                            <input className="input num" style={{ width: 90 }} inputMode="decimal" aria-label={`${t('rs_perDish')} — ${it ? i18n.name(it.name) : ''}`} value={p.qty} disabled={!editable}
                              aria-invalid={partMilli(p.qty) === null} onChange={(e) => setParts((list) => list.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                            <span className="muted small">{it ? unitLabel(i18n, it.unit as UnitCode) : ''}</span>
                          </span>
                        </td>
                        <td className="num">{was ? formatQty(was.stockMilli) : '—'}</td>
                        {saved?.cost !== undefined && <td className="num">{was?.cost != null ? i18n.money(was.cost, 'IQD') : '—'}</td>}
                        <td>{editable && <button type="button" className="btn ghost small" aria-label={t('rs_remove')} onClick={() => setParts((list) => list.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {editable && (
              <SearchCombo value="" options={options} placeholder={`${t('rs_addIngredient')}…`} ariaLabel={t('rs_addIngredient')}
                onChange={(id) => { if (id) setParts((list) => [...list, { ingredientId: id, qty: '1' }]); }} />
            )}
            {saved?.cost !== undefined && saved.cost !== null && (
              <div className="row small" style={{ justifyContent: 'space-between' }}>
                <span>{t('rs_plateCost', { c: i18n.money(saved.cost, 'IQD') })}</span>
                {marginOf(dish.salePrice, saved.cost) !== null && <strong>{t('rs_margin', { p: i18n.int(marginOf(dish.salePrice, saved.cost)!) })}</strong>}
              </div>
            )}
            {error !== null && <ErrorBox error={error} />}
            {editable && (
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn primary" disabled={busy} onClick={() => void save(parts)}>{t('save')}</button>
                {saved && <button type="button" className="btn ghost" disabled={busy} onClick={() => { setParts([]); void save([]); }}>{t('rs_recipeRemove')}</button>}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
