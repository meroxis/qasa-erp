import { expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { Companies } from './Companies.tsx';
import { COMPANY_TEXT } from '../i18n/companies.ts';

// Render the page without a browser: hooks are simple stand-ins and the tree is walked as plain elements.
vi.mock('react', () => ({ useState: <T,>(initial: T) => [initial, () => {}] }));
vi.mock('../components.tsx', () => ({
  ErrorBox: 'ErrorBox', Icon: 'Icon', Modal: 'Modal', usePageNav: () => {}, useToast: () => () => {},
  // an older answer could still say a company is not openable: nothing holds a company back from opening
  useLoad: () => ({ data: { current: 'main', limit: 2, canAdd: false, list: [
    { id: 'main', name: 'Head office', createdAt: '2026-01-01T00:00:00Z', current: true },
    { id: 'c2', name: 'Workshop', createdAt: '2026-02-01T00:00:00Z', current: false, openable: false },
    { id: 'c3', name: 'Branch 3', createdAt: '2026-03-01T00:00:00Z', current: false, waiting: true }
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

it('opens every company, and marks one past the plan as view only: never out of reach (security review #10)', () => {
  const nodes = flatten(Companies());
  const opens = nodes.filter((n) => n.type === 'button' && JSON.stringify(n.props.children).includes('co_open'));
  expect(opens.map((b) => b.props.disabled)).toEqual([false, false]);
  expect(nodes.filter((n) => n.type === 'span' && JSON.stringify(n.props.children ?? '').includes('co_waiting'))).toHaveLength(1);
  expect(COMPANY_TEXT).toHaveProperty('co_waitingHint');
  // the text says what it is now: viewed, not waiting to be opened
  expect(COMPANY_TEXT.co_waiting[1]).toBe('View only');
  for (const key of ['co_viewOnly', 'co_viewOnlyText', 'co_viewOnlyPlans', 'err_company_view_only'] as const) expect(COMPANY_TEXT[key].every((x) => x.length > 0)).toBe(true);
});
