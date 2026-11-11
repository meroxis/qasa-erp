import { createContext, useContext, useState } from 'react';
import { Linking, View } from 'react-native';
import { OfficeError } from '../api';
import { LANG_NAMES, LANGS, money, type Lang } from '../i18n';
import { hashPin, validPin, weakPin, type AutoLock, type LockSettings } from '../lock';
import type { OutboxItem } from '../outbox';
import { actsAs } from '../roles';
import { space } from '../theme';
import type { ThemeChoice } from '../theme';
import {
  Banner, Button, Card, EmptyState, Group, IconButton, KeyPad, ListItem, PinDots, Screen, Section, Segmented, Txt, useApp, useLook
} from '../ui';
import { confirm } from './items';

/** The phone's own settings, kept by App. */
export interface Prefs {
  theme: ThemeChoice;
  setTheme(choice: ThemeChoice): void;
  setLang(lang: Lang): void;
  lock: LockSettings;
  setLock(lock: LockSettings): Promise<void>;
  /** the phone has a fingerprint or face set up */
  biometricReady: boolean;
  unpair(): Promise<void>;
  version: string;
}
export const PrefsCtx = createContext<Prefs | null>(null);
const usePrefs = () => useContext(PrefsCtx)!;

export const PRIVACY_URL = 'https://qasaerp.com/privacy/';

export function MoreScreen() {
  const { t, lang } = useLook();
  const { go, outbox, company, me, via, state } = useApp();
  const prefs = usePrefs();
  const waiting = outbox.length;
  const who = actsAs(me);
  return (
    <Screen title={t('more')} large>
      <Card>
        <Txt v="headline">{company}</Txt>
        <Txt v="caption" tone="ink2">{`${t('actsAs')}: ${who ?? t('owner')}`}</Txt>
        <Txt v="caption" tone="ink3">{state === 'online' ? (via === 'relay' ? t('viaRelay') : t('viaLan')) : t('offlineShort')}</Txt>
      </Card>
      <Group>
        <ListItem icon="outbox" title={t('outbox')} value={waiting ? String(waiting) : undefined} onPress={() => go({ name: 'outbox' })} />
        <ListItem icon="lock" title={t('security')} subtitle={prefs.lock.pin ? t('changePin') : t('setPin')} onPress={() => go({ name: 'security' })} />
        <ListItem icon="info" title={t('about')} onPress={() => go({ name: 'about' })} />
      </Group>
      <Section title={t('language')}>
        <Segmented label={t('language')} value={lang} onChange={prefs.setLang} options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))} />
      </Section>
      <Section title={t('theme')}>
        <Segmented label={t('theme')} value={prefs.theme} onChange={prefs.setTheme}
          options={[{ value: 'system', label: t('themeSystem') }, { value: 'light', label: t('themeLight') }, { value: 'dark', label: t('themeDark') }]} />
      </Section>
      <Section title={t('unpair')}>
        <Button kind="danger" icon="unlink" label={t('unpair')} onPress={async () => {
          const text = t('unpairConfirm') + (waiting ? `\n\n${t('unpairQueued', { n: waiting })}` : '');
          if (await confirm(t('unpair'), text, t('unpair'), t('cancel'))) await prefs.unpair();
        }} />
      </Section>
    </Screen>
  );
}

// ——— what waits for the office ———

const KIND_TEXT = { sale: 'kindSale', order: 'kindOrder', receipt: 'kindReceipt', count: 'kindCount', countSession: 'kindCount' } as const;

export function OutboxScreen() {
  const { t, lang } = useLook();
  const { outbox, nav, sendOutbox, retryOutbox, deleteOutbox, state, explain } = useApp();
  const describe = (o: OutboxItem) => [
    o.summary.amount !== undefined && o.summary.currency ? money(o.summary.amount, o.summary.currency, lang) : null,
    o.summary.lines ? t('linesN', { n: o.summary.lines }) : null,
    o.attempts ? t('triesN', { n: o.attempts }) : null
  ].filter(Boolean).join(' · ');
  return (
    <Screen title={t('outbox')} onBack={() => nav({ type: 'back' })}
      footer={outbox.some((o) => !o.error) ? <Button icon="send" label={t('sendNow')} onPress={sendOutbox} disabled={state === 'connecting'} /> : undefined}>
      {!outbox.length ? <EmptyState icon="check" title={t('outboxEmpty')} /> : (
        <Group>
          {outbox.map((o) => (
            <View key={o.id} style={{ padding: space.l, gap: space.s }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                <View style={{ flex: 1 }}>
                  <Txt v="bodyStrong">{`${t(KIND_TEXT[o.kind])} · ${o.summary.title}`}</Txt>
                  <Txt v="caption" tone="ink3">{describe(o)}</Txt>
                </View>
                <IconButton icon="trash" tone="bad" label={t('deleteItem')} onPress={async () => {
                  if (await confirm(t('deleteItem'), t('deleteConfirm'), t('deleteItem'), t('cancel'))) await deleteOutbox(o.id);
                }} />
              </View>
              {o.error && (
                <Banner kind="bad" text={t('refusedBy', { r: explain(new OfficeError(400, o.error, null)) })} action={{ label: t('retry'), onPress: () => void retryOutbox(o.id) }} />
              )}
            </View>
          ))}
        </Group>
      )}
    </Screen>
  );
}

// ——— the app lock ———

export function SecurityScreen() {
  const { t } = useLook();
  const { nav, toast } = useApp();
  const prefs = usePrefs();
  const [step, setStep] = useState<'view' | 'new' | 'again'>('view');
  const [first, setFirst] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function next() {
    if (!validPin(pin)) return;
    if (step === 'new') {
      if (weakPin(pin)) { setError(t('pinWeak')); setPin(''); return; }
      setFirst(pin); setPin(''); setError(null); setStep('again');
      return;
    }
    if (pin !== first) { setError(t('pinMismatch')); setPin(''); setFirst(''); setStep('new'); return; }
    setBusy(true);
    try {
      await prefs.setLock({ ...prefs.lock, pin: await hashPin(pin), length: pin.length });
      toast(t('pinSet'), 'ok');
      setStep('view');
    } finally {
      setBusy(false);
      setPin('');
      setFirst('');
    }
  }

  if (step !== 'view') {
    return (
      <Screen title={step === 'new' ? t('newPin') : t('confirmPin')} onBack={() => { setStep('view'); setPin(''); setError(null); }} banner={false}
        footer={<Button icon="check" label={t('save')} onPress={() => void next()} disabled={!validPin(pin)} busy={busy} />}>
        <Txt v="headline" style={{ textAlign: 'center' }}>{step === 'new' ? t('newPin') : t('confirmPin')}</Txt>
        <PinDots length={Math.max(4, pin.length)} filled={pin.length} />
        {error && <Banner kind="bad" text={error} />}
        <KeyPad onDigit={(d) => setPin((v) => (v.length < 8 ? v + d : v))} onDelete={() => setPin((v) => v.slice(0, -1))} />
      </Screen>
    );
  }
  return (
    <Screen title={t('security')} onBack={() => nav({ type: 'back' })}>
      <Txt tone="ink2">{t('securityHelp')}</Txt>
      <Button icon="lock" label={prefs.lock.pin ? t('changePin') : t('setPin')} onPress={() => setStep('new')} />
      {prefs.lock.pin && (
        <>
          <Section title={t('biometric')}>
            {prefs.biometricReady ? (
              <Segmented label={t('biometric')} value={prefs.lock.biometric ? 'on' : 'off'} onChange={(v) => void prefs.setLock({ ...prefs.lock, biometric: v === 'on' })}
                options={[{ value: 'on', label: t('yes') }, { value: 'off', label: t('no') }]} />
            ) : <Txt v="caption" tone="ink3">{t('biometricNone')}</Txt>}
          </Section>
          <Section title={t('autoLock')}>
            <Segmented<string> label={t('autoLock')} value={String(prefs.lock.after)} onChange={(v) => void prefs.setLock({ ...prefs.lock, after: Number(v) as AutoLock })}
              options={[{ value: '0', label: t('lockNow') }, { value: '60000', label: t('lock1m') }, { value: '300000', label: t('lock5m') }]} />
          </Section>
          <Button kind="danger" label={t('removePin')} onPress={() => void prefs.setLock({ pin: null, length: 0, biometric: false, after: prefs.lock.after })} />
        </>
      )}
    </Screen>
  );
}

// ——— about ———

export function AboutScreen() {
  const { t } = useLook();
  const { nav, company, me } = useApp();
  const prefs = usePrefs();
  const who = actsAs(me);
  return (
    <Screen title={t('about')} onBack={() => nav({ type: 'back' })}>
      <Card>
        <Txt v="title">{t('appName')}</Txt>
        <Txt v="caption" tone="ink2">{t('version', { v: prefs.version })}</Txt>
      </Card>
      <Group>
        <ListItem icon="home" title={t('company')} subtitle={company} />
        <ListItem icon="user" title={t('actsAs')} subtitle={who ?? t('owner')} />
      </Group>
      <Txt v="caption" tone="ink2">{t('pairPrivacy')}</Txt>
      <Button kind="secondary" icon="shield" label={t('privacy')} onPress={() => void Linking.openURL(PRIVACY_URL)} />
      <Txt v="caption" tone="ink3">{t('credits')}</Txt>
    </Screen>
  );
}
