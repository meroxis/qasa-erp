import { useState } from 'react';
import { Linking, View } from 'react-native';
import { today } from '../../api';
import { LANG_NAMES, LANGS, nameIn, type Lang } from '../../i18n';
import { space } from '../../theme';
import { Banner, Button, Card, Chip, ErrorState, Screen, Section, Skeleton, Txt, useApp, useLook } from '../../ui';
import { useLoad } from '../../use-load';
import { pdfFonts, sharePdf } from '../../staff/files';
import { invoiceHtml, statementHtml, type PdfLook } from '../../staff/pdf';
import { invoiceMessage, pdfRef, statementMessage, whatsappLink, whatsappNumber } from '../../staff/share';

/**
 * Sending a customer their invoice or statement: a PDF made on this phone from what the office sent, in the language
 * chosen (the customer's own, else the app's), handed to Android's share sheet (the user picks WhatsApp or another app,
 * and the chat); and, for a customer with a number WhatsApp can use, their chat opened with a message. Nothing goes
 * anywhere without the user's taps.
 */
export function ShareScreen({ doc, id, from }: { doc: 'invoice' | 'statement'; id: string; from?: string | undefined }) {
  const { t, lang: appLang } = useLook();
  const { api, nav, explain } = useApp();
  const load = useLoad(async () => {
    const [settings, profile, designs] = await Promise.all([api.settings(), api.printProfile().catch(() => null), api.printDesigns().catch(() => null)]);
    if (doc === 'invoice') {
      const invoice = await api.invoice(id);
      return { settings, profile, designs, invoice, statement: null, name: invoice.partyName ?? '', phone: invoice.partyPhone, partyLang: invoice.partyLang ?? null };
    }
    const [statement, customer] = await Promise.all([api.statement(id, from), api.customer(id)]);
    const partyLang = (customer as { lang?: unknown }).lang;
    return { settings, profile, designs, invoice: null, statement, name: customer.name, phone: customer.phone, partyLang: LANGS.includes(partyLang as Lang) ? partyLang as Lang : null };
  }, [doc, id, from ?? null]);
  const [fileLang, setFileLang] = useState<Lang | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'chat' | null>(null);
  const [message, setMessage] = useState<{ kind: 'bad' | 'warn'; text: string } | null>(null);
  const back = () => nav({ type: 'back' });
  const title = doc === 'invoice' ? t('pdfSaleInvoice') : t('pdfStatement');
  if (load.loading) return <Screen title={title} onBack={back}><Skeleton rows={4} /></Screen>;
  if (load.error || !load.data) return <Screen title={title} onBack={back}><ErrorState text={explain(load.error)} onRetry={load.reload} /></Screen>;
  const data = load.data;
  const lang = fileLang ?? data.partyLang ?? appLang;
  const company = nameIn(lang, data.settings.companyName);
  const until = data.statement?.to ?? today();
  const hasNumber = !!whatsappNumber(data.phone);

  async function makePdf() {
    setBusy('pdf');
    setMessage(null);
    try {
      const look: PdfLook = { company, profile: data.profile, design: data.designs?.sale ?? null, fonts: await pdfFonts() };
      if (data.invoice) {
        const qr = await api.invoiceQr(id, lang).catch(() => null);
        await sharePdf(invoiceHtml(lang, look, data.invoice, qr), pdfRef(data.invoice.number ?? 'invoice'), t('shrSendPdf'));
      } else if (data.statement) {
        const s = data.statement;
        await sharePdf(statementHtml(lang, look, s, { from: s.from ?? from ?? null, to: until }), pdfRef(`${s.party.code}-${until}`), t('shrSendPdf'));
      }
    } catch {
      setMessage({ kind: 'bad', text: t('shrFailed') });
    } finally {
      setBusy(null);
    }
  }

  async function openChat() {
    setBusy('chat');
    setMessage(null);
    try {
      const text = data.invoice
        ? invoiceMessage(lang, company, { number: data.invoice.number, date: data.invoice.date, total: data.invoice.total, currency: data.invoice.currency, partyName: data.invoice.partyName },
          (await api.invoiceQr(id, lang).catch(() => null))?.url ?? null)
        : statementMessage(lang, company, { name: data.name, balance: data.statement?.closing ?? 0, currency: 'IQD', date: until });
      const link = whatsappLink(data.phone, text);
      if (!link) setMessage({ kind: 'warn', text: t('shrNoNumber') });
      else await Linking.openURL(link);
    } catch (e) {
      setMessage({ kind: 'bad', text: explain(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title={title} subtitle={data.name} onBack={back}>
      <Card>
        <Txt v="bodyStrong">{data.invoice ? data.invoice.number ?? title : data.name}</Txt>
        <Txt v="caption" tone="ink2">{t('shrHow')}</Txt>
      </Card>
      <Section title={t('shrLang')}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('shrLang')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {LANGS.map((l) => <Chip key={l} label={LANG_NAMES[l]} on={lang === l} onPress={() => setFileLang(l)} />)}
        </View>
      </Section>
      <Button icon="share" label={busy === 'pdf' ? t('shrMaking') : t('shrSendPdf')} busy={busy === 'pdf'} disabled={busy !== null} onPress={() => void makePdf()} />
      {hasNumber
        ? <Button kind="secondary" icon="send" label={t('shrOpenChat')} busy={busy === 'chat'} disabled={busy !== null} onPress={() => void openChat()} />
        : <Txt v="caption" tone="ink3">{t('shrNoNumber')}</Txt>}
      {message && <Banner kind={message.kind} text={message.text} />}
    </Screen>
  );
}
