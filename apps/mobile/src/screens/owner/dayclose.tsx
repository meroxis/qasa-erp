import { useState } from 'react';
import { View } from 'react-native';
import { today, type Money } from '../../api';
import { dateText, money } from '../../i18n';
import { askMine, drawerTone, METHOD_KEY, stepDay, yesterdayOf } from '../../owner/dayclose';
import { space } from '../../theme';
import { Banner, Card, Chip, EmptyState, ErrorState, Group, IconButton, ListItem, Screen, Section, Skeleton, Txt, useApp, useLook } from '../../ui';
import { useLoad } from '../../use-load';

/**
 * The end-of-day close (phone app 1.1), read only, to check the day from outside the shop: the day's sales and how they
 * were paid, each register's drawer, the expenses and the money in and out (for those who keep a PIN), debts collected
 * and new, and how many items run low. A phone without a PIN gets its user's own registers and their shifts only.
 */
export function DayCloseScreen() {
  const { t, lang } = useLook();
  const { api, nav, me, explain } = useApp();
  const day = today();
  const [date, setDate] = useState(day);
  const mine = askMine(me);
  const load = useLoad(() => api.dayClose(date, mine), [date, mine]);
  const c = load.data;
  const both = (m: Money) => [m.IQD || !m.USD ? money(m.IQD, 'IQD', lang) : null, m.USD ? money(m.USD, 'USD', lang) : null].filter(Boolean).join(' · ');
  const yesterday = yesterdayOf(day);
  return (
    <Screen title={t('dayTitle')} subtitle={dateText(date)} onBack={() => nav({ type: 'back' })} onRefresh={load.reload} refreshing={load.refreshing}
      right={
        <View style={{ flexDirection: 'row' }}>
          <IconButton icon="back" label={t('dayPrev')} onPress={() => setDate((d) => stepDay(d, -1, day))} />
          {date < day && <IconButton icon="forward" label={t('dayNext')} onPress={() => setDate((d) => stepDay(d, 1, day))} />}
        </View>
      }>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('date')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        <Chip label={t('today')} on={date === day} onPress={() => setDate(day)} />
        <Chip label={t('yesterday')} on={date === yesterday} onPress={() => setDate(yesterday)} />
      </View>
      {mine && <Banner kind="info" text={t('dayOwnShifts')} />}
      {load.loading ? <Skeleton rows={4} height={72} />
        : load.error || !c ? <ErrorState text={explain(load.error)} onRetry={load.reload} />
        : (
          <>
            <Card>
              <Txt v="caption" tone="ink2">{t('dayNet')}</Txt>
              <Txt v="numberLarge">{money(c.sales.net, 'IQD', lang)}</Txt>
              <Txt v="caption" tone="ink3">{[t('invoicesN', { n: c.sales.invoices }), c.sales.returns ? t('dayReturns', { a: money(c.sales.returns, 'IQD', lang) }) : null].filter(Boolean).join(' · ')}</Txt>
            </Card>
            {c.methods.length > 0 && (
              <Section title={t('dayByMethod')}>
                <Group>
                  {c.methods.map((m) => <ListItem key={m.method} title={t(METHOD_KEY[m.method])} subtitle={t('invoicesN', { n: m.invoices })} value={money(m.amount, 'IQD', lang)} />)}
                </Group>
              </Section>
            )}
            <Section title={t('dayRegisters')}>
              {!c.registers.length ? <EmptyState icon="register" title={t('dayNoRegisters')} /> : (
                <Group>
                  {c.registers.map((r) => {
                    const tone = drawerTone(r.difference);
                    return (
                      <View key={r.shiftId} style={{ padding: space.l, gap: 4 }} accessible>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.m }}>
                          <Txt v="bodyStrong" style={{ flex: 1 }}>{r.register}</Txt>
                          <Txt v="number">{both(r.sales)}</Txt>
                        </View>
                        <Txt v="caption" tone="ink3">{[t('dayOpenedBy', { u: r.openedBy }), r.status === 'open' ? t('dayStillOpen') : null].filter(Boolean).join(' · ')}</Txt>
                        <Txt v="caption" tone="ink2">{[`${t('dayExpected')}: ${both(r.expected)}`, r.counted ? `${t('dayCounted')}: ${both(r.counted)}` : null].filter(Boolean).join(' · ')}</Txt>
                        {tone && r.difference ? <Txt v="caption" tone={tone.tone}>{tone.key === 'dayMatches' ? t('dayMatches') : `${t(tone.key)}: ${both({ IQD: Math.abs(r.difference.IQD), USD: Math.abs(r.difference.USD) })}`}</Txt> : null}
                      </View>
                    );
                  })}
                </Group>
              )}
            </Section>
            <Group>
              {c.expenses ? <ListItem title={t('dayExpenses')} value={money(c.expenses.total, 'IQD', lang)} /> : null}
              {c.flow ? <ListItem title={t('dayMoneyIn')} value={money(c.flow.in, 'IQD', lang)} valueTone="ok" /> : null}
              {c.flow ? <ListItem title={t('dayMoneyOut')} value={money(c.flow.out, 'IQD', lang)} /> : null}
              <ListItem title={t('dayDebtsCollected')} value={money(c.debts.collected, 'IQD', lang)} valueTone="ok" />
              <ListItem title={t('dayDebtsNew')} value={money(c.debts.added, 'IQD', lang)} valueTone={c.debts.added ? 'bad' : 'ink'} />
            </Group>
            {c.lowStock.count > 0 && <Card><Txt tone="warn">{t('dayLowStock', { n: c.lowStock.count })}</Txt></Card>}
          </>
        )}
    </Screen>
  );
}
