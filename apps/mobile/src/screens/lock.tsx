import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../icons';
import { lockoutMs, verifyPin } from '../lock';
import { loadLockFails, saveLockFails } from '../store';
import { radius, space } from '../theme';
import { Banner, Button, KeyPad, PinDots, Txt, useLook } from '../ui';
import { confirm } from './items';

/**
 * The lock screen: the PIN pad, and the fingerprint or face when the user turned it on. Wrong PINs make the next try
 * wait (kept across restarts); "Forgot the PIN?" unpairs and wipes the phone after asking.
 */
export function LockScreen({ pinHash, length, biometric, onUnlock, onForgot }: { pinHash: string; length: number; biometric: boolean; onUnlock(): void; onForgot(): Promise<void> }) {
  const { t, p, rtl } = useLook();
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [fails, setFails] = useState<{ n: number; at: number }>({ n: 0, at: 0 });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { void loadLockFails().then(setFails); }, []);
  const waitUntil = fails.at + lockoutMs(fails.n);
  const waiting = waitUntil > now;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const askBiometric = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: t('unlockPrompt'), cancelLabel: t('cancel'), disableDeviceFallback: true });
    if (result.success) {
      await saveLockFails({ n: 0, at: 0 });
      onUnlock();
    }
  }, [t, onUnlock]);
  // the fingerprint or face is asked for once, as the lock screen opens
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (!biometric || asked) return;
    const timer = setTimeout(() => { setAsked(true); void askBiometric(); }, 0);
    return () => clearTimeout(timer);
  }, [biometric, asked, askBiometric]);

  async function check(value: string) {
    if (waiting || checking) return;
    setChecking(true);
    const ok = await verifyPin(value, pinHash);
    setChecking(false);
    if (ok) {
      await saveLockFails({ n: 0, at: 0 });
      onUnlock();
      return;
    }
    const next = { n: fails.n + 1, at: Date.now() };
    setFails(next);
    setNow(Date.now());
    await saveLockFails(next);
    setPin('');
    setError(t('lockWrong'));
  }

  const type = (d: string) => {
    if (waiting || checking) return;
    setError(null);
    const value = (pin + d).slice(0, length);
    setPin(value);
    // checked as soon as the PIN's own number of digits is in (no OK key needed)
    if (value.length === length) void check(value);
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg, paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.l, paddingHorizontal: space.l, alignItems: 'center', justifyContent: 'space-between', direction: rtl ? 'rtl' : 'ltr' }}>
      <View style={{ alignItems: 'center', gap: space.m }}>
        <View style={{ width: 64, height: 64, borderRadius: radius.l, backgroundColor: p.highlight, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="lock" color={p.onHighlight} size={32} />
        </View>
        <Txt v="title" accessibilityRole="header" style={{ textAlign: 'center' }}>{t('lockTitle')}</Txt>
        <PinDots length={length} filled={pin.length} />
        {waiting ? <Banner kind="warn" text={t('lockWait', { s: Math.ceil((waitUntil - now) / 1000) })} />
          : error ? <Banner kind="bad" text={error} /> : <View style={{ height: 40 }} />}
      </View>
      <KeyPad onDigit={type} onDelete={() => setPin((v) => v.slice(0, -1))}
        extra={biometric ? { icon: 'fingerprint', label: t('useBiometric'), onPress: () => void askBiometric() } : undefined} />
      <Button kind="ghost" label={t('forgotPin')} onPress={async () => {
        if (await confirm(t('forgotPin'), t('forgotPinConfirm'), t('unpair'), t('cancel'))) await onForgot();
      }} />
    </View>
  );
}

/** The phone has a fingerprint or face the app may use. */
export async function biometricReady(): Promise<boolean> {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}
