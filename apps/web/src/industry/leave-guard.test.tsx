import { expect, it } from 'vitest';
import { isEditorRoute, mayLeave } from './leave-guard.ts';

it('knows the pages that hold unsaved typing', () => {
  for (const h of ['#/new-invoice/sale', '#/edit-invoice/abc', '#/new', '#/edit/abc', '#/pos', '#/new-quote', '#/stock-count', '#/import']) expect(isEditorRoute(h), h).toBe(true);
  for (const h of ['', '#/', '#/home', '#/invoice/abc', '#/sales', '#/reports-more/aging', '#/newsletter']) expect(isEditorRoute(h), h).toBe(false);
});

it('asks before leaving an editor (switching branch, opening the tour), and only there', () => {
  const asked: string[] = [];
  const no = (q: string) => { asked.push(q); return false; };
  expect(mayLeave('Leave?', '#/pos', no)).toBe(false);
  expect(mayLeave('Leave?', '#/sales', no)).toBe(true);
  expect(asked).toEqual(['Leave?']);
  expect(mayLeave('Leave?', '#/new-invoice/sale', () => true)).toBe(true);
});
