import { useState } from 'react';
import { View } from 'react-native';
import type { Brief } from '../../api';
import { money, nameIn, qty } from '../../i18n';
import { cashRows, debtors, receivablesOf } from '../../owner/dashboard';
import { space } from '../../theme';
import { Card, Group, ListItem, Section, Stat, Txt, useApp, useLook } from '../../ui';

/**
 * The owner's dashboard on the home screen (the owner, the accountants and a viewer): the day's and the month's sales,
 * the cash and banks, who owes the most, and what runs low, from the brief the home screen loaded.
 */
export function Dashboard({ brief: b }: { brief: Brief }) {
  const { t, lang } = useLook();
  const { nav, can } = useApp();
  const [allCash, setAllCash] = useState(false);
  const cash = cashRows(b, allCash);
  const owe = debtors(b);
  const owed = receivablesOf(b);
  const both = (iqd: number, usd: number) => [iqd || !usd ? money(iqd, 'IQD', lang) : null, usd ? money(usd, 'USD', lang) : null].filter(Boolean).join(' · ');
  return (
    <>
      <Section title={t('todaySales')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          <Stat icon="cart" label={t('todaySales')} value={money(b.sales.today, 'IQD', lang)}
            note={`${t('invoicesN', { n: b.sales.invoices })} · ${t('vsLastWeek', { v: money(b.sales.sameDayLastWeek, 'IQD', lang) })}`} />
          <Stat icon="tag" label={t('monthSales')} value={money(b.sales.month, 'IQD', lang)} />
        </View>
        {/* an office before phone app 1.1: what waits, in words (with approvals on the phone, Home has its own card) */}
        {!can('approvals') && (b.approvals.waitingCheck > 0 || b.approvals.waitingApproval > 0) && (
          <Card><Txt v="caption" tone="ink2">{t('approvals', { c: b.approvals.waitingCheck, a: b.approvals.waitingApproval })}</Txt></Card>
        )}
      </Section>

      {/* what the safes and banks hold is the books (1.4): an office leaves it out for whoever may not read them */}
      {b.cash ? (
        <Section title={t('dashCashBanks')} action={cash.more > 0 ? { label: t('dashShowAll'), onPress: () => setAllCash(true) } : undefined}>
          <Stat icon="cash" label={t('cashTotal')} value={money(b.cash.total.IQD, 'IQD', lang)} note={b.cash.total.USD ? money(b.cash.total.USD, 'USD', lang) : undefined} />
          {cash.rows.length > 0 && (
            <Group>
              {cash.rows.map((a) => (
                <ListItem key={a.code} icon="cash" title={nameIn(lang, a.name)} subtitle={a.code} value={both(a.iqd, a.usd)} valueTone={a.iqd < 0 || a.usd < 0 ? 'bad' : 'ink'} />
              ))}
            </Group>
          )}
        </Section>
      ) : null}

      <Section title={owe.kind === 'top' ? t('dashTopDebtors') : t('lateCustomers')}>
        <Stat icon="users" label={t('receivables')} value={money(owed.IQD, 'IQD', lang)} note={owed.USD ? money(owed.USD, 'USD', lang) : undefined}
          tone={owed.IQD > 0 || owed.USD > 0 ? 'bad' : 'ink'} />
        {owe.rows.length > 0 && (
          <Group>
            {owe.rows.map((c) => (
              <ListItem key={c.partyId} icon="user" title={c.name} subtitle={t('daysLate', { n: c.days })} value={both(c.iqd, c.usd)} valueTone="bad"
                onPress={can('statement') ? () => nav({ type: 'open', tab: 'customers', route: { name: 'customer', id: c.partyId } }) : undefined} />
            ))}
          </Group>
        )}
      </Section>

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
  );
}
