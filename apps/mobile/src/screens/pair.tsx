import { useState } from 'react';
import { View } from 'react-native';
import { Icon, type IconName } from '../icons';
import { LANG_NAMES, LANGS, type Lang } from '../i18n';
import { radius, space } from '../theme';
import { Banner, Button, Field, Screen, Segmented, Txt, useLook } from '../ui';
import { Scanner } from './scanner';

/**
 * Before pairing: what the app is, the three steps (on the PC, scan, then it connects by itself), the phone's name, and
 * the camera for the QR code on the office PC.
 */
export function PairScreen({ name, setName, onCode, setLang, note }: {
  name: string; setName(v: string): void; onCode(text: string): Promise<void>; setLang(lang: Lang): void; note?: string | null;
}) {
  const { t, lang, p, rtl } = useLook();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (scanning) {
    return (
      <Scanner qrOnly title={t('pair')} hint={t('scanPairCode')} onBack={() => setScanning(false)}
        onCode={(text) => {
          setScanning(false);
          setBusy(true);
          setError(null);
          onCode(text).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
        }} />
    );
  }
  const step = (n: number, icon: IconName, text: string) => (
    <View key={n} style={{ flexDirection: 'row', gap: space.m, alignItems: 'flex-start' }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} color={p.accentText} size={22} rtl={rtl} />
      </View>
      <Txt style={{ flex: 1, paddingTop: 8 }}>{text}</Txt>
    </View>
  );
  return (
    <Screen title={t('appName')} large banner={false}
      footer={<Button icon="qr" label={busy ? t('pairing') : t('pair')} onPress={() => setScanning(true)} busy={busy} />}>
      <View style={{ backgroundColor: p.brand, borderRadius: radius.l, padding: space.xl, gap: space.m, alignItems: 'center' }}>
        <View style={{ width: 72, height: 72, borderRadius: radius.l, backgroundColor: p.highlight, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="search" color={p.onHighlight} size={40} />
        </View>
        <Txt v="title" tone="onBrand" style={{ textAlign: 'center' }}>{t('pairTitle')}</Txt>
        <Txt tone="onBrand2" style={{ textAlign: 'center' }}>{t('welcome')}</Txt>
      </View>
      <Segmented value={lang} onChange={setLang} options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))} />
      <View style={{ gap: space.l, paddingVertical: space.s }}>
        {step(1, 'sliders', t('pairStep1'))}
        {step(2, 'qr', t('pairStep2'))}
        {step(3, 'cloud', t('pairStep3'))}
      </View>
      <Field label={t('phoneName')} hint={t('phoneNameHint')} value={name} onChangeText={setName} placeholder="Samsung A54" maxLength={80} />
      {(error ?? note) && <Banner kind="bad" text={(error ?? note)!} />}
      <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
        <Icon name="shield" color={p.ok} size={18} />
        <Txt v="caption" tone="ink2" style={{ flex: 1 }}>{t('pairPrivacy')}</Txt>
      </View>
    </Screen>
  );
}
