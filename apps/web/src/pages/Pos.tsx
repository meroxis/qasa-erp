import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { normalizeForSearch, rateFromX100, rateToX100, toWesternDigits, type CurrencyCode } from '@qasa/core';
import { api, type InvoiceView, type ItemView, type PartyView, type WarehouseView } from '../api.ts';
import { AccountCombo, AmountInput, ErrorBox, Icon, Modal, SearchCombo, useData, useLoad, usePageNav, useToast, type PickOption } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';
import { posApi, type Money2, type PosMethod, type ShiftReport, type ShiftView } from '../industry/pos-api.ts';
import '../pos.css';
import { PrintDocument } from '../industry/PrintDocument.tsx';
import { invoiceModel } from '../industry/print-model.ts';
import { usePrintSetup } from '../industry/print-api.ts';
import { addRefusal, cashChange, changeLineUnit, parseScan, posSaleLine, priceIn, priceRateFor, tileOffer } from './pos-logic.ts';
import { inUnits, salePriceFor, unitChoices, unitLabel, type LineUnit } from '../industry/units.ts';
import { BatchPick, useExpiredConfirm } from '../industry/BatchFields.tsx';
import { pharmacyApi, type MedicineView } from '../industry/pharmacy-api.ts';
import { RxTick, useControlledPrompt, useRxItems } from '../industry/PharmacyPrompts.tsx';
import { printAlone, printDocument } from '../industry/printing.ts';

/**
 * Point of sale (every plan). Made for a cashier with no training: the search box always has the focus, so a barcode
 * scanner (which types the code and Enter) adds the item at once; big buttons for touch screens; F-keys for speed.
 * Each sale is a cash sale invoice posted at once into the shift's safe; the receipt prints on an 80 mm printer.
 */

const REGISTER_KEY = 'qasa.pos.register';
const remembered = () => { try { return localStorage.getItem(REGISTER_KEY) ?? ''; } catch { return ''; } };
const remember = (v: string) => { try { localStorage.setItem(REGISTER_KEY, v); } catch { /* not available */ } };

/**
 * qtyMilli: in the line's unit (null: the item's base unit); unitPrice: per that unit. batchId: the batch picked by
 * hand ('' automatic); rxSeen: a pharmacy's "prescription seen" tick (a reminder, not sent).
 */
interface CartLine { item: ItemView; qtyMilli: number; unitPrice: number; unit: LineUnit; batchId?: string; rxSeen?: boolean }
const lineKey = (l: Pick<CartLine, 'item' | 'unit'>) => `${l.item.id}|${l.unit ?? ''}`;

const lineTotal = (l: CartLine) => Math.round((l.qtyMilli * l.unitPrice) / 1000);

function money2(i18n: I18n, m: Money2): string {
  return m.USD ? `${i18n.money(m.IQD, 'IQD')} · ${i18n.money(m.USD, 'USD')}` : i18n.money(m.IQD, 'IQD');
}

/** Two letters for an item without a picture. */
const initials = (s: string) => s.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase();

function ItemPicture({ item, name }: { item: ItemView; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="pos-initials" aria-hidden="true">{initials(name) || '•'}</span>;
  return <img className="pos-img" src={`/api/items/${item.id}/image`} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

/* ---------- the page ---------- */

export function Pos() {
  const { data, error, reload } = useLoad(() => posApi.current(), []);
  const shift = data?.shift ?? null;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return shift ? <Register key={shift.id} initial={shift} onClosed={reload} /> : <OpenShift onOpened={reload} />;
}

/* ---------- opening a shift ---------- */

function OpenShift({ onOpened }: { onOpened(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  const [register, setRegister] = useState(remembered() || t('pos_defaultRegister'));
  const [cashAccount, setCashAccount] = useState(settings?.postingAccounts.cash ?? '1811');
  const [warehouseId, setWarehouseId] = useState('');
  const [opening, setOpening] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { data: warehouses } = useLoad(() => api.warehouses(), []);
  const { data: recent } = useLoad(() => posApi.shifts({ limit: '10' }), []);
  useEffect(() => {
    if (!warehouseId && warehouses?.length) setWarehouseId((warehouses.find((w: WarehouseView) => w.active) ?? warehouses[0]!).id);
  }, [warehouses, warehouseId]);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      await posApi.open({ register: register.trim(), cashAccountCode: cashAccount, warehouseId, openingCash: opening ?? 0 });
      remember(register.trim());
      onOpened();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack pos-open">
      <div className="card pad stack">
        <h2 style={{ margin: 0 }}>{t('pos_openTitle')}</h2>
        <p className="muted" style={{ margin: 0 }}>{t('pos_openHelp')}</p>
        <div className="grid-2">
          <label className="field"><span>{t('pos_register')}</span><input className="input pos-big-input" maxLength={60} value={register} onChange={(e) => setRegister(e.target.value)} /></label>
          <label className="field"><span>{t('pos_openingCash')}</span><AmountInput value={opening} currency="IQD" onChange={setOpening} ariaLabel={t('pos_openingCash')} /></label>
          <div className="field"><span>{t('pos_cashAccount')}</span><AccountCombo value={cashAccount} onChange={setCashAccount} filter={(a) => a.code.startsWith('18')} ariaLabel={t('pos_cashAccount')} /></div>
          <label className="field"><span>{t('pos_warehouse')}</span>
            <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {(warehouses ?? []).filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.code} — {i18n.name(w.name)}</option>)}
            </select>
          </label>
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary pos-touch" disabled={busy || !warehouseId} onClick={() => void open()}>
            <Icon name="wallet" size={18} />{t('pos_openButton')}
          </button>
        </div>
      </div>
      {recent && recent.length > 0 && <ShiftList shifts={recent} />}
    </div>
  );
}

function ShiftList({ shifts }: { shifts: ShiftView[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <div className="card">
      <div className="card-head"><h3 style={{ margin: 0 }}>{t('pos_recentShifts')}</h3></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('pos_shift')}</th><th>{t('pos_register')}</th><th>{t('pos_cashier')}</th><th>{t('pos_opened')}</th><th>{t('pos_salesCount')}</th><th className="num">{t('pos_sales')}</th><th>{t('pos_difference')}</th></tr></thead>
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id}>
                <td><a href={href(`pos-shift/${s.id}`)}>{s.number}</a> {s.status === 'open' && <span className="chip info">{t('pos_statusOpen')}</span>}</td>
                <td>{s.register}</td>
                <td>{s.openedBy}</td>
                <td className="num">{i18n.date(s.openedAt.slice(0, 10))} {i18n.digitsOf(new Date(s.openedAt).toTimeString().slice(0, 5))}</td>
                <td className="num">{i18n.int(s.count)}</td>
                <td className="num">{money2(i18n, s.sales)}</td>
                <td className="num">{s.difference ? <DiffText d={s.difference} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiffText({ d }: { d: Money2 }) {
  const i18n = useI18n();
  const bad = d.IQD !== 0 || d.USD !== 0;
  return <span style={{ color: bad ? 'var(--bad)' : 'var(--ok)' }}>{money2(i18n, d)}</span>;
}

/* ---------- the register (an open shift) ---------- */

function Register({ initial, onClosed }: { initial: ShiftView; onClosed(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings } = useData();
  usePageNav({ key: 'pos_title', group: 'gSales' });

  const [shift, setShift] = useState(initial);
  const [items, setItems] = useState<ItemView[]>([]);
  const [customers, setCustomers] = useState<PartyView[]>([]);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  const [rateText, setRateText] = useState(() => String(rateFromX100(settings?.defaultRateX100 ?? 142000)));
  const [discount, setDiscount] = useState<number | null>(0);
  const [paid, setPaid] = useState<number | null>(null);
  const [partyId, setPartyId] = useState('');
  // how it is paid (1.1): no parts = all cash, as before; else 1–4 parts that add up to the total
  const [parts, setParts] = useState<{ method: PosMethod; amount: number | null }[]>([]);
  const [methods, setMethods] = useState<PosMethod[]>(['cash']);
  useEffect(() => { posApi.paymentAccounts().then((r) => setMethods(r.methods), () => {}); }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const expired = useExpiredConfirm();
  const [receipt, setReceipt] = useState<InvoiceView | null>(null);
  const [closing, setClosing] = useState(false);
  const [notFound, setNotFound] = useState('');
  // an item that exists but has no rate to convert its price into this sale's currency
  const [noRate, setNoRate] = useState('');
  const search = useRef<HTMLInputElement>(null);

  const rateX100 = currency === 'USD' ? rateToX100(Number(toWesternDigits(rateText).replace(/,/g, '')) || 0) : 100;
  // converts a price in the other currency into this sale's currency; a dinar sale uses the company's default rate
  const priceRate = priceRateFor(currency, rateX100, settings?.defaultRateX100);

  const loadItems = useCallback(() => { void api.items({ active: 'true' }).then(setItems, setError); }, []);
  useEffect(() => {
    loadItems();
    void api.parties({ type: 'customer', active: 'true' }).then(setCustomers, () => {});
  }, [loadItems]);

  // the search box keeps the focus (a scanner types into it), unless a dialog or another field is being used
  const focusSearch = useCallback(() => { window.setTimeout(() => search.current?.focus(), 0); }, []);
  useEffect(() => { focusSearch(); }, [focusSearch]);

  const searchable = useMemo(() => items.map((it) => ({
    item: it,
    key: normalizeForSearch([it.code, it.barcode, it.name.ar, it.name.en, it.name.ku].join(' '))
  })), [items]);

  // a pharmacy (Pro): the search also finds medicines by their generic name, and a tile shows it with the shelf
  const { plan, settings: companySettings } = useData();
  const pharmacy = !!plan?.features.includes('pharmacy') && !!companySettings?.businessTypes?.includes('pharmacy');
  const [medicines, setMedicines] = useState<Map<string, MedicineView>>(new Map());
  const controlled = useControlledPrompt();
  const rxItems = useRxItems(pharmacy);
  useEffect(() => {
    if (!pharmacy || !q.trim()) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      pharmacyApi.search(q.trim()).then((found) => {
        if (alive) setMedicines((m) => new Map([...m, ...found.map((x) => [x.itemId, x] as const)]));
      }, () => {});
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [pharmacy, q]);

  const matches = useMemo(() => {
    const n = normalizeForSearch(q);
    if (!n) return items.slice(0, 40);
    const words = n.split(/\s+/).filter(Boolean);
    const direct = searchable.filter((s) => words.every((w) => s.key.includes(w))).map((s) => s.item);
    // medicines whose generic name matched
    const generic = pharmacy ? items.filter((it) => !direct.includes(it) && normalizeForSearch(medicines.get(it.id)?.genericName ?? '').includes(n)) : [];
    return [...direct, ...generic].slice(0, 40);
  }, [q, items, searchable, pharmacy, medicines]);

  /** One of `unit` of an item, in the sale's currency: the unit's own price, or the base price × its factor. */
  const unitPriceOf = useCallback((item: ItemView, unit: LineUnit) => {
    const own = unit ? item.units.find((u) => u.unit === unit)?.salePrice ?? null : null;
    const ownIn = own !== null ? priceIn({ salePrice: own, saleCurrency: item.saleCurrency }, currency, priceRate) : null;
    return salePriceFor(item, unit, priceIn(item, currency, priceRate), { own: ownIn });
  }, [currency, priceRate]);

  const add = useCallback((item: ItemView, qtyMilli = 1000, unit: LineUnit = item.saleUnit ?? null) => {
    // a dollar-priced item cannot go into a dinar sale (or the reverse) without a rate to convert it
    if (addRefusal(item, currency, priceRate)) { setNotFound(''); setNoRate(item.code); return; }
    setCart((c) => {
      const i = c.findIndex((l) => l.item.id === item.id && l.unit === unit);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qtyMilli: l.qtyMilli + qtyMilli } : l));
      return [...c, { item, qtyMilli, unit, unitPrice: unitPriceOf(item, unit) }];
    });
    setNotFound('');
    setNoRate('');
    setPaid(null);
  }, [currency, priceRate, unitPriceOf]);

  // a different currency or rate re-prices the cart
  useEffect(() => {
    setCart((c) => c.map((l) => ({ ...l, unitPrice: unitPriceOf(l.item, l.unit) })));
    setDiscount(0);
    setPaid(null);
  }, [currency, priceRate]);

  /** Enter in the search box: an exact barcode or code wins (a scanner), else the only match. "3*code" sells three. */
  const onEnter = () => {
    const raw = toWesternDigits(q).trim();
    if (!raw) return;
    const { code, qtyMilli: qty, exact, unit } = parseScan(raw, items);
    const pick = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (pick && qty > 0) {
      // a box's barcode adds a box; the item's own barcode its base unit; a search match its sale unit
      add(pick, qty, exact ? unit : pick.saleUnit ?? null);
      setQ('');
    } else {
      setNoRate('');
      setNotFound(code);
    }
  };

  const setLine = (key: string, patch: Pick<CartLine, 'batchId'> | Pick<CartLine, 'rxSeen'>) => {
    setCart((c) => c.map((l) => (lineKey(l) === key ? { ...l, ...patch } : l)));
  };

  const setQty = (key: string, qtyMilli: number) => {
    setCart((c) => (qtyMilli <= 0 ? c.filter((l) => lineKey(l) !== key) : c.map((l) => (lineKey(l) === key ? { ...l, qtyMilli } : l))));
    setPaid(null);
  };

  /**
   * The unit chip: a tap takes the line to the item's next unit (base, then each of its units), re-priced; into the
   * line of that unit when the cart has one already.
   */
  const nextUnit = (key: string) => {
    setCart((c) => {
      const i = c.findIndex((l) => lineKey(l) === key);
      const l = c[i];
      if (!l) return c;
      const choices = unitChoices(l.item);
      const at = choices.findIndex((u) => u.unit === l.unit);
      const unit = choices[(at + 1) % choices.length]?.unit ?? null;
      return changeLineUnit(c, i, unit, unitPriceOf(l.item, unit));
    });
    setPaid(null);
  };

  const subtotal = cart.reduce((s, l) => s + lineTotal(l), 0);
  const total = Math.max(0, subtotal - (discount ?? 0));
  const change = cashChange(paid, total, parts);
  const split = parts.length > 0;
  const left = total - parts.reduce((s, p) => s + (p.amount ?? 0), 0);
  const splitOk = !split || (left === 0 && parts.every((p) => (p.amount ?? 0) > 0) && (!parts.some((p) => p.method === 'account') || !!partyId));
  const canPay = cart.length > 0 && !busy && (discount ?? 0) <= subtotal && (currency === 'IQD' || rateX100 > 0) && (change === null || change >= 0) && splitOk;
  /** A method button: the first one takes the whole total; later ones what is left. */
  const pickMethod = (method: PosMethod) => {
    setParts((ps) => (ps.length === 0
      ? (method === 'cash' ? [] : [{ method, amount: total }])
      : ps.length >= 4 || ps.some((p) => p.method === method) ? ps : [...ps, { method, amount: Math.max(0, left) }]));
  };

  const clear = () => {
    setCart([]);
    setDiscount(0);
    setPaid(null);
    setPartyId('');
    setParts([]);
    setError(null);
    setQ('');
    focusSearch();
  };

  const pay = async () => {
    if (!canPay) return;
    setBusy(true);
    setError(null);
    try {
      const sale = {
        currency, ...(currency === 'USD' ? { rateX100 } : {}), ...(partyId ? { partyId } : {}), discount: discount ?? 0,
        lines: cart.map(posSaleLine),
        ...(split ? { payments: parts.map((p) => ({ method: p.method, amount: p.amount ?? 0 })) } : {})
      };
      let res;
      try {
        res = await posApi.sell(shift.id, sale);
      } catch (e) {
        // stock past its expiry date: the company may allow it after the cashier confirms (written to the audit log)
        if (!(await expired.ask(e))) throw e;
        res = await posApi.sell(shift.id, { ...sale, allowExpired: true });
      }
      setShift(res.shift);
      setReceipt(res.invoice);
      clear();
      loadItems(); // stock changed
      toast(t('pos_saved', { n: res.invoice.number ?? '' }));
      // controlled medicines sold: the patient and the prescription, now or later from the pharmacy log
      controlled.check(res.invoice.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  // F-keys: F2 search, F4 clear the sale, F8 discount, F9 pay, F10 print the last receipt
  const payRef = useRef(pay);
  payRef.current = pay;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (closing) return;
      if (e.key === 'F2') { e.preventDefault(); search.current?.focus(); }
      else if (e.key === 'F4') { e.preventDefault(); clear(); }
      else if (e.key === 'F8') { e.preventDefault(); document.getElementById('pos-discount')?.querySelector('input')?.focus(); }
      else if (e.key === 'F9') { e.preventDefault(); void payRef.current(); }
      else if (e.key === 'F10' && receipt) { e.preventDefault(); void printReceipt(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const customerOptions: PickOption[] = useMemo(() => customers.map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone, hint: p.phone })), [customers]);

  return (
    <div className="pos">
      {expired.dialog}
      {controlled.dialog}
      <div className="pos-bar no-print">
        <div className="pos-shift-info">
          <strong>{shift.register}</strong>
          <span className="muted small">{shift.number} · {shift.openedBy}</span>
          <span className="chip info num">{t('pos_salesSoFar')}: {money2(i18n, shift.sales)} · {i18n.int(shift.count)}</span>
        </div>
        <div className="row">
          <a className="btn" href={href(`pos-shift/${shift.id}`)}><Icon name="doc" size={16} />{t('pos_xReport')}</a>
          <button type="button" className="btn" onClick={() => setClosing(true)}><Icon name="logout" size={16} />{t('pos_closeShift')}</button>
        </div>
      </div>

      <div className="pos-body">
        {/* items */}
        <section className="pos-items" aria-label={t('pos_items')}>
          <div className="pos-search">
            <Icon name="search" size={22} />
            <input
              ref={search}
              className="input pos-search-input"
              value={q}
              placeholder={t('pos_searchPlaceholder')}
              aria-label={t('pos_searchPlaceholder')}
              autoComplete="off"
              onChange={(e) => { setQ(e.target.value); setNotFound(''); setNoRate(''); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); onEnter(); }
                if (e.key === 'Escape') { setQ(''); setNotFound(''); setNoRate(''); }
              }}
            />
            <span className="kbd">F2</span>
          </div>
          {notFound && <div className="alert bad" role="alert">{t('pos_notFound', { n: notFound })}</div>}
          {noRate && <div className="alert bad" role="alert">{t('pos_noRate', { n: noRate })}</div>}
          <div className="pos-grid">
            {matches.map((it) => {
              const name = i18n.name(it.name);
              const out = it.trackStock && it.qtyMilli <= 0;
              // the price of what a tap adds: the item's sale unit
              const offer = tileOffer(it, currency, priceRate);
              return (
                <button key={it.id} type="button" className={'pos-tile' + (out ? ' out' : '')} onClick={() => { add(it); focusSearch(); }}>
                  <ItemPicture item={it} name={name} />
                  <span className="pos-tile-name">{name}</span>
                  {medicines.get(it.id)?.genericName && (
                    <span className="small muted">
                      {medicines.get(it.id)!.genericName}{medicines.get(it.id)!.shelf ? ` · ${medicines.get(it.id)!.shelf}` : ''}
                      {medicines.get(it.id)!.rxOnly ? ' · Rx' : ''}
                    </span>
                  )}
                  <span className="pos-tile-price num">{offer.price === null ? '—' : i18n.money(offer.price, currency)}{offer.unit && offer.price !== null ? ` / ${unitLabel(i18n, offer.unit)}` : ''}</span>
                  {it.trackStock && <span className={'pos-tile-stock small num' + (out ? ' bad' : '')}>{out ? t('pos_outOfStock') : `${t('pos_stock')}: ${inUnits(i18n, it, it.qtyMilli)}`}</span>}
                </button>
              );
            })}
            {matches.length === 0 && <p className="muted">{t('pos_noItems')}</p>}
          </div>
        </section>

        {/* the sale */}
        <section className="pos-cart card" aria-label={t('pos_cart')}>
          <div className="pos-cart-head">
            <h3 style={{ margin: 0 }}>{t('pos_cart')}</h3>
            <div className="tabs" role="group" aria-label={t('pos_currency')}>
              {(['IQD', 'USD'] as const).map((c) => (
                <button key={c} type="button" aria-pressed={currency === c} onClick={() => setCurrency(c)}>{c === 'IQD' ? t('pos_dinar') : t('pos_dollar')}</button>
              ))}
            </div>
          </div>
          {currency === 'USD' && (
            <label className="field pos-rate"><span>{t('pos_rate')}</span><input className="input num ltr" inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value)} /></label>
          )}

          <div className="pos-lines">
            {cart.length === 0 && <p className="muted pos-empty">{t('pos_emptyCart')}</p>}
            {cart.map((l) => (
              <div key={lineKey(l)} className="pos-line">
                <div className="pos-line-name">
                  <span>{i18n.name(l.item.name)}</span>
                  <span className="muted small num">{i18n.money(l.unitPrice, currency)}</span>
                  {l.item.units.length > 0 && (
                    <button type="button" className="chip" title={t('unit')} aria-label={`${t('unit')}: ${unitLabel(i18n, l.unit ?? l.item.unit)}`} onClick={() => nextUnit(lineKey(l))}>
                      {unitLabel(i18n, l.unit ?? l.item.unit)}
                    </button>
                  )}
                  <BatchPick item={l.item} warehouseId={shift.warehouseId} value={l.batchId ?? ''} onChange={(batchId) => setLine(lineKey(l), { batchId })} />
                  {rxItems.has(l.item.id) && <RxTick seen={!!l.rxSeen} onChange={(rxSeen) => setLine(lineKey(l), { rxSeen })} />}
                </div>
                <div className="pos-qty">
                  <button type="button" className="btn pos-qty-btn" aria-label={t('pos_less')} onClick={() => setQty(lineKey(l), l.qtyMilli - 1000)}>−</button>
                  <span className="num pos-qty-n">{i18n.qty(l.qtyMilli)}</span>
                  <button type="button" className="btn pos-qty-btn" aria-label={t('pos_more')} onClick={() => setQty(lineKey(l), l.qtyMilli + 1000)}>+</button>
                </div>
                <span className="num pos-line-total">{i18n.money(lineTotal(l), currency)}</span>
                <button type="button" className="btn pos-remove" aria-label={t('pos_remove')} onClick={() => setQty(lineKey(l), 0)}><Icon name="x" size={16} /></button>
              </div>
            ))}
          </div>

          <div className="pos-pay stack">
            <div className="field"><span>{t('pos_customer')}</span>
              <SearchCombo value={partyId} options={customerOptions} onChange={setPartyId} placeholder={t('pos_walkIn')} emptyLabel={t('pos_walkIn')} />
            </div>
            <div className="grid-2">
              <label className="field" id="pos-discount"><span>{t('pos_discount')} <span className="kbd">F8</span></span><AmountInput value={discount} currency={currency} onChange={setDiscount} ariaLabel={t('pos_discount')} /></label>
              <label className="field"><span>{t('pos_paid')}</span><AmountInput value={paid} currency={currency} onChange={setPaid} ariaLabel={t('pos_paid')} /></label>
            </div>
            <div className="pos-total">
              <span>{t('pos_total')}</span>
              <strong className="num">{i18n.money(total, currency)}</strong>
            </div>
            {methods.length > 1 && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="track" role="group" aria-label={t('paymentMode')} style={{ flexWrap: 'wrap' }}>
                  {methods.map((m) => (
                    <button key={m} type="button" aria-pressed={split ? parts.some((p) => p.method === m) : m === 'cash'} onClick={() => pickMethod(m)}>{t(`pay_${m}` as Key)}</button>
                  ))}
                </div>
                {parts.map((p, i) => (
                  <div key={p.method} className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                    <span style={{ minWidth: 90 }}>{t(`pay_${p.method}` as Key)}</span>
                    <AmountInput value={p.amount} currency={currency} onChange={(v) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, amount: v } : x)))} ariaLabel={t(`pay_${p.method}` as Key)} />
                    <button type="button" className="btn icon ghost" aria-label={t('pos_remove')} onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
                  </div>
                ))}
                {split && left !== 0 && <div className="small" style={{ color: 'var(--bad)' }}>{t('pos_left')}: <span className="num">{i18n.money(left, currency)}</span></div>}
                {parts.some((p) => p.method === 'account') && !partyId && <div className="small" style={{ color: 'var(--bad)' }}>{t('err_party_required')}</div>}
              </div>
            )}
            {change !== null && (
              <div className={'pos-change' + (change < 0 ? ' bad' : '')}>
                <span>{change < 0 ? t('pos_short') : t('pos_change')}</span>
                <strong className="num">{i18n.money(Math.abs(change), currency)}</strong>
              </div>
            )}
            <ErrorBox error={error} />
            <div className="pos-actions">
              <button type="button" className="btn pos-touch" onClick={clear} disabled={busy}><Icon name="x" size={18} />{t('pos_clear')} <span className="kbd">F4</span></button>
              <button type="button" className="btn primary pos-touch pos-pay-btn" onClick={() => void pay()} disabled={!canPay}>
                <Icon name="check" size={20} />{t('pos_pay')} <span className="kbd">F9</span>
              </button>
            </div>
            {receipt && (
              <button type="button" className="link-btn small" onClick={() => void printReceipt()}>
                <Icon name="printer" size={14} /> {t('pos_printLast', { n: receipt.number ?? '' })} <span className="kbd">F10</span>
              </button>
            )}
          </div>
        </section>
      </div>

      {receipt && <Receipt invoice={receipt} shift={shift} />}
      {closing && <CloseShift shift={shift} onCancel={() => { setClosing(false); focusSearch(); }} onClosed={onClosed} />}
    </div>
  );
}

/* ---------- the receipt (80 mm) ---------- */

/** The receipt alone, on the printer chosen for receipts (Settings → Printers) or through the print window. */
function printReceipt() {
  return printAlone('receipt', 'pos-printing');
}

function Receipt({ invoice, shift }: { invoice: InvoiceView; shift: ShiftView }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings, plan } = useData();
  const setup = usePrintSetup();
  const company = settings ? i18n.name(settings.companyName) : '';
  // a receipt design of the company's own (Settings → Print design) replaces the standard receipt
  if (setup.designs.pos) {
    return createPortal(
      <div className="pos-receipt-host" dir={i18n.dir} lang={i18n.lang === 'ku' ? 'ckb' : i18n.lang}>
        <PrintDocument
          model={invoiceModel(invoice, { pos: true })} design={setup.designs.pos} profile={setup.profile}
          company={settings?.companyName ?? { ar: '', en: '', ku: '' }} branding={!plan?.features.includes('noBranding')}
          defaultRateX100={settings?.defaultRateX100}
        />
      </div>,
      document.body
    );
  }
  return createPortal(
    <div className="pos-receipt-host" dir={i18n.dir} lang={i18n.lang === 'ku' ? 'ckb' : i18n.lang}>
      <div className="pos-receipt">
        <div className="pos-r-center"><strong className="pos-r-company">{company}</strong></div>
        <div className="pos-r-center small">{t('pos_receipt')}</div>
        <div className="pos-r-row small"><span>{t('pos_no')}</span><span className="num ltr">{invoice.number}</span></div>
        <div className="pos-r-row small"><span>{t('pos_dateTime')}</span><span className="num">{i18n.date(invoice.date)} {i18n.digitsOf(new Date(invoice.postedAt ?? invoice.createdAt).toTimeString().slice(0, 5))}</span></div>
        <div className="pos-r-row small"><span>{t('pos_cashier')}</span><span>{shift.openedBy === invoice.createdBy ? shift.openedBy : invoice.createdBy}</span></div>
        {invoice.partyName && <div className="pos-r-row small"><span>{t('pos_customer')}</span><span>{invoice.partyName}</span></div>}
        <div className="pos-r-sep" />
        {invoice.lines.map((l) => (
          <div key={l.lineNo} className="pos-r-line">
            <div>{i18n.name(l.itemName)}</div>
            <div className="pos-r-row small">
              <span className="num">{i18n.qty(l.lineUnit && l.unitQtyMilli !== null ? l.unitQtyMilli : l.qtyMilli)}{l.lineUnit ? ` ${unitLabel(i18n, l.lineUnit)}` : ''} × {i18n.money(l.unitPrice, invoice.currency)}</span>
              <span className="num">{i18n.money(l.amount, invoice.currency)}</span>
            </div>
          </div>
        ))}
        <div className="pos-r-sep" />
        {invoice.discount > 0 && <div className="pos-r-row"><span>{t('pos_discount')}</span><span className="num">−{i18n.money(invoice.discount, invoice.currency)}</span></div>}
        <div className="pos-r-row pos-r-total"><span>{t('pos_total')}</span><span className="num">{i18n.money(invoice.total, invoice.currency)}</span></div>
        {(invoice.payments ?? []).filter((p) => p.kind === 'pos').map((p) => (
          <div key={p.id} className="pos-r-row small"><span>{t(`pay_${p.method}` as Key)}</span><span className="num">{i18n.money(p.amount, p.currency)}</span></div>
        ))}
        <div className="pos-r-sep" />
        <div className="pos-r-center small">{t('pos_thanks')}</div>
        {!plan?.features.includes('noBranding') && <div className="pos-r-center small">{t('madeWith')} · <span className="ltr">qasaerp.com</span></div>}
      </div>
    </div>,
    document.body
  );
}

/* ---------- closing ---------- */

function CloseShift({ shift, onCancel, onClosed }: { shift: ShiftView; onCancel(): void; onClosed(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [iqd, setIqd] = useState<number | null>(null);
  const [usd, setUsd] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [closed, setClosed] = useState<ShiftView | null>(null);
  const diff = { IQD: (iqd ?? 0) - shift.expected.IQD, USD: (usd ?? 0) - shift.expected.USD };

  const close = async () => {
    setBusy(true);
    setError(null);
    try {
      setClosed(await posApi.close(shift.id, { countedCash: iqd ?? 0, ...(usd !== null ? { countedUsd: usd } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (closed) {
    return (
      <Modal title={t('pos_closedTitle')} onClose={onClosed}>
        <div className="stack">
          <p style={{ margin: 0 }}>{t('pos_closedText', { n: closed.number })}</p>
          <div className="pos-r-row"><span>{t('pos_expected')}</span><strong className="num">{money2(i18n, closed.expected)}</strong></div>
          <div className="pos-r-row"><span>{t('pos_counted')}</span><strong className="num">{closed.counted ? money2(i18n, closed.counted) : '—'}</strong></div>
          <div className="pos-r-row"><span>{t('pos_difference')}</span><strong className="num">{closed.difference ? <DiffText d={closed.difference} /> : '—'}</strong></div>
          <div className="row">
            <a className="btn primary" href={href(`pos-shift/${closed.id}`)}><Icon name="printer" size={16} />{t('pos_zReport')}</a>
            <button type="button" className="btn" onClick={onClosed}>{t('pos_done')}</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t('pos_closeShift')} onClose={onCancel}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{t('pos_closeHelp')}</p>
        <div className="pos-r-row"><span>{t('pos_openingCash')}</span><span className="num">{i18n.money(shift.openingCash, 'IQD')}</span></div>
        <div className="pos-r-row"><span>{t('pos_sales')}</span><span className="num">{money2(i18n, shift.sales)}</span></div>
        {(shift.refunds.IQD > 0 || shift.refunds.USD > 0) && <div className="pos-r-row"><span>{t('pos_refunds')}</span><span className="num">−{money2(i18n, shift.refunds)}</span></div>}
        <div className="pos-r-row"><span>{t('pos_expected')}</span><strong className="num">{money2(i18n, shift.expected)}</strong></div>
        <div className="grid-2">
          <label className="field"><span>{t('pos_countedIqd')}</span><AmountInput value={iqd} currency="IQD" onChange={setIqd} ariaLabel={t('pos_countedIqd')} /></label>
          <label className="field"><span>{t('pos_countedUsd')}</span><AmountInput value={usd} currency="USD" onChange={setUsd} ariaLabel={t('pos_countedUsd')} /></label>
        </div>
        {iqd !== null && <div className="pos-r-row"><span>{t('pos_difference')}</span><strong className="num"><DiffText d={diff} /></strong></div>}
        <label className="field"><span>{t('pos_notes')}</span><textarea className="input" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || iqd === null} onClick={() => void close()}>{t('pos_closeConfirm')}</button>
          <button type="button" className="btn" onClick={onCancel}>{t('pos_cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- the shift report (X while open, Z once closed) ---------- */

export function PosShiftReport({ id }: { id: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { settings } = useData();
  usePageNav({ key: 'pos_title', group: 'gSales', title: 'pos_shiftReport' });
  const { data: r, error } = useLoad<ShiftReport>(() => posApi.shift(id), [id]);
  if (error) return <ErrorBox error={error} />;
  if (!r) return null;
  const time = (iso: string | null) => (iso ? `${i18n.date(iso.slice(0, 10))} ${i18n.digitsOf(new Date(iso).toTimeString().slice(0, 5))}` : '—');
  return (
    <div className="stack">
      <div className="row no-print">
        <a className="btn" href={href('pos')}>{t('pos_backToRegister')}</a>
        <button type="button" className="btn primary" onClick={() => void printDocument('report')}><Icon name="printer" size={16} />{t('pos_print')}</button>
      </div>
      <div className="card pad stack paper">
        <div className="paper-head">
          <div>
            <div className="small muted">{settings ? i18n.name(settings.companyName) : ''}</div>
            <h2 style={{ margin: 0 }}>{r.status === 'open' ? t('pos_xReport') : t('pos_zReport')} — {r.number}</h2>
          </div>
          <span className={'chip ' + (r.status === 'open' ? 'info' : '')}>{r.status === 'open' ? t('pos_statusOpen') : t('pos_statusClosed')}</span>
        </div>
        <div className="grid-3">
          <div><div className="small muted">{t('pos_register')}</div><div>{r.register}</div></div>
          <div><div className="small muted">{t('pos_cashier')}</div><div>{r.openedBy}{r.closedBy && r.closedBy !== r.openedBy ? ` / ${r.closedBy}` : ''}</div></div>
          <div><div className="small muted">{t('pos_cashAccount')}</div><div className="num">{r.cashAccountCode}</div></div>
          <div><div className="small muted">{t('pos_opened')}</div><div className="num">{time(r.openedAt)}</div></div>
          <div><div className="small muted">{t('pos_closed')}</div><div className="num">{time(r.closedAt)}</div></div>
          <div><div className="small muted">{t('pos_salesCount')}</div><div className="num">{i18n.int(r.count)}</div></div>
        </div>
        <table className="table">
          <tbody>
            <tr><td>{t('pos_openingCash')}</td><td className="num">{i18n.money(r.openingCash, 'IQD')}</td></tr>
            <tr><td>{t('pos_sales')}</td><td className="num">{money2(i18n, r.sales)}</td></tr>
            {(r.refunds.IQD > 0 || r.refunds.USD > 0) && <tr><td>{t('pos_refunds')}</td><td className="num">−{money2(i18n, r.refunds)}</td></tr>}
            {Object.entries(r.methods ?? {}).filter(([m]) => m !== 'cash' || Object.keys(r.methods ?? {}).length > 1).map(([m, v]) => <tr key={m}><td>{t(`pay_${m}` as Key)}</td><td className="num">{money2(i18n, v as Money2)}</td></tr>)}
            <tr><td><strong>{t('pos_expected')}</strong></td><td className="num"><strong>{money2(i18n, r.expected)}</strong></td></tr>
            {r.counted && <tr><td>{t('pos_counted')}</td><td className="num">{money2(i18n, r.counted)}</td></tr>}
            {r.difference && <tr><td>{t('pos_difference')}</td><td className="num"><DiffText d={r.difference} /></td></tr>}
          </tbody>
        </table>
        {r.notes && <p className="small" style={{ whiteSpace: 'pre-line' }}>{t('pos_notes')}: {r.notes}</p>}

        <h3 style={{ marginBlockEnd: 0 }}>{t('pos_itemsSold')}</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('pos_item')}</th><th className="num">{t('pos_qty')}</th><th className="num">{t('pos_amount')}</th></tr></thead>
            <tbody>
              {r.items.map((it) => (
                <tr key={it.itemId}><td>{it.code} — {i18n.name(it.name)}</td><td className="num">{i18n.qty(it.qtyMilli)}</td><td className="num">{money2(i18n, it.amount)}</td></tr>
              ))}
              {r.items.length === 0 && <tr><td colSpan={3} className="muted">{t('pos_noSales')}</td></tr>}
            </tbody>
          </table>
        </div>

        <h3 style={{ marginBlockEnd: 0 }}>{t('pos_invoices')}</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('pos_no')}</th><th>{t('pos_time')}</th><th>{t('pos_customer')}</th><th className="num">{t('pos_amount')}</th><th /></tr></thead>
            <tbody>
              {r.invoices.map((inv) => (
                <tr key={inv.invoiceId}>
                  <td><a href={href(`invoice/${inv.invoiceId}`)} className="ltr">{inv.number ?? '—'}</a></td>
                  <td className="num">{i18n.digitsOf(new Date(inv.createdAt).toTimeString().slice(0, 5))}</td>
                  <td>{inv.partyName ?? t('pos_walkIn')}</td>
                  <td className="num">{i18n.money(inv.total, inv.currency)}</td>
                  <td>{inv.status !== 'posted' && <span className="chip bad">{t('pos_cancelled')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">{t('pos_returnsNote')}</p>
      </div>
    </div>
  );
}
