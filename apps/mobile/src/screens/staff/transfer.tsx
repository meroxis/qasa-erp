import { useState } from 'react';
import { View } from 'react-native';
import { OfficeError, today, type ItemDetail } from '../../api';
import { readQty } from '../../documents';
import { nameIn, qty } from '../../i18n';
import { useLists } from '../../lists';
import type { Purpose } from '../../nav';
import { space } from '../../theme';
import { Banner, Button, Card, Chip, EmptyState, ErrorState, Field, Group, IconButton, ListItem, Screen, Section, Skeleton, Stepper, Txt, useApp, useLook } from '../../ui';
import { useLoad } from '../../use-load';
import { uuidV4 } from '../../uuid';
import type { BarcodeHit, OrderDetail } from '../../staff/api';
import { addStockLine, arrivalProblem, moreThanThere, scannedQtyMilli, setStockLine, transferBody, transferProblem, type StockLine } from '../../staff/stock';
import { confirm } from '../items';

/**
 * Moving stock between warehouses by scanning: from and to (two active warehouses), the items with their quantities,
 * then a draft transfer for the office, posted at once while the office can be reached (with one key for that post,
 * sent again with every try of it, so a post whose answer was lost is not taken for a refused one). Kept in the outbox
 * when the office can't be reached: it reaches the PC as a draft, posted there.
 */

/** A post whose answer did not come (the link dropped): tried again with the same key. */
let pendingPost: { draftId: string; key: string } | null = null;

export function TransferScreen() {
  const { t, lang } = useLook();
  const { api, nav, go, queueFor, explain, state } = useApp();
  const lists = useLists();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad' | 'warn' | 'info'; text: string } | null>(null);
  const [retry, setRetry] = useState(pendingPost);
  const warehouses = lists.warehouses;
  const from = lists.transferWarehouses.from ?? warehouses[0]?.id ?? null;
  const to = lists.transferWarehouses.to ?? warehouses.find((w) => w.id !== from)?.id ?? null;
  const name = (id: string | null) => nameIn(lang, warehouses.find((w) => w.id === id)?.name);
  const setWarehouses = (f: string | null, tt: string | null) => lists.setTransferWarehouses({ from: f, to: tt });
  const problem = transferProblem({ from: from ?? '', to: to ?? '', lines: lists.transfer });

  /** Posts the draft with its own key; a lost answer keeps the key for the next try. */
  async function post(draftId: string, key: string) {
    try {
      const posted = await api.postTransfer(draftId, key);
      pendingPost = null;
      setRetry(null);
      setMessage({ kind: 'ok', text: t('mvPosted', { n: posted.number ?? '' }) });
    } catch (e) {
      // a refusal keeps the draft and says why; no answer (the link, busy, the same post still running): tried again
      const refused = e instanceof OfficeError && e.status !== 429 && !(e.status === 409 && e.code === 'in_progress') && e.status < 500;
      pendingPost = refused ? null : { draftId, key };
      setRetry(pendingPost);
      setMessage({ kind: refused ? 'bad' : 'warn', text: `${t('mvDraft')} ${refused ? explain(e) : t('needsOnline')}` });
    }
  }

  async function send() {
    if (problem || !from || !to) return;
    const sure = await confirm(t('mvTitle'), t('mvConfirm', { n: lists.transfer.length, f: name(from), t: name(to) }), t('mvSend'), t('cancel'));
    if (!sure) return;
    setBusy(true);
    setMessage(null);
    try {
      const body = transferBody({ date: today(), from, to, notes: t('phoneNote'), lines: lists.transfer });
      const { result, answer } = await queueFor('transfer', body, { title: `${name(from)} → ${name(to)}`, lines: lists.transfer.length });
      lists.setTransfer([]);
      const draftId = (answer as { id?: unknown } | null)?.id;
      if (result === 'queued' || typeof draftId !== 'string') {
        setMessage({ kind: 'info', text: `${t('queuedOne')} ${t('mvQueuedNote')}` });
        return;
      }
      // the draft is there: posted now, with a key of its own for this post
      await post(draftId, uuidV4());
    } catch (e) {
      setMessage({ kind: 'bad', text: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  const back = () => nav({ type: 'back' });
  if (warehouses.length < 2) return <Screen title={t('mvTitle')} onBack={back}><EmptyState icon="truck" title={t('mvNeedsTwo')} /></Screen>;
  return (
    <Screen title={t('mvTitle')} onBack={back}
      footer={lists.transfer.length ? <Button icon="truck" label={t('mvSend')} onPress={() => void send()} busy={busy} disabled={!!problem} /> : undefined}>
      <Section title={t('mvFrom')}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('mvFrom')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {warehouses.map((w) => <Chip key={w.id} label={nameIn(lang, w.name)} on={w.id === from} onPress={() => setWarehouses(w.id, to === w.id ? from : to)} />)}
        </View>
      </Section>
      <Section title={t('mvTo')}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('mvTo')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {warehouses.filter((w) => w.id !== from).map((w) => <Chip key={w.id} label={nameIn(lang, w.name)} on={w.id === to} onPress={() => setWarehouses(from, w.id)} />)}
        </View>
      </Section>
      {problem === 'same_warehouse' && lists.transfer.length > 0 && <Banner kind="warn" text={t('errSameWarehouse')} />}
      {problem === 'service' && <Banner kind="warn" text={t('mvService')} />}
      {message && <Banner kind={message.kind} text={message.text} />}
      {retry && <Button kind="secondary" icon="refresh" label={t('retry')} disabled={state !== 'online'} onPress={() => void post(retry.draftId, retry.key)} />}
      <Button icon="scan" label={t('scan')} onPress={() => go({ name: 'scan', purpose: 'transfer' })} />
      {!lists.transfer.length ? <EmptyState icon="truck" title={t('mvTitle')} text={t('mvEmpty')} /> : (
        <Section title={t('linesN', { n: lists.transfer.length })}>
          <Group>
            {lists.transfer.map((l) => <StockLineRow key={l.item.id} line={l} onChange={(q) => lists.setTransfer(setStockLine(lists.transfer, l.item.id, q))} />)}
          </Group>
        </Section>
      )}
    </Screen>
  );
}

/** A line of stock: the item, its quantity (a stepper while it is whole) and a way to take it off. */
export function StockLineRow({ line, onChange }: { line: StockLine; onChange(qtyMilli: number): void }) {
  const { t, lang } = useLook();
  const whole = line.qtyMilli % 1000 === 0;
  return (
    <ListItem title={nameIn(lang, line.item.name)} subtitle={line.item.code} value={whole ? undefined : qty(line.qtyMilli)}
      right={(
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          {whole && <Stepper label={nameIn(lang, line.item.name)} value={line.qtyMilli / 1000} onChange={(v) => onChange(v * 1000)} />}
          <IconButton icon="trash" label={`${t('remove')} ${nameIn(lang, line.item.name)}`} tone="bad" onPress={() => onChange(0)} />
        </View>
      )} />
  );
}

/**
 * A scanned item for the stock being moved or received: what is in the warehouse it leaves (moving), or what is still to
 * come of it on the order (receiving), and the quantity to add (a box's barcode counts the box).
 */
export function StockItemScreen({ code, itemId, purpose }: { code: string; itemId?: string | undefined; purpose: Extract<Purpose, 'transfer' | 'receive'> }) {
  const { t, lang } = useLook();
  const { api, nav, explain } = useApp();
  const lists = useLists();
  const orderId = purpose === 'receive' ? lists.arrival?.orderId ?? null : null;
  const load = useLoad<{ item: ItemDetail & { trackStock?: boolean }; scanned: number; order: OrderDetail | null } | null>(async () => {
    const hit: BarcodeHit | null = itemId ? null : await api.itemByBarcode(code);
    const id = itemId ?? hit?.item?.id;
    if (!id) return null;
    const [item, order] = await Promise.all([api.item(id), orderId ? api.purchaseOrder(orderId) : Promise.resolve(null)]);
    return { item: item as ItemDetail & { trackStock?: boolean }, scanned: hit ? scannedQtyMilli(hit) : 1000, order };
  }, [code, itemId ?? null, orderId]);
  const [typed, setTyped] = useState<string | null>(null);
  const back = () => nav({ type: 'back' });
  const next = () => (itemId ? back() : nav({ type: 'replace', route: { name: 'scan', purpose } }));
  if (load.loading) return <Screen title={code} onBack={back}><Skeleton rows={3} /></Screen>;
  if (load.error) return <Screen title={code} onBack={back}><ErrorState text={explain(load.error)} onRetry={load.reload} /></Screen>;
  if (!load.data) {
    return (
      <Screen title={code} onBack={back}>
        <EmptyState icon="search" title={t('nothing')} text={`${t('notFound')} ${code}`} />
        <Button kind="secondary" icon="scan" label={t('scanNext')} onPress={() => nav({ type: 'replace', route: { name: 'scan', purpose } })} />
      </Screen>
    );
  }
  const { item, scanned, order } = load.data;
  const n = readQty(typed ?? String(scanned / 1000));
  const qtyMilli = n === null ? null : Math.round(n * 1000);
  const line = { id: item.id, code: item.code, name: item.name, unit: item.unit, trackStock: item.trackStock };
  let note: { kind: 'warn' | 'bad' | 'info'; text: string } | null = null;
  let blocked = qtyMilli === null;
  if (purpose === 'transfer') {
    const from = lists.transferWarehouses.from ?? lists.warehouses[0]?.id ?? null;
    const there = item.stock.find((s) => s.warehouseId === from);
    const already = lists.transfer.find((l) => l.item.id === item.id)?.qtyMilli ?? 0;
    if (item.trackStock === false) { note = { kind: 'bad', text: t('mvService') }; blocked = true; }
    else if (qtyMilli !== null && moreThanThere(already + qtyMilli, there?.qtyMilli ?? 0)) {
      note = { kind: 'warn', text: t('mvMore', { w: nameIn(lang, there?.warehouseName ?? lists.warehouses.find((w) => w.id === from)?.name), q: qty(there?.qtyMilli ?? 0) }) };
    }
  } else if (order && qtyMilli !== null) {
    const problem = arrivalProblem(order, lists.arrival?.lines ?? [], item.id, qtyMilli);
    if (problem?.code === 'po_line_unknown') { note = { kind: 'bad', text: t('rcvNotOnOrder') }; blocked = true; }
    else if (problem?.code === 'po_over_remaining') { note = { kind: 'bad', text: t('rcvOverRemaining', { q: qty(problem.remaining) }) }; blocked = true; }
  } else if (!order) blocked = true;

  const add = () => {
    if (blocked || qtyMilli === null) return;
    if (purpose === 'transfer') lists.setTransfer(addStockLine(lists.transfer, line, qtyMilli));
    else if (lists.arrival) lists.setArrival({ ...lists.arrival, lines: addStockLine(lists.arrival.lines, line, qtyMilli) });
    next();
  };
  const fromName = purpose === 'transfer' ? lists.warehouses.find((w) => w.id === (lists.transferWarehouses.from ?? lists.warehouses[0]?.id))?.name : undefined;
  const inFrom = purpose === 'transfer' ? item.stock.find((s) => s.warehouseId === (lists.transferWarehouses.from ?? lists.warehouses[0]?.id))?.qtyMilli ?? 0 : 0;
  return (
    <Screen title={nameIn(lang, item.name)} subtitle={[item.code, item.barcode].filter(Boolean).join(' · ')} onBack={back}
      footer={(
        <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'flex-end' }}>
          <View style={{ width: 120 }}>
            <Field label={purpose === 'receive' ? t('rcvNow') : t('qty')} value={typed ?? String(scanned / 1000)} onChangeText={setTyped} keyboardType="decimal-pad" numeric selectTextOnFocus
              error={qtyMilli === null ? ' ' : undefined} />
          </View>
          <Button style={{ flex: 1 }} icon={purpose === 'transfer' ? 'truck' : 'inbox'} label={purpose === 'transfer' ? t('mvAdd') : t('rcvAdd')} onPress={add} disabled={blocked} />
        </View>
      )}>
      <Card>
        {purpose === 'transfer' && <Txt v="bodyStrong">{t('mvAvailable', { w: nameIn(lang, fromName), q: qty(inFrom) })}</Txt>}
        {purpose === 'receive' && order && (() => {
          const toCome = order.lines.filter((l) => l.itemId === item.id).reduce((s, l) => s + l.remainingMilli, 0);
          return <Txt v="bodyStrong">{`${t('rcvToCome')}: ${qty(toCome)}`}</Txt>;
        })()}
      </Card>
      {note && <Banner kind={note.kind} text={note.text} />}
    </Screen>
  );
}
