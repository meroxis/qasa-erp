import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { getLocales } from 'expo-localization';
import { OfficeError, officeApi } from './src/api';
import { isRtl, translate, type Key, type Lang } from './src/i18n';
import { LinkError, OfficeLink, type LinkState, type OfficeInfo, type SocketLike } from './src/link';
import { decodePairingCode, toB64, type KeyPair } from './src/protocol';
import {
  CartScreen, CountScreen, Home, ItemScreen, ListsCtx, NewItemScreen, Scanner, ScanScreen, SearchScreen, SettingsScreen,
  type CartLine, type CountLine
} from './src/screens';
import {
  forgetOffice, loadLang, loadName, loadOffice, loadOutbox, phoneKey, saveLang, saveName, saveOffice, saveOutbox, type OutboxItem
} from './src/store';
import { Button, Ctx, Field, Note, Page, type AppCtx, type Screen } from './src/ui';

const socket = (url: string) => new WebSocket(url) as unknown as SocketLike;

function deviceLanguage(): Lang {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return code === 'ar' ? 'ar' : code === 'ckb' || code === 'ku' ? 'ku' : 'en';
}

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [key, setKey] = useState<KeyPair | null>(null);
  const [office, setOffice] = useState<OfficeInfo | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [link, setLink] = useState<OfficeLink | null>(null);
  const [state, setState] = useState<LinkState>('offline');
  const [stateDetail, setStateDetail] = useState<string | undefined>();
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [count, setCount] = useState<CountLine[]>([]);

  const t = useCallback((k: Key, vars?: Record<string, string | number>) => translate(lang, k, vars), [lang]);

  // first start: language, this phone's key, the office it is paired with, the outbox
  useEffect(() => {
    void (async () => {
      setLang((await loadLang()) ?? deviceLanguage());
      setKey(await phoneKey());
      setName((await loadName()) ?? '');
      setOutbox(await loadOutbox());
      setOffice(await loadOffice());
    })();
  }, []);

  const makeLink = useCallback((info: OfficeInfo, phone: KeyPair, phoneName: string, pairing?: { id: string; secret: Uint8Array }) => {
    const l = new OfficeLink({
      office: info, phone, name: phoneName, pairing, socket,
      onState: (st, detail) => { setState(st); setStateDetail(detail); },
      onPaired: (deviceId, company) => {
        const saved = { ...info, deviceId, company };
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
  }, [office, key, link]);

  // the outbox is sent again whenever the link comes up
  const flushing = useRef(false);
  useEffect(() => {
    if (state !== 'online' || !link || flushing.current || !outbox.some((o) => !o.error)) return;
    flushing.current = true;
    void (async () => {
      const api = officeApi(link);
      let list = [...outbox];
      for (const item of outbox.filter((o) => !o.error)) {
        try {
          if (item.kind === 'sale') await api.draftSale(item.body);
          else await api.sendCount(item.body);
          list = list.filter((o) => o.id !== item.id);
        } catch (e) {
          // the office refused it (not a lost connection): kept with the reason instead of sent again forever
          if (e instanceof OfficeError && e.status < 500 && e.status !== 429) list = list.map((o) => (o.id === item.id ? { ...o, error: e.code } : o));
          else break;
        }
      }
      setOutbox(list);
      saveOutbox(list);
      flushing.current = false;
    })();
  }, [state, link]);

  const explain = useCallback((error: unknown): string => {
    if (error instanceof OfficeError) {
      if (error.status === 403) return t('forbidden');
      if (error.code === 'plan_limit') return t('planLimit');
      return `${t('error')} ${error.code}`;
    }
    if (error instanceof LinkError) {
      const map: Partial<Record<LinkError['code'], Key>> = {
        unreachable: 'offline', timeout: 'offline', closed: 'offline', plan_limit: 'planLimit', phone_limit: 'phoneLimit',
        pairing_invalid: 'pairingInvalid', unknown_device: 'unknownDevice', stale: 'stale'
      };
      const k = map[error.code];
      return k ? t(k) : `${t('error')} ${error.code}`;
    }
    return `${t('error')} ${String(error)}`;
  }, [t]);

  const ctx: AppCtx | null = useMemo(() => {
    if (!link) return null;
    const api = officeApi(link);
    return {
      lang, rtl: isRtl(lang), t, api, state, company: office?.company ?? '', queued: outbox.filter((o) => !o.error).length,
      go: setScreen, explain,
      async queue(kind, body) {
        try {
          if (kind === 'sale') await api.draftSale(body);
          else await api.sendCount(body);
          return 'sent';
        } catch (e) {
          // no connection: kept on the phone and sent when the office is back
          if (e instanceof LinkError) {
            const item: OutboxItem = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, kind, body, createdAt: new Date().toISOString() };
            const list = [...outbox, item];
            setOutbox(list);
            saveOutbox(list);
            return 'queued';
          }
          throw e;
        }
      }
    };
  }, [lang, t, state, office, outbox, explain, link]);

  if (office === undefined || !key) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;

  // not paired yet (or the office removed this phone): pair with the QR code
  if (!office?.deviceId || stateDetail === 'unknown_device') {
    return (
      <PairScreen
        lang={lang}
        name={name}
        setName={setName}
        onCode={async (text) => {
          const code = decodePairingCode(text);
          if (!code) throw new Error(translate(lang, 'notPairCode'));
          const info: OfficeInfo = { serverKey: toB64(code.serverPublicKey), addresses: code.addresses, port: code.port, relay: code.relay, deviceId: null, company: code.company };
          const phoneName = name.trim() || 'Phone';
          await saveName(phoneName);
          await makeLink(info, key, phoneName, { id: code.pairingId, secret: code.pairingSecret }).connect();
          setStateDetail(undefined);
        }}
      />
    );
  }
  if (!ctx) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;

  return (
    <Ctx.Provider value={ctx}>
      <ListsCtx.Provider value={{ cart, setCart, count, setCount }}>
        <StatusBar style="light" />
        {screen.name === 'home' && <Home />}
        {screen.name === 'scan' && <ScanScreen purpose={screen.purpose} />}
        {screen.name === 'item' && <ItemScreen code={screen.code} itemId={screen.itemId} purpose={screen.purpose} />}
        {screen.name === 'newItem' && <NewItemScreen barcode={screen.barcode} />}
        {screen.name === 'search' && <SearchScreen />}
        {screen.name === 'cart' && <CartScreen />}
        {screen.name === 'count' && <CountScreen />}
        {screen.name === 'settings' && (
          <SettingsScreen
            onLang={(l) => { setLang(l); void saveLang(l); }}
            onUnpair={() => {
              link?.close();
              setLink(null);
              void forgetOffice();
              setOffice(null);
              setScreen({ name: 'home' });
            }}
          />
        )}
      </ListsCtx.Provider>
    </Ctx.Provider>
  );
}

/** Before pairing: the phone's name and the camera for the QR code on the office PC. */
function PairScreen({ lang, name, setName, onCode }: { lang: Lang; name: string; setName(v: string): void; onCode(text: string): Promise<void> }) {
  const t = (k: Key) => translate(lang, k);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the shared screen parts read the app context: a stand-in until there is a link
  const ctx: AppCtx = {
    lang, rtl: isRtl(lang), t: (k, vars) => translate(lang, k, vars), state: 'offline', company: '', queued: 0, go: () => {},
    explain: (e) => String(e), queue: async () => 'queued', api: null as never
  };
  return (
    <Ctx.Provider value={ctx}>
      <StatusBar style="light" />
      {scanning ? (
        <Scanner
          purpose="pair"
          title={t('pair')}
          onBack={() => setScanning(false)}
          onCode={(text) => {
            setScanning(false);
            setBusy(true);
            setError(null);
            onCode(text).catch((e: unknown) => {
              const code = e instanceof LinkError ? e.code : null;
              const k: Key | null = code === 'pairing_invalid' ? 'pairingInvalid' : code === 'phone_limit' ? 'phoneLimit' : code === 'plan_limit' ? 'planLimit'
                : code === 'stale' ? 'stale' : code === 'unreachable' || code === 'timeout' ? 'offline' : null;
              setError(k ? t(k) : e instanceof Error ? e.message : String(e));
            }).finally(() => setBusy(false));
          }}
        />
      ) : (
        <Page title={t('appName')}>
          <Note text={t('welcome')} />
          <Note text={t('pairHelp')} />
          <Field label={t('phoneName')} value={name} onChangeText={setName} placeholder="Samsung A54" />
          {error && <Note kind="bad" text={error} />}
          <Button label={t('pair')} onPress={() => setScanning(true)} busy={busy} />
        </Page>
      )}
    </Ctx.Provider>
  );
}
