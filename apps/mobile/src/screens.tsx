import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { exactMatch, type Currency, type Item, type ItemDetail, type Party, type PartHit, type Settings, type Warehouse } from './api';
import { money, nameIn, LANGS, type Lang } from './i18n';
import { Button, Card, colors, Field, Note, Page, s, useApp } from './ui';

// ——— the sale cart and the stock count, kept by the app while it runs ———

export interface CartLine { item: Item; qty: number }
export interface CountLine { item: Item; qty: number }

export interface Lists {
  cart: CartLine[];
  setCart(lines: CartLine[]): void;
  count: CountLine[];
  setCount(lines: CountLine[]): void;
}
export const ListsCtx = createContext<Lists | null>(null);
const useLists = () => useContext(ListsCtx)!;

const BARCODES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'codabar', 'qr', 'datamatrix'];

// ——— home ———

export function Home() {
  const { t, go, state, company, queued } = useApp();
  return (
    <Page title={company || t('appName')}>
      {state !== 'online' && <Note kind={state === 'refused' ? 'bad' : 'plain'} text={state === 'connecting' ? t('connecting') : t('offline')} />}
      {queued > 0 && <Note text={t('queued', { n: queued })} />}
      <Button label={t('scan')} onPress={() => go({ name: 'scan', purpose: 'look' })} />
      <Button kind="plain" label={t('search')} onPress={() => go({ name: 'search' })} />
      <Button kind="plain" label={t('cart')} onPress={() => go({ name: 'cart' })} />
      <Button kind="plain" label={t('count')} onPress={() => go({ name: 'count' })} />
      <Button kind="plain" label={t('settings')} onPress={() => go({ name: 'settings' })} />
    </Page>
  );
}

// ——— the camera ———

export function Scanner({ purpose, title, onCode, onBack }: { purpose?: string; title: string; onCode(code: string): void; onBack(): void }) {
  const { t } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const last = useRef<{ code: string; at: number } | null>(null);
  if (!permission) return <Page title={title} onBack={onBack}><Note text={t('connecting')} /></Page>;
  if (!permission.granted) {
    return (
      <Page title={title} onBack={onBack}>
        <Note text={t('cameraNeeded')} />
        <Button label={t('allowCamera')} onPress={() => void requestPermission()} />
      </Page>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: BARCODES }}
        onBarcodeScanned={(r) => {
          const now = Date.now();
          // the camera reports the same code many times a second: once per 2 seconds
          if (last.current && last.current.code === r.data && now - last.current.at < 2000) return;
          last.current = { code: r.data, at: now };
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onCode(r.data);
        }}
      />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, gap: 12, backgroundColor: 'rgba(15,42,61,0.85)' }}>
        <Text style={{ color: '#fff', fontSize: 18, textAlign: 'center' }}>{purpose === 'pair' ? t('scanPairCode') : t('pointCamera')}</Text>
        <Button kind="plain" label={t('back')} onPress={onBack} />
      </View>
    </View>
  );
}

export function ScanScreen({ purpose }: { purpose: 'look' | 'cart' | 'count' }) {
  const { t, go } = useApp();
  return <Scanner title={t('scan')} onBack={() => go({ name: purpose === 'cart' ? 'cart' : purpose === 'count' ? 'count' : 'home' })} onCode={(code) => go({ name: 'item', code, purpose })} />;
}

// ——— an item: price, stock, shelf, picture ———

export function ItemScreen({ code, itemId, purpose }: { code: string; itemId?: string | undefined; purpose: 'look' | 'cart' | 'count' }) {
  const { t, lang, api, go, explain } = useApp();
  const lists = useLists();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [part, setPart] = useState<PartHit | null>(null);
  const [picture, setPicture] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState('1');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const id = itemId ?? exactMatch(await api.items(code), code)?.id;
        if (!id) { if (live) setMissing(true); return; }
        const detail = await api.item(id);
        if (!live) return;
        setItem(detail);
        void api.part(id).then((p) => live && setPart(p)).catch(() => {});
        void api.image(id).then((p) => live && setPicture(p)).catch(() => {});
      } catch (e) {
        if (live) setError(explain(e));
      }
    })();
    return () => { live = false; };
  }, [code, itemId]);

  const back = () => go({ name: purpose === 'cart' ? 'cart' : purpose === 'count' ? 'count' : 'home' });
  if (error) return <Page title={code} onBack={back}><Note kind="bad" text={error} /></Page>;
  if (missing) {
    return (
      <Page title={code} onBack={back}>
        <Note text={`${t('notFound')} ${code}`} />
        <Button label={t('addItem')} onPress={() => go({ name: 'newItem', barcode: code })} />
        <Button kind="plain" label={t('scanNext')} onPress={() => go({ name: 'scan', purpose })} />
      </Page>
    );
  }
  if (!item) return <Page title={code} onBack={back}><Note text={t('connecting')} /></Page>;
  const n = Number(qty.replace(',', '.'));
  const add = () => {
    if (!(n > 0)) return;
    if (purpose === 'count') {
      const others = lists.count.filter((l) => l.item.id !== item.id);
      lists.setCount([{ item, qty: n }, ...others]);
    } else {
      const existing = lists.cart.find((l) => l.item.id === item.id);
      lists.setCart(existing ? lists.cart.map((l) => (l.item.id === item.id ? { ...l, qty: l.qty + n } : l)) : [{ item, qty: n }, ...lists.cart]);
    }
    go({ name: 'scan', purpose: purpose === 'look' ? 'cart' : purpose });
  };
  return (
    <Page title={nameIn(lang, item.name)} onBack={back}>
      <Card>
        {picture && <Image source={{ uri: picture }} style={{ width: '100%', height: 220, borderRadius: 12 }} resizeMode="contain" accessibilityIgnoresInvertColors />}
        <Text style={s.muted}>{item.code}{item.barcode ? ` · ${item.barcode}` : ''}</Text>
        <View style={s.between}><Text style={s.text}>{t('price')}</Text><Text style={s.big}>{money(item.salePrice, item.saleCurrency)}</Text></View>
        {part?.wholesalePrice != null && <View style={s.between}><Text style={s.text}>{t('wholesale')}</Text><Text style={s.text}>{money(part.wholesalePrice, item.saleCurrency)}</Text></View>}
        {part?.shelf ? <View style={s.between}><Text style={s.text}>{t('shelf')}</Text><Text style={[s.text, { fontWeight: '700' }]}>{part.shelf}</Text></View> : null}
      </Card>
      <Card>
        <Text style={[s.text, { fontWeight: '700' }]}>{t('stock')}</Text>
        {item.stock.map((w) => (
          <View key={w.warehouseId} style={s.between}>
            <Text style={s.text}>{nameIn(lang, w.warehouseName)}</Text>
            <Text style={[s.text, { fontWeight: '700' }]}>{(w.qtyMilli / 1000).toLocaleString('en-US')}</Text>
          </View>
        ))}
      </Card>
      {purpose !== 'look' && <Field label={t('qty')} value={qty} onChangeText={setQty} keyboardType="decimal-pad" />}
      {purpose === 'look' ? (
        <>
          <Button label={t('addToCart')} onPress={add} />
          <Button kind="plain" label={t('scanNext')} onPress={() => go({ name: 'scan', purpose: 'look' })} />
        </>
      ) : (
        <Button label={purpose === 'count' ? t('addToCount') : t('addToCart')} onPress={add} disabled={!(n > 0)} />
      )}
    </Page>
  );
}

// ——— a new item from a scanned barcode, with a photo ———

export function NewItemScreen({ barcode }: { barcode: string }) {
  const { t, lang, api, go, explain } = useApp();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<Currency>('IQD');
  const [unit, setUnit] = useState('piece');
  const [photo, setPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [shooting, setShooting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function shoot() {
    const shot = await camera.current?.takePictureAsync({ quality: 0.8 });
    if (!shot) return;
    // small enough for the office (≤ 800 px, JPEG): the same size the desktop app keeps
    const ref = await ImageManipulator.manipulate(shot.uri).resize({ width: 800 }).renderAsync();
    const saved = await ref.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
    if (saved.base64) setPhoto({ uri: saved.uri, base64: saved.base64 });
    setShooting(false);
  }

  async function save() {
    const minor = Math.round(Number(price.replace(/,/g, '')) * (currency === 'USD' ? 100 : 1));
    if (!name.trim() || !(minor >= 0)) return;
    setBusy(true);
    setError(null);
    try {
      const names = { ar: '', en: '', ku: '', [lang]: name.trim() } as { ar: string; en: string; ku: string };
      const item = await api.createItem({ name: names, barcode, unit, salePrice: minor, saleCurrency: currency });
      if (photo) await api.setImage(item.id, photo.base64);
      Alert.alert(t('saved'));
      go({ name: 'item', code: barcode, itemId: item.id, purpose: 'look' });
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }

  if (shooting) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView ref={camera} style={{ flex: 1 }} facing="back" />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, gap: 12 }}>
          <Button label={t('takePhoto')} onPress={() => void shoot()} />
          <Button kind="plain" label={t('back')} onPress={() => setShooting(false)} />
        </View>
      </View>
    );
  }
  return (
    <Page title={t('addItem')} onBack={() => go({ name: 'home' })}>
      <Field label={t('barcode')} value={barcode} editable={false} />
      <Field label={t('name')} value={name} onChangeText={setName} autoFocus />
      <Field label={t('price')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
      <View style={s.row}>
        {(['IQD', 'USD'] as Currency[]).map((c) => <View key={c} style={{ flex: 1 }}><Button kind={c === currency ? 'primary' : 'plain'} label={c} onPress={() => setCurrency(c)} /></View>)}
      </View>
      <Text style={s.label}>{t('unit')}</Text>
      <View style={[s.row, { flexWrap: 'wrap' }]}>
        {(['piece', 'box', 'carton', 'kg', 'm', 'service'] as const).map((u) => (
          <Pressable key={u} accessibilityRole="button" onPress={() => setUnit(u)} style={{ paddingHorizontal: 16, minHeight: 44, justifyContent: 'center', borderRadius: 10, borderWidth: 2, borderColor: unit === u ? colors.brand : colors.line, backgroundColor: unit === u ? colors.brand : '#fff' }}>
            <Text style={{ color: unit === u ? '#fff' : colors.text, fontSize: 16 }}>{t(u)}</Text>
          </Pressable>
        ))}
      </View>
      {photo && <Image source={{ uri: photo.uri }} style={{ width: '100%', height: 200, borderRadius: 12 }} resizeMode="contain" accessibilityIgnoresInvertColors />}
      <Button kind="plain" label={photo ? t('retake') : t('takePhoto')} onPress={() => { if (!permission?.granted) void requestPermission().then(() => setShooting(true)); else setShooting(true); }} />
      {error && <Note kind="bad" text={error} />}
      <Button label={t('save')} onPress={() => void save()} busy={busy} disabled={!name.trim() || !price.trim()} />
    </Page>
  );
}

// ——— search by name ———

export function SearchScreen() {
  const { t, lang, api, go, explain } = useApp();
  const [text, setText] = useState('');
  const [results, setResults] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (text.trim().length < 2) return;
    const timer = setTimeout(() => {
      api.items(text.trim()).then((r) => { setResults(r.slice(0, 50)); setError(null); }, (e) => setError(explain(e)));
    }, 350);
    return () => clearTimeout(timer);
  }, [text]);
  // results only for what is typed now (two letters or more)
  const shown = text.trim().length >= 2 ? results : null;
  return (
    <Page title={t('search')} onBack={() => go({ name: 'home' })}>
      <Field label={t('name')} value={text} onChangeText={setText} autoFocus />
      {error && <Note kind="bad" text={error} />}
      {shown && !shown.length && <Note text={t('nothing')} />}
      {shown?.map((i) => (
        <Pressable key={i.id} accessibilityRole="button" onPress={() => go({ name: 'item', code: i.barcode || i.code, itemId: i.id, purpose: 'look' })}>
          <Card>
            <Text style={[s.text, { fontWeight: '700' }]}>{nameIn(lang, i.name)}</Text>
            <View style={s.between}><Text style={s.muted}>{i.code}</Text><Text style={s.text}>{money(i.salePrice, i.saleCurrency)}</Text></View>
          </Card>
        </Pressable>
      ))}
    </Page>
  );
}

// ——— the sale cart → a draft sale invoice on the office PC ———

export function CartScreen() {
  const { t, lang, api, go, queue, explain } = useApp();
  const lists = useLists();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [customerText, setCustomerText] = useState('');
  const [customers, setCustomers] = useState<Party[]>([]);
  const [customer, setCustomer] = useState<Party | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.settings().then(setSettings).catch(() => {});
    api.warehouses().then((w) => { const active = w.filter((x) => x.active); setWarehouses(active); setWarehouseId((id) => id || active[0]?.id || ''); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (customerText.trim().length < 2 || customer) return;
    const timer = setTimeout(() => { api.customers(customerText.trim()).then((c) => setCustomers(c.slice(0, 8))).catch(() => {}); }, 350);
    return () => clearTimeout(timer);
  }, [customerText, customer]);

  // one invoice is in one currency: the first line's
  const currency: Currency = lists.cart[0]?.item.saleCurrency ?? 'IQD';
  const lines = lists.cart.filter((l) => l.item.saleCurrency === currency);
  const total = lines.reduce((sum, l) => sum + Math.round(l.item.salePrice * l.qty), 0);

  async function send() {
    if (!lines.length || !warehouseId) return;
    setBusy(true);
    setMessage(null);
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const body = {
      kind: 'sale', date, warehouseId, currency, rateX100: currency === 'IQD' ? 100 : settings?.defaultRateX100 ?? 142000,
      payment: customer ? 'credit' : 'cash', ...(customer ? { partyId: customer.id } : { cashAccountCode: settings?.postingAccounts.cash ?? '1811' }),
      discount: 0, notes: 'Qasa phone app', lines: lines.map((l) => ({ itemId: l.item.id, qtyMilli: Math.round(l.qty * 1000), unitPrice: l.item.salePrice }))
    };
    try {
      const result = await queue('sale', body);
      lists.setCart(lists.cart.filter((l) => !lines.includes(l)));
      setCustomer(null);
      setCustomerText('');
      setMessage({ kind: 'ok', text: result === 'sent' ? t('draftSent') : t('queued', { n: 1 }) });
    } catch (e) {
      setMessage({ kind: 'bad', text: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={t('cart')} onBack={() => go({ name: 'home' })}>
      <Button label={t('scan')} onPress={() => go({ name: 'scan', purpose: 'cart' })} />
      {message && <Note kind={message.kind} text={message.text} />}
      {!lists.cart.length ? <Note text={t('cartEmpty')} /> : (
        <>
          {lists.cart.map((l) => (
            <Card key={l.item.id}>
              <Text style={[s.text, { fontWeight: '700' }]}>{nameIn(lang, l.item.name)}</Text>
              <View style={s.between}>
                <View style={s.row}>
                  <Pressable accessibilityRole="button" accessibilityLabel="−" onPress={() => lists.setCart(lists.cart.map((x) => x === l ? { ...x, qty: Math.max(1, x.qty - 1) } : x))} style={qtyBtn}><Text style={qtyText}>−</Text></Pressable>
                  <Text style={[s.big, { minWidth: 40, textAlign: 'center' }]}>{l.qty}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="+" onPress={() => lists.setCart(lists.cart.map((x) => x === l ? { ...x, qty: x.qty + 1 } : x))} style={qtyBtn}><Text style={qtyText}>+</Text></Pressable>
                </View>
                <Text style={s.text}>{money(Math.round(l.item.salePrice * l.qty), l.item.saleCurrency)}</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => lists.setCart(lists.cart.filter((x) => x !== l))}><Text style={{ color: colors.bad }}>{t('remove')}</Text></Pressable>
            </Card>
          ))}
          <Card><View style={s.between}><Text style={s.text}>{t('total')}</Text><Text style={s.big}>{money(total, currency)}</Text></View></Card>
          <Field label={t('customer')} value={customer ? customer.name : customerText} placeholder={t('walkIn')} onChangeText={(v) => { setCustomer(null); setCustomerText(v); }} />
          {(customerText.trim().length >= 2 && !customer ? customers : []).map((c) => (
            <Pressable key={c.id} accessibilityRole="button" onPress={() => setCustomer(c)} style={{ padding: 12, backgroundColor: '#fff', borderRadius: 10 }}>
              <Text style={s.text}>{c.name} <Text style={s.muted}>{c.phone}</Text></Text>
            </Pressable>
          ))}
          {warehouses.length > 1 && (
            <>
              <Text style={s.label}>{t('warehouse')}</Text>
              <View style={[s.row, { flexWrap: 'wrap' }]}>
                {warehouses.map((w) => <View key={w.id}><Button kind={w.id === warehouseId ? 'primary' : 'plain'} label={nameIn(lang, w.name)} onPress={() => setWarehouseId(w.id)} /></View>)}
              </View>
            </>
          )}
          <Button label={t('sendDraft')} onPress={() => void send()} busy={busy} disabled={!warehouseId} />
        </>
      )}
    </Page>
  );
}

const qtyBtn = { width: 48, height: 48, borderRadius: 12, borderWidth: 2, borderColor: colors.line, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: '#fff' };
const qtyText = { fontSize: 24, fontWeight: '700' as const, color: colors.brand };

// ——— stock count → sent to the office for the admin ———

export function CountScreen() {
  const { t, lang, go, queue, explain, api } = useApp();
  const lists = useLists();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.warehouses().then((w) => { const active = w.filter((x) => x.active); setWarehouses(active); setWarehouseId((id) => id ?? active[0]?.id ?? null); }).catch(() => {});
  }, []);

  async function send() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await queue('count', { warehouseId, lines: lists.count.map((l) => ({ itemId: l.item.id, code: l.item.code, name: nameIn(lang, l.item.name), qty: l.qty })) });
      lists.setCount([]);
      setMessage({ kind: 'ok', text: result === 'sent' ? t('countSent') : t('queued', { n: 1 }) });
    } catch (e) {
      setMessage({ kind: 'bad', text: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={t('count')} onBack={() => go({ name: 'home' })}>
      {warehouses.length > 1 && (
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          {warehouses.map((w) => <View key={w.id}><Button kind={w.id === warehouseId ? 'primary' : 'plain'} label={nameIn(lang, w.name)} onPress={() => setWarehouseId(w.id)} /></View>)}
        </View>
      )}
      <Button label={t('scan')} onPress={() => go({ name: 'scan', purpose: 'count' })} />
      {message && <Note kind={message.kind} text={message.text} />}
      {!lists.count.length ? <Note text={t('countEmpty')} /> : (
        <>
          {lists.count.map((l) => (
            <Card key={l.item.id}>
              <View style={s.between}>
                <Text style={[s.text, { flex: 1 }]}>{nameIn(lang, l.item.name)}</Text>
                <Text style={s.big}>{l.qty.toLocaleString('en-US')}</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => lists.setCount(lists.count.filter((x) => x !== l))}><Text style={{ color: colors.bad }}>{t('remove')}</Text></Pressable>
            </Card>
          ))}
          <Button label={t('sendCount')} onPress={() => void send()} busy={busy} />
        </>
      )}
    </Page>
  );
}

// ——— settings ———

export function SettingsScreen({ onLang, onUnpair }: { onLang(lang: Lang): void; onUnpair(): void }) {
  const { t, lang, go, company } = useApp();
  return (
    <Page title={t('settings')} onBack={() => go({ name: 'home' })}>
      <Card>
        <Text style={s.label}>{t('company')}</Text>
        <Text style={s.text}>{company}</Text>
      </Card>
      <Text style={s.label}>{t('language')}</Text>
      <View style={s.row}>
        {LANGS.map((l) => <View key={l} style={{ flex: 1 }}><Button kind={l === lang ? 'primary' : 'plain'} label={l === 'ar' ? 'عربي' : l === 'en' ? 'English' : 'کوردی'} onPress={() => onLang(l)} /></View>)}
      </View>
      <Button kind="danger" label={t('unpair')} onPress={() => Alert.alert(t('unpair'), t('unpairConfirm'), [{ text: t('no'), style: 'cancel' }, { text: t('yes'), style: 'destructive', onPress: onUnpair }])} />
    </Page>
  );
}
