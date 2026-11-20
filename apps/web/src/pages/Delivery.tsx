import { useState } from 'react';
import { todayIso } from '@qasa/core';
import { AccountCombo, AmountInput, EmptyState, ErrorBox, Icon, Modal, useData, useLoad, usePageNav, useToast } from '../components.tsx';
import { makeI18n, useI18n, type Key } from '../i18n.ts';
import { go, href } from '../router.ts';
import { whatsappUrl } from '../share.ts';
import { DeliveryOrderForm, draftOf, emptyDraft } from '../industry/DeliveryOrderForm.tsx';
import { deliveryMessage } from '../industry/market-messages.ts';
import { deliveryApi, type DeliveryOrderSummary, type DeliveryStatus, type Driver, type DriverInput } from '../industry/market-extras-api.ts';
import { LockedFeature } from '../industry/LockedFeature.tsx';
import { Paper, PrintPart, PrintPartButton } from '../industry/PrintPart.tsx';

/**
 * طلبات التوصيل — delivery orders taken by phone or WhatsApp (2.0, Starter and up). Route: delivery/<tab> (board,
 * drivers, handovers). The board has a column for each step; the goods and the money move when an order is delivered.
 */

export const DELIVERY_TABS = ['board', 'drivers', 'handovers'] as const;
export type DeliveryTab = (typeof DELIVERY_TABS)[number];
const TAB_KEYS: Record<DeliveryTab, Key> = { board: 'mx_tabBoard', drivers: 'mx_tabDrivers', handovers: 'mx_tabHandovers' };
const OPEN: readonly DeliveryStatus[] = ['new', 'preparing', 'out'];
const STEP_CHIP: Record<DeliveryStatus, string> = { new: 'info', preparing: 'warn', out: 'warn', delivered: 'ok', cancelled: 'bad' };

/** Minutes since a moment, as the board shows how long an order has waited. */
export function waited(fromIso: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(fromIso)) / 60000));
}

/** 2.0.0: without the plan, what the page does and how to get it (LockedFeature), not its tabs over an empty page. */
export function Delivery(props: { tab?: DeliveryTab }) {
  const { plan } = useData();
  if (plan && !plan.features.includes('delivery')) return <LockedFeature feature="delivery" icon="truck" />;
  return <DeliveryPage {...props} />;
}

function DeliveryPage({ tab = 'board' }: { tab?: DeliveryTab }) {
  const { t } = useI18n();
  usePageNav({ key: 'mx_deliveryTitle', group: 'gSales' });
  const { plan, seesBooks, permissions } = useData();
  const available = !!plan?.features.includes('delivery');
  const sales = !permissions || permissions.includes('sales');
  const admin = !permissions || permissions.includes('admin');
  return (
    <div className="stack">
      <p className="muted no-print" style={{ margin: 0 }}>{t('mx_deliveryHelp')}</p>
      {plan && !available && <div className="alert info small" role="status">{t('mx_deliveryNeedsPlan')}</div>}
      <div className="row no-print">
        <div className="tabs">
          {DELIVERY_TABS.filter((x) => x !== 'handovers' || seesBooks !== false).map((x) => (
            <button key={x} type="button" aria-pressed={tab === x} onClick={() => go(`delivery/${x}`)}>{t(TAB_KEYS[x])}</button>
          ))}
        </div>
      </div>
      {tab === 'board' && <Board available={available} sales={sales} />}
      {tab === 'drivers' && <Drivers admin={admin && available} />}
      {tab === 'handovers' && seesBooks !== false && <Handovers available={available} />}
    </div>
  );
}

function Board({ available, sales }: { available: boolean; sales: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings } = useData();
  const open = useLoad(() => deliveryApi.orders({ status: 'open' }), []);
  const today = todayIso();
  const done = useLoad(() => deliveryApi.orders({ from: today, to: today }), []);
  const drivers = useLoad(() => deliveryApi.drivers(), []);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [draftFor, setDraftFor] = useState<ReturnType<typeof emptyDraft> | null>(null);
  const [moving, setMoving] = useState<{ order: DeliveryOrderSummary; to: DeliveryStatus } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reload = () => { open.reload(); done.reload(); };

  async function edit(id: string) {
    setError(null);
    try {
      setDraftFor(draftOf(await deliveryApi.order(id)));
      setEditing({ id });
    } catch (e) { setError(e); }
  }

  function whatsapp(o: DeliveryOrderSummary, status: DeliveryStatus) {
    const lang = o.lang ?? i18n.lang;
    const driver = drivers.data?.find((d) => d.id === o.driverId);
    const text = deliveryMessage(makeI18n(lang, i18n.digits, () => {}, () => {}), o, status, settings?.companyName ?? null, driver?.phone ?? '');
    window.open(whatsappUrl(o.phone, text), '_blank', 'noopener,noreferrer');
  }

  const orders = open.data?.orders ?? [];
  const finished = (done.data?.orders ?? []).filter((o) => o.status === 'delivered' || o.status === 'cancelled');
  const now = new Date();
  return (
    <div className="stack">
      <div className="row no-print">
        <span className="muted small">{t('mx_openCount', { n: i18n.int(orders.length) })}</span>
        <span className="spacer" />
        <button type="button" className="btn" onClick={reload}><Icon name="undo" size={16} />{t('mx_refresh')}</button>
        {sales && available && (
          <button type="button" className="btn primary" onClick={() => { setDraftFor(emptyDraft()); setEditing({ id: null }); }}><Icon name="plus" size={16} />{t('mx_newOrder')}</button>
        )}
      </div>
      <ErrorBox error={open.error ?? error} />
      <div className="grid-3" style={{ alignItems: 'start' }}>
        {OPEN.map((status) => {
          const column = orders.filter((o) => o.status === status);
          return (
            <section key={status} className="card" aria-label={t(`mx_st_${status}` as Key)} style={{ padding: 10 }}>
              <h3 className="row" style={{ margin: '0 0 8px', gap: 6 }}>
                <span className={`chip ${STEP_CHIP[status]}`}>{t(`mx_st_${status}` as Key)}</span><span className="muted small num">{i18n.int(column.length)}</span>
              </h3>
              {column.length === 0 ? <p className="muted small" style={{ margin: 0 }}>{t('mx_columnEmpty')}</p> : (
                <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 8 }}>
                  {column.map((o) => (
                    <li key={o.id} className="card" style={{ padding: 10 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <strong className="ltr">{o.number}</strong><span className="spacer" />
                        <span className={`small ${waited(o.createdAt, now) > 60 ? 'chip warn' : 'muted'}`}>{t('mx_minutes', { n: i18n.int(waited(o.createdAt, now)) })}</span>
                      </div>
                      <div>{o.customerName}{o.area && <span className="muted"> · {o.area}</span>}</div>
                      <div className="small muted">{o.address}</div>
                      <div className="row small" style={{ gap: 6 }}>
                        <span className="num"><strong>{i18n.money(o.total, 'IQD')}</strong></span>
                        <span className="muted">· {t(o.payment === 'cod' ? 'mx_pay_cod' : 'mx_pay_account')}</span>
                        {o.driverName && <span className="muted">· {o.driverName}</span>}
                      </div>
                      {sales && available && (
                        <div className="row no-print" style={{ gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                          {o.next.filter((x) => x !== 'cancelled' && x !== 'new' && !(status === 'out' && x === 'preparing')).map((x) => (
                            <button key={x} type="button" className={`btn small${x === 'delivered' ? ' primary' : ''}`} onClick={() => setMoving({ order: o, to: x })}>{t(`mx_to_${x}` as Key)}</button>
                          ))}
                          {(status === 'new' || status === 'preparing') && <button type="button" className="btn small" onClick={() => void edit(o.id)}>{t('actEdit')}</button>}
                          {o.phone && <button type="button" className="btn small" onClick={() => whatsapp(o, status)} aria-label={t('mx_whatsapp')}><Icon name="mail" size={14} />{t('mx_whatsapp')}</button>}
                          <PrintPartButton id={`dl-${o.id}`} label={t('ux_deliverySlip')} />
                          <PrintPart id={`dl-${o.id}`}>
                            <Paper company={settings ? i18n.name(settings.companyName) : ''} title={`${t('ux_deliverySlip')} ${o.number}`} sub={o.driverName ?? ''}>
                              <p><strong>{o.customerName}</strong> · <span className="ltr">{o.phone}</span></p>
                              <p>{[o.area, o.address].filter(Boolean).join(' — ')}</p>
                              <p>{t('ux_toCollect')}: <strong>{o.payment === 'cod' ? i18n.money(o.total, 'IQD') : t('mx_pay_account')}</strong></p>
                            </Paper>
                          </PrintPart>
                          <button type="button" className="btn small" onClick={() => setMoving({ order: o, to: 'cancelled' })}>{t('mx_to_cancelled')}</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <section className="card">
        <h3 style={{ margin: '12px 16px' }}>{t('mx_today')}</h3>
        {finished.length === 0 ? <EmptyState icon="truck" title={t('mx_today')} text={t('mx_todayNone')} compact /> : (
          <table className="table">
            <thead><tr><th>{t('mx_number')}</th><th>{t('mx_customer')}</th><th>{t('mx_driver')}</th><th className="num">{t('mx_toPay')}</th><th /><th className="no-print" /></tr></thead>
            <tbody>
              {finished.map((o) => (
                <tr key={o.id}>
                  <td className="ltr">{o.number}</td>
                  <td>{o.customerName}{o.cancelReason && <div className="small muted">{o.cancelReason}</div>}</td>
                  <td>{o.driverName ?? ''}</td>
                  <td className="num">{i18n.money(o.total, 'IQD')}</td>
                  <td><span className={`chip ${STEP_CHIP[o.status]}`}>{t(`mx_st_${o.status}` as Key)}</span></td>
                  <td className="no-print">
                    <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      {o.invoiceId && <a className="btn small" href={href(`invoice/${o.invoiceId}`)}>{o.invoiceNumber}</a>}
                      {o.phone && <button type="button" className="btn small" onClick={() => whatsapp(o, o.status)}>{t('mx_whatsapp')}</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {editing && draftFor && (
        <DeliveryOrderForm id={editing.id} initial={draftFor} onClose={() => setEditing(null)}
          onSaved={(o) => { setEditing(null); toast(t('saved')); reload(); if (!editing.id && o.phone && window.confirm(t('mx_sendConfirmNew'))) whatsapp({ ...o, lineCount: o.lines.length }, 'new'); }} />
      )}
      {moving && (
        <MoveDialog order={moving.order} to={moving.to} drivers={drivers.data ?? []} onClose={() => setMoving(null)}
          onMoved={(o) => {
            setMoving(null);
            toast(t('saved'));
            reload();
            if (o.phone && (o.status === 'out' || o.status === 'delivered' || o.status === 'cancelled') && window.confirm(t('mx_sendConfirm'))) whatsapp({ ...o, lineCount: o.lines.length }, o.status);
          }} />
      )}
    </div>
  );
}

function MoveDialog({ order, to, drivers, onClose, onMoved }: {
  order: DeliveryOrderSummary; to: DeliveryStatus; drivers: Driver[]; onClose(): void; onMoved(o: Awaited<ReturnType<typeof deliveryApi.status>>): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [driverId, setDriverId] = useState(order.driverId ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      onMoved(await deliveryApi.status(order.id, { status: to, ...(to === 'out' ? { driverId: driverId || null } : {}), ...(to === 'cancelled' ? { reason } : {}) }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${t(`mx_to_${to}` as Key)} · ${order.number}`} onClose={onClose}>
      <div className="stack">
        {to === 'out' && (
          <label className="field"><span>{t('mx_driver')}</span>
            <select className="input" value={driverId} onChange={(e) => setDriverId(e.target.value)} autoFocus>
              <option value="">{t('mx_driverPick')}</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )}
        {to === 'delivered' && (
          <p style={{ margin: 0 }}>{t(order.payment === 'cod' ? 'mx_deliverCod' : 'mx_deliverAccount', { total: i18n.money(order.total, 'IQD'), driver: order.driverName ?? '' })}</p>
        )}
        {to === 'cancelled' && (
          <label className="field"><span>{t('mx_cancelReason')}</span><input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
        )}
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={busy || (to === 'out' && !driverId) || (to === 'cancelled' && !reason.trim())} onClick={() => void run()}>
            {t(`mx_to_${to}` as Key)}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const isDriverCash = (code: string) => code.startsWith('18');

function Drivers({ admin }: { admin: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { seesBooks } = useData();
  const { data, error, reload } = useLoad(() => deliveryApi.drivers(true), []);
  const [editing, setEditing] = useState<{ id: string | null; input: DriverInput } | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  async function save() {
    if (!editing) return;
    setSaveError(null);
    try {
      if (editing.id) await deliveryApi.updateDriver(editing.id, editing.input);
      else await deliveryApi.addDriver(editing.input);
      setEditing(null);
      toast(t('saved'));
      reload();
    } catch (e) { setSaveError(e); }
  }
  return (
    <div className="stack">
      <div className="row no-print">
        <span className="muted small">{t('mx_driversHelp')}</span>
        <span className="spacer" />
        {admin && <button type="button" className="btn primary" onClick={() => setEditing({ id: null, input: { name: '', phone: '', cashAccount: null, active: true } })}><Icon name="plus" size={16} />{t('mx_addDriver')}</button>}
      </div>
      <ErrorBox error={error} />
      {data && (data.length === 0 ? <EmptyState icon="truck" title={t('mx_tabDrivers')} text={t('mx_driversNone')} /> : (
        <div className="card">
          <table className="table">
            <thead><tr><th>{t('mx_name')}</th><th>{t('mx_phone')}</th>{seesBooks !== false && <><th>{t('mx_cashAccount')}</th><th className="num">{t('mx_holding')}</th></>}<th /><th className="no-print" /></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td><td className="ltr">{d.phone}</td>
                  {seesBooks !== false && <><td className="ltr">{d.cashAccount ?? <span className="chip warn">{t('mx_noCashAccount')}</span>}</td><td className="num">{i18n.money(d.holding, 'IQD')}</td></>}
                  <td>{!d.active && <span className="chip">{t('mx_inactive')}</span>}</td>
                  <td className="no-print">{admin && <button type="button" className="btn small" onClick={() => setEditing({ id: d.id, input: { name: d.name, phone: d.phone, cashAccount: d.cashAccount, active: d.active } })}>{t('actEdit')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {editing && (
        <Modal title={t(editing.id ? 'mx_editDriver' : 'mx_addDriver')} onClose={() => setEditing(null)}>
          <div className="stack">
            <label className="field"><span>{t('mx_name')}</span><input className="input" value={editing.input.name} maxLength={120} onChange={(e) => setEditing({ ...editing, input: { ...editing.input, name: e.target.value } })} autoFocus /></label>
            <label className="field"><span>{t('mx_phone')}</span><input className="input ltr" inputMode="tel" value={editing.input.phone ?? ''} maxLength={40} onChange={(e) => setEditing({ ...editing, input: { ...editing.input, phone: e.target.value } })} /></label>
            <label className="field"><span>{t('mx_cashAccount')}</span>
              <AccountCombo value={editing.input.cashAccount ?? ''} onChange={(code) => setEditing({ ...editing, input: { ...editing.input, cashAccount: code || null } })}
                filter={(a) => isDriverCash(a.code)} ariaLabel={t('mx_cashAccount')} />
              <small className="muted">{t('mx_cashAccountHelp')}</small>
            </label>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={editing.input.active !== false} onChange={(e) => setEditing({ ...editing, input: { ...editing.input, active: e.target.checked } })} />{t('mx_active')}</label>
            <ErrorBox error={saveError} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setEditing(null)}>{t('cancel')}</button>
              <button type="button" className="btn primary" disabled={!editing.input.name.trim()} onClick={() => void save()}>{t('save')}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Handovers({ available }: { available: boolean }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const drivers = useLoad(() => deliveryApi.drivers(), []);
  const list = useLoad(() => deliveryApi.handovers(), []);
  const [form, setForm] = useState<{ driver: Driver; amount: number | null; account: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function send() {
    if (!form || form.amount === null) return;
    setError(null);
    try {
      await deliveryApi.handOver({ driverId: form.driver.id, amount: form.amount, cashAccountCode: form.account });
      setForm(null);
      toast(t('mx_handoverMade'));
      drivers.reload();
      list.reload();
    } catch (e) { setError(e); }
  }
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>{t('mx_handoverHelp')}</p>
      <ErrorBox error={drivers.error ?? list.error} />
      <div className="card">
        <table className="table">
          <thead><tr><th>{t('mx_driver')}</th><th className="num">{t('mx_holding')}</th><th className="no-print" /></tr></thead>
          <tbody>
            {(drivers.data ?? []).map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td><td className="num"><strong>{i18n.money(d.holding, 'IQD')}</strong></td>
                <td className="no-print">
                  {available && d.holding > 0 && <button type="button" className="btn small primary" onClick={() => setForm({ driver: d, amount: d.holding, account: '1811' })}>{t('mx_handover')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && list.data.length > 0 && (
        <div className="card">
          <table className="table">
            <thead><tr><th>{t('date')}</th><th>{t('mx_driver')}</th><th className="num">{t('amount')}</th><th>{t('mx_entry')}</th></tr></thead>
            <tbody>
              {list.data.map((h) => (
                <tr key={h.id}>
                  <td>{i18n.dateTime(h.createdAt)}</td><td>{h.driverName}</td><td className="num">{i18n.money(h.amount, 'IQD')}</td>
                  <td><a href={href(`entry/${h.entryId}`)} className="ltr">{h.entryNumber || '—'}</a> <span className="chip">{t(`mx_entry_${h.entryStatus}` as Key)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && (
        <Modal title={`${t('mx_handover')} · ${form.driver.name}`} onClose={() => setForm(null)}>
          <div className="stack">
            <label className="field"><span>{t('amount')}</span><AmountInput value={form.amount} currency="IQD" onChange={(v) => setForm({ ...form, amount: v })} ariaLabel={t('amount')} /></label>
            <label className="field"><span>{t('mx_officeSafe')}</span>
              <AccountCombo value={form.account} onChange={(code) => setForm({ ...form, account: code })} filter={(a) => isDriverCash(a.code) && a.code !== form.driver.cashAccount} ariaLabel={t('mx_officeSafe')} />
            </label>
            <p className="muted small" style={{ margin: 0 }}>{t('mx_handoverDraft')}</p>
            <ErrorBox error={error} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setForm(null)}>{t('cancel')}</button>
              <button type="button" className="btn primary" disabled={!form.amount || !form.account} onClick={() => void send()}>{t('mx_handover')}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
