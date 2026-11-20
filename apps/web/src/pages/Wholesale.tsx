import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { todayIso, type CurrencyCode, type UnitCode } from '@qasa/core';
import { api, ApiError, type ItemView, type PartyView } from '../api.ts';
import { AccountCombo, AmountInput, EmptyState, ErrorBox, Modal, QtyInput, SearchCombo, useData, useLoad, usePageNav, useToast, type PickOption } from '../components.tsx';
import { useI18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';
import { unitLabel } from '../industry/units.ts';
import { pricesApi } from '../industry/prices-api.ts';
import {
  wholesaleApi, type CollectionView, type DocState, type OrderInput, type OrderView, type RepView, type StockLine, type VanDay, type WsOrderStatus, type WsOutcome, type WsSettings
} from '../industry/wholesale-api.ts';

/**
 * الجملة والتوزيع (1.8): the rep's day on their route (visits, orders, collections), the sales orders with credit
 * control (approved in the office, delivered as a posted sale invoice), the vans (loads, unloads, the day's count),
 * collections and handovers to the office, reps and routes, the reports and the rules. A rep sees only their own; the
 * server decides that on every request. Quantities and sale prices only: no cost or stock value here.
 */

export type WholesaleTab = 'day' | 'orders' | 'vans' | 'money' | 'reps' | 'reports' | 'settings';
export const WHOLESALE_TABS: readonly WholesaleTab[] = ['day', 'orders', 'vans', 'money', 'reps', 'reports', 'settings'];
const TAB_LABEL: Record<WholesaleTab, Key> = {
  day: 'ws_tabDay', orders: 'ws_tabOrders', vans: 'ws_tabVans', money: 'ws_tabMoney', reps: 'ws_tabReps', reports: 'ws_tabReports', settings: 'ws_tabSettings'
};
const ADMIN_TABS: ReadonlySet<WholesaleTab> = new Set(['reps', 'settings']);
/** The tabs someone sees: reps, routes and the rules are an admin's. */
export const wholesaleTabsFor = (admin: boolean): WholesaleTab[] => WHOLESALE_TABS.filter((k) => admin || !ADMIN_TABS.has(k));
const NAV = { key: 'ws_title' as Key, group: 'gIndustry' as Key };
const WEEKDAYS: Key[] = ['ws_weekday0', 'ws_weekday1', 'ws_weekday2', 'ws_weekday3', 'ws_weekday4', 'ws_weekday5', 'ws_weekday6'];
const OUTCOMES: WsOutcome[] = ['order', 'no_order', 'closed', 'collected'];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

/** A form's busy state, its error and a run that toasts and reloads on success. */
function useAction(onDone: () => void) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(t('ws_saved'));
      onDone();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

const stateKey = (s: DocState): Key => (s === 'approved' ? 'ws_state_approved' : s === 'waiting' ? 'ws_state_waiting' : 'ws_state_rejected');

function RepPicker({ reps, value, onChange }: { reps: readonly RepView[]; value: string; onChange(id: string): void }) {
  const { t } = useI18n();
  if (reps.length <= 1) return null;
  return (
    <Field label={t('ws_rep')}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    </Field>
  );
}

/* ---------- the page ---------- */

export function Wholesale({ tab: asked = 'day' }: { tab?: WholesaleTab }) {
  const { t } = useI18n();
  const { permissions } = useData();
  const admin = !!permissions?.includes('admin');
  const tabs = wholesaleTabsFor(admin);
  const tab = tabs.includes(asked) ? asked : 'day';
  usePageNav(NAV);
  const setup = useLoad(() => wholesaleApi.settings(), []);
  const reps = useLoad(() => wholesaleApi.reps(), []);
  if (setup.error) return <ErrorBox error={setup.error} />;
  const list = reps.data ?? [];
  return (
    <div className="stack">
      {setup.data && !setup.data.available && <div className="alert">{t('ws_needsPlan')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      <div className="row no-print" style={{ flexWrap: 'wrap' }}>
        <div className="track" role="tablist">
          {tabs.map((k) => (
            <a key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} className="btn" style={{ border: 'none' }}
              href={href(k === 'day' ? 'wholesale' : `wholesale/${k}`)}>{t(TAB_LABEL[k])}</a>
          ))}
        </div>
      </div>
      {reps.error ? <ErrorBox error={reps.error} /> : null}
      {tab !== 'reps' && tab !== 'settings' && tab !== 'reports' && reps.data && !list.length && <EmptyState icon="truck" title={t('ws_title')} text={t('ws_noReps')} />}
      {tab === 'day' && list.length > 0 && <Day reps={list} />}
      {tab === 'orders' && <Orders reps={list} />}
      {tab === 'vans' && list.length > 0 && <Vans reps={list} />}
      {tab === 'money' && list.length > 0 && <Money reps={list} settings={setup.data?.settings ?? null} />}
      {tab === 'reps' && <Reps reps={list} onChange={reps.reload} />}
      {tab === 'reports' && <Reports />}
      {tab === 'settings' && setup.data && <Settings settings={setup.data.settings} onChange={setup.reload} />}
    </div>
  );
}

/* ---------- the rep's day ---------- */

function Day({ reps }: { reps: RepView[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [repId, setRepId] = useState(reps[0]!.id);
  const [date, setDate] = useState(todayIso());
  const day = useLoad(() => wholesaleApi.day(repId, date), [repId, date]);
  const [ordering, setOrdering] = useState<string | null>(null);
  const [collecting, setCollecting] = useState<string | null>(null);
  const { error, run } = useAction(day.reload);
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <RepPicker reps={reps} value={repId} onChange={setRepId} />
        <Field label={t('ws_date')}><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || todayIso())} /></Field>
        {day.data && <span className="muted">{t(WEEKDAYS[day.data.weekday]!)}</span>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>{t('ws_phoneSoon')}</p>
      <ErrorBox error={day.error ?? error} />
      {day.data && !day.data.stops.length && <div className="alert info">{t('ws_noStops')}</div>}
      {day.data && day.data.stops.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>{t('ws_shop')}</th><th className="num">{t('ws_balance')}</th><th className="num">{t('ws_limit')}</th><th>{t('ws_visit')}</th><th /></tr></thead>
            <tbody>
              {day.data.stops.map((s, i) => (
                <tr key={s.id}>
                  <td className="num">{i18n.int(i + 1)}</td>
                  <td>
                    <div>{s.partyName}</div>
                    <div className="muted small">{[s.address, s.phone].filter(Boolean).join(' · ')}</div>
                    {s.overLimit && <span className="chip bad">{t('ws_overLimit')}</span>} {s.overdue && <span className="chip warn">{t('ws_overdue', { n: s.oldestDays })}</span>}
                  </td>
                  <td className="num">{i18n.money(s.balance, 'IQD')}</td>
                  <td className="num">{s.limit === null ? '—' : i18n.money(s.limit, 'IQD')}</td>
                  <td>
                    <select className="input" value="" aria-label={t('ws_visit')}
                      onChange={(e) => { const outcome = e.target.value as WsOutcome; if (outcome) void run(() => wholesaleApi.visit({ repId, partyId: s.partyId, date, outcome })); }}>
                      <option value="">{s.visits.length ? s.visits.map((v) => t(`ws_out_${v}` as Key)).join('، ') : '—'}</option>
                      {OUTCOMES.map((o) => <option key={o} value={o}>{t(`ws_out_${o}` as Key)}</option>)}
                    </select>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button type="button" className="btn small" onClick={() => setOrdering(s.partyId)}>{t('ws_newOrder')}</button>
                      <button type="button" className="btn small" onClick={() => setCollecting(s.partyId)}>{t('ws_collect')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ordering && <OrderForm reps={reps} repId={repId} partyId={ordering} date={date} onClose={() => { setOrdering(null); day.reload(); }} />}
      {collecting && <CollectForm repId={repId} partyId={collecting} date={date} onClose={() => { setCollecting(null); day.reload(); }} />}
    </div>
  );
}

/* ---------- orders ---------- */

interface Line { key: number; itemId: string; unit: UnitCode | ''; qty: number | null; price: number | null }

function useCustomers(): PickOption[] {
  const parties = useLoad(() => api.parties({ type: 'customer', active: '1' }), []);
  return useMemo(() => (parties.data ?? []).map((p: PartyView) => ({ id: p.id, code: p.code, label: p.name, keywords: p.phone })), [parties.data]);
}

function OrderForm({ reps, repId, partyId, date, order, onClose }: { reps: RepView[]; repId?: string; partyId?: string; date?: string; order?: OrderView; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const customers = useCustomers();
  const items = useLoad(() => api.items({ active: '1' }), []);
  const warehouses = useLoad(() => api.warehouses(), []);
  const rep = reps.find((r) => r.id === (order?.repId ?? repId)) ?? null;
  const [party, setParty] = useState(order?.partyId ?? partyId ?? '');
  const [day, setDay] = useState(order?.date ?? date ?? todayIso());
  const [currency, setCurrency] = useState<CurrencyCode>(order?.currency ?? 'IQD');
  const [rate, setRate] = useState<number>(order?.rateX100 ?? 100);
  const [warehouseId, setWarehouseId] = useState(order?.warehouseId ?? rep?.warehouseId ?? '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(order
    ? order.lines.map((l, i) => ({ key: i, itemId: l.itemId, unit: (l.unit ?? '') as UnitCode | '', qty: l.unitQtyMilli ?? l.qtyMilli, price: l.unitPrice }))
    : [{ key: 0, itemId: '', unit: '', qty: null, price: null }]);
  const { busy, error, run } = useAction(onClose);
  const itemList = items.data ?? [];
  const itemOptions = useMemo(() => itemList.map((it: ItemView) => ({ id: it.id, code: it.code, label: i18n.name(it.name), keywords: it.barcode })), [itemList, i18n]);
  const credit = useLoad(() => (party ? wholesaleApi.credit(party) : Promise.resolve(null)), [party]);

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickItem = (key: number, itemId: string) => {
    const it = itemList.find((x) => x.id === itemId);
    setLine(key, { itemId, unit: '', price: it?.salePrice ?? null });
    // the customer's own price (wholesale or retail list), as the invoice does
    if (itemId) void pricesApi.priceFor(itemId, party || null, currency, rate).then((q) => setLine(key, { price: q.price })).catch(() => {});
  };
  const pickUnit = (key: number, itemId: string, unit: UnitCode | '') => {
    const it = itemList.find((x) => x.id === itemId);
    const u = it?.units.find((x) => x.unit === unit);
    setLine(key, { unit, price: u ? u.salePrice ?? Math.round(((it?.salePrice ?? 0) * u.factorMilli) / 1000) : it?.salePrice ?? null });
  };
  const amount = (l: Line) => (l.qty && l.price !== null ? Math.round((l.qty * l.price) / 1000) : 0);
  const total = lines.reduce((s, l) => s + amount(l), 0);
  const ready = party && lines.some((l) => l.itemId && l.qty && l.price !== null) && (currency === 'IQD' || rate > 0);

  const body = (): OrderInput => ({
    partyId: party, date: day, currency, rateX100: currency === 'IQD' ? 100 : rate, notes: notes.trim() || undefined,
    ...(warehouseId ? { warehouseId } : {}), ...(rep ? { repId: rep.id } : {}),
    lines: lines.filter((l) => l.itemId && l.qty && l.price !== null).map((l) => (l.unit
      ? { itemId: l.itemId, unit: l.unit, unitQtyMilli: l.qty!, unitPrice: l.price! }
      : { itemId: l.itemId, qtyMilli: l.qty!, unitPrice: l.price! }))
  });
  return (
    <Modal title={order ? order.number : t('ws_newOrder')} onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Field label={t('ws_shop')}><SearchCombo value={party} options={customers} onChange={setParty} placeholder={t('ws_shop')} /></Field>
          <Field label={t('ws_date')}><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
          <Field label={t('ws_currency')}>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}><option value="IQD">{t('iqdName')}</option><option value="USD">{t('usdName')}</option></select>
          </Field>
          {currency === 'USD' && <Field label={t('ws_rate')}><input className="input num" inputMode="numeric" value={rate ? String(rate / 100) : ''} onChange={(e) => setRate(Math.round(Number(e.target.value) * 100) || 0)} /></Field>}
          <Field label={t('ws_from')}>
            <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {(warehouses.data ?? []).filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.code} · {i18n.name(w.name)}</option>)}
            </select>
          </Field>
        </div>
        {credit.data && credit.data.verdict !== 'ok' && (
          <div className={'alert' + (credit.data.verdict === 'block' ? '' : ' info')}>
            {credit.data.overLimit && <span className="chip bad">{t('ws_overLimit')}</span>} {credit.data.overdue && <span className="chip warn">{t('ws_overdue', { n: credit.data.oldestDays })}</span>}
            {' '}{t('ws_balance')}: {i18n.money(credit.data.balance, 'IQD')}{credit.data.limit !== null ? ` · ${t('ws_limit')}: ${i18n.money(credit.data.limit, 'IQD')}` : ''}
          </div>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('ws_item')}</th><th>{t('ws_unit')}</th><th className="num">{t('ws_qty')}</th><th className="num">{t('ws_price')}</th><th className="num">{t('ws_total')}</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => {
                const it = itemList.find((x) => x.id === l.itemId);
                return (
                  <tr key={l.key}>
                    <td style={{ minWidth: 220 }}><SearchCombo value={l.itemId} options={itemOptions} onChange={(id) => pickItem(l.key, id)} placeholder={t('ws_item')} /></td>
                    <td>
                      <select className="input" value={l.unit} disabled={!it || !it.units.length} onChange={(e) => pickUnit(l.key, l.itemId, e.target.value as UnitCode | '')}>
                        <option value="">{it ? unitLabel(i18n, it.unit) : '—'}</option>
                        {(it?.units ?? []).map((u) => <option key={u.unit} value={u.unit}>{unitLabel(i18n, u.unit)}</option>)}
                      </select>
                    </td>
                    <td><QtyInput value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} ariaLabel={t('ws_qty')} /></td>
                    <td><AmountInput value={l.price} currency={currency} onChange={(v) => setLine(l.key, { price: v })} ariaLabel={t('ws_price')} /></td>
                    <td className="num">{i18n.money(amount(l), currency)}</td>
                    <td><button type="button" className="btn small" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}>{t('ws_remove')}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, { key: Math.max(...ls.map((x) => x.key)) + 1, itemId: '', unit: '', qty: null, price: null }])}>{t('ws_addLine')}</button>
          <strong style={{ marginInlineStart: 'auto' }}>{t('ws_total')}: {i18n.money(total, currency)}</strong>
        </div>
        <Field label={t('notes')}><input className="input" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></Field>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !ready}
            onClick={() => void run(() => (order ? wholesaleApi.updateOrder(order.id, body()) : wholesaleApi.createOrder(body())))}>{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Approve or deliver, and when the customer is blocked, an admin's override with a reason. */
function OrderActions({ order, onDone }: { order: OrderView; onDone(): void }) {
  const { t } = useI18n();
  const { permissions } = useData();
  const admin = !!permissions?.includes('admin');
  const [blocked, setBlocked] = useState<'approve' | 'deliver' | null>(null);
  const [reason, setReason] = useState('');
  const { busy, error, setError, run } = useAction(onDone);
  const act = async (step: 'approve' | 'deliver', override?: { reason: string }) => {
    const done = await run(() => (step === 'approve' ? wholesaleApi.approve(order.id, override) : wholesaleApi.deliver(order.id, override)));
    if (done) setBlocked(null);
  };
  useEffect(() => {
    if (error instanceof ApiError && error.code === 'ws_credit_blocked' && !blocked) setBlocked(order.status === 'draft' ? 'approve' : 'deliver');
  }, [error, blocked, order.status]);
  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        {order.actions.includes('approve') && <button type="button" className="btn small primary" disabled={busy} onClick={() => void act('approve')}>{t('ws_approve')}</button>}
        {order.actions.includes('deliver') && <button type="button" className="btn small primary" disabled={busy} onClick={() => void act('deliver')}>{t('ws_deliver')}</button>}
        {order.actions.includes('cancel') && <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => wholesaleApi.cancel(order.id))}>{t('ws_cancelOrder')}</button>}
      </div>
      {!blocked && <ErrorBox error={error} />}
      {blocked && (
        <Modal title={t('ws_blockedTitle')} onClose={() => { setBlocked(null); setError(null); }}>
          <div className="stack">
            <ErrorBox error={error} />
            {admin ? (
              <>
                <p className="muted small" style={{ margin: 0 }}>{t('ws_blockedHelp')}</p>
                <Field label={t('ws_reason')}><input className="input" value={reason} maxLength={300} autoFocus onChange={(e) => setReason(e.target.value)} /></Field>
                <button type="button" className="btn danger" disabled={busy || reason.trim().length < 3} onClick={() => void act(blocked, { reason: reason.trim() })}>{t('ws_override')}</button>
              </>
            ) : null}
          </div>
        </Modal>
      )}
    </>
  );
}

function Orders({ reps }: { reps: RepView[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [status, setStatus] = useState<WsOrderStatus | ''>('');
  const list = useLoad(() => wholesaleApi.orders(status ? { status } : {}), [status]);
  const [editing, setEditing] = useState<OrderView | 'new' | null>(null);
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <Field label={t('ws_status')}>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as WsOrderStatus | '')}>
            <option value="">{t('ws_all')}</option>
            {(['draft', 'approved', 'delivered', 'cancelled'] as const).map((s) => <option key={s} value={s}>{t(`ws_status_${s}`)}</option>)}
          </select>
        </Field>
        <button type="button" className="btn primary" onClick={() => setEditing('new')}>{t('ws_newOrder')}</button>
      </div>
      <ErrorBox error={list.error} />
      {list.data && !list.data.length && <div className="muted">{t('ws_noData')}</div>}
      {list.data && list.data.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>{t('ws_order')}</th><th>{t('ws_date')}</th><th>{t('ws_shop')}</th><th>{t('ws_rep')}</th><th className="num">{t('ws_total')}</th><th>{t('ws_status')}</th><th /></tr></thead>
            <tbody>
              {list.data.map((o) => (
                <tr key={o.id}>
                  <td className="num ltr">
                    {o.actions.includes('edit') ? <a href="#" onClick={(e) => { e.preventDefault(); setEditing(o); }}>{o.number}</a> : o.number}
                  </td>
                  <td>{i18n.date(o.date)}</td>
                  <td>{o.partyName}</td>
                  <td>{o.repName ?? '—'}</td>
                  <td className="num">{i18n.money(o.total, o.currency)}</td>
                  <td>
                    <span className={'chip ' + (o.status === 'delivered' ? 'ok' : o.status === 'approved' ? 'warn' : '')}>{t(`ws_status_${o.status}`)}</span>
                    {o.limitCheck === 'warn' && <div className="muted small">{t('ws_limitWarn')}</div>}
                    {o.limitCheck === 'override' && <div className="muted small">{t('ws_limitOverride', { r: o.overrideReason ?? '' })}</div>}
                    {o.invoiceId && <div className="small"><a href={href(`invoice/${o.invoiceId}`)}>{t('ws_invoice')} {o.invoiceNumber ?? ''}</a></div>}
                  </td>
                  <td><OrderActions order={o} onDone={list.reload} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <OrderForm reps={reps} {...(editing === 'new' ? {} : { order: editing })} onClose={() => { setEditing(null); list.reload(); }} />}
    </div>
  );
}

/* ---------- vans ---------- */

function Vans({ reps }: { reps: RepView[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { permissions, seesBooks } = useData();
  const stock = !!permissions?.includes('admin') || !!permissions?.includes('stock');
  const [repId, setRepId] = useState(reps[0]!.id);
  const [date, setDate] = useState(todayIso());
  const day = useLoad(() => wholesaleApi.vanDay(repId, date), [repId, date]);
  const moves = useLoad(() => wholesaleApi.vanMoves(repId), [repId]);
  const [moving, setMoving] = useState<'load' | 'unload' | null>(null);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  useEffect(() => setCounts(Object.fromEntries((day.data?.rows ?? []).map((r) => [r.itemId, r.counted]))), [day.data]);
  const reload = () => { day.reload(); moves.reload(); };
  const { busy, error, run } = useAction(reload);
  const d: VanDay | null = day.data;
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <RepPicker reps={reps} value={repId} onChange={setRepId} />
        <Field label={t('ws_date')}><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || todayIso())} /></Field>
        {stock && <button type="button" className="btn" onClick={() => setMoving('load')}>{t('ws_load')}</button>}
        {stock && <button type="button" className="btn" onClick={() => setMoving('unload')}>{t('ws_unload')}</button>}
      </div>
      <ErrorBox error={day.error ?? error} />
      <h3 style={{ margin: 0 }}>{t('ws_vanDay')}</h3>
      {d && !d.rows.length && <div className="muted">{t('ws_nothingInVan')}</div>}
      {d && d.rows.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('ws_item')}</th><th className="num">{t('ws_opening')}</th><th className="num">{t('ws_loaded')}</th><th className="num">{t('ws_unloaded')}</th>
                <th className="num">{t('ws_sold')}</th><th className="num">{t('ws_returned')}</th><th className="num">{t('ws_other')}</th><th className="num">{t('ws_expected')}</th>
                <th className="num">{t('ws_counted')}</th><th className="num">{t('ws_difference')}</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => {
                const c = counts[r.itemId] ?? null;
                return (
                  <tr key={r.itemId}>
                    <td>{r.code} · {i18n.name(r.name)}</td>
                    <td className="num">{i18n.qty(r.opening)}</td><td className="num">{i18n.qty(r.loaded)}</td><td className="num">{i18n.qty(r.unloaded)}</td>
                    <td className="num">{i18n.qty(r.sold)}</td><td className="num">{i18n.qty(r.returned)}</td><td className="num">{i18n.qty(r.other)}</td>
                    <td className="num"><strong>{i18n.qty(r.expected)}</strong></td>
                    <td className="num" style={{ minWidth: 110 }}>
                      {d.status === 'closed' ? i18n.qty(r.counted ?? 0) : <QtyInput value={c} onChange={(v) => setCounts((m) => ({ ...m, [r.itemId]: v }))} ariaLabel={t('ws_counted')} />}
                    </td>
                    <td className="num">{c === null ? '—' : i18n.qty(c - r.expected, { plus: true })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {d && d.rows.length > 0 && d.status !== 'closed' && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn primary" disabled={busy}
            onClick={() => void run(() => wholesaleApi.saveVanCount(repId, date, Object.entries(counts).filter(([, v]) => v !== null).map(([itemId, v]) => ({ itemId, countedMilli: Math.max(0, v!) }))))}>
            {t('ws_saveCount')}
          </button>
          {stock && d.status === 'open' && <button type="button" className="btn" disabled={busy} onClick={() => void run(() => wholesaleApi.closeVanCount(repId, date))}>{t('ws_closeCount')}</button>}
          {stock && <span className="muted small">{t('ws_closeCountHelp')}</span>}
        </div>
      )}
      {d?.status === 'closed' && (
        <div className="alert info">{t('ws_countClosed')}{d.adjustmentId && seesBooks !== false ? <> · <a href={href(`stock-adjustment/${d.adjustmentId}`)}>{t('ws_adjustment')}</a></> : null}</div>
      )}
      <h3 style={{ margin: 0 }}>{t('ws_moves')}</h3>
      {(moves.data ?? []).length === 0 ? <div className="muted">{t('ws_noData')}</div> : (
        <div className="card table-wrap">
          <table className="table">
            <tbody>
              {(moves.data ?? []).map((m) => (
                <tr key={m.id}>
                  <td className="num ltr">{seesBooks !== false ? <a href={href(`stock-doc/${m.id}`)}>{m.number ?? '—'}</a> : m.number ?? '—'}</td>
                  <td>{i18n.date(m.date)}</td>
                  <td>{t(m.direction === 'load' ? 'ws_dir_load' : 'ws_dir_unload')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {moving && <VanMoveForm repId={repId} direction={moving} date={date} onClose={() => { setMoving(null); reload(); }} />}
    </div>
  );
}

function VanMoveForm({ repId, direction, date, onClose }: { repId: string; direction: 'load' | 'unload'; date: string; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const items = useLoad(() => api.items({ active: '1' }), []);
  const itemList = items.data ?? [];
  const itemOptions = useMemo(() => itemList.map((it) => ({ id: it.id, code: it.code, label: i18n.name(it.name), keywords: it.barcode })), [itemList, i18n]);
  const [lines, setLines] = useState<{ key: number; itemId: string; unit: UnitCode | ''; qty: number | null }[]>([{ key: 0, itemId: '', unit: '', qty: null }]);
  const { busy, error, run } = useAction(onClose);
  const set = (key: number, patch: object) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const ready = lines.some((l) => l.itemId && l.qty);
  const body = (): StockLine[] => lines.filter((l) => l.itemId && l.qty).map((l) => (l.unit ? { itemId: l.itemId, unit: l.unit, unitQtyMilli: l.qty! } : { itemId: l.itemId, qtyMilli: l.qty! }));
  return (
    <Modal title={t(direction === 'load' ? 'ws_load' : 'ws_unload')} onClose={onClose}>
      <div className="stack">
        {lines.map((l) => {
          const it = itemList.find((x) => x.id === l.itemId);
          return (
            <div key={l.key} className="row" style={{ flexWrap: 'wrap' }}>
              <div style={{ minWidth: 220, flex: 1 }}><SearchCombo value={l.itemId} options={itemOptions} onChange={(id) => set(l.key, { itemId: id, unit: '' })} placeholder={t('ws_item')} /></div>
              <select className="input" value={l.unit} disabled={!it || !it.units.length} onChange={(e) => set(l.key, { unit: e.target.value })} aria-label={t('ws_unit')}>
                <option value="">{it ? unitLabel(i18n, it.unit) : '—'}</option>
                {(it?.units ?? []).map((u) => <option key={u.unit} value={u.unit}>{unitLabel(i18n, u.unit)}</option>)}
              </select>
              <div style={{ width: 120 }}><QtyInput value={l.qty} onChange={(v) => set(l.key, { qty: v })} ariaLabel={t('ws_qty')} /></div>
            </div>
          );
        })}
        <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, { key: Math.max(...ls.map((x) => x.key)) + 1, itemId: '', unit: '', qty: null }])}>{t('ws_addLine')}</button>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !ready} onClick={() => void run(() => wholesaleApi.moveVan(repId, { direction, date, lines: body() }))}>{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- collections and handovers ---------- */

function CollectForm({ repId, partyId, date, onClose }: { repId: string; partyId?: string; date?: string; onClose(): void }) {
  const { t } = useI18n();
  const customers = useCustomers();
  const [party, setParty] = useState(partyId ?? '');
  const [day, setDay] = useState(date ?? todayIso());
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  const [rate, setRate] = useState(0);
  const [amount, setAmount] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction(onClose);
  const ready = party && amount && amount > 0 && (currency === 'IQD' || rate > 0);
  return (
    <Modal title={t('ws_collect')} onClose={onClose}>
      <div className="stack">
        <Field label={t('ws_shop')}><SearchCombo value={party} options={customers} onChange={setParty} placeholder={t('ws_shop')} /></Field>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Field label={t('ws_date')}><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
          <Field label={t('ws_currency')}>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}><option value="IQD">{t('iqdName')}</option><option value="USD">{t('usdName')}</option></select>
          </Field>
          {currency === 'USD' && <Field label={t('ws_rate')}><input className="input num" inputMode="numeric" value={rate ? String(rate / 100) : ''} onChange={(e) => setRate(Math.round(Number(e.target.value) * 100) || 0)} /></Field>}
          <Field label={t('ws_amount')}><AmountInput value={amount} currency={currency} onChange={setAmount} /></Field>
        </div>
        <Field label={t('notes')}><input className="input" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></Field>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !ready}
            onClick={() => void run(() => wholesaleApi.collect({ repId, partyId: party, date: day, currency, rateX100: currency === 'IQD' ? 100 : rate, amount: amount!, notes: notes.trim() || undefined }))}>
            {t('save')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function HandOverForm({ repId, settings, onClose }: { repId: string; settings: WsSettings | null; onClose(): void }) {
  const { t } = useI18n();
  const [day, setDay] = useState(todayIso());
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  const [rate, setRate] = useState(0);
  const [toAccount, setToAccount] = useState(settings?.officeCashAccount ?? '');
  const { busy, error, run } = useAction(onClose);
  return (
    <Modal title={t('ws_handOver')} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('ws_handOverHelp')}</p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Field label={t('ws_date')}><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
          <Field label={t('ws_currency')}>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}><option value="IQD">{t('iqdName')}</option><option value="USD">{t('usdName')}</option></select>
          </Field>
          {currency === 'USD' && <Field label={t('ws_rate')}><input className="input num" inputMode="numeric" value={rate ? String(rate / 100) : ''} onChange={(e) => setRate(Math.round(Number(e.target.value) * 100) || 0)} /></Field>}
        </div>
        <Field label={t('ws_toAccount')}><AccountCombo value={toAccount} onChange={setToAccount} filter={(a) => a.code.startsWith('18')} /></Field>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !toAccount || (currency === 'USD' && !rate)}
            onClick={() => void run(() => wholesaleApi.handOver({ repId, date: day, currency, rateX100: currency === 'IQD' ? 100 : rate, toAccount }))}>{t('ws_handOver')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function Money({ reps, settings }: { reps: RepView[]; settings: WsSettings | null }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { seesBooks, permissions } = useData();
  const office = seesBooks !== false || !!permissions?.includes('admin');
  const [repId, setRepId] = useState(reps[0]!.id);
  const collections = useLoad(() => wholesaleApi.collections({ repId }), [repId]);
  const handovers = useLoad(() => wholesaleApi.handovers(repId), [repId]);
  const [collecting, setCollecting] = useState(false);
  const [handing, setHanding] = useState(false);
  const reload = () => { collections.reload(); handovers.reload(); };
  const open = (collections.data ?? []).filter((c: CollectionView) => c.state === 'approved' && !c.handoverId);
  const sum = (cur: CurrencyCode) => open.filter((c) => c.currency === cur).reduce((s, c) => s + c.amount, 0);
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <RepPicker reps={reps} value={repId} onChange={setRepId} />
        <button type="button" className="btn primary" onClick={() => setCollecting(true)}>{t('ws_collect')}</button>
        {office && <button type="button" className="btn" onClick={() => setHanding(true)}>{t('ws_handOver')}</button>}
        <span className="muted">{t('ws_notHanded')}: {i18n.money(sum('IQD'), 'IQD')}{sum('USD') ? ` · ${i18n.money(sum('USD'), 'USD')}` : ''}</span>
      </div>
      <ErrorBox error={collections.error ?? handovers.error} />
      <h3 style={{ margin: 0 }}>{t('ws_collections')}</h3>
      {(collections.data ?? []).length === 0 ? <div className="muted">{t('ws_noData')}</div> : (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>{t('ws_date')}</th><th>{t('ws_shop')}</th><th className="num">{t('ws_amount')}</th><th>{t('ws_status')}</th></tr></thead>
            <tbody>
              {(collections.data ?? []).map((c) => (
                <tr key={c.id}>
                  <td className="num ltr">{c.number}</td><td>{i18n.date(c.date)}</td><td>{c.partyName}</td>
                  <td className="num">{i18n.money(c.amount, c.currency)}</td>
                  <td>{t(stateKey(c.state))}{c.state === 'approved' ? ` · ${t(c.handoverId ? 'ws_handed' : 'ws_notHanded')}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 style={{ margin: 0 }}>{t('ws_handovers')}</h3>
      {(handovers.data ?? []).length === 0 ? <div className="muted">{t('ws_noData')}</div> : (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>{t('ws_date')}</th><th>{t('ws_toAccount')}</th><th className="num">{t('ws_amount')}</th><th className="num">{t('ws_count')}</th><th>{t('ws_status')}</th></tr></thead>
            <tbody>
              {(handovers.data ?? []).map((h) => (
                <tr key={h.id}>
                  <td className="num ltr">{h.number}</td><td>{i18n.date(h.date)}</td><td className="num ltr">{h.toAccount}</td>
                  <td className="num">{i18n.money(h.amount, h.currency)}</td><td className="num">{i18n.int(h.collections)}</td><td>{t(stateKey(h.state))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {collecting && <CollectForm repId={repId} onClose={() => { setCollecting(false); reload(); }} />}
      {handing && <HandOverForm repId={repId} settings={settings} onClose={() => { setHanding(false); reload(); }} />}
    </div>
  );
}

/* ---------- reps and routes (admin) ---------- */

function RepForm({ rep, onClose }: { rep: RepView | null; onClose(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const users = useLoad(() => api.users(), []);
  const warehouses = useLoad(() => api.warehouses(), []);
  const [userId, setUserId] = useState(rep?.userId ?? '');
  const [name, setName] = useState(rep?.name ?? '');
  const [warehouseId, setWarehouseId] = useState(rep?.warehouseId ?? '');
  const [loadWarehouseId, setLoadWarehouseId] = useState(rep?.loadWarehouseId ?? '');
  const [cashAccount, setCashAccount] = useState(rep?.cashAccount ?? '');
  const [active, setActive] = useState(rep?.active ?? true);
  const { busy, error, run } = useAction(onClose);
  const ws = (warehouses.data ?? []).filter((w) => w.active);
  const input = { userId, name: name.trim(), warehouseId, loadWarehouseId, cashAccount, active };
  return (
    <Modal title={t(rep ? 'ws_editRep' : 'ws_addRep')} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('ws_repHelp')}</p>
        <Field label={t('ws_user')}>
          <select className="input" value={userId} onChange={(e) => { setUserId(e.target.value); if (!name) setName((users.data ?? []).find((u) => u.id === e.target.value)?.name ?? ''); }}>
            <option value="" />
            {(users.data ?? []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}
          </select>
        </Field>
        <Field label={t('ws_name')}><input className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('ws_van')}>
          <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="" />{ws.map((w) => <option key={w.id} value={w.id}>{w.code} · {i18n.name(w.name)}</option>)}
          </select>
        </Field>
        <Field label={t('ws_loadFrom')}>
          <select className="input" value={loadWarehouseId} onChange={(e) => setLoadWarehouseId(e.target.value)}>
            <option value="" />{ws.map((w) => <option key={w.id} value={w.id}>{w.code} · {i18n.name(w.name)}</option>)}
          </select>
        </Field>
        <Field label={t('ws_cashAccount')}><AccountCombo value={cashAccount} onChange={setCashAccount} filter={(a) => a.code.startsWith('18')} /></Field>
        <label className="row"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {t('ws_active')}</label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !userId || !name.trim() || !warehouseId || !loadWarehouseId || !cashAccount}
            onClick={() => void run(() => (rep ? wholesaleApi.updateRep(rep.id, input) : wholesaleApi.createRep(input)))}>{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function RouteEditor({ rep }: { rep: RepView }) {
  const i18n = useI18n();
  const { t } = i18n;
  const customers = useCustomers();
  const route = useLoad(() => wholesaleApi.route(rep.id), [rep.id]);
  const [weekday, setWeekday] = useState(new Date().getDay());
  const [stops, setStops] = useState<string[]>([]);
  const [adding, setAdding] = useState('');
  useEffect(() => setStops((route.data ?? []).filter((s) => s.weekday === weekday).map((s) => s.partyId)), [route.data, weekday]);
  const { busy, error, run } = useAction(route.reload);
  const nameOf = (id: string) => customers.find((c) => c.id === id)?.label ?? (route.data ?? []).find((s) => s.partyId === id)?.partyName ?? id;
  const move = (i: number, by: number) => setStops((s) => {
    const next = [...s];
    const j = i + by;
    if (j < 0 || j >= next.length) return s;
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  });
  return (
    <div className="card stack" style={{ padding: 12 }}>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <strong>{t('ws_route')}: {rep.name}</strong>
        <div className="track" role="tablist">
          {WEEKDAYS.map((k, d) => (
            <button key={k} type="button" className="btn small" aria-pressed={weekday === d} onClick={() => setWeekday(d)}>
              {t(k)} ({i18n.int((route.data ?? []).filter((s) => s.weekday === d).length)})
            </button>
          ))}
        </div>
      </div>
      <ol className="stack" style={{ margin: 0 }}>
        {stops.map((id, i) => (
          <li key={id} className="row" style={{ gap: 6 }}>
            <span style={{ flex: 1 }}>{nameOf(id)}</span>
            <button type="button" className="btn small" onClick={() => move(i, -1)}>{t('ws_up')}</button>
            <button type="button" className="btn small" onClick={() => move(i, 1)}>{t('ws_down')}</button>
            <button type="button" className="btn small" onClick={() => setStops((s) => s.filter((x) => x !== id))}>{t('ws_remove')}</button>
          </li>
        ))}
      </ol>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div style={{ minWidth: 240, flex: 1 }}>
          <SearchCombo value={adding} options={customers.filter((c) => !stops.includes(c.id))} placeholder={t('ws_addStop')}
            onChange={(id) => { if (id) setStops((s) => [...s, id]); setAdding(''); }} />
        </div>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void run(() => wholesaleApi.setRouteDay(rep.id, weekday, stops))}>{t('ws_saveRoute')}</button>
      </div>
      <ErrorBox error={error ?? route.error} />
    </div>
  );
}

function Reps({ reps, onChange }: { reps: RepView[]; onChange(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [editing, setEditing] = useState<RepView | 'new' | null>(null);
  const [routeOf, setRouteOf] = useState<string | null>(reps[0]?.id ?? null);
  const shown = reps.find((r) => r.id === routeOf) ?? null;
  return (
    <div className="stack">
      <div className="row"><button type="button" className="btn primary" onClick={() => setEditing('new')}>{t('ws_addRep')}</button></div>
      {reps.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>{t('ws_name')}</th><th>{t('ws_user')}</th><th>{t('ws_van')}</th><th>{t('ws_cashAccount')}</th><th className="num">{t('ws_stops')}</th><th /></tr></thead>
            <tbody>
              {reps.map((r) => (
                <tr key={r.id} className={r.active ? '' : 'muted'}>
                  <td>{r.name}</td><td>{r.userName}</td><td>{i18n.name(r.warehouseName)}</td><td className="num ltr">{r.cashAccount}</td><td className="num">{i18n.int(r.stops)}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button type="button" className="btn small" onClick={() => setEditing(r)}>{t('ws_editRep')}</button>
                      <button type="button" className="btn small" aria-pressed={routeOf === r.id} onClick={() => setRouteOf(r.id)}>{t('ws_route')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown && <RouteEditor key={shown.id} rep={shown} />}
      {editing && <RepForm rep={editing === 'new' ? null : editing} onClose={() => { setEditing(null); onChange(); }} />}
    </div>
  );
}

/* ---------- reports ---------- */

function Reports() {
  const i18n = useI18n();
  const { t } = i18n;
  const today = todayIso();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const r = useLoad(() => wholesaleApi.reports(from, to), [from, to]);
  const d = r.data;
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <Field label={t('from')}><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={t('to')}><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <ErrorBox error={r.error} />
      {d && (
        <>
          <h3 style={{ margin: 0 }}>{t('ws_salesByRep')}</h3>
          {!d.sales.length ? <div className="muted">{t('ws_noData')}</div> : (
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>{t('ws_rep')}</th><th className="num">{t('ws_orders')}</th><th className="num">{t('ws_total')}</th>{WEEKDAYS.map((k) => <th key={k} className="num">{t(k)}</th>)}</tr></thead>
                <tbody>
                  {d.sales.map((s) => (
                    <tr key={s.repId ?? 'office'}>
                      <td>{s.repName || '—'}</td><td className="num">{i18n.int(s.orders)}</td><td className="num">{i18n.money(s.total, 'IQD')}</td>
                      {s.byWeekday.map((v, i) => <td key={i} className="num">{v ? i18n.money(v, 'IQD') : '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3 style={{ margin: 0 }}>{t('ws_collections')}</h3>
          {!d.collections.length ? <div className="muted">{t('ws_noData')}</div> : (
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>{t('ws_rep')}</th><th className="num">{t('ws_count')}</th><th className="num">IQD</th><th className="num">USD</th><th className="num">{t('ws_handed')}</th></tr></thead>
                <tbody>
                  {d.collections.map((c) => (
                    <tr key={c.repId}>
                      <td>{c.repName}</td><td className="num">{i18n.int(c.count)}</td><td className="num">{i18n.money(c.IQD, 'IQD')}</td><td className="num">{i18n.money(c.USD, 'USD')}</td>
                      <td className="num">{i18n.money(c.handedIQD, 'IQD')}{c.handedUSD ? ` · ${i18n.money(c.handedUSD, 'USD')}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3 style={{ margin: 0 }}>{t('ws_visitsReport')}</h3>
          <div className="card table-wrap">
            <table className="table">
              <thead><tr><th>{t('ws_rep')}</th><th className="num">{t('ws_planned')}</th><th className="num">{t('ws_done')}</th><th className="num">{t('ws_unplanned')}</th></tr></thead>
              <tbody>
                {d.visits.map((v) => <tr key={v.repId}><td>{v.repName}</td><td className="num">{i18n.int(v.planned)}</td><td className="num">{i18n.int(v.done)}</td><td className="num">{i18n.int(v.unplanned)}</td></tr>)}
              </tbody>
            </table>
          </div>
          <h3 style={{ margin: 0 }}>{t('ws_creditReport')}</h3>
          {!d.credit.length ? <div className="muted">{t('ws_noneOver')}</div> : (
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>{t('ws_shop')}</th><th className="num">{t('ws_balance')}</th><th className="num">{t('ws_limit')}</th><th className="num">{t('ws_oldestDays')}</th><th /></tr></thead>
                <tbody>
                  {d.credit.map((c) => (
                    <tr key={c.partyId}>
                      <td><a href={href(`party/${c.partyId}`)}>{c.name}</a></td><td className="num">{i18n.money(c.balance, 'IQD')}</td>
                      <td className="num">{c.limit === null ? '—' : i18n.money(c.limit, 'IQD')}</td><td className="num">{i18n.int(c.oldestDays)}</td>
                      <td>{c.overLimit && <span className="chip bad">{t('ws_overLimit')}</span>} {c.overdue && <span className="chip warn">{t('ws_overdue', { n: c.oldestDays })}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- the rules (admin) ---------- */

function Settings({ settings, onChange }: { settings: WsSettings; onChange(): void }) {
  const { t } = useI18n();
  const [s, setS] = useState<WsSettings>(settings);
  const { busy, error, run } = useAction(onChange);
  const policy = (k: 'off' | 'warn' | 'block'): Key => `ws_policy_${k}`;
  return (
    <div className="card stack" style={{ padding: 12, maxWidth: 560 }}>
      <Field label={t('ws_creditPolicy')}>
        <select className="input" value={s.creditPolicy} onChange={(e) => setS({ ...s, creditPolicy: e.target.value as WsSettings['creditPolicy'] })}>
          {(['warn', 'block'] as const).map((k) => <option key={k} value={k}>{t(policy(k))}</option>)}
        </select>
      </Field>
      <Field label={t('ws_overduePolicy')}>
        <select className="input" value={s.overduePolicy} onChange={(e) => setS({ ...s, overduePolicy: e.target.value as WsSettings['overduePolicy'] })}>
          {(['off', 'warn', 'block'] as const).map((k) => <option key={k} value={k}>{t(policy(k))}</option>)}
        </select>
      </Field>
      <Field label={t('ws_overdueDays')}><input className="input num" inputMode="numeric" value={String(s.overdueDays)} onChange={(e) => setS({ ...s, overdueDays: Math.max(0, Math.min(3650, Number(e.target.value) || 0)) })} /></Field>
      <Field label={t('ws_officeCash')}><AccountCombo value={s.officeCashAccount} onChange={(v) => setS({ ...s, officeCashAccount: v })} filter={(a) => a.code.startsWith('18')} /></Field>
      <Field label={t('ws_vanShort')}><AccountCombo value={s.vanShortAccount} onChange={(v) => setS({ ...s, vanShortAccount: v })} /></Field>
      <p className="muted small" style={{ margin: 0 }}>{t('ws_vanShortHelp')}</p>
      <ErrorBox error={error} />
      <div className="row"><button type="button" className="btn primary" disabled={busy} onClick={() => void run(() => wholesaleApi.saveSettings(s))}>{t('save')}</button></div>
    </div>
  );
}
