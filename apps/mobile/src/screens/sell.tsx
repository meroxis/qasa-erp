import { useState } from 'react';
import { View } from 'react-native';
import { today, type Settings } from '../api';
import { cartCurrency, lineAmount, linesIn, orderBody, saleBody, total } from '../documents';
import { money, nameIn } from '../i18n';
import { useLists } from '../lists';
import { space } from '../theme';
import { Banner, Button, Card, Chip, EmptyState, Group, IconButton, ListItem, Screen, Section, Segmented, Stepper, Txt, useApp, useLook } from '../ui';
import { useLoad } from '../use-load';

/**
 * The sale being made: its lines with their quantities, the customer (or a walk-in customer paying cash), the
 * warehouse, and how it goes to the office — a draft invoice the accountant posts, or an order (a quote) the office
 * turns into an invoice on delivery.
 */
export function CartScreen() {
  const { t, lang } = useLook();
  const { api, go, queue, explain, can } = useApp();
  const lists = useLists();
  const settings = useLoad<Settings | null>(() => api.settings().catch(() => null), []);
  const [mode, setMode] = useState<'sale' | 'order'>(can('sale') ? 'sale' : 'order');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const currency = cartCurrency(lists.cart);
  const lines = linesIn(lists.cart, currency);
  const others = lists.cart.length - lines.length;
  const sum = total(lines);
  const customer = lists.customer;
  const names = (i: { name: { ar: string; en: string; ku: string } }) => nameIn(lang, i.name);

  async function send() {
    if (!lines.length) return;
    if (mode === 'order' && !customer) { setMessage({ kind: 'warn', text: t('orderNeedsCustomer') }); return; }
    if (mode === 'sale' && !lists.warehouseId) return;
    setBusy(true);
    setMessage(null);
    const date = today();
    const notes = t('phoneNote');
    const summary = { title: customer?.name ?? t('walkIn'), amount: sum, currency, lines: lines.length };
    try {
      const result = mode === 'order'
        ? await queue('order', orderBody({ lines, currency, date, customer: customer!, notes, names }), summary)
        : await queue('sale', saleBody({
          lines, currency, date, warehouseId: lists.warehouseId!, customer, notes,
          cashAccount: settings.data?.postingAccounts.cash ?? '1811', rateX100: settings.data?.defaultRateX100 ?? 142_000
        }), summary);
      lists.setCart(lists.cart.filter((l) => !lines.includes(l)));
      lists.setCustomer(null);
      setMessage({ kind: 'ok', text: result === 'queued' ? t('queuedOne') : mode === 'order' ? t('orderSent') : t('draftSent') });
    } catch (e) {
      setMessage({ kind: 'bad', text: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  const modes = [...(can('sale') ? [{ value: 'sale' as const, label: t('modeSale') }] : []), ...(can('order') ? [{ value: 'order' as const, label: t('modeOrder') }] : [])];
  return (
    <Screen title={t('cart')} large
      right={lists.cart.length ? <IconButton icon="trash" label={t('emptyCart')} tone="bad" onPress={() => { lists.setCart([]); setMessage(null); }} /> : undefined}
      footer={lines.length ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }} accessible accessibilityLabel={`${t('total')} ${money(sum, currency, lang)}`}>
            <Txt v="bodyStrong" tone="ink2">{t('total')}</Txt>
            <Txt v="numberLarge">{money(sum, currency, lang)}</Txt>
          </View>
          <Button icon="send" label={mode === 'order' ? t('sendOrder') : t('sendDraft')} onPress={() => void send()} busy={busy} disabled={mode === 'sale' && !lists.warehouseId} />
        </>
      ) : undefined}>
      {message && <Banner kind={message.kind} text={message.text} />}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button icon="scan" label={t('scan')} onPress={() => go({ name: 'scan', purpose: 'cart' })} style={{ flex: 1 }} />
        <Button kind="secondary" icon="search" label={t('searchToAdd')} onPress={() => go({ name: 'items' })} style={{ flex: 1 }} />
      </View>
      {!lists.cart.length ? <EmptyState icon="cart" title={t('cart')} text={t('cartEmpty')} /> : (
        <>
          {modes.length > 1 && <Segmented<'sale' | 'order'> label={t('cart')} options={modes} value={mode} onChange={setMode} />}
          <Section title={t('customer')}>
            <Card onPress={() => go({ name: 'customers', pick: 'sale' })} label={`${t('customer')}: ${customer?.name ?? t('walkIn')}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m }}>
                <View style={{ flex: 1 }}>
                  <Txt v="bodyStrong">{customer?.name ?? (mode === 'order' ? t('chooseCustomer') : t('walkIn'))}</Txt>
                  {customer?.phone ? <Txt v="caption" tone="ink3">{customer.phone}</Txt> : null}
                </View>
                <Txt v="label" tone="accentText">{t('change')}</Txt>
              </View>
            </Card>
          </Section>
          {lists.warehouses.length > 1 && mode === 'sale' && (
            <Section title={t('warehouse')}>
              <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                {lists.warehouses.map((w) => <Chip key={w.id} label={nameIn(lang, w.name)} on={w.id === lists.warehouseId} onPress={() => lists.setWarehouseId(w.id)} />)}
              </View>
            </Section>
          )}
          {others > 0 && <Banner kind="info" text={t('oneCurrency', { c: currency === 'IQD' ? t('iqdShort') : '$' })} />}
          <Section title={t('linesN', { n: lines.length })}>
            <Group>
              {lines.map((l) => (
                <View key={l.item.id} style={{ padding: space.l, gap: space.s }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.m }}>
                    <Txt v="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>{nameIn(lang, l.item.name)}</Txt>
                    <Txt v="number">{money(lineAmount(l), l.item.saleCurrency, lang)}</Txt>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Stepper label={nameIn(lang, l.item.name)} value={l.qty}
                      onChange={(v) => lists.setCart(lists.cart.map((x) => (x === l ? { ...x, qty: v } : x)))} />
                    <IconButton icon="trash" tone="bad" label={`${t('remove')} ${nameIn(lang, l.item.name)}`} onPress={() => lists.setCart(lists.cart.filter((x) => x !== l))} />
                  </View>
                  <Txt v="caption" tone="ink3">{`${money(l.item.salePrice, l.item.saleCurrency, lang)} × ${l.qty}`}</Txt>
                </View>
              ))}
            </Group>
          </Section>
          {lists.cart.length > lines.length && (
            <Group>
              {lists.cart.filter((l) => !lines.includes(l)).map((l) => <ListItem key={l.item.id} title={nameIn(lang, l.item.name)} value={money(lineAmount(l), l.item.saleCurrency, lang)} />)}
            </Group>
          )}
        </>
      )}
    </Screen>
  );
}
