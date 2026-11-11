import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * The app's icons: drawn here on a 24-unit grid with 2-unit round strokes (the desktop app's line style), so no icon
 * font or image is needed. Icons that point a way (back, forward, send) are mirrored in Arabic and Kurdish.
 */

const S = { fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const ICONS = {
  home: (c: string) => <><Path {...S} stroke={c} d="M3.5 11 12 4l8.5 7" /><Path {...S} stroke={c} d="M5.5 9.5V20h13V9.5" /><Path {...S} stroke={c} d="M10 20v-5.5h4V20" /></>,
  box: (c: string) => <><Path {...S} stroke={c} d="M3.5 7.5 12 3.5l8.5 4-8.5 4-8.5-4Z" /><Path {...S} stroke={c} d="M3.5 7.5v9l8.5 4 8.5-4v-9" /><Path {...S} stroke={c} d="M12 11.5v9" /></>,
  cart: (c: string) => <><Path {...S} stroke={c} d="M3 4h2.2l2.3 11h10.3L20 8H6.3" /><Circle {...S} stroke={c} cx={9} cy={19.5} r={1.4} /><Circle {...S} stroke={c} cx={17} cy={19.5} r={1.4} /></>,
  users: (c: string) => <><Circle {...S} stroke={c} cx={9} cy={8} r={3.5} /><Path {...S} stroke={c} d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><Path {...S} stroke={c} d="M16 5a3 3 0 0 1 0 6" /><Path {...S} stroke={c} d="M18 14.3c2 .7 3.5 2.6 3.5 5.2" /></>,
  more: (c: string) => <><Circle cx={5} cy={12} r={1.8} fill={c} /><Circle cx={12} cy={12} r={1.8} fill={c} /><Circle cx={19} cy={12} r={1.8} fill={c} /></>,
  scan: (c: string) => <><Path {...S} stroke={c} d="M4 8.5V5a1 1 0 0 1 1-1h3.5M15.5 4H19a1 1 0 0 1 1 1v3.5M20 15.5V19a1 1 0 0 1-1 1h-3.5M8.5 20H5a1 1 0 0 1-1-1v-3.5" /><Path {...S} stroke={c} d="M8 8.5v7M11 8.5v7M14 8.5v7M17 8.5v7" /></>,
  search: (c: string) => <><Circle {...S} stroke={c} cx={10.5} cy={10.5} r={6.5} /><Path {...S} stroke={c} d="m15.5 15.5 5 5" /></>,
  plus: (c: string) => <Path {...S} stroke={c} d="M12 5v14M5 12h14" />,
  minus: (c: string) => <Path {...S} stroke={c} d="M5 12h14" />,
  back: (c: string) => <Path {...S} stroke={c} d="m15 5-7 7 7 7" />,
  forward: (c: string) => <Path {...S} stroke={c} d="m9 5 7 7-7 7" />,
  check: (c: string) => <Path {...S} stroke={c} d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: (c: string) => <><Path {...S} stroke={c} d="M12 4 2.8 19.5h18.4L12 4Z" /><Path {...S} stroke={c} d="M12 10v4.5" /><Circle cx={12} cy={17.2} r={1.1} fill={c} /></>,
  info: (c: string) => <><Circle {...S} stroke={c} cx={12} cy={12} r={9} /><Path {...S} stroke={c} d="M12 11v5.5" /><Circle cx={12} cy={7.8} r={1.1} fill={c} /></>,
  wifi: (c: string) => <><Path {...S} stroke={c} d="M2.5 9a14 14 0 0 1 19 0M5.5 12.3a9.5 9.5 0 0 1 13 0M8.7 15.5a5 5 0 0 1 6.6 0" /><Circle cx={12} cy={19} r={1.3} fill={c} /></>,
  cloud: (c: string) => <Path {...S} stroke={c} d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.4 9.6 4.5 4.5 0 0 0 7 18.5Z" />,
  cloudOff: (c: string) => <><Path {...S} stroke={c} d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.4 9.6 4.5 4.5 0 0 0 7 18.5Z" /><Path {...S} stroke={c} d="m3.5 3.5 17 17" /></>,
  lock: (c: string) => <><Rect {...S} stroke={c} x={5} y={10.5} width={14} height={10} rx={2} /><Path {...S} stroke={c} d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  fingerprint: (c: string) => <><Path {...S} stroke={c} d="M5 8.5a8 8 0 0 1 14 0" /><Path {...S} stroke={c} d="M7 13.5V12a5 5 0 0 1 10 0v1.5c0 2.3-.4 4.4-1.2 6.3" /><Path {...S} stroke={c} d="M12 11.5v2.5c0 2.5-.6 4.8-1.8 6.7" /><Path {...S} stroke={c} d="M7.3 17.5a12 12 0 0 1-.3 1.8" /></>,
  trash: (c: string) => <><Path {...S} stroke={c} d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /><Path {...S} stroke={c} d="M10 11v5.5M14 11v5.5" /></>,
  refresh: (c: string) => <><Path {...S} stroke={c} d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><Path {...S} stroke={c} d="M19.5 4.5v4.5H15" /></>,
  cash: (c: string) => <><Rect {...S} stroke={c} x={2.5} y={6} width={19} height={12} rx={2} /><Circle {...S} stroke={c} cx={12} cy={12} r={2.8} /><Path {...S} stroke={c} d="M6 9.5v.01M18 14.5v.01" /></>,
  doc: (c: string) => <><Path {...S} stroke={c} d="M6 3h8l4 4v14H6V3Z" /><Path {...S} stroke={c} d="M14 3v4h4M9 12h6M9 16h6" /></>,
  clipboard: (c: string) => <><Rect {...S} stroke={c} x={5} y={4.5} width={14} height={16.5} rx={2} /><Rect {...S} stroke={c} x={9} y={3} width={6} height={3.5} rx={1} /><Path {...S} stroke={c} d="m8.5 12 2 2 4-4M8.5 17.5h7" /></>,
  send: (c: string) => <><Path {...S} stroke={c} d="M4 11.5 20 4l-6 16-2.6-6.8L4 11.5Z" /><Path {...S} stroke={c} d="M11.4 13.2 20 4" /></>,
  user: (c: string) => <><Circle {...S} stroke={c} cx={12} cy={8} r={4} /><Path {...S} stroke={c} d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></>,
  sliders: (c: string) => <><Path {...S} stroke={c} d="M4 7h9M17 7h3M4 17h3M11 17h9" /><Circle {...S} stroke={c} cx={15} cy={7} r={2} /><Circle {...S} stroke={c} cx={9} cy={17} r={2} /></>,
  camera: (c: string) => <><Path {...S} stroke={c} d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.5-2.5h5.4L16.2 7h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z" /><Circle {...S} stroke={c} cx={12} cy={12.5} r={3.5} /></>,
  close: (c: string) => <Path {...S} stroke={c} d="M6 6l12 12M18 6 6 18" />,
  outbox: (c: string) => <><Path {...S} stroke={c} d="M4 14v5h16v-5" /><Path {...S} stroke={c} d="M12 15V4M8 8l4-4 4 4" /></>,
  phone: (c: string) => <><Rect {...S} stroke={c} x={7} y={2.5} width={10} height={19} rx={2} /><Path {...S} stroke={c} d="M11 18.5h2" /></>,
  shield: (c: string) => <Path {...S} stroke={c} d="M12 3 19 6v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3Z" />,
  globe: (c: string) => <><Circle {...S} stroke={c} cx={12} cy={12} r={9} /><Path {...S} stroke={c} d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z" /></>,
  contrast: (c: string) => <><Circle {...S} stroke={c} cx={12} cy={12} r={8.5} /><Path d="M12 3.5a8.5 8.5 0 0 1 0 17V3.5Z" fill={c} /></>,
  unlink: (c: string) => <><Path {...S} stroke={c} d="m8 11-2 2a3.5 3.5 0 0 0 5 5l2-2M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2" /><Path {...S} stroke={c} d="M3.5 3.5l3 3M20.5 20.5l-3-3" /></>,
  qr: (c: string) => <><Rect {...S} stroke={c} x={4} y={4} width={6} height={6} rx={1} /><Rect {...S} stroke={c} x={14} y={4} width={6} height={6} rx={1} /><Rect {...S} stroke={c} x={4} y={14} width={6} height={6} rx={1} /><Path {...S} stroke={c} d="M14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18v2" /></>,
  backspace: (c: string) => <><Path {...S} stroke={c} d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7 6-7Z" /><Path {...S} stroke={c} d="m12.5 9.5 5 5M17.5 9.5l-5 5" /></>,
  flash: (c: string) => <Path {...S} stroke={c} d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />,
  tag: (c: string) => <><Path {...S} stroke={c} d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9-8-8Z" /><Circle cx={8.5} cy={8.5} r={1.4} fill={c} /></>
} as const;

export type IconName = keyof typeof ICONS;
const MIRRORED: readonly IconName[] = ['back', 'forward', 'send'];

export function Icon({ name, color, size = 24, rtl = false }: { name: IconName; color: string; size?: number; rtl?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={rtl && MIRRORED.includes(name) ? { transform: [{ scaleX: -1 }] } : undefined} accessible={false}>
      {ICONS[name](color)}
    </Svg>
  );
}
