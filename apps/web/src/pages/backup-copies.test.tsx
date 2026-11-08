import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { BackupCopyRow } from './Settings.tsx';
import { CLOUD_TEXT } from '../i18n/cloud.ts';

// Render a backup copy's row without a browser: the tree is walked as plain elements.
vi.mock('react', () => ({ useState: <T,>(v: T) => [v, () => {}], useEffect() {}, createContext: () => ({}), useContext: () => ({}) }));
vi.mock('../components.tsx', () => ({ AccountCombo: 'AccountCombo', ErrorBox: 'ErrorBox', Icon: 'Icon', Modal: 'Modal', downloadCsv: () => {} }));
vi.mock('../i18n.ts', () => ({ isKey: () => true, useI18n: () => ({ t: (s: string, v?: Record<string, string>) => (v ? `${s}${JSON.stringify(v)}` : s) }) }));
vi.mock('../router.ts', () => ({ href: (s: string) => s }));

type Node = ReactElement<Record<string, unknown>>;
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...flatten(node.props.children)];
}
const text = (nodes: Node[]) => JSON.stringify(nodes.map((n) => n.props.children ?? ''));
const confirm = vi.fn(() => true);
const row = (own: boolean | undefined, onRestore = vi.fn()) =>
  ({ nodes: flatten(BackupCopyRow({ copy: { encrypted: false, ...(own === undefined ? {} : { own }) }, when: '8 Nov 2026', size: '2 MB', disabled: false, onRestore })), onRestore });
const press = (nodes: Node[]) => (nodes.find((n) => n.type === 'button')!.props.onClick as () => void)();

beforeEach(() => { confirm.mockReset().mockReturnValue(true); vi.stubGlobal('window', { confirm }); });
afterEach(() => { vi.unstubAllGlobals(); });

it('marks a copy from another company or PC, and asks with its own warning before restoring it', () => {
  const { nodes, onRestore } = row(false);
  expect(text(nodes)).toContain('bkForeign');
  confirm.mockReturnValue(false);
  press(nodes);
  expect(confirm).toHaveBeenCalledWith('bkRestoreForeignQ{"when":"8 Nov 2026"}');
  expect(onRestore).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  press(nodes);
  // never refused: a new PC owns no copy yet and must still be able to restore
  expect(onRestore).toHaveBeenCalledTimes(1);
});

it('restores the company’s own copies (and copies from older servers that do not say) with the usual question', () => {
  for (const own of [true, undefined]) {
    const { nodes, onRestore } = row(own);
    expect(text(nodes)).not.toContain('bkForeign');
    press(nodes);
    expect(confirm).toHaveBeenLastCalledWith('bkRestoreQ{"when":"8 Nov 2026"}');
    expect(onRestore).toHaveBeenCalledTimes(1);
  }
});

it('has the warning in Arabic, English and Kurdish', () => {
  expect(CLOUD_TEXT.bkForeign[1]).toBe('From another company or PC');
  for (const k of ['bkForeign', 'bkRestoreForeignQ'] as const) expect(CLOUD_TEXT[k].every((s) => s.trim().length > 0)).toBe(true);
  for (const s of CLOUD_TEXT.bkRestoreForeignQ) expect(s).toContain('{when}');
});
