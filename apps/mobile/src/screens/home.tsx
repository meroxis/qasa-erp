import { Pressable, View } from 'react-native';
import type { Brief } from '../api';
import { money, nameIn, qty } from '../i18n';
import { Icon, type IconName } from '../icons';
import type { Route } from '../nav';
import { isPending } from '../outbox';
import { actsAs, needsNewerOffice, type Feature, type Me } from '../roles';
import type { Key } from '../i18n';
import { radius, space } from '../theme';
import { Banner, Card, ErrorState, Group, ListItem, Screen, Section, Skeleton, Stat, Txt, useApp, useLook } from '../ui';
import { useLoad } from '../use-load';

/** Each 1.1 feature's name in the banner that asks for an update of the office PC (both rate features: one name). */
const FEATURE_NAME: Partial<Record<Feature, Key>> = {
  approvals: 'featApprovals', rate: 'featRate', rateSet: 'featRate', dayClose: 'featDayClose', expense: 'featExpense', share: 'featShare', transfer: 'featTransfer', receive: 'featReceive'
};

/**
 * For the owner or an admin of an office whose Qasa ERP does not offer some of phone app 1.1's features yet: the
 * features they would have, by name, and that the office PC needs the latest version. Null for anyone else, and when
 * the office offers them all.
 */
export function officeUpdateText(me: Me | null, t: (k: Key, v?: Record<string, string | number>) => string, lang: string): string | null {
  const ownerOrAdmin = !!me && (!me.signInRequired || !me.user || me.user.permissions.includes('admin'));
  if (!ownerOrAdmin) return null;
  const names = [...new Set(needsNewerOffice(me).map((f) => FEATURE_NAME[f]).filter((k): k is Key => !!k))].map((k) => t(k));
  return names.length ? t('officeUpdate', { f: names.join(lang === 'en' ? ', ' : '، ') }) : null;
}

/**
 * Home: who the phone works as and how it reaches the office, the quick actions the user's role allows, and — for the
 * owner, the accountants and a viewer — the day's figures: today's sales, the cash in the safes, what customers owe,
 * the late customers and the items running low.
 */
export function Home() {
  const { t, lang, p, rtl } = useLook();
  const { api, go, nav, can, company, me, via, state, outbox, explain } = useApp();
  const figures = can('figures');
  const brief = useLoad<Brief | null>(async () => (figures ? api.brief() : null), [figures]);
  const waiting = outbox.filter(isPending).length;
  const refused = outbox.filter((o) => o.error).length;
  const who = actsAs(me);

  const actions: { icon: IconName; label: string; route: Route | 'sell'; on: boolean }[] = [
    { icon: 'scan', label: t('scan'), route: { name: 'scan', purpose: 'look' }, on: can('lookup') },
    { icon: 'cart', label: t('newSale'), route: 'sell', on: can('sale') || can('order') },
    { icon: 'cash', label: t('collect'), route: { name: 'customers' }, on: can('collect') },
    { icon: 'doc', label: t('statement'), route: { name: 'customers' }, on: can('statement') && !can('collect') },
    { icon: 'clipboard', label: t('count'), route: { name: 'count' }, on: can('count') },
    // 1.1, for the staff (each only when the office offers it)
    { icon: 'receipt', label: t('expAction'), route: { name: 'expense' }, on: can('expense') },
    { icon: 'truck', label: t('mvAction'), route: { name: 'transfer' }, on: can('transfer') },
    { icon: 'inbox', label: t('rcvAction'), route: { name: 'receive' }, on: can('receive') }
  ];
  const open = (route: Route | 'sell') => {
    if (route === 'sell') return nav({ type: 'open', tab: 'sell' });
    if (route.name === 'customers') return nav({ type: 'open', tab: 'customers' });
    if (route.name === 'count' || route.name === 'transfer' || route.name === 'receive') return nav({ type: 'open', tab: 'items', route });
    go(route);
  };
  const update = officeUpdateText(me, t, lang);

  const b = brief.data;
  return (
    <Screen title={company || t('appName')} large subtitle={who ? t('hello', { n: who }) : undefined} onRefresh={figures ? brief.reload : undefined} refreshing={brief.refreshing} banner={false}>
      {/* the brand banner: how the phone reaches the office now */}
      <View accessible accessibilityLabel={state === 'online' ? (via === 'relay' ? t('viaRelay') : t('viaLan')) : state === 'connecting' ? t('connecting') : t('offline')}
        style={{ backgroundColor: p.brand, borderRadius: radius.l, padding: space.l, gap: space.s, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 44, height: 44, borderRadius: radius.m, backgroundColor: p.highlight, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={state !== 'online' ? 'cloudOff' : via === 'relay' ? 'cloud' : 'wifi'} color={p.onHighlight} rtl={rtl} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt v="bodyStrong" tone="onBrand">{state === 'online' ? (via === 'relay' ? t('viaRelay') : t('viaLan')) : state === 'connecting' ? t('connecting') : t('offlineShort')}</Txt>
          {state !== 'online' && state !== 'connecting' ? <Txt v="caption" tone="onBrand2">{t('offline')}</Txt> : null}
        </View>
      </View>
      {waiting > 0 && <Banner kind="info" icon="outbox" text={t('queued', { n: waiting })} action={{ label: t('outbox'), onPress: () => nav({ type: 'open', tab: 'more', route: { name: 'outbox' } }) }} />}
      {refused > 0 && <Banner kind="bad" text={t('refusedN', { n: refused })} action={{ label: t('outbox'), onPress: () => nav({ type: 'open', tab: 'more', route: { name: 'outbox' } }) }} />}
      {/* 1.1: what the owner or an admin could do from the phone once the office PC runs the release that offers it */}
      {update && <Banner kind="info" icon="info" text={update} />}

      <Section title={t('quickActions')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {actions.filter((a) => a.on).map((a) => (
            <Pressable key={a.label} accessibilityRole="button" accessibilityLabel={a.label} onPress={() => open(a.route)}
              style={({ pressed }) => ({ flexBasis: '47%', flexGrow: 1, minHeight: 88, borderRadius: radius.l, padding: space.l, gap: space.s, backgroundColor: pressed ? p.surface2 : p.surface, borderWidth: 1, borderColor: p.line })}>
              <View style={{ width: 40, height: 40, borderRadius: radius.m, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={a.icon} color={p.accentText} rtl={rtl} />
              </View>
              <Txt v="bodyStrong" numberOfLines={2}>{a.label}</Txt>
            </Pressable>
          ))}
        </View>
      </Section>

      {figures && (
        brief.loading ? <Skeleton rows={3} height={96} />
        : brief.error || !b ? <ErrorState text={explain(brief.error)} onRetry={brief.reload} />
        : (
          <>
            <Section title={t('todaySales')}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                <Stat icon="cart" label={t('todaySales')} value={money(b.sales.today, 'IQD', lang)}
                  note={`${t('invoicesN', { n: b.sales.invoices })} · ${t('vsLastWeek', { v: money(b.sales.sameDayLastWeek, 'IQD', lang) })}`} />
                <Stat icon="tag" label={t('monthSales')} value={money(b.sales.month, 'IQD', lang)} />
                {/* what the safes hold is the books (1.4): an office leaves it out for whoever may not read them */}
                {b.cash ? <Stat icon="cash" label={t('cashTotal')} value={money(b.cash.total.IQD, 'IQD', lang)} note={b.cash.total.USD ? money(b.cash.total.USD, 'USD', lang) : undefined} /> : null}
                <Stat icon="users" label={t('receivables')} value={money(b.receivables, 'IQD', lang)} tone={b.receivables > 0 ? 'bad' : 'ink'} />
              </View>
              {(b.approvals.waitingCheck > 0 || b.approvals.waitingApproval > 0) && (
                <Card><Txt v="caption" tone="ink2">{t('approvals', { c: b.approvals.waitingCheck, a: b.approvals.waitingApproval })}</Txt></Card>
              )}
            </Section>
            {b.lateCustomers.length > 0 && (
              <Section title={t('lateCustomers')}>
                <Group>
                  {b.lateCustomers.slice(0, 5).map((c) => (
                    <ListItem key={c.partyId} icon="user" title={c.name} subtitle={t('daysLate', { n: c.oldestDays })} value={money(c.balance, 'IQD', lang)} valueTone="bad"
                      onPress={can('statement') ? () => nav({ type: 'open', tab: 'customers', route: { name: 'customer', id: c.partyId } }) : undefined} />
                  ))}
                </Group>
              </Section>
            )}
            {b.lowStock.length > 0 && (
              <Section title={t('lowStock')}>
                <Group>
                  {b.lowStock.slice(0, 5).map((i) => (
                    <ListItem key={i.itemId} icon="box" title={nameIn(lang, i.name)} subtitle={i.code} value={qty(i.qtyMilli)} valueTone={i.qtyMilli <= 0 ? 'bad' : 'warn'}
                      onPress={() => nav({ type: 'open', tab: 'items', route: { name: 'item', code: i.code, itemId: i.itemId, purpose: 'look' } })} />
                  ))}
                </Group>
              </Section>
            )}
          </>
        )
      )}
    </Screen>
  );
}
