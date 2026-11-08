import { expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { Companies } from './Companies.tsx';
import { COMPANY_TEXT } from '../i18n/companies.ts';

// Render the page without a browser: hooks are simple stand-ins and the tree is walked as plain elements.
vi.mock('react', () => ({ useState: <T,>(initial: T) => [initial, () => {}] }));
vi.mock('../components.tsx', () => ({
  ErrorBox: 'ErrorBox', Icon: 'Icon', Modal: 'Modal', usePageNav: () => {}, useToast: () => () => {},
  // an older answer could still say a company is not openable; every company on the PC opens
  useLoad: () => ({ data: { current: 'main', limit: 1, canAdd: false, list: [
    { id: 'main', name: 'Head office', createdAt: '2026-01-01T00:00:00Z', current: true },
    { id: 'c2', name: 'Workshop', createdAt: '2026-02-01T00:00:00Z', current: false, openable: false }
  ] } })
}));
vi.mock('../i18n.ts', () => ({ useI18n: () => ({ t: (s: string) => s, int: String, date: String }) }));
vi.mock('../router.ts', () => ({ href: (s: string) => s }));
vi.mock('../industry/companies-api.ts', () => ({ canSwitchCompanies: () => true, companiesApi: {} }));

type Node = ReactElement<Record<string, unknown>>;
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...flatten(node.props.children)];
}

it('never shows a company as waiting for a licence: every company opens, whatever the plan (no lock-out)', () => {
  const nodes = flatten(Companies());
  const open = nodes.find((n) => n.type === 'button' && JSON.stringify(n.props.children).includes('co_open'))!;
  expect(open).toBeDefined();
  expect(open.props.disabled).toBe(false);
  expect(nodes.some((n) => n.type === 'span' && JSON.stringify(n.props.children ?? '').includes('co_waiting'))).toBe(false);
  expect(Object.keys(COMPANY_TEXT).filter((k) => k.startsWith('co_waiting'))).toEqual([]);
});
