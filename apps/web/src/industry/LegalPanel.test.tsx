import { afterEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { LegalPanel, NOTICES } from './LegalPanel.tsx';

// Settings → About & legal without a browser: the tree is walked as plain elements.
vi.mock('../i18n.ts', () => ({ useI18n: () => ({ t: (s: string) => s, lang: 'en' }) }));

type Node = ReactElement<Record<string, unknown>>;
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...flatten(node.props.children)];
}
const notices = () => flatten(LegalPanel()).find((n) => (n.type === 'a' || n.type === 'button') && n.props.children === 'lg_thirdParty')!;
const windowsApp = (openNotices: () => Promise<boolean>) => {
  const open = vi.fn();
  vi.stubGlobal('window', { qasaDesktop: { setLanguage() {}, openNotices: vi.fn(openNotices) }, open });
  return { open, desktop: (globalThis as unknown as { window: { qasaDesktop: { openNotices: ReturnType<typeof vi.fn> } } }).window.qasaDesktop };
};

afterEach(() => { vi.unstubAllGlobals(); });

it('links to the notices online in the browser and the demo', () => {
  const link = notices();
  expect(link.type).toBe('a');
  expect(link.props.href).toBe(NOTICES);
  expect(NOTICES).toMatch(/^https:\/\/github\.com\/meroxis\/qasa-erp\/.*THIRD_PARTY_NOTICES\.md$/);
});

it('opens the notices installed with the Windows app, without the internet', async () => {
  const { open, desktop } = windowsApp(async () => true);
  const button = notices();
  expect(button.type).toBe('button');
  expect(button.props.href).toBeUndefined();
  (button.props.onClick as () => void)();
  expect(desktop.openNotices).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  await Promise.resolve();
  expect(open).not.toHaveBeenCalled();
});

it('falls back to the notices online when the installed copy can’t be opened', async () => {
  for (const answer of [async () => false, async () => { throw new Error('no handler'); }]) {
    const { open } = windowsApp(answer);
    (notices().props.onClick as () => void)();
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith(NOTICES, '_blank', 'noopener'));
    vi.unstubAllGlobals();
  }
});

it('keeps the link on a Windows app from before 1.0, which has no such bridge call', () => {
  vi.stubGlobal('window', { qasaDesktop: { setLanguage() {} }, open: vi.fn() });
  expect(notices().type).toBe('a');
});
