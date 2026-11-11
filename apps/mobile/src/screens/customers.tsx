import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { today, type Currency, type Party, type Settings, type Statement } from '../api';
import { readAmount, receiptBody } from '../documents';
import { dateText, money } from '../i18n';
import { useLists } from '../lists';
import { space } from '../theme';
import {
  Banner, Button, Card, Chip, EmptyState, ErrorState, Field, Group, ListItem, Screen, Section, Segmented, Skeleton, Txt, useApp, useLook
} from '../ui';
import { useLoad } from '../use-load';

/** What a customer owes, in words and money: "Owes 250,000 د.ع", "Owes nothing", "In credit 5,000 د.ع". */
function balanceText(t: ReturnType<typeof useLook>['t'], lang: ReturnType<typeof useLook>['lang'], balance: number | undefined): { text: string; tone: 'ink' | 'bad' | 'ok' | 'ink3' } {
  if (balance === undefined) return { text: '', tone: 'ink3' };
  if (balance > 0) return { text: money(balance, 'IQD', lang), tone: 'bad' };
  if (balance < 0) return { text: `${t('inCredit')} ${money(-balance, 'IQD', lang)}`, tone: 'ok' };
  return { text: t('owesNothing'), tone: 'ink3' };
}

// ——— customers: search, pick one for a sale, or open one ———

export function CustomersScreen({ pick }: { pick?: 'sale' | undefined }) {
  const { t, lang } = useLook();
  const { api, go, nav, explain } = useApp();
  const lists = useLists();
  const [text, setText] = useState('');
  const [list, setList] = useState<Party[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api.customers(text.trim()).then((r) => { if (live) { setList(r.filter((c) => c.active !== false).slice(0, 60)); setError(null); } }, (e: unknown) => { if (live) setError(explain(e)); });
    }, text ? 300 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [text, api, explain, attempt]);

  const choose = (c: Party | null) => {
    lists.setCustomer(c);
    nav({ type: 'back' });
  };
  return (
    <Screen title={pick ? t('chooseCustomer') : t('customers')} large={!pick} onBack={pick ? () => nav({ type: 'back' }) : undefined}>
      <Field label={t('searchCustomers')} value={text} onChangeText={setText} placeholder={t('searchCustomers')} autoCorrect={false} returnKeyType="search" />
      {pick && <ListItem icon="cash" title={t('walkIn')} onPress={() => choose(null)} />}
      {error ? <ErrorState text={error} onRetry={() => setAttempt((n) => n + 1)} />
        : !list ? <Skeleton rows={5} />
        : !list.length ? <EmptyState icon="users" title={t('nothing')} />
        : (
          <Group>
            {list.map((c) => {
              const b = balanceText(t, lang, c.balance);
              return (
                <ListItem key={c.id} icon="user" title={c.name} subtitle={[c.code, c.phone].filter(Boolean).join(' · ')} value={b.text} valueTone={b.tone}
                  onPress={() => (pick ? choose(c) : go({ name: 'customer', id: c.id }))} />
              );
            })}
          </Group>
        )}
    </Screen>
  );
}

// ——— one customer ———

export function CustomerScreen({ id }: { id: string }) {
  const { t, lang } = useLook();
  const { api, go, nav, explain, can } = useApp();
  const lists = useLists();
  const load = useLoad(() => api.customer(id), [id]);
  const c = load.data;
  const back = () => nav({ type: 'back' });
  if (load.loading) return <Screen title={t('customer')} onBack={back}><Skeleton rows={1} height={120} /><Skeleton rows={3} /></Screen>;
  if (load.error || !c) return <Screen title={t('customer')} onBack={back}><ErrorState text={explain(load.error)} onRetry={load.reload} /></Screen>;
  const b = balanceText(t, lang, c.balance);
  return (
    <Screen title={c.name} subtitle={[c.code, c.phone].filter(Boolean).join(' · ')} onBack={back} onRefresh={load.reload} refreshing={load.refreshing}>
      <Card>
        <Txt v="caption" tone="ink2">{(c.balance ?? 0) > 0 ? t('owes') : t('closing')}</Txt>
        <Txt v="numberLarge" tone={b.tone === 'ink3' ? 'ink' : b.tone}>{b.text}</Txt>
        {c.balances && c.balances.USD !== 0 ? <Txt v="number" tone="ink2">{money(c.balances.USD, 'USD', lang)}</Txt> : null}
        {c.creditLimit ? <Txt v="caption" tone="ink3">{`${t('creditLimit')}: ${money(c.creditLimit, 'IQD', lang)}`}</Txt> : null}
      </Card>
      <View style={{ gap: space.s }}>
        {can('statement') && <Button icon="doc" kind="secondary" label={t('statement')} onPress={() => go({ name: 'statement', id: c.id })} />}
        {can('collect') && <Button icon="cash" label={t('collect')} onPress={() => go({ name: 'collect', id: c.id })} />}
        {(can('sale') || can('order')) && (
          <Button icon="cart" kind="secondary" label={t('newSale')} onPress={() => { lists.setCustomer(c); nav({ type: 'open', tab: 'sell' }); }} />
        )}
      </View>
    </Screen>
  );
}

// ——— a customer's statement ———

type Period = 'month' | 'three' | 'year';

function fromOf(period: Period, now = new Date()): string {
  const d = new Date(now);
  if (period === 'month') d.setDate(1);
  else if (period === 'three') { d.setDate(1); d.setMonth(d.getMonth() - 2); }
  else { d.setMonth(0); d.setDate(1); }
  return today(d);
}

export function StatementScreen({ id }: { id: string }) {
  const { t, lang } = useLook();
  const { api, nav, explain } = useApp();
  const [period, setPeriod] = useState<Period>('three');
  const load = useLoad<Statement>(() => api.statement(id, fromOf(period)), [id, period]);
  const s = load.data;
  const back = () => nav({ type: 'back' });
  return (
    <Screen title={s?.party.name ?? t('statement')} subtitle={t('statement')} onBack={back} onRefresh={load.reload} refreshing={load.refreshing}>
      <Segmented<Period> label={t('statement')} value={period} onChange={setPeriod}
        options={[{ value: 'month', label: t('thisMonth') }, { value: 'three', label: t('threeMonths') }, { value: 'year', label: t('thisYear') }]} />
      {load.loading ? <Skeleton rows={6} height={64} />
        : load.error || !s ? <ErrorState text={explain(load.error)} onRetry={load.reload} />
        : (
          <>
            <Card>
              <Row label={t('opening')} value={money(s.opening, 'IQD', lang)} />
              <Row label={t('debit')} value={money(s.totalDebit, 'IQD', lang)} />
              <Row label={t('credit')} value={money(s.totalCredit, 'IQD', lang)} />
              <View style={{ height: 1, backgroundColor: 'transparent' }} />
              <Row label={t('closing')} value={money(s.closing, 'IQD', lang)} strong />
            </Card>
            {!s.lines.length ? <EmptyState icon="doc" title={t('noLines')} /> : (
              <Group>
                {[...s.lines].reverse().map((l, i) => (
                  <View key={`${l.entryId}-${i}`} style={{ padding: space.l, gap: 4 }} accessible
                    accessibilityLabel={[dateText(l.date), l.number, l.description, l.debit ? `${t('debit')} ${money(l.debit, 'IQD', lang)}` : `${t('credit')} ${money(l.credit, 'IQD', lang)}`, `${t('closing')} ${money(l.balance, 'IQD', lang)}`].join(', ')}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.m }}>
                      <Txt v="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>{l.description || l.number}</Txt>
                      <Txt v="number" tone={l.debit ? 'bad' : 'ok'}>{money(l.debit || -l.credit, 'IQD', lang)}</Txt>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.m }}>
                      <Txt v="caption" tone="ink3">{`${dateText(l.date)} · ${l.number}`}</Txt>
                      <Txt v="caption" tone="ink2" numeric>{money(l.balance, 'IQD', lang)}</Txt>
                    </View>
                  </View>
                ))}
              </Group>
            )}
          </>
        )}
    </Screen>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.m }} accessible accessibilityLabel={`${label} ${value}`}>
      <Txt v={strong ? 'bodyStrong' : 'body'} tone={strong ? 'ink' : 'ink2'}>{label}</Txt>
      <Txt v={strong ? 'numberLarge' : 'number'}>{value}</Txt>
    </View>
  );
}

// ——— money received from a customer ———

export function CollectScreen({ id }: { id: string }) {
  const { t, lang } = useLook();
  const { api, nav, queue, explain } = useApp();
  const load = useLoad(async () => {
    const [customer, settings] = await Promise.all([api.customer(id), api.settings().catch((): Settings | null => null)]);
    return { customer, settings };
  }, [id]);
  const [currency, setCurrency] = useState<Currency>('IQD');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const minor = readAmount(amount, currency);
  const back = () => nav({ type: 'back' });
  if (load.loading) return <Screen title={t('collectTitle')} onBack={back}><Skeleton rows={3} /></Screen>;
  if (load.error || !load.data) return <Screen title={t('collectTitle')} onBack={back}><ErrorState text={explain(load.error)} onRetry={load.reload} /></Screen>;
  const { customer, settings } = load.data;

  async function send() {
    if (minor === null) return;
    if (!customer.accountCode) { setMessage({ kind: 'bad', text: t('noAccount') }); return; }
    setBusy(true);
    setMessage(null);
    try {
      const body = receiptBody({
        customer: { id: customer.id, name: customer.name, accountCode: customer.accountCode }, amount: minor, currency,
        rateX100: settings?.defaultRateX100 ?? 142_000, cashAccount: settings?.postingAccounts.cash ?? '1811', date: today(),
        description: t('receiptDescription', { c: customer.name }), note
      });
      const result = await queue('receipt', body, { title: customer.name, amount: minor, currency });
      setAmount('');
      setNote('');
      setMessage({ kind: 'ok', text: result === 'queued' ? t('queuedOne') : t('collectSent') });
    } catch (e) {
      setMessage({ kind: 'bad', text: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  const b = balanceText(t, lang, customer.balance);
  return (
    <Screen title={t('collectTitle')} subtitle={customer.name} onBack={back}
      footer={<Button icon="check" label={t('collectSend')} onPress={() => void send()} busy={busy} disabled={minor === null} />}>
      <Card>
        <Txt v="caption" tone="ink2">{customer.name}</Txt>
        <Txt v="number" tone={b.tone === 'ink3' ? 'ink2' : b.tone}>{(customer.balance ?? 0) > 0 ? `${t('owes')} ${b.text}` : b.text}</Txt>
      </Card>
      <Segmented<Currency> label={t('currency')} value={currency} onChange={setCurrency} options={[{ value: 'IQD', label: t('iqdShort') }, { value: 'USD', label: '$' }]} />
      <Field label={t('amount')} value={amount} onChangeText={setAmount} keyboardType={currency === 'USD' ? 'decimal-pad' : 'number-pad'} numeric autoFocus
        error={amount && minor === null ? t('amountInvalid') : undefined} hint={minor ? money(minor, currency, lang) : undefined} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {(currency === 'IQD' ? [25_000, 50_000, 100_000, 250_000] : [5000, 10_000, 50_000]).map((v) => (
          <Chip key={v} label={money(v, currency, lang)} on={minor === v} onPress={() => setAmount(String(currency === 'USD' ? v / 100 : v))} />
        ))}
      </View>
      <Field label={t('note')} value={note} onChangeText={setNote} maxLength={200} />
      {message && <Banner kind={message.kind} text={message.text} />}
      <Section title={t('statement')}>
        <Button kind="ghost" icon="doc" label={t('statement')} onPress={() => nav({ type: 'replace', route: { name: 'statement', id } })} />
      </Section>
    </Screen>
  );
}
