import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { Users } from './Users.tsx';
import type { Me } from '../api.ts';

// Render the users page without a browser: hooks are simple stand-ins, components are walked as plain elements.
const fixture = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0,
  users: [
    { id: 'u1', username: 'mer', name: 'Mer', roles: ['admin'], active: true, hasPassword: true, createdAt: '2026-11-01', lastLoginAt: null },
    { id: 'u2', username: 'las', name: 'Las', roles: ['sales'], active: true, hasPassword: false, createdAt: '2026-11-02', lastLoginAt: null }
  ]
}));
vi.mock('react', () => ({
  useState<T>(initial: T | (() => T)) {
    const i = fixture.cursor++;
    if (!(i in fixture.states)) fixture.states[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [fixture.states[i], (value: T) => { fixture.states[i] = value; }];
  }
}));
vi.mock('../components.tsx', () => ({
  ErrorBox: 'ErrorBox', Icon: 'Icon', Logo: 'Logo', Modal: 'Modal',
  useData: () => ({ plan: { plan: 'trial', features: ['roles'] } }),
  useLoad: (fn: () => unknown) => ({ data: fn(), reload: () => {} }), useToast: () => () => {}
}));
vi.mock('../i18n.ts', () => ({ useI18n: () => ({ t: (s: string) => s, date: String, lang: 'ku' }) }));
vi.mock('../router.ts', () => ({ href: (s: string) => s }));
vi.mock('../api.ts', () => ({ ROLES: ['admin', 'sales'], api: { users: () => fixture.users } }));

type Node = ReactElement<Record<string, unknown>>;
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...flatten(node.props.children)];
}
const me = { user: { id: 'u1' }, demo: false, signInRequired: false, separateDuties: false } as unknown as Me;
const render = () => { fixture.cursor = 0; return flatten(Users({ me, onMeChanged: () => {} })); };

beforeEach(() => { fixture.states = []; });

it('keeps the row buttons inside a real table cell (a flex <td> let them spill over the rows in Kurdish and Arabic)', () => {
  const nodes = render();
  const cells = nodes.filter((n) => n.type === 'td' && n.props.className === 'cell-actions');
  expect(cells).toHaveLength(fixture.users.length);
  for (const cell of cells) {
    // the cell itself is never a flex box; the buttons sit in one row inside it
    expect(String(cell.props.className)).not.toMatch(/\brow\b/);
    expect(cell.props.style).toBeUndefined();
    const inner = flatten(cell.props.children);
    const row = inner.find((n) => n.type === 'div')!;
    expect(row.props.className).toBe('row cell-actions-row');
    expect(flatten(row.props.children).filter((n) => n.type === 'button')).toHaveLength(2);
  }
  // the table scrolls inside its card at narrow widths instead of pushing the buttons out
  const table = nodes.find((n) => n.type === 'table')!;
  const wrap = nodes.find((n) => n.type === 'div' && n.props.className === 'table-wrap' && flatten(n.props.children).includes(table));
  expect(wrap).toBeDefined();
});

it('styles the actions cell to shrink to its buttons and keep them on one line, in both directions', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  expect(css).toMatch(/\.table :is\(td, th\)\.cell-actions \{[^}]*white-space: nowrap/);
  expect(css).toMatch(/\.table \.cell-actions-row \{[^}]*flex-wrap: nowrap/);
  // logical alignment only, so RTL (ar, ku) and LTR (en) both put the buttons at the row's end
  expect(css).toMatch(/\.table \.cell-actions-row \{[^}]*justify-content: flex-end/);
});
