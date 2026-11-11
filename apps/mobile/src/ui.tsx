import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Animated, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { OfficeApi } from './api';
import { translate, type Key, type Lang } from './i18n';
import { Icon, type IconName } from './icons';
import { LinkError, type Route as LinkRoute, type LinkState } from './link';
import type { NavAction, Route, Tab } from './nav';
import type { OutboxItem, OutboxKind, OutboxSummary } from './outbox';
import type { Feature, Me } from './roles';
import { fontFor, PALETTES, radius, space, TOUCH, typeScale, type Palette, type Scheme, type TextVariant, type Weight } from './theme';

// ——— the look: language, direction, colours, fonts ———

export interface Look {
  lang: Lang;
  rtl: boolean;
  scheme: Scheme;
  p: Palette;
  /** the bundled fonts are loaded (until then, the system's) */
  fonts: boolean;
  t(key: Key, vars?: Record<string, string | number>): string;
}

export const LookCtx = createContext<Look>({
  lang: 'en', rtl: false, scheme: 'light', p: PALETTES.light, fonts: false, t: (k, v) => translate('en', k, v)
});
export const useLook = () => useContext(LookCtx);

// ——— what every screen gets once paired: the office, the outbox, navigation ———

export interface AppCtx {
  api: OfficeApi;
  state: LinkState;
  via: LinkRoute | null;
  /** the office's last refusal code (when state is 'refused') */
  detail: string | undefined;
  company: string;
  me: Me | null;
  can(feature: Feature): boolean;
  outbox: OutboxItem[];
  /**
   * A change for the office: kept in the outbox (encrypted) first, then sent with its own key. 'sent': the office has
   * it; 'queued': it goes by itself once connected. A refusal from the office is thrown (and nothing is kept).
   */
  queue(kind: OutboxKind, body: unknown, summary: OutboxSummary, target?: string): Promise<'sent' | 'queued'>;
  sendOutbox(): void;
  retryOutbox(id: string): Promise<void>;
  deleteOutbox(id: string): Promise<void>;
  nav(action: NavAction): void;
  go(route: Route): void;
  back(): void;
  reconnect(): void;
  explain(error: unknown): string;
  toast(text: string, kind?: 'ok' | 'bad' | 'plain'): void;
  refreshMe(): void;
}

export const Ctx = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('outside the app');
  return ctx;
}

// ——— text ———

const SYSTEM_WEIGHT: Record<Weight, TextStyle['fontWeight']> = { regular: '400', semibold: '600', bold: '700' };

/** Aligned to the reading side: right in Arabic and Kurdish, left in English. */
export const startAlign = (rtl: boolean): TextStyle => ({ textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' });

export function useTextStyle(v: TextVariant, numeric = false): TextStyle {
  const { lang, fonts, rtl } = useLook();
  const s = typeScale(lang)[v];
  const family = s.family === 'number' || numeric ? 'number' : lang;
  return {
    fontSize: s.fontSize, lineHeight: s.lineHeight, ...startAlign(rtl),
    ...(fonts ? { fontFamily: fontFor(family, s.weight) } : { fontWeight: SYSTEM_WEIGHT[s.weight] }),
    ...(family === 'number' ? { fontVariant: ['tabular-nums'] } : {})
  };
}

type Tone = 'ink' | 'ink2' | 'ink3' | 'accentText' | 'ok' | 'warn' | 'bad' | 'info' | 'onBrand' | 'onBrand2' | 'onAccent' | 'onHighlight';

export function Txt({ v = 'body', tone = 'ink', numeric, style, children, ...rest }: TextProps & { v?: TextVariant; tone?: Tone; numeric?: boolean }) {
  const { p } = useLook();
  const base = useTextStyle(v, numeric);
  return <Text maxFontSizeMultiplier={1.5} {...rest} style={[base, { color: p[tone] }, style]}>{children}</Text>;
}

// ——— screens ———

/**
 * A screen: its header (a large title on a tab's first screen, a back arrow and a title on the others), the
 * connection bar when the office can't be reached, and its content (scrolling, with pull to refresh when given).
 */
export function Screen({ title, subtitle, large, onBack, right, children, onRefresh, refreshing, scroll = true, footer, banner = true }: {
  title: string; subtitle?: string | undefined; large?: boolean; onBack?: (() => void) | undefined; right?: ReactNode;
  children: ReactNode; onRefresh?: (() => void) | undefined; refreshing?: boolean | undefined; scroll?: boolean; footer?: ReactNode; banner?: boolean;
}) {
  const { p, rtl, t } = useLook();
  const insets = useSafeAreaInsets();
  const app = useContext(Ctx);
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={{ padding: space.l, gap: space.m, paddingBottom: space.xxl }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={p.accent} colors={[p.accent]} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : <View style={{ flex: 1 }}>{children}</View>;
  return (
    <View style={{ flex: 1, backgroundColor: p.bg, direction: rtl ? 'rtl' : 'ltr' }}>
      <View style={{ paddingTop: insets.top + space.s, paddingHorizontal: space.l, paddingBottom: space.s, backgroundColor: p.bg, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: TOUCH, gap: space.s }}>
          {onBack && <IconButton icon="back" label={t('back')} onPress={onBack} />}
          <View style={{ flex: 1 }}>
            <Txt v={large ? 'display' : 'headline'} numberOfLines={1} accessibilityRole="header">{title}</Txt>
          </View>
          {right}
        </View>
        {subtitle ? <Txt v="caption" tone="ink3" numberOfLines={1}>{subtitle}</Txt> : null}
      </View>
      {banner && app && <ConnectionBar />}
      {/* padding on both systems: with Android's edge-to-edge screens the window no longer shrinks for the keyboard */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {body}
        {footer ? <View style={{ padding: space.l, paddingTop: space.s, gap: space.s, borderTopWidth: 1, borderTopColor: p.line, backgroundColor: p.surface }}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </View>
  );
}

/** A thin bar under the header while the office can't be reached: what is wrong, and a way to try now. */
export function ConnectionBar() {
  const { t } = useLook();
  const app = useApp();
  if (app.state === 'online') return null;
  if (app.state === 'connecting') return <Banner kind="info" icon="refresh" text={t('connecting')} compact />;
  const text = app.state === 'refused' && app.detail ? app.explain(new LinkError(app.detail as LinkError['code'])) : t('offline');
  return <Banner kind={app.state === 'refused' ? 'bad' : 'warn'} icon="cloudOff" text={text} compact action={{ label: t('retry'), onPress: app.reconnect }} />;
}

// ——— controls ———

export function Button({ label, onPress, kind = 'primary', icon, busy, disabled, hint, style }: {
  label: string; onPress(): void; kind?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: IconName | undefined;
  busy?: boolean | undefined; disabled?: boolean | undefined; hint?: string | undefined; style?: StyleProp<ViewStyle>;
}) {
  const { p, rtl } = useLook();
  const off = !!disabled || !!busy;
  const bg = kind === 'primary' ? p.accent : kind === 'danger' ? p.badBg : kind === 'secondary' ? p.surface : 'transparent';
  const fg = kind === 'primary' ? p.onAccent : kind === 'danger' ? p.bad : p.accentText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [{
        minHeight: 52, borderRadius: radius.m, paddingHorizontal: space.l, backgroundColor: bg,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s,
        borderWidth: kind === 'secondary' ? 1 : 0, borderColor: p.line, opacity: disabled ? 0.45 : pressed ? 0.8 : 1
      }, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : (
        <>
          {icon && <Icon name={icon} color={fg} size={20} rtl={rtl} />}
          <Txt v="bodyStrong" style={{ color: fg, textAlign: 'center' }} numberOfLines={1}>{label}</Txt>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, tone = 'ink', badge, color }: { icon: IconName; label: string; onPress(): void; tone?: 'ink' | 'accentText' | 'bad' | 'onBrand'; badge?: number; color?: string }) {
  const { p, rtl } = useLook();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4}
      style={({ pressed }) => ({ width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.surface2 : 'transparent' })}>
      <Icon name={icon} color={color ?? p[tone]} rtl={rtl} />
      {badge ? <Badge n={badge} style={{ position: 'absolute', top: 6, end: 4 }} /> : null}
    </Pressable>
  );
}

export function Badge({ n, style }: { n: number; style?: StyleProp<ViewStyle> }) {
  const { p } = useLook();
  return (
    <View style={[{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: p.highlight, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Txt v="caption" numeric tone="onHighlight" style={{ fontSize: 11, lineHeight: 14, textAlign: 'center' }}>{n > 99 ? '99+' : String(n)}</Txt>
    </View>
  );
}

export function Card({ children, onPress, style, label }: { children: ReactNode; onPress?: (() => void) | undefined; style?: StyleProp<ViewStyle>; label?: string }) {
  const { p } = useLook();
  const box: ViewStyle = { backgroundColor: p.surface, borderRadius: radius.l, borderWidth: 1, borderColor: p.line, padding: space.l, gap: space.s };
  if (!onPress) return <View style={[box, style]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [box, pressed && { backgroundColor: p.surface2 }, style]}>
      {children}
    </Pressable>
  );
}

/** A row in a list: an icon, a title and a line under it, a value at the end, and an arrow when it opens something. */
export function ListItem({ title, subtitle, value, valueTone = 'ink', icon, onPress, chevron = !!onPress, label, right }: {
  title: string; subtitle?: string | undefined; value?: string | undefined; valueTone?: Tone; icon?: IconName | undefined;
  onPress?: (() => void) | undefined; chevron?: boolean; label?: string | undefined; right?: ReactNode;
}) {
  const { p, rtl } = useLook();
  const content = (pressed: boolean) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, paddingVertical: space.s, paddingHorizontal: space.l, backgroundColor: pressed ? p.surface2 : p.surface }}>
      {icon && (
        <View style={{ width: 40, height: 40, borderRadius: radius.m, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} color={p.accentText} size={22} rtl={rtl} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="bodyStrong" numberOfLines={2}>{title}</Txt>
        {subtitle ? <Txt v="caption" tone="ink3" numberOfLines={2}>{subtitle}</Txt> : null}
      </View>
      {value ? <Txt v="number" tone={valueTone} style={{ textAlign: rtl ? 'left' : 'right' }}>{value}</Txt> : null}
      {right}
      {chevron && <Icon name="forward" color={p.ink3} size={20} rtl={rtl} />}
    </View>
  );
  if (!onPress) return <View accessible accessibilityLabel={label}>{content(false)}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label ?? [title, subtitle, value].filter(Boolean).join(', ')} onPress={onPress}>{({ pressed }) => content(pressed)}</Pressable>;
}

/** Rows grouped on one card, with lines between them. */
export function Group({ children }: { children: ReactNode }) {
  const { p } = useLook();
  const rows = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <View style={{ borderRadius: radius.l, borderWidth: 1, borderColor: p.line, overflow: 'hidden', backgroundColor: p.surface }}>
      {rows.map((row, i) => <View key={i} style={i ? { borderTopWidth: 1, borderTopColor: p.line } : undefined}>{row}</View>)}
    </View>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: { label: string; onPress(): void } | undefined }) {
  const { p } = useLook();
  return (
    <View style={{ gap: space.s, marginTop: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 }}>
        <Txt v="label" tone="ink2" accessibilityRole="header" style={{ flex: 1 }}>{title}</Txt>
        {action && (
          <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={12} style={{ minHeight: 32, justifyContent: 'center' }}>
            <Txt v="label" style={{ color: p.accentText }}>{action.label}</Txt>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

export function Field({ label, hint, error, numeric, ...input }: TextInputProps & { label: string; hint?: string | undefined; error?: string | null | undefined; numeric?: boolean }) {
  const { p, rtl } = useLook();
  const text = useTextStyle(numeric ? 'numberLarge' : 'body', numeric);
  return (
    <View style={{ gap: 6 }}>
      <Txt v="label" tone="ink2">{label}</Txt>
      <TextInput
        placeholderTextColor={p.ink3}
        accessibilityLabel={label}
        accessibilityHint={hint}
        maxFontSizeMultiplier={1.5}
        {...input}
        style={[text, {
          minHeight: numeric ? 60 : 52, borderRadius: radius.m, borderWidth: 1.5, borderColor: error ? p.bad : p.line, backgroundColor: input.editable === false ? p.surface2 : p.surface,
          paddingHorizontal: space.l, paddingVertical: space.s, color: p.ink, textAlign: rtl ? 'right' : 'left'
        }, input.style]}
      />
      {error ? <Txt v="caption" tone="bad" accessibilityLiveRegion="polite">{error}</Txt> : hint ? <Txt v="caption" tone="ink3">{hint}</Txt> : null}
    </View>
  );
}

/** Two to four choices side by side; the chosen one is filled. */
export function Segmented<const T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange(v: T): void; label?: string }) {
  const { p } = useLook();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: p.surface2, borderRadius: radius.m, padding: 4, gap: 4 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o.value)}
            style={{ flex: 1, minHeight: 44, borderRadius: radius.s, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.s, backgroundColor: on ? p.surface : 'transparent', borderWidth: on ? 1 : 0, borderColor: p.line }}>
            <Txt v="label" tone={on ? 'ink' : 'ink2'} numberOfLines={1} style={{ textAlign: 'center' }}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress(): void }) {
  const { p } = useLook();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={onPress}
      style={{ minHeight: 44, paddingHorizontal: space.l, borderRadius: radius.pill, justifyContent: 'center', borderWidth: 1, borderColor: on ? p.accent : p.line, backgroundColor: on ? p.accentSoft : p.surface }}>
      <Txt v="label" tone={on ? 'accentText' : 'ink2'}>{label}</Txt>
    </Pressable>
  );
}

export function Banner({ kind = 'info', text, icon, action, compact }: {
  kind?: 'info' | 'ok' | 'warn' | 'bad'; text: string; icon?: IconName | undefined; action?: { label: string; onPress(): void } | undefined; compact?: boolean;
}) {
  const { p, rtl } = useLook();
  const fg = p[kind];
  const bg = p[`${kind}Bg` as const];
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: bg, paddingHorizontal: space.l, paddingVertical: compact ? space.s : space.m, borderRadius: compact ? 0 : radius.m }}>
      <Icon name={icon ?? (kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert')} color={fg} size={20} rtl={rtl} />
      <Txt v="caption" style={{ flex: 1, color: fg }}>{text}</Txt>
      {action && (
        <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: space.s }}>
          <Txt v="label" style={{ color: fg, textDecorationLine: 'underline' }}>{action.label}</Txt>
        </Pressable>
      )}
    </View>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text?: string | undefined; action?: { label: string; onPress(): void; icon?: IconName } | undefined }) {
  const { p, rtl } = useLook();
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.l, gap: space.m }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} color={p.accentText} size={34} rtl={rtl} />
      </View>
      <Txt v="headline" style={{ textAlign: 'center' }}>{title}</Txt>
      {text ? <Txt tone="ink2" style={{ textAlign: 'center' }}>{text}</Txt> : null}
      {action && <Button label={action.label} icon={action.icon} onPress={action.onPress} style={{ alignSelf: 'stretch' }} />}
    </View>
  );
}

export function ErrorState({ text, onRetry }: { text: string; onRetry(): void }) {
  const { t } = useLook();
  return <EmptyState icon="alert" title={t('loadFailed')} text={text} action={{ label: t('retry'), onPress: onRetry, icon: 'refresh' }} />;
}

/** Grey blocks where content is coming, gently pulsing. */
export function Skeleton({ rows = 3, height = 56 }: { rows?: number; height?: number }) {
  const { p, t } = useLook();
  const [pulse] = useState(() => new Animated.Value(0.55));
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View accessible accessibilityLabel={t('loading')} accessibilityRole="progressbar" style={{ gap: space.s }}>
      {Array.from({ length: rows }, (_, i) => (
        <Animated.View key={i} style={{ height, borderRadius: radius.m, backgroundColor: p.skeleton, opacity: pulse }} />
      ))}
    </View>
  );
}

export function Stepper({ value, onChange, label, min = 1 }: { value: number; onChange(v: number): void; label: string; min?: number }) {
  const { p, t } = useLook();
  const btn = (icon: IconName, a11y: string, next: number, off: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`${a11y} ${label}`} disabled={off} onPress={() => onChange(next)}
      style={({ pressed }) => ({ width: TOUCH, height: TOUCH, borderRadius: radius.m, borderWidth: 1, borderColor: p.line, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.surface2 : p.surface, opacity: off ? 0.4 : 1 })}>
      <Icon name={icon} color={p.accentText} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }} accessibilityLabel={label}>
      {btn('minus', t('decrease'), Math.max(min, value - 1), value <= min)}
      <Txt v="number" style={{ minWidth: 44, textAlign: 'center' }} accessibilityLiveRegion="polite">{String(value)}</Txt>
      {btn('plus', t('increase'), value + 1, false)}
    </View>
  );
}

/** A figure on the home screen: what it is, the amount, and a line under it. */
export function Stat({ label, value, note, tone = 'ink', icon }: { label: string; value: string; note?: string | undefined; tone?: Tone; icon: IconName }) {
  const { p, rtl } = useLook();
  return (
    <View accessible accessibilityLabel={[label, value, note].filter(Boolean).join(', ')}
      style={{ flex: 1, minWidth: 150, backgroundColor: p.surface, borderRadius: radius.l, borderWidth: 1, borderColor: p.line, padding: space.l, gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Icon name={icon} color={p.ink3} size={18} rtl={rtl} />
        <Txt v="caption" tone="ink2" numberOfLines={1} style={{ flex: 1 }}>{label}</Txt>
      </View>
      <Txt v="numberLarge" tone={tone} numberOfLines={1} adjustsFontSizeToFit>{value}</Txt>
      {note ? <Txt v="caption" tone="ink3" numberOfLines={2}>{note}</Txt> : null}
    </View>
  );
}

// ——— the tab bar ———

export function TabBar({ tabs, current, onPress }: { tabs: { tab: Tab; icon: IconName; label: string; badge?: number }[]; current: Tab; onPress(tab: Tab): void }) {
  const { p, rtl } = useLook();
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', direction: rtl ? 'rtl' : 'ltr', backgroundColor: p.surface, borderTopWidth: 1, borderTopColor: p.line, paddingBottom: Math.max(insets.bottom, space.xs), paddingTop: space.xs }}>
      {tabs.map((tab) => {
        const on = tab.tab === current;
        return (
          <Pressable key={tab.tab} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={tab.badge ? `${tab.label}, ${tab.badge}` : tab.label}
            onPress={() => onPress(tab.tab)} style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <View style={{ paddingHorizontal: 18, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: on ? p.accentSoft : 'transparent' }}>
              <Icon name={tab.icon} color={on ? p.accentText : p.ink3} rtl={rtl} />
              {tab.badge ? <Badge n={tab.badge} style={{ position: 'absolute', top: -2, end: 6 }} /> : null}
            </View>
            <Txt v="caption" tone={on ? 'accentText' : 'ink3'} numberOfLines={1} style={{ fontSize: 12, lineHeight: 16, textAlign: 'center' }}>{tab.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// ——— the PIN pad ———

export function KeyPad({ onDigit, onDelete, extra }: { onDigit(d: string): void; onDelete(): void; extra?: { icon: IconName; label: string; onPress(): void } | undefined }) {
  const { p, t } = useLook();
  const key = (content: ReactNode, label: string, onPress: () => void, k: string) => (
    <Pressable key={k} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.surface2 : p.surface, borderWidth: 1, borderColor: p.line })}>
      {content}
    </Pressable>
  );
  const rows = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']];
  return (
    <View style={{ gap: space.m, alignItems: 'center', direction: 'ltr' }}>
      {rows.map((row) => (
        <View key={row.join('')} style={{ flexDirection: 'row', gap: space.xl }}>
          {row.map((d) => key(<Txt v="title" numeric style={{ textAlign: 'center' }}>{d}</Txt>, t('digitKey', { d }), () => onDigit(d), d))}
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: space.xl }}>
        {extra ? key(<Icon name={extra.icon} color={p.accentText} />, extra.label, extra.onPress, 'extra') : <View style={{ width: 76 }} />}
        {key(<Txt v="title" numeric style={{ textAlign: 'center' }}>0</Txt>, t('digitKey', { d: '0' }), () => onDigit('0'), '0')}
        {key(<Icon name="backspace" color={p.ink2} />, t('deleteDigit'), onDelete, 'del')}
      </View>
    </View>
  );
}

/** The dots showing how many digits are in. */
export function PinDots({ length, filled }: { length: number; filled: number }) {
  const { p } = useLook();
  return (
    <View style={{ flexDirection: 'row', gap: space.m, justifyContent: 'center', minHeight: 20, direction: 'ltr' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: Math.min(Math.max(length, filled), 8) }, (_, i) => (
        <View key={i} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: i < filled ? p.accent : 'transparent', borderWidth: 2, borderColor: p.accent }} />
      ))}
    </View>
  );
}
