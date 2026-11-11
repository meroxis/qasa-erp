import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Button, EmptyState, IconButton, Screen, Txt, useLook } from '../ui';
import { radius, space } from '../theme';

const BARCODES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'codabar', 'qr', 'datamatrix'];

/**
 * The camera for barcodes and the pairing QR code: a frame to aim with, the torch for dark shelves, and one buzz per
 * code read (the camera reports the same code many times a second: once per 2 seconds).
 */
export function Scanner({ title, hint, onCode, onBack, qrOnly }: { title: string; hint: string; onCode(code: string): void; onBack(): void; qrOnly?: boolean }) {
  const { t, rtl } = useLook();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const last = useRef<{ code: string; at: number } | null>(null);
  if (!permission) return <Screen title={title} onBack={onBack} banner={false}><Txt tone="ink2">{t('loading')}</Txt></Screen>;
  if (!permission.granted) {
    return (
      <Screen title={title} onBack={onBack} banner={false}>
        <EmptyState icon="camera" title={t('cameraNeeded')} action={{ label: t('allowCamera'), onPress: () => void requestPermission(), icon: 'camera' }} />
      </Screen>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#000', direction: rtl ? 'rtl' : 'ltr' }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: qrOnly ? ['qr'] : BARCODES }}
        onBarcodeScanned={(r) => {
          const now = Date.now();
          if (!r.data || r.data.length > 4096) return;
          if (last.current && last.current.code === r.data && now - last.current.at < 2000) return;
          last.current = { code: r.data, at: now };
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onCode(r.data);
        }}
      />
      {/* the frame to aim with */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: qrOnly ? 240 : 280, height: qrOnly ? 240 : 170, borderRadius: radius.l, borderWidth: 3, borderColor: '#F2A33A' }} />
      </View>
      <View style={{ position: 'absolute', top: insets.top + space.s, start: space.s, end: space.s, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ backgroundColor: 'rgba(15,30,61,0.7)', borderRadius: 24 }}><IconButton icon="back" label={t('back')} onPress={onBack} tone="onBrand" /></View>
        <View style={{ backgroundColor: torch ? '#F2A33A' : 'rgba(15,30,61,0.7)', borderRadius: 24 }}>
          <IconButton icon="flash" label={t('torch')} onPress={() => setTorch((v) => !v)} color={torch ? '#0F1E3D' : '#FFFFFF'} />
        </View>
      </View>
      <View style={{ position: 'absolute', start: 0, end: 0, bottom: 0, padding: space.l, paddingBottom: insets.bottom + space.l, gap: space.m, backgroundColor: 'rgba(15,30,61,0.88)' }}>
        <Txt v="headline" tone="onBrand" style={{ textAlign: 'center' }}>{hint}</Txt>
        <Button kind="secondary" label={t('close')} onPress={onBack} />
      </View>
    </View>
  );
}
