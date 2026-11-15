import { useState } from 'react';
import { View } from 'react-native';
import { OfficeError, today } from '../../api';
import { dateText } from '../../i18n';
import { changeText, isBigChange, lastDays, percentText, rateStatus, rateText, readRate } from '../../owner/rate';
import { space } from '../../theme';
import { Banner, Button, Card, ErrorState, Field, Group, ListItem, Screen, Section, Skeleton, Txt, useApp, useLook } from '../../ui';
import { useLoad } from '../../use-load';
import { uuidV4 } from '../../uuid';
import { confirm } from '../items';

/** A refusal that says the rate is out of the office's range (a validation answer with rate_invalid). */
const outOfRange = (e: unknown) => e instanceof OfficeError && e.code === 'validation' && Array.isArray(e.details) && e.details.some((d) => (d as { code?: unknown })?.code === 'rate_invalid');

/**
 * The dollar rate (phone app 1.1): today's rate per $100 as the desktop's rate board shows it, the change since the
 * previous one and the last days. The owner and an admin set today's rate here (the office's own today; the office
 * checks the range and logs it as on the PC, and the newest rate becomes the default for new invoices and vouchers).
 */
export function RateScreen() {
  const { t } = useLook();
  const { api, nav, can, state, explain, toast } = useApp();
  const load = useLoad(async () => {
    const [now, rows] = await Promise.all([api.rate(), api.rates(30)]);
    return { now, rows };
  }, []);
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'bad'; text: string } | null>(null);
  // one key per save (the same rate tried again after a lost answer goes with the same key)
  const [pending, setPending] = useState<{ rate: number; key: string } | null>(null);
  const back = () => nav({ type: 'back' });
  const online = state === 'online';
  const typed = readRate(text);

  if (load.loading) return <Screen title={t('rateTitle')} onBack={back}><Skeleton rows={1} height={140} /><Skeleton rows={4} /></Screen>;
  if (load.error || !load.data) return <Screen title={t('rateTitle')} onBack={back}><ErrorState text={explain(load.error)} onRetry={load.reload} /></Screen>;
  const { now, rows } = load.data;
  const day = today();
  const status = rateStatus(now, day);
  const change = changeText(rows);
  const recent = lastDays(rows, day);
  const last = rows[0]?.rateX100 ?? now.rateX100;

  async function save(rate: number) {
    if (busy) return;
    if (isBigChange(last, rate) && !(await confirm(t('rateTitle'), t('rateBigChange', { r: rateText(last), p: percentText(last, rate) }), t('save'), t('cancel')))) return;
    const key = pending && pending.rate === rate ? pending.key : uuidV4();
    setPending({ rate, key });
    setBusy(true);
    setMessage(null);
    try {
      await api.setRate({ rateX100: rate, ...(source.trim() ? { source: source.trim().slice(0, 100) } : {}) }, key);
      setPending(null);
      setText('');
      setSource('');
      toast(t('rateSaved'), 'ok');
      load.reload();
    } catch (e) {
      // refused: a new try is a new save; no answer: the same key goes with the next try of the same rate
      if (e instanceof OfficeError && e.code !== 'in_progress') setPending(null);
      setMessage({ kind: 'bad', text: outOfRange(e) ? t('rateInvalid') : explain(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={t('rateTitle')} onBack={back} onRefresh={load.reload} refreshing={load.refreshing}>
      <Card>
        <Txt v="caption" tone="ink2">{t('rateToday')}</Txt>
        <Txt v="numberLarge">{rateText(now.rateX100)}</Txt>
        <Txt v="caption" tone="ink3">{t('ratePer100')}</Txt>
        {status.key === 'rateLast' && <Txt v="caption" tone="warn">{`${t('rateLast', { d: dateText(status.date!) })} · ${t('rateNoneToday')}`}</Txt>}
        {status.key === 'rateDefault' && <Txt v="caption" tone="warn">{t('rateDefault')}</Txt>}
        {change && <Txt v="caption" tone="ink2">{t('rateChange', { c: change })}</Txt>}
      </Card>
      {can('rateSet') && (
        <View style={{ gap: space.s }}>
          <Field label={t('rateInput')} value={text} onChangeText={setText} keyboardType="number-pad" numeric placeholder="146,500"
            error={text && typed === null ? t('rateInvalid') : undefined} hint={online ? undefined : t('needsOnline')} />
          <Field label={t('rateSource')} value={source} onChangeText={setSource} placeholder={t('rateSourceHint')} maxLength={100} />
          {message && <Banner kind={message.kind} text={message.text} />}
          <Button icon="check" label={t('rateSave')} onPress={() => typed !== null && void save(typed)} busy={busy} disabled={!online || typed === null} />
          {rows[0] && (
            <Button kind="secondary" label={t('rateSame', { r: rateText(rows[0].rateX100) })} onPress={() => void save(rows[0]!.rateX100)} disabled={!online || busy} />
          )}
        </View>
      )}
      {recent.length > 0 && (
        <Section title={t('rateHistory')}>
          <Group>
            {recent.map((r) => (
              <ListItem key={r.date} title={dateText(r.date)} subtitle={[r.source, r.createdBy].filter(Boolean).join(' · ') || undefined} value={rateText(r.rateX100)} />
            ))}
          </Group>
        </Section>
      )}
    </Screen>
  );
}
