import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { inCategory, categoriesApi } from '../industry/categories-api.ts';
import {
  isWeighedUnit, normalizeForSearch, POS_QUICK_MAX, posBigTiles, rateFromX100, rateToX100, cashToTake, toWesternDigits, type CurrencyCode, type Lang, type OfferRule, TILL_CARD_PAYMENTS } from '@qasa/core';
import { api, ApiError, serverReachable, setRefundApproval, type InvoiceView, type ItemView, type PartyView } from '../api.ts';
import { ErrorBox, Icon, Modal, useData, useLoad, usePageNav, useToast, type PickOption } from '../components.tsx';
import { makeI18n, useI18n, type I18n } from '../i18n.ts';
import { href } from '../router.ts';
import { PartyPicker } from '../industry/PartyPicker.tsx';
import { posApi, tillsApi, type PosMethod, type SaleInput, type ShiftView, type TillView } from '../industry/pos-api.ts';
import { clearHeld, heldOn, HELD_MAX, holdBasket, inWindowsTill, thisTill, keepScalePrefixes, keepScaleDigits, applyKeptScaleDigits, kickDrawer, scalePrefixesKept, showOnCustomerScreen, takeHeld, type HeldBasket } from '../industry/till.ts';
import { CustomerScreenButtons } from '../industry/CustomerScreenControl.tsx';
import { outboxClient, outboxWho, type HeldKey } from '../industry/outbox.ts';
import { useOutbox } from '../industry/OutboxBanner.tsx';
import { baseQtyOf, offlineReceipt, offlineRefusal, payTillSale, rememberTill, shortStock, takeFromStock, tillCache } from '../industry/offline-till.ts';
import '../pos.css';
import {
  addRefusal, cartShortNote, changeLineUnit, chosenMethod, creditNeedsCustomer, moveQuick, parseScan, pickAfterLink, posSaleLine, priceIn, priceRateFor, quickIdsFor, quickRowItems,
  salePayments, tileOffer, tillMethods, toggleQuick, type TillMethod, cashPartOf, changeInDinars, splitPayments, type SplitMethod
} from '../pages/pos-logic.ts';
import { inUnits, salePriceFor, unitChoices, unitLabel, type LineUnit } from '../industry/units.ts';
import { useExpiredConfirm } from '../industry/BatchFields.tsx';
import { pharmacyApi, type MedicineView } from '../industry/pharmacy-api.ts';
import { useControlledPrompt, usePharmacyOn, useRxItems } from '../industry/PharmacyPrompts.tsx';
import { LoyaltyUse } from '../industry/Loyalty.tsx';
import { QuickItemForm } from '../industry/QuickItemForm.tsx';
import { addRowKind, anyItemMatches, mayAddItem, typedForForm, western } from '../industry/item-quick-add.ts';
import { findByScaleBarcode } from '../industry/scale-barcode.ts';
import { offerName, offersApi, tillOfferPreview } from '../industry/offers-api.ts';
import { may } from '../may.ts';
import { fromServerOrTill, lineKey, lineTotal, tillWho, type CartLine } from './shared.ts';
import { ItemPicture, PosCategories, QuickRow } from './Tiles.tsx';
import { Receipt, ReceiptWhatsApp, printReceipt } from './Receipt.tsx';
import { CloseShift } from './CloseShift.tsx';
import { CartLines } from './Cart.tsx';
import { PaymentPanel, type PaySummary } from './PaymentPanel.tsx';
import { StatusBar } from './StatusBar.tsx';
import { useSupervisor } from './Supervisor.tsx';
import { approvalNeeds, companyRateOf, covers, dropDead, priceSubjectOf, rateStanding, type HeldApproval } from './approvals.ts';
import { Keypad, MiscDialog, PriceDialog, QtyDialog, ShortcutsHelp, VoucherPayDialog, VoucherSellDialog } from './Dialogs.tsx';
import { beep, readPrefs, writePrefs, type TillPrefs } from './feedback.ts';
import { NO_RULES, tillRulesApi, type ApprovalAction, type DisplayState, type TillRulesView } from './rules-api.ts';
import { readScaleSettings, readWeight, scaleProblem, serialHere } from './scale.ts';
import { TillClothingButtons } from '../industry/ClothingTools.tsx';
import { TillReturnDialog } from './TillReturn.tsx';
import { DeliveryFromTill } from '../industry/DeliveryFromTill.tsx';

/**
 * The register: an open shift (2.0, made for supermarkets). Scan first: the search box keeps the focus, so a barcode
 * scanner (which types the code and Enter) adds the item at once, with a beep, and the line flashes. The cart is in the
 * middle; the payment beside it, with the total big, quick cash buttons and the change big. F-keys for speed (F1 lists
 * them); a touch mode for touch screens. Every rule the company sets for its tills (dinar rounding, a supervisor's PIN,
 * the open-price item, gift vouchers) works here as the server applies it.
 *
 * Each sale is a sale invoice posted at once into the shift's safe; the receipt prints on an 80 mm printer.
 */
export function Register({ initial, onClosed }: { initial: ShiftView; onClosed(): void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const { settings, permissions, reloadSettings } = useData();
  const market = !!settings?.businessTypes?.includes('market');
  const bigTiles = posBigTiles(settings ?? {});
  const mayEditQuick = may(permissions, 'companyDetails');
  usePageNav({ key: 'pos_title', group: 'gSales' });
  const mayAdd = mayAddItem(permissions);
  const [addingItem, setAddingItem] = useState<string | null>(null);

  const [shift, setShift] = useState(initial);
  const [items, setItems] = useState<ItemView[]>([]);
  const [customers, setCustomers] = useState<PartyView[]>([]);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [currency, setCurrency] = useState<CurrencyCode>('IQD');
  // dollars start at the day's rate (the rate board's for today, else the company's: the till's rules carry it)
  const [rateText, setRateText] = useState(() => String(rateFromX100(tillCache(tillWho())?.rules?.rate?.referenceX100 ?? settings?.defaultRateX100 ?? 142000)));
  const [discount, setDiscount] = useState<number | null>(0);
  const [partyId, setPartyId] = useState('');
  const [picked, setPicked] = useState<TillMethod>('cash');
  const [till, setTill] = useState<TillView | null>(null);
  const [cardMethods, setCardMethods] = useState<Exclude<SplitMethod, 'cash'>[]>([]);
  const [split, setSplit] = useState<Partial<Record<Exclude<SplitMethod, 'cash'>, number | null>>>({});
  const [handed, setHanded] = useState<number | null>(null);
  const [handedUsd, setHandedUsd] = useState<number | null>(null);
  const [usdRateText, setUsdRateText] = useState(() => String(rateFromX100(tillCache(tillWho())?.rules?.rate?.referenceX100 ?? settings?.defaultRateX100 ?? 142000)));
  const [scalePrefixes, setScalePrefixes] = useState<string[]>(scalePrefixesKept);
  const [held, setHeld] = useState<HeldBasket[]>(() => heldOn(initial.id));
  const [showHeld, setShowHeld] = useState(false);
  const [lastDone, setLastDone] = useState<{ total: string; change: string | null; number: string } | null>(null);
  const resumedDiscount = useRef<number | null>(null);
  // 2.0: the till's rules, this PC's preferences, the approvals a supervisor gave for this sale, gift vouchers on it,
  // what the open-price lines are, and the customer's debt
  const [rules, setRules] = useState<TillRulesView>(() => tillCache(tillWho())?.rules ?? NO_RULES);
  const [prefs, setPrefsState] = useState<TillPrefs>(readPrefs);
  const setPrefs = (p: TillPrefs) => { setPrefsState(p); writePrefs(p); };
  const [approvals, setApprovals] = useState<HeldApproval[]>([]);
  // the day's rate, as the server holds dollars to it (kept with the till's rules for a till that is cut off); a rate
  // field nobody typed in follows it when it changes
  const dayRate = rules.rate ?? null;
  const shownRate = useRef(rateText);
  useEffect(() => {
    if (!dayRate) return;
    const next = String(rateFromX100(dayRate.referenceX100));
    const before = shownRate.current;
    shownRate.current = next;
    setRateText((v) => (v === before ? next : v));
    setUsdRateText((v) => (v === before ? next : v));
  }, [dayRate?.referenceX100]);
  const [vouchers, setVouchers] = useState<{ code: string; amount: number }[]>([]);
  const [miscNotes, setMiscNotes] = useState<string[]>([]);
  const [debt, setDebt] = useState<{ balance: number; creditLimit: number | null } | null>(null);
  const [dialog, setDialog] = useState<null | 'help' | 'misc' | 'voucherSell' | 'voucherPay' | 'qty' | { price: string } | 'more' | 'return'>(null);
  const [pad, setPad] = useState<{ target: 'cash' | 'qty'; value: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (initial.tillId) tillsApi.list().then((r) => setTill(r.tills.find((x) => x.id === initial.tillId) ?? null), () => {});
    if (TILL_CARD_PAYMENTS) tillsApi.paymentAccounts().then((r) => setCardMethods(r.methods.filter((m: PosMethod): m is Exclude<SplitMethod, 'cash'> => m !== 'cash' && m !== 'account')), () => {});
    applyKeptScaleDigits();
    tillsApi.scale().then((r) => { setScalePrefixes(r.pricePrefixes); keepScalePrefixes(r.pricePrefixes); keepScaleDigits(r.itemDigits); }, () => {});
    // kept with the offline till: a till that can't reach the server goes on with the rules it last had (the dinar
    // rounding above all: the server rounds a kept sale when it arrives, and the till must have taken the same cash)
    void fromServerOrTill(() => tillRulesApi.rules(), (r) => rememberTill(tillWho(), { rules: r }), () => tillCache(tillWho())?.rules).then(setRules, () => {});
  }, [initial.id, initial.tillId]);
  // 2.0: the till is one screen high (1366×768 included): the body takes what is left under the bar, and each column
  // scrolls inside itself, so Pay, the total, the customer and the discount never leave the screen
  const tillRoot = useRef<HTMLDivElement | null>(null);
  const tillBody = useRef<HTMLDivElement | null>(null);
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  useEffect(() => {
    const fit = () => {
      const body = tillBody.current;
      if (!body || window.innerWidth < 760) { setBodyHeight(null); return; }
      const footer = document.querySelector('.app-footer, .statusline, footer');
      const bottom = footer ? footer.getBoundingClientRect().height : 0;
      const h = Math.floor(window.innerHeight - body.getBoundingClientRect().top - bottom - 12);
      setBodyHeight(h >= 360 ? h : null);
    };
    fit();
    window.addEventListener('resize', fit);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    if (ro && tillRoot.current) ro.observe(tillRoot.current);
    return () => { window.removeEventListener('resize', fit); ro?.disconnect(); };
  }, []);
  /** The shift again from the server: this PC's till's (several tills may have shifts open), and only if it is still this one. */
  const reloadShift = (after?: (s: ShiftView) => void) => {
    posApi.current(thisTill() || null).then((r) => { if (r.shift?.id === shift.id) { setShift(r.shift); after?.(r.shift); } }, () => {});
  };
  const outbox = useOutbox();
  const offline = !!outbox && !outbox.online;
  const shiftPath = `/api/pos/shifts/${shift.id}/sales`;
  const who = outboxWho();
  const keptHere = outbox ? outbox.entries.filter((e) => e.path === shiftPath) : [];
  const waitingMine = outbox ? outboxClient()?.mineWaiting(who).length ?? 0 : 0;
  const [shortNote, setShortNote] = useState('');
  const saleKey = useRef<HeldKey | null>(null);
  const [unsure, setUnsure] = useState(false);
  const keptCount = keptHere.length;
  const keptBefore = useRef(keptCount);
  useEffect(() => {
    const fewer = keptCount < keptBefore.current;
    keptBefore.current = keptCount;
    if (!fewer || !outbox?.online) return;
    reloadShift((s) => rememberTill(tillWho(), { shift: s }));
    loadItems();
  }, [keptCount, outbox?.online]); // eslint-disable-line react-hooks/exhaustive-deps
  const [points, setPoints] = useState({ points: 0, value: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const expired = useExpiredConfirm();
  const [receipt, setReceipt] = useState<InvoiceView | null>(null);
  const [receiptRounding, setReceiptRounding] = useState(0);
  const [closing, setClosing] = useState(false);
  const [notFound, setNotFound] = useState('');
  const [noRate, setNoRate] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const supervisor = useSupervisor(shift.id, !offline, () => toast(t('tu_pinNeedsServer')));

  const rateX100 = currency === 'USD' ? rateToX100(Number(toWesternDigits(rateText).replace(/,/g, '')) || 0) : 100;
  const priceRate = priceRateFor(currency, rateX100, settings?.defaultRateX100);

  const loadItems = useCallback(() => {
    void fromServerOrTill(() => api.items({ active: 'true' }), (list) => rememberTill(tillWho(), { items: list }), () => tillCache(tillWho())?.items).then(setItems, setError);
  }, []);
  const [offerRules, setOfferRules] = useState<OfferRule[]>(() => tillCache(tillWho())?.offers ?? []);
  const loadOffers = useCallback(() => {
    void fromServerOrTill(() => offersApi.till(shift.warehouseId).then((r) => r.offers), (list) => rememberTill(tillWho(), { offers: list }), () => tillCache(tillWho())?.offers)
      .then(setOfferRules, () => {});
  }, [shift.warehouseId]);
  useEffect(() => { loadOffers(); }, [loadOffers]);
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
  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

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

  const categories = useLoad(() => fromServerOrTill(() => categoriesApi.list({ active: 'true' }), (list) => rememberTill(tillWho(), { categories: list }), () => tillCache(tillWho())?.categories), []);
  const [cat, setCat] = useState('');
  const catList = categories.data ?? [];
  const shown = useMemo(() => (cat ? items.filter((it) => inCategory(catList, it.categoryId, cat)) : items), [items, cat, catList]);
  // the grid follows the typing a moment behind it, so a scanner's digits never wait for the grid (5,000+ items)
  const qGrid = useDeferredValue(q);
  const matches = useMemo(() => {
    const n = normalizeForSearch(qGrid);
    if (!n) return shown.slice(0, cat ? 120 : 40);
    const words = n.split(/\s+/).filter(Boolean);
    const direct = searchable.filter((s) => words.every((w) => s.key.includes(w))).map((s) => s.item).filter((it) => !cat || inCategory(catList, it.categoryId, cat));
    const generic = pharmacy ? shown.filter((it) => !direct.includes(it) && normalizeForSearch(medicines.get(it.id)?.genericName ?? '').includes(n)) : [];
    return [...direct, ...generic].slice(0, 40);
  }, [qGrid, shown, cat, catList, searchable, pharmacy, medicines]);
  const anyMatch = useMemo(() => anyItemMatches(q, searchable.map((s) => s.key)), [q, searchable]);

  const unitPriceOf = useCallback((item: ItemView, unit: LineUnit) => {
    const own = unit ? item.units.find((u) => u.unit === unit)?.salePrice ?? null : null;
    const ownIn = own !== null ? priceIn({ salePrice: own, saleCurrency: item.saleCurrency }, currency, priceRate) : null;
    return salePriceFor(item, unit, priceIn(item, currency, priceRate), { own: ownIn });
  }, [currency, priceRate]);
  /**
   * The item's list price as the server reckons it for the "lower price" rule: at the company's rate, whatever rate is
   * typed for a dollar sale (a better rate typed here is a lower price, and needs the supervisor like any other).
   */
  const listPriceOf = useCallback((item: ItemView, unit: LineUnit) => {
    const rate = currency === 'USD' ? settings?.defaultRateX100 ?? priceRate : priceRate;
    const own = unit ? item.units.find((u) => u.unit === unit)?.salePrice ?? null : null;
    const ownIn = own !== null ? priceIn({ salePrice: own, saleCurrency: item.saleCurrency }, currency, rate) : null;
    return salePriceFor(item, unit, priceIn(item, currency, rate), { own: ownIn });
  }, [currency, priceRate, settings?.defaultRateX100]);

  const add = useCallback((item: ItemView, qtyMilli = 1000, unit: LineUnit = item.saleUnit ?? null, price?: number) => {
    if (addRefusal(item, currency, priceRate)) { setNotFound(''); setNoRate(item.code); if (prefs.beep) beep('bad'); return; }
    const key = lineKey({ item, unit });
    setCart((c) => {
      const i = c.findIndex((l) => l.item.id === item.id && l.unit === unit);
      if (i >= 0 && price === undefined) return c.map((l, j) => (j === i ? { ...l, qtyMilli: l.qtyMilli + qtyMilli } : l));
      // the open-price item: each sale of it is a line of its own price
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qtyMilli: 1000, unitPrice: price! } : l));
      return [...c, { item, qtyMilli, unit, unitPrice: price ?? unitPriceOf(item, unit) }];
    });
    setFlash(key);
    if (prefs.beep) beep('ok');
    setNotFound('');
    setNoRate('');
  }, [currency, priceRate, unitPriceOf, prefs.beep]);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(timer);
  }, [flash, cart]);
  // a screen reader hears what was added and the total now
  const flashed = flash ? cart.find((l) => lineKey(l) === flash) : undefined;
  const flashedName = flashed ? i18n.name(flashed.item.name) : '';

  useEffect(() => {
    setCart((c) => c.map((l) => (l.item.id === rules.misc.itemId ? l : { ...l, unitPrice: unitPriceOf(l.item, l.unit) })));
    setDiscount(resumedDiscount.current ?? 0);
    resumedDiscount.current = null;
  }, [currency, priceRate]); // eslint-disable-line react-hooks/exhaustive-deps

  const onEnter = () => {
    const raw = toWesternDigits(q).trim();
    if (!raw) {
      // Enter with nothing typed after a sale: the next sale starts (the panel of the last one closes)
      if (lastDone && !cart.length) setLastDone(null);
      return;
    }
    const { code, qtyMilli: qty, exact, unit } = parseScan(raw, items, scalePrefixes);
    const pick = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (pick && qty > 0) {
      add(pick, qty, exact ? unit : pick.saleUnit ?? null);
      setQ('');
    } else if (!exact && (matches.length > 1 || anyMatch)) {
      setNoRate('');
      if (matches.length === 0) setCat('');
    } else {
      setNoRate('');
      if (prefs.beep) beep('bad');
      setNotFound(addRowKind(code) === 'name' ? q.trim() : code);
    }
  };

  const setLine = useCallback((key: string, patch: Pick<CartLine, 'batchId'> | Pick<CartLine, 'rxSeen'>) => {
    setCart((c) => c.map((l) => (lineKey(l) === key ? { ...l, ...patch } : l)));
  }, []);

  /** Less of a line, or none: with the company's rule, a line already scanned comes off only with a supervisor. */
  const setQty = useCallback(async (key: string, qtyMilli: number) => {
    const line = cart.find((l) => lineKey(l) === key);
    if (line && qtyMilli < line.qtyMilli && rules.supervisor.lineDelete) {
      const ok = await supervisor.ask('line_delete', `${i18n.name(line.item.name)} ${i18n.qty(line.qtyMilli)} → ${i18n.qty(Math.max(0, qtyMilli))}`);
      if (!ok) { focusSearch(); return; }
      toast(t('tu_approvedBy', { n: ok.approver }));
    }
    setCart((c) => (qtyMilli <= 0 ? c.filter((l) => lineKey(l) !== key) : c.map((l) => (lineKey(l) === key ? { ...l, qtyMilli } : l))));
    focusSearch();
  }, [cart, rules.supervisor.lineDelete, supervisor, i18n, toast, t, focusSearch]);

  const nextUnit = useCallback((key: string) => {
    setCart((c) => {
      const i = c.findIndex((l) => lineKey(l) === key);
      const l = c[i];
      if (!l) return c;
      const choices = unitChoices(l.item);
      const at = choices.findIndex((u) => u.unit === l.unit);
      const unit = choices[(at + 1) % choices.length]?.unit ?? null;
      return changeLineUnit(c, i, unit, unitPriceOf(l.item, unit));
    });
  }, [unitPriceOf]);

  const subtotal = cart.reduce((s, l) => s + lineTotal(l), 0);
  const offerResult = useMemo(() => tillOfferPreview(
    cart.map((l) => ({ itemId: l.item.id, categoryId: l.item.categoryId ?? null, qtyMilli: baseQtyOf(l), amount: lineTotal(l) })), offerRules, { currency, rateX100 }
  ), [cart, offerRules, currency, rateX100]);
  const offerTotal = offerResult.total;
  const total = Math.max(0, subtotal - offerTotal - (discount ?? 0));
  const offerNames = useMemo(() => {
    const out: Record<number, string> = {};
    for (const a of offerResult.allocations) {
      const rule = offerRules.find((r) => r.id === a.offerId);
      if (rule) out[a.lineNo] = offerName(rule.names, i18n.lang);
    }
    return out;
  }, [offerResult, offerRules, i18n.lang]);
  const byVouchers = vouchers.reduce((s, v) => s + v.amount, 0);
  const due = total - points.value - byVouchers;
  useEffect(() => { setPoints({ points: 0, value: 0 }); }, [partyId, total, currency]);
  useEffect(() => { if (byVouchers > total - points.value) setVouchers([]); }, [total]); // eslint-disable-line react-hooks/exhaustive-deps
  const offered = tillMethods(offline);
  const method = chosenMethod(picked, offered);
  const kept = pickAfterLink(picked, offered);
  useEffect(() => {
    if (kept === picked) return;
    setPicked('cash');
    toast(t('s14_creditDropped'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept, picked]);
  const onCredit = method === 'account';
  const typedSplit = onCredit ? undefined : splitPayments(due, split);
  const splitBad = typedSplit === null;
  const payments = onCredit ? salePayments(method, due) : typedSplit ?? undefined;
  const cashDue = onCredit ? 0 : cashPartOf(due, typedSplit ?? undefined);
  // the drawer takes the cash rounded as the company says (the server books the difference)
  const cashRounded = currency === 'IQD' && !onCredit ? cashToTake(cashDue, rules.rounding) : cashDue;
  const usdRateX100 = rateToX100(Number(toWesternDigits(usdRateText).replace(/,/g, '')) || 0);
  const usdOn = currency === 'IQD' && !onCredit && cashDue > 0 && (handedUsd ?? 0) > 0;
  const handedAny = currency === 'IQD' && !onCredit && cashDue > 0 && ((handed ?? 0) > 0 || usdOn);
  const change = handedAny ? changeInDinars(cashRounded, handed ?? 0, usdOn ? handedUsd! : 0, usdRateX100) : null;
  const handedShort = change !== null && change < 0;
  const shortNow = cartShortNote(shortStock(cart), (code, have) => `${code} (${i18n.qty(Math.max(0, have))})`, i18n.lang === 'en' ? ', ' : '، ');
  const needsCustomer = creditNeedsCustomer(method, partyId);
  const canPay = cart.length > 0 && !busy && (discount ?? 0) <= subtotal - offerTotal && (currency === 'IQD' || rateX100 > 0) && !needsCustomer
    && !splitBad && !handedShort && (!usdOn || usdRateX100 > 0) && due >= 0;

  // the customer's debt and limit, as they are picked (a credit sale shows what it adds)
  useEffect(() => {
    setDebt(null);
    if (!partyId || offline) return;
    let alive = true;
    tillRulesApi.customer(partyId).then((d) => { if (alive) setDebt(d); }, () => {});
    return () => { alive = false; };
  }, [partyId, offline]);
  const overLimit = !!debt && debt.creditLimit !== null && onCredit && debt.balance + due > debt.creditLimit;

  const clearNow = () => {
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
    setApprovals([]);
    setVouchers([]);
    setMiscNotes([]);
    setPad(null);
    saleKey.current = null;
    setUnsure(false);
    focusSearch();
  };
  /** F4 / Clear: a basket with lines is voided, with a supervisor when the company says so. */
  const clear = async () => {
    if (cart.length && rules.supervisor.void) {
      const ok = await supervisor.ask('void', t('tu_lines', { n: i18n.int(cart.length) }));
      if (!ok) { focusSearch(); return; }
      toast(t('tu_approvedBy', { n: ok.approver }));
    }
    clearNow();
  };

  const drawerSaid = (s: string) => {
    if (s === 'no_printer') toast(t('tl_drawer_no_printer'));
    else if (s === 'failed') toast(t('tl_drawer_failed'));
    else if (s === 'blocked') toast(t('tl_drawer_blocked'));
  };
  const drawerOnCash = till?.drawer === 'cash' && inWindowsTill();
  const openDrawerForSale = () => { if (drawerOnCash) void kickDrawer().then(drawerSaid); };
  const noSale = async () => {
    try {
      let tokens: string[] | undefined;
      if (rules.supervisor.noSale) {
        const ok = await supervisor.ask('no_sale');
        if (!ok) return;
        tokens = [ok.token];
      }
      await tillsApi.drawer(shift.id, '', tokens);
      const s = await kickDrawer();
      if (s === 'opened') toast(t('tl_noSaleDone')); else drawerSaid(s);
    } catch (e) {
      setError(e);
    } finally {
      focusSearch();
    }
  };
  // 2.0.0: a return is made here, at the till (pos/TillReturn.tsx): the supervisor's PIN, when the rules ask for it, is
  // checked by the server with the return itself
  const openReturns = () => {
    if (offline) { toast(t('ux_returnOffline')); return; }
    setDialog('return');
  };

  const hold = () => {
    if (!cart.length || busy) return;
    const basket = holdBasket({
      shiftId: shift.id, currency, rateText, partyId, discount: discount ?? 0, total,
      lines: cart.map((l) => ({ itemId: l.item.id, qtyMilli: l.qtyMilli, unit: l.unit, unitPrice: l.unitPrice, ...(l.batchId ? { batchId: l.batchId } : {}) }))
    });
    if (!basket) { toast(t('tl_heldFull', { n: i18n.int(HELD_MAX) })); return; }
    setHeld(heldOn(shift.id));
    clearNow();
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
      const item = byId.get(l.itemId);
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

  // the customer screens: this browser's window, and screens paired on other devices (through the server), in the
  // language the company chose for them
  const screenI18n: I18n = useMemo(() => (rules.display.lang === 'till' || rules.display.lang === i18n.lang ? i18n : makeI18n(rules.display.lang as Lang, 'western', () => {}, () => {})), [rules.display.lang, i18n]);
  useEffect(() => {
    if (cart.length && lastDone) setLastDone(null);
  }, [cart.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const screenState: DisplayState = useMemo(() => {
    const s = screenI18n;
    const base = { dir: s.dir, lang: s.lang, company: settings ? s.name(settings.companyName) : '', welcome: s.t('tl_welcome'), totalLabel: s.t('pos_total') };
    if (!cart.length && lastDone) {
      return { ...base, lines: [], total: lastDone.total, ...(lastDone.change ? { change: { label: s.t('tl_change'), value: lastDone.change } } : {}), done: s.t('tl_thanks') };
    }
    const saved = offerTotal + (discount ?? 0);
    return {
      ...base,
      lines: cart.map((l, i) => ({
        name: s.name(l.item.name), qty: s.qty(l.qtyMilli), amount: s.money(lineTotal(l), currency),
        ...((offerResult.byLine[i + 1] ?? 0) > 0 ? { offer: `−${s.money(offerResult.byLine[i + 1]!, currency)}` } : {})
      })),
      total: s.money(total, currency),
      ...(saved > 0 ? { saved: { label: s.t('tu_cd_saved'), value: s.money(saved, currency) } } : {}),
      ...(handedAny ? { paid: { label: s.t('tl_paid'), value: [(handed ?? 0) > 0 ? s.money(handed ?? 0, 'IQD') : '', usdOn ? s.money(handedUsd ?? 0, 'USD') : ''].filter(Boolean).join(' + ') } } : {}),
      ...(change !== null && change >= 0 ? { change: { label: s.t('tl_change'), value: s.money(change, 'IQD') } } : {}),
      ...(handedAny || busy ? { paying: true } : {})
    };
  }, [cart, total, currency, handed, handedUsd, change, lastDone, screenI18n, offerResult, offerTotal, discount, handedAny, usdOn, busy, settings]);
  useEffect(() => { showOnCustomerScreen(screenState); }, [screenState]);
  useEffect(() => { if (flashedName) setSaid(t('tu_added', { name: flashedName, total: i18n.money(total, currency) })); }, [flashedName, flash]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!till?.customerDisplay || offline) return;
    const timer = window.setTimeout(() => { void tillRulesApi.showState(till.id, screenState).catch(() => {}); }, 250);
    return () => window.clearTimeout(timer);
  }, [screenState, till?.id, till?.customerDisplay, offline]);

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
      lines: cart, currency, rateX100, discount: discount ?? 0, party: customers.find((p) => p.id === partyId) ?? null, payments: sale.payments ?? [],
      ...(offerTotal > 0 ? { offers: { result: offerResult, rules: offerRules } } : {})
    }));
    // the cash was taken rounded, as the server will book it when the sale arrives
    setReceiptRounding(cashRounded - cashDue);
    const left = takeFromStock(items, cart);
    setItems(left);
    rememberTill(tillWho(), { items: left });
    setShortNote(short.map((x) => `${x.code} (${i18n.qty(x.haveMilli)})`).join(i18n.lang === 'en' ? ', ' : '، '));
    if (cashDue > 0) openDrawerForSale();
    setLastDone({ total: i18n.money(total, currency), change: change !== null && change >= 0 ? i18n.money(change, 'IQD') : null, number: kept.reference ?? '' });
    clearNow();
    toast(t('ob_savedHere', { n: kept.reference ?? '' }));
  };

  /**
   * The approvals this sale needs before it goes (a price below the list, a big discount, credit over the limit): those
   * the till holds that still cover the basket as it is, and the others asked for now. Null: not approved.
   */
  const askBeforePay = async (have: readonly HeldApproval[]): Promise<HeldApproval[] | null> => {
    const needs = approvalNeeds({
      rules: rules.supervisor, miscItemId: rules.misc.itemId, discount: discount ?? 0, subtotal, overLimit, partyId, onAccount: due,
      currency, rate: dayRate ?? undefined, ...(currency === 'USD' ? { saleRateX100: rateX100 } : {}), ...(usdOn ? { notesRateX100: usdRateX100 } : {}),
      lines: cart.map((l) => ({ itemId: l.item.id, itemUnit: l.item.unit, unit: l.unit, unitPrice: l.unitPrice, listPrice: listPriceOf(l.item, l.unit), name: i18n.name(l.item.name) }))
    });
    let list = have.filter((a) => needs.some((n) => covers(a, n)));
    for (const need of needs) {
      if (list.some((a) => covers(a, need))) continue;
      const detail = need.action === 'rate' ? t('tu_rateAsk', { r: String(rateFromX100(need.amount)), d: String(rateFromX100(dayRate?.referenceX100 ?? 0)) })
        : need.line ? `${need.line.name ?? ''}: ${i18n.money(need.line.listPrice, currency)} → ${i18n.money(need.line.unitPrice, currency)}` : i18n.money(need.amount, currency);
      const ok = await supervisor.ask(need.action, detail, need.what);
      if (!ok) return null;
      list = [...list, { action: need.action, token: ok.token, subject: need.subject, amount: need.amount, currency: need.currency, gross: need.gross }];
    }
    setApprovals(list);
    return list;
  };

  const pay = async (exact = false, have?: readonly HeldApproval[]): Promise<void> => {
    if (!canPay) return;
    // a dollar rate far from the day's is a slip of a digit: said here, before anything is sent or kept for later
    // (the server says the same; a till that is cut off checks with the rate it last had)
    if (dayRate) {
      const far = usdOn && rateStanding(usdRateX100, dayRate) === 'far' ? 'pos_usd_rate_far' : currency === 'USD' && rateStanding(rateX100, dayRate) === 'far' ? 'pos_rate_far' : null;
      if (far) {
        (far === 'pos_usd_rate_far' ? setUsdRateText : setRateText)(String(rateFromX100(dayRate.referenceX100)));
        setError(new ApiError(400, 'validation', [{ code: far, rateX100: dayRate.referenceX100 }]));
        return;
      }
    }
    const held = await askBeforePay(have ?? approvals);
    if (held === null) { focusSearch(); return; }
    const tokens = held.map((a) => a.token);
    let again: HeldApproval[] | null = null;
    setBusy(true);
    setError(null);
    setShortNote('');
    const handedNow = exact && currency === 'IQD' && !onCredit && cashDue > 0 ? cashRounded : handed;
    const handedAnyNow = currency === 'IQD' && !onCredit && cashDue > 0 && ((handedNow ?? 0) > 0 || usdOn);
    const changeNow = handedAnyNow ? changeInDinars(cashRounded, handedNow ?? 0, usdOn ? handedUsd! : 0, usdRateX100) : null;
    try {
      const notes = miscNotes.join(' · ');
      const sale: SaleInput = {
        currency, ...(currency === 'USD' ? { rateX100 } : {}), ...(partyId ? { partyId } : {}), discount: discount ?? 0,
        ...(notes ? { notes } : {}),
        lines: cart.map(posSaleLine),
        ...(payments ? { payments } : {}),
        ...(points.points ? { loyaltyPoints: points.points } : {}),
        ...(handedAnyNow && !usdOn && (handedNow ?? 0) >= cashRounded ? { tendered: handedNow ?? 0 } : {}),
        ...(usdOn ? { usdCash: { amount: handedUsd!, rateX100: usdRateX100 } } : {}),
        ...(tokens.length ? { approvals: tokens } : {}),
        ...(vouchers.length ? { vouchers } : {})
      };
      const done = await payTillSale({
        sale,
        outbox: outboxClient() ? {
          held: saleKey.current, hold: (h) => { saleKey.current = h; },
          keepFirst: !serverReachable() || waitingMine > 0
        } : null,
        send: (body, options) => posApi.sell(shift.id, body, options),
        keep: keepHere,
        askExpired: (e) => expired.ask(e)
      });
      if (done.kind === 'unsure' && done.error) throw done.error;
      if (done.kind !== 'sold') return;
      const res = done.result as { invoice: InvoiceView; shift: ShiftView; rounding?: number };
      setShift(res.shift);
      rememberTill(tillWho(), { shift: res.shift });
      setReceipt(res.invoice);
      setReceiptRounding(res.rounding ?? 0);
      if (cashDue > 0) openDrawerForSale();
      setLastDone({ total: i18n.money(total, currency), change: changeNow !== null && changeNow >= 0 ? i18n.money(changeNow, 'IQD') : null, number: res.invoice.number ?? '' });
      clearNow();
      loadItems();
      toast(t('pos_saved', { n: res.invoice.number ?? '' }));
      controlled.check(res.invoice.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'validation' && Array.isArray(e.details) && (e.details as { code?: string }[]).some((d) => d.code === 'payments_total_mismatch')) loadOffers();
      // a rate typed too far from the company's: the company's goes back in the field, for the cashier to see and pay again
      const usdRate = companyRateOf(e, 'pos_usd_rate_far');
      if (usdRate) setUsdRateText(String(rateFromX100(usdRate)));
      const saleRate = companyRateOf(e, 'pos_rate_far');
      if (saleRate) setRateText(String(rateFromX100(saleRate)));
      // an approval the till sent that the server no longer takes (it ran out while the basket waited, or was used):
      // dropped, and asked for again, once
      again = have ? null : dropDead(held, e);
      if (again) setApprovals(again); else setError(e);
    } finally {
      setUnsure(!!saleKey.current?.lost);
      setBusy(false);
    }
    if (again) await pay(exact, again);
  };

  /** A price typed for a line; a lower one than the item's own needs a supervisor when the company says so. */
  const setPrice = async (key: string, price: number) => {
    const line = cart.find((l) => lineKey(l) === key);
    if (!line) return;
    const own = listPriceOf(line.item, line.unit);
    if (price < own && rules.supervisor.price && line.item.id !== rules.misc.itemId) {
      // for this item, at this price: the server holds the approval to both
      const subject = priceSubjectOf({ itemId: line.item.id, itemUnit: line.item.unit, unit: line.unit });
      const ok = await supervisor.ask('price', `${i18n.name(line.item.name)}: ${i18n.money(own, currency)} → ${i18n.money(price, currency)}`,
        { itemId: line.item.id, ...(line.unit ? { unit: line.unit } : {}), amount: price, currency });
      if (!ok) { setDialog(null); focusSearch(); return; }
      setApprovals((list) => [...list.filter((a) => !(a.action === 'price' && a.subject === subject)), { action: 'price', token: ok.token, subject, amount: price, currency }]);
    }
    setCart((c) => c.map((l) => (lineKey(l) === key ? { ...l, unitPrice: price } : l)));
    setDialog(null);
    focusSearch();
  };

  const lastLine = cart[cart.length - 1] ?? null;
  const scale = useMemo(() => readScaleSettings(), []);
  const scaleOn = scale.on && serialHere();
  const readScale = async () => {
    if (!lastLine || !isWeighedUnit(lastLine.unit ?? lastLine.item.unit)) { toast(t('tu_scaleNotWeighed')); return; }
    try {
      const kg = await readWeight(scale);
      const unit = lastLine.unit ?? lastLine.item.unit;
      const qtyMilli = Math.round((unit === 'g' ? kg * 1000 : kg) * 1000);
      setCart((c) => c.map((l) => (l === lastLine ? { ...l, qtyMilli } : l)));
      setFlash(lineKey(lastLine));
    } catch (e) {
      // what stood in the way: no port chosen, nothing came, or the weight did not settle (never a guessed weight)
      toast(t(scaleProblem(e)));
    } finally {
      focusSearch();
    }
  };

  const payRef = useRef(pay);
  payRef.current = pay;
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const clearRef = useRef(clear);
  clearRef.current = clear;
  const removeLastRef = useRef(() => { if (lastLine) void setQty(lineKey(lastLine), 0); });
  removeLastRef.current = () => { if (lastLine) void setQty(lineKey(lastLine), 0); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // a dialog over the sale (closing the shift, a new item, any other) keeps the keys to itself
      if (closing || addingItem !== null || dialog !== null || document.querySelector('.backdrop')) return;
      if (e.key === 'F1') { e.preventDefault(); setDialog('help'); }
      else if (e.key === 'F2') { e.preventDefault(); search.current?.focus(); }
      else if (e.key === 'F3') { e.preventDefault(); document.querySelector<HTMLElement>('.pos-customer input, .pos-customer button')?.focus(); }
      else if (e.key === 'F4') { e.preventDefault(); void clearRef.current(); }
      else if (e.key === 'F6') { e.preventDefault(); holdRef.current(); }
      else if (e.key === 'F7') { e.preventDefault(); if (lastLine) setDialog('qty'); }
      else if (e.key === 'F8') { e.preventDefault(); document.getElementById('pos-discount')?.querySelector('input')?.focus(); }
      else if (e.key === 'F9') { e.preventDefault(); void payRef.current(); }
      else if (e.key === 'F10' && receipt) { e.preventDefault(); void printReceipt(); }
      else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void payRef.current(true); }
      else if (e.key === 'Delete' && e.ctrlKey) { e.preventDefault(); removeLastRef.current(); }
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
  const quickSaves = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
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
    void quickSaves.current.then(() => reloadSettings()).finally(() => { setEditingQuick(false); focusSearch(); });
  };
  const customerOptions: PickOption[] = useMemo(() => customers.map((p) => ({ id: p.id, code: p.code, label: p.name, search: p.phone, hint: p.phone })), [customers]);
  const miscItem = rules.misc.itemId ? byId.get(rules.misc.itemId) ?? null : null;

  const sum: PaySummary = {
    subtotal, offerTotal, discount, total, points: points.value, vouchers, due, cashDue, cashRounded,
    offers: offerResult.offers.map((o) => {
      const rule = offerRules.find((r) => r.id === o.offerId);
      return { id: o.offerId, name: rule ? i18n.name(rule.names) : t('of_lineOffer'), discount: o.discount };
    })
  };
  const priceLine = typeof dialog === 'object' && dialog !== null && 'price' in dialog ? cart.find((l) => lineKey(l) === dialog.price) ?? null : null;

  return (
    <div className={'pos pos-v2' + (bigTiles ? ' pos-big' : '') + (prefs.touch ? ' pos-touch-mode' : '')} ref={tillRoot}>
      {expired.dialog}
      {supervisor.dialog}
      {addingItem !== null && <QuickItemForm typed={addingItem} sale warehouseId={shift.warehouseId} onDone={addedItem} onClose={() => { setAddingItem(null); focusSearch(); }} />}
      {controlled.dialog}
      <div className="visually-hidden" aria-live="polite" role="status">{said}</div>
      <StatusBar shift={shift} till={till} offline={offline} waiting={keptHere.length} held={held.length} drawer={drawerOnCash} onHeld={() => setShowHeld(true)} />
      <div className="pos-bar no-print">
        <div className="pos-search">
          <Icon name="search" size={24} />
          <input
            ref={search}
            className="input pos-search-input"
            value={q}
            placeholder={t('pos_searchPlaceholder')}
            aria-label={t('pos_searchPlaceholder')}
            autoComplete="off"
            onChange={(e) => { setQ(e.target.value); setNotFound(''); setNoRate(''); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); onEnter(); }
              if (e.key === 'Escape') { setQ(''); setNotFound(''); setNoRate(''); }
            }}
          />
          <span className="kbd">F2</span>
        </div>
        <div className="row pos-tools">
          {scaleOn && <button type="button" className="btn" onClick={() => void readScale()}><Icon name="scale" size={16} />{t('tu_scaleRead')}</button>}
          {miscItem && rules.misc.allowed && <button type="button" className="btn" onClick={() => setDialog('misc')}><Icon name="plus" size={16} />{t('tu_misc')}</button>}
          {/* a clothing shop: a model by size and colour, and an exchange (a return and a sale in one go) */}
          <TillClothingButtons shiftId={shift.id} currency={currency} items={items} disabled={busy} onPick={(item) => { add(item); focusSearch(); }}
            onExchanged={() => reloadShift()}
            {...(rules.supervisor.refund ? { beforeExchange: async (what: { invoiceId: string; lines: { lineNo: number; qtyMilli: number }[] }) => { const ok = await supervisor.ask('refund', undefined, what); if (ok) setRefundApproval(ok.token); return !!ok; } } : {})} />
          {/* a delivery order from this basket (market extras): the sale itself is made when it is delivered */}
          {!offline && <DeliveryFromTill partyId={partyId || null} warehouseId={shift.warehouseId} onSent={clearNow}
            lines={cart.map((l) => { const q = baseQtyOf(l); return { itemId: l.item.id, qtyMilli: q, unitPrice: q ? Math.round((lineTotal(l) * 1000) / q) : l.unitPrice }; })} />}
          <button type="button" className="btn" onClick={() => setDialog('more')} aria-haspopup="dialog"><Icon name="rows" size={16} />{t('tu_more')}</button>
          <button type="button" className="btn" onClick={() => setDialog('help')} title={t('tu_help')}><span className="kbd">F1</span></button>
        </div>
      </div>
      {notFound && (
        <div className="alert bad row no-print" role="alert" style={{ gap: 8 }}>
          <span>{t(addRowKind(notFound) === 'name' ? 'pos_noItemNamed' : 'pos_notFound', { n: notFound })}</span>
          {mayAdd && <><span className="spacer" /><button type="button" className="btn small" onClick={() => setAddingItem(notFound)}><Icon name="plus" size={15} />{addLabel(notFound)}</button></>}
        </div>
      )}
      {noRate && <div className="alert bad no-print" role="alert">{t('pos_noRate', { n: noRate })}</div>}

      <div className="pos-body" ref={tillBody} style={bodyHeight ? { height: bodyHeight } : undefined}>
        <section className="pos-items" aria-label={t('pos_items')}>
          <QuickRow items={quickItems} currency={currency} priceRate={priceRate} editing={editingQuick} mayEdit={mayEditQuick} canEdit={!offline}
            error={quickError} onPick={(it) => { add(it); focusSearch(); }} onEdit={editQuick} onMove={(id, step) => saveQuick(moveQuick(quickIds, id, step))} />
          {catList.length > 0 && <PosCategories list={catList} value={cat} onChange={setCat} />}
          <div className={'pos-grid' + (editingQuick ? ' pos-grid-editing' : '')}>
            {matches.map((it) => {
              const name = i18n.name(it.name);
              const out = it.trackStock && it.qtyMilli <= 0;
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

        <section className="pos-cart card" aria-label={t('pos_cart')}>
          <div className="pos-cart-head">
            <h3 style={{ margin: 0 }}>{t('pos_cart')} {cart.length > 0 && <span className="chip num">{t('tu_lines', { n: i18n.int(cart.length) })}</span>}</h3>
            <div className="tabs" role="group" aria-label={t('pos_currency')}>
              {(['IQD', 'USD'] as const).map((c) => (
                <button key={c} type="button" aria-pressed={currency === c} onClick={() => setCurrency(c)}>{c === 'IQD' ? t('pos_dinar') : t('pos_dollar')}</button>
              ))}
            </div>
          </div>
          {currency === 'USD' && (
            <label className="field pos-rate"><span>{t('pos_rate')}</span><input className="input num ltr" inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value)} />
              {dayRate && <small className="muted">{t('tu_rateToday', { r: String(rateFromX100(dayRate.referenceX100)) })}</small>}</label>
          )}
          <CartLines cart={cart} currency={currency} warehouseId={shift.warehouseId} offerByLine={offerResult.byLine} offerNames={offerNames} flash={flash} rxItems={rxItems}
            onQty={(k, n) => void setQty(k, n)} onUnit={nextUnit} onLine={setLine} onRemove={(k) => void setQty(k, 0)}
            onPrice={(k) => setDialog({ price: k })} />
          <div className="pos-subtotal">
            <span className="muted">{t('subtotal')}</span>
            <span className="num">{i18n.money(subtotal, currency)}</span>
          </div>
        </section>

        <PaymentPanel
          currency={currency} rateX100={rateX100} sum={sum}
          method={method} offered={offered} offline={offline} needsCustomer={needsCustomer} onCredit={onCredit} onPick={setPicked}
          cardMethods={cardMethods} split={split} splitBad={splitBad} onSplit={(m, v) => setSplit((s) => ({ ...s, [m]: v }))}
          handed={handed} onHanded={(v) => { setHanded(v); focusSearch(); }} handedUsd={handedUsd} onHandedUsd={setHandedUsd}
          usdRateText={usdRateText} onUsdRate={setUsdRateText} usdOn={usdOn} change={change}
          {...(dayRate ? { rateHint: t('tu_rateToday', { r: String(rateFromX100(dayRate.referenceX100)) }) } : {})}
          onDiscount={setDiscount}
          onVoucher={!offline && currency === 'IQD' && due > 0 ? () => setDialog('voucherPay') : null}
          onRemoveVoucher={(code) => setVouchers((v) => v.filter((x) => x.code !== code))}
          customer={(
            <div className="field pos-customer"><span>{t('pos_customer')} <span className="kbd">F3</span></span>
              <PartyPicker type="customer" value={partyId} options={customerOptions} priceList={false} placeholder={onCredit ? t('chooseCustomer') : t('pos_walkIn')} {...(onCredit ? {} : { emptyLabel: t('pos_walkIn') })}
                onChange={(v, p) => { setPartyId(v); if (p) keepCustomer(p); }} onCreated={keepCustomer} />
            </div>
          )}
          debt={debt && (debt.balance > 0 || debt.creditLimit !== null) ? (
            <div className={'pos-debt small' + (overLimit ? ' bad' : '')} role="status">
              {debt.balance > 0 && <span className="num">{t('tu_debt', { n: i18n.money(debt.balance, 'IQD') })}</span>}
              {debt.creditLimit !== null && <span className="num">{t('tu_limit', { n: i18n.money(debt.creditLimit, 'IQD') })}</span>}
              {overLimit && <strong>{t('tu_overLimit')}</strong>}
              {overLimit && rules.supervisor.creditOver && <span>{t('tu_creditOverHint')}</span>}
            </div>
          ) : null}
          loyalty={<LoyaltyUse partyId={partyId} total={total} currency={currency} value={points.points} onChange={(n, v) => setPoints({ points: n, value: v })} />}
          canPay={canPay} busy={busy} onPay={() => void pay()} onExact={() => void pay(true)} onClear={() => void clear()} onHold={hold} cartEmpty={cart.length === 0}
          keypad={prefs.touch ? (
            <div className="stack" style={{ gap: 6 }}>
              <div className="track" role="group" aria-label={t('tu_keypad')}>
                <button type="button" aria-pressed={pad?.target !== 'qty'} onClick={() => setPad({ target: 'cash', value: pad?.target === 'cash' ? pad.value : '' })}>{t('tu_padCash')}</button>
                <button type="button" aria-pressed={pad?.target === 'qty'} disabled={!lastLine} onClick={() => setPad({ target: 'qty', value: '' })}>{t('tu_padQty')}</button>
              </div>
              <Keypad value={pad?.value ?? ''} label={t('tu_keypad')} onChange={(value) => setPad({ target: pad?.target ?? 'cash', value })}
                onDone={() => {
                  const n = Number(pad?.value || 0);
                  if (pad?.target === 'qty' && lastLine && n > 0) void setQty(lineKey(lastLine), n * 1000);
                  else if (n > 0) setHanded(n);
                  setPad(null);
                }} />
            </div>
          ) : null}
          notes={(
            <>
              {unsure && (
                <div className="alert warn" role="alert">
                  {t('pos_unsure')}
                  <div><button type="button" className="btn" disabled={busy} onClick={() => { saleKey.current = null; setUnsure(false); setError(null); }}>{t('ob_unsureNotThere')}</button></div>
                </div>
              )}
              {shortNote && <div className="alert info small" role="status">{t('pos_offlineShort', { i: shortNote })}</div>}
              {shortNow && <div className="alert warn small" role="status">{t('pos_cartShort', { i: shortNow })}</div>}
            </>
          )}
          error={error}
          done={lastDone && !cart.length ? (
            <div className="pos-done" role="status">
              <div className="pos-done-head"><Icon name="check" size={22} /><strong>{t('tu_saleDone')}</strong>{lastDone.number && <span className="muted small ltr">{t('tu_receiptNo', { n: lastDone.number })}</span>}</div>
              <div className="pos-r-row"><span>{t('pos_total')}</span><strong className="num">{lastDone.total}</strong></div>
              {lastDone.change && <div className="pos-giveback"><span>{t('tu_changeDue')}</span><strong className="num">{lastDone.change}</strong></div>}
              {receipt && (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn" onClick={() => void printReceipt()}><Icon name="printer" size={16} />{t('print')} <span className="kbd">F10</span></button>
                  <ReceiptWhatsApp invoice={receipt} />
                </div>
              )}
              <button type="button" className="btn primary pos-touch" onClick={() => { setLastDone(null); focusSearch(); }}>{t('tu_newSale')}</button>
              <div className="muted small">{t('tu_newSaleHint')}</div>
            </div>
          ) : null}
        />
      </div>

      {receipt && <Receipt invoice={receipt} shift={shift} rounding={receiptRounding} />}
      {dialog === 'return' && (
        <TillReturnDialog shiftId={shift.id} needsSupervisor={rules.supervisor.refund} ask={(what) => supervisor.ask('refund', undefined, what)}
          onClose={() => { setDialog(null); focusSearch(); }}
          onDone={(back) => {
            setDialog(null);
            toast(t('ux_returnDone', { n: i18n.money(back.total, back.currency) }));
            reloadShift();
            openDrawerForSale();
            focusSearch();
          }} />
      )}
      {dialog === 'help' && <ShortcutsHelp onClose={() => { setDialog(null); focusSearch(); }} />}
      {dialog === 'qty' && lastLine && (
        <QtyDialog name={i18n.name(lastLine.item.name)} qtyMilli={lastLine.qtyMilli} weighed={isWeighedUnit(lastLine.unit ?? lastLine.item.unit)}
          onDone={(n) => { setDialog(null); void setQty(lineKey(lastLine), n); }} onClose={() => { setDialog(null); focusSearch(); }} />
      )}
      {priceLine && (
        <PriceDialog name={i18n.name(priceLine.item.name)} price={priceLine.unitPrice} currency={currency}
          onDone={(p) => void setPrice(lineKey(priceLine), p)} onClose={() => { setDialog(null); focusSearch(); }} />
      )}
      {dialog === 'misc' && miscItem && (
        <MiscDialog max={rules.misc.max} onClose={() => { setDialog(null); focusSearch(); }}
          onDone={(amount, note) => {
            setDialog(null);
            setMiscNotes((n) => [...n, `${i18n.name(miscItem.name)}: ${note}`]);
            add(miscItem, 1000, null, amount);
            focusSearch();
          }} />
      )}
      {dialog === 'voucherSell' && <VoucherSellDialog shiftId={shift.id} onSold={() => { reloadShift(); if (drawerOnCash) openDrawerForSale(); }} onClose={() => { setDialog(null); focusSearch(); }} />}
      {dialog === 'voucherPay' && (
        <VoucherPayDialog due={Math.max(0, due)} onClose={() => { setDialog(null); focusSearch(); }}
          onUse={(code, amount) => { setVouchers((v) => [...v.filter((x) => x.code !== code), { code, amount }]); setDialog(null); focusSearch(); }} />
      )}
      {dialog === 'more' && (
        <Modal title={t('tu_more')} onClose={() => { setDialog(null); focusSearch(); }}>
          <div className="pos-more">
            <label className="row"><input type="checkbox" checked={prefs.touch} onChange={(e) => setPrefs({ ...prefs, touch: e.target.checked })} /> <span>{t('tu_touch')}<div className="small muted">{t('tu_touchHelp')}</div></span></label>
            <label className="row"><input type="checkbox" checked={prefs.beep} onChange={(e) => setPrefs({ ...prefs, beep: e.target.checked })} /> {t('tu_beep')}</label>
            <hr />
            {!offline && <button type="button" className="btn" onClick={() => setDialog('voucherSell')}><Icon name="tag" size={16} />{t('tu_gvSell')}</button>}
            <button type="button" className="btn" onClick={() => openReturns()}><Icon name="undo" size={16} />{t('tu_returns')}</button>
            {drawerOnCash && <button type="button" className="btn" onClick={() => { setDialog(null); void noSale(); }}><Icon name="wallet" size={16} />{t('tl_noSale')}</button>}
            <CustomerScreenButtons onDone={() => setDialog(null)} />
            {held.length > 0 && <button type="button" className="btn" onClick={() => { setDialog(null); setShowHeld(true); }}><Icon name="clock" size={16} />{t('tl_held', { n: i18n.int(held.length) })}</button>}
            <a className="btn" href={href(`pos-shift/${shift.id}`)}><Icon name="doc" size={16} />{t('pos_xReport')}</a>
            <button type="button" className="btn" onClick={() => { setDialog(null); setClosing(true); }}><Icon name="logout" size={16} />{t('pos_closeShift')}</button>
          </div>
        </Modal>
      )}
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
