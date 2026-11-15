import { useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { today, type Currency, type Settings } from '../../api';
import { readAmount } from '../../documents';
import { dateText, money, nameIn, qty } from '../../i18n';
import { recall, remember } from '../../office-cache';
import { PHOTOS_MAX } from '../../outbox';
import { radius, space } from '../../theme';
import { Banner, Button, Chip, ErrorState, Field, IconButton, Screen, Section, Segmented, Skeleton, Txt, useApp, useLook } from '../../ui';
import { useLoad } from '../../use-load';
import type { MoneyAccount } from '../../staff/api';
import {
  CATEGORY_TEXT, DAYS_BACK, daysBefore, EXPENSE_CATEGORIES, expenseBody, expenseOutcome, NOTE_MAX, OUTCOME_TEXT, PHOTO_STEPS, photoFits, resizeFor,
  type ExpenseCategory
} from '../../staff/expense';
import { deleteTemporary } from '../../staff/files';

/**
 * The safes and banks read last (by name only), so an expense can still be recorded when the link drops: kept for the
 * office paired now only, and forgotten on unpairing (office-cache.ts).
 */
const ACCOUNTS = 'expense.accounts';
type Accounts = { accounts: MoneyAccount[]; cash: string | null };

/**
 * An expense with the photo of its paper receipt: what for (the desktop's kinds), how much, from which safe or bank,
 * which day (up to 31 days back), a note and the photo. It is a payment voucher on the office, by the same rules as one
 * made on the desktop's Expenses page; it waits in the outbox, photo and all, when the office can't be reached.
 */
export function ExpenseScreen() {
  const { t, lang, p } = useLook();
  const { api, nav, queueFor, explain, me, outbox } = useApp();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const load = useLoad(async () => {
    try {
      const [accounts, settings] = await Promise.all([api.moneyAccounts(), api.settings().catch((): Settings | null => null)]);
      const read: Accounts = { accounts: accounts.filter((a) => a.code.startsWith('18')), cash: settings?.postingAccounts.cash ?? null };
      remember(ACCOUNTS, read);
      return read;
    } catch (e) {
      const last = recall<Accounts>(ACCOUNTS);
      if (!last) throw e;
      return last;
    }
  }, []);
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [currency, setCurrency] = useState<Currency>('IQD');
  const [amount, setAmount] = useState('');
  const [cash, setCash] = useState<string | null>(null);
  const [back, setBack] = useState(0);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [shooting, setShooting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad' | 'warn' | 'info'; text: string } | null>(null);
  const minor = readAmount(amount, currency);
  const day = daysBefore(today(), back);
  const photos = outbox.filter((o) => o.blob).length;
  const close = () => nav({ type: 'back' });

  async function shoot() {
    const shot = await camera.current?.takePictureAsync({ quality: 0.8, exif: false }).catch(() => undefined);
    if (!shot) return;
    try {
      // the longer side 1600 pixels at 0.6, else 1280 at 0.5: a new JPEG, without the camera's EXIF (its location)
      for (const step of PHOTO_STEPS) {
        const ref = await ImageManipulator.manipulate(shot.uri).resize(resizeFor(shot.width, shot.height, step.side)).renderAsync();
        const saved = await ref.saveAsync({ compress: step.compress, format: SaveFormat.JPEG, base64: true });
        deleteTemporary(saved.uri);
        if (saved.base64 && photoFits(saved.base64, me?.phoneLink?.photoMaxBytes ?? undefined)) {
          setPhoto(saved.base64);
          setShooting(false);
          return;
        }
      }
      setMessage({ kind: 'warn', text: t('expPhotoTooBig') });
      setShooting(false);
    } finally {
      deleteTemporary(shot.uri);
    }
  }

  async function save(data: { accounts: MoneyAccount[]; cash: string | null }) {
    const from = cash ?? defaultCash(data);
    if (!category || minor === null || !from) return;
    if (photo && photos >= PHOTOS_MAX) { setMessage({ kind: 'warn', text: t('expTooManyPhotos', { n: photos }) }); return; }
    setBusy(true);
    setMessage(null);
    try {
      const body = expenseBody({ category, amount: minor, currency, cashAccountCode: from, date: day, note, lang });
      const { result, answer } = await queueFor('expense', body, { title: t(CATEGORY_TEXT[category]), amount: minor, currency }, undefined, photo ?? undefined);
      const outcome = expenseOutcome(result, answer);
      const rate = (answer as { rateX100?: unknown } | null)?.rateX100;
      const usd = currency === 'USD' && typeof rate === 'number' ? ` ${t('expUsdRate', { r: qty(rate * 1000) })}` : '';
      setMessage({ kind: outcome === 'queued' ? 'info' : 'ok', text: outcome === 'queued' ? t('queuedOne') : t(OUTCOME_TEXT[outcome]) + usd });
      setAmount('');
      setNote('');
      setPhoto(null);
      setCategory(null);
    } catch (e) {
      setMessage({ kind: 'bad', text: e instanceof Error && e.message === 'outbox_photos_full' ? t('expTooManyPhotos', { n: photos }) : explain(e) });
    } finally {
      setBusy(false);
    }
  }

  if (shooting) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView ref={camera} style={{ flex: 1 }} facing="back" />
        <View style={{ position: 'absolute', start: 0, end: 0, bottom: 0, padding: space.l, paddingBottom: space.xxl, gap: space.m }}>
          <Button icon="camera" label={t('expTakePhoto')} onPress={() => void shoot()} />
          <Button kind="secondary" label={t('cancel')} onPress={() => setShooting(false)} />
        </View>
      </View>
    );
  }
  if (load.loading) return <Screen title={t('expTitle')} onBack={close}><Skeleton rows={5} /></Screen>;
  if (load.error || !load.data) return <Screen title={t('expTitle')} onBack={close}><ErrorState text={explain(load.error)} onRetry={load.reload} /></Screen>;
  const data = load.data;
  const from = cash ?? defaultCash(data);
  return (
    <Screen title={t('expTitle')} onBack={close}
      footer={<Button icon="check" label={t('expSave')} onPress={() => void save(data)} busy={busy} disabled={!category || minor === null || !from} />}>
      <Section title={t('expWhatFor')}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('expWhatFor')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {EXPENSE_CATEGORIES.map((c) => <Chip key={c} label={t(CATEGORY_TEXT[c])} on={category === c} onPress={() => setCategory(c)} />)}
        </View>
      </Section>
      <Segmented<Currency> label={t('currency')} value={currency} onChange={setCurrency} options={[{ value: 'IQD', label: t('iqdShort') }, { value: 'USD', label: '$' }]} />
      <Field label={t('amount')} value={amount} onChangeText={setAmount} keyboardType={currency === 'USD' ? 'decimal-pad' : 'number-pad'} numeric
        error={amount && minor === null ? t('amountInvalid') : undefined} hint={minor ? money(minor, currency, lang) : undefined} />
      {currency === 'USD' && <Banner kind="info" text={t('expUsdOffice')} />}
      <Section title={t('expPaidFrom')}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('expPaidFrom')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {data.accounts.map((a) => <Chip key={a.code} label={nameIn(lang, a.name) || a.code} on={from === a.code} onPress={() => setCash(a.code)} />)}
        </View>
      </Section>
      <Section title={t('date')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, alignItems: 'center' }}>
          <Chip label={t('today')} on={back === 0} onPress={() => setBack(0)} />
          <Chip label={t('yesterday')} on={back === 1} onPress={() => setBack(1)} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <IconButton icon="back" label={t('expDayBack')} onPress={() => setBack((b) => Math.min(DAYS_BACK, b + 1))} tone={back >= DAYS_BACK ? 'ink' : 'accentText'} />
            <Txt v="bodyStrong" numeric>{dateText(day)}</Txt>
            <IconButton icon="forward" label={t('expDayNext')} onPress={() => setBack((b) => Math.max(0, b - 1))} tone={back === 0 ? 'ink' : 'accentText'} />
          </View>
        </View>
      </Section>
      <Field label={t('note')} value={note} onChangeText={setNote} maxLength={NOTE_MAX} placeholder={category ? t(CATEGORY_TEXT[category]) : undefined} />
      <Section title={t('expPhoto')}>
        {photo && (
          <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} resizeMethod="resize" resizeMode="contain" accessibilityIgnoresInvertColors
            accessibilityLabel={t('expPhoto')} style={{ width: '100%', height: 220, borderRadius: radius.m, backgroundColor: p.surface2 }} />
        )}
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Button kind="secondary" icon="camera" label={photo ? t('retake') : t('expTakePhoto')} style={{ flex: 1 }}
            onPress={() => { if (!permission?.granted) void requestPermission().then((r) => r.granted && setShooting(true)); else setShooting(true); }} />
          {photo && <Button kind="ghost" icon="trash" label={t('remove')} onPress={() => setPhoto(null)} />}
        </View>
        <Txt v="caption" tone="ink3">{t('expPhotoHelp')}</Txt>
      </Section>
      {message && <Banner kind={message.kind} text={message.text} />}
    </Screen>
  );
}

/** The safe an expense is paid from unless another is picked: the company's cash account, else the first one. */
function defaultCash(data: { accounts: MoneyAccount[]; cash: string | null }): string | null {
  return data.accounts.find((a) => a.code === data.cash)?.code ?? data.accounts[0]?.code ?? null;
}
