import { useEffect, useMemo, useState } from 'react';
import { rateFromX100, todayIso, toWesternDigits, type CurrencyCode } from '@qasa/core';
import { api, ApiError } from '../api.ts';
import { EmptyState, AccountCombo, AmountInput, ErrorBox, Icon, Modal, SearchCombo, useData, useLoad, useToast, type PickOption } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import {
  mobileApi, OPEN_REPAIR, type MobileSummary, type RepairFilter, type RepairInput, type RepairStatus, type RepairView, type SerialLookup,
  type SerialStatus, type SerialView
} from '../industry/mobile-api.ts';
import { go, href } from '../router.ts';

/**
 * Mobile shop (Pro): phones by IMEI or serial number — registered when they come in, named on the sale that took them,
 * bought back from customers (trade-in) — and repair orders from the counter to delivery, with a printed job ticket.
 * Routes: mobile (devices), mobile/repairs, repair/<id>.
 */

const SERIAL_CHIP: Record<SerialStatus, string> = { in_stock: 'ok', sold: 'info', returned: 'warn', defective: 'bad' };
const REPAIR_CHIP: Record<RepairStatus, string> = {
  received: '', diagnosing: 'info', waiting_parts: 'warn', repairing: 'info', ready: 'ok', delivered: '', cancelled: 'bad'
};

const sKey = (s: SerialStatus) => `mob_s_${s}` as Key;
const rKey = (s: RepairStatus) => `mob_r_${s}` as Key;

function SerialChip({ status }: { status: SerialStatus }) {
  const { t } = useI18n();
  return <span className={'chip ' + SERIAL_CHIP[status]}>{t(sKey(status))}</span>;
}

function RepairChip({ status }: { status: RepairStatus }) {
  const { t } = useI18n();
  return <span className={'chip ' + REPAIR_CHIP[status]}>{t(rKey(status))}</span>;
}

function NotAvailable() {
  const { t } = useI18n();
  return <div className="alert info">{t('mob_official')}</div>;
}

const isAbsent = (e: unknown) => e instanceof ApiError && e.status === 404 && !(e.details as { what?: string } | null)?.what;

function rateX100Of(text: string): number {
  return Math.round(Number(toWesternDigits(text).replace(/,/g, '')) * 100);
}

function useCustomers(): PickOption[] {
  const customers = useLoad(() => api.parties({ type: 'customer', active: 'true' }), []);
  return useMemo(() => (customers.data ?? []).map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone })), [customers.data]);
}

function usePhones(i18n: I18n): PickOption[] {
  const items = useLoad(() => api.items({ active: 'true' }), []);
  return useMemo(() => (items.data ?? []).filter((it) => it.trackStock).map((it) => ({
    id: it.id, code: it.code, label: i18n.name(it.name), hint: i18n.int(Math.round(it.qtyMilli / 1000)), search: `${it.name.ar} ${it.name.en} ${it.name.ku} ${it.barcode}`
  })), [items.data, i18n]);
}

/** Pasted or scanned serials: one per line, or separated by commas or spaces when they are IMEIs. */
function splitSerials(text: string): string[] {
  return toWesternDigits(text).split(/[\n,;]+/).flatMap((line) => (/^[\d\s]+$/.test(line.trim()) && line.trim().replace(/\s/g, '').length > 15 ? line.trim().split(/\s+/) : [line]))
    .map((s) => s.trim()).filter(Boolean);
}

/* ---------- the page ---------- */

export function MobileShop({ tab }: { tab: 'devices' | 'repairs' }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [summary, setSummary] = useState<MobileSummary | null>(null);
  const [absent, setAbsent] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    mobileApi.summary().then(setSummary, (e) => { if (isAbsent(e)) setAbsent(true); });
  }, [tick]);
  if (absent) return <NotAvailable />;
  const refresh = () => setTick((n) => n + 1);

  const tiles = summary ? [
    { label: t('mob_inStock'), value: i18n.int(summary.serials.in_stock + summary.serials.returned) },
    { label: t('mob_underWarranty'), value: i18n.int(summary.underWarranty) },
    { label: t('mob_openRepairs'), value: i18n.int(OPEN_REPAIR.reduce((n, s) => n + summary.repairs[s], 0)) },
    { label: t('mob_lateRepairs'), value: i18n.int(summary.lateRepairs), bad: summary.lateRepairs > 0 },
    { label: t('mob_readyRepairs'), value: i18n.int(summary.repairs.ready) }
  ] : [];

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{t('mob_help')}</p>
      {summary && !summary.available && <div className="alert">{t('mob_needsPro')} <a href={href('plans')}>{t('planLicense')}</a></div>}
      {summary && (
        <div className="grid-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="card pad tile">
              <div className="label">{tile.label}</div>
              <div className="value num" style={tile.bad ? { color: 'var(--bad)' } : undefined}>{tile.value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <div className="track" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'devices'} aria-pressed={tab === 'devices'} onClick={() => go('mobile')}>{t('mob_devices')}</button>
          <button type="button" role="tab" aria-selected={tab === 'repairs'} aria-pressed={tab === 'repairs'} onClick={() => go('mobile/repairs')}>{t('mob_repairs')}</button>
        </div>
      </div>
      {tab === 'devices' ? <Devices available={!!summary?.available} onChange={refresh} /> : <Repairs available={!!summary?.available} onChange={refresh} />}
    </div>
  );
}

/* ---------- devices ---------- */

function Devices({ available, onChange }: { available: boolean; onChange(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [status, setStatus] = useState<SerialStatus | ''>('');
  const [q, setQ] = useState('');
  const [find, setFind] = useState('');
  const [found, setFound] = useState<SerialLookup | null>(null);
  const [findError, setFindError] = useState<unknown>(null);
  const [modal, setModal] = useState<'register' | 'tradeIn' | 'assign' | null>(null);
  const { data, error, reload } = useLoad(() => mobileApi.serials({ ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) }), [status, q]);

  async function lookup(serial = find) {
    if (!serial.trim()) return;
    setFindError(null);
    try {
      setFound(await mobileApi.lookup(toWesternDigits(serial)));
    } catch (e) {
      setFound(null);
      setFindError(e);
    }
  }

  const done = (message: string) => {
    setModal(null);
    toast(message);
    reload();
    onChange();
    if (found) void lookup(found.serial);
  };

  return (
    <div className="stack">
      <div className="card pad stack">
        <label className="field">
          <span style={{ fontWeight: 700 }}>{t('mob_lookup')}</span>
          <div className="row">
            <input className="input ltr num" style={{ flex: 1, minWidth: 220, fontSize: 18 }} inputMode="text" autoComplete="off" placeholder={t('mob_lookupHint')}
              value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void lookup(); }} aria-label={t('mob_lookup')} />
            <button type="button" className="btn primary" onClick={() => void lookup()}><Icon name="search" size={16} />{t('mob_find')}</button>
          </div>
        </label>
        <ErrorBox error={findError} />
        {found && <LookupResult result={found} onChanged={(m) => done(m)} />}
      </div>

      <div className="row">
        {available && <button type="button" className="btn primary" onClick={() => setModal('register')}><Icon name="plus" size={16} />{t('mob_register')}</button>}
        {available && <button type="button" className="btn" onClick={() => setModal('assign')}><Icon name="invoice" size={16} />{t('mob_assign')}</button>}
        {available && <button type="button" className="btn" onClick={() => setModal('tradeIn')}><Icon name="swap" size={16} />{t('mob_tradeIn')}</button>}
        <span className="spacer" />
        <input className="input" style={{ width: 240 }} type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="row">
        <div className="track">
          {(['', 'in_stock', 'sold', 'returned', 'defective'] as const).map((s) => (
            <button key={s || 'all'} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s ? t(sKey(s)) : t('all')}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card" style={{ overflowX: 'auto' }}>{data && <SerialsTable serials={data} onPick={(s) => { setFind(s.serial); void lookup(s.serial); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}</div>

      {modal === 'register' && <RegisterModal onClose={() => setModal(null)} onDone={(n) => done(t('mob_registered', { n }))} />}
      {modal === 'tradeIn' && <TradeInModal onClose={() => setModal(null)} onDone={() => done(t('mob_tradedIn'))} />}
      {modal === 'assign' && <AssignModal onClose={() => setModal(null)} onDone={(n) => done(t('mob_assigned', { n }))} />}
    </div>
  );
}

function SerialsTable({ serials, onPick }: { serials: SerialView[]; onPick(s: SerialView): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!serials.length) return <EmptyState icon="phone" title={t('es_serials')} text={t('es_serialsText')} />;
  return (
    <table className="table">
      <thead>
        <tr><th>{t('mob_imei')}</th><th>{t('item')}</th><th>{t('customer')}</th><th>{t('mob_warranty')}</th><th /></tr>
      </thead>
      <tbody>
        {serials.map((s) => (
          <tr key={s.id} className="click" onClick={() => onPick(s)}>
            <td><span className="ltr num">{i18n.digitsOf(s.serial)}</span>{s.grade === 'used' && <span className="chip warn" style={{ marginInlineStart: 6 }}>{t('mob_used')}</span>}</td>
            <td>{i18n.name(s.item.name)}<div className="muted small ltr">{s.item.code}</div></td>
            <td>{s.party?.name ?? s.fromParty?.name ?? '—'}{s.saleInvoice && <div className="muted small num">{i18n.date(s.saleInvoice.date)}</div>}</td>
            <td className="num">{s.warrantyUntil ? <span style={s.warrantyActive ? undefined : { color: 'var(--muted)' }}>{i18n.date(s.warrantyUntil)}</span> : '—'}</td>
            <td><SerialChip status={s.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const NEXT_STATUS: Record<SerialStatus, SerialStatus[]> = { sold: ['returned'], in_stock: ['defective'], returned: ['in_stock', 'defective'], defective: ['in_stock'] };

function LookupResult({ result, onChanged }: { result: SerialLookup; onChanged(message: string): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const d = result.device;
  const [to, setTo] = useState<SerialStatus | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function change() {
    if (!d || !to) return;
    setBusy(true);
    setError(null);
    try {
      await mobileApi.setStatus(d.id, to, reason.trim() || undefined);
      setTo(null);
      setReason('');
      onChanged(t(sKey(to)));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      {!d ? (
        <div className="muted">{t('mob_notOurs', { s: i18n.digitsOf(result.serial) })}</div>
      ) : (
        <>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{i18n.name(d.item.name)} <span className="muted small ltr">{d.item.code}</span></div>
              <div className="ltr num">{i18n.digitsOf(d.serial)}</div>
            </div>
            <SerialChip status={d.status} />
            {d.grade === 'used' && <span className="chip warn">{t('mob_used')}</span>}
          </div>
          <div className="grid-2">
            <div className="small">
              <div><span className="muted">{t('mob_cameFrom')}: </span>
                {d.purchaseInvoice ? <a className="ltr" href={href(`invoice/${d.purchaseInvoice.id}`)}>{d.purchaseInvoice.number ?? '—'}</a> : t('mob_registeredBy', { u: d.createdBy })}
                {d.fromParty && <> · {t('mob_tradeInFrom', { n: d.fromParty.name })}</>}
              </div>
              {d.cost !== null && <div><span className="muted">{t('mob_cost')}: </span><span className="num">{i18n.money(d.cost, 'IQD')}</span></div>}
            </div>
            <div className="small">
              {d.saleInvoice ? (
                <>
                  <div><span className="muted">{t('mob_soldOn')}: </span><a className="ltr" href={href(`invoice/${d.saleInvoice.id}`)}>{d.saleInvoice.number}</a> · <span className="num">{i18n.date(d.saleInvoice.date)}</span></div>
                  {d.party && <div><span className="muted">{t('customer')}: </span><a href={href(`party/${d.party.id}`)}>{d.party.name}</a>{d.party.phone && <> · <span className="ltr">{i18n.digitsOf(d.party.phone)}</span></>}</div>}
                  <div>
                    <span className="muted">{t('mob_warranty')}: </span>
                    {d.warrantyUntil ? <><span className="num">{i18n.date(d.warrantyUntil)}</span> <span className={'chip ' + (d.warrantyActive ? 'ok' : 'bad')}>{t(d.warrantyActive ? 'mob_warrantyOn' : 'mob_warrantyOff')}</span></> : t('mob_noWarranty')}
                  </div>
                </>
              ) : <div className="muted">{t('mob_notSold')}</div>}
            </div>
          </div>
          {d.notes && <div className="small"><span className="muted">{t('notes')}: </span>{d.notes}</div>}
          {NEXT_STATUS[d.status].length > 0 && (
            <div className="row">
              <span className="muted small">{t('mob_markAs')}:</span>
              {NEXT_STATUS[d.status].map((s) => (
                <button key={s} type="button" className={'btn' + (to === s ? ' primary' : '')} onClick={() => setTo(to === s ? null : s)}>{t(sKey(s))}</button>
              ))}
            </div>
          )}
          {to && (
            <div className="row">
              <input className="input" style={{ flex: 1 }} placeholder={t('mob_reason')} aria-label={t('mob_reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
              <button type="button" className="btn primary" disabled={busy || (to === 'returned' && !reason.trim())} onClick={() => void change()}><Icon name="check" size={16} />{t('save')}</button>
            </div>
          )}
          <ErrorBox error={error} />
        </>
      )}
      {result.repairs.length > 0 && (
        <div>
          <div className="muted small" style={{ marginBottom: 4 }}>{t('mob_repairHistory')}</div>
          <RepairsTable repairs={result.repairs} />
        </div>
      )}
    </div>
  );
}

function RegisterModal({ onClose, onDone }: { onClose(): void; onDone(n: number): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const phones = usePhones(i18n);
  const [itemId, setItemId] = useState('');
  const [text, setText] = useState('');
  const [grade, setGrade] = useState<'new' | 'used'>('new');
  const [invoiceId, setInvoiceId] = useState('');
  const purchases = useLoad(() => api.invoices({ kind: 'purchase', status: 'posted' }), []);
  const invoiceOptions: PickOption[] = (purchases.data ?? []).map((inv) => ({ id: inv.id, code: inv.number ?? '', label: inv.partyName ?? '', hint: i18n.date(inv.date) }));
  const serials = splitSerials(text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const made = await mobileApi.register({ itemId, serials, grade, ...(invoiceId ? { purchaseInvoiceId: invoiceId } : {}) });
      onDone(made.length);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={t('mob_register')} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('mob_registerHelp')}</p>
        <div className="field"><span>{t('mob_model')}</span><SearchCombo value={itemId} options={phones} onChange={setItemId} placeholder={t('mob_model')} /></div>
        <div className="field"><span>{t('mob_purchaseInvoice')} <span className="muted small">({t('mob_optional')})</span></span><SearchCombo value={invoiceId} options={invoiceOptions} onChange={setInvoiceId} placeholder={t('mob_purchaseInvoice')} emptyLabel={t('mob_none')} /></div>
        <div className="track">
          {(['new', 'used'] as const).map((g) => <button key={g} type="button" aria-pressed={grade === g} onClick={() => setGrade(g)}>{t(g === 'new' ? 'mob_new' : 'mob_used')}</button>)}
        </div>
        <label className="field">
          <span>{t('mob_serialsList')} <span className="muted small num">({i18n.int(serials.length)})</span></span>
          <textarea className="input ltr num" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('mob_scanHint')} />
        </label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !itemId || !serials.length} onClick={() => void submit()}><Icon name="check" size={16} />{t('mob_register')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function AssignModal({ onClose, onDone }: { onClose(): void; onDone(n: number): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const sales = useLoad(() => api.invoices({ kind: 'sale', status: 'posted' }), []);
  const options: PickOption[] = (sales.data ?? []).map((inv) => ({ id: inv.id, code: inv.number ?? '', label: inv.partyName ?? t('mob_walkIn'), hint: i18n.date(inv.date) }));
  const [invoiceId, setInvoiceId] = useState('');
  const [text, setText] = useState('');
  const [months, setMonths] = useState('12');
  const serials = splitSerials(text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const done = await mobileApi.assign(invoiceId, serials, Number(toWesternDigits(months)) || 0);
      onDone(done.length);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={t('mob_assign')} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('mob_assignHelp')}</p>
        <div className="field"><span>{t('mob_saleInvoice')}</span><SearchCombo value={invoiceId} options={options} onChange={setInvoiceId} placeholder={t('mob_saleInvoice')} /></div>
        <label className="field">
          <span>{t('mob_serialsList')} <span className="muted small num">({i18n.int(serials.length)})</span></span>
          <textarea className="input ltr num" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('mob_scanHint')} />
        </label>
        <label className="field" style={{ maxWidth: 220 }}><span>{t('mob_warrantyMonths')}</span><input className="input num ltr" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !invoiceId || !serials.length} onClick={() => void submit()}><Icon name="check" size={16} />{t('mob_assign')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function TradeInModal({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const phones = usePhones(i18n);
  const customers = useCustomers();
  const [date, setDate] = useState(todayIso());
  const [itemId, setItemId] = useState('');
  const [partyId, setPartyId] = useState('');
  const [serial, setSerial] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  const [price, setPrice] = useState<number | null>(null);
  const [cashAccount, setCashAccount] = useState(settings?.postingAccounts.cash ?? '');
  const [rate, setRate] = useState(String(rateFromX100(settings?.defaultRateX100 ?? 142000)));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await mobileApi.tradeIn({
        date, itemId, serial: toWesternDigits(serial), partyId, currency, price: price ?? 0, cashAccountCode: cashAccount, lang: i18n.lang,
        ...(currency === 'USD' ? { rateX100: rateX100Of(rate) } : {}), ...(notes.trim() ? { notes: notes.trim() } : {})
      });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={t('mob_tradeIn')} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('mob_tradeInHelp')}</p>
        <div className="grid-2">
          <div className="field"><span>{t('mob_seller')}</span><SearchCombo value={partyId} options={customers} onChange={setPartyId} placeholder={t('customer')} /></div>
          <div className="field"><span>{t('mob_model')}</span><SearchCombo value={itemId} options={phones} onChange={setItemId} placeholder={t('mob_model')} /></div>
          <label className="field"><span>{t('mob_imei')}</span><input className="input ltr num" value={serial} onChange={(e) => setSerial(e.target.value)} /></label>
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>{t('currency')}</span>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}><option value="IQD">IQD</option><option value="USD">USD</option></select>
          </label>
          <label className="field"><span>{t('mob_paid')}</span><AmountInput value={price} currency={currency} onChange={setPrice} ariaLabel={t('mob_paid')} /></label>
          <div className="field"><span>{t('cashAccount')}</span><AccountCombo value={cashAccount} onChange={setCashAccount} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} /></div>
          {currency === 'USD' && <label className="field"><span>{t('exchangeRate')}</span><input className="input num ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>}
        </div>
        <label className="field"><span>{t('notes')}</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('mob_conditionHint')} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || !itemId || !partyId || !serial.trim() || !price || !cashAccount} onClick={() => void submit()}><Icon name="check" size={16} />{t('mob_buy')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- repairs ---------- */

function Repairs({ available, onChange }: { available: boolean; onChange(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const [filter, setFilter] = useState<RepairFilter | ''>('open');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, error, reload } = useLoad(() => mobileApi.repairs({ ...(filter ? { status: filter } : {}), ...(q.trim() ? { q: q.trim() } : {}) }), [filter, q]);

  async function move(r: RepairView, status: RepairStatus) {
    try {
      await mobileApi.repairStatus(r.id, status);
      toast(`${r.number}: ${t(rKey(status))}`);
      reload();
      onChange();
    } catch (e) {
      toast(e instanceof ApiError ? t('err_action_not_allowed') : String(e));
    }
  }

  return (
    <div className="stack">
      <div className="row">
        {available && <button type="button" className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />{t('mob_newRepair')}</button>}
        <span className="spacer" />
        <input className="input" style={{ width: 240 }} type="search" placeholder={t('mob_repairSearch')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="row">
        <div className="track">
          {(['open', 'late', 'ready', 'delivered', 'cancelled', ''] as const).map((s) => (
            <button key={s || 'all'} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}>
              {s === '' ? t('all') : s === 'open' ? t('mob_open') : s === 'late' ? t('mob_late') : t(rKey(s))}
            </button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card" style={{ overflowX: 'auto' }}>{data && <RepairsTable repairs={data} onMove={(r, s) => void move(r, s)} />}</div>
      {creating && <RepairModal onClose={() => setCreating(false)} onDone={(r) => { setCreating(false); onChange(); go(`repair/${r.id}`); }} />}
    </div>
  );
}

function RepairsTable({ repairs, onMove }: { repairs: RepairView[]; onMove?(r: RepairView, s: RepairStatus): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!repairs.length) return <EmptyState icon="tool" title={t('es_repairs')} text={t('es_repairsText')} />;
  return (
    <table className="table">
      <thead>
        <tr><th>{t('number')}</th><th>{t('customer')}</th><th>{t('mob_device')}</th><th>{t('mob_promised')}</th><th className="amount">{t('mob_estimate')}</th><th /></tr>
      </thead>
      <tbody>
        {repairs.map((r) => (
          <tr key={r.id} className="click" onClick={() => go(`repair/${r.id}`)}>
            <td><a className="ltr num" href={href(`repair/${r.id}`)} onClick={(e) => e.stopPropagation()}>{r.number}</a><div className="muted small num">{i18n.date(r.date)}</div></td>
            <td>{r.party.name}{r.party.phone && <div className="muted small ltr">{i18n.digitsOf(r.party.phone)}</div>}</td>
            <td>{r.device}<div className="muted small">{r.problem}</div></td>
            <td className="num">{r.promisedDate ? i18n.date(r.promisedDate) : '—'}{r.late && <div className="small" style={{ color: 'var(--bad)' }}>{t('mob_late')}</div>}</td>
            <td className="amount">{r.estimate ? i18n.money(r.estimate, r.currency) : '—'}</td>
            <td onClick={(e) => e.stopPropagation()}>
              {onMove && r.actions.includes('status') ? (
                <select className="input" style={{ minWidth: 150 }} aria-label={t('mob_status')} value={r.status} onChange={(e) => onMove(r, e.target.value as RepairStatus)}>
                  {OPEN_REPAIR.map((s) => <option key={s} value={s}>{t(rKey(s))}</option>)}
                </select>
              ) : <RepairChip status={r.status} />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RepairModal({ repair, onClose, onDone }: { repair?: RepairView; onClose(): void; onDone(r: RepairView): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const customers = useCustomers();
  const [partyId, setPartyId] = useState(repair?.party.id ?? '');
  const [date, setDate] = useState(repair?.date ?? todayIso());
  const [device, setDevice] = useState(repair?.device ?? '');
  const [serial, setSerial] = useState(repair?.serial ?? '');
  const [problem, setProblem] = useState(repair?.problem ?? '');
  const [accessories, setAccessories] = useState(repair?.accessories ?? '');
  const [passcode, setPasscode] = useState(repair?.passcodeGiven ?? false);
  const [technician, setTechnician] = useState(repair?.technician ?? '');
  const [currency, setCurrency] = useState<CurrencyCode>(repair?.currency ?? 'IQD');
  const [estimate, setEstimate] = useState<number | null>(repair ? repair.estimate : null);
  const [promised, setPromised] = useState(repair?.promisedDate ?? '');
  const [notes, setNotes] = useState(repair?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const fields = {
      device: device.trim(), serial: toWesternDigits(serial), problem: problem.trim(), accessories, passcodeGiven: passcode, technician,
      estimate: estimate ?? 0, promisedDate: promised, notes
    };
    try {
      const saved = repair ? await mobileApi.updateRepair(repair.id, fields) : await mobileApi.createRepair({ ...fields, date, partyId, currency } as RepairInput);
      onDone(saved);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={repair ? `${t('mob_editRepair')} — ${repair.number}` : t('mob_newRepair')} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          {!repair && <div className="field"><span>{t('customer')}</span><SearchCombo value={partyId} options={customers} onChange={setPartyId} placeholder={t('customer')} /></div>}
          {!repair && <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>}
          <label className="field"><span>{t('mob_device')}</span><input className="input" value={device} onChange={(e) => setDevice(e.target.value)} placeholder={t('mob_deviceHint')} /></label>
          <label className="field"><span>{t('mob_imei')} <span className="muted small">({t('mob_optional')})</span></span><input className="input ltr num" value={serial} onChange={(e) => setSerial(e.target.value)} /></label>
        </div>
        <label className="field"><span>{t('mob_problem')}</span><textarea className="input" rows={2} value={problem} onChange={(e) => setProblem(e.target.value)} /></label>
        <div className="grid-2">
          <label className="field"><span>{t('mob_accessories')}</span><input className="input" value={accessories} onChange={(e) => setAccessories(e.target.value)} placeholder={t('mob_accessoriesHint')} /></label>
          <label className="field"><span>{t('mob_technician')}</span><input className="input" value={technician} onChange={(e) => setTechnician(e.target.value)} /></label>
          {!repair && <label className="field"><span>{t('currency')}</span>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}><option value="IQD">IQD</option><option value="USD">USD</option></select>
          </label>}
          <label className="field"><span>{t('mob_estimate')}</span><AmountInput value={estimate} currency={currency} onChange={setEstimate} ariaLabel={t('mob_estimate')} /></label>
          <label className="field"><span>{t('mob_promised')}</span><input className="input" type="date" value={promised} onChange={(e) => setPromised(e.target.value)} /></label>
        </div>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={passcode} onChange={(e) => setPasscode(e.target.checked)} />{t('mob_passcodeGiven')}</label>
        <label className="field"><span>{t('notes')}</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || (!repair && !partyId) || !device.trim() || !problem.trim()} onClick={() => void submit()}><Icon name="check" size={16} />{t('save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- one repair (and its job ticket) ---------- */

export function RepairDetail({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, reloadAccounts } = useData();
  const { data, error, reload } = useLoad(() => mobileApi.repair(id), [id]);
  const [modal, setModal] = useState<'edit' | 'deliver' | 'cancel' | null>(null);

  if (error) return isAbsent(error) ? <NotAvailable /> : <ErrorBox error={error} />;
  if (!data) return null;
  const r = data;
  const company = settings ? i18n.name(settings.companyName) : '';

  const done = async (message: string) => {
    setModal(null);
    await reloadAccounts();
    toast(message);
    reload();
  };

  async function move(status: RepairStatus) {
    try {
      await mobileApi.repairStatus(r.id, status);
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? t('err_action_not_allowed') : String(e));
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="row no-print">
        <button type="button" className="btn" onClick={() => history.back()}>{t('back')}</button>
        <span className="spacer" />
        {r.actions.includes('deliver') && <button type="button" className="btn primary" onClick={() => setModal('deliver')}><Icon name="check" size={16} />{t('mob_deliver')}</button>}
        {r.actions.includes('edit') && <button type="button" className="btn" onClick={() => setModal('edit')}><Icon name="edit" size={16} />{t('mob_editRepair')}</button>}
        {r.actions.includes('cancel') && <button type="button" className="btn danger" onClick={() => setModal('cancel')}><Icon name="undo" size={16} />{t('mob_cancelRepair')}</button>}
        <button type="button" className="btn" onClick={() => window.print()}><Icon name="printer" size={16} />{t('mob_printTicket')}</button>
      </div>

      {r.actions.includes('status') && (
        <div className="row no-print">
          <div className="track" aria-label={t('mob_status')}>
            {OPEN_REPAIR.map((s) => <button key={s} type="button" aria-pressed={r.status === s} onClick={() => void move(s)}>{t(rKey(s))}</button>)}
          </div>
          {r.late && <span className="chip bad">{t('mob_late')}</span>}
        </div>
      )}

      <div className="paper">
        <div className="paper-head">
          <div style={{ flex: 1 }}>
            <div className="company-line">{company}</div>
            <div className="paper-title">{t('mob_ticketTitle')}</div>
            <div style={{ marginTop: 4 }}><RepairChip status={r.status} /></div>
          </div>
          <div className="paper-meta">
            <span className="muted">{t('number')}</span><strong className="ltr">{r.number}</strong>
            <span className="muted">{t('date')}</span><strong className="num">{i18n.date(r.date)}</strong>
            {r.promisedDate && <><span className="muted">{t('mob_promised')}</span><strong className="num">{i18n.date(r.promisedDate)}</strong></>}
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: 14 }}>
          <div>
            <div className="muted small">{t('customer')}</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}><a href={href(`party/${r.party.id}`)}>{r.party.name}</a></div>
            {r.party.phone && <div className="small"><span className="ltr">{i18n.digitsOf(r.party.phone)}</span></div>}
          </div>
          <div>
            <div className="muted small">{t('mob_device')}</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{r.device}</div>
            {r.serial && <div className="small">{t('mob_imei')}: <span className="ltr num">{i18n.digitsOf(r.serial)}</span></div>}
            {r.warranty && (
              <div className="small">{t('mob_warranty')}: {r.warranty.warrantyUntil ? <span className="num">{i18n.date(r.warranty.warrantyUntil)}</span> : t('mob_noWarranty')}
                {' '}<span className={'chip ' + (r.warranty.active ? 'ok' : '')}>{t(r.warranty.active ? 'mob_warrantyOn' : 'mob_warrantyOff')}</span></div>
            )}
          </div>
        </div>

        <div className="totals" style={{ maxWidth: 560, marginBottom: 14 }}>
          <span className="muted">{t('mob_problem')}</span><strong>{r.problem}</strong>
          <span className="muted">{t('mob_accessories')}</span><span>{r.accessories || '—'}</span>
          <span className="muted">{t('mob_passcode')}</span><span>{t(r.passcodeGiven ? 'mob_yes' : 'mob_no')}</span>
          {r.technician && <><span className="muted">{t('mob_technician')}</span><span>{r.technician}</span></>}
          <span className="muted">{t('mob_estimate')}</span><span className="num">{r.estimate ? i18n.money(r.estimate, r.currency) : '—'}</span>
          {r.invoice && <><span className="muted">{t('mob_charged')}</span><span className="num"><a className="ltr" href={href(`invoice/${r.invoice.id}`)}>{r.invoice.number}</a> · {i18n.money(r.invoice.total, r.currency)}</span></>}
          {r.deliveredAt && <><span className="muted">{t('mob_deliveredOn')}</span><span className="num">{i18n.date(r.deliveredAt.slice(0, 10))}</span></>}
        </div>
        {r.notes && <p className="small"><span className="muted">{t('notes')}: </span>{r.notes}</p>}
        <p className="small" style={{ marginBottom: 6 }}>{t('mob_ticketTerms')}</p>

        <div className="sigs" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div className="sig"><div className="muted small">{t('customer')}</div><div className="who">{r.party.name}</div></div>
          <div className="sig done"><div className="muted small">{t('sigCompany')}</div><div className="who">{r.createdBy}</div></div>
        </div>
      </div>

      {modal === 'edit' && <RepairModal repair={r} onClose={() => setModal(null)} onDone={() => void done(t('saved'))} />}
      {modal === 'deliver' && <DeliverModal repair={r} onClose={() => setModal(null)} onDone={() => void done(t('mob_r_delivered'))} />}
      {modal === 'cancel' && <CancelModal repair={r} onClose={() => setModal(null)} onDone={() => void done(t('mob_r_cancelled'))} />}
    </div>
  );
}

function DeliverModal({ repair: r, onClose, onDone }: { repair: RepairView; onClose(): void; onDone(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState<number | null>(r.warranty?.active ? 0 : r.estimate);
  const [payment, setPayment] = useState<'cash' | 'credit'>('cash');
  const [cashAccount, setCashAccount] = useState(settings?.postingAccounts.cash ?? '');
  const [rate, setRate] = useState(String(rateFromX100(settings?.defaultRateX100 ?? 142000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const charge = (amount ?? 0) > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await mobileApi.deliver(r.id, {
        date, amount: amount ?? 0, payment, lang: i18n.lang, ...(payment === 'cash' && charge ? { cashAccountCode: cashAccount } : {}),
        ...(r.currency === 'USD' ? { rateX100: rateX100Of(rate) } : {})
      });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={`${t('mob_deliver')} — ${r.number}`} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{t('mob_deliverHelp')}</p>
        {r.warranty?.active && <div className="alert info">{t('mob_underWarrantyNote')}</div>}
        <div className="grid-2">
          <label className="field"><span>{t('date')}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>{t('mob_charge')}</span><AmountInput value={amount} currency={r.currency} onChange={setAmount} ariaLabel={t('mob_charge')} /></label>
        </div>
        {charge && (
          <>
            <div className="track">
              <button type="button" aria-pressed={payment === 'cash'} onClick={() => setPayment('cash')}>{t('mob_payCash')}</button>
              <button type="button" aria-pressed={payment === 'credit'} onClick={() => setPayment('credit')}>{t('credit')}</button>
            </div>
            <div className="grid-2">
              {payment === 'cash' && <div className="field"><span>{t('cashAccount')}</span><AccountCombo value={cashAccount} onChange={setCashAccount} filter={(a) => a.code.startsWith('18')} ariaLabel={t('cashAccount')} /></div>}
              {r.currency === 'USD' && <label className="field"><span>{t('exchangeRate')}</span><input className="input num ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>}
            </div>
          </>
        )}
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || amount === null || (charge && payment === 'cash' && !cashAccount)} onClick={() => void submit()}><Icon name="check" size={16} />{t('mob_deliver')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

function CancelModal({ repair: r, onClose, onDone }: { repair: RepairView; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await mobileApi.cancelRepair(r.id, reason.trim());
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={`${t('mob_cancelRepair')} — ${r.number}`} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>{t('mob_reason')}</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn danger" disabled={busy} onClick={() => void submit()}><Icon name="undo" size={16} />{t('mob_cancelRepair')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}
