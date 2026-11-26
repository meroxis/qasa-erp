import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { Item } from '../../api';
import { money, nameIn, qty } from '../../i18n';
import { Icon } from '../../icons';
import { radius, space } from '../../theme';
import { Banner, Button, Card, EmptyState, ErrorState, Field, Group, ListItem, Screen, Section, Skeleton, Stepper, Txt, useApp, useLook } from '../../ui';
import { useLoad } from '../../use-load';
import { uuidV4 } from '../../uuid';
import { addDish, lineState, minutesSince, RS_MAX_GUESTS, setDishCount, type DishDraft, type LineState, type RsTable } from '../../staff/waiter';

/**
 * A restaurant's waiter (phone app 1.3): the room, each area's tables, free or with their order (what it comes to, how
 * long it has been eating, dishes not sent yet and dishes ready in the kitchen); then a table's order: its dishes and
 * where each is, dishes picked and sent to the kitchen, and what is ready taken to the table. Read again every 10
 * seconds while open: other waiters and the till change the same orders.
 */

const REFRESH_MS = 10_000;

export function TablesScreen() {
  const { t, lang, p, rtl } = useLook();
  const { api, nav, go, explain, toast } = useApp();
  const load = useLoad(() => api.rsFloor(), []);
  const [now, setNow] = useState(Date.now());
  const [opening, setOpening] = useState<RsTable | null>(null);
  const [guests, setGuests] = useState(2);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => { load.reload(); setNow(Date.now()); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const back = () => nav({ type: 'back' });

  async function open(kind: 'table' | 'takeaway', table?: RsTable) {
    setBusy(true);
    try {
      const order = await api.rsOpen(kind === 'table' ? { kind, tableId: table!.id, guests } : { kind }, uuidV4());
      setOpening(null);
      go({ name: 'tableOrder', id: order.id });
    } catch (e) {
      toast(explain(e), 'bad');
      load.reload();
    } finally {
      setBusy(false);
    }
  }

  const data = load.data;
  return (
    <Screen title={t('rsTables')} onBack={back} onRefresh={load.reload} refreshing={load.refreshing}
      footer={data?.available ? <Button kind="secondary" icon="plus" label={t('rsTakeaway')} onPress={() => void open('takeaway')} busy={busy} /> : undefined}>
      {load.loading ? <Skeleton rows={6} />
        : load.error || !data ? <ErrorState text={explain(load.error)} onRetry={load.reload} />
        : !data.areas.length ? <EmptyState icon="table" title={t('rsTables')} text={t('rsNoRoom')} />
        : (
          <>
            {!data.available && <Banner kind="warn" text={t('rsNoPlan')} />}
            {opening && (
              <Card>
                <Txt v="bodyStrong">{t('rsOpenTable', { t: opening.name })}</Txt>
                <Stepper value={guests} onChange={(n) => setGuests(Math.min(Math.max(n, 1), RS_MAX_GUESTS))} label={t('rsGuests')} />
                <View style={{ flexDirection: 'row', gap: space.s }}>
                  <Button kind="secondary" label={t('cancel')} onPress={() => setOpening(null)} style={{ flex: 1 }} />
                  <Button icon="check" label={t('rsOpen')} onPress={() => void open('table', opening)} busy={busy} style={{ flex: 1 }} />
                </View>
              </Card>
            )}
            {data.areas.map((a) => (
              <Section key={a.id} title={nameIn(lang, a.name) + (a.family ? ` · ${t('rsFamily')}` : '')}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                  {a.tables.map((tb) => {
                    const o = tb.order;
                    const label = o ? `${tb.name}: ${money(o.paid > 0 ? o.unpaid : o.total, 'IQD', lang)}${o.ready ? `, ${t('rsReadyN', { n: o.ready })}` : ''}` : `${tb.name}: ${t('rsFree')}`;
                    return (
                      <Pressable key={tb.id} accessibilityRole="button" accessibilityLabel={label}
                        onPress={() => (o ? go({ name: 'tableOrder', id: o.id }) : data.available ? (setGuests(Math.min(tb.seats, 4)), setOpening(tb)) : undefined)}
                        style={({ pressed }) => ({
                          flexBasis: '30%', flexGrow: 1, minHeight: 92, borderRadius: radius.l, padding: space.s, gap: 2, alignItems: 'center', justifyContent: 'center',
                          borderWidth: o?.ready ? 3 : 1, borderColor: o?.ready ? p.ok : o ? p.accent : p.line,
                          backgroundColor: pressed ? p.surface2 : o ? p.accentSoft : p.surface
                        })}>
                        <Txt v="title">{tb.name}</Txt>
                        {o ? (
                          <>
                            <Txt v="caption">{money(o.paid > 0 ? o.unpaid : o.total, 'IQD', lang)}</Txt>
                            <Txt v="caption" tone="ink3">{t('rsMinutes', { n: minutesSince(o.openedAt, now) })}</Txt>
                            {o.ready > 0 && (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                                <Icon name="bell" size={14} color={p.ok} rtl={rtl} /><Txt v="caption" tone="ok">{t('rsReadyN', { n: o.ready })}</Txt>
                              </View>
                            )}
                            {o.unsent > 0 && <Txt v="caption" tone="warn">{t('rsUnsentN', { n: o.unsent })}</Txt>}
                          </>
                        ) : <Txt v="caption" tone="ink3">{t('rsFree')}</Txt>}
                      </Pressable>
                    );
                  })}
                </View>
              </Section>
            ))}
            {data.orders.filter((o) => o.kind === 'takeaway').length > 0 && (
              <Section title={t('rsTakeaways')}>
                <Group>
                  {data.orders.filter((o) => o.kind === 'takeaway').map((o) => (
                    <ListItem key={o.id} icon="cart" title={`#${o.number}`} subtitle={t('rsMinutes', { n: minutesSince(o.openedAt, now) })}
                      value={money(o.total, 'IQD', lang)} onPress={() => go({ name: 'tableOrder', id: o.id })} />
                  ))}
                </Group>
              </Section>
            )}
          </>
        )}
    </Screen>
  );
}

const STATE_TONE: Record<LineState, 'ink3' | 'warn' | 'ok' | 'ink' | 'bad'> = { unsent: 'warn', cooking: 'ink3', ready: 'ok', served: 'ink', cancelled: 'bad' };
const STATE_KEY = { unsent: 'rsStUnsent', cooking: 'rsStCooking', ready: 'rsStReady', served: 'rsStServed', cancelled: 'rsStCancelled' } as const;

export function TableOrderScreen({ id }: { id: string }) {
  const { t, lang } = useLook();
  const { api, nav, explain, toast } = useApp();
  const load = useLoad(() => api.rsOrder(id), [id]);
  const [draft, setDraft] = useState<DishDraft[]>([]);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a dish's key, made once for what is picked now: a lost answer sent again adds the dishes once
  const [addKey, setAddKey] = useState(uuidV4);
  useEffect(() => {
    const timer = setInterval(() => { if (!busy) load.reload(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  // the menu: what is searched, the dishes first (an item kept in stock is an ingredient, never served as it is)
  useEffect(() => {
    const text = search.trim();
    if (text.length < 1) { setFound(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      void api.items(text, 30).then((list) => { if (live) setFound(list.filter((it) => it.salePrice > 0)); }).catch(() => { if (live) setFound([]); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  const back = () => nav({ type: 'back' });
  if (load.loading) return <Screen title={t('rsOrder')} onBack={back}><Skeleton rows={6} /></Screen>;
  if (load.error || !load.data) return <Screen title={t('rsOrder')} onBack={back}><ErrorState text={explain(load.error)} onRetry={load.reload} /></Screen>;
  const o = load.data;
  const open = o.status === 'open';
  const toSend = o.unsent + draft.length;
  const title = o.tableName ? t('rsTable', { t: o.tableName }) : t('rsTakeawayN', { n: o.number });

  async function run(work: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      if (done) toast(done, 'ok');
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
      load.reload();
    }
  }
  const send = () => run(async () => {
    if (draft.length) {
      await api.rsAdd(o.id, draft, addKey);
      setDraft([]);
      setAddKey(uuidV4());
    }
    await api.rsSend(o.id);
  }, t('rsSent'));

  return (
    <Screen title={title} subtitle={`#${o.number}${o.guests ? ` · ${t('rsGuestsN', { n: o.guests })}` : ''}`} onBack={back} onRefresh={load.reload} refreshing={load.refreshing}
      footer={open && toSend > 0 ? <Button icon="send" label={t('rsSend', { n: toSend })} onPress={() => void send()} busy={busy} /> : undefined}>
      {!open && <Banner kind="info" text={t('rsClosed')} />}
      {error && <Banner kind="bad" text={error} />}
      {o.ready > 0 && open && (
        <Card>
          <Txt v="bodyStrong" tone="ok">{t('rsReadyN', { n: o.ready })}</Txt>
          <Button icon="bell" label={t('rsServed')} onPress={() => void run(() => api.rsServed(o.id))} busy={busy} />
        </Card>
      )}
      <Section title={t('rsOnOrder')}>
        {!o.lines.length ? <Txt v="caption" tone="ink3">{t('rsNoLines')}</Txt> : (
          <Group>
            {o.lines.map((l) => {
              const state = lineState(l);
              return (
                <ListItem key={l.id} title={`${qty(l.qtyMilli)} × ${nameIn(lang, l.name)}`} subtitle={[l.note, money(l.amount, 'IQD', lang)].filter(Boolean).join(' · ')}
                  value={t(STATE_KEY[state])} valueTone={STATE_TONE[state]}
                  right={open && state === 'unsent' ? (
                    <Stepper value={Math.round(l.qtyMilli / 1000)} min={0} label={nameIn(lang, l.name)}
                      onChange={(n) => void run(() => (n <= 0 ? api.rsRemoveLine(o.id, l.id) : api.rsChangeLine(o.id, l.id, n * 1000)))} />
                  ) : undefined} />
              );
            })}
          </Group>
        )}
        <Txt v="bodyStrong">{t('rsTotal', { v: money(o.total, 'IQD', lang) })}</Txt>
      </Section>
      {open && (
        <Section title={t('rsAddDishes')}>
          <Field label={t('rsSearchMenu')} value={search} onChangeText={setSearch} autoCorrect={false} returnKeyType="search" />
          {found && (!found.length ? <Txt v="caption" tone="ink3">{t('rsNoDish')}</Txt> : (
            <Group>
              {found.map((it) => (
                <ListItem key={it.id} icon="plus" title={nameIn(lang, it.name)} value={it.saleCurrency === 'IQD' ? money(it.salePrice, 'IQD', lang) : undefined}
                  onPress={() => setDraft((list) => addDish(list, it))} />
              ))}
            </Group>
          ))}
          {draft.length > 0 && (
            <Section title={t('rsPicked', { n: draft.length })}>
              <Group>
                {draft.map((d, i) => (
                  <View key={`${d.itemId}-${i}`} style={{ padding: space.m, gap: space.s }}>
                    <ListItem title={nameIn(lang, d.name)} right={<Stepper value={d.qtyMilli / 1000} min={0} label={nameIn(lang, d.name)} onChange={(n) => setDraft((list) => setDishCount(list, i, n))} />} />
                    <Field label={t('rsNote')} placeholder={t('rsNotePh')} value={d.note} maxLength={120}
                      onChangeText={(note) => setDraft((list) => list.map((x, j) => (j === i ? { ...x, note } : x)))} />
                  </View>
                ))}
              </Group>
            </Section>
          )}
        </Section>
      )}
    </Screen>
  );
}
