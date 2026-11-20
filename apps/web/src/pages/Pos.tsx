import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { categoriesApi, inCategory, type CategoryView } from '../industry/categories-api.ts';
import { createPortal } from 'react-dom';
import { fromBase, normalizeForSearch, POS_QUICK_MAX, posBigTiles, rateFromX100, rateToX100, toBase, todayIso, toWesternDigits, usableRate, type CurrencyCode } from '@qasa/core';
import { api, ApiError, isNetworkError, serverReachable, type InvoiceView, type ItemView, type PartyView, type WarehouseView } from '../api.ts';
import { AccountCombo, AmountInput, ErrorBox, Icon, Modal, SearchCombo, useData, useLoad, usePageNav, useToast, type PickOption } from '../components.tsx';
import { useI18n, type I18n, type Key } from '../i18n.ts';
import { href } from '../router.ts';
import { PartyPicker } from '../industry/PartyPicker.tsx';
import { posApi, tillsApi, type Money2, type PosMethod, type SaleInput, type ShiftReport, type ShiftView, type TillView } from '../industry/pos-api.ts';
import { clearHeld, heldOn, HELD_MAX, holdBasket, inWindowsTill, keepScalePrefixes, kickDrawer, openCustomerScreen, scalePrefixesKept, setThisTill, showOnCustomerScreen, takeHeld, thisTill, type HeldBasket } from '../industry/till.ts';
import { outboxClient, outboxWho, whoKey, type HeldKey } from '../industry/outbox.ts';
import { useOutbox } from '../industry/OutboxBanner.tsx';
import { offlineReceipt, offlineRefusal, payTillSale, rememberTill, shortStock, takeFromStock, tillCache } from '../industry/offline-till.ts';
import '../pos.css';
import { useItemPicture } from '../industry/ItemImage.tsx';
import { PrintDocument } from '../industry/PrintDocument.tsx';
import { invoiceModel } from '../industry/print-model.ts';
import { usePrintSetup } from '../industry/print-api.ts';
import { addRefusal, cartShortNote, changeLineUnit, chosenMethod, creditNeedsCustomer, moveQuick, parseScan, pickAfterLink, posSaleLine, priceIn, priceRateFor, quickIdsFor, quickRowItems, salePayments, tileOffer, tillMethods, toggleQuick, type TillMethod, cashPartOf, changeInDinars, splitPayments, type SplitMethod } from './pos-logic.ts';
import { inUnits, salePriceFor, unitChoices, unitLabel, type LineUnit } from '../industry/units.ts';
import { BatchPick, useExpiredConfirm } from '../industry/BatchFields.tsx';
import { pharmacyApi, type MedicineView } from '../industry/pharmacy-api.ts';
import { RxTick, useControlledPrompt, usePharmacyOn, useRxItems } from '../industry/PharmacyPrompts.tsx';
import { printAlone, printDocument } from '../industry/printing.ts';
import { receiptMessage, withAttachment } from '../industry/WhatsAppShare.tsx';
import { WhatsAppSendButton } from '../industry/WhatsAppSend.tsx';
import { LoyaltyUse, loyaltyLines } from '../industry/Loyalty.tsx';
import { dualLineText, dualRateTitle, useDual } from '../Amount.tsx';
import { perDollar } from '../industry/HeaderRate.tsx';
import { QuickItemForm } from '../industry/QuickItemForm.tsx';
import { addRowKind, anyItemMatches, mayAddItem, typedForForm, western } from '../industry/item-quick-add.ts';
import { findByScaleBarcode } from '../industry/scale-barcode.ts';
import { may } from '../may.ts';

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

/**
 * When a shift opened or closed, as this PC's clock reads it: the date and the time both local (1.4.1; the date was
 * the UTC one, a day behind for a shift opened between midnight and 3 am in Iraq).
 */
export function shiftTime(i18n: Pick<I18n, 'date' | 'digitsOf'>, iso: string | null): string {
  if (!iso) return '—';
  const at = new Date(iso);
  return `${i18n.date(todayIso(at))} ${i18n.digitsOf(at.toTimeString().slice(0, 5))}`;
}

/** Two letters for an item without a picture. */
const initials = (s: string) => s.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase();

/**
 * The picture on a tile, as the Items screen shows it: one request says which items have a picture, a picture is
 * asked for only when its tile comes into view, and it is kept for the visit. No picture: the item's initials.
 */
function ItemPicture({ item, name }: { item: ItemView; name: string }) {
  const { box, url } = useItemPicture(item.id);
  return (
    <span ref={box} className="pos-picture" aria-hidden="true">
      {url ? <img className="pos-img" src={url} alt="" /> : <span className="pos-initials">{initials(name) || '•'}</span>}
    </span>
  );
}

/**
 * The quick buttons: a row above the categories with what the company sells all day (a charger, a bag, a loaf of
 * bread), each a small picture with its name and price; one tap adds one. The list is the company's (Settings key
 * pos_quick_items, the same on every PC). An admin edits it here: "Edit buttons", then a tap on a tile below puts it
 * on the row or takes it off (a star on those on it), the arrows move a button, and Done. While the server can't be
 * reached the row shows the list last known and can't be edited.
 */
export function QuickRow({ items, currency, priceRate, editing, mayEdit, canEdit, error, onPick, onEdit, onMove }: {
  items: readonly ItemView[]; currency: CurrencyCode; priceRate: number;
  /** the admin is choosing the buttons (the row sells nothing meanwhile) */
  editing: boolean;
  /** an admin (the server takes the list from an admin only) */
  mayEdit: boolean;
  /** the server can be reached (offline the list is not changed) */
  canEdit: boolean;
  error?: unknown;
  onPick(item: ItemView): void; onEdit(): void; onMove(id: string, step: -1 | 1): void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!items.length && !mayEdit) return null;
  return (
    <div className={'pos-quick' + (editing ? ' editing' : '')} role="group" aria-label={t('tq_quick')} data-quick={items.length}>
      {items.map((it, i) => {
        const name = i18n.name(it.name);
        const offer = tileOffer(it, currency, priceRate);
        const face = (
          <>
            <QuickPicture item={it} name={name} />
            <span className="pos-quick-text">
              <span className="pos-quick-name">{name}</span>
              <span className="pos-quick-price num">{offer.price === null ? '—' : i18n.money(offer.price, currency)}</span>
            </span>
          </>
        );
        if (!editing) return <button key={it.id} type="button" className="pos-quick-btn" title={name} onClick={() => onPick(it)}>{face}</button>;
        return (
          <span key={it.id} className="pos-quick-btn pos-quick-chosen">
            <button type="button" className="pos-quick-move pos-quick-move-back" aria-label={`${t('tq_moveBack')}: ${name}`} disabled={i === 0} onClick={() => onMove(it.id, -1)}><Icon name="chevron" size={16} /></button>
            {face}
            <button type="button" className="pos-quick-move" aria-label={`${t('tq_moveForward')}: ${name}`} disabled={i === items.length - 1} onClick={() => onMove(it.id, 1)}><Icon name="chevron" size={16} className="flip" /></button>
          </span>
        );
      })}
      {!items.length && <span className="small muted pos-quick-empty">{t('tq_empty')}</span>}
      {mayEdit && (
        <button type="button" className={'btn small pos-quick-edit' + (editing ? ' primary' : '')} disabled={!editing && !canEdit} title={!canEdit ? t('tq_offlineEdit') : undefined} onClick={onEdit}>
          <Icon name={editing ? 'check' : 'edit'} size={15} />{editing ? t('tq_done') : t('tq_edit')}
        </button>
      )}
      {editing && <div className="small muted pos-quick-hint">{t('tq_editHint', { n: i18n.int(POS_QUICK_MAX) })}</div>}
      {error ? <div className="pos-quick-hint"><ErrorBox error={error} /></div> : null}
    </div>
  );
}

/** A quick button's small picture, or the item's initials. */
function QuickPicture({ item, name }: { item: ItemView; name: string }) {
  const { box, url } = useItemPicture(item.id);
  return (
    <span ref={box} className="pos-quick-pic" aria-hidden="true">
      {url ? <img src={url} alt="" /> : <span className="pos-initials">{initials(name) || '•'}</span>}
    </span>
  );
}

/* ---------- the page ---------- */

/** Whose the till's memory is: the person signed in now. */
const tillWho = () => whoKey(outboxWho());

/**
 * What the till had from the server, or (on a PC with an outbox, while the server can't be reached) what it last had:
 * the offline till (industry/offline-till.ts). Anything else fails as before.
 */
async function fromServerOrTill<T>(load: () => Promise<T>, remember: (v: T) => void, cached: () => T | null | undefined): Promise<T> {
  try {
    const value = await load();
    remember(value);
    return value;
  } catch (e) {
    const kept = outboxClient() && isNetworkError(e) ? cached() : null;
    if (kept) return kept;
    throw e;
  }
}

const currentShift = () => fromServerOrTill(() => posApi.current(thisTill()), (r) => rememberTill(tillWho(), { shift: r.shift }),
  () => { const shift = tillCache(tillWho())?.shift; return shift ? { shift } : null; });

export function Pos() {
  const { data, error, reload } = useLoad(() => currentShift(), []);
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
  // 2.0: the shop's named tills; this PC remembers which one it is
  const { data: tillList } = useLoad(() => tillsApi.list().catch(() => ({ tills: [] as TillView[], multiTill: false })), []);
  const tills = (tillList?.tills ?? []).filter((x) => x.active);
  const [tillId, setTillId] = useState(thisTill());
  const till = tills.find((x) => x.id === tillId) ?? null;
  useEffect(() => {
    if (!warehouseId && warehouses?.length) setWarehouseId((warehouses.find((w: WarehouseView) => w.active) ?? warehouses[0]!).id);
  }, [warehouses, warehouseId]);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      if (till) {
        await posApi.open({ tillId: till.id, register: till.name, cashAccountCode: till.cashAccountCode, warehouseId: till.warehouseId, openingCash: opening ?? 0 });
        setThisTill(till.id);
      } else {
        await posApi.open({ register: register.trim(), cashAccountCode: cashAccount, warehouseId, openingCash: opening ?? 0 });
        remember(register.trim());
        setThisTill('');
      }
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
        {tills.length > 0 && (
          <label className="field"><span>{t('tl_pickTill')}</span>
            <select className="input pos-big-input" value={till ? till.id : ''} onChange={(e) => setTillId(e.target.value)}>
              {tills.map((x) => <option key={x.id} value={x.id} disabled={!!x.openShiftId}>{x.name}{x.openShiftId ? ` (${t('pos_statusOpen')})` : ''}</option>)}
              <option value="">{t('tl_byName')}</option>
            </select>
          </label>
        )}
        <div className="grid-2">
          {!till && <label className="field"><span>{t('pos_register')}</span><input className="input pos-big-input" maxLength={60} value={register} onChange={(e) => setRegister(e.target.value)} /></label>}
          <label className="field"><span>{t('pos_openingCash')}</span><AmountInput value={opening} currency="IQD" onChange={setOpening} ariaLabel={t('pos_openingCash')} /></label>
          {!till && <div className="field"><span>{t('pos_cashAccount')}</span><AccountCombo value={cashAccount} onChange={setCashAccount} filter={(a) => a.code.startsWith('18')} ariaLabel={t('pos_cashAccount')} /></div>}
          {!till && (
            <label className="field"><span>{t('pos_warehouse')}</span>
              <select className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                {(warehouses ?? []).filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.code} — {i18n.name(w.name)}</option>)}
              </select>
            </label>
          )}
        </div>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary pos-touch" disabled={busy || (!till && !warehouseId) || !!till?.openShiftId} onClick={() => void open()}>
            <Icon name="wallet" size={18} />{t('pos_openButton')}
          </button>
        </div>
      </div>
      <TillsToday />
      {recent && recent.length > 0 && <ShiftList shifts={recent} />}
    </div>
  );
}

/** 2.0: today's shifts till by till (whoever keeps the books: every till; a cashier: their own shifts). */
function TillsToday() {
  const i18n = useI18n();
  const { t } = i18n;
  const { data } = useLoad(() => tillsApi.summary().catch(() => null), []);
  if (!data || data.rows.length < 2) return null;
  return (
    <div className="card pad stack">
      <h3 style={{ margin: 0 }}>{t('tl_today')}</h3>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('tl_till')}</th><th className="num">{t('tl_shifts')}</th><th className="num">{t('pos_salesCount')}</th><th className="num">{t('pos_sales')}</th><th className="num">{t('tl_noSaleCol')}</th><th className="num">{t('tl_diff')}</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.tillId ?? r.register}>
                <td>{r.register}</td><td className="num">{i18n.int(r.shifts)}</td><td className="num">{i18n.int(r.count)}</td>
                <td className="num">{money2(i18n, r.sales)}</td><td className="num">{i18n.int(r.noSale)}</td><td className="num"><DiffText d={r.difference} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
                <td className="num">{shiftTime(i18n, s.openedAt)}</td>
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
  const { settings, permissions, reloadSettings } = useData();
  const market = !!settings?.businessTypes?.includes('market');
  // big picture tiles: off for every company until an admin turns them on (Settings → Sales and point of sale)
  const bigTiles = posBigTiles(settings ?? {});
  // the quick buttons are the company's; an admin changes them (the server takes them from an admin only)
  const mayEditQuick = may(permissions, 'companyDetails');
  usePageNav({ key: 'pos_title', group: 'gSales' });
  // 1.4.2: a search or a scan that finds nothing offers to add the item, to someone who keeps the stock
  const mayAdd = mayAddItem(permissions);
  const [addingItem, setAddingItem] = useState<string | null>(null);

  const [shift, setShift] = useState(initial);
  const [items, setItems] = useState<ItemView[]>([]);
  const [customers, setCustomers] = useState<PartyView[]>([]);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  const [rateText, setRateText] = useState(() => String(rateFromX100(settings?.defaultRateX100 ?? 142000)));
  const [discount, setDiscount] = useState<number | null>(0);
  const [partyId, setPartyId] = useState('');
  // how it is paid (1.4): one way for the whole sale, cash or credit, in every company
  const [picked, setPicked] = useState<TillMethod>('cash');
  // 2.0: the till this shift is on (its drawer), the card and wallets an admin gave accounts, what the customer handed
  // over (dinars and dollar notes), scale labels that carry a price, and the baskets held on this shift
  const [till, setTill] = useState<TillView | null>(null);
  const [cardMethods, setCardMethods] = useState<Exclude<SplitMethod, 'cash'>[]>([]);
  const [split, setSplit] = useState<Partial<Record<Exclude<SplitMethod, 'cash'>, number | null>>>({});
  const [handed, setHanded] = useState<number | null>(null);
  const [handedUsd, setHandedUsd] = useState<number | null>(null);
  const [usdRateText, setUsdRateText] = useState(() => String(rateFromX100(settings?.defaultRateX100 ?? 142000)));
  const [scalePrefixes, setScalePrefixes] = useState<string[]>(scalePrefixesKept);
  const [held, setHeld] = useState<HeldBasket[]>(() => heldOn(initial.id));
  const [showHeld, setShowHeld] = useState(false);
  const [lastDone, setLastDone] = useState<{ total: string; change: string | null } | null>(null);
  // a basket resumed in another currency: its discount comes back once the cart is re-priced
  const resumedDiscount = useRef<number | null>(null);
  useEffect(() => {
    if (initial.tillId) tillsApi.list().then((r) => setTill(r.tills.find((x) => x.id === initial.tillId) ?? null), () => {});
    tillsApi.paymentAccounts().then((r) => setCardMethods(r.methods.filter((m: PosMethod): m is Exclude<SplitMethod, 'cash'> => m !== 'cash' && m !== 'account')), () => {});
    tillsApi.scale().then((r) => { setScalePrefixes(r.pricePrefixes); keepScalePrefixes(r.pricePrefixes); }, () => {});
  }, [initial.id, initial.tillId]);
  // 1.2: on a PC connected to an office server, a sale the server can't take now is kept here and sent later
  const outbox = useOutbox();
  const offline = !!outbox && !outbox.online;
  const shiftPath = `/api/pos/shifts/${shift.id}/sales`;
  const who = outboxWho();
  const keptHere = outbox ? outbox.entries.filter((e) => e.path === shiftPath) : [];
  const waitingMine = outbox ? outboxClient()?.mineWaiting(who).length ?? 0 : 0;
  const [shortNote, setShortNote] = useState('');
  // the key of the sale being paid, the same on every Pay until it is booked or kept, and whether a try of it got no
  // answer (it may be booked already)
  const saleKey = useRef<HeldKey | null>(null);
  const [unsure, setUnsure] = useState(false);
  // sales kept here reached the books: the shift's totals and the stock follow
  const keptCount = keptHere.length;
  const keptBefore = useRef(keptCount);
  useEffect(() => {
    const fewer = keptCount < keptBefore.current;
    keptBefore.current = keptCount;
    if (!fewer || !outbox?.online) return;
    posApi.current().then((r) => { if (r.shift?.id === shift.id) { setShift(r.shift); rememberTill(tillWho(), { shift: r.shift }); } }, () => {});
    loadItems();
  }, [keptCount, outbox?.online]); // eslint-disable-line react-hooks/exhaustive-deps
  // loyalty points used on this sale (Pro), and what they pay
  const [points, setPoints] = useState({ points: 0, value: 0 });
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

  const loadItems = useCallback(() => {
    void fromServerOrTill(() => api.items({ active: 'true' }), (list) => rememberTill(tillWho(), { items: list }), () => tillCache(tillWho())?.items).then(setItems, setError);
  }, []);
  useEffect(() => {
    loadItems();
    void fromServerOrTill(() => api.parties({ type: 'customer', active: 'true' }), (list) => rememberTill(tillWho(), { customers: list }), () => tillCache(tillWho())?.customers)
      .then(setCustomers, () => {});
  }, [loadItems]);

  // the search box keeps the focus (a scanner types into it), unless a dialog or another field is being used
  const focusSearch = useCallback(() => { window.setTimeout(() => search.current?.focus(), 0); }, []);
  useEffect(() => { focusSearch(); }, [focusSearch]);

  const searchable = useMemo(() => items.map((it) => ({
    item: it,
    key: normalizeForSearch([it.code, it.barcode, it.name.ar, it.name.en, it.name.ku].join(' '))
  })), [items]);

  // a pharmacy (Pro): the search also finds medicines by their generic name, and a tile shows it with the shelf
  const pharmacy = usePharmacyOn();
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

  // the category buttons: a category (its subcategories' items with it) or a subcategory; '' = every item
  const categories = useLoad(() => fromServerOrTill(() => categoriesApi.list({ active: 'true' }), (list) => rememberTill(tillWho(), { categories: list }), () => tillCache(tillWho())?.categories), []);
  const [cat, setCat] = useState('');
  const catList = categories.data ?? [];
  const shown = useMemo(() => (cat ? items.filter((it) => inCategory(catList, it.categoryId, cat)) : items), [items, cat, catList]);
  const matches = useMemo(() => {
    const n = normalizeForSearch(q);
    if (!n) return shown.slice(0, cat ? 120 : 40);
    const words = n.split(/\s+/).filter(Boolean);
    const direct = searchable.filter((s) => words.every((w) => s.key.includes(w))).map((s) => s.item).filter((it) => !cat || inCategory(catList, it.categoryId, cat));
    // medicines whose generic name matched
    const generic = pharmacy ? shown.filter((it) => !direct.includes(it) && normalizeForSearch(medicines.get(it.id)?.genericName ?? '').includes(n)) : [];
    return [...direct, ...generic].slice(0, 40);
  }, [q, shown, cat, catList, searchable, pharmacy, medicines]);
  // whether anything in the whole list matches the text, whatever category is chosen: only then is nothing "missing"
  const anyMatch = useMemo(() => anyItemMatches(q, searchable.map((s) => s.key)), [q, searchable]);

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
  }, [currency, priceRate, unitPriceOf]);

  // a different currency or rate re-prices the cart
  useEffect(() => {
    setCart((c) => c.map((l) => ({ ...l, unitPrice: unitPriceOf(l.item, l.unit) })));
    setDiscount(resumedDiscount.current ?? 0);
    resumedDiscount.current = null;
  }, [currency, priceRate]);

  /** Enter in the search box: an exact barcode or code wins (a scanner), else the only match. "3*code" sells three. */
  const onEnter = () => {
    const raw = toWesternDigits(q).trim();
    if (!raw) return;
    const { code, qtyMilli: qty, exact, unit } = parseScan(raw, items, scalePrefixes);
    const pick = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (pick && qty > 0) {
      // a box's barcode adds a box; the item's own barcode its base unit; a search match its sale unit
      add(pick, qty, exact ? unit : pick.saleUnit ?? null);
      setQ('');
    } else if (!exact && (matches.length > 1 || anyMatch)) {
      // several items match (the grid shows them), or the chosen category hides those that do: nothing is missing
      setNoRate('');
      if (matches.length === 0) setCat('');
    } else {
      setNoRate('');
      // a name is kept as it was typed (its own digits); a scan in western digits
      setNotFound(addRowKind(code) === 'name' ? q.trim() : code);
    }
  };

  const setLine = (key: string, patch: Pick<CartLine, 'batchId'> | Pick<CartLine, 'rxSeen'>) => {
    setCart((c) => c.map((l) => (lineKey(l) === key ? { ...l, ...patch } : l)));
  };

  const setQty = (key: string, qtyMilli: number) => {
    setCart((c) => (qtyMilli <= 0 ? c.filter((l) => lineKey(l) !== key) : c.map((l) => (lineKey(l) === key ? { ...l, qtyMilli } : l))));
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
  };

  const subtotal = cart.reduce((s, l) => s + lineTotal(l), 0);
  const total = Math.max(0, subtotal - (discount ?? 0));
  // 1.2 (Pro): loyalty points pay part of the sale; the rest is paid as before
  const due = total - points.value;
  // another customer, total or currency: the points are chosen again
  useEffect(() => { setPoints({ points: 0, value: 0 }); }, [partyId, total, currency]);
  // what the till offers now (offline: not credit, which needs the server's credit-limit check)
  const offered = tillMethods(offline);
  const method = chosenMethod(picked, offered);
  // credit was picked and can't be offered any more (the link dropped): the pick itself goes back to cash and the
  // cashier is told, so the sale does not turn into credit again by itself when the link returns
  const kept = pickAfterLink(picked, offered);
  useEffect(() => {
    if (kept === picked) return;
    setPicked('cash');
    toast(t('s14_creditDropped'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept, picked]);
  const onCredit = method === 'account';
  // 2.0: a sale paid now may be split over card and wallets (cash pays the rest); dollar notes may pay a dinar sale's cash
  const typedSplit = onCredit ? undefined : splitPayments(due, split);
  const splitBad = typedSplit === null;
  const payments = onCredit ? salePayments(method, due) : typedSplit ?? undefined;
  const cashDue = onCredit ? 0 : cashPartOf(due, typedSplit ?? undefined);
  const usdRateX100 = rateToX100(Number(toWesternDigits(usdRateText).replace(/,/g, '')) || 0);
  const usdOn = currency === 'IQD' && !onCredit && cashDue > 0 && (handedUsd ?? 0) > 0;
  const handedAny = currency === 'IQD' && !onCredit && cashDue > 0 && ((handed ?? 0) > 0 || usdOn);
  const change = handedAny ? changeInDinars(cashDue, handed ?? 0, usdOn ? handedUsd! : 0, usdRateX100) : null;
  const handedShort = change !== null && change < 0;
  // the items of this cart beyond the stock last known, with what is left of each
  const shortNow = cartShortNote(shortStock(cart), (code, have) => `${code} (${i18n.qty(Math.max(0, have))})`, i18n.lang === 'en' ? ', ' : '، ');
  const needsCustomer = creditNeedsCustomer(method, partyId);
  const canPay = cart.length > 0 && !busy && (discount ?? 0) <= subtotal && (currency === 'IQD' || rateX100 > 0) && !needsCustomer
    && !splitBad && !handedShort && (!usdOn || usdRateX100 > 0);

  const clear = () => {
    setCart([]);
    setDiscount(0);
    setPartyId('');
    setPicked('cash');
    setPoints({ points: 0, value: 0 });
    setSplit({});
    setHanded(null);
    setHandedUsd(null);
    setError(null);
    setQ('');
    // the next sale is another one, with a key of its own
    saleKey.current = null;
    setUnsure(false);
    focusSearch();
  };

  /** 2.0: the cash drawer, through this PC's receipt printer (Windows app), when the till is set to open it. */
  const drawerSaid = (s: string) => {
    if (s === 'no_printer') toast(t('tl_drawer_no_printer'));
    else if (s === 'failed') toast(t('tl_drawer_failed'));
  };
  const drawerOnCash = till?.drawer === 'cash' && inWindowsTill();
  const openDrawerForSale = () => { if (drawerOnCash) void kickDrawer().then(drawerSaid); };
  const noSale = async () => {
    try {
      await tillsApi.drawer(shift.id);
      const s = await kickDrawer();
      if (s === 'opened') toast(t('tl_noSaleDone')); else drawerSaid(s);
    } catch (e) {
      setError(e);
    } finally {
      focusSearch();
    }
  };

  /** 2.0: holds the basket on this till (this shift) and frees the till for the next customer. */
  const hold = () => {
    if (!cart.length || busy) return;
    const basket = holdBasket({
      shiftId: shift.id, currency, rateText, partyId, discount: discount ?? 0, total,
      lines: cart.map((l) => ({ itemId: l.item.id, qtyMilli: l.qtyMilli, unit: l.unit, unitPrice: l.unitPrice, ...(l.batchId ? { batchId: l.batchId } : {}) }))
    });
    if (!basket) { toast(t('tl_heldFull', { n: i18n.int(HELD_MAX) })); return; }
    setHeld(heldOn(shift.id));
    clear();
    toast(t('tl_heldSaved'));
  };
  const resume = (id: string) => {
    if (cart.length) { toast(t('tl_finishFirst')); return; }
    const basket = takeHeld(shift.id, id);
    setHeld(heldOn(shift.id));
    setShowHeld(false);
    if (!basket) return;
    const lines: CartLine[] = [];
    for (const l of basket.lines) {
      const item = items.find((it) => it.id === l.itemId);
      if (item) lines.push({ item, qtyMilli: l.qtyMilli, unit: l.unit, unitPrice: l.unitPrice, ...(l.batchId ? { batchId: l.batchId } : {}) });
    }
    const missing = basket.lines.length - lines.length;
    if (missing) toast(t('tl_heldMissing', { n: i18n.int(missing) }));
    setCart(lines);
    setPartyId(basket.partyId);
    if (basket.currency === currency && basket.rateText === rateText) setDiscount(basket.discount);
    else { resumedDiscount.current = basket.discount; setCurrency(basket.currency); setRateText(basket.rateText); }
    focusSearch();
  };

  /** 2.0: what the customer screen shows, in the till's language: the cart as it is, or the last sale's thanks. */
  useEffect(() => {
    if (cart.length && lastDone) setLastDone(null);
  }, [cart.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const base = { dir: i18n.dir, lang: i18n.lang, company: settings ? i18n.name(settings.companyName) : '', welcome: t('tl_welcome'), totalLabel: t('pos_total') };
    if (!cart.length && lastDone) {
      showOnCustomerScreen({ ...base, lines: [], total: lastDone.total, ...(lastDone.change ? { change: { label: t('tl_change'), value: lastDone.change } } : {}), done: t('tl_thanks') });
      return;
    }
    showOnCustomerScreen({
      ...base,
      lines: cart.map((l) => ({ name: i18n.name(l.item.name), qty: i18n.qty(l.qtyMilli), amount: i18n.money(lineTotal(l), currency) })),
      total: i18n.money(total, currency),
      ...(handedAny ? { paid: { label: t('tl_paid'), value: [(handed ?? 0) > 0 ? i18n.money(handed ?? 0, 'IQD') : '', usdOn ? i18n.money(handedUsd ?? 0, 'USD') : ''].filter(Boolean).join(' + ') } } : {}),
      ...(change !== null && change >= 0 ? { change: { label: t('tl_change'), value: i18n.money(change, 'IQD') } } : {})
    });
  }, [cart, total, currency, handed, handedUsd, change, lastDone, i18n.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The server can't be reached: the sale is kept on this PC (encrypted, power-cut safe) with its key and sent later,
   * once; the receipt carries a temporary reference. On a customer's account it can't be: that needs the server.
   */
  const keepHere = async (sale: SaleInput, key: string) => {
    const box = outboxClient();
    if (!box) throw new ApiError(0, 'network', null);
    const refusal = offlineRefusal(sale);
    if (refusal) throw new ApiError(400, 'validation', [{ code: refusal }]);
    const books = await box.books();
    if (!books) throw new ApiError(0, 'outbox_unavailable', null);
    const short = shortStock(cart);
    const kept = await box.add({
      id: key, kind: 'pos_sale', path: shiftPath, body: sale as unknown as Record<string, unknown>, books,
      user: { id: who?.id ?? null, name: who?.name ?? shift.openedBy }, summary: { total, currency, lines: cart.length, register: shift.register }
    });
    const stamp = kept.body.offline as { reference: string; soldAt: string; soldOn: string };
    setReceipt(offlineReceipt({
      key, reference: kept.reference ?? stamp.reference, soldAt: stamp.soldAt, soldOn: stamp.soldOn, shift, cashier: who?.name ?? shift.openedBy,
      lines: cart, currency, rateX100, discount: discount ?? 0, party: customers.find((p) => p.id === partyId) ?? null, payments: sale.payments ?? []
    }));
    // the stock last known, less this sale: the next sale is checked against it
    const left = takeFromStock(items, cart);
    setItems(left);
    rememberTill(tillWho(), { items: left });
    setShortNote(short.map((x) => `${x.code} (${i18n.qty(x.haveMilli)})`).join(i18n.lang === 'en' ? ', ' : '، '));
    if (cashDue > 0) openDrawerForSale();
    setLastDone({ total: i18n.money(total, currency), change: change !== null && change >= 0 ? i18n.money(change, 'IQD') : null });
    clear();
    toast(t('ob_savedHere', { n: kept.reference ?? '' }));
  };

  const pay = async () => {
    if (!canPay) return;
    setBusy(true);
    setError(null);
    setShortNote('');
    try {
      const sale: SaleInput = {
        currency, ...(currency === 'USD' ? { rateX100 } : {}), ...(partyId ? { partyId } : {}), discount: discount ?? 0,
        lines: cart.map(posSaleLine),
        ...(payments ? { payments } : {}),
        ...(points.points ? { loyaltyPoints: points.points } : {}),
        // what the customer handed over: dinars alone are kept as "Amount paid" for the receipt; dollar notes go with their rate
        ...(handedAny && !usdOn && (handed ?? 0) >= cashDue ? { tendered: handed ?? 0 } : {}),
        ...(usdOn ? { usdCash: { amount: handedUsd!, rateX100: usdRateX100 } } : {})
      };
      // on a PC with an outbox the sale keeps its key over every Pay until it is booked or kept: a try whose answer
      // was lost is answered from the first, never booked twice (industry/offline-till.ts)
      const done = await payTillSale({
        sale,
        outbox: outboxClient() ? {
          held: saleKey.current, hold: (h) => { saleKey.current = h; },
          // offline, or this person's earlier sales still wait (they go first)
          keepFirst: !serverReachable() || waitingMine > 0
        } : null,
        send: (body, options) => posApi.sell(shift.id, body, options),
        keep: keepHere,
        // stock past its expiry date: the company may allow it after the cashier confirms (written to the audit log)
        askExpired: (e) => expired.ask(e)
      });
      if (done.kind === 'unsure' && done.error) throw done.error;
      if (done.kind !== 'sold') return;
      const res = done.result;
      setShift(res.shift);
      rememberTill(tillWho(), { shift: res.shift });
      setReceipt(res.invoice);
      if (cashDue > 0) openDrawerForSale();
      setLastDone({ total: i18n.money(total, currency), change: change !== null && change >= 0 ? i18n.money(change, 'IQD') : null });
      clear();
      loadItems(); // stock changed
      toast(t('pos_saved', { n: res.invoice.number ?? '' }));
      // controlled medicines sold: the patient and the prescription, now or later from the pharmacy log
      controlled.check(res.invoice.id);
    } catch (e) {
      setError(e);
    } finally {
      // a try of this sale went out and no answer came: it may be booked, and the cashier is told so
      setUnsure(!!saleKey.current?.lost);
      setBusy(false);
    }
  };

  // F-keys: F2 search, F4 clear the sale, F8 discount, F9 pay, F10 print the last receipt
  const payRef = useRef(pay);
  payRef.current = pay;
  const holdRef = useRef(hold);
  holdRef.current = hold;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // a dialog over the sale (closing the shift, a new item, any other) keeps the keys to itself
      if (closing || addingItem !== null || document.querySelector('.backdrop')) return;
      if (e.key === 'F2') { e.preventDefault(); search.current?.focus(); }
      else if (e.key === 'F4') { e.preventDefault(); clear(); }
      else if (e.key === 'F6') { e.preventDefault(); holdRef.current(); }
      else if (e.key === 'F8') { e.preventDefault(); document.getElementById('pos-discount')?.querySelector('input')?.focus(); }
      else if (e.key === 'F9') { e.preventDefault(); void payRef.current(); }
      else if (e.key === 'F10' && receipt) { e.preventDefault(); void printReceipt(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const keepCustomer = (p: PartyView) => setCustomers((list) => {
    if (list.some((x) => x.id === p.id)) return list;
    const next = [...list, p];
    rememberTill(tillWho(), { customers: next });
    return next;
  });
  const addLabel = (typed: string) => {
    const kind = addRowKind(typed, market);
    return kind === 'barcode' ? t('iq_addBarcode', { code: typed }) : kind === 'scale' ? t('iq_addScale', { code: typed }) : t('iq_addNamed', { name: typed });
  };
  /**
   * An item added from the till (or one already there, chosen in the form): in the till's list (kept for offline too)
   * and on the sale at once; a scale's label puts the weight on it.
   */
  const addedItem = (item: ItemView) => {
    const label = addingItem !== null ? findByScaleBarcode(western(addingItem.trim()), [item]) : null;
    setAddingItem(null);
    setItems((list) => {
      const next = list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
      rememberTill(tillWho(), { items: next });
      return next;
    });
    if (label) add(item, label.qtyMilli, null);
    else add(item);
    setQ('');
    focusSearch();
  };
  /* the quick buttons: the company's list (or the one last known, offline), edited here by an admin */
  const [quickIds, setQuickIds] = useState<string[]>(() => quickIdsFor(settings?.posQuickItems, tillCache(tillWho())?.quick));
  const [editingQuick, setEditingQuick] = useState(false);
  const [quickError, setQuickError] = useState<unknown>(null);
  // each change is saved in turn, so the server ends with the last one whatever the network does
  const quickSaves = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    // what the server says, unless an admin is choosing them now (their own changes are on their way)
    if (editingQuick || !settings?.posQuickItems) return;
    setQuickIds(settings.posQuickItems);
    rememberTill(tillWho(), { quick: settings.posQuickItems });
  }, [settings?.posQuickItems, editingQuick]);
  const quickItems = useMemo(() => quickRowItems(quickIds, items), [quickIds, items]);
  const saveQuick = (next: string[]) => {
    setQuickIds(next);
    setQuickError(null);
    rememberTill(tillWho(), { quick: next });
    quickSaves.current = quickSaves.current.then(() => api.updateSettings({ posQuickItems: next })).catch((e: unknown) => {
      setQuickError(e);
      // what the server keeps is what shows
      void reloadSettings().then(() => setEditingQuick(false));
    });
  };
  const tapWhileEditing = (id: string) => {
    const { next, full } = toggleQuick(quickIds, id, POS_QUICK_MAX);
    if (full) { toast(t('tq_full', { n: i18n.int(POS_QUICK_MAX) })); return; }
    saveQuick(next);
  };
  const editQuick = () => {
    if (!editingQuick) { setQuickError(null); setEditingQuick(true); return; }
    // Done: once the last change is saved, the settings of every screen follow
    void quickSaves.current.then(() => reloadSettings()).finally(() => { setEditingQuick(false); focusSearch(); });
  };
  const customerOptions: PickOption[] = useMemo(() => customers.map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone, hint: p.phone })), [customers]);

  return (
    <div className={'pos' + (bigTiles ? ' pos-big' : '')}>
      {expired.dialog}
      {addingItem !== null && <QuickItemForm typed={addingItem} sale warehouseId={shift.warehouseId} onDone={addedItem} onClose={() => { setAddingItem(null); focusSearch(); }} />}
      {controlled.dialog}
      <div className="pos-bar no-print">
        <div className="pos-shift-info">
          <strong>{shift.register}</strong>
          <span className="muted small">{shift.number} · {shift.openedBy}</span>
          <span className="chip info num">{t('pos_salesSoFar')}: {money2(i18n, shift.sales)} · {i18n.int(shift.count)}</span>
          {offline && <span className="chip pos-offline-chip" role="status">{t('pos_offline')}</span>}
          {keptHere.length > 0 && <a className="chip warn num" href={href('outbox')}>{t('pos_offlineWaiting', { n: i18n.int(keptHere.length) })}</a>}
        </div>
        <div className="row">
          {held.length > 0 && <button type="button" className="btn" onClick={() => setShowHeld(true)}><Icon name="clock" size={16} />{t('tl_held', { n: i18n.int(held.length) })}</button>}
          {drawerOnCash && <button type="button" className="btn" onClick={() => void noSale()}><Icon name="wallet" size={16} />{t('tl_noSale')}</button>}
          <button type="button" className="btn" onClick={() => { void openCustomerScreen().then((ok) => { if (!ok) toast(t('tl_screenBlocked')); }); focusSearch(); }}><Icon name="panel" size={16} />{t('tl_customerScreen')}</button>
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
          {notFound && (
            <div className="alert bad row" role="alert" style={{ gap: 8 }}>
              <span>{t(addRowKind(notFound) === 'name' ? 'pos_noItemNamed' : 'pos_notFound', { n: notFound })}</span>
              {mayAdd && <><span className="spacer" /><button type="button" className="btn small" onClick={() => setAddingItem(notFound)}><Icon name="plus" size={15} />{addLabel(notFound)}</button></>}
            </div>
          )}
          {noRate && <div className="alert bad" role="alert">{t('pos_noRate', { n: noRate })}</div>}
          <QuickRow items={quickItems} currency={currency} priceRate={priceRate} editing={editingQuick} mayEdit={mayEditQuick} canEdit={!offline}
            error={quickError} onPick={(it) => { add(it); focusSearch(); }} onEdit={editQuick} onMove={(id, step) => saveQuick(moveQuick(quickIds, id, step))} />
          {catList.length > 0 && <PosCategories list={catList} value={cat} onChange={setCat} />}
          <div className={'pos-grid' + (editingQuick ? ' pos-grid-editing' : '')}>
            {matches.map((it) => {
              const name = i18n.name(it.name);
              const out = it.trackStock && it.qtyMilli <= 0;
              // the price of what a tap adds: the item's sale unit
              const offer = tileOffer(it, currency, priceRate);
              const isQuick = editingQuick && quickIds.includes(it.id);
              return (
                <button key={it.id} type="button" className={'pos-tile' + (out ? ' out' : '') + (isQuick ? ' quick-on' : '')}
                  aria-pressed={editingQuick ? isQuick : undefined}
                  onClick={() => { if (editingQuick) tapWhileEditing(it.id); else { add(it); focusSearch(); } }}>
                  {editingQuick && <span className="pos-tile-star" aria-hidden="true">{isQuick ? '★' : '☆'}</span>}
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
            {matches.length === 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <p className="muted" style={{ margin: 0 }}>{t('pos_noItems')}</p>
                {mayAdd && q.trim() && !notFound && !anyMatch && <div><button type="button" className="btn" onClick={() => setAddingItem(typedForForm(q))}><Icon name="plus" size={16} />{addLabel(typedForForm(q))}</button></div>}
              </div>
            )}
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
                  <CartName name={i18n.name(l.item.name)} />
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
              {/* a customer added here, or found here by the same phone or name, joins the till's own list (kept for
                  when the server can't be reached; the receipt reads the customer's name from it). No price list is
                  asked for: the till sells every item at its own sale price, whoever buys */}
              <PartyPicker type="customer" value={partyId} options={customerOptions} priceList={false} placeholder={onCredit ? t('chooseCustomer') : t('pos_walkIn')} {...(onCredit ? {} : { emptyLabel: t('pos_walkIn') })}
                onChange={(v, p) => { setPartyId(v); if (p) keepCustomer(p); }} onCreated={keepCustomer} />
            </div>
            <LoyaltyUse partyId={partyId} total={total} currency={currency} value={points.points} onChange={(n, v) => setPoints({ points: n, value: v })} />
            <label className="field" id="pos-discount"><span>{t('pos_discount')} <span className="kbd">F8</span></span><AmountInput value={discount} currency={currency} onChange={setDiscount} ariaLabel={t('pos_discount')} /></label>
            <div className="pos-total">
              <span>{t('pos_total')}</span>
              <strong className="num">{i18n.money(total, currency)}</strong>
            </div>
            {/* dinar and dollar: what the sale is worth in the other currency, as a hint only (the sale stays in its own) */}
            <TillEquivalent total={total} currency={currency} rateX100={currency === 'USD' ? rateX100 : undefined} />
            {points.value > 0 && (
              <div className="pos-r-row"><span>{t('pos_left')} ({t('ly_title')}: −{i18n.money(points.value, currency)})</span><strong className="num">{i18n.money(due, currency)}</strong></div>
            )}
            {/* 1.4: the cashier picks one: cash (paid now) or credit (the whole sale on the customer's account) */}
            <div className="stack" style={{ gap: 6 }}>
              <div className="track" role="group" aria-label={t('paymentMode')}>
                <button type="button" style={{ flex: 1 }} aria-pressed={!onCredit} onClick={() => setPicked('cash')}>{t('payCash')}</button>
                <button type="button" style={{ flex: 1 }} aria-pressed={onCredit} disabled={!offered.includes('account')} onClick={() => setPicked('account')}>{t('payCredit')}</button>
              </div>
              {onCredit && <div className="small muted">{t('s14_payCreditHint')}</div>}
              {needsCustomer && <div className="small" role="alert" style={{ color: 'var(--bad)' }}>{t('s14_creditNeedsCustomer')}</div>}
              {offline && <div className="small muted">{t('pos_offlineNoAccount')}</div>}
            </div>
            {/* 2.0: card and wallets (once an admin gave them accounts): cash pays what they don't */}
            {!onCredit && cardMethods.length > 0 && (
              <details className="pos-split" open={Object.values(split).some((v) => (v ?? 0) > 0)}>
                <summary className="small">{t('tl_cardWallet')}</summary>
                <div className="grid-2" style={{ marginTop: 6 }}>
                  {cardMethods.map((m) => (
                    <label key={m} className="field"><span>{t(`pay_${m}` as Key)}</span>
                      <AmountInput value={split[m] ?? null} currency={currency} onChange={(v) => setSplit((s) => ({ ...s, [m]: v }))} ariaLabel={t(`pay_${m}` as Key)} />
                    </label>
                  ))}
                </div>
                {typedSplit && <div className="pos-r-row small"><span>{t('tl_cashPart')}</span><span className="num">{i18n.money(cashDue, currency)}</span></div>}
                {splitBad && <div className="small" role="alert" style={{ color: 'var(--bad)' }}>{t('tl_splitTooMuch')}</div>}
              </details>
            )}
            {/* 2.0: what the customer handed over for the cash part (dinars and dollar notes); the change is in dinars */}
            {currency === 'IQD' && !onCredit && cashDue > 0 && (
              <div className="grid-2 pos-handed">
                <label className="field"><span>{t('tl_handed')}</span><AmountInput value={handed} currency="IQD" onChange={setHanded} ariaLabel={t('tl_handed')} /></label>
                <label className="field"><span>{t('tl_handedUsd')}</span><AmountInput value={handedUsd} currency="USD" onChange={setHandedUsd} ariaLabel={t('tl_handedUsd')} /></label>
                {usdOn && <label className="field"><span>{t('tl_usdRate')}</span><input className="input num ltr" inputMode="decimal" value={usdRateText} onChange={(e) => setUsdRateText(e.target.value)} /></label>}
                {change !== null && (
                  <div className="pos-r-row" role="status"><span>{handedShort ? t('tl_short') : t('tl_change')}</span><strong className="num" style={handedShort ? { color: 'var(--bad)' } : undefined}>{i18n.money(Math.abs(change), 'IQD')}</strong></div>
                )}
              </div>
            )}
            {unsure && (
              <div className="alert warn" role="alert">
                {t('pos_unsure')}
                {/* checked the shift's sales and it isn't there: this sale may go as a new one, with a key of its own */}
                <div><button type="button" className="btn" disabled={busy} onClick={() => { saleKey.current = null; setUnsure(false); setError(null); }}>{t('ob_unsureNotThere')}</button></div>
              </div>
            )}
            <ErrorBox error={error} />
            {shortNote && <div className="alert info small" role="status">{t('pos_offlineShort', { i: shortNote })}</div>}
            {/* more in the cart than the stock last known (an item with none left was added): said as it is added, not
                only when Pay is refused. The server decides at Pay, as before */}
            {shortNow && <div className="alert warn small" role="status">{t('pos_cartShort', { i: shortNow })}</div>}
            <div className="pos-actions">
              <button type="button" className="btn pos-touch" onClick={clear} disabled={busy}><Icon name="x" size={18} />{t('pos_clear')} <span className="kbd">F4</span></button>
              <button type="button" className="btn pos-touch" onClick={hold} disabled={busy || cart.length === 0}><Icon name="clock" size={18} />{t('tl_hold')} <span className="kbd">F6</span></button>
              <button type="button" className="btn primary pos-touch pos-pay-btn" onClick={() => void pay()} disabled={!canPay}>
                <Icon name="check" size={20} />{t('pos_pay')} <span className="kbd">F9</span>
              </button>
            </div>
            {receipt && (
              <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="link-btn small" onClick={() => void printReceipt()}>
                  <Icon name="printer" size={14} /> {t('pos_printLast', { n: receipt.number ?? '' })} <span className="kbd">F10</span>
                </button>
                <ReceiptWhatsApp invoice={receipt} />
              </div>
            )}
          </div>
        </section>
      </div>

      {receipt && <Receipt invoice={receipt} shift={shift} />}
      {showHeld && (
        <Modal title={t('tl_heldTitle')} onClose={() => { setShowHeld(false); focusSearch(); }}>
          <div className="stack">
            {held.length === 0 && <p className="muted">{t('tl_heldNone')}</p>}
            {held.map((b) => (
              <div key={b.id} className="pos-r-row">
                <span className="num">{i18n.digitsOf(new Date(b.at).toTimeString().slice(0, 5))} · {i18n.int(b.lines.length)} · {i18n.money(b.total, b.currency)}</span>
                <button type="button" className="btn small primary" onClick={() => resume(b.id)}>{t('tl_resume')}</button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {closing && <CloseShift shift={shift} keptHere={keptHere.length} held={held.length} onCancel={() => { setClosing(false); focusSearch(); }} onClosed={() => { clearHeld(shift.id); onClosed(); }} />}
    </div>
  );
}

/**
 * A cart line's name. It is held to two lines; a long one is read in full by a tap (or Enter on it), which opens it,
 * and another tap closes it. On a touch screen there is no pointer to rest on it for the title.
 */
export function CartName({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);
  return (
    <span role="button" tabIndex={0} title={name} aria-expanded={open} className={open ? 'pos-name-open' : undefined}
      onClick={toggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>{name}</span>
  );
}

/* ---------- the receipt (80 mm) ---------- */

/** The last receipt to the customer's WhatsApp, as a PDF of the 80 mm receipt (a walk-in customer: type the number). */
function ReceiptWhatsApp({ invoice }: { invoice: InvoiceView }) {
  const { settings } = useData();
  const names = settings?.companyName;
  const message = useCallback((m: I18n) => withAttachment(m, receiptMessage(m, names ? m.name(names) : '', invoice)), [names, invoice]);
  return <WhatsAppSendButton kind="receipt" docRef={invoice.number ?? invoice.id} phone={invoice.partyPhone} lang={invoice.partyLang} message={message} bodyClass="pos-printing" />;
}

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
  // 1.2 (Pro): the points the sale used and earned, and the customer's balance
  const points = loyaltyLines(i18n, invoice.loyalty);
  // a sale from when the till still asked for the amount paid: what was paid and the change, kept by the server with
  // the sale, print again under the total on a copy of its receipt. The till no longer asks, so new sales carry none
  const handed = invoice.tender ?? null;
  const tenderRows = handed && (
    <>
      <div className="pos-r-row small"><span>{t('pos_paid')}</span><span className="num">{i18n.money(handed.paid, invoice.currency)}</span></div>
      <div className="pos-r-row small"><span>{t('pos_change')}</span><span className="num">{i18n.money(handed.change, invoice.currency)}</span></div>
    </>
  );
  // a receipt design of the company's own (Settings → Print design) replaces the standard receipt
  if (setup.designs.pos) {
    return createPortal(
      <div className="pos-receipt-host" dir={i18n.dir} lang={i18n.lang === 'ku' ? 'ckb' : i18n.lang}>
        <PrintDocument
          model={{ ...invoiceModel(invoice, { pos: true }), tender: handed }} design={setup.designs.pos} profile={setup.profile}
          company={settings?.companyName ?? { ar: '', en: '', ku: '' }} branding={!plan?.features.includes('noBranding')}
          defaultRateX100={settings?.defaultRateX100}
        />
        {points.length > 0 && <div className="pos-receipt pos-r-loyalty">{points.map(([label, value]) => <div key={label} className="pos-r-row small"><span>{label}</span><span className="num">{value}</span></div>)}</div>}
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
        {invoice.offlineRef && invoice.number === invoice.offlineRef && <div className="pos-r-center small pos-r-offline">{t('pos_offlineReceipt')}</div>}
        <div className="pos-r-row small"><span>{t('pos_dateTime')}</span><span className="num ltr">{i18n.date(invoice.date)} {i18n.digitsOf(new Date(invoice.postedAt ?? invoice.createdAt).toTimeString().slice(0, 5))}</span></div>
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
        {tenderRows}
        {points.length > 0 && <div className="pos-r-sep" />}
        {points.map(([label, value]) => <div key={label} className="pos-r-row small"><span>{label}</span><span className="num">{value}</span></div>)}
        <div className="pos-r-sep" />
        <div className="pos-r-center small">{t('pos_thanks')}</div>
        {!plan?.features.includes('noBranding') && <div className="pos-r-center small">{t('madeWith')} · <span className="ltr">qasaerp.com</span></div>}
      </div>
    </div>,
    document.body
  );
}

/* ---------- closing ---------- */

function CloseShift({ shift, keptHere = 0, held = 0, onCancel, onClosed }: { shift: ShiftView; keptHere?: number; held?: number; onCancel(): void; onClosed(): void }) {
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
        {keptHere > 0 && <div className="alert warn" role="alert">{t('pos_closeWaiting', { n: i18n.int(keptHere) })} <a href={href('outbox')}>{t('ob_open')}</a></div>}
        {held > 0 && <div className="alert warn" role="alert">{t('tl_heldAtClose', { n: i18n.int(held) })}</div>}
        {(shift.usdTaken?.usd ?? 0) > 0 && <div className="pos-r-row small"><span>{t('tl_usdTaken')}</span><span className="num">{i18n.money(shift.usdTaken!.usd, 'USD')} = {i18n.money(shift.usdTaken!.iqd, 'IQD')}</span></div>}
        <label className="field"><span>{t('pos_notes')}</span><textarea className="input" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || iqd === null || keptHere > 0} onClick={() => void close()}>{t('pos_closeConfirm')}</button>
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
  const time = (iso: string | null) => shiftTime(i18n, iso);
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
            {(r.usdTaken?.usd ?? 0) > 0 && <tr><td>{t('tl_usdTaken')}<div className="small muted">{t('tl_usdTakenHelp')}</div></td><td className="num">{i18n.money(r.usdTaken!.usd, 'USD')} = {i18n.money(r.usdTaken!.iqd, 'IQD')}</td></tr>}
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
                  <td><a href={href(`invoice/${inv.invoiceId}`)} className="ltr">{inv.number ?? '—'}</a>{inv.offlineRef && <div className="small muted ltr">{inv.offlineRef}</div>}</td>
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

/**
 * The till's category buttons: the top-level categories; a category opens its subcategories (with a button for all of
 * it and one back). Choosing one shows only its items (a category's subcategories' items with it).
 */
export function PosCategories({ list, value, onChange }: { list: readonly CategoryView[]; value: string; onChange(id: string): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const current = list.find((c) => c.id === value);
  // the category whose subcategories show: the one picked, or the parent of the subcategory picked
  const open = current ? (current.parentId ? list.find((c) => c.id === current.parentId) : current) : undefined;
  const subs = open ? list.filter((c) => c.parentId === open.id) : [];
  const buttons = open ? subs : list.filter((c) => !c.parentId);
  return (
    <div className="pos-cats" role="group" aria-label={t('cat_title')}>
      {open ? (
        <>
          <button type="button" className="btn" onClick={() => onChange(current?.parentId ? open.id : '')}><Icon name="undo" size={16} />{t('cat_back')}</button>
          <button type="button" className="btn" aria-pressed={value === open.id} onClick={() => onChange(open.id)}>{i18n.name(open.name)}</button>
        </>
      ) : (
        <button type="button" className="btn" aria-pressed={!value} onClick={() => onChange('')}>{t('cat_all')}</button>
      )}
      {buttons.map((c) => (
        <button key={c.id} type="button" className="btn" aria-pressed={value === c.id} onClick={() => onChange(c.id)}>{i18n.name(c.name)}</button>
      ))}
    </div>
  );
}

/**
 * Under the till's total, when the company sees dinar and dollar: "≈ $954.20" (or "≈ 1,250,000 IQD" for a dollar
 * sale), with the rate in a tooltip. Only a hint: the sale is made and paid in its own currency. A dollar sale is
 * booked at the rate the cashier typed for it (`rateX100`), so its hint uses that rate and says so; a dinar sale uses
 * the rate board's rate for today.
 */
export function TillEquivalent({ total, currency, rateX100 }: { total: number; currency: CurrencyCode; rateX100?: number | undefined }) {
  const i18n = useI18n();
  const dual = useDual();
  if (dual.show === 'iqd' || !total) return null;
  if (currency === 'USD') {
    // the sale's own rate; the board's only while the cashier's field is empty or not a number
    const own = usableRate(rateX100) ? rateX100 : null;
    const board = own ? null : dual.rate();
    const r = own ?? board?.rateX100;
    if (!r) return null;
    const title = own ? i18n.t('am_rateSale', { r: perDollar(i18n, own) }) : dualRateTitle(i18n, board!);
    return <div className="pos-eq num" title={title}>{dualLineText(i18n, { amount: toBase(total, 'USD', r), currency: 'IQD', approx: true })}</div>;
  }
  const rate = dual.rate();
  if (!rate) return null;
  return <div className="pos-eq num" title={dualRateTitle(i18n, rate)}>{dualLineText(i18n, { amount: fromBase(total, rate.rateX100), currency: 'USD', approx: true })}</div>;
}
