import { View } from 'react-native';
import { today } from '../../api';
import { dateText, money, nameIn, qty } from '../../i18n';
import { space } from '../../theme';
import { Button, Card, EmptyState, ErrorState, Group, ListItem, Screen, Section, Skeleton, Txt, useApp, useLook } from '../../ui';
import { useLoad } from '../../use-load';
import { daysBefore } from '../../staff/expense';

/** How far back a customer's invoices are listed on the phone. */
const INVOICE_DAYS = 92;

/** A customer's posted sale invoices of the last three months, newest first: one opens to be sent as a PDF. */
export function InvoicesScreen({ partyId }: { partyId: string }) {
  const { t, lang } = useLook();
  const { api, nav, go, explain } = useApp();
  const load = useLoad(async () => {
    const [customer, invoices] = await Promise.all([api.customer(partyId), api.customerInvoices(partyId, daysBefore(today(), INVOICE_DAYS))]);
    return { customer, invoices: [...invoices].sort((a, b) => b.date.localeCompare(a.date)) };
  }, [partyId]);
  const back = () => nav({ type: 'back' });
  if (load.loading) return <Screen title={t('shrInvoices')} onBack={back}><Skeleton rows={5} /></Screen>;
  if (load.error || !load.data) return <Screen title={t('shrInvoices')} onBack={back}><ErrorState text={explain(load.error)} onRetry={load.reload} /></Screen>;
  const { customer, invoices } = load.data;
  return (
    <Screen title={t('shrInvoices')} subtitle={customer.name} onBack={back} onRefresh={load.reload} refreshing={load.refreshing}>
      {!invoices.length ? <EmptyState icon="doc" title={t('shrNoInvoices')} /> : (
        <Group>
          {invoices.map((i) => (
            <ListItem key={i.id} icon="doc" title={i.number ?? '—'} subtitle={`${dateText(i.date)} · ${t(i.payment === 'credit' ? 'payCredit' : 'payCash')}`}
              value={money(i.total, i.currency, lang)} onPress={() => go({ name: 'invoice', id: i.id })} />
          ))}
        </Group>
      )}
    </Screen>
  );
}

/** One posted sale invoice, as the customer will get it, with the way to send it as a PDF. */
export function InvoiceScreen({ id }: { id: string }) {
  const { t, lang } = useLook();
  const { api, nav, go, explain } = useApp();
  const load = useLoad(() => api.invoice(id), [id]);
  const back = () => nav({ type: 'back' });
  if (load.loading) return <Screen title={t('pdfSaleInvoice')} onBack={back}><Skeleton rows={1} height={120} /><Skeleton rows={4} /></Screen>;
  if (load.error || !load.data) return <Screen title={t('pdfSaleInvoice')} onBack={back}><ErrorState text={explain(load.error)} onRetry={load.reload} /></Screen>;
  const inv = load.data;
  const m = (n: number) => money(n, inv.currency, lang);
  return (
    <Screen title={inv.number ?? t('pdfSaleInvoice')} subtitle={`${dateText(inv.date)} · ${inv.partyName ?? ''}`} onBack={back}
      footer={<Button icon="share" label={t('shrSendPdf')} onPress={() => go({ name: 'share', doc: 'invoice', id })} />}>
      <Card>
        <Row label={t('total')} value={m(inv.total)} strong />
        <Row label={t('payment')} value={t(inv.payment === 'credit' ? 'payCredit' : 'payCash')} />
        {inv.payment === 'credit' && inv.settlement && <Row label={t('pdfStillOwed')} value={m(inv.settlement.open)} />}
      </Card>
      <Section title={t('linesN', { n: inv.lines.length })}>
        <Group>
          {inv.lines.map((l) => (
            <ListItem key={l.lineNo} title={nameIn(lang, l.itemName) || l.description}
              subtitle={`${qty(l.lineUnit && l.unitQtyMilli !== null ? l.unitQtyMilli : l.qtyMilli)} × ${m(l.unitPrice)}`} value={m(l.amount)} />
          ))}
        </Group>
      </Section>
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
