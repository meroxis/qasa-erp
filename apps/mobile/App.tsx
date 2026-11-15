import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, BackHandler, useColorScheme, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { getLocales } from 'expo-localization';
import { useFonts } from 'expo-font';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfficeError, officeApi, type Party, type Warehouse } from './src/api';
import type { CartLine, CountLine } from './src/documents';
import { explainWith } from './src/explain';
import { FONT_SOURCES } from './src/fonts';
import { isRtl, translate, type Key, type Lang } from './src/i18n';
import type { IconName } from './src/icons';
import { LinkError, OfficeLink, type LinkState, type OfficeInfo, type Route as LinkRoute, type SocketLike } from './src/link';
import { ListsCtx, type Lists } from './src/lists';
import { shouldLock, type LockSettings } from './src/lock';
import { canGoBack, current, initialNav, navigate, type Tab } from './src/nav';
import { forgetOffice, officeScope, setOfficeScope } from './src/office-cache';
import { Outbox, receiptPosted, type OutboxItem, type OutboxKind, type OutboxSummary } from './src/outbox';
import { sendItem } from './src/send';
import { cleanTemporaryFiles, sweepShared } from './src/staff/files';
import type { StockLine } from './src/staff/stock';
import { ExpenseScreen } from './src/screens/staff/expense';
import { InvoiceScreen, InvoicesScreen } from './src/screens/staff/invoices';
import { ShareScreen } from './src/screens/staff/share';
import { TransferScreen } from './src/screens/staff/transfer';
import { ReceiveOrderScreen, ReceiveScreen } from './src/screens/staff/receive';
import { readPairingCode } from './src/pairing';
import { toB64, type KeyPair } from './src/protocol';
import { featuresOf, lockRequired, type Feature, type Me } from './src/roles';
import {
  loadLang, loadLock, loadMe, loadName, loadOffice, loadTheme, outboxStorage, phoneKey, saveLang, saveLock, saveMe, saveName, saveOffice, saveTheme, wipePairing
} from './src/store';
import { PALETTES, radius, space, type ThemeChoice } from './src/theme';
import { Ctx, LookCtx, TabBar, Txt, useLook, type AppCtx, type Look } from './src/ui';
import { CollectScreen, CustomerScreen, CustomersScreen, StatementScreen } from './src/screens/customers';
import { Home } from './src/screens/home';
import { CountScreen, ItemScreen, ItemsScreen, NewItemScreen, ScanScreen } from './src/screens/items';
import { biometricReady, LockScreen } from './src/screens/lock';
import { AboutScreen, MoreScreen, OutboxScreen, PrefsCtx, SecurityScreen, type Prefs } from './src/screens/more';
import { ApprovalScreen, ApprovalsScreen } from './src/screens/owner/approvals';
import { DayCloseScreen } from './src/screens/owner/dayclose';
import { RateScreen } from './src/screens/owner/rate';
import { PairScreen } from './src/screens/pair';
import { CartScreen } from './src/screens/sell';

const APP_JSON = require('./app.json') as { expo: { version: string; android: { versionCode: number } } };
const VERSION: string = APP_JSON.expo.version;
/** this app's version and build, as the office PC shows them for each phone (prebuild writes both from app.json) */
const APP = { version: VERSION, build: APP_JSON.expo.android.versionCode };
const socket = (url: string) => new WebSocket(url) as unknown as SocketLike;
const NO_LOCK: LockSettings = { pin: null, length: 0, biometric: false, after: 60_000 };

function deviceLanguage(): Lang {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return code === 'ar' ? 'ar' : code === 'ckb' || code === 'ku' ? 'ku' : 'en';
}

export default function App() {
  return <SafeAreaProvider><Main /></SafeAreaProvider>;
}

function Main() {
  const system = useColorScheme();
  const [fontsLoaded, fontError] = useFonts(FONT_SOURCES);
  const [lang, setLangState] = useState<Lang>('en');
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>('system');
  const [key, setKey] = useState<KeyPair | null>(null);
  const [office, setOffice] = useState<OfficeInfo | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [me, setMe] = useState<Me | null>(null);
  const [lock, setLockState] = useState<LockSettings | null>(null);
  const [locked, setLocked] = useState(true);
  const [bioReady, setBioReady] = useState(false);
  const [link, setLink] = useState<OfficeLink | null>(null);
  const [state, setState] = useState<LinkState>('offline');
  const [via, setVia] = useState<LinkRoute | null>(null);
  const [detail, setDetail] = useState<string | undefined>();
  const [pairNote, setPairNote] = useState<string | null>(null);
  const [nav, dispatch] = useReducer(navigate, undefined, initialNav);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const outbox = useMemo(() => new Outbox(outboxStorage, setItems), []);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Party | null>(null);
  const [count, setCount] = useState<CountLine[]>([]);
  const [transfer, setTransfer] = useState<StockLine[]>([]);
  const [transferWarehouses, setTransferWarehouses] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [arrival, setArrival] = useState<{ orderId: string; lines: StockLine[] } | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [toastText, setToastText] = useState<{ text: string; kind: 'ok' | 'bad' | 'plain' } | null>(null);
  const backgroundSince = useRef<number | null>(null);

  const scheme = themeChoice === 'system' ? (system === 'dark' ? 'dark' : 'light') : themeChoice;
  const t = useCallback((k: Key, vars?: Record<string, string | number>) => translate(lang, k, vars), [lang]);
  const look: Look = useMemo(() => ({ lang, rtl: isRtl(lang), scheme, p: PALETTES[scheme], fonts: fontsLoaded && !fontError, t }), [lang, scheme, fontsLoaded, fontError, t]);
  // (a refusal of the phone reads by what the office says it offers: me.phoneLink, explain.ts)
  const explain = useCallback((e: unknown) => explainWith(t, e, me), [t, me]);

  // first start: language, look, the lock, the outbox, this phone's key, the office and who the phone acts as there
  useEffect(() => {
    // a photo or a shared PDF left from the last run (the app was closed before it cleaned up)
    cleanTemporaryFiles();
    void (async () => {
      setLangState((await loadLang()) ?? deviceLanguage());
      setThemeChoice(await loadTheme());
      setName((await loadName()) ?? '');
      setMe(await loadMe());
      const l = await loadLock();
      setLocked(!!l.pin);
      setLockState(l);
      setBioReady(await biometricReady());
      await outbox.load().catch(() => []);
      setKey(await phoneKey());
      setOffice(await loadOffice());
    })();
  }, [outbox]);

  const makeLink = useCallback((info: OfficeInfo, phone: KeyPair, phoneName: string, pairing?: { id: string; secret: Uint8Array }) => {
    const l = new OfficeLink({
      office: info, phone, name: phoneName, pairing, socket, app: APP,
      onState: (st, d, v) => { setState(st); setDetail(d); setVia(v ?? null); },
      onPaired: (deviceId, company) => {
        const saved = { ...info, deviceId, company: company || info.company };
        void saveOffice(saved);
        setOffice(saved);
      }
    });
    setLink((old) => { old?.close(); return l; });
    return l;
  }, []);

  // a paired phone connects at start
  useEffect(() => {
    if (office?.deviceId && key && !link) void makeLink(office, key, name || 'Phone').connect().catch(() => {});
  }, [office, key, link, name, makeLink]);

  const api = useMemo(() => (link ? officeApi(link) : null), [link]);

  // what screens keep in memory of the office belongs to the office paired now (office-cache.ts): another office, or
  // none, forgets it
  useEffect(() => { setOfficeScope(officeScope(office)); }, [office]);

  /** One change from the outbox to the office, with its own key (`last` keeps the office's answer for the screen). */
  const sender = useCallback((last?: { e: unknown; b?: unknown }) => async (item: OutboxItem, blob: () => Promise<string | null>): Promise<unknown> => {
    if (!api) throw new LinkError('closed');
    try {
      const answer = await sendItem(api, item, blob);
      if (last) last.b = answer;
      return answer;
    } catch (e) {
      if (last) last.e = e;
      throw e;
    }
  }, [api]);

  // what waited goes by itself; receipts (and expenses) that went say what the office made of them (and stay under
  // Waiting to send)
  const replay = useCallback(() => {
    if (!api) return;
    void outbox.replay(sender()).then((r) => {
      if (r.receipts.length) {
        const waits = r.receipts.filter((i) => i.result === 'waiting').length;
        setToastText({ text: waits ? t('receiptsSentWaiting', { n: waits }) : t('receiptsSentPosted', { n: r.receipts.length }), kind: 'ok' });
      } else if (r.expenses.length) setToastText({ text: t('expSentN', { n: r.expenses.length }), kind: 'ok' });
    }).catch(() => {});
  }, [api, outbox, sender, t]);

  // whenever the link comes up: who the phone acts as now (the admin may have changed the role), the warehouses,
  // and what waits in the outbox
  const refreshMe = useCallback(() => {
    if (!api) return;
    void api.me().then((m) => { setMe(m); void saveMe(m); }).catch(() => {});
  }, [api]);
  useEffect(() => {
    if (state !== 'online' || !api) return;
    refreshMe();
    void api.warehouses().then((w) => {
      const active = w.filter((x) => x.active);
      setWarehouses(active);
      setWarehouseId((id) => (id && active.some((x) => x.id === id) ? id : active[0]?.id ?? null));
    }).catch(() => {});
    replay();
  }, [state, api, refreshMe, replay]);

  // the app in the background: no tries to connect; back on the screen: locked if it was away long enough, connect
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        if (lock?.pin && shouldLock(backgroundSince.current, Date.now(), lock.after)) setLocked(true);
        backgroundSince.current = null;
        // the last PDF shared goes once the app it was handed to has had time to read it
        sweepShared();
        link?.resume();
      } else if (s === 'background') {
        backgroundSince.current = Date.now();
        link?.pause();
      }
    });
    return () => sub.remove();
  }, [link, lock]);

  // Android's back: up the screens, then home, then out of the app
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack(nav)) return false;
      dispatch({ type: 'back' });
      return true;
    });
    return () => sub.remove();
  }, [nav]);

  const toast = useCallback((text: string, kind: 'ok' | 'bad' | 'plain' = 'plain') => setToastText({ text, kind }), []);
  useEffect(() => {
    if (!toastText) return;
    const timer = setTimeout(() => setToastText(null), 2500);
    return () => clearTimeout(timer);
  }, [toastText]);

  /** Unpairing (or a forgotten PIN): the office is told when it can be, then everything the phone keeps is wiped. */
  const unpair = useCallback(async () => {
    await link?.unpair().catch(() => false);
    setLink(null);
    await outbox.wipe();
    forgetOffice();
    await wipePairing();
    setOffice(null);
    setMe(null);
    setCart([]);
    setCount([]);
    setTransfer([]);
    setArrival(null);
    setCustomer(null);
    setLockState(NO_LOCK);
    setLocked(false);
    setKey(await phoneKey());
    dispatch({ type: 'open', tab: 'home' });
  }, [link, outbox]);

  // the office removed this phone: pair again (what waits in the outbox stays, and goes once paired again)
  useEffect(() => {
    if (detail !== 'unknown_device' || !office) return;
    link?.close();
    setLink(null);
    setOffice(null);
    setPairNote(t('unknownDevice'));
    void saveOffice({ ...office, deviceId: null });
  }, [detail, office, link, t]);

  const setLang = useCallback((l: Lang) => { setLangState(l); void saveLang(l); }, []);
  const features = useMemo(() => featuresOf(me), [me]);
  const can = useCallback((f: Feature) => features.has(f), [features]);

  const ctx: AppCtx | null = useMemo(() => {
    if (!api) return null;
    /** A change for the office: kept (encrypted) before the first try, then sent with its own key; see AppCtx.queueFor. */
    const queueFor = async (kind: OutboxKind, body: unknown, summary: OutboxSummary, target?: string, blob?: string) => {
      // kept before the first try: nothing is lost if the answer never comes
      const item = await outbox.add(kind, body, summary, target, blob);
      const last: { e: unknown; b?: unknown } = { e: null };
      const outcome = await outbox.sendOne(item.id, sender(last));
      if (outcome === 'sent') return { result: (kind === 'receipt' || kind === 'expense') && receiptPosted(last.b) ? 'posted' as const : 'sent' as const, answer: last.b };
      if (outcome === 'wait') return { result: 'queued' as const, answer: null };
      // refused at once, on the screen that made it: shown there, not kept
      await outbox.remove(item.id);
      throw last.e instanceof OfficeError ? last.e : new OfficeError(400, outcome.refused, null);
    };
    return {
      api, state, via, detail, company: office?.company ?? '', me, can, outbox: items,
      async queue(kind: OutboxKind, body: unknown, summary: OutboxSummary, target?: string) {
        return (await queueFor(kind, body, summary, target)).result;
      },
      queueFor,
      sendOutbox: () => { link?.resume(); replay(); },
      retryOutbox: async (id) => { await outbox.retry(id); replay(); },
      deleteOutbox: (id) => outbox.remove(id),
      nav: dispatch,
      go: (route) => dispatch({ type: 'push', route }),
      back: () => dispatch({ type: 'back' }),
      reconnect: () => { link?.resume(); },
      explain, toast, refreshMe
    };
  }, [api, state, via, detail, office, me, can, items, outbox, sender, link, replay, explain, toast, refreshMe]);

  const prefs: Prefs = {
    theme: themeChoice,
    setTheme: (c) => { setThemeChoice(c); void saveTheme(c); },
    setLang,
    lock: lock ?? NO_LOCK,
    setLock: async (l) => { setLockState(l); await saveLock(l); },
    biometricReady: bioReady,
    unpair,
    version: VERSION
  };

  const lists: Lists = {
    cart, setCart, customer, setCustomer, count, setCount, warehouseId, setWarehouseId, warehouses,
    transfer, setTransfer, transferWarehouses, setTransferWarehouses, arrival, setArrival
  };
  const bar = <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
  const spinner = <View style={{ flex: 1, justifyContent: 'center', backgroundColor: look.p.bg }}><ActivityIndicator color={look.p.accent} /></View>;

  if (office === undefined || !key || !lock) return <LookCtx.Provider value={look}>{bar}{spinner}</LookCtx.Provider>;

  if (lock.pin && locked) {
    return (
      <LookCtx.Provider value={look}>
        {bar}
        <LockScreen pinHash={lock.pin} length={lock.length} biometric={lock.biometric && bioReady} onUnlock={() => setLocked(false)} onForgot={unpair} />
      </LookCtx.Provider>
    );
  }

  // not paired yet (or the office removed this phone): pair with the QR code
  if (!office?.deviceId) {
    return (
      <LookCtx.Provider value={look}>
        {bar}
        <PairScreen
          name={name}
          setName={setName}
          setLang={setLang}
          note={pairNote}
          onCode={async (text) => {
            const code = readPairingCode(text);
            if (!code) throw new Error(t('notPairCode'));
            const info: OfficeInfo = { serverKey: toB64(code.serverPublicKey), addresses: code.addresses, port: code.port, relay: code.relay, deviceId: null, company: code.company };
            const phoneName = name.trim().slice(0, 80) || 'Phone';
            await saveName(phoneName);
            const pairing = makeLink(info, key, phoneName, { id: code.pairingId, secret: code.pairingSecret });
            try {
              await pairing.connect();
              setPairNote(null);
              setDetail(undefined);
            } catch (e) {
              // not paired: this link (and its one-time secret) is dropped, not tried again in the background
              pairing.close();
              setLink((l) => (l === pairing ? null : l));
              throw new Error(explain(e));
            }
          }}
        />
      </LookCtx.Provider>
    );
  }

  if (!ctx) return <LookCtx.Provider value={look}>{bar}{spinner}</LookCtx.Provider>;

  const route = current(nav);
  // a phone acting as an admin or a user who sees the figures keeps a PIN: nothing else opens until it has one
  const pinNeeded = lockRequired(me) && !lock.pin;
  const tabs: { tab: Tab; icon: IconName; label: string; badge?: number; on: boolean }[] = [
    { tab: 'home', icon: 'home', label: t('tabHome'), on: true },
    { tab: 'items', icon: 'box', label: t('tabItems'), on: can('lookup') },
    { tab: 'sell', icon: 'cart', label: t('tabSell'), badge: cart.length, on: can('sale') || can('order') },
    { tab: 'customers', icon: 'users', label: t('tabCustomers'), on: can('statement') || can('collect') },
    { tab: 'more', icon: 'more', label: t('tabMore'), badge: items.length, on: true }
  ];

  return (
    <LookCtx.Provider value={look}>
      <Ctx.Provider value={ctx}>
        <PrefsCtx.Provider value={prefs}>
          <ListsCtx.Provider value={lists}>
            {bar}
            <View style={{ flex: 1, backgroundColor: look.p.bg }}>
              {pinNeeded ? <View style={{ flex: 1 }}><SecurityScreen required /></View> : <View style={{ flex: 1 }}>
                {route.name === 'home' && <Home />}
                {route.name === 'items' && <ItemsScreen />}
                {route.name === 'scan' && <ScanScreen purpose={route.purpose} />}
                {route.name === 'item' && <ItemScreen key={`${route.code}-${route.itemId ?? ''}`} code={route.code} itemId={route.itemId} purpose={route.purpose} />}
                {route.name === 'newItem' && <NewItemScreen barcode={route.barcode} />}
                {route.name === 'count' && <CountScreen />}
                {route.name === 'cart' && <CartScreen />}
                {route.name === 'customers' && <CustomersScreen pick={route.pick} />}
                {route.name === 'customer' && <CustomerScreen id={route.id} />}
                {route.name === 'statement' && <StatementScreen id={route.id} />}
                {route.name === 'collect' && <CollectScreen id={route.id} />}
                {route.name === 'more' && <MoreScreen />}
                {route.name === 'outbox' && <OutboxScreen />}
                {route.name === 'security' && <SecurityScreen />}
                {route.name === 'about' && <AboutScreen />}
                {/* phone app 1.1, the owner and the managers */}
                {route.name === 'approvals' && <ApprovalsScreen />}
                {route.name === 'approval' && <ApprovalScreen key={route.id} id={route.id} />}
                {route.name === 'rate' && <RateScreen />}
                {route.name === 'dayClose' && <DayCloseScreen />}
                {/* and the staff */}
                {route.name === 'expense' && <ExpenseScreen />}
                {route.name === 'invoices' && <InvoicesScreen partyId={route.partyId} />}
                {route.name === 'invoice' && <InvoiceScreen id={route.id} />}
                {route.name === 'share' && <ShareScreen key={`${route.doc}-${route.id}`} doc={route.doc} id={route.id} from={route.from} />}
                {route.name === 'transfer' && <TransferScreen />}
                {route.name === 'receive' && <ReceiveScreen />}
                {route.name === 'receiveOrder' && <ReceiveOrderScreen key={route.id} id={route.id} />}
              </View>}
              {route.name !== 'scan' && !pinNeeded && (
                <TabBar tabs={tabs.filter((x) => x.on)} current={nav.tab} onPress={(tab) => dispatch({ type: 'tab', tab })} />
              )}
              {toastText ? <Toast text={toastText.text} kind={toastText.kind} above={route.name !== 'scan'} /> : null}
            </View>
          </ListsCtx.Provider>
        </PrefsCtx.Provider>
      </Ctx.Provider>
    </LookCtx.Provider>
  );
}

/** A short message over the bottom of the screen (read out by the screen reader). */
function Toast({ text, kind, above = false }: { text: string; kind: 'ok' | 'bad' | 'plain'; above?: boolean }) {
  const { p } = useLook();
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }).start(); }, [fade]);
  return (
    <Animated.View pointerEvents="none" accessibilityLiveRegion="polite" accessibilityRole="alert"
      style={{ position: 'absolute', start: space.l, end: space.l, bottom: insets.bottom + (above ? 76 : space.l), opacity: fade, backgroundColor: kind === 'bad' ? p.badBg : p.brand, borderRadius: radius.m, paddingHorizontal: space.l, paddingVertical: space.m, borderWidth: 1, borderColor: kind === 'bad' ? p.bad : p.brand }}>
      <Txt v="bodyStrong" tone={kind === 'bad' ? 'bad' : 'onBrand'} style={{ textAlign: 'center' }}>{text}</Txt>
    </Animated.View>
  );
}
