import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatQty, normalizeForSearch, rsEvenShares, rsLineAmount, toWesternDigits, type Names } from '@qasa/core';
import { api, ApiError, type InvoiceView, type ItemView } from '../api.ts';
import { EmptyState, ErrorBox, errorMessages, Icon, Modal, useData, useLoad, useToast } from '../components.tsx';
import { useI18n, type I18n } from '../i18n.ts';
import { go } from '../router.ts';
import { categoriesApi } from '../industry/categories-api.ts';
import { posApi, type ShiftView } from '../industry/pos-api.ts';
import { printAlone } from '../industry/printing.ts';
import { inWindowsTill, kickDrawer, thisTill } from '../industry/till.ts';
import { printReceipt, Receipt } from '../pos/Receipt.tsx';
import {
  restaurantApi, type AreaView, type FloorView, type OrderLineView, type OrderSummary, type OrderView, type PayResult, type TableView, type TicketView
} from '../industry/restaurant-api.ts';
import { KitchenSetup } from './Kitchen.tsx';
import '../pos.css';

/**
 * Restaurants and cafés (2.1): the room (each area's tables, free or with their order, and the open takeaway and
 * delivery orders), and one order: the menu to pick from, its lines, the kitchen, the bill and paying at the till.
 * Server side: packages/server/src/restaurant.ts. Taking orders is for whoever sells ('pos' or 'sales'), paying for
 * the cashier on their open shift, cancelling what the kitchen has for a supervisor, the room for an admin.
 */

export interface RestaurantPeople {
  admin: boolean;
  /** may take orders (pos or sales) */
  waiter: boolean;
  /** may take the money (pos) */
  cashier: boolean;
  /** may cancel what the kitchen has (posSupervise) */
  supervisor: boolean;
  /** may change a dish's recipe (stock, as the items) */
  stock: boolean;
}

/** How often the room and an order are read again while open (other PCs take orders too). */
const REFRESH_MS = 10_000;

/** Dinars typed, in any digits (Arabic and Kurdish keyboards type ٠١٢…), separators left out: 0 for nothing. */
export const wholeDinars = (text: string): number => Math.round(Number(toWesternDigits(text).replace(/[^\d]/g, '')) || 0);
const minutesSince = (at: string, now: number) => Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
const qtyText = (milli: number) => formatQty(milli);
/** The time on a ticket or a bill, 24-hour, in the digits the app shows. */
const clock = (i18n: I18n, at: Date) => i18n.digitsOf(`${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`);

/* ---------------- the room ---------------- */

export function Restaurant({ who }: { who: RestaurantPeople }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const floor = useLoad(() => restaurantApi.floor(), []);
  const [area, setArea] = useState<string>('all');
  const [opening, setOpening] = useState<TableView | null>(null);
  const [delivery, setDelivery] = useState(false);
  const [setup, setSetup] = useState(false);
  const [kitchenSetup, setKitchenSetup] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => { floor.reload(); setNow(Date.now()); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (floor.error && !floor.data) return <ErrorBox error={floor.error} />;
  const data = floor.data;
  if (!data) return null;
  const areas = data.areas;
  const shown = area === 'all' ? areas : areas.filter((a) => a.id === area);

  const openTakeaway = async () => {
    try {
      const o = await restaurantApi.open({ kind: 'takeaway' });
      go(`restaurant-order/${o.id}`);
    } catch (e) { toast(errorText(i18n, e)); }
  };

  return (
    <div className="stack rs-floor">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {areas.length > 1 && (
          <div className="pos-cats" role="tablist" aria-label={t('rs_area')}>
            <button type="button" role="tab" aria-selected={area === 'all'} className={'btn' + (area === 'all' ? ' primary' : '')} onClick={() => setArea('all')}>{t('rs_all')}</button>
            {areas.map((a) => (
              <button key={a.id} type="button" role="tab" aria-selected={area === a.id} className={'btn' + (area === a.id ? ' primary' : '')} onClick={() => setArea(a.id)}>
                {i18n.name(a.name)}{a.family && <span className="chip info small" style={{ marginInlineStart: 6 }}>{t('rs_family')}</span>}
              </button>
            ))}
          </div>
        )}
        <span className="spacer" />
        {who.waiter && data.available && <button type="button" className="btn" onClick={() => void openTakeaway()}><Icon name="cup" size={16} />{t('rs_newTakeaway')}</button>}
        {who.waiter && data.available && <button type="button" className="btn" onClick={() => setDelivery(true)}><Icon name="truck" size={16} />{t('rs_newDelivery')}</button>}
        <button type="button" className="btn ghost" onClick={() => go('kitchen')}><Icon name="chef" size={16} />{t('rs_kitchenScreen')}</button>
        {(who.admin || who.stock) && <button type="button" className="btn ghost" onClick={() => go('recipes')}><Icon name="clipboard" size={16} />{t('rs_recipes')}</button>}
        {who.admin && data.available && <button type="button" className="btn ghost" onClick={() => setKitchenSetup(true)}><Icon name="printer" size={16} />{t('rs_kitchenSettings')}</button>}
        {who.admin && data.available && areas.length > 0 && <button type="button" className="btn ghost" onClick={() => setSetup(true)}><Icon name="sliders" size={16} />{t('rs_setup')}</button>}
      </div>

      {areas.length === 0 ? (
        who.admin && data.available ? <QuickRoom onDone={() => floor.reload()} /> : <EmptyState icon="cup" title={t('rs_noRoom')} text={t('rs_noRoomAsk')} />
      ) : (
        <div className="rs-floor-body">
          <div className="stack" style={{ gap: 16 }}>
            {shown.map((a) => (
              <section key={a.id} className="stack" style={{ gap: 8 }} aria-label={i18n.name(a.name)}>
                {areas.length > 1 && area === 'all' && <h3 style={{ margin: 0 }}>{i18n.name(a.name)}{a.family && <span className="chip info small" style={{ marginInlineStart: 8 }}>{t('rs_family')}</span>}</h3>}
                <div className="rs-tables">
                  {a.tables.map((tb) => (
                    <TableTile key={tb.id} table={tb} order={tb.order} now={now}
                      onOpen={() => (tb.order ? go(`restaurant-order/${tb.order.id}`) : who.waiter && data.available ? setOpening(tb) : undefined)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
          <aside className="card stack rs-side" aria-label={t('rs_otherOrders')}>
            <h3 style={{ margin: 0 }}>{t('rs_otherOrders')}</h3>
            {data.orders.length === 0 ? <p className="muted small" style={{ margin: 0 }}>{t('rs_noOtherOrders')}</p> : data.orders.map((o) => (
              <button key={o.id} type="button" className="rs-other" onClick={() => go(`restaurant-order/${o.id}`)}>
                <span><Icon name={o.kind === 'delivery' ? 'truck' : 'cup'} size={16} /> <strong>#{o.number}</strong> {o.kind === 'delivery' ? t('rs_delivery') : t('rs_takeaway')}</span>
                <span className="muted small">{[o.partyName ?? o.phone ?? '', t('rs_minutes', { n: i18n.int(minutesSince(o.openedAt, now)) })].filter(Boolean).join(' · ')}</span>
                <strong className="num">{i18n.money(o.total, 'IQD')}</strong>
              </button>
            ))}
          </aside>
        </div>
      )}

      {opening && <OpenTable table={opening} onClose={() => setOpening(null)} onBusy={() => { setOpening(null); floor.reload(); }} />}
      {delivery && <NewDelivery onClose={() => setDelivery(false)} />}
      {setup && <RoomSetup onClose={() => { setSetup(false); floor.reload(); }} />}
      {kitchenSetup && <KitchenSetup onClose={() => setKitchenSetup(false)} />}
    </div>
  );
}

function TableTile({ table, order, now, onOpen }: { table: TableView; order: OrderSummary | null; now: number; onOpen(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const label = order
    ? `${t('rs_table', { t: table.name })}: ${i18n.money(order.paid > 0 ? order.unpaid : order.total, 'IQD')}${order.billPrintedAt ? `, ${t('rs_billPrinted')}` : ''}${order.ready > 0 ? `, ${t('rs_readyN', { n: i18n.int(order.ready) })}` : ''}`
    : `${t('rs_table', { t: table.name })}: ${t('rs_free')}`;
  return (
    <button type="button" className={'rs-table' + (order ? ' busy' : '') + (order?.billPrintedAt ? ' billed' : '') + (order && order.ready > 0 ? ' ready' : '')} onClick={onOpen} aria-label={label}>
      <span className="rs-table-name">{table.name}</span>
      {order ? (
        <>
          {/* part of it paid (a guest paid what they had): what is left */}
          <strong className="num">{order.paid > 0 ? `${t('rs_left')} ` : ''}{i18n.money(order.paid > 0 ? order.unpaid : order.total, 'IQD')}</strong>
          <span className="small">{[order.guests ? t('rs_guests', { n: i18n.int(order.guests) }) : '', t('rs_minutes', { n: i18n.int(minutesSince(order.openedAt, now)) })].filter(Boolean).join(' · ')}</span>
          {order.unsent > 0 && <span className="chip warn small">{t('rs_unsent', { n: i18n.int(order.unsent) })}</span>}
          {/* 2.1: dishes the kitchen made ready, waiting to go to the table */}
          {order.ready > 0 && <span className="chip ok small rs-ready-chip"><Icon name="bell" size={12} /> {t('rs_readyN', { n: i18n.int(order.ready) })}</span>}
          {order.billPrintedAt && <span className="chip info small">{t('rs_billPrinted')}</span>}
        </>
      ) : (
        <span className="muted small">{t('rs_free')} · {i18n.int(table.seats)}</span>
      )}
    </button>
  );
}

function OpenTable({ table, onClose, onBusy }: { table: TableView; onClose(): void; onBusy(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [guests, setGuests] = useState(Math.min(table.seats, 2));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const o = await restaurantApi.open({ kind: 'table', tableId: table.id, guests });
      go(`restaurant-order/${o.id}`);
    } catch (e) {
      // someone opened it a moment ago: theirs is the order
      const other = e instanceof ApiError && e.code === 'rs_table_busy' ? (e.details as { orderId?: string } | null)?.orderId : null;
      if (other) go(`restaurant-order/${other}`); else setError(e);
      if (!other) onBusy();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t('rs_openTable', { t: table.name })} onClose={onClose}>
      <div className="stack">
        <span>{t('rs_howMany')}</span>
        <div className="pos-cats" role="group" aria-label={t('rs_howMany')}>
          {Array.from({ length: Math.max(8, table.seats) }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" className={'btn rs-num' + (guests === n ? ' primary' : '')} aria-pressed={guests === n} onClick={() => setGuests(n)}>{i18n.int(n)}</button>
          ))}
        </div>
        {error !== null && <ErrorBox error={error} />}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void open()}>{t('rs_openTable', { t: table.name })}</button>
        </div>
      </div>
    </Modal>
  );
}

function NewDelivery({ onClose }: { onClose(): void }) {
  const { t } = useI18n();
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const o = await restaurantApi.open({ kind: 'delivery', ...(phone.trim() ? { phone: phone.trim() } : {}), ...(address.trim() ? { address: address.trim() } : {}) });
      go(`restaurant-order/${o.id}`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={t('rs_newDelivery')} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>{t('rs_phone')}</span><input className="input ltr" inputMode="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="field"><span>{t('rs_address')}</span><textarea className="input" maxLength={300} rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        {error !== null && <ErrorBox error={error} />}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void open()}>{t('rs_newDelivery')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** A room to start with: the hall's tables and the family section's. */
function QuickRoom({ onDone }: { onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [tables, setTables] = useState(10);
  const [family, setFamily] = useState(4);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try { await restaurantApi.quickRoom(tables, family); onDone(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <div className="card stack" style={{ maxWidth: 520 }}>
      <h3 style={{ margin: 0 }}>{t('rs_setup')}</h3>
      <p className="muted" style={{ margin: 0 }}>{t('rs_noRoomAdmin')}</p>
      <label className="field"><span>{t('rs_hallTables')}</span><input className="input num" type="number" min={1} max={60} value={tables} onChange={(e) => setTables(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} /></label>
      <label className="field"><span>{t('rs_familyTables')}</span><input className="input num" type="number" min={0} max={30} value={family} onChange={(e) => setFamily(Math.max(0, Math.min(30, Number(e.target.value) || 0)))} /></label>
      {error !== null && <ErrorBox error={error} />}
      <div><button type="button" className="btn primary" disabled={busy} onClick={() => void make()}>{t('rs_makeRoom')}</button></div>
      <p className="muted small" style={{ margin: 0 }}>{t('rs_kitchenHint')}</p>
    </div>
  );
}

/** The room's areas and tables: names, family section, seats, in use or not. */
function RoomSetup({ onClose }: { onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const info = useLoad(() => restaurantApi.info(), []);
  const [error, setError] = useState<unknown>(null);
  const save = async (work: () => Promise<unknown>) => {
    setError(null);
    try { await work(); info.reload(); } catch (e) { setError(e); }
  };
  const areas = info.data?.areas ?? [];
  const tables = info.data?.tables ?? [];
  return (
    <Modal title={t('rs_areas')} onClose={onClose}>
      <div className="stack">
        {error !== null && <ErrorBox error={error} />}
        {areas.map((a) => (
          <AreaRows key={a.id} area={a} tables={tables.filter((x) => x.areaId === a.id)} onSave={save} />
        ))}
        <button type="button" className="btn" onClick={() => void save(() => restaurantApi.saveArea(null, { name: { ar: `${t('rs_area')} ${areas.length + 1}`, en: `${t('rs_area')} ${areas.length + 1}`, ku: `${t('rs_area')} ${areas.length + 1}` } }))}>
          <Icon name="plus" size={16} />{t('rs_addArea')}
        </button>
        <p className="muted small" style={{ margin: 0 }}>{t('rs_kitchenHint')}</p>
      </div>
    </Modal>
  );
}

function AreaRows({ area, tables, onSave }: { area: AreaView; tables: TableView[]; onSave(work: () => Promise<unknown>): Promise<void> }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [name, setName] = useState<Names>(area.name);
  return (
    <fieldset className="stack" style={{ gap: 6 }}>
      <legend>{i18n.name(area.name)}</legend>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {(['ar', 'en', 'ku'] as const).map((l) => (
          <input key={l} className="input" style={{ flex: 1, minWidth: 110 }} lang={l === 'ku' ? 'ckb' : l} dir={l === 'en' ? 'ltr' : 'rtl'} maxLength={60} aria-label={`${t('rs_area')} (${l})`}
            value={name[l]} onChange={(e) => setName({ ...name, [l]: e.target.value })} onBlur={() => { if (name[l] !== area.name[l]) void onSave(() => restaurantApi.saveArea(area.id, { name })); }} />
        ))}
      </div>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <label className="row"><input type="checkbox" checked={area.family} onChange={(e) => void onSave(() => restaurantApi.saveArea(area.id, { name: area.name, family: e.target.checked }))} /> {t('rs_family')}</label>
        <label className="row"><input type="checkbox" checked={area.active} onChange={(e) => void onSave(() => restaurantApi.saveArea(area.id, { name: area.name, active: e.target.checked }))} /> {t('rs_inUse')}</label>
      </div>
      <table className="table compact">
        <thead><tr><th>{t('rs_tableName')}</th><th>{t('rs_seats')}</th><th>{t('rs_inUse')}</th></tr></thead>
        <tbody>
          {tables.map((tb) => (
            <tr key={tb.id}>
              <td><input className="input" style={{ maxWidth: 120 }} maxLength={20} defaultValue={tb.name} aria-label={t('rs_tableName')}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== tb.name) void onSave(() => restaurantApi.saveTable(tb.id, { areaId: area.id, name: v })); }} /></td>
              <td><input className="input num" style={{ maxWidth: 80 }} type="number" min={1} max={99} defaultValue={tb.seats} aria-label={t('rs_seats')}
                onBlur={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= 99 && v !== tb.seats) void onSave(() => restaurantApi.saveTable(tb.id, { areaId: area.id, name: tb.name, seats: v })); }} /></td>
              <td><input type="checkbox" checked={tb.active} aria-label={t('rs_inUse')} onChange={(e) => void onSave(() => restaurantApi.saveTable(tb.id, { areaId: area.id, name: tb.name, active: e.target.checked }))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <button type="button" className="btn small" onClick={() => void onSave(() => restaurantApi.saveTable(null, { areaId: area.id, name: nextTableName(tables) }))}>
          <Icon name="plus" size={14} />{t('rs_addTable')}
        </button>
      </div>
    </fieldset>
  );
}

/** The next table's name: one more than the highest number among them ("F4" after "F3"), else the count plus one. */
export function nextTableName(tables: readonly { name: string }[]): string {
  let best: { prefix: string; n: number } | null = null;
  for (const tb of tables) {
    const m = /^(.*?)(\d+)$/.exec(tb.name.trim());
    if (m && (!best || Number(m[2]) > best.n)) best = { prefix: m[1]!, n: Number(m[2]) };
  }
  return best ? `${best.prefix}${best.n + 1}` : String(tables.length + 1);
}

/* ---------------- one order ---------------- */

interface DraftLine { key: number; item: ItemView; qtyMilli: number; note: string }

/** An item's price in dinars as the server takes it (a dollar price at the company's rate). */
export function dinarPriceOf(item: Pick<ItemView, 'salePrice' | 'saleCurrency'>, rateX100: number): number {
  return item.saleCurrency === 'IQD' ? item.salePrice : Math.round((item.salePrice * rateX100) / 10000);
}

export function RestaurantOrder({ id, who }: { id: string; who: RestaurantPeople }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings } = useData();
  const rate = settings?.defaultRateX100 ?? 142_000;
  const order = useLoad(() => restaurantApi.order(id), [id]);
  const items = useLoad(() => api.items({ active: 'true' }), []);
  const categories = useLoad(() => categoriesApi.list({ active: 'true' }), []);
  const [cat, setCat] = useState<string>('');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // 2.1: the tickets to print, one per station, one after the other (none when the kitchen works from its screen only)
  const [queue, setQueue] = useState<TicketView[]>([]);
  const info = useLoad(() => restaurantApi.info(), []);
  const onPaper = (info.data?.kitchen.tickets ?? 'print') === 'print';
  const [dialog, setDialog] = useState<null | 'bill' | 'pay' | 'part' | 'details' | 'move' | 'merge' | 'cancel' | { void: OrderLineView }>(null);
  const keyRef = useRef(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  // other PCs change it too: read again while nothing here waits and no window (paying, the bill) is open on it
  useEffect(() => {
    const timer = window.setInterval(() => { if (!draftRef.current.length && dialogRef.current === null) order.reload(); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const menu = useMemo(() => (items.data ?? []).filter((it) => it.salePrice > 0 && it.unit !== undefined), [items.data]);
  const cats = useMemo(() => (categories.data ?? []).filter((c) => !c.parentId && menu.some((it) => it.categoryId === c.id || (categories.data ?? []).some((s) => s.parentId === c.id && s.id === it.categoryId))), [categories.data, menu]);
  const inCat = (it: ItemView) => !cat || it.categoryId === cat || (categories.data ?? []).some((s) => s.parentId === cat && s.id === it.categoryId);
  const query = normalizeForSearch(q);
  const tiles = menu.filter((it) => inCat(it) && (!query || normalizeForSearch(`${it.code} ${it.barcode ?? ''} ${it.name.ar} ${it.name.en} ${it.name.ku}`).includes(query))).slice(0, 120);

  if (order.error && !order.data) return <ErrorBox error={order.error} />;
  const o = order.data;
  if (!o) return null;
  const open = o.status === 'open';
  const draftTotal = draft.reduce((s, d) => s + rsLineAmount(d.qtyMilli, dinarPriceOf(d.item, rate)), 0);
  const toSend = o.unsent + draft.length;

  const add = (it: ItemView) => {
    setDraft((list) => {
      const same = list.find((d) => d.item.id === it.id && !d.note);
      if (same) return list.map((d) => (d === same ? { ...d, qtyMilli: d.qtyMilli + 1000 } : d));
      return [...list, { key: ++keyRef.current, item: it, qtyMilli: 1000, note: '' }];
    });
  };
  /** The new dishes onto the order (not sent yet), so every PC sees them: before sending, paying or leaving. */
  const saveDraft = async (): Promise<OrderView | null> => {
    const lines = draftRef.current;
    if (!lines.length) return null;
    const saved = await restaurantApi.add(o.id, lines.map((d) => ({ itemId: d.item.id, qtyMilli: d.qtyMilli, ...(d.note.trim() ? { note: d.note.trim() } : {}) })));
    setDraft([]);
    return saved;
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); } catch (e) { setError(e); order.reload(); } finally { setBusy(false); }
  };
  const send = () => run(async () => {
    await saveDraft();
    const sent = await restaurantApi.send(o.id);
    order.reload();
    if (sent.tickets.length) {
      if (onPaper) setQueue(sent.tickets);
      toast(t('rs_sent', { n: i18n.int(sent.tickets[0]!.ticket) }));
    }
  });
  const back = () => run(async () => { await saveDraft(); go('restaurant'); });
  const lineCall = (work: () => Promise<OrderView>) => run(async () => { await work(); order.reload(); });

  const title = o.tableName ? t('rs_table', { t: o.tableName }) : o.kind === 'delivery' ? t('rs_delivery') : t('rs_takeaway');
  return (
    <div className="rs-order">
      <section className="card stack rs-menu" aria-label={t('rs_menu')}>
        <input className="input" type="search" placeholder={t('rs_searchMenu')} aria-label={t('rs_searchMenu')} value={q} onChange={(e) => setQ(e.target.value)} />
        {cats.length > 0 && (
          <div className="pos-cats">
            <button type="button" className={'btn small' + (!cat ? ' primary' : '')} onClick={() => setCat('')}>{t('rs_all')}</button>
            {cats.map((c) => <button key={c.id} type="button" className={'btn small' + (cat === c.id ? ' primary' : '')} onClick={() => setCat(c.id)}>{i18n.name(c.name)}</button>)}
          </div>
        )}
        {menu.length === 0 && items.data ? <EmptyState icon="cup" title={t('rs_menu')} text={t('rs_noMenu')} /> : (
          <div className="rs-tiles">
            {tiles.map((it) => (
              <button key={it.id} type="button" className="rs-tile" disabled={!open || !who.waiter} onClick={() => add(it)}>
                <span className="rs-tile-name">{i18n.name(it.name)}</span>
                <span className="num small">{i18n.money(dinarPriceOf(it, rate), 'IQD')}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card stack rs-ticket" aria-label={title}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn ghost small" onClick={() => void back()} aria-label={t('rs_back')}><Icon name="chevron" size={16} />{t('rs_back')}</button>
          <h2 style={{ margin: 0, flex: 1 }}>{title} <span className="muted small">#{o.number}</span></h2>
          {o.status !== 'open' && <span className={'chip ' + (o.status === 'closed' ? 'ok' : 'bad')}>{t(o.status === 'closed' ? 'rs_closed' : 'rs_cancelled')}</span>}
        </div>
        <div className="muted small">
          {[o.guests ? t('rs_guests', { n: i18n.int(o.guests) }) : '', o.partyName ?? '', o.phone ?? '', t('rs_by', { n: o.openedBy })].filter(Boolean).join(' · ')}
          {o.address && <div>{o.address}</div>}
          {o.notes && <div>{o.notes}</div>}
        </div>

        {o.lines.length === 0 && draft.length === 0 ? <p className="muted">{t('rs_noLines')}</p> : (
          <ul className="rs-lines">
            {o.lines.map((l) => (
              <li key={l.id} className={'rs-line' + (l.voided ? ' voided' : '') + (l.ticket === null ? ' unsent' : '')}>
                <div className="rs-line-main">
                  <span className="num">{qtyText(l.qtyMilli)} ×</span>
                  <span className="rs-line-name">{i18n.name(l.name)}{l.note && <span className="muted small"> · {l.note}</span>}</span>
                  <strong className="num">{i18n.money(l.amount, 'IQD')}</strong>
                </div>
                <div className="row small" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {l.voided ? <span className="chip bad small">{t('rs_voided', { r: l.voided.reason })}</span>
                    : l.ticket === null ? <span className="chip warn small">{t('rs_notSent')}</span>
                      : <span className="chip small">{t('rs_ticketN', { n: i18n.int(l.ticket) })}</span>}
                  {!l.voided && l.readyAt && !l.servedAt && <span className="chip ok small"><Icon name="bell" size={12} /> {t('rs_ready')}</span>}
                  {!l.voided && l.servedAt && <span className="chip small">{t('rs_servedChip')}</span>}
                  {l.paidMilli > 0 && <span className="chip ok small">{t('rs_paid')} {qtyText(l.paidMilli)}</span>}
                  <span className="spacer" />
                  {open && who.waiter && l.ticket === null && !l.voided && (
                    <>
                      <button type="button" className="btn ghost small" aria-label="−" disabled={busy || l.qtyMilli <= 1000} onClick={() => void lineCall(() => restaurantApi.changeLine(o.id, l.id, { qtyMilli: l.qtyMilli - 1000 }))}>−</button>
                      <button type="button" className="btn ghost small" aria-label="+" disabled={busy} onClick={() => void lineCall(() => restaurantApi.changeLine(o.id, l.id, { qtyMilli: l.qtyMilli + 1000 }))}>+</button>
                      <button type="button" className="btn ghost small" disabled={busy} aria-label={t('rs_remove')} onClick={() => void lineCall(() => restaurantApi.removeLine(o.id, l.id))}><Icon name="x" size={14} /></button>
                    </>
                  )}
                  {open && who.supervisor && l.ticket !== null && !l.voided && l.unpaidMilli > 0 && (
                    <button type="button" className="btn ghost small" onClick={() => setDialog({ void: l })}>{t('rs_voidLine')}</button>
                  )}
                </div>
              </li>
            ))}
            {draft.map((d) => (
              <li key={d.key} className="rs-line new">
                <div className="rs-line-main">
                  <span className="num">{qtyText(d.qtyMilli)} ×</span>
                  <span className="rs-line-name">{i18n.name(d.item.name)}</span>
                  <strong className="num">{i18n.money(rsLineAmount(d.qtyMilli, dinarPriceOf(d.item, rate)), 'IQD')}</strong>
                </div>
                <div className="row small" style={{ gap: 6 }}>
                  <input className="input small" style={{ flex: 1 }} maxLength={120} placeholder={t('rs_notePh')} aria-label={t('rs_note')} value={d.note}
                    onChange={(e) => setDraft((list) => list.map((x) => (x.key === d.key ? { ...x, note: e.target.value } : x)))} />
                  <button type="button" className="btn ghost small" aria-label="−" onClick={() => setDraft((list) => list.flatMap((x) => (x.key !== d.key ? [x] : x.qtyMilli > 1000 ? [{ ...x, qtyMilli: x.qtyMilli - 1000 }] : [])))}>−</button>
                  <button type="button" className="btn ghost small" aria-label="+" onClick={() => setDraft((list) => list.map((x) => (x.key === d.key ? { ...x, qtyMilli: x.qtyMilli + 1000 } : x)))}>+</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="pos-total"><span>{t('rs_total')}</span><strong className="num">{i18n.money(o.total + draftTotal, 'IQD')}</strong></div>
        {o.paid > 0 && <div className="row small" style={{ justifyContent: 'space-between' }}><span>{t('rs_paid')} {i18n.money(o.paid, 'IQD')}</span><strong>{t('rs_left')} {i18n.money(o.unpaid, 'IQD')}</strong></div>}
        {error !== null && <ErrorBox error={error} />}

        {open && (
          <div className="stack" style={{ gap: 8 }}>
            {who.waiter && <button type="button" className="btn primary pos-touch" disabled={busy || toSend === 0} onClick={() => void send()}><Icon name="printer" size={18} />{t('rs_sendKitchen', { n: i18n.int(toSend) })}</button>}
            {who.waiter && o.ready > 0 && (
              <button type="button" className="btn pos-touch" disabled={busy} onClick={() => void lineCall(() => restaurantApi.served(o.id))}><Icon name="bell" size={18} />{t('rs_served', { n: i18n.int(o.ready) })}</button>
            )}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn" disabled={busy || o.unpaid + draftTotal <= 0} onClick={() => void run(async () => { await saveDraft(); order.reload(); setDialog('bill'); })}><Icon name="receipt" size={16} />{t('rs_printBill')}</button>
              {who.cashier && <button type="button" className="btn primary" disabled={busy || o.unpaid + draftTotal <= 0} onClick={() => void run(async () => { await saveDraft(); order.reload(); setDialog('pay'); })}><Icon name="wallet" size={16} />{t('rs_payAll')}</button>}
              {who.cashier && <button type="button" className="btn" disabled={busy || o.unpaid <= 0 || draft.length > 0} onClick={() => setDialog('part')}>{t('rs_payPart')}</button>}
            </div>
            {who.waiter && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn ghost small" onClick={() => setDialog('details')}>{t('rs_details')}</button>
                {o.kind === 'table' && <button type="button" className="btn ghost small" onClick={() => setDialog('move')}>{t('rs_move')}</button>}
                {o.kind === 'table' && o.paid === 0 && <button type="button" className="btn ghost small" onClick={() => setDialog('merge')}>{t('rs_merge')}</button>}
                {o.paid === 0 && <button type="button" className="btn ghost small" onClick={() => setDialog('cancel')}>{t('rs_cancelOrder')}</button>}
                {o.tickets > 0 && <button type="button" className="btn ghost small" onClick={() => void run(async () => setQueue((await restaurantApi.ticket(o.id, o.tickets)).tickets))}>{t('rs_ticketAgain')}</button>}
              </div>
            )}
          </div>
        )}
        {!open && who.supervisor && o.status === 'closed' && o.unpaid > 0 && (
          <button type="button" className="btn" onClick={() => void lineCall(() => restaurantApi.reopen(o.id))}>{t('rs_reopen')}</button>
        )}
      </section>

      {queue[0] && <KitchenTicket key={`${queue[0].ticket}-${queue[0].station}-${queue.length}`} ticket={queue[0]} onPrinted={() => setQueue((q) => q.slice(1))} />}
      {dialog === 'bill' && <BillDialog order={o} onClose={() => { setDialog(null); order.reload(); }} />}
      {(dialog === 'pay' || dialog === 'part') && (
        <PayDialog order={o} part={dialog === 'part'} onPaper={onPaper} onClose={(closed) => { setDialog(null); if (closed) go('restaurant'); else order.reload(); }} />
      )}
      {dialog === 'details' && <DetailsDialog order={o} onClose={() => { setDialog(null); order.reload(); }} />}
      {(dialog === 'move' || dialog === 'merge') && <TablePick order={o} merge={dialog === 'merge'} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <ReasonDialog title={t('rs_cancelOrder')} onClose={() => setDialog(null)} onDone={async (reason) => { await restaurantApi.cancel(o.id, reason); go('restaurant'); }} />}
      {typeof dialog === 'object' && dialog !== null && 'void' in dialog && (
        <ReasonDialog title={`${t('rs_voidLine')}: ${i18n.name(dialog.void.name)}`} maxQty={dialog.void.unpaidMilli} onClose={() => setDialog(null)}
          onDone={async (reason, qtyMilli) => {
            const r = await restaurantApi.voidLine(o.id, dialog.void.id, { reason, ...(qtyMilli ? { qtyMilli } : {}) });
            setDialog(null);
            order.reload();
            if (onPaper) setQueue([r.ticket]);
          }} />
      )}
    </div>
  );
}

function ReasonDialog({ title, maxQty, onClose, onDone }: { title: string; maxQty?: number; onClose(): void; onDone(reason: string, qtyMilli?: number): Promise<void> }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [reason, setReason] = useState('');
  const [qty, setQty] = useState(maxQty ? String(maxQty / 1000) : '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const qtyMilli = maxQty ? Math.round(Number(toWesternDigits(qty).replace(/[٫,]/g, '.')) * 1000) : undefined;
  const ok = reason.trim().length > 0 && (!maxQty || (qtyMilli! > 0 && qtyMilli! <= maxQty));
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        {maxQty !== undefined && <label className="field"><span>{t('rs_voidQty')}</span><input className="input num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>}
        <label className="field"><span>{t('rs_reason')}</span><input className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
        {error !== null && <ErrorBox error={error} />}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn danger" disabled={!ok || busy} onClick={() => { setBusy(true); void onDone(reason.trim(), qtyMilli).catch(setError).finally(() => setBusy(false)); }}>{t('confirm')}</button>
        </div>
      </div>
    </Modal>
  );
}

function DetailsDialog({ order, onClose }: { order: OrderView; onClose(): void }) {
  const { t } = useI18n();
  const [guests, setGuests] = useState(order.guests ? String(order.guests) : '');
  const [phone, setPhone] = useState(order.phone ?? '');
  const [address, setAddress] = useState(order.address ?? '');
  const [notes, setNotes] = useState(order.notes ?? '');
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    try {
      const n = Math.round(Number(guests));
      await restaurantApi.update(order.id, { guests: n >= 1 && n <= 99 ? n : null, phone: phone.trim() || null, address: address.trim() || null, notes: notes.trim() || null });
      onClose();
    } catch (e) { setError(e); }
  };
  return (
    <Modal title={t('rs_details')} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>{t('rs_howMany')}</span><input className="input num" type="number" min={1} max={99} value={guests} onChange={(e) => setGuests(e.target.value)} /></label>
        <label className="field"><span>{t('rs_phone')}</span><input className="input ltr" inputMode="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="field"><span>{t('rs_address')}</span><input className="input" maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        <label className="field"><span>{t('rs_notes')}</span><input className="input" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {error !== null && <ErrorBox error={error} />}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" onClick={() => void save()}>{t('save')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Another table: a free one to move to, or one with an order to join. */
function TablePick({ order, merge, onClose }: { order: OrderView; merge: boolean; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const floor = useLoad(() => restaurantApi.floor(), []);
  const [error, setError] = useState<unknown>(null);
  const pick = async (table: TableView & { order: OrderSummary | null }) => {
    try {
      if (merge && table.order) { await restaurantApi.merge(order.id, table.order.id); go(`restaurant-order/${table.order.id}`); return; }
      await restaurantApi.move(order.id, table.id);
      onClose();
      go(`restaurant-order/${order.id}`);
    } catch (e) { setError(e); }
  };
  return (
    <Modal title={merge ? t('rs_merge') : t('rs_move')} onClose={onClose}>
      <div className="stack">
        {merge && <p className="muted" style={{ margin: 0 }}>{t('rs_mergeHelp')}</p>}
        {(floor.data?.areas ?? []).map((a) => {
          const list = a.tables.filter((tb) => tb.id !== order.tableId && (merge ? !!tb.order : !tb.order));
          return list.length ? (
            <div key={a.id} className="stack" style={{ gap: 6 }}>
              <strong>{i18n.name(a.name)}</strong>
              <div className="rs-tables">{list.map((tb) => <TableTile key={tb.id} table={tb} order={tb.order} now={Date.now()} onOpen={() => void pick(tb)} />)}</div>
            </div>
          ) : null;
        })}
        {error !== null && <ErrorBox error={error} />}
      </div>
    </Modal>
  );
}

/* ---------------- the bill ---------------- */

function BillDialog({ order, onClose }: { order: OrderView; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [people, setPeople] = useState(order.guests && order.guests > 1 ? order.guests : 1);
  const [printing, setPrinting] = useState(false);
  const shares = rsEvenShares(order.unpaid, people);
  const print = async () => {
    setPrinting(true);
    try {
      await printAlone('receipt', 'rs-printing-bill');
      await restaurantApi.bill(order.id).catch(() => undefined);
      onClose();
    } finally { setPrinting(false); }
  };
  return (
    <Modal title={t('rs_printBill')} onClose={onClose}>
      <div className="stack">
        <div className="pos-total"><span>{t('rs_left')}</span><strong className="num">{i18n.money(order.unpaid, 'IQD')}</strong></div>
        <label className="field"><span>{t('rs_splitEvenly')}</span>
          <input className="input num" type="number" min={1} max={99} value={people} onChange={(e) => setPeople(Math.max(1, Math.min(99, Math.round(Number(e.target.value)) || 1)))} />
        </label>
        {people > 1 && shares.length > 0 && <strong>{t('rs_eachPays', { a: i18n.money(shares[0]!, 'IQD') })}</strong>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={printing} onClick={() => void print()}><Icon name="printer" size={16} />{t('rs_printBill')}</button>
        </div>
      </div>
      <Bill order={order} people={people} />
    </Modal>
  );
}

/** The bill as it prints: hidden on screen, on the receipt printer's roll. */
export function Bill({ order, people }: { order: OrderView; people: number }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const lines = order.lines.filter((l) => !l.voided && l.unpaidMilli > 0);
  const shares = rsEvenShares(order.unpaid, people);
  return createPortal(
    <div className="rs-bill-host" dir={i18n.dir} lang={i18n.lang === 'ku' ? 'ckb' : i18n.lang}>
      <div className="pos-receipt">
        <div className="pos-r-center pos-r-company"><strong>{settings ? i18n.name(settings.companyName) : ''}</strong></div>
        <div className="pos-r-center"><strong>{t('rs_bill')}</strong></div>
        <div className="pos-r-row small"><span>{order.tableName ? t('rs_table', { t: order.tableName }) : order.kind === 'delivery' ? t('rs_delivery') : t('rs_takeaway')}</span><span>#{order.number}</span></div>
        <div className="pos-r-row small"><span>{i18n.date(new Date().toISOString().slice(0, 10))}</span><span>{clock(i18n, new Date())}</span></div>
        <div className="pos-r-sep" />
        {lines.map((l) => (
          <div key={l.id} className="pos-r-line">
            <div className="pos-r-row"><span>{qtyText(l.unpaidMilli)} × {i18n.name(l.name)}</span><span className="num">{i18n.money(rsLineAmount(l.unpaidMilli, l.unitPrice), 'IQD')}</span></div>
          </div>
        ))}
        <div className="pos-r-sep" />
        <div className="pos-r-row pos-r-total"><span>{t('rs_total')}</span><span className="num">{i18n.money(order.unpaid, 'IQD')}</span></div>
        {people > 1 && shares.length > 0 && <div className="pos-r-row"><span>{t('rs_splitEvenly')} {i18n.int(people)}</span><span className="num">{i18n.money(shares[0]!, 'IQD')}</span></div>}
        <div className="pos-r-sep" />
        <div className="pos-r-center small">{t('rs_billNotReceipt')}</div>
      </div>
    </div>,
    document.body
  );
}

/* ---------------- the kitchen ticket ---------------- */

/** A kitchen ticket: drawn, printed on its station's printer (the kitchen's, the grill's or the bar's), then gone. */
function KitchenTicket({ ticket, onPrinted }: { ticket: TicketView; onPrinted(): void }) {
  const done = useRef(onPrinted);
  done.current = onPrinted;
  useEffect(() => {
    const timer = window.setTimeout(() => { void printAlone(ticket.station, 'rs-printing-ticket').finally(() => done.current()); }, 60);
    return () => window.clearTimeout(timer);
  }, [ticket]);
  return <TicketPaper ticket={ticket} />;
}

function TicketPaper({ ticket }: { ticket: TicketView }) {
  const i18n = useI18n();
  return createPortal(
    <div className="rs-ticket-host" dir={i18n.dir} lang={i18n.lang === 'ku' ? 'ckb' : i18n.lang}><TicketContent ticket={ticket} /></div>,
    document.body
  );
}

/** The station's name on top of its ticket. */
const stationTitle = (t: I18n['t'], station: TicketView['station']): string => t(station === 'grill' ? 'rs_ticket_grill' : station === 'bar' ? 'rs_ticket_bar' : 'rs_kitchen');

/** What a kitchen ticket says: where, which order and ticket, when and by whom, each dish with its note. */
export function TicketContent({ ticket }: { ticket: TicketView }) {
  const i18n = useI18n();
  const { t } = i18n;
  const where = ticket.tableName ? t('rs_table', { t: ticket.tableName }) : ticket.kind === 'delivery' ? t('rs_delivery') : t('rs_takeaway');
  return (
    <div className="pos-receipt rs-ticket-paper">
      {/* the station it is for (2.1): the kitchen, the grill or the drinks bar, on its own printer */}
      <div className="pos-r-center rs-ticket-head">{ticket.type === 'cancel' ? `✕ ${t('rs_kitchenCancel')} · ${stationTitle(t, ticket.station)}` : stationTitle(t, ticket.station)}</div>
      <div className="pos-r-center rs-ticket-where">{where}</div>
      <div className="pos-r-row small"><span>#{ticket.number} · {t('rs_ticketN', { n: i18n.int(ticket.ticket) })}</span><span>{clock(i18n, new Date(ticket.at))}</span></div>
      <div className="pos-r-row small"><span>{ticket.by}</span><span>{ticket.guests ? t('rs_guests', { n: i18n.int(ticket.guests) }) : ''}</span></div>
      <div className="pos-r-sep" />
      {ticket.lines.map((l, i) => (
        <div key={i} className="rs-ticket-line">
          <div><strong className="num">{qtyText(l.qtyMilli)}</strong> × <strong>{i18n.name(l.name)}</strong></div>
          {l.note && <div className="rs-ticket-note">» {l.note}</div>}
          {l.reason && <div className="rs-ticket-note">{t('rs_voided', { r: l.reason })}</div>}
        </div>
      ))}
      {ticket.notes && <><div className="pos-r-sep" /><div className="small">{ticket.notes}</div></>}
    </div>
  );
}

/* ---------------- paying at the till ---------------- */

function PayDialog({ order, part, onPaper, onClose }: { order: OrderView; part: boolean; onPaper: boolean; onClose(closed: boolean): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const current = useLoad(() => posApi.current(thisTill() || null), []);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<'cash' | 'account'>('cash');
  const [discountText, setDiscountText] = useState('');
  const [handedText, setHandedText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // what was paid, as it was at that moment (the order is read again meanwhile: what is left changes)
  const [paid, setPaid] = useState<(PayResult & { due: number; change: number | null }) | null>(null);
  const [queue, setQueue] = useState<TicketView[]>([]);
  const open = order.lines.filter((l) => !l.voided && l.unpaidMilli > 0);
  const selected = part ? open.filter((l) => (chosen[l.id] ?? 0) > 0).map((l) => ({ line: l, qtyMilli: chosen[l.id]! })) : open.map((l) => ({ line: l, qtyMilli: l.unpaidMilli }));
  const gross = selected.reduce((s, c) => s + rsLineAmount(c.qtyMilli, c.line.unitPrice), 0);
  const discount = Math.max(0, Math.min(gross, wholeDinars(discountText)));
  const due = gross - discount;
  const handed = wholeDinars(handedText);
  const shift: ShiftView | null = current.data?.shift ?? null;

  const pay = async () => {
    if (!shift || due < 0 || !selected.length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await restaurantApi.pay(order.id, {
        shiftId: shift.id,
        ...(part ? { lines: selected.map((c) => ({ lineId: c.line.id, qtyMilli: c.qtyMilli })) } : {}),
        ...(discount ? { discount } : {}),
        ...(method === 'account' ? { payments: [{ method: 'account' as const, amount: due }] } : {}),
        ...(method === 'cash' && handed >= due && due > 0 ? { tendered: handed } : {})
      });
      setPaid({ ...result, due, change: method === 'cash' && handed > due ? handed - due : null });
      if (onPaper && result.tickets.length) setQueue(result.tickets);
      if (method === 'cash' && due > 0 && inWindowsTill()) void kickDrawer();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  if (paid) {
    return (
      <Modal title={t('rs_pay')} onClose={() => onClose(paid.order.status !== 'open')}>
        <div className="stack">
          <div className="pos-done" role="status">
            <div className="pos-done-head"><Icon name="check" size={22} /><strong>{t('rs_paidDone', { n: paid.invoice.number ?? '' })}</strong></div>
            {paid.change !== null && <div className="pos-giveback"><span>{t('rs_change')}</span><strong className="num">{i18n.money(paid.change, 'IQD')}</strong></div>}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={() => void printReceipt()}><Icon name="printer" size={16} />{t('rs_printReceipt')}</button>
            <button type="button" className="btn primary" onClick={() => onClose(paid.order.status !== 'open')}>{t('confirm')}</button>
          </div>
        </div>
        <Receipt invoice={paid.invoice as InvoiceView} shift={paid.shift} rounding={paid.rounding} />
        {queue[0] && <KitchenTicket key={`${queue[0].ticket}-${queue[0].station}-${queue.length}`} ticket={queue[0]} onPrinted={() => setQueue((q) => q.slice(1))} />}
      </Modal>
    );
  }
  return (
    <Modal title={part ? t('rs_payPart') : t('rs_payAll')} onClose={() => onClose(false)}>
      <div className="stack">
        {current.data && !shift && (
          <div className="stack">
            <p style={{ margin: 0 }}>{t('rs_needShift')}</p>
            <div><button type="button" className="btn primary" onClick={() => go('pos')}>{t('rs_openTill')}</button></div>
          </div>
        )}
        {part && (
          <div className="stack" style={{ gap: 6 }}>
            <p className="muted" style={{ margin: 0 }}>{t('rs_payPartHelp')}</p>
            {open.map((l) => {
              const n = chosen[l.id] ?? 0;
              const set = (v: number) => setChosen((c) => ({ ...c, [l.id]: Math.max(0, Math.min(l.unpaidMilli, v)) }));
              return (
                <div key={l.id} className="row rs-part" style={{ gap: 6 }}>
                  <span style={{ flex: 1 }}>{i18n.name(l.name)} <span className="muted small">({qtyText(l.unpaidMilli)})</span></span>
                  <button type="button" className="btn ghost small" aria-label="−" disabled={n <= 0} onClick={() => set(n - 1000)}>−</button>
                  <strong className="num" style={{ minWidth: 32, textAlign: 'center' }}>{qtyText(n)}</strong>
                  <button type="button" className="btn ghost small" aria-label="+" disabled={n >= l.unpaidMilli} onClick={() => set(n + 1000)}>+</button>
                </div>
              );
            })}
          </div>
        )}
        <div className="pos-total"><span>{t('rs_payNow')}</span><strong className="num">{i18n.money(due, 'IQD')}</strong></div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} role="radiogroup" aria-label={t('rs_pay')}>
          <button type="button" role="radio" aria-checked={method === 'cash'} className={'btn' + (method === 'cash' ? ' primary' : '')} onClick={() => setMethod('cash')}>{t('rs_cash')}</button>
          {order.partyId && <button type="button" role="radio" aria-checked={method === 'account'} className={'btn' + (method === 'account' ? ' primary' : '')} onClick={() => setMethod('account')}>{t('rs_onAccount')}</button>}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: 1 }}><span>{t('rs_discount')}</span><input className="input num" inputMode="numeric" value={discountText} onChange={(e) => setDiscountText(e.target.value)} /></label>
          {method === 'cash' && <label className="field" style={{ flex: 1 }}><span>{t('rs_handed')}</span><input className="input num" inputMode="numeric" value={handedText} onChange={(e) => setHandedText(e.target.value)} /></label>}
        </div>
        {method === 'cash' && handed > due && <div className="pos-giveback"><span>{t('rs_change')}</span><strong className="num">{i18n.money(handed - due, 'IQD')}</strong></div>}
        {error !== null && <ErrorBox error={error} />}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={() => onClose(false)}>{t('cancel')}</button>
          <button type="button" className="btn primary pos-touch" disabled={busy || !shift || !selected.length} onClick={() => void pay()}><Icon name="wallet" size={18} />{t('rs_pay')} {i18n.money(due, 'IQD')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** An error's words for a toast (ErrorBox shows the same inside a page). */
function errorText(i18n: I18n, e: unknown): string {
  return errorMessages(e, i18n).join(' ');
}

export type { FloorView };
