import { useEffect, useRef, useState } from 'react';
import { Alert, Image, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { exactMatch, type Currency, type Item, type ItemDetail, type PartHit } from '../api';
import { addLine, countListBody, countSessionBody, readAmount, readQty, setCount } from '../documents';
import { money, nameIn, qty as qtyText } from '../i18n';
import { useLists } from '../lists';
import type { Purpose } from '../nav';
import { radius, space } from '../theme';
import {
  Banner, Button, Card, Chip, EmptyState, ErrorState, Field, Group, IconButton, ListItem, Screen, Section, Segmented, Skeleton, Txt, useApp, useLook
} from '../ui';
import { useLoad } from '../use-load';
import { Scanner } from './scanner';

// ——— items: search by name or code, or scan ———

export function ItemsScreen() {
  const { t, lang } = useLook();
  const { api, go, explain, can } = useApp();
  const [text, setText] = useState('');
  const [results, setResults] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      setBusy(true);
      api.items(q).then((r) => { if (live) { setResults(r.slice(0, 50)); setError(null); } }, (e: unknown) => { if (live) setError(explain(e)); })
        .finally(() => { if (live) setBusy(false); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [text, api, explain]);

  return (
    <Screen title={t('items')} large right={<IconButton icon="scan" label={t('scan')} onPress={() => go({ name: 'scan', purpose: 'look' })} tone="accentText" />}>
      <Field label={t('searchItems')} value={text} onChangeText={setText} placeholder={t('searchItems')} returnKeyType="search" autoCorrect={false} />
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button kind="secondary" icon="scan" label={t('scan')} onPress={() => go({ name: 'scan', purpose: 'look' })} style={{ flex: 1 }} />
        {can('count') && <Button kind="secondary" icon="clipboard" label={t('count')} onPress={() => go({ name: 'count' })} style={{ flex: 1 }} />}
      </View>
      {error && <Banner kind="bad" text={error} />}
      {text.trim().length < 2 ? <EmptyState icon="search" title={t('searchItems')} text={t('typeTwo')} />
        : busy && !results ? <Skeleton rows={4} />
        : results && !results.length ? <EmptyState icon="box" title={t('nothing')} />
        : results ? (
          <Group>
            {results.map((i) => (
              <ListItem key={i.id} icon="box" title={nameIn(lang, i.name)} subtitle={[i.code, i.barcode].filter(Boolean).join(' · ')}
                value={money(i.salePrice, i.saleCurrency, lang)} onPress={() => go({ name: 'item', code: i.barcode || i.code, itemId: i.id, purpose: 'look' })} />
            ))}
          </Group>
        ) : null}
    </Screen>
  );
}

export function ScanScreen({ purpose }: { purpose: Purpose }) {
  const { t } = useLook();
  const { nav } = useApp();
  return <Scanner title={t('scan')} hint={t('pointCamera')} onBack={() => nav({ type: 'back' })} onCode={(code) => nav({ type: 'replace', route: { name: 'item', code, purpose } })} />;
}

// ——— an item: price, stock per warehouse, shelf, picture ———

export function ItemScreen({ code, itemId, purpose }: { code: string; itemId?: string | undefined; purpose: Purpose }) {
  const { t, lang } = useLook();
  const { api, go, nav, explain, can, toast } = useApp();
  const lists = useLists();
  const [part, setPart] = useState<PartHit | null>(null);
  const [picture, setPicture] = useState<string | null>(null);
  const [qty, setQty] = useState('1');
  const load = useLoad<ItemDetail | null>(async () => {
    const id = itemId ?? exactMatch(await api.items(code), code)?.id;
    return id ? api.item(id) : null;
  }, [code, itemId]);
  const item = load.data;
  useEffect(() => {
    if (!item) return;
    let live = true;
    void api.part(item.id).then((p) => live && setPart(p)).catch(() => {});
    void api.image(item.id).then((p) => live && setPicture(p)).catch(() => {});
    return () => { live = false; };
  }, [item, api]);

  const back = () => nav({ type: 'back' });
  if (load.loading) return <Screen title={code} onBack={back}><Skeleton rows={1} height={220} /><Skeleton rows={3} /></Screen>;
  if (load.error) return <Screen title={code} onBack={back}><ErrorState text={explain(load.error)} onRetry={load.reload} /></Screen>;
  if (!item) {
    return (
      <Screen title={code} onBack={back}>
        <EmptyState icon="search" title={t('nothing')} text={`${t('notFound')} ${code}`} />
        {can('newItem') && <Button icon="plus" label={t('addItem')} onPress={() => nav({ type: 'replace', route: { name: 'newItem', barcode: code } })} />}
        <Button kind="secondary" icon="scan" label={t('scanNext')} onPress={() => nav({ type: 'replace', route: { name: 'scan', purpose } })} />
      </Screen>
    );
  }
  const n = readQty(qty);
  const onHand = item.stock.reduce((s, w) => s + w.qtyMilli, 0);
  const add = () => {
    if (!n) return;
    if (purpose === 'count') {
      lists.setCount(setCount(lists.count, item, n));
      nav({ type: 'replace', route: { name: 'scan', purpose } });
    } else {
      lists.setCart(addLine(lists.cart, item, n));
      toast(t('addedToCart'), 'ok');
      // found by name: back to the list; scanned: on to the next scan
      if (itemId) nav({ type: 'back' });
      else nav({ type: 'replace', route: { name: 'scan', purpose: purpose === 'look' ? 'look' : 'cart' } });
    }
  };
  const canAdd = purpose === 'count' ? true : can('sale') || can('order');
  return (
    <Screen title={nameIn(lang, item.name)} subtitle={[item.code, item.barcode].filter(Boolean).join(' · ')} onBack={back}
      footer={canAdd ? (
        <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'flex-end' }}>
          <View style={{ width: 120 }}><Field label={t('qty')} value={qty} onChangeText={setQty} keyboardType="decimal-pad" numeric selectTextOnFocus error={qty && !n ? ' ' : undefined} /></View>
          <Button style={{ flex: 1 }} icon={purpose === 'count' ? 'clipboard' : 'cart'} label={purpose === 'count' ? t('addToCount') : t('addToCart')} onPress={add} disabled={!n} />
        </View>
      ) : undefined}>
      <Card>
        {picture ? <Image source={{ uri: picture }} style={{ width: '100%', height: 220, borderRadius: radius.m }} resizeMode="contain" accessibilityIgnoresInvertColors accessibilityLabel={nameIn(lang, item.name)} /> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Txt tone="ink2">{t('price')}</Txt>
          <Txt v="numberLarge" accessibilityLabel={`${t('price')} ${money(item.salePrice, item.saleCurrency, lang)}`}>{money(item.salePrice, item.saleCurrency, lang)}</Txt>
        </View>
        {part?.wholesalePrice != null && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt tone="ink2">{t('wholesale')}</Txt><Txt v="number">{money(part.wholesalePrice, item.saleCurrency, lang)}</Txt></View>
        )}
        {part?.shelf ? <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt tone="ink2">{t('shelf')}</Txt><Txt v="bodyStrong">{part.shelf}</Txt></View> : null}
      </Card>
      <Section title={`${t('stock')} · ${qtyText(onHand)}`}>
        <Group>
          {item.stock.map((w) => (
            <ListItem key={w.warehouseId} title={nameIn(lang, w.warehouseName)} subtitle={w.warehouseCode} value={qtyText(w.qtyMilli)} valueTone={w.qtyMilli > 0 ? 'ink' : 'bad'} />
          ))}
        </Group>
      </Section>
      {purpose === 'look' && <Button kind="secondary" icon="scan" label={t('scanNext')} onPress={() => nav({ type: 'replace', route: { name: 'scan', purpose: 'look' } })} />}
      {purpose === 'cart' && <Button kind="ghost" label={t('cart')} onPress={() => go({ name: 'cart' })} />}
    </Screen>
  );
}

// ——— a new item from a scanned barcode, with a photo ———

const UNITS = ['piece', 'box', 'carton', 'kg', 'm', 'service'] as const;

export function NewItemScreen({ barcode }: { barcode: string }) {
  const { t, lang } = useLook();
  const { api, nav, explain, toast } = useApp();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<Currency>('IQD');
  const [unit, setUnit] = useState<(typeof UNITS)[number]>('piece');
  const [photo, setPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [shooting, setShooting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minor = readAmount(price, currency);

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
    if (!name.trim() || minor === null) return;
    setBusy(true);
    setError(null);
    try {
      const names = { ar: '', en: '', ku: '', [lang]: name.trim().slice(0, 200) } as { ar: string; en: string; ku: string };
      const item = await api.createItem({ name: names, barcode: barcode.slice(0, 64), unit, salePrice: minor, saleCurrency: currency });
      if (photo) await api.setImage(item.id, photo.base64);
      toast(t('saved'), 'ok');
      nav({ type: 'replace', route: { name: 'item', code: barcode, itemId: item.id, purpose: 'look' } });
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
        <View style={{ position: 'absolute', start: 0, end: 0, bottom: 0, padding: space.l, paddingBottom: space.xxl, gap: space.m }}>
          <Button icon="camera" label={t('takePhoto')} onPress={() => void shoot()} />
          <Button kind="secondary" label={t('cancel')} onPress={() => setShooting(false)} />
        </View>
      </View>
    );
  }
  return (
    <Screen title={t('addItem')} onBack={() => nav({ type: 'back' })}
      footer={<Button icon="check" label={t('save')} onPress={() => void save()} busy={busy} disabled={!name.trim() || minor === null} />}>
      <Field label={t('barcode')} value={barcode} editable={false} />
      <Field label={t('name')} value={name} onChangeText={setName} autoFocus maxLength={200} />
      <Segmented<Currency> label={t('currency')} options={[{ value: 'IQD', label: t('iqdShort') }, { value: 'USD', label: '$' }]} value={currency} onChange={setCurrency} />
      <Field label={t('price')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" numeric error={price && minor === null ? t('amountInvalid') : undefined} />
      <Txt v="label" tone="ink2">{t('unit')}</Txt>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {UNITS.map((u) => <Chip key={u} label={t(u)} on={unit === u} onPress={() => setUnit(u)} />)}
      </View>
      {photo && <Image source={{ uri: photo.uri }} style={{ width: '100%', height: 200, borderRadius: radius.m }} resizeMode="contain" accessibilityIgnoresInvertColors />}
      <Button kind="secondary" icon="camera" label={photo ? t('retake') : t('takePhoto')}
        onPress={() => { if (!permission?.granted) void requestPermission().then((r) => r.granted && setShooting(true)); else setShooting(true); }} />
      {error && <Banner kind="bad" text={error} />}
    </Screen>
  );
}

// ——— stock count: into the warehouse's open count on the PC, or a list for the admin ———

export function CountScreen() {
  const { t, lang } = useLook();
  const { api, nav, go, queue, explain, can } = useApp();
  const lists = useLists();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const warehouseId = lists.warehouseId;
  const open = useLoad(async () => (warehouseId && can('countSession') ? api.openCount(warehouseId).catch(() => null) : null), [warehouseId]);
  const session = open.data ?? null;
  const warehouse = lists.warehouses.find((w) => w.id === warehouseId);

  async function send() {
    if (!lists.count.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const summary = { title: warehouse ? nameIn(lang, warehouse.name) : t('count'), lines: lists.count.length };
      const result = session
        ? await queue('countSession', countSessionBody(lists.count), summary, session.id)
        : await queue('count', countListBody(warehouseId, lists.count, (i) => nameIn(lang, i.name)), summary);
      lists.setCount([]);
      setMessage({ kind: 'ok', text: result === 'queued' ? t('queuedOne') : session ? t('countSessionSent') : t('countSent') });
    } catch (e) {
      setMessage({ kind: 'bad', text: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={t('count')} onBack={() => nav({ type: 'back' })}
      footer={lists.count.length ? <Button icon="send" label={t('sendCount')} onPress={() => void send()} busy={busy} /> : undefined}>
      {lists.warehouses.length > 1 && (
        <View accessibilityRole="radiogroup" accessibilityLabel={t('warehouse')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {lists.warehouses.map((w) => <Chip key={w.id} label={nameIn(lang, w.name)} on={w.id === warehouseId} onPress={() => lists.setWarehouseId(w.id)} />)}
        </View>
      )}
      {session && <Banner kind="info" icon="clipboard" text={t('openCountNote')} />}
      {message && <Banner kind={message.kind} text={message.text} />}
      <Button icon="scan" label={t('scan')} onPress={() => go({ name: 'scan', purpose: 'count' })} />
      {!lists.count.length ? <EmptyState icon="clipboard" title={t('count')} text={t('countEmpty')} /> : (
        <Section title={t('linesN', { n: lists.count.length })}>
          <Group>
            {lists.count.map((l) => (
              <ListItem key={l.item.id} title={nameIn(lang, l.item.name)} subtitle={l.item.code} value={qtyText(Math.round(l.qty * 1000))}
                right={<IconButton icon="trash" label={`${t('remove')} ${nameIn(lang, l.item.name)}`} tone="bad" onPress={() => lists.setCount(lists.count.filter((x) => x !== l))} />} />
            ))}
          </Group>
        </Section>
      )}
    </Screen>
  );
}

/** Asks before something that can't be undone; resolves true on yes. */
export function confirm(title: string, text: string, yes: string, no: string): Promise<boolean> {
  return new Promise((resolve) => Alert.alert(title, text, [{ text: no, style: 'cancel', onPress: () => resolve(false) }, { text: yes, style: 'destructive', onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) }));
}
