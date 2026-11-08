import { createContext, useContext, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import type { OfficeApi } from './api';
import type { Key, Lang } from './i18n';
import type { LinkState } from './link';

/** What every screen gets: the language, the office link, and the outbox. */
export interface AppCtx {
  lang: Lang;
  rtl: boolean;
  t(key: Key, vars?: Record<string, string | number>): string;
  api: OfficeApi;
  state: LinkState;
  company: string;
  queue(kind: 'sale' | 'count', body: unknown): Promise<'sent' | 'queued'>;
  queued: number;
  go(screen: Screen): void;
  explain(error: unknown): string;
}

export type Screen =
  | { name: 'home' }
  | { name: 'scan'; purpose: 'look' | 'cart' | 'count' }
  | { name: 'item'; code: string; itemId?: string | undefined; purpose: 'look' | 'cart' | 'count' }
  | { name: 'newItem'; barcode: string }
  | { name: 'search' }
  | { name: 'cart' }
  | { name: 'count' }
  | { name: 'settings' };

export const Ctx = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('outside the app');
  return ctx;
}

export const colors = {
  brand: '#0F2A3D', accent: '#E8A23A', bg: '#F6F5F1', card: '#FFFFFF', text: '#13202B', muted: '#55606B', line: '#E4E1D8',
  ok: '#1F7A52', okBg: '#DDF1E8', bad: '#A4271A', badBg: '#F9D7D3'
};

export function Page({ title, onBack, children }: { title: string; onBack?: () => void; children: ReactNode }) {
  const { rtl, t } = useApp();
  return (
    <View style={[s.page, { direction: rtl ? 'rtl' : 'ltr' }]}>
      <View style={s.header}>
        {onBack && <Pressable accessibilityRole="button" onPress={onBack} style={s.back} hitSlop={12}><Text style={s.backText}>{rtl ? '›' : '‹'} {t('back')}</Text></Pressable>}
        <Text style={s.title} numberOfLines={1}>{title}</Text>
      </View>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    </View>
  );
}

export function Button({ label, onPress, kind = 'primary', disabled, busy }: {
  label: string; onPress(): void; kind?: 'primary' | 'plain' | 'danger'; disabled?: boolean | undefined; busy?: boolean | undefined;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [s.btn, kind === 'primary' ? s.btnPrimary : kind === 'danger' ? s.btnDanger : s.btnPlain, (pressed || disabled) && { opacity: 0.6 }]}
    >
      {busy ? <ActivityIndicator color={kind === 'primary' ? '#fff' : colors.brand} /> : (
        <Text style={[s.btnText, kind === 'primary' ? { color: '#fff' } : kind === 'danger' ? { color: colors.bad } : { color: colors.brand }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={s.card}>{children}</View>;
}

export function Field({ label, ...input }: TextInputProps & { label: string }) {
  const { rtl } = useApp();
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} {...input} style={[s.input, { textAlign: rtl ? 'right' : 'left' }, input.style]} />
    </View>
  );
}

export function Note({ text, kind = 'plain' }: { text: string; kind?: 'plain' | 'ok' | 'bad' }) {
  return (
    <View style={[s.note, kind === 'ok' ? { backgroundColor: colors.okBg } : kind === 'bad' ? { backgroundColor: colors.badBg } : null]}>
      <Text style={[s.noteText, kind === 'ok' ? { color: colors.ok } : kind === 'bad' ? { color: colors.bad } : null]}>{text}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.brand, paddingTop: 48, paddingBottom: 14, paddingHorizontal: 18, gap: 6 },
  back: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  backText: { color: '#C9D4DE', fontSize: 16 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'auto' },
  body: { padding: 16, gap: 14 },
  btn: { minHeight: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  btnPrimary: { backgroundColor: colors.brand },
  btnPlain: { backgroundColor: '#fff', borderWidth: 2, borderColor: colors.line },
  btnDanger: { backgroundColor: '#fff', borderWidth: 2, borderColor: colors.badBg },
  btnText: { fontSize: 18, fontWeight: '700' },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 10 },
  label: { color: colors.muted, fontSize: 14, fontWeight: '600', textAlign: 'auto' },
  input: { minHeight: 52, borderRadius: 12, borderWidth: 2, borderColor: colors.line, backgroundColor: '#fff', paddingHorizontal: 14, fontSize: 18, color: colors.text },
  note: { borderRadius: 12, padding: 12, backgroundColor: '#EEF1F4' },
  noteText: { fontSize: 15, color: colors.text, textAlign: 'auto', lineHeight: 22 },
  big: { fontSize: 28, fontWeight: '700', color: colors.text, textAlign: 'auto' },
  text: { fontSize: 16, color: colors.text, textAlign: 'auto' },
  muted: { fontSize: 14, color: colors.muted, textAlign: 'auto' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }
});
