import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { NetworkSwitch } from './Settings.tsx';
import { makeI18n } from '../i18n.ts';

// Settings → Office network (1.4.3): switching the office network off asks first, because the other PCs, Qasa Relay and
// the phones and PCs that come through it lose their connection to this PC until it is switched on again. Switching it
// on asks nothing. The switch is walked as plain elements, without a browser.
vi.mock('react', () => ({ useState: <T,>(v: T) => [v, () => {}], useEffect() {}, createContext: () => ({}), useContext: () => ({}) }));
vi.mock('../components.tsx', () => ({ AccountCombo: 'AccountCombo', ErrorBox: 'ErrorBox', Icon: 'Icon', Modal: 'Modal', downloadCsv: () => {} }));
vi.mock('../i18n.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../i18n.ts')>();
  return { ...real, useI18n: () => real.makeI18n('en', 'western', () => {}, () => {}) };
});
vi.mock('../router.ts', () => ({ href: (s: string) => s }));

type Node = ReactElement<Record<string, unknown>>;
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...flatten(node.props.children)];
}
const confirm = vi.fn(() => true);
const button = (on: boolean, busy = false) => {
  const onSwitch = vi.fn();
  const node = flatten(NetworkSwitch({ on, busy, onSwitch })).find((n) => n.type === 'button')!;
  return { node, onSwitch, press: () => (node.props.onClick as () => void)() };
};
const LANGS = ['ar', 'en', 'ku'] as const;
const text = (lang: (typeof LANGS)[number]) => makeI18n(lang, 'western', () => {}, () => {}).t('netTurnOffConfirm');

beforeEach(() => { confirm.mockReset().mockReturnValue(true); vi.stubGlobal('window', { confirm }); });
afterEach(() => { vi.unstubAllGlobals(); });

it('asks before switching the office network off, and switches it off only when the answer is yes', () => {
  const { node, onSwitch, press } = button(true);
  expect(node.props.children).toBe('Switch off the office network');
  confirm.mockReturnValue(false);
  press();
  expect(confirm).toHaveBeenCalledWith(text('en'));
  expect(onSwitch).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  press();
  expect(onSwitch).toHaveBeenCalledTimes(1);
  expect(onSwitch).toHaveBeenCalledWith(false);
});

it('switches it on without asking', () => {
  const { node, onSwitch, press } = button(false);
  expect(node.props.children).toBe('Switch on the office network');
  expect(node.props.className).toBe('btn primary');
  press();
  expect(confirm).not.toHaveBeenCalled();
  expect(onSwitch).toHaveBeenCalledWith(true);
  // while a switch is being made the button waits
  expect(button(true, true).node.props.disabled).toBe(true);
});

it('says, in Arabic, English and Kurdish, who loses the connection to this PC until the network is switched on again', () => {
  expect(text('en')).toBe('Switch off the office network? Until you switch it on again, the other PCs lose their connection to this PC, and so do Qasa Relay and the phones and PCs that connect through it.');
  // in the app's own words: the office network, the other PCs, the phones, switching it on again
  const [ar, , ku] = LANGS.map(text);
  for (const word of ['إيقاف شبكة المكتب؟', 'الحواسيب الأخرى', 'Qasa Relay', 'والهواتف', 'تشغّلها من جديد']) expect(ar, word).toContain(word);
  for (const word of ['تۆڕی نووسینگە بکوژێنرێتەوە؟', 'کۆمپیوتەرەکانی تر', 'Qasa Relay', 'مۆبایل', 'دووبارە هەڵیبکەیتەوە']) expect(ku, word).toContain(word);
  expect(ku).not.toMatch(/[ىيكـ]/);
  // the office network's card uses this switch (the card itself loads its state from the server)
  const settings = readFileSync(new URL('./Settings.tsx', import.meta.url), 'utf8');
  expect(settings).toContain('<NetworkSwitch on={status.on} busy={busy} onSwitch={(on) => void toggle(on)} />');
  expect(settings.match(/t\('netTurnOff'\)/g)).toHaveLength(1);
});
