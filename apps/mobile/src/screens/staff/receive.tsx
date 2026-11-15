import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { today } from '../../api';
import { dateText, nameIn, qty, translate, type Key } from '../../i18n';
import { useLists } from '../../lists';
import { space } from '../../theme';
import { Banner, Button, Card, EmptyState, ErrorState, Group, ListItem, Screen, Section, Skeleton, Txt, useApp, useLook } from '../../ui';
import { useLoad } from '../../use-load';
import type { OrderLine } from '../../staff/api';
import { arrivalBody, arrivalWaiting, receivable, setStockLine, wholeUnits } from '../../staff/stock';
import { StockLineRow } from './transfer';

/**
 * Receiving goods against a purchase order by scanning: the orders waiting to arrive, then one order's lines (ordered,
 * received, still to come) and what arrived now. "Record what arrived" makes a draft purchase invoice on the office at
 * the order's prices, which whoever buys checks and posts on the PC. Goods that came without an order are entered on the
 * PC. One arrival per order waits in the outbox at a time.
 */
export function ReceiveScreen() {
  const { t } = useLook();
  const { api, nav, go, explain } = useApp();
  const load = useLoad(async () => (await api.openOrders()).filter((o) => o.status === 'sent' || o.status === 'partial'), []);
  const back = () => nav({ type: 'back' });
  return (
    <Screen title={t('rcvAction')} subtitle={t('rcvOrders')} onBack={back} onRefresh={load.reload} refreshing={load.refreshing}>
      {load.loading ? <Skeleton rows={4} />
        : load.error || !load.data ? <ErrorState text={explain(load.error)} onRetry={load.reload} />
        : !load.data.length ? <EmptyState icon="inbox" title={t('rcvOrders')} text={t('rcvNone')} />
        : (
          <Group>
            {load.data.map((o) => (
              <ListItem key={o.id} icon="inbox" title={`${o.number} · ${o.partyName}`}
                subtitle={o.expectedDate ? t('rcvExpected', { d: dateText(o.expectedDate) }) : dateText(o.date)}
                value={o.overdue ? t('rcvLate') : undefined} valueTone="warn" onPress={() => go({ name: 'receiveOrder', id: o.id })} />
            ))}
          </Group>
        )}
    </Screen>
  );
}

/** "= 2 box" beside a quantity that is whole units of the line's own unit (one the app has a word for). */
function unitsHint(lang: Parameters<typeof translate>[0], line: OrderLine, qtyMilli: number): string {
  const n = wholeUnits(qtyMilli, line.unitFactorMilli);
  if (n === null || !line.lineUnit || !['box', 'carton', 'piece', 'kg', 'm'].includes(line.lineUnit)) return '';
  return ` = ${qty(n * 1000)} ${translate(lang, line.lineUnit as Key)}`;
}

export function ReceiveOrderScreen({ id }: { id: string }) {
  const { t, lang } = useLook();
  const { api, nav, go, queueFor, explain, outbox } = useApp();
  const lists = useLists();
  const load = useLoad(() => api.purchaseOrder(id), [id]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad' | 'warn' | 'info'; text: string } | null>(null);
  // what arrived is for this order: another order's list starts again
  useEffect(() => {
    if (lists.arrival?.orderId !== id) lists.setArrival({ orderId: id, lines: [] });
  }, [id, lists]);
  const arrived = lists.arrival?.orderId === id ? lists.arrival.lines : [];
  const queued = arrivalWaiting(outbox, id);
  const back = () => nav({ type: 'back' });
  if (load.loading) return <Screen title={t('rcvAction')} onBack={back}><Skeleton rows={5} /></Screen>;
  if (load.error || !load.data) return <Screen title={t('rcvAction')} onBack={back}><ErrorState text={explain(load.error)} onRetry={load.reload} /></Screen>;
  const order = load.data;
  const state = receivable(order);

  async function send() {
    if (!arrived.length || state !== 'ok') return;
    if (arrivalWaiting(outbox, id)) { setMessage({ kind: 'warn', text: t('rcvAlreadyQueued') }); return; }
    setBusy(true);
    setMessage(null);
    try {
      // dated the day it was scanned; to the order's warehouse, or (an order that names none) the one picked for stock
      const body = arrivalBody({ date: today(), order, lines: arrived, warehouseId: lists.warehouseId });
      const { result } = await queueFor('arrival', body, { title: `${order.number} · ${order.party.name}`, lines: arrived.length }, id);
      lists.setArrival({ orderId: id, lines: [] });
      setMessage({ kind: result === 'queued' ? 'info' : 'ok', text: result === 'queued' ? t('queuedOne') : t('rcvSent') });
      if (result !== 'queued') load.reload();
    } catch (e) {
      setMessage({ kind: 'bad', text: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={order.number} subtitle={`${t('rcvSupplier')}: ${order.party.name}`} onBack={back} onRefresh={load.reload} refreshing={load.refreshing}
      footer={state === 'ok' && arrived.length ? <Button icon="inbox" label={t('rcvSend')} onPress={() => void send()} busy={busy} disabled={queued} /> : undefined}>
      {order.expectedDate && (
        <Card>
          <Txt v="bodyStrong">{t('rcvExpected', { d: dateText(order.expectedDate) })}</Txt>
          {order.overdue && <Txt v="caption" tone="warn">{t('rcvLate')}</Txt>}
        </Card>
      )}
      {state === 'pending' && <Banner kind="warn" text={t('rcvPending')} />}
      {queued && <Banner kind="info" text={t('rcvAlreadyQueued')} />}
      {message && <Banner kind={message.kind} text={message.text} />}
      <Section title={t('linesN', { n: order.lines.length })}>
        <Group>
          {order.lines.map((l) => (
            <ListItem key={l.seq} title={nameIn(lang, l.itemName)}
              subtitle={`${t('rcvOrdered')}: ${qty(l.qtyMilli)}${unitsHint(lang, l, l.qtyMilli)} · ${t('rcvReceived')}: ${qty(l.receivedMilli)}`}
              value={`${t('rcvToCome')}: ${qty(l.remainingMilli)}`} valueTone={l.remainingMilli > 0 ? 'ink' : 'ok'}
              onPress={state === 'ok' && l.remainingMilli > 0 ? () => go({ name: 'item', code: l.itemCode, itemId: l.itemId, purpose: 'receive' }) : undefined} />
          ))}
        </Group>
      </Section>
      {state === 'ok' && (
        <View style={{ gap: space.s }}>
          <Button icon="scan" label={t('scan')} onPress={() => go({ name: 'scan', purpose: 'receive' })} disabled={queued} />
          <Section title={t('rcvNow')}>
            {!arrived.length ? <Txt v="caption" tone="ink3">{t('mvEmpty')}</Txt> : (
              <Group>
                {arrived.map((l) => (
                  <StockLineRow key={l.item.id} line={l} onChange={(q) => lists.setArrival({ orderId: id, lines: setStockLine(arrived, l.item.id, q) })} />
                ))}
              </Group>
            )}
          </Section>
        </View>
      )}
    </Screen>
  );
}
