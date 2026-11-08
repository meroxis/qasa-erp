import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { PHONE_APP_READY, PhonesCard } from './Settings.tsx';
import { ROWS } from './Plans.tsx';
import { UI_TEXT } from '../i18n/ui.ts';
import { PHONE_TEXT } from '../i18n/phone.ts';

// The phone app is not in 1.0: Settings → Phones says it is coming, with no pairing, and the tour and plans don't sell it.
const fixture = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0 }));
vi.mock('react', () => ({
  useState<T>(initial: T) {
    const i = fixture.cursor++;
    if (!(i in fixture.states)) fixture.states[i] = initial;
    return [fixture.states[i], () => {}];
  },
  useEffect() {}, createContext: () => ({}), useContext: () => ({})
}));
vi.mock('../components.tsx', () => ({
  AccountCombo: 'AccountCombo', ErrorBox: 'ErrorBox', Icon: 'Icon', Modal: 'Modal', downloadCsv: () => {}, useToast: () => () => {},
  useData: () => ({ plan: null })
}));
vi.mock('../i18n.ts', () => ({ isKey: () => true, useI18n: () => ({ t: (s: string) => s, digitsOf: String, date: String, int: String }) }));
vi.mock('../router.ts', () => ({ href: (s: string) => s }));

type Node = ReactElement<Record<string, unknown>>;
function flatten(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...flatten(node.props.children)];
}
const status = { available: true, listening: true, port: 8789, addresses: [], devices: [], users: [{ id: 'u1', name: 'Raz' }], counts: [], signInRequired: true };
const render = (ready?: boolean) => {
  fixture.cursor = 0;
  return JSON.stringify(flatten(PhonesCard(ready === undefined ? {} : { ready })).map((n) => [n.type, n.props.children ?? '']));
};

beforeEach(() => { fixture.states = [status]; });

it('says the phone app is coming soon and offers no pairing in 1.0', () => {
  expect(PHONE_APP_READY).toBe(false);
  const card = render();
  expect(card).toContain('ph_soonNote');
  expect(card).toContain('"soon"');
  for (const hidden of ['ph_add', 'ph_actsAs', 'ph_step1', 'ph_scanThis', 'ph_help', 'ph_needsPro']) expect(card, hidden).not.toContain(hidden);
});

it('keeps the pairing for the release that ships the app', () => {
  const card = render(true);
  expect(card).toContain('ph_add');
  expect(card).not.toContain('ph_soonNote');
});

it('does not sell the phone app in the tour, and marks it soon on the plans page', () => {
  for (const key of ['tour_plan_pro', 'tour_proAdds'] as const) {
    const [ar, en, ku] = UI_TEXT[key];
    expect(en, key).not.toMatch(/phone/i);
    expect(ar, key).not.toMatch(/الهاتف|الموبايل/);
    expect(ku, key).not.toMatch(/مۆبایل/);
  }
  expect(ROWS.find((r) => r.label === 'f_phoneApp')?.soon).toBe(true);
  expect(PHONE_TEXT.ph_soonNote[1]).toMatch(/coming soon/);
  for (const text of PHONE_TEXT.ph_soonNote) expect(text.trim().length).toBeGreaterThan(20);
});

it('says in the tour, as on the plans page, that the online edition is coming soon', () => {
  expect(ROWS.find((r) => r.label === 'f_online')?.soon).toBe(true);
  const [ar, en, ku] = UI_TEXT.tour_plan_business;
  expect(en).toMatch(/online edition is coming soon/);
  expect(ar).toMatch(/النسخة الإلكترونية قادمة قريباً/);
  expect(ku).toMatch(/وەشانی ئۆنلاین بەم زووانە دێت/);
  // what ships in 1.0 is still said plainly
  for (const [text, branches] of [[ar, 'الفروع'], [en, 'branches'], [ku, 'لقەکان']] as const) expect(text).toContain(branches);
  // so does the line the Pro tour adds about Business
  const [arAdds, enAdds, kuAdds] = UI_TEXT.tour_businessAdds;
  // whole sentences: the online edition "is coming soon" (with its verb), as on the plans page
  expect(enAdds).toBe('Business adds branches and real estate; the online edition is coming soon.');
  expect(arAdds).toMatch(/؛ والنسخة الإلكترونية قادمة قريباً\.$/);
  expect(kuAdds).toMatch(/؛ وەشانی ئۆنلاین بەم زووانە دێت\.$/);
  for (const [text, branches] of [[arAdds, 'الفروع'], [enAdds, 'branches'], [kuAdds, 'لقەکان']] as const) expect(text).toContain(branches);
});
