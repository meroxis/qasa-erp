import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { Key } from '../i18n';
import { Icon, type IconName } from '../icons';
import type { Route } from '../nav';
import { isPending } from '../outbox';
import { actsAs, needsNewerOffice, runsTheOffice, type Feature, type Me } from '../roles';
import { radius, space } from '../theme';
import { Banner, Screen, Section, Txt, useApp, useLook } from '../ui';
import { OwnerCards } from './owner/cards';

/** Each 1.1 feature's name in the banner that asks for an update of the office PC (both rate features: one name). */
const FEATURE_NAME: Partial<Record<Feature, Key>> = {
  approvals: 'featApprovals', rate: 'featRate', rateSet: 'featRate', dayClose: 'featDayClose', expense: 'featExpense', share: 'featShare', transfer: 'featTransfer', receive: 'featReceive',
  itemLookup: 'featItemLookup', countAdd: 'featCountAdd'
};

/**
 * For the owner or an admin of an office whose Qasa ERP does not offer some of phone app 1.1's features yet: the
 * features they would have, by name, and that the office PC needs the latest version. Null for anyone else, and when
 * the office offers them all.
 */
export function officeUpdateText(me: Me | null, t: (k: Key, v?: Record<string, string | number>) => string, lang: string): string | null {
  if (!runsTheOffice(me)) return null;
  const names = [...new Set(needsNewerOffice(me).map((f) => FEATURE_NAME[f]).filter((k): k is Key => !!k))].map((k) => t(k));
  return names.length ? t('officeUpdate', { f: names.join(lang === 'en' ? ', ' : '، ') }) : null;
}

/**
 * Home: who the phone works as and how it reaches the office, the quick actions the user's role allows, and — for the
 * owner, the accountants and a viewer — the day's figures: today's sales, the cash in the safes, what customers owe,
 * who owes the most and the items running low (screens/owner: with the dollar rate, approvals and the end of the day).
 */
export function Home() {
  const { t, lang, p, rtl } = useLook();
  const { go, nav, can, company, me, via, state, outbox } = useApp();
  // pull to refresh: the owner's cards and figures load again (tick), and say when they have (onLoaded)
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshable = can('figures') || can('rate') || can('approvals');
  const waiting = outbox.filter(isPending).length;
  const refused = outbox.filter((o) => o.error).length;
  const who = actsAs(me);
  // the owner or an admin: what the phone could do with an office PC on the latest version
  const update = officeUpdateText(me, t, lang);

  const actions: { icon: IconName; label: string; route: Route | 'sell'; on: boolean }[] = [
    { icon: 'scan', label: t('scan'), route: { name: 'scan', purpose: 'look' }, on: can('lookup') },
    { icon: 'cart', label: t('newSale'), route: 'sell', on: can('sale') || can('order') },
    { icon: 'cash', label: t('collect'), route: { name: 'customers' }, on: can('collect') },
    { icon: 'doc', label: t('statement'), route: { name: 'customers' }, on: can('statement') && !can('collect') },
    { icon: 'clipboard', label: t('count'), route: { name: 'count' }, on: can('count') },
    // phone app 1.1, for the staff (each only when the office offers it)
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

  return (
    <Screen title={company || t('appName')} large subtitle={who ? t('hello', { n: who }) : undefined} banner={false}
      onRefresh={refreshable ? () => { setRefreshing(true); setTick((n) => n + 1); } : undefined} refreshing={refreshing}>
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
      {/* phone app 1.1: what the owner or an admin could do from the phone once the office PC runs the release that offers it */}
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

      {/* the dollar rate, approvals, the end of the day and the day's figures (screens/owner) */}
      <OwnerCards tick={tick} onLoaded={() => setRefreshing(false)} />
    </Screen>
  );
}
